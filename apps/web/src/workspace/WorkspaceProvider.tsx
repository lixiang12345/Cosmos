import type { MeOrganization, MeResponse } from '@relay/contracts'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '../auth/context'
import { getMe } from '../services/relayApi'
import { WorkspaceContext, type WorkspaceContextValue, type WorkspaceStatus } from './context'

const SELECTION_STORAGE_KEY = 'relay.workspace.selection.v1'

type Selection = {
  actorId: string
  organizationId: string
  spaceId: string
}

function readSelection(): Selection | undefined {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(SELECTION_STORAGE_KEY) ?? 'null')
    if (typeof value !== 'object' || value === null) return undefined
    const candidate = value as Record<string, unknown>
    if (typeof candidate.actorId !== 'string'
      || typeof candidate.organizationId !== 'string'
      || typeof candidate.spaceId !== 'string') return undefined
    return {
      actorId: candidate.actorId,
      organizationId: candidate.organizationId,
      spaceId: candidate.spaceId,
    }
  } catch {
    return undefined
  }
}

function writeSelection(selection: Selection) {
  try {
    window.localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selection))
  } catch {
    // The validated selection remains active for this browser session.
  }
}

function resolveSelection(me: MeResponse, stored: Selection | undefined) {
  if (stored?.actorId === me.actor.id) {
    const organization = me.organizations.find((item) => item.id === stored.organizationId)
    const space = organization?.spaces.find((item) => item.id === stored.spaceId)
    if (organization && space) return { organization, space }
  }
  for (const organization of me.organizations) {
    const space = organization.spaces[0]
    if (space) return { organization, space }
  }
  return undefined
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const [status, setStatus] = useState<WorkspaceStatus>('loading')
  const [me, setMe] = useState<MeResponse>()
  const [activeOrganization, setActiveOrganization] = useState<MeOrganization>()
  const [activeSpaceId, setActiveSpaceId] = useState<string>()
  const [error, setError] = useState<string>()
  const [resolvedActorId, setResolvedActorId] = useState<string>()
  const [refreshVersion, setRefreshVersion] = useState(0)
  const verifiedActorRef = useRef<string | undefined>(undefined)
  const requestRef = useRef<{
    actorId: string
    accessToken?: string
    refreshVersion: number
    promise: Promise<MeResponse>
  } | undefined>(undefined)

  useEffect(() => {
    if (auth.status !== 'authenticated' || !auth.actorId) return
    let cancelled = false
    const hasVerifiedSnapshot = verifiedActorRef.current === auth.actorId
    if (!hasVerifiedSnapshot) {
      verifiedActorRef.current = undefined
      setError(undefined)
      setStatus('loading')
    }
    const current = requestRef.current
    const promise = current
      && current.actorId === auth.actorId
      && current.accessToken === auth.accessToken
      && current.refreshVersion === refreshVersion
      ? current.promise
      : getMe({ accessToken: auth.accessToken, onUnauthorized: auth.handleUnauthorized })
    requestRef.current = {
      actorId: auth.actorId,
      accessToken: auth.accessToken,
      refreshVersion,
      promise,
    }

    void promise.then((response) => {
      if (cancelled) return
      if (response.actor.id !== auth.actorId) {
        verifiedActorRef.current = undefined
        setMe(undefined)
        setActiveOrganization(undefined)
        setActiveSpaceId(undefined)
        setError('The authenticated identity does not match the Workspace response.')
        setResolvedActorId(auth.actorId)
        setStatus('error')
        return
      }
      const selection = resolveSelection(response, readSelection())
      verifiedActorRef.current = response.actor.id
      setMe(response)
      setError(undefined)
      setResolvedActorId(response.actor.id)
      if (!selection) {
        setActiveOrganization(undefined)
        setActiveSpaceId(undefined)
        setStatus('empty')
        return
      }
      setActiveOrganization(selection.organization)
      setActiveSpaceId(selection.space.id)
      writeSelection({
        actorId: response.actor.id,
        organizationId: selection.organization.id,
        spaceId: selection.space.id,
      })
      setStatus('ready')
    }, (cause: unknown) => {
      if (cancelled) return
      if (hasVerifiedSnapshot) return
      const message = cause instanceof Error ? cause.message : 'Unable to load your Workspace access.'
      verifiedActorRef.current = undefined
      setMe(undefined)
      setActiveOrganization(undefined)
      setActiveSpaceId(undefined)
      setError(message)
      setResolvedActorId(auth.actorId)
      setStatus('error')
    })
    return () => { cancelled = true }
  }, [auth.accessToken, auth.actorId, auth.handleUnauthorized, auth.status, refreshVersion])

  const selectSpace = useCallback((organizationId: string, spaceId: string) => {
    if (!me) return
    const organization = me.organizations.find((item) => item.id === organizationId)
    const space = organization?.spaces.find((item) => item.id === spaceId)
    if (!organization || !space) return
    setActiveOrganization(organization)
    setActiveSpaceId(space.id)
    writeSelection({ actorId: me.actor.id, organizationId, spaceId })
  }, [me])

  const refresh = useCallback(() => {
    setRefreshVersion((value) => value + 1)
  }, [])

  const activeSpace = activeOrganization?.spaces.find((item) => item.id === activeSpaceId)
  const currentActor = Boolean(auth.actorId && resolvedActorId === auth.actorId)
  const value = useMemo<WorkspaceContextValue>(() => ({
    status: currentActor ? status : 'loading',
    me: currentActor ? me : undefined,
    activeOrganization: currentActor ? activeOrganization : undefined,
    activeSpace: currentActor ? activeSpace : undefined,
    error: currentActor ? error : undefined,
    selectSpace,
    refresh,
  }), [activeOrganization, activeSpace, currentActor, error, me, refresh, selectSpace, status])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
