import type {
  CreateDaemonRequest,
  DaemonDto,
  DaemonMutationResponse,
  UpdateDaemonRequest,
} from '@cosmos/contracts'

export type DaemonScope = {
  organizationId: string
  spaceId: string
  actorId: string
  requestId: string
}

export type DaemonMutationScope = DaemonScope & {
  daemonId: string
  expectedVersion: number
  idempotencyKey: string
}

export interface DaemonRepository {
  listDaemons(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ items: DaemonDto[]; nextCursor: string | null; hasMore: boolean }>
  getDaemon(
    organizationId: string,
    spaceId: string,
    daemonId: string,
    actorId: string,
  ): Promise<DaemonDto | null>
  createDaemon(
    scope: DaemonScope & { idempotencyKey: string; request: CreateDaemonRequest },
  ): Promise<DaemonMutationResponse>
  updateDaemon(
    scope: DaemonMutationScope & { request: UpdateDaemonRequest },
  ): Promise<DaemonMutationResponse | null>
  archiveDaemon(scope: DaemonMutationScope): Promise<DaemonMutationResponse | null>
}

export class DaemonVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super(`Daemon version ${expectedVersion} does not match current version ${actualVersion}.`)
    this.name = 'DaemonVersionConflictError'
  }
}

export class DaemonIdempotencyConflictError extends Error {
  constructor() {
    super('The Idempotency-Key was already used with a different daemon request.')
    this.name = 'DaemonIdempotencyConflictError'
  }
}

export class DaemonDuplicateError extends Error {
  constructor(readonly name: string) {
    super(`A daemon named ${name} is already registered in this Space.`)
    this.name = 'DaemonDuplicateError'
  }
}

export class DaemonEnvironmentNotFoundError extends Error {
  constructor(readonly environmentId: string) {
    super(`Environment ${environmentId} does not exist in this Space.`)
    this.name = 'DaemonEnvironmentNotFoundError'
  }
}

export class EmptyDaemonRepository implements DaemonRepository {
  async listDaemons() {
    return { items: [], nextCursor: null, hasMore: false }
  }

  async getDaemon() {
    return null
  }

  async createDaemon(): Promise<DaemonMutationResponse> {
    throw new Error('DaemonRepository not configured.')
  }

  async updateDaemon() {
    return null
  }

  async archiveDaemon() {
    return null
  }
}
