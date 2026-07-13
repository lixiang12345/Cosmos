import type { SessionEventPage, SessionMessagePage } from '@relay/contracts'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RELAY_API_TIMEOUT_MS } from '../../services/relayApi'
import { useRemoteSessionTimeline } from './useRemoteSessionTimeline'

const scope = {
  organizationId: 'organization-a',
  spaceId: 'space-a',
  sessionId: 'session-a',
}
const auth = { accessToken: 'token-a' }

const messagePage: SessionMessagePage = {
  ...scope,
  items: [{
    id: 'message-private',
    ...scope,
    sequence: 2,
    role: 'user',
    actorId: 'user-a',
    content: 'Private production context.',
    attachments: [],
    createdAt: '2026-07-13T08:00:00.000Z',
  }],
  page: { nextCursor: null, hasMore: false },
}

const eventPage: SessionEventPage = {
  ...scope,
  items: [{
    eventId: 'event-running',
    ...scope,
    sequence: 4,
    type: 'attempt.updated',
    resourceType: 'attempt',
    resourceId: 'attempt-1',
    actorId: 'worker-a',
    commandId: 'command-a',
    requestId: 'request-a',
    occurredAt: '2026-07-13T08:00:01.000Z',
    payload: {
      attemptId: 'attempt-1', turnId: 'turn-a', number: 1, status: 'running', failureCode: null,
    },
  }],
  page: { nextCursor: null, hasMore: false },
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function decodeCursor(url: string) {
  const encoded = new URL(url, window.location.origin).searchParams.get('cursor')!
  const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/')
  return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
}

function TimelineProbe({ transport = 'polling' }: { transport?: 'polling' | 'sse' }) {
  const timeline = useRemoteSessionTimeline({
    ...scope,
    credentialVersion: 1,
    auth,
    enabled: true,
    transport,
  })
  if (timeline.concealed) return <output>CONCEALED</output>
  return (
    <output>
      {timeline.messages.map((message) => message.content).join('|')}
      {timeline.events.map((event) => event.type).join('|')}
    </output>
  )
}

async function flushRequests() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useRemoteSessionTimeline', () => {
  it('uses scope-bound recovery cursors on the poll after a final page', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(messagePage))
      .mockResolvedValueOnce(jsonResponse(eventPage))
      .mockImplementation(() => new Promise(() => undefined))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<TimelineProbe />)
    await flushRequests()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)

    expect(decodeCursor(String(fetchMock.mock.calls[2][0]))).toEqual({ ...scope, sequence: 2 })
    expect(decodeCursor(String(fetchMock.mock.calls[3][0]))).toEqual({ ...scope, sequence: 4 })
    view.unmount()
  })

  it('clears private timeline data and stops polling after access is concealed', async () => {
    vi.useFakeTimers()
    const emptyEvents = { ...eventPage, items: [] }
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(messagePage))
      .mockResolvedValueOnce(jsonResponse(eventPage))
      .mockResolvedValueOnce(jsonResponse({
        code: 'RESOURCE_NOT_FOUND', message: 'Session unavailable.', retryable: false,
      }, 404))
      .mockResolvedValueOnce(jsonResponse(emptyEvents))
    vi.stubGlobal('fetch', fetchMock)
    render(<TimelineProbe />)
    await flushRequests()
    expect(screen.getByText(/Private production context/)).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(screen.getByText('CONCEALED')).toBeInTheDocument()
    expect(screen.queryByText(/Private production context/)).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('uses fetch SSE after the initial message page and conceals on terminal stream authorization', async () => {
    vi.useFakeTimers()
    const event = eventPage.items[0]
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(messagePage))
      .mockResolvedValueOnce(new Response(
        `id: cursor-4\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\nevent: reconnect\ndata: {}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(jsonResponse({
        code: 'PERMISSION_DENIED', message: 'Session unavailable.', retryable: false,
      }, 403))
    vi.stubGlobal('fetch', fetchMock)

    render(<TimelineProbe transport="sse" />)
    await flushRequests()
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })

    expect(screen.getByText('CONCEALED')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const firstStreamHeaders = new Headers(fetchMock.mock.calls[1][1]?.headers)
    expect(firstStreamHeaders.get('Authorization')).toBe('Bearer token-a')
    const reconnectHeaders = new Headers(fetchMock.mock.calls[2][1]?.headers)
    expect(reconnectHeaders.get('Last-Event-ID')).toBe('cursor-4')
  })

  it('times out stalled SSE handshakes and falls back to cursor-preserving polling', async () => {
    vi.useFakeTimers()
    let streamAttempts = 0
    let eventPolls = 0
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/events/stream')) {
        streamAttempts += 1
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
      }
      if (url.includes('/messages')) return jsonResponse(messagePage)
      if (url.includes('/events')) {
        eventPolls += 1
        return jsonResponse(eventPage)
      }
      throw new Error(`Unexpected timeline request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = render(<TimelineProbe transport="sse" />)
    await flushRequests()
    const retryDelays = [500, 1_000, 2_000, 4_000, 8_000]
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(RELAY_API_TIMEOUT_MS) })
      if (attempt < retryDelays.length) {
        await act(async () => { await vi.advanceTimersByTimeAsync(retryDelays[attempt]) })
      }
    }
    await flushRequests()

    expect(streamAttempts).toBe(6)
    expect(eventPolls).toBeGreaterThan(0)
    expect(screen.getByText(/attempt.updated/)).toBeInTheDocument()
    const eventPollUrl = fetchMock.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes('/events') && !url.endsWith('/events/stream'))
    expect(eventPollUrl).toBeDefined()
    view.unmount()
  })
})
