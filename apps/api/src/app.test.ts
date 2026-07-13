import {
  ApiErrorSchema,
  CreateSessionRequestSchema,
  CreateSessionResponseSchema,
  EnvironmentDetailDtoSchema,
  EnvironmentListResponseSchema,
  ExpertDetailDtoSchema,
  ExpertListResponseSchema,
  MeResponseSchema,
  RetryTurnResponseSchema,
  SessionDtoSchema,
  SessionControlResponseSchema,
  SessionListResponseSchema,
  SendSessionMessageResponseSchema,
  StartSessionResponseSchema,
  type CreateSessionRequestInput,
  type EnvironmentDetailDto,
  type ExpertDetailDto,
} from '@relay/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { createDevelopmentAuthenticator } from './auth.js'
import type {
  ConfigurationCatalogListOptions,
  ConfigurationCatalogRepository,
} from './configuration-catalog-repository.js'
import {
  AuthorizationChangedError,
  InMemorySessionRepository,
  SessionConfigurationNotFoundError,
  type InMemoryExpertCatalogEntry,
  type InMemorySessionRepositoryOptions,
} from './session-repository.js'

const openApps: ReturnType<typeof createApp>[] = []
const sessionRequest: CreateSessionRequestInput = {
  title: 'Fix checkout race condition',
  expertId: 'expert-pr-author',
  expertName: 'PR Author',
  expertVersion: 3,
  environmentId: 'environment-platform',
  repository: 'platform/checkout',
  baseBranch: 'main',
  message: { content: 'Trace the duplicate reservation path and implement a regression test.' },
}

const testActorOrganizations = {
  'user-local-admin': [
    {
      id: 'relay', name: 'Relay', role: 'organization_owner' as const,
      spaces: [
        { id: 'commerce', name: 'Commerce', role: 'space_manager' as const },
        { id: 'platform', name: 'Platform', role: 'space_manager' as const },
      ],
    },
    {
      id: 'other', name: 'Other', role: 'organization_owner' as const,
      spaces: [{ id: 'platform', name: 'Platform', role: 'space_manager' as const }],
    },
  ],
}

function catalogEntry(
  organizationId: string,
  spaceId: string,
  overrides: Partial<InMemoryExpertCatalogEntry> = {},
): InMemoryExpertCatalogEntry {
  return {
    organizationId,
    spaceId,
    id: 'expert-pr-author',
    name: 'Authoritative PR Author',
    status: 'published',
    publishedRevision: {
      id: `expert-revision-${spaceId}`,
      version: 7,
      status: 'published',
      environment: {
        id: `environment-${spaceId}`,
        status: 'ready',
        activeRevisionId: `environment-revision-${spaceId}`,
        revision: {
          id: `environment-revision-${spaceId}`,
          status: 'ready',
          repositories: [{
            id: `repository-${spaceId}`,
            repository: spaceId === 'commerce' ? 'commerce/checkout' : 'platform/checkout',
            baseBranch: 'main',
            isDefault: true,
          }, {
            id: `repository-${spaceId}-secondary`,
            repository: spaceId === 'commerce' ? 'commerce/secondary' : 'platform/secondary',
            baseBranch: 'main',
          }],
        },
      },
    },
    ...overrides,
  }
}

const testAuthoritativeCatalog = [
  catalogEntry('relay', 'commerce'),
  catalogEntry('relay', 'platform'),
  catalogEntry('other', 'platform'),
]

const expertDetail: ExpertDetailDto = {
  id: 'expert-pr-author',
  organizationId: 'relay',
  spaceId: 'platform',
  name: 'PR Author',
  description: 'Produces reviewed pull requests.',
  visibility: 'space',
  status: 'published',
  publishedRevisionId: 'expert-revision-platform',
  publishedRevisionSummary: {
    id: 'expert-revision-platform',
    expertId: 'expert-pr-author',
    revision: 7,
    status: 'published',
    model: 'relay-default',
    environmentId: 'environment-platform',
    environmentRevisionId: 'environment-revision-platform',
    allowRepositoryOverride: true,
    allowBaseBranchOverride: true,
    createdAt: '2026-07-13T08:00:00.000Z',
  },
  publishedRevision: {
    id: 'expert-revision-platform',
    expertId: 'expert-pr-author',
    revision: 7,
    status: 'published',
    model: 'relay-default',
    environmentId: 'environment-platform',
    environmentRevisionId: 'environment-revision-platform',
    allowRepositoryOverride: true,
    allowBaseBranchOverride: true,
    instructions: 'Inspect the repository, implement the change, and verify it.',
    createdAt: '2026-07-13T08:00:00.000Z',
  },
  version: 4,
  createdAt: '2026-07-13T07:00:00.000Z',
  updatedAt: '2026-07-13T08:00:00.000Z',
}

const defaultRepository = {
  repositoryId: 'repository-platform',
  repository: 'platform/checkout',
  baseBranch: 'main',
  isDefault: true as const,
}

const environmentDetail: EnvironmentDetailDto = {
  id: 'environment-platform',
  organizationId: 'relay',
  spaceId: 'platform',
  name: 'Platform runtime',
  description: 'Isolated runtime for platform repositories.',
  status: 'ready',
  activeRevisionId: 'environment-revision-platform',
  activeRevision: {
    id: 'environment-revision-platform',
    environmentId: 'environment-platform',
    revision: 2,
    status: 'ready',
    defaultRepository,
    repositoryBindings: [defaultRepository],
    createdAt: '2026-07-13T08:00:00.000Z',
  },
  version: 3,
  createdAt: '2026-07-13T07:00:00.000Z',
  updatedAt: '2026-07-13T08:00:00.000Z',
}

function testConfigurationCatalog(
  onListExperts?: (options: ConfigurationCatalogListOptions) => void,
): ConfigurationCatalogRepository {
  const expertSummary = {
    id: expertDetail.id,
    organizationId: expertDetail.organizationId,
    spaceId: expertDetail.spaceId,
    name: expertDetail.name,
    description: expertDetail.description,
    visibility: expertDetail.visibility,
    status: expertDetail.status,
    publishedRevisionId: expertDetail.publishedRevisionId,
    publishedRevisionSummary: expertDetail.publishedRevisionSummary,
    version: expertDetail.version,
    createdAt: expertDetail.createdAt,
    updatedAt: expertDetail.updatedAt,
  }
  const environmentSummary = {
    id: environmentDetail.id,
    organizationId: environmentDetail.organizationId,
    spaceId: environmentDetail.spaceId,
    name: environmentDetail.name,
    description: environmentDetail.description,
    status: environmentDetail.status,
    activeRevisionId: environmentDetail.activeRevisionId,
    activeRevision: environmentDetail.activeRevision && {
      id: environmentDetail.activeRevision.id,
      environmentId: environmentDetail.activeRevision.environmentId,
      revision: environmentDetail.activeRevision.revision,
      status: environmentDetail.activeRevision.status,
      defaultRepository: environmentDetail.activeRevision.defaultRepository,
      createdAt: environmentDetail.activeRevision.createdAt,
    },
    version: environmentDetail.version,
    createdAt: environmentDetail.createdAt,
    updatedAt: environmentDetail.updatedAt,
  }
  return {
    async listExperts(_organizationId, _spaceId, _actorId, options = {}) {
      onListExperts?.(options)
      return {
        items: [expertSummary],
        hasMore: true,
        nextCursor: { id: expertDetail.id, updatedAt: '2026-07-13T08:00:00.000000Z' },
      }
    },
    async getExpert() {
      return expertDetail
    },
    async listEnvironments() {
      return {
        items: [environmentSummary],
        hasMore: false,
        nextCursor: null,
      }
    },
    async getEnvironment() {
      return environmentDetail
    },
  }
}

function testRepository(options: InMemorySessionRepositoryOptions = {}) {
  return new InMemorySessionRepository({
    ...options,
    actorOrganizations: options.actorOrganizations ?? testActorOrganizations,
    authoritativeCatalog: options.authoritativeCatalog ?? testAuthoritativeCatalog,
  })
}

function testApp(
  repository = testRepository(),
  configurationCatalogRepository?: ConfigurationCatalogRepository,
) {
  const app = createApp({
    sessionRepository: repository,
    configurationCatalogRepository,
    authenticate: createDevelopmentAuthenticator('user-local-admin'),
    executionReadinessCheck: async () => true,
  })
  openApps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()))
})

describe('Relay API', () => {
  it('reports health', async () => {
    const app = createApp()
    openApps.push(app)
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('reports dependency readiness without changing the liveness signal', async () => {
    const app = createApp({
      authenticate: createDevelopmentAuthenticator('user-local-admin'),
      readinessCheck: async () => { throw new Error('database unavailable') },
    })
    openApps.push(app)

    const health = await app.inject({ method: 'GET', url: '/api/health' })
    const readiness = await app.inject({ method: 'GET', url: '/api/ready' })

    expect(health.statusCode).toBe(200)
    expect(readiness.statusCode).toBe(503)
    expect(ApiErrorSchema.parse(readiness.json())).toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE', retryable: true,
    })
  })

  it('keeps only health public and rejects unauthenticated requests before body parsing', async () => {
    const app = createApp()
    openApps.push(app)

    const health = await app.inject({ method: 'GET', url: '/api/health' })
    const sessions = await app.inject({
      method: 'GET', url: '/api/v1/organizations/relay/spaces/platform/sessions',
    })
    const experts = await app.inject({
      method: 'GET', url: '/api/v1/organizations/relay/spaces/platform/experts',
    })
    const me = await app.inject({ method: 'GET', url: '/api/v1/me' })
    const readiness = await app.inject({ method: 'GET', url: '/api/ready' })
    const unsupportedHealthMethod = await app.inject({ method: 'POST', url: '/api/health' })

    expect(health.statusCode).toBe(200)
    expect(sessions.statusCode).toBe(401)
    expect(sessions.headers['www-authenticate']).toBe('Bearer realm="relay-api"')
    expect(ApiErrorSchema.parse(sessions.json())).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED', retryable: false,
    })
    expect(experts.statusCode).toBe(401)
    expect(experts.headers['cache-control']).toBe('private, no-store')
    expect(experts.headers.vary).toBe('Authorization')
    expect(readiness.statusCode).toBe(401)
    expect(me.statusCode).toBe(401)
    expect(unsupportedHealthMethod.statusCode).toBe(401)

    const malformedBody = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'content-type': 'application/json' },
      payload: '{not-json',
    })
    expect(malformedBody.statusCode).toBe(401)
  })

  it('discovers the authenticated actor and only their explicitly seeded memberships', async () => {
    const repository = testRepository({
      actorOrganizations: {
        'user-local-admin': [
          {
            id: 'organization-a', name: 'Zeta', role: 'viewer',
            spaces: [{ id: 'space-a', name: 'Zeta Space', role: 'viewer' }],
          },
          {
            id: 'organization-z', name: 'Alpha', role: 'organization_admin',
            spaces: [
              { id: 'space-a', name: 'Zeta Space', role: 'member' },
              { id: 'space-z', name: 'Alpha Space', role: 'space_manager' },
            ],
          },
        ],
        'another-user': [{
          id: 'organization-hidden', name: 'Hidden', role: 'member', spaces: [],
        }],
      },
    })
    const response = await testApp(repository).inject({ method: 'GET', url: '/api/v1/me' })
    const body = MeResponseSchema.parse(response.json())

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(body).toEqual({
      actor: { id: 'user-local-admin', kind: 'user' },
      organizations: [
        {
          id: 'organization-z', name: 'Alpha', role: 'organization_admin',
          spaces: [
            { id: 'space-z', name: 'Alpha Space', role: 'space_manager' },
            { id: 'space-a', name: 'Zeta Space', role: 'member' },
          ],
        },
        {
          id: 'organization-a', name: 'Zeta', role: 'viewer',
          spaces: [{ id: 'space-a', name: 'Zeta Space', role: 'viewer' }],
        },
      ],
    })
  })

  it('returns an authenticated actor with no synthetic memberships', async () => {
    const response = await testApp(new InMemorySessionRepository()).inject({ method: 'GET', url: '/api/v1/me' })

    expect(response.statusCode).toBe(200)
    expect(MeResponseSchema.parse(response.json())).toEqual({
      actor: { id: 'user-local-admin', kind: 'user' },
      organizations: [],
    })
  })

  it('serves paginated Expert and Environment catalogs with canonical private headers', async () => {
    const listOptions: ConfigurationCatalogListOptions[] = []
    const app = testApp(testRepository(), testConfigurationCatalog((options) => listOptions.push(options)))
    const experts = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/relay/spaces/platform/experts?limit=1',
    })
    const expertList = ExpertListResponseSchema.parse(experts.json())

    expect(experts.statusCode).toBe(200)
    expect(experts.headers['cache-control']).toBe('private, no-store')
    expect(experts.headers.vary).toBe('Authorization')
    expect(expertList.items).toHaveLength(1)
    expect(expertList.page).toMatchObject({ hasMore: true })
    expect(expertList.page.nextCursor).toEqual(expect.any(String))
    expect(listOptions).toEqual([{ limit: 1 }])

    const nextPage = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/relay/spaces/platform/experts?limit=1&cursor=${encodeURIComponent(expertList.page.nextCursor!)}`,
    })
    expect(nextPage.statusCode).toBe(200)
    expect(listOptions[1]).toEqual({
      limit: 1,
      cursor: { id: expertDetail.id, updatedAt: '2026-07-13T08:00:00.000000Z' },
    })

    const expert = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/relay/spaces/platform/experts/${expertDetail.id}`,
    })
    expect(expert.statusCode).toBe(200)
    expect(expert.headers.etag).toBe('"4"')
    expect(ExpertDetailDtoSchema.parse(expert.json())).toEqual(expertDetail)

    const environments = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/relay/spaces/platform/environments',
    })
    const environment = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/relay/spaces/platform/environments/${environmentDetail.id}`,
    })
    expect(environments.statusCode).toBe(200)
    expect(EnvironmentListResponseSchema.parse(environments.json()).items).toHaveLength(1)
    expect(environment.statusCode).toBe(200)
    expect(environment.headers.etag).toBe('"3"')
    expect(EnvironmentDetailDtoSchema.parse(environment.json())).toEqual(environmentDetail)
  })

  it('rejects invalid or cross-resource catalog pagination before reading data', async () => {
    let reads = 0
    const repository = testConfigurationCatalog(() => { reads += 1 })
    const app = testApp(testRepository(), repository)
    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/relay/spaces/platform/experts?limit=1',
    })
    const cursor = ExpertListResponseSchema.parse(first.json()).page.nextCursor
    expect(cursor).toEqual(expect.any(String))

    const invalidLimit = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/relay/spaces/platform/experts?limit=101',
    })
    const crossResourceCursor = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/relay/spaces/platform/environments?cursor=${encodeURIComponent(cursor!)}`,
    })

    expect(invalidLimit.statusCode).toBe(400)
    expect(ApiErrorSchema.parse(invalidLimit.json())).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(crossResourceCursor.statusCode).toBe(400)
    expect(ApiErrorSchema.parse(crossResourceCursor.json())).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(reads).toBe(1)
  })

  it('conceals missing, hidden, and revoked catalog resources with the same 404 response', async () => {
    const repository: ConfigurationCatalogRepository = {
      ...testConfigurationCatalog(),
      async listExperts() { return null },
      async getExpert() { return null },
    }
    const app = testApp(testRepository(), repository)
    const revokedList = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/relay/spaces/platform/experts',
    })
    const hidden = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/relay/spaces/platform/experts/private-expert',
    })
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/relay/spaces/platform/experts/missing-expert',
    })

    expect(revokedList.statusCode).toBe(404)
    expect(hidden.statusCode).toBe(404)
    expect(missing.statusCode).toBe(404)
    expect(revokedList.json()).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: missing.json().message,
    })
    expect(hidden.json()).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: missing.json().message,
    })
  })

  it('denies service accounts until control-plane operation scopes are enforced', async () => {
    let reads = 0
    const catalog = testConfigurationCatalog(() => { reads += 1 })
    const app = createApp({
      sessionRepository: testRepository(),
      configurationCatalogRepository: catalog,
      authenticate: async () => ({ id: 'service-catalog-reader', kind: 'service_account' }),
    })
    openApps.push(app)
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/relay/spaces/platform/experts',
    })

    expect(response.statusCode).toBe(403)
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({
      code: 'PERMISSION_DENIED', retryable: false,
    })
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(reads).toBe(0)
  })

  it('denies service accounts without bindings before Session repository operations', async () => {
    const repository = testRepository({
      actorOrganizations: {
        'service-session-operator': [{
          id: 'relay', name: 'Relay', role: 'organization_admin',
          spaces: [{ id: 'platform', name: 'Platform', role: 'space_manager' }],
        }],
      },
    })
    const getSpaceAccess = vi.spyOn(repository, 'getSpaceAccess')
    const listBySpace = vi.spyOn(repository, 'listBySpace')
    const getById = vi.spyOn(repository, 'getById')
    const create = vi.spyOn(repository, 'create')
    const app = createApp({
      sessionRepository: repository,
      authenticate: async () => ({ id: 'service-session-operator', kind: 'service_account' }),
    })
    openApps.push(app)
    const url = '/api/v1/organizations/relay/spaces/platform/sessions'

    const [list, detail, createResponse] = await Promise.all([
      app.inject({ method: 'GET', url }),
      app.inject({ method: 'GET', url: `${url}/session-private` }),
      app.inject({
        method: 'POST',
        url,
        headers: { 'idempotency-key': 'service-account-create' },
        payload: sessionRequest,
      }),
    ])
    const errors = [list, detail, createResponse].map((response) => ApiErrorSchema.parse(response.json()))

    expect([list.statusCode, detail.statusCode, createResponse.statusCode]).toEqual([403, 403, 403])
    for (const error of errors) {
      expect(error).toMatchObject({ code: 'PERMISSION_DENIED', retryable: false })
    }
    expect(new Set(errors.map((error) => error.message))).toEqual(new Set([
      'The service account is not bound to this Session operation and resource.',
    ]))
    expect(getSpaceAccess).toHaveBeenCalled()
    expect(listBySpace).not.toHaveBeenCalled()
    expect(getById).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('fails closed for execution while still allowing Session drafts', async () => {
    const repository = testRepository({ createId: () => crypto.randomUUID() })
    const create = vi.spyOn(repository, 'create')
    const app = createApp({
      sessionRepository: repository,
      authenticate: createDevelopmentAuthenticator('user-local-admin'),
      executionEnabled: false,
    })
    openApps.push(app)
    const url = '/api/v1/organizations/relay/spaces/platform/sessions'
    const start = await app.inject({
      method: 'POST',
      url,
      headers: { 'idempotency-key': 'execution-disabled-start' },
      payload: sessionRequest,
    })

    expect(start.statusCode).toBe(503)
    expect(ApiErrorSchema.parse(start.json())).toMatchObject({
      code: 'EXECUTION_UNAVAILABLE', retryable: false,
    })
    expect(create).toHaveBeenCalledOnce()
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({
      executionAvailability: 'disabled',
    }))

    const draft = await app.inject({
      method: 'POST',
      url,
      headers: { 'idempotency-key': 'execution-disabled-draft' },
      payload: { ...sessionRequest, start: false },
    })
    expect(draft.statusCode).toBe(201)
    const savedDraft = CreateSessionResponseSchema.parse(draft.json()).session
    expect(savedDraft.status).toBe('draft')
    expect(create).toHaveBeenCalledTimes(2)

    const rejectedDraftStart = await app.inject({
      method: 'POST',
      url: `${url}/${savedDraft.id}/start`,
      headers: { 'idempotency-key': 'execution-disabled-existing-draft', 'if-match': '"1"' },
    })
    expect(rejectedDraftStart.statusCode).toBe(503)
    expect(ApiErrorSchema.parse(rejectedDraftStart.json())).toMatchObject({
      code: 'EXECUTION_UNAVAILABLE', retryable: false,
    })
    await expect(repository.getById('relay', 'platform', savedDraft.id, 'user-local-admin'))
      .resolves.toMatchObject({ status: 'draft', version: 1 })
  })

  it('gates execution on a recent Worker without disabling read-only API readiness', async () => {
    const repository = testRepository({ createId: () => crypto.randomUUID() })
    const create = vi.spyOn(repository, 'create')
    const executionReadinessCheck = vi.fn().mockResolvedValue(false)
    const app = createApp({
      sessionRepository: repository,
      authenticate: createDevelopmentAuthenticator('user-local-admin'),
      readinessCheck: async () => {},
      executionEnabled: true,
      executionReadinessCheck,
    })
    openApps.push(app)
    const url = '/api/v1/organizations/relay/spaces/platform/sessions'

    const [readiness, capabilities, start] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/ready' }),
      app.inject({ method: 'GET', url: '/api/v1/capabilities' }),
      app.inject({
        method: 'POST',
        url,
        headers: { 'idempotency-key': 'worker-unavailable-start' },
        payload: sessionRequest,
      }),
    ])

    expect(readiness.statusCode).toBe(200)
    expect(readiness.json()).toEqual({ status: 'ready' })
    expect(capabilities.json()).toEqual({ execution: { enabled: false, events: 'polling' } })
    expect(start.statusCode).toBe(503)
    expect(ApiErrorSchema.parse(start.json())).toMatchObject({
      code: 'EXECUTION_UNAVAILABLE', retryable: true,
    })
    expect(create).toHaveBeenCalledOnce()
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({
      executionAvailability: 'worker_unavailable',
    }))
    expect(executionReadinessCheck).toHaveBeenCalledTimes(2)
  })

  it('replays accepted execution requests after Worker or deployment availability changes', async () => {
    const repository = testRepository({ createId: () => crypto.randomUUID() })
    let workerReady = true
    const enabledApp = createApp({
      sessionRepository: repository,
      authenticate: createDevelopmentAuthenticator('user-local-admin'),
      executionEnabled: true,
      executionReadinessCheck: async () => workerReady,
    })
    const disabledApp = createApp({
      sessionRepository: repository,
      authenticate: createDevelopmentAuthenticator('user-local-admin'),
      executionEnabled: false,
    })
    openApps.push(enabledApp, disabledApp)
    const url = '/api/v1/organizations/relay/spaces/platform/sessions'
    const request = {
      method: 'POST' as const,
      url,
      headers: { 'idempotency-key': 'accepted-before-worker-loss' },
      payload: sessionRequest,
    }

    const accepted = await enabledApp.inject(request)
    workerReady = false
    const replayWithoutWorker = await enabledApp.inject(request)
    const replayWhileDisabled = await disabledApp.inject(request)
    const rejectedWithoutWorker = await enabledApp.inject({
      ...request,
      headers: { 'idempotency-key': 'new-after-worker-loss' },
    })
    const rejectedWhileDisabled = await disabledApp.inject({
      ...request,
      headers: { 'idempotency-key': 'new-while-disabled' },
    })

    expect(accepted.statusCode).toBe(201)
    expect(replayWithoutWorker.statusCode).toBe(201)
    expect(replayWithoutWorker.headers['idempotency-replayed']).toBe('true')
    expect(replayWhileDisabled.statusCode).toBe(201)
    expect(replayWhileDisabled.headers['idempotency-replayed']).toBe('true')
    expect(replayWithoutWorker.json()).toEqual(accepted.json())
    expect(replayWhileDisabled.json()).toEqual(accepted.json())
    expect(ApiErrorSchema.parse(rejectedWithoutWorker.json())).toMatchObject({
      code: 'EXECUTION_UNAVAILABLE', retryable: true,
    })
    expect(ApiErrorSchema.parse(rejectedWhileDisabled.json())).toMatchObject({
      code: 'EXECUTION_UNAVAILABLE', retryable: false,
    })
  })

  it('creates a Session with defaults from the shared contract', async () => {
    const repository = testRepository({
      createId: () => 'session-1',
      now: () => new Date('2026-07-12T08:00:00.000Z'),
    })
    const create = vi.spyOn(repository, 'create')
    const response = await testApp(repository).inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'create-session-1' },
      payload: {
        title: sessionRequest.title,
        expertId: sessionRequest.expertId,
        message: sessionRequest.message,
      },
    })
    const body = CreateSessionResponseSchema.parse(response.json())

    expect(response.statusCode).toBe(201)
    expect(response.headers['idempotency-replayed']).toBe('false')
    expect(response.headers.etag).toBe('"1"')
    expect(body.session).toMatchObject({
      id: 'session-1',
      organizationId: 'relay',
      spaceId: 'platform',
      status: 'queued',
      visibility: 'private',
      attachments: [],
      expertName: 'Authoritative PR Author',
      repository: 'platform/checkout',
      baseBranch: 'main',
      configurationResolutionVersion: 1,
      expertRevisionId: 'expert-revision-platform',
      environmentRevisionId: 'environment-revision-platform',
      repositoryId: 'repository-platform',
    })
    expect(body.message).toMatchObject({ sessionId: 'session-1', sequence: 1, role: 'user' })
    expect(body.turn).toMatchObject({ sessionId: 'session-1', ordinal: 1, status: 'queued' })
    expect(body.command).toMatchObject({ type: 'session.start', status: 'accepted' })
    expect(response.headers.location).toBe('/api/v1/organizations/relay/spaces/platform/sessions/session-1')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'user-local-admin',
      actorKind: 'user',
      requestId: expect.any(String),
    }))
  })

  it('persists the first message in a draft without creating execution records', async () => {
    const ids = ['session-draft', 'message-draft']
    const repository = testRepository({
      createId: () => ids.shift() ?? crypto.randomUUID(),
      now: () => new Date('2026-07-12T08:00:00.000Z'),
    })
    const response = await testApp(repository).inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'create-draft-1' },
      payload: { ...sessionRequest, start: false },
    })
    const body = CreateSessionResponseSchema.parse(response.json())

    expect(response.statusCode).toBe(201)
    expect(body.session).toMatchObject({ id: 'session-draft', status: 'draft' })
    expect(body.message).toMatchObject({
      id: 'message-draft',
      sessionId: 'session-draft',
      sequence: 1,
      role: 'user',
      content: sessionRequest.message.content,
    })
    expect(body.turn).toBeUndefined()
    expect(body.command).toBeUndefined()
  })

  it('starts a draft with its saved first Message and replays the accepted command', async () => {
    const ids = ['session-draft-start', 'message-draft-start', 'turn-draft-start', 'command-draft-start']
    const repository = testRepository({
      createId: () => ids.shift() ?? crypto.randomUUID(),
      now: () => new Date('2026-07-12T08:00:00.000Z'),
    })
    const app = testApp(repository)
    const collectionUrl = '/api/v1/organizations/relay/spaces/platform/sessions'
    const created = await app.inject({
      method: 'POST',
      url: collectionUrl,
      headers: { 'idempotency-key': 'create-draft-to-start' },
      payload: { ...sessionRequest, start: false },
    })
    const draft = CreateSessionResponseSchema.parse(created.json())
    const request = {
      method: 'POST' as const,
      url: `${collectionUrl}/${draft.session.id}/start`,
      headers: { 'idempotency-key': 'start-draft-1', 'if-match': '"1"' },
    }

    const started = await app.inject(request)
    const replay = await app.inject(request)
    const body = StartSessionResponseSchema.parse(started.json())

    expect(started.statusCode).toBe(202)
    expect(started.headers.etag).toBe('"2"')
    expect(started.headers['idempotency-replayed']).toBe('false')
    expect(body.session).toMatchObject({ id: draft.session.id, status: 'queued', version: 2 })
    expect(body.turn).toMatchObject({
      id: 'turn-draft-start', inputMessageId: draft.message?.id, status: 'queued', ordinal: 1,
    })
    expect(body.command).toMatchObject({
      id: 'command-draft-start', type: 'session.start', resourceId: body.turn.id,
    })
    expect(replay.statusCode).toBe(202)
    expect(replay.headers['idempotency-replayed']).toBe('true')
    expect(replay.json()).toEqual(started.json())
  })

  it('enforces start preconditions, an empty body, and draft-only transitions', async () => {
    const repository = testRepository()
    const app = testApp(repository)
    const collectionUrl = '/api/v1/organizations/relay/spaces/platform/sessions'
    const created = await app.inject({
      method: 'POST', url: collectionUrl,
      headers: { 'idempotency-key': 'create-draft-preconditions' },
      payload: { ...sessionRequest, start: false },
    })
    const draft = CreateSessionResponseSchema.parse(created.json()).session
    const url = `${collectionUrl}/${draft.id}/start`
    const missing = await app.inject({
      method: 'POST', url, headers: { 'idempotency-key': 'start-missing-precondition' },
    })
    const malformed = await app.inject({
      method: 'POST', url,
      headers: { 'idempotency-key': 'start-malformed-precondition', 'if-match': '*' },
    })
    const withBody = await app.inject({
      method: 'POST', url,
      headers: { 'idempotency-key': 'start-with-body', 'if-match': '"1"' },
      payload: {},
    })
    const stale = await app.inject({
      method: 'POST', url,
      headers: { 'idempotency-key': 'start-stale', 'if-match': '"2"' },
    })
    const started = await app.inject({
      method: 'POST', url,
      headers: { 'idempotency-key': 'start-current', 'if-match': '"1"' },
    })
    const repeatedTransition = await app.inject({
      method: 'POST', url,
      headers: { 'idempotency-key': 'start-again', 'if-match': '"2"' },
    })

    expect(ApiErrorSchema.parse(missing.json()).code).toBe('PRECONDITION_REQUIRED')
    expect(missing.statusCode).toBe(428)
    expect(ApiErrorSchema.parse(malformed.json()).code).toBe('VALIDATION_FAILED')
    expect(malformed.statusCode).toBe(400)
    expect(ApiErrorSchema.parse(withBody.json()).code).toBe('VALIDATION_FAILED')
    expect(withBody.statusCode).toBe(400)
    expect(ApiErrorSchema.parse(stale.json()).code).toBe('PRECONDITION_FAILED')
    expect(stale.statusCode).toBe(412)
    expect(started.statusCode).toBe(202)
    expect(ApiErrorSchema.parse(repeatedTransition.json()).code).toBe('SESSION_STATE_CONFLICT')
    expect(repeatedTransition.statusCode).toBe(409)
  })

  it('queues consecutive follow-up Messages with stable idempotent FIFO records', async () => {
    const repository = testRepository()
    const app = testApp(repository)
    const collectionUrl = '/api/v1/organizations/relay/spaces/platform/sessions'
    const created = await app.inject({
      method: 'POST', url: collectionUrl,
      headers: { 'idempotency-key': 'create-follow-up-session' },
      payload: sessionRequest,
    })
    const session = CreateSessionResponseSchema.parse(created.json()).session
    const url = `${collectionUrl}/${session.id}/messages`
    const firstRequest = {
      method: 'POST' as const,
      url,
      headers: { 'idempotency-key': 'follow-up-1' },
      payload: { content: 'Queue the first follow-up.', attachments: [] },
    }
    const first = await app.inject(firstRequest)
    const second = await app.inject({
      method: 'POST', url,
      headers: { 'idempotency-key': 'follow-up-2' },
      payload: { content: 'Queue the second follow-up.', attachments: [] },
    })
    const replay = await app.inject(firstRequest)
    const firstBody = SendSessionMessageResponseSchema.parse(first.json())
    const secondBody = SendSessionMessageResponseSchema.parse(second.json())

    expect(first.statusCode).toBe(202)
    expect(first.headers.etag).toBe('"2"')
    expect(firstBody).toMatchObject({
      session: { status: 'queued', version: 2 },
      message: { sequence: 2, content: 'Queue the first follow-up.' },
      turn: { ordinal: 2, status: 'queued' },
      command: { type: 'session.send', status: 'accepted' },
    })
    expect(secondBody).toMatchObject({
      session: { status: 'queued', version: 3 },
      message: { sequence: 3, content: 'Queue the second follow-up.' },
      turn: { ordinal: 3, status: 'queued' },
      command: { type: 'session.send', status: 'accepted' },
    })
    expect(replay.statusCode).toBe(202)
    expect(replay.headers['idempotency-replayed']).toBe('true')
    expect(replay.json()).toEqual(first.json())
  })

  it('rejects follow-up Messages for drafts and while execution is unavailable', async () => {
    const repository = testRepository()
    const disabled = createApp({
      sessionRepository: repository,
      authenticate: createDevelopmentAuthenticator('user-local-admin'),
      executionEnabled: false,
    })
    openApps.push(disabled)
    const collectionUrl = '/api/v1/organizations/relay/spaces/platform/sessions'
    const draftResponse = await disabled.inject({
      method: 'POST', url: collectionUrl,
      headers: { 'idempotency-key': 'create-send-draft' },
      payload: { ...sessionRequest, start: false },
    })
    const draft = CreateSessionResponseSchema.parse(draftResponse.json()).session
    const draftSend = await disabled.inject({
      method: 'POST', url: `${collectionUrl}/${draft.id}/messages`,
      headers: { 'idempotency-key': 'send-to-draft' },
      payload: { content: 'This draft must be started first.' },
    })
    expect(draftSend.statusCode).toBe(409)
    expect(ApiErrorSchema.parse(draftSend.json())).toMatchObject({
      code: 'SESSION_STATE_CONFLICT', details: { status: 'draft' },
    })

    const enabled = testApp(repository)
    const created = await enabled.inject({
      method: 'POST', url: collectionUrl,
      headers: { 'idempotency-key': 'create-send-disabled' },
      payload: sessionRequest,
    })
    const queued = CreateSessionResponseSchema.parse(created.json()).session
    const unavailable = await disabled.inject({
      method: 'POST', url: `${collectionUrl}/${queued.id}/messages`,
      headers: { 'idempotency-key': 'send-while-disabled' },
      payload: { content: 'Do not persist a partial follow-up.' },
    })
    expect(unavailable.statusCode).toBe(503)
    expect(ApiErrorSchema.parse(unavailable.json()).code).toBe('EXECUTION_UNAVAILABLE')
    await expect(repository.getById('relay', 'platform', queued.id, 'user-local-admin'))
      .resolves.toMatchObject({ version: 1 })
  })

  it('creates a Session for an actor at the OIDC subject length boundary', async () => {
    const actorId = `user-${'a'.repeat(251)}`
    const repository = testRepository({
      actorOrganizations: { [actorId]: testActorOrganizations['user-local-admin'] },
    })
    const app = createApp({
      sessionRepository: repository,
      authenticate: createDevelopmentAuthenticator(actorId),
    })
    openApps.push(app)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'long-actor-subject' },
      payload: { ...sessionRequest, start: false },
    })

    expect(response.statusCode).toBe(201)
    expect(CreateSessionResponseSchema.parse(response.json()).message?.actorId).toBe(actorId)
  })

  it('fails closed without an authoritative catalog and ignores forged compatibility metadata', async () => {
    const failClosed = new InMemorySessionRepository({ actorOrganizations: testActorOrganizations })
    await expect(failClosed.create({
      organizationId: 'relay',
      spaceId: 'platform',
      actorId: 'user-local-admin',
      actorKind: 'user',
      requestId: 'request-fail-closed',
      idempotencyKey: 'fail-closed',
      request: CreateSessionRequestSchema.parse(sessionRequest),
    })).rejects.toBeInstanceOf(SessionConfigurationNotFoundError)

    const repository = testRepository({ createId: () => crypto.randomUUID() })
    const response = await testApp(repository).inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'authoritative-resolution' },
      payload: {
        ...sessionRequest,
        expertName: 'Forged Expert',
        expertVersion: 999,
        environmentId: 'forged-environment',
        repository: 'platform/secondary',
        advancedOverrides: { repositoryId: 'repository-platform' },
      },
    })
    const session = CreateSessionResponseSchema.parse(response.json()).session

    expect(response.statusCode).toBe(201)
    expect(session).toMatchObject({
      expertName: 'Authoritative PR Author',
      expertVersion: 7,
      environmentId: 'environment-platform',
      repository: 'platform/checkout',
      baseBranch: 'main',
      configurationResolutionVersion: 1,
      expertRevisionId: 'expert-revision-platform',
      environmentRevisionId: 'environment-revision-platform',
      repositoryId: 'repository-platform',
    })
  })

  it('marks the explicitly enabled legacy development fallback as non-authoritative', async () => {
    const repository = new InMemorySessionRepository({
      actorOrganizations: testActorOrganizations,
      allowLegacyDevelopmentConfigurationFallback: true,
      createId: () => crypto.randomUUID(),
    })
    const response = await testApp(repository).inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'legacy-development-fallback' },
      payload: sessionRequest,
    })
    const session = CreateSessionResponseSchema.parse(response.json()).session

    expect(response.statusCode).toBe(201)
    expect(session.configurationResolutionVersion).toBe(0)
    expect(session).not.toHaveProperty('expertRevisionId')
    expect(session).not.toHaveProperty('environmentRevisionId')
    expect(session).not.toHaveProperty('repositoryId')
  })

  it('maps unavailable authoritative configuration states without creating a Session', async () => {
    const disabledExpertRepository = testRepository({
      authoritativeCatalog: [catalogEntry('relay', 'platform', { status: 'disabled' })],
    })
    const notReadyEntry = catalogEntry('relay', 'platform')
    if (!notReadyEntry.publishedRevision) throw new Error('Expected a published test revision.')
    notReadyEntry.publishedRevision.environment.status = 'disabled'
    const notReadyRepository = testRepository({ authoritativeCatalog: [notReadyEntry] })
    const unknownRepository = testRepository()

    const disabledExpert = await testApp(disabledExpertRepository).inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'disabled-expert' },
      payload: sessionRequest,
    })
    const notReadyEnvironment = await testApp(notReadyRepository).inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'not-ready-environment' },
      payload: sessionRequest,
    })
    const unknownExpert = await testApp(unknownRepository).inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'unknown-expert' },
      payload: { ...sessionRequest, expertId: 'unknown-expert' },
    })

    expect(disabledExpert.statusCode).toBe(422)
    expect(ApiErrorSchema.parse(disabledExpert.json()).code).toBe('EXPERT_NOT_PUBLISHED')
    expect(notReadyEnvironment.statusCode).toBe(422)
    expect(ApiErrorSchema.parse(notReadyEnvironment.json()).code).toBe('ENVIRONMENT_NOT_READY')
    expect(unknownExpert.statusCode).toBe(404)
    expect(ApiErrorSchema.parse(unknownExpert.json()).code).toBe('RESOURCE_NOT_FOUND')
    await expect(disabledExpertRepository.listBySpace('relay', 'platform', 'user-local-admin'))
      .resolves.toMatchObject({ items: [], hasMore: false })
    await expect(notReadyRepository.listBySpace('relay', 'platform', 'user-local-admin'))
      .resolves.toMatchObject({ items: [], hasMore: false })
  })

  it('conceals a private Expert from another Space member as not found', async () => {
    const privateExpert = catalogEntry('relay', 'platform', {
      visibility: 'private',
      createdBy: 'user-expert-owner',
    })
    const app = testApp(testRepository({ authoritativeCatalog: [privateExpert] }))
    const privateResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'private-expert' },
      payload: sessionRequest,
    })
    const missingResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'missing-expert' },
      payload: { ...sessionRequest, expertId: 'missing-expert' },
    })

    expect(privateResponse.statusCode).toBe(404)
    expect(missingResponse.statusCode).toBe(404)
    expect(privateResponse.json()).toMatchObject({
      code: 'RESOURCE_NOT_FOUND', message: missingResponse.json().message,
    })
  })

  it('rejects conflicting or forbidden advanced overrides as domain validation errors', async () => {
    const conflictingBranches = await testApp().inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'conflicting-branches' },
      payload: {
        ...sessionRequest,
        advancedOverrides: { repositoryId: 'repository-platform', baseBranch: 'release' },
      },
    })
    const lockedEntry = catalogEntry('relay', 'platform')
    if (!lockedEntry.publishedRevision) throw new Error('Expected a published test revision.')
    lockedEntry.publishedRevision.allowRepositoryOverride = false
    const forbiddenRepository = await testApp(testRepository({
      authoritativeCatalog: [lockedEntry],
    })).inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'forbidden-repository' },
      payload: {
        ...sessionRequest,
        advancedOverrides: { repositoryId: 'repository-platform-secondary' },
      },
    })
    const conflictError = ApiErrorSchema.parse(conflictingBranches.json())
    const policyError = ApiErrorSchema.parse(forbiddenRepository.json())

    expect(conflictingBranches.statusCode).toBe(422)
    expect(conflictError.code).toBe('VALIDATION_FAILED')
    expect(conflictError.fieldErrors?.['advancedOverrides.baseBranch']).toBeDefined()
    expect(forbiddenRepository.statusCode).toBe(422)
    expect(policyError.code).toBe('VALIDATION_FAILED')
    expect(policyError.fieldErrors?.['advancedOverrides.repositoryId']).toBeDefined()
  })

  it('returns canonical Session detail headers and conceals private Sessions from other members', async () => {
    const actorOrganizations = {
      ...testActorOrganizations,
      'user-space-member': [{
        id: 'relay', name: 'Relay', role: 'member' as const,
        spaces: [{ id: 'platform', name: 'Platform', role: 'member' as const }],
      }],
    }
    const repository = testRepository({ actorOrganizations })
    const created = await repository.create({
      organizationId: 'relay',
      spaceId: 'platform',
      actorId: 'user-local-admin',
      actorKind: 'user',
      requestId: 'request-private-detail',
      idempotencyKey: 'private-detail',
      request: CreateSessionRequestSchema.parse(sessionRequest),
    })
    const creatorApp = testApp(repository)
    const memberApp = createApp({
      sessionRepository: repository,
      authenticate: createDevelopmentAuthenticator('user-space-member'),
    })
    openApps.push(memberApp)
    const detailUrl = `/api/v1/organizations/relay/spaces/platform/sessions/${created.session.id}`
    const detail = await creatorApp.inject({ method: 'GET', url: detailUrl })
    const hidden = await memberApp.inject({ method: 'GET', url: detailUrl })
    const missing = await creatorApp.inject({
      method: 'GET',
      url: '/api/v1/organizations/relay/spaces/platform/sessions/missing-session',
    })

    expect(detail.statusCode).toBe(200)
    expect(SessionDtoSchema.parse(detail.json())).toEqual(created.session)
    expect(detail.headers.etag).toBe('"1"')
    expect(detail.headers['cache-control']).toBe('private, no-store')
    expect(detail.headers.vary).toBe('Authorization')
    expect(hidden.statusCode).toBe(404)
    expect(missing.statusCode).toBe(404)
    expect(hidden.json()).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: missing.json().message,
    })
  })

  it('caps Space write access at the Organization role', async () => {
    const repository = testRepository({
      actorOrganizations: {
        'user-local-admin': [{
          id: 'relay', name: 'Relay', role: 'viewer',
          spaces: [{ id: 'platform', name: 'Platform', role: 'space_manager' }],
        }],
      },
    })
    const response = await testApp(repository).inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'organization-viewer-create' },
      payload: sessionRequest,
    })

    expect(response.statusCode).toBe(403)
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({
      code: 'PERMISSION_DENIED', retryable: false,
    })
    await expect(repository.create({
      organizationId: 'relay',
      spaceId: 'platform',
      actorId: 'user-local-admin',
      actorKind: 'user',
      requestId: 'request-organization-viewer',
      idempotencyKey: 'repository-organization-viewer-create',
      request: CreateSessionRequestSchema.parse(sessionRequest),
    })).rejects.toBeInstanceOf(AuthorizationChangedError)
  })

  it('lists Sessions only from the requested organization and Space', async () => {
    const repository = testRepository({ createId: () => crypto.randomUUID() })
    const normalizedRequest = {
      ...sessionRequest,
      start: true,
      visibility: 'private' as const,
      message: { ...sessionRequest.message, attachments: [] },
    }
    await repository.create({ organizationId: 'relay', spaceId: 'platform', actorId: 'user-local-admin', actorKind: 'user', requestId: 'request-platform-1', idempotencyKey: 'platform-1', request: normalizedRequest })
    await repository.create({ organizationId: 'other', spaceId: 'platform', actorId: 'user-local-admin', actorKind: 'user', requestId: 'request-other-1', idempotencyKey: 'other-1', request: normalizedRequest })

    const response = await testApp(repository).inject({
      method: 'GET',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
    })
    const body = SessionListResponseSchema.parse(response.json())

    expect(response.statusCode).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ organizationId: 'relay', spaceId: 'platform' })
    expect(body.page.hasMore).toBe(false)
  })

  it('paginates filtered Session lists with scope-bound cursors', async () => {
    let sequence = 0
    const repository = testRepository({
      createId: () => `runtime-${String(++sequence).padStart(4, '0')}`,
      now: () => new Date('2026-07-13T08:00:00.123Z'),
    })
    for (const [idempotencyKey, title] of [
      ['page-1', 'Checkout alpha'],
      ['page-2', 'Checkout beta'],
      ['page-3', 'Unrelated work'],
    ] as const) {
      await repository.create({
        organizationId: 'relay', spaceId: 'platform', actorId: 'user-local-admin',
        actorKind: 'user', requestId: idempotencyKey, idempotencyKey,
        request: {
          ...sessionRequest,
          title,
          visibility: 'private',
          start: true,
          message: { ...sessionRequest.message, attachments: [] },
        },
      })
    }
    const app = testApp(repository)
    const firstResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/relay/spaces/platform/sessions?limit=1&search=Checkout',
    })
    const first = SessionListResponseSchema.parse(firstResponse.json())

    expect(firstResponse.statusCode).toBe(200)
    expect(first.items).toHaveLength(1)
    expect(first.page).toMatchObject({ hasMore: true })
    expect(first.page.nextCursor).toEqual(expect.any(String))

    const secondResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/relay/spaces/platform/sessions?limit=1&search=Checkout&cursor=${first.page.nextCursor}`,
    })
    const second = SessionListResponseSchema.parse(secondResponse.json())
    expect(secondResponse.statusCode).toBe(200)
    expect(second.items).toHaveLength(1)
    expect(second.items[0].id).not.toBe(first.items[0].id)
    expect(second.page).toMatchObject({ hasMore: true })

    const thirdResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/relay/spaces/platform/sessions?limit=1&search=Checkout&cursor=${second.page.nextCursor}`,
    })
    const third = SessionListResponseSchema.parse(thirdResponse.json())
    expect(thirdResponse.statusCode).toBe(200)
    expect(third.items).toHaveLength(1)
    expect(new Set([first.items[0].id, second.items[0].id, third.items[0].id]).size).toBe(3)
    expect(third.page).toMatchObject({ hasMore: false, nextCursor: null })

    const crossFilter = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/relay/spaces/platform/sessions?limit=1&search=Checkout&status=queued&cursor=${first.page.nextCursor}`,
    })
    const crossTenant = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/other/spaces/platform/sessions?limit=1&search=Checkout&cursor=${first.page.nextCursor}`,
    })
    const invalidLimit = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/relay/spaces/platform/sessions?limit=0',
    })

    expect(crossFilter.statusCode).toBe(400)
    expect(crossTenant.statusCode).toBe(400)
    expect(invalidLimit.statusCode).toBe(400)
    expect(ApiErrorSchema.parse(invalidLimit.json()).fieldErrors).toHaveProperty('query.limit')
  })

  it('renames a Session with strong CAS without changing activity ordering', async () => {
    const app = testApp()
    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'rename-source' },
      payload: sessionRequest,
    })
    const created = CreateSessionResponseSchema.parse(createdResponse.json()).session
    const url = `/api/v1/organizations/relay/spaces/platform/sessions/${created.id}`

    const missingPrecondition = await app.inject({ method: 'PATCH', url, payload: { title: 'Renamed' } })
    expect(missingPrecondition.statusCode).toBe(428)

    const renamedResponse = await app.inject({
      method: 'PATCH', url, headers: { 'if-match': '"1"' }, payload: { title: '  Renamed Session  ' },
    })
    const renamed = SessionDtoSchema.parse(renamedResponse.json())
    expect(renamedResponse.statusCode).toBe(200)
    expect(renamedResponse.headers.etag).toBe('"2"')
    expect(renamed).toMatchObject({ title: 'Renamed Session', version: 2 })
    expect(renamed.lastActivityAt).toBe(created.lastActivityAt)

    const noOpResponse = await app.inject({
      method: 'PATCH', url, headers: { 'if-match': '"2"' }, payload: { title: 'Renamed Session' },
    })
    expect(SessionDtoSchema.parse(noOpResponse.json())).toMatchObject({ title: 'Renamed Session', version: 2 })
    const staleResponse = await app.inject({
      method: 'PATCH', url, headers: { 'if-match': '"1"' }, payload: { title: 'Stale write' },
    })
    expect(staleResponse.statusCode).toBe(412)
    expect(ApiErrorSchema.parse(staleResponse.json()).code).toBe('PRECONDITION_FAILED')

    const invalidResponse = await app.inject({
      method: 'PATCH', url, headers: { 'if-match': '"2"' }, payload: { title: 'Valid', pinned: true },
    })
    expect(invalidResponse.statusCode).toBe(400)
  })

  it('archives and restores a Session idempotently without changing execution state', async () => {
    const app = testApp()
    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'archive-source' },
      payload: sessionRequest,
    })
    const created = CreateSessionResponseSchema.parse(createdResponse.json()).session
    const baseUrl = `/api/v1/organizations/relay/spaces/platform/sessions/${created.id}`
    const archiveRequest = {
      method: 'POST' as const,
      url: `${baseUrl}/archive`,
      headers: { 'idempotency-key': 'archive-1', 'if-match': '"1"' },
    }
    const archivedResponse = await app.inject(archiveRequest)
    const archived = SessionDtoSchema.parse(archivedResponse.json())

    expect(archivedResponse.statusCode).toBe(200)
    expect(archivedResponse.headers.etag).toBe('"2"')
    expect(archivedResponse.headers['idempotency-replayed']).toBe('false')
    expect(archived).toMatchObject({ status: created.status, version: 2 })
    expect(archived.archivedAt).toEqual(expect.any(String))
    expect(archived.lastActivityAt).toBe(created.lastActivityAt)

    const replay = await app.inject(archiveRequest)
    expect(replay.headers['idempotency-replayed']).toBe('true')
    expect(replay.json()).toEqual(archivedResponse.json())
    const conflict = await app.inject({
      ...archiveRequest,
      headers: { ...archiveRequest.headers, 'if-match': '"2"' },
    })
    expect(conflict.statusCode).toBe(409)

    const activeList = SessionListResponseSchema.parse((await app.inject({
      method: 'GET', url: '/api/v1/organizations/relay/spaces/platform/sessions',
    })).json())
    const archivedList = SessionListResponseSchema.parse((await app.inject({
      method: 'GET', url: '/api/v1/organizations/relay/spaces/platform/sessions?archived=true',
    })).json())
    expect(activeList.items).toHaveLength(0)
    expect(archivedList.items.map((session) => session.id)).toEqual([created.id])

    const restoredResponse = await app.inject({
      method: 'POST',
      url: `${baseUrl}/restore`,
      headers: { 'idempotency-key': 'restore-1', 'if-match': '"2"' },
    })
    const restored = SessionDtoSchema.parse(restoredResponse.json())
    expect(restored).toMatchObject({ archivedAt: null, status: created.status, version: 3 })
    expect(restored.lastActivityAt).toBe(created.lastActivityAt)

    const noOpRestore = await app.inject({
      method: 'POST',
      url: `${baseUrl}/restore`,
      headers: { 'idempotency-key': 'restore-2', 'if-match': '"3"' },
    })
    expect(SessionDtoSchema.parse(noOpRestore.json())).toMatchObject({ archivedAt: null, version: 3 })
  })

  it('pauses, resumes, and cancels a Session with strong CAS and idempotent replay', async () => {
    const app = testApp()
    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'control-source' },
      payload: sessionRequest,
    })
    const created = CreateSessionResponseSchema.parse(createdResponse.json()).session
    const baseUrl = `/api/v1/organizations/relay/spaces/platform/sessions/${created.id}`

    expect((await app.inject({ method: 'POST', url: `${baseUrl}/pause` })).statusCode).toBe(400)
    expect((await app.inject({
      method: 'POST', url: `${baseUrl}/pause`, headers: { 'idempotency-key': 'pause-missing-cas' },
    })).statusCode).toBe(428)
    expect((await app.inject({
      method: 'POST',
      url: `${baseUrl}/pause`,
      headers: { 'idempotency-key': 'pause-body', 'if-match': '"1"' },
      payload: {},
    })).statusCode).toBe(400)

    const pauseRequest = {
      method: 'POST' as const,
      url: `${baseUrl}/pause`,
      headers: { 'idempotency-key': 'pause-1', 'if-match': '"1"' },
    }
    const pausedResponse = await app.inject(pauseRequest)
    expect(pausedResponse.statusCode, pausedResponse.body).toBe(202)
    const paused = SessionControlResponseSchema.parse(pausedResponse.json())
    expect(pausedResponse.headers.etag).toBe('"2"')
    expect(pausedResponse.headers['idempotency-replayed']).toBe('false')
    expect(paused).toMatchObject({
      session: { id: created.id, status: 'paused', version: 2 },
      command: { type: 'session.pause', status: 'succeeded', resourceId: created.id },
    })
    const pauseReplay = await app.inject(pauseRequest)
    expect(pauseReplay.headers['idempotency-replayed']).toBe('true')
    expect(pauseReplay.json()).toEqual(pausedResponse.json())

    const resumedResponse = await app.inject({
      method: 'POST',
      url: `${baseUrl}/resume`,
      headers: { 'idempotency-key': 'resume-1', 'if-match': '"2"' },
    })
    expect(SessionControlResponseSchema.parse(resumedResponse.json())).toMatchObject({
      session: { status: 'queued', version: 3 },
      command: { type: 'session.resume', status: 'succeeded' },
    })

    const canceledResponse = await app.inject({
      method: 'POST',
      url: `${baseUrl}/cancel`,
      headers: { 'idempotency-key': 'cancel-1', 'if-match': '"3"' },
      payload: { reason: 'Operator requested cancellation.' },
    })
    expect(SessionControlResponseSchema.parse(canceledResponse.json())).toMatchObject({
      session: { status: 'canceled', version: 4 },
      command: { type: 'session.cancel', status: 'succeeded' },
    })

    const invalidResume = await app.inject({
      method: 'POST',
      url: `${baseUrl}/resume`,
      headers: { 'idempotency-key': 'resume-canceled', 'if-match': '"4"' },
    })
    expect(invalidResume.statusCode).toBe(409)
    expect(ApiErrorSchema.parse(invalidResume.json())).toMatchObject({
      code: 'SESSION_STATE_CONFLICT', details: { status: 'canceled', operation: 'resume' },
    })
  })

  it('returns the queued Attempt when retrying a failed Turn', async () => {
    const repository = testRepository()
    const app = testApp(repository)
    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'retry-source' },
      payload: sessionRequest,
    })
    const created = CreateSessionResponseSchema.parse(createdResponse.json()).session
    const failedSession = SessionDtoSchema.parse({
      ...created,
      status: 'failed',
      version: 2,
      updatedAt: '2026-07-13T09:00:00.000Z',
      lastActivityAt: '2026-07-13T09:00:00.000Z',
    })
    const turnId = 'turn-failed'
    const result = RetryTurnResponseSchema.parse({
      session: { ...failedSession, status: 'queued', version: 3 },
      attempt: {
        organizationId: failedSession.organizationId,
        spaceId: failedSession.spaceId,
        sessionId: failedSession.id,
        id: 'attempt-retry-2',
        turnId,
        number: 2,
        status: 'queued',
        model: 'relay-default',
        providerModel: null,
        runtimeId: null,
        failureCode: null,
        createdAt: failedSession.updatedAt,
        startedAt: null,
        finishedAt: null,
      },
      command: {
        id: 'command-retry-2',
        type: 'turn.retry',
        status: 'queued',
        resourceType: 'turn',
        resourceId: turnId,
        acceptedAt: failedSession.updatedAt,
      },
    })
    const retryTurn = vi.spyOn(repository, 'retryTurn').mockResolvedValue({ ...result, replayed: false })
    const url = `/api/v1/organizations/relay/spaces/platform/sessions/${created.id}/turns/${turnId}/retry`

    const response = await app.inject({
      method: 'POST',
      url,
      headers: { 'idempotency-key': 'retry-1', 'if-match': '"2"' },
    })
    expect(response.statusCode, response.body).toBe(202)
    expect(response.headers.etag).toBe('"3"')
    expect(RetryTurnResponseSchema.parse(response.json())).toEqual(result)
    expect(retryTurn).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: created.id, turnId, expectedVersion: 2, idempotencyKey: 'retry-1',
    }))

    const invalidBody = await app.inject({
      method: 'POST',
      url,
      headers: { 'idempotency-key': 'retry-body', 'if-match': '"2"' },
      payload: {},
    })
    expect(invalidBody.statusCode).toBe(400)
  })

  it('returns a contract-shaped error for invalid input', async () => {
    const response = await testApp().inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'invalid-session' },
      payload: { ...sessionRequest, message: { content: '' } },
    })
    const error = ApiErrorSchema.parse(response.json())

    expect(response.statusCode).toBe(400)
    expect(error).toMatchObject({ code: 'VALIDATION_FAILED', retryable: false })
    expect(error.fieldErrors?.['message.content']).toBeDefined()
  })

  it('requires Idempotency-Key and replays the same Session per organization and Space', async () => {
    const repository = testRepository()
    const app = testApp(repository)
    const url = '/api/v1/organizations/relay/spaces/platform/sessions'
    const withoutKey = await app.inject({ method: 'POST', url, payload: sessionRequest })

    expect(withoutKey.statusCode).toBe(400)
    expect(ApiErrorSchema.parse(withoutKey.json()).code).toBe('IDEMPOTENCY_KEY_REQUIRED')

    const request = { method: 'POST' as const, url, headers: { 'idempotency-key': 'same-command' }, payload: sessionRequest }
    const first = await app.inject(request)
    const replay = await app.inject(request)
    const sessions = await repository.listBySpace('relay', 'platform', 'user-local-admin')

    expect(first.statusCode).toBe(201)
    expect(replay.statusCode).toBe(201)
    expect(replay.headers['idempotency-replayed']).toBe('true')
    expect(first.headers.etag).toBe('"1"')
    expect(replay.headers.etag).toBe('"1"')
    expect(replay.json()).toEqual(first.json())
    expect(sessions.items).toHaveLength(1)

    const conflictingReplay = await app.inject({
      ...request,
      payload: { ...sessionRequest, title: 'A different command' },
    })
    const conflict = ApiErrorSchema.parse(conflictingReplay.json())

    expect(conflictingReplay.statusCode).toBe(409)
    expect(conflict).toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      retryable: false,
    })
    expect((await repository.listBySpace('relay', 'platform', 'user-local-admin')).items).toHaveLength(1)

    const otherSpace = await app.inject({
      ...request,
      url: '/api/v1/organizations/relay/spaces/commerce/sessions',
      payload: { ...sessionRequest, repository: 'commerce/checkout' },
    })

    expect(otherSpace.statusCode).toBe(201)
    expect(otherSpace.headers['idempotency-replayed']).toBe('false')
    expect((await repository.listBySpace('relay', 'commerce', 'user-local-admin')).items).toHaveLength(1)
  })
})
