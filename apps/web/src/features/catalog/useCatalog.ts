import type { DaemonDto, EnvironmentSummaryDto, ExpertSummaryDto, McpServerDto, RepositoryDto, SecretDto, WebhookDto } from '@cosmos/contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listDaemons,
  listEnvironments,
  listExperts,
  listMcpServers,
  listRepositories,
  listSecrets,
  listWebhooks,
  type CosmosApiAuthContext,
} from '../../services/cosmosApi'

type CatalogPage<T> = {
  items: T[]
  page: {
    hasMore: boolean
    nextCursor: string | null
  }
}

async function loadCatalogPages<T extends { id: string }>(
  signal: AbortSignal,
  loadPage: (cursor: string | undefined) => Promise<CatalogPage<T>>,
) {
  const items: T[] = []
  const itemIds = new Set<string>()
  const cursors = new Set<string>()
  let cursor: string | undefined

  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const response = await loadPage(cursor)
    for (const item of response.items) {
      if (!itemIds.has(item.id)) {
        itemIds.add(item.id)
        items.push(item)
      }
    }
    if (!response.page.hasMore) return { items }
    const nextCursor = response.page.nextCursor
    if (!nextCursor || cursors.has(nextCursor)) {
      throw new Error('Cosmos API returned an invalid Catalog pagination sequence.')
    }
    cursors.add(nextCursor)
    cursor = nextCursor
    if (signal.aborted) throw new DOMException('The request was aborted.', 'AbortError')
  }

  throw new Error('Cosmos API Catalog pagination exceeded the supported limit.')
}

export type CatalogRequestInput = {
  organizationId: string
  spaceId: string
  accessToken?: string
  credentialVersion: number
  onUnauthorized: NonNullable<CosmosApiAuthContext['onUnauthorized']>
  enabled: boolean
}

export type CatalogResourceStatus = 'idle' | 'loading' | 'ready' | 'error'

export type CatalogResourceState<T> = {
  status: CatalogResourceStatus
  loading: boolean
  ready: boolean
  items: T[]
  error: Error | null
  retry: () => void
}

export type CatalogReadModel = {
  experts: CatalogResourceState<ExpertSummaryDto>
  environments: CatalogResourceState<EnvironmentSummaryDto>
  repositories: CatalogResourceState<RepositoryDto>
  secrets: CatalogResourceState<SecretDto>
  webhooks: CatalogResourceState<WebhookDto>
  mcpServers: CatalogResourceState<McpServerDto>
  daemons: CatalogResourceState<DaemonDto>
}

type RequestIdentity = object

type CatalogSnapshot<T> = {
  identity: RequestIdentity
  status: Exclude<CatalogResourceStatus, 'idle'>
  items: T[]
  error: Error | null
}

function asError(cause: unknown) {
  return cause instanceof Error ? cause : new Error('Unable to load the Catalog.')
}

function useCatalogResource<T>(
  enabled: boolean,
  identity: RequestIdentity,
  load: (signal: AbortSignal) => Promise<{ items: T[] }>,
): CatalogResourceState<T> {
  const [retryVersion, setRetryVersion] = useState(0)
  const [snapshot, setSnapshot] = useState<CatalogSnapshot<T>>()

  const retry = useCallback(() => {
    if (enabled) {
      setSnapshot({ identity, status: 'loading', items: [], error: null })
    }
    setRetryVersion((version) => version + 1)
  }, [enabled, identity])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void load(controller.signal).then(
      (response) => {
        if (!controller.signal.aborted) {
          setSnapshot({ identity, status: 'ready', items: response.items, error: null })
        }
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setSnapshot({ identity, status: 'error', items: [], error: asError(cause) })
        }
      },
    )
    return () => { controller.abort() }
  }, [enabled, identity, load, retryVersion])

  const current = enabled && snapshot?.identity === identity ? snapshot : undefined
  const status = enabled ? current?.status ?? 'loading' : 'idle'
  return {
    status,
    loading: status === 'loading',
    ready: status === 'ready',
    items: current?.items ?? [],
    error: current?.error ?? null,
    retry,
  }
}

export function useCatalog({
  organizationId,
  spaceId,
  accessToken,
  credentialVersion,
  onUnauthorized,
  enabled,
}: CatalogRequestInput): CatalogReadModel {
  const credentialIdentity = useMemo<RequestIdentity>(() => ({
    credentialVersion,
    hasAccessToken: accessToken !== undefined,
  }), [accessToken, credentialVersion])
  const [invalidatedCredential, setInvalidatedCredential] = useState<RequestIdentity>()
  const handleUnauthorized = useCallback(async (failedAccessToken: string | undefined) => {
    if (failedAccessToken === accessToken) setInvalidatedCredential(credentialIdentity)
    await onUnauthorized(failedAccessToken)
  }, [accessToken, credentialIdentity, onUnauthorized])
  const requestEnabled = enabled && invalidatedCredential !== credentialIdentity
  const identity = useMemo<RequestIdentity>(() => ({
    credentialIdentity,
    handleUnauthorized,
    organizationId,
    requestEnabled,
    spaceId,
  }), [credentialIdentity, handleUnauthorized, organizationId, requestEnabled, spaceId])
  const auth = useMemo<CosmosApiAuthContext>(() => ({
    accessToken,
    onUnauthorized: handleUnauthorized,
  }), [accessToken, handleUnauthorized])
  const loadExperts = useCallback(
    (signal: AbortSignal) => loadCatalogPages(signal, (cursor) => listExperts(
      organizationId,
      spaceId,
      auth,
      signal,
      { limit: 100, ...(cursor ? { cursor } : {}) },
    )),
    [auth, organizationId, spaceId],
  )
  const loadEnvironments = useCallback(
    (signal: AbortSignal) => loadCatalogPages(signal, (cursor) => listEnvironments(
      organizationId,
      spaceId,
      auth,
      signal,
      { limit: 100, ...(cursor ? { cursor } : {}) },
    )),
    [auth, organizationId, spaceId],
  )
  const loadRepositories = useCallback(
    (signal: AbortSignal) => loadCatalogPages(signal, (cursor) => listRepositories(
      organizationId,
      spaceId,
      auth,
      signal,
      { limit: 100, ...(cursor ? { cursor } : {}) },
    )),
    [auth, organizationId, spaceId],
  )
  const loadSecrets = useCallback(
    (signal: AbortSignal) => loadCatalogPages(signal, (cursor) => listSecrets(
      organizationId,
      spaceId,
      auth,
      signal,
      { limit: 100, ...(cursor ? { cursor } : {}) },
    )),
    [auth, organizationId, spaceId],
  )

  const loadWebhooks = useCallback(
    (signal: AbortSignal) => loadCatalogPages(signal, (cursor) => listWebhooks(
      organizationId,
      spaceId,
      auth,
      signal,
      { limit: 100, ...(cursor ? { cursor } : {}) },
    )),
    [auth, organizationId, spaceId],
  )

  const loadMcpServers = useCallback(
    (signal: AbortSignal) => loadCatalogPages(signal, (cursor) => listMcpServers(
      organizationId,
      spaceId,
      auth,
      signal,
      { limit: 100, ...(cursor ? { cursor } : {}) },
    )),
    [auth, organizationId, spaceId],
  )

  const loadDaemons = useCallback(
    (signal: AbortSignal) => loadCatalogPages(signal, (cursor) => listDaemons(
      organizationId,
      spaceId,
      auth,
      signal,
      { limit: 100, ...(cursor ? { cursor } : {}) },
    )),
    [auth, organizationId, spaceId],
  )

  return {
    experts: useCatalogResource(requestEnabled, identity, loadExperts),
    environments: useCatalogResource(requestEnabled, identity, loadEnvironments),
    repositories: useCatalogResource(requestEnabled, identity, loadRepositories),
    secrets: useCatalogResource(requestEnabled, identity, loadSecrets),
    webhooks: useCatalogResource(requestEnabled, identity, loadWebhooks),
    mcpServers: useCatalogResource(requestEnabled, identity, loadMcpServers),
    daemons: useCatalogResource(requestEnabled, identity, loadDaemons),
  }
}
