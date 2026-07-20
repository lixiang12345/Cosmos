import type { ContextEngineGateway } from './context-engine-gateway.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiErrorSchema } from '@relay/contracts'
import { createApp } from './app.js'
import { createDevelopmentAuthenticator, type AuthenticateRequest } from './auth.js'
import { EmptyConfigurationCatalogRepository } from './configuration-catalog-repository.js'
import { InMemorySessionRepository } from './session-repository.js'

const actorOrganizations = {
  'user-context': [{
    id: 'relay',
    name: 'Relay',
    role: 'organization_owner' as const,
    spaces: [{ id: 'platform', name: 'Platform', role: 'space_manager' as const }],
  }],
  'service-context': [{
    id: 'relay',
    name: 'Relay',
    role: 'organization_owner' as const,
    spaces: [{ id: 'platform', name: 'Platform', role: 'space_manager' as const }],
  }],
}

const gateway: ContextEngineGateway = {
  hasRepository: (repository) => repository === 'relay/platform',
  status: vi.fn(async (repository: string) => ({
    provider: 'contextengine-plugin' as const,
    repository,
    available: true,
    indexed: true,
    revision: 1,
    updatedAt: '2026-07-20T09:30:00.000Z',
    retrievalMode: 'hybrid' as const,
    stats: { files: 7, chunks: 42, symbols: 0, embeddedChunks: 42 },
  })),
  search: vi.fn(async (request: Parameters<ContextEngineGateway['search']>[0]) => ({
    provider: 'contextengine-plugin' as const,
    repository: request.repository,
    query: request.query,
    mode: request.mode,
    durationMs: 4,
    hits: [],
  })),
  pack: vi.fn(async (request: Parameters<ContextEngineGateway['pack']>[0]) => ({
    provider: 'contextengine-plugin' as const,
    repository: request.repository,
    task: request.task,
    packedText: '',
    estimatedTokens: 0,
    truncated: false,
    durationMs: 4,
    hits: [],
  })),
}

const openApps: ReturnType<typeof createApp>[] = []

function appWithAccess(allowed: boolean, authenticate: AuthenticateRequest = createDevelopmentAuthenticator('user-context')) {
  const catalog = new EmptyConfigurationCatalogRepository()
  vi.spyOn(catalog, 'hasRepositoryAccess').mockResolvedValue(allowed)
  const app = createApp({
    authenticate,
    sessionRepository: new InMemorySessionRepository({ actorOrganizations }),
    configurationCatalogRepository: catalog,
    contextEngineGateway: gateway,
  })
  openApps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()))
  vi.clearAllMocks()
})

describe('Context Engine routes', () => {
  it('allows a user only when the current Space active Environment binds the repository', async () => {
    const response = await appWithAccess(true).inject({
      method: 'GET',
      url: '/api/v1/organizations/relay/spaces/platform/context-engine/status?repository=relay%2Fplatform',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ repository: 'relay/platform', indexed: true })
    expect(gateway.status).toHaveBeenCalledWith('relay/platform')
  })

  it('conceals cross-Space and unconfigured repository names with the same 404 envelope', async () => {
    const denied = await appWithAccess(false).inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/context-engine/search',
      payload: { repository: 'relay/platform', query: 'secret', topK: 5, mode: 'auto', expandGraph: true },
    })
    const unconfigured = await appWithAccess(true).inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/context-engine/search',
      payload: { repository: 'other/repository', query: 'secret', topK: 5, mode: 'auto', expandGraph: true },
    })

    expect(denied.statusCode).toBe(404)
    expect(unconfigured.statusCode).toBe(404)
    expect(ApiErrorSchema.parse(denied.json())).toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    expect(unconfigured.json()).toEqual(denied.json())
    expect(gateway.search).not.toHaveBeenCalled()
  })

  it('rejects service accounts before repository access or gateway calls', async () => {
    const catalog = new EmptyConfigurationCatalogRepository()
    const access = vi.spyOn(catalog, 'hasRepositoryAccess')
    const app = createApp({
      authenticate: async () => ({ id: 'service-context', kind: 'service_account', audience: 'relay-api' }),
      sessionRepository: new InMemorySessionRepository({ actorOrganizations }),
      configurationCatalogRepository: catalog,
      contextEngineGateway: gateway,
    })
    openApps.push(app)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/context-engine/context',
      payload: { repository: 'relay/platform', task: 'inspect code', topK: 5, maxTokens: 1000 },
    })

    expect(response.statusCode).toBe(403)
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(access).not.toHaveBeenCalled()
    expect(gateway.pack).not.toHaveBeenCalled()
  })
})
