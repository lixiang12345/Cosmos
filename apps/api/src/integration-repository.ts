import type {
  CreateIntegrationRequest,
  IntegrationDto,
  IntegrationMutationResponse,
  UpdateIntegrationRequest,
} from '@cosmos/contracts'

export type IntegrationScope = {
  organizationId: string
  spaceId: string
  actorId: string
  requestId: string
}

export type IntegrationMutationScope = IntegrationScope & {
  integrationId: string
  expectedVersion: number
  idempotencyKey: string
}

export interface IntegrationRepository {
  listIntegrations(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ items: IntegrationDto[]; nextCursor: string | null; hasMore: boolean }>
  getIntegration(
    organizationId: string,
    spaceId: string,
    integrationId: string,
    actorId: string,
  ): Promise<IntegrationDto | null>
  createIntegration(
    scope: IntegrationScope & { idempotencyKey: string; request: CreateIntegrationRequest },
  ): Promise<IntegrationMutationResponse>
  updateIntegration(
    scope: IntegrationMutationScope & { request: UpdateIntegrationRequest },
  ): Promise<IntegrationMutationResponse | null>
  archiveIntegration(scope: IntegrationMutationScope): Promise<IntegrationMutationResponse | null>
}

export class IntegrationVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super(`Integration version ${expectedVersion} does not match current version ${actualVersion}.`)
    this.name = 'IntegrationVersionConflictError'
  }
}

export class IntegrationIdempotencyConflictError extends Error {
  constructor() {
    super('The Idempotency-Key was already used with a different integration request.')
    this.name = 'IntegrationIdempotencyConflictError'
  }
}

export class IntegrationDuplicateError extends Error {
  constructor(readonly name: string) {
    super(`An integration named ${name} of this type is already connected in this Space.`)
    this.name = 'IntegrationDuplicateError'
  }
}

export class EmptyIntegrationRepository implements IntegrationRepository {
  async listIntegrations() {
    return { items: [], nextCursor: null, hasMore: false }
  }

  async getIntegration() {
    return null
  }

  async createIntegration(): Promise<IntegrationMutationResponse> {
    throw new Error('IntegrationRepository not configured.')
  }

  async updateIntegration() {
    return null
  }

  async archiveIntegration() {
    return null
  }
}
