import type {
  SessionEventCursor,
  SessionEventDto,
  SessionMessageDto,
} from '@relay/contracts'
import { useEffect, useState } from 'react'
import {
  RelayApiError,
  listSessionEvents,
  listSessionMessages,
  streamSessionEvents,
  type RelayApiAuthContext,
} from '../../services/relayApi'

const SESSION_TIMELINE_POLL_MS = 2_000
const SESSION_TIMELINE_SSE_RETRY_MS = 500
const SESSION_TIMELINE_SSE_MAX_RETRY_MS = 8_000
const SESSION_TIMELINE_SSE_MAX_RETRIES = 5

export type RemoteSessionTimelineState = {
  status: 'loading' | 'ready' | 'error'
  messages: SessionMessageDto[]
  events: SessionEventDto[]
  error?: string
  concealed?: boolean
}

type UseRemoteSessionTimelineOptions = {
  organizationId: string
  spaceId: string
  sessionId?: string
  credentialVersion: number
  auth: RelayApiAuthContext
  enabled: boolean
  transport: 'polling' | 'sse'
  pollMs?: number
  onConcealed?: (error: string) => void
}

function mergeBySequence<T extends { sequence: number }>(current: T[], incoming: T[]) {
  if (!incoming.length) return current
  const merged = new Map(current.map((item) => [item.sequence, item]))
  for (const item of incoming) merged.set(item.sequence, item)
  return [...merged.values()].sort((left, right) => left.sequence - right.sequence)
}

function isConcealed(cause: unknown) {
  return cause instanceof RelayApiError
    && cause.status !== undefined
    && [401, 403, 404].includes(cause.status)
}

function abortableDelay(durationMs: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(done, durationMs)
    function done() {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export function useRemoteSessionTimeline({
  organizationId,
  spaceId,
  sessionId,
  credentialVersion,
  auth,
  enabled,
  transport,
  pollMs = SESSION_TIMELINE_POLL_MS,
  onConcealed,
}: UseRemoteSessionTimelineOptions): RemoteSessionTimelineState {
  const [request, setRequest] = useState<(RemoteSessionTimelineState & { key: string })>()
  const requestKey = `${organizationId}\u0000${spaceId}\u0000${sessionId ?? ''}\u0000${credentialVersion}\u0000${transport}`

  useEffect(() => {
    if (!enabled || !sessionId) return
    const controller = new AbortController()
    let timer: number | undefined
    let messageCursor: string | SessionEventCursor | undefined
    let eventCursor: SessionEventCursor | undefined

    const concealOrRetry = (cause: unknown, retry: () => void) => {
      if (controller.signal.aborted) return
      const concealed = isConcealed(cause)
      setRequest((current) => ({
        key: requestKey,
        status: 'error',
        messages: concealed ? [] : current?.key === requestKey ? current.messages : [],
        events: concealed ? [] : current?.key === requestKey ? current.events : [],
        error: cause instanceof Error ? cause.message : 'Unable to load the Session timeline.',
        concealed,
      }))
      if (concealed) onConcealed?.(
        cause instanceof Error ? cause.message : 'The current credentials cannot access this Session.',
      )
      if (!concealed) retry()
    }

    const updateMessages = (items: SessionMessageDto[]) => {
      setRequest((current) => ({
        key: requestKey,
        status: 'ready',
        messages: mergeBySequence(current?.key === requestKey ? current.messages : [], items),
        events: current?.key === requestKey ? current.events : [],
      }))
    }

    const poll = async () => {
      try {
        const [messages, events] = await Promise.all([
          listSessionMessages(
            organizationId,
            spaceId,
            sessionId,
            auth,
            controller.signal,
            { cursor: messageCursor, limit: 100 },
          ),
          listSessionEvents(
            organizationId,
            spaceId,
            sessionId,
            auth,
            controller.signal,
            { cursor: eventCursor, limit: 500 },
          ),
        ])
        if (controller.signal.aborted) return

        const lastMessage = messages.items.at(-1)
        const lastEvent = events.items.at(-1)
        messageCursor = messages.page.nextCursor ?? (lastMessage ? {
          organizationId, spaceId, sessionId, sequence: lastMessage.sequence,
        } : messageCursor)
        eventCursor = events.page.nextCursor ?? (lastEvent ? {
          organizationId, spaceId, sessionId, sequence: lastEvent.sequence,
        } : eventCursor)

        setRequest((current) => ({
          key: requestKey,
          status: 'ready',
          messages: mergeBySequence(current?.key === requestKey ? current.messages : [], messages.items),
          events: mergeBySequence(current?.key === requestKey ? current.events : [], events.items),
        }))
        timer = window.setTimeout(poll, messages.page.hasMore || events.page.hasMore ? 0 : pollMs)
      } catch (cause) {
        concealOrRetry(cause, () => { timer = window.setTimeout(poll, pollMs) })
      }
    }

    const stream = async () => {
      let lastEventId: string | undefined
      let retryMs = SESSION_TIMELINE_SSE_RETRY_MS
      let retryCount = 0
      const refreshMessages = async () => {
        for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
          const messages = await listSessionMessages(
            organizationId,
            spaceId,
            sessionId,
            auth,
            controller.signal,
            { cursor: messageCursor, limit: 100 },
          )
          if (controller.signal.aborted) return
          const lastMessage = messages.items.at(-1)
          messageCursor = messages.page.nextCursor ?? (lastMessage ? {
            organizationId, spaceId, sessionId, sequence: lastMessage.sequence,
          } : messageCursor)
          updateMessages(messages.items)
          if (!messages.page.hasMore) return
        }
        throw new RelayApiError('Session message pagination exceeded the supported limit.', {
          code: 'INVALID_RESPONSE', status: 200,
        })
      }
      try {
        await refreshMessages()

        while (!controller.signal.aborted) {
          try {
            const result = await streamSessionEvents(
              organizationId,
              spaceId,
              sessionId,
              auth,
              controller.signal,
              {
                cursor: lastEventId ? undefined : eventCursor,
                lastEventId,
                onEvent: async (event) => {
                  eventCursor = { organizationId, spaceId, sessionId, sequence: event.sequence }
                  setRequest((current) => ({
                    key: requestKey,
                    status: 'ready',
                    messages: current?.key === requestKey ? current.messages : [],
                    events: mergeBySequence(current?.key === requestKey ? current.events : [], [event]),
                  }))
                  if (event.type === 'message.created') await refreshMessages()
                },
              },
            )
            lastEventId = result.lastEventId ?? lastEventId
            if (result.reconnect) {
              retryCount = 0
              retryMs = SESSION_TIMELINE_SSE_RETRY_MS
              if (!controller.signal.aborted) await abortableDelay(50, controller.signal)
            } else {
              retryCount += 1
              if (retryCount > SESSION_TIMELINE_SSE_MAX_RETRIES) {
                setRequest((current) => ({
                  key: requestKey,
                  status: 'error',
                  messages: current?.key === requestKey ? current.messages : [],
                  events: current?.key === requestKey ? current.events : [],
                  error: 'The Session event stream disconnected after the retry limit.',
                }))
                void poll()
                return
              }
              await abortableDelay(retryMs, controller.signal)
              retryMs = Math.min(retryMs * 2, SESSION_TIMELINE_SSE_MAX_RETRY_MS)
            }
          } catch (cause) {
            if (controller.signal.aborted) return
            if (isConcealed(cause)) {
              concealOrRetry(cause, () => undefined)
              return
            }
            setRequest((current) => ({
              key: requestKey,
              status: 'error',
              messages: current?.key === requestKey ? current.messages : [],
              events: current?.key === requestKey ? current.events : [],
              error: cause instanceof Error ? cause.message : 'Unable to load the Session timeline.',
            }))
            retryCount += 1
            if (retryCount > SESSION_TIMELINE_SSE_MAX_RETRIES) {
              void poll()
              return
            }
            await abortableDelay(retryMs, controller.signal)
            retryMs = Math.min(retryMs * 2, SESSION_TIMELINE_SSE_MAX_RETRY_MS)
          }
        }
      } catch (cause) {
        concealOrRetry(cause, () => { void poll() })
      }
    }

    if (transport === 'sse') void stream()
    else void poll()
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      controller.abort()
    }
  }, [auth, credentialVersion, enabled, onConcealed, organizationId, pollMs, requestKey, sessionId, spaceId, transport])

  if (!enabled || !sessionId) return { status: 'ready', messages: [], events: [] }
  if (request?.key !== requestKey) return { status: 'loading', messages: [], events: [] }
  return request
}
