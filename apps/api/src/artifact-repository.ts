import type {
  ArtifactDto,
  ArtifactType,
  CreateArtifactRequest,
  UpdateArtifactRequest,
} from '@cosmos/contracts'

export type ArtifactListCursor = {
  createdAt: string
  id: string
}

export type ArtifactListOptions = {
  limit?: number
  cursor?: ArtifactListCursor
  type?: ArtifactType
}

export type ArtifactListPage = {
  items: ArtifactDto[]
  hasMore: boolean
  nextCursor: ArtifactListCursor | null
}

type ArtifactMutationRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  actorId: string
  actorKind: 'user' | 'service_account'
  requestId: string
}

export type CreateArtifactRecord = ArtifactMutationRecord & {
  idempotencyKey: string
  request: CreateArtifactRequest
}

export type UpdateArtifactRecord = ArtifactMutationRecord & {
  artifactId: string
  expectedVersion: number
  request: UpdateArtifactRequest
}

export type RemoveArtifactRecord = ArtifactMutationRecord & {
  artifactId: string
  expectedVersion: number
  idempotencyKey: string
}

export type ArtifactMutationResult = {
  artifact: ArtifactDto
  replayed: boolean
}

export interface ArtifactRepository {
  list(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
    options?: ArtifactListOptions,
  ): Promise<ArtifactListPage | null>
  create(record: CreateArtifactRecord): Promise<ArtifactMutationResult | null>
  update(record: UpdateArtifactRecord): Promise<ArtifactDto | null>
  remove(record: RemoveArtifactRecord): Promise<ArtifactMutationResult | null>
}

export class EmptyArtifactRepository implements ArtifactRepository {
  async list(): Promise<null> {
    return null
  }

  async create(): Promise<null> {
    return null
  }

  async update(): Promise<null> {
    return null
  }

  async remove(): Promise<null> {
    return null
  }
}

export class ArtifactVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly currentVersion: number) {
    super(`Artifact version ${expectedVersion} does not match current version ${currentVersion}.`)
    this.name = 'ArtifactVersionConflictError'
  }
}

export class ArtifactConflictError extends Error {
  constructor(message = 'This external object is already associated with an Artifact.') {
    super(message)
    this.name = 'ArtifactConflictError'
  }
}

export class ArtifactValidationError extends Error {
  constructor(readonly field: 'attributes' | 'turnId', message: string) {
    super(message)
    this.name = 'ArtifactValidationError'
  }
}
