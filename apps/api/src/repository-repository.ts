import type {
  CreateRepositoryRequest,
  RepositoryDto,
  RepositoryMutationResponse,
  UpdateRepositoryRequest,
} from '@cosmos/contracts'

export type RepositoryScope = {
  organizationId: string
  spaceId: string
  actorId: string
  requestId: string
}

export type RepositoryMutationScope = RepositoryScope & {
  repositoryId: string
  expectedVersion: number
  idempotencyKey: string
}

export interface RepositoryRepository {
  listRepositories(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ items: RepositoryDto[]; nextCursor: string | null; hasMore: boolean }>
  getRepository(
    organizationId: string,
    spaceId: string,
    repositoryId: string,
    actorId: string,
  ): Promise<RepositoryDto | null>
  createRepository(
    scope: RepositoryScope & { idempotencyKey: string; request: CreateRepositoryRequest },
  ): Promise<RepositoryMutationResponse>
  updateRepository(
    scope: RepositoryMutationScope & { request: UpdateRepositoryRequest },
  ): Promise<RepositoryMutationResponse | null>
  archiveRepository(scope: RepositoryMutationScope): Promise<RepositoryMutationResponse | null>
}

export class RepositoryVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super(`Repository version ${expectedVersion} does not match current version ${actualVersion}.`)
    this.name = 'RepositoryVersionConflictError'
  }
}

export class RepositoryIdempotencyConflictError extends Error {
  constructor() {
    super('The Idempotency-Key was already used with a different Repository request.')
    this.name = 'RepositoryIdempotencyConflictError'
  }
}

export class RepositoryDuplicateError extends Error {
  constructor(readonly provider: string, readonly fullName: string) {
    super(`A repository ${provider}/${fullName} is already connected to this Space.`)
    this.name = 'RepositoryDuplicateError'
  }
}

export class EmptyRepositoryRepository implements RepositoryRepository {
  async listRepositories() {
    return { items: [], nextCursor: null, hasMore: false }
  }

  async getRepository() {
    return null
  }

  async createRepository(): Promise<RepositoryMutationResponse> {
    throw new Error('RepositoryRepository not configured.')
  }

  async updateRepository() {
    return null
  }

  async archiveRepository() {
    return null
  }
}
