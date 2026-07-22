import type {
  CreateSpaceRequest,
  SpaceDto,
  SpaceMigrationPreview,
  UpdateSpaceRequest,
} from '@relay/contracts'

export type SpaceScope = {
  organizationId: string
  actorId: string
  requestId: string
}

export type SpaceMutationScope = SpaceScope & {
  spaceId: string
  expectedVersion: number
  idempotencyKey: string
}

export type SpaceMutationResult = { space: SpaceDto; replayed: boolean }

export interface SpaceRepository {
  listSpaces(organizationId: string, actorId: string): Promise<SpaceDto[]>
  getSpace(organizationId: string, spaceId: string, actorId: string): Promise<SpaceDto | null>
  createSpace(record: SpaceScope & { idempotencyKey: string; request: CreateSpaceRequest }): Promise<SpaceMutationResult>
  updateSpace(record: SpaceMutationScope & { request: UpdateSpaceRequest }): Promise<SpaceMutationResult | null>
  setDefaultSpace(record: SpaceMutationScope): Promise<SpaceMutationResult | null>
  previewMigration(
    organizationId: string,
    spaceId: string,
    targetSpaceId: string,
    actorId: string,
  ): Promise<SpaceMigrationPreview | null>
}

export class SpaceVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super(`Space version ${expectedVersion} does not match current version ${actualVersion}.`)
    this.name = 'SpaceVersionConflictError'
  }
}

export class SpaceIdempotencyConflictError extends Error {
  constructor() {
    super('The Idempotency-Key was already used with a different Space request.')
    this.name = 'SpaceIdempotencyConflictError'
  }
}

export class SpaceValidationError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message)
    this.name = 'SpaceValidationError'
  }
}

export class SpacePermissionError extends Error {
  constructor(message = 'The actor cannot manage this Space operation.') {
    super(message)
    this.name = 'SpacePermissionError'
  }
}

export class EmptySpaceRepository implements SpaceRepository {
  listSpaces(): Promise<SpaceDto[]> { return Promise.resolve([]) }
  getSpace(): Promise<null> { return Promise.resolve(null) }
  createSpace(): Promise<SpaceMutationResult> {
    return Promise.reject(new Error('Space mutations require a database-backed repository.'))
  }
  updateSpace(): Promise<null> { return Promise.resolve(null) }
  setDefaultSpace(): Promise<null> { return Promise.resolve(null) }
  previewMigration(): Promise<null> { return Promise.resolve(null) }
}
