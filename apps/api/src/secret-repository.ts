import type {
  CreateSecretRequest,
  SecretDto,
  SecretMutationResponse,
} from '@cosmos/contracts'

export type SecretScope = {
  organizationId: string
  spaceId: string
  actorId: string
  requestId: string
}

export type SecretMutationScope = SecretScope & {
  secretId: string
  expectedVersion: number
  idempotencyKey: string
}

export interface SecretRepository {
  listSecrets(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ items: SecretDto[]; nextCursor: string | null; hasMore: boolean }>
  getSecret(
    organizationId: string,
    spaceId: string,
    secretId: string,
    actorId: string,
  ): Promise<SecretDto | null>
  createSecret(
    scope: SecretScope & { idempotencyKey: string; request: CreateSecretRequest },
  ): Promise<SecretMutationResponse>
  archiveSecret(scope: SecretMutationScope): Promise<SecretMutationResponse | null>
}

export class SecretVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super(`Secret version ${expectedVersion} does not match current version ${actualVersion}.`)
    this.name = 'SecretVersionConflictError'
  }
}

export class SecretIdempotencyConflictError extends Error {
  constructor() {
    super('The Idempotency-Key was already used with a different Secret request.')
    this.name = 'SecretIdempotencyConflictError'
  }
}

export class SecretDuplicateError extends Error {
  constructor(readonly scope: string, readonly name: string) {
    super(`An active ${scope} Secret named ${name} already exists in this Space.`)
    this.name = 'SecretDuplicateError'
  }
}

export class EmptySecretRepository implements SecretRepository {
  async listSecrets() {
    return { items: [], nextCursor: null, hasMore: false }
  }

  async getSecret() {
    return null
  }

  async createSecret(): Promise<SecretMutationResponse> {
    throw new Error('SecretRepository not configured.')
  }

  async archiveSecret() {
    return null
  }
}
