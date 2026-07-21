import type {
  CreateExpertRequest,
  EnvironmentDetailDto,
  EnvironmentSummaryDto,
  ExpertDetailDto,
  ExpertSummaryDto,
  ExpertDraftRevisionDto,
  ExpertPublishedRevisionDto,
  UpdateExpertRequest,
} from '@relay/contracts'

export type ConfigurationCatalogCursor = {
  updatedAt: string
  id: string
}

export type ConfigurationCatalogListOptions = {
  limit?: number
  cursor?: ConfigurationCatalogCursor
}

export type ConfigurationCatalogPage<T> = {
  items: T[]
  hasMore: boolean
  nextCursor: ConfigurationCatalogCursor | null
}

export type CreateExpertRecord = {
  organizationId: string
  spaceId: string
  actorId: string
  idempotencyKey: string
  request: CreateExpertRequest
}

export type UpdateExpertRecord = {
  organizationId: string
  spaceId: string
  expertId: string
  actorId: string
  expectedVersion: number
  request: UpdateExpertRequest
}

export type ExpertVersionMutationRecord = Omit<UpdateExpertRecord, 'request'> & {
  idempotencyKey?: string
}

export type ExpertMutationResult = {
  expert: ExpertDetailDto
  replayed: boolean
}

export interface ConfigurationCatalogRepository {
  hasRepositoryAccess(
    organizationId: string,
    spaceId: string,
    actorId: string,
    repository: string,
  ): Promise<boolean>
  listExperts(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options?: ConfigurationCatalogListOptions,
  ): Promise<ConfigurationCatalogPage<ExpertSummaryDto> | null>
  getExpert(
    organizationId: string,
    spaceId: string,
    expertId: string,
    actorId: string,
  ): Promise<ExpertDetailDto | null>
  createExpert(record: CreateExpertRecord): Promise<ExpertMutationResult>
  updateExpert(record: UpdateExpertRecord): Promise<ExpertDetailDto | null>
  publishExpert(record: ExpertVersionMutationRecord & { idempotencyKey: string }): Promise<ExpertMutationResult | null>
  disableExpert(record: ExpertVersionMutationRecord): Promise<ExpertDetailDto | null>
  archiveExpert(record: ExpertVersionMutationRecord): Promise<ExpertDetailDto | null>
  listExpertRevisions(
    organizationId: string,
    spaceId: string,
    expertId: string,
    actorId: string,
  ): Promise<Array<ExpertDraftRevisionDto | ExpertPublishedRevisionDto> | null>
  listEnvironments(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options?: ConfigurationCatalogListOptions,
  ): Promise<ConfigurationCatalogPage<EnvironmentSummaryDto> | null>
  getEnvironment(
    organizationId: string,
    spaceId: string,
    environmentId: string,
    actorId: string,
  ): Promise<EnvironmentDetailDto | null>
}

function emptyPage<T>(): ConfigurationCatalogPage<T> {
  return { items: [], hasMore: false, nextCursor: null }
}

export class EmptyConfigurationCatalogRepository implements ConfigurationCatalogRepository {
  hasRepositoryAccess(
    ...arguments_: Parameters<ConfigurationCatalogRepository['hasRepositoryAccess']>
  ): Promise<boolean> {
    void arguments_
    return Promise.resolve(false)
  }

  listExperts(
    ...arguments_: Parameters<ConfigurationCatalogRepository['listExperts']>
  ): Promise<ConfigurationCatalogPage<ExpertSummaryDto>> {
    void arguments_
    return Promise.resolve(emptyPage())
  }

  getExpert(...arguments_: Parameters<ConfigurationCatalogRepository['getExpert']>): Promise<null> {
    void arguments_
    return Promise.resolve(null)
  }

  createExpert(...arguments_: Parameters<ConfigurationCatalogRepository['createExpert']>): Promise<ExpertMutationResult> {
    void arguments_
    return Promise.reject(new Error('Expert mutations require a database-backed Catalog repository.'))
  }

  updateExpert(...arguments_: Parameters<ConfigurationCatalogRepository['updateExpert']>): Promise<null> {
    void arguments_
    return Promise.resolve(null)
  }

  publishExpert(...arguments_: Parameters<ConfigurationCatalogRepository['publishExpert']>): Promise<null> {
    void arguments_
    return Promise.resolve(null)
  }

  disableExpert(...arguments_: Parameters<ConfigurationCatalogRepository['disableExpert']>): Promise<null> {
    void arguments_
    return Promise.resolve(null)
  }

  archiveExpert(...arguments_: Parameters<ConfigurationCatalogRepository['archiveExpert']>): Promise<null> {
    void arguments_
    return Promise.resolve(null)
  }

  listExpertRevisions(
    ...arguments_: Parameters<ConfigurationCatalogRepository['listExpertRevisions']>
  ): Promise<null> {
    void arguments_
    return Promise.resolve(null)
  }

  listEnvironments(
    ...arguments_: Parameters<ConfigurationCatalogRepository['listEnvironments']>
  ): Promise<ConfigurationCatalogPage<EnvironmentSummaryDto>> {
    void arguments_
    return Promise.resolve(emptyPage())
  }

  getEnvironment(...arguments_: Parameters<ConfigurationCatalogRepository['getEnvironment']>): Promise<null> {
    void arguments_
    return Promise.resolve(null)
  }
}

export class ExpertVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super(`Expert version ${expectedVersion} does not match current version ${actualVersion}.`)
    this.name = 'ExpertVersionConflictError'
  }
}

export class ExpertStateConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExpertStateConflictError'
  }
}

export class ExpertConfigurationValidationError extends Error {
  constructor(message: string, readonly fieldErrors: Record<string, string[]>) {
    super(message)
    this.name = 'ExpertConfigurationValidationError'
  }
}

export class ExpertIdempotencyConflictError extends Error {
  constructor() {
    super('The Idempotency-Key was already used with a different Expert request.')
    this.name = 'ExpertIdempotencyConflictError'
  }
}
