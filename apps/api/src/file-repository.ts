import type {
  FileDto,
  FileScope,
  FileVersionDto,
} from '@cosmos/contracts'

export type FileListCursor = { path: string; id: string }
export type FileVersionListCursor = { version: number; id: string }

export type FileListOptions = {
  scope: FileScope
  ownerUserId?: string
  sessionId?: string
  prefix?: string
  search?: string
  limit?: number
  cursor?: FileListCursor
}

export type FileVersionListOptions = {
  limit?: number
  cursor?: FileVersionListCursor
}

export type FileListPage = {
  items: FileDto[]
  hasMore: boolean
  nextCursor: FileListCursor | null
}

export type FileVersionListPage = {
  file: FileDto
  items: FileVersionDto[]
  hasMore: boolean
  nextCursor: FileVersionListCursor | null
}

export type FileContent = {
  file: FileDto
  version: FileVersionDto
  content: Buffer
}

export interface FileRepository {
  list(
    organizationId: string,
    requestedSpaceId: string,
    actorId: string,
    options: FileListOptions,
  ): Promise<FileListPage | null>
  get(
    organizationId: string,
    requestedSpaceId: string,
    fileId: string,
    actorId: string,
  ): Promise<FileDto | null>
  listVersions(
    organizationId: string,
    requestedSpaceId: string,
    fileId: string,
    actorId: string,
    options?: FileVersionListOptions,
  ): Promise<FileVersionListPage | null>
  getContent(
    organizationId: string,
    requestedSpaceId: string,
    fileId: string,
    actorId: string,
    version?: number,
  ): Promise<FileContent | null>
}

export class EmptyFileRepository implements FileRepository {
  async list(): Promise<null> { return null }
  async get(): Promise<null> { return null }
  async listVersions(): Promise<null> { return null }
  async getContent(): Promise<null> { return null }
}

export type AppendFileVersionRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  turnId: string
  actorId: string
  actorKind: 'user' | 'service_account'
  requestId: string
  scope: FileScope
  path: string
  mimeType: string
  content: Buffer
  expertId: string
  toolCallId: string
}

export type AppendFileVersionResult = {
  file: FileDto
  fileVersion: FileVersionDto
}

export interface FileWriterRepository {
  append(record: AppendFileVersionRecord): Promise<AppendFileVersionResult>
}

export class FileValidationError extends Error {
  constructor(readonly field: 'path' | 'mimeType' | 'content', message: string) {
    super(message)
    this.name = 'FileValidationError'
  }
}

export class FileQuotaExceededError extends Error {
  constructor(readonly limitBytes: number) {
    super(`The Organization FileVersion quota of ${limitBytes} bytes would be exceeded.`)
    this.name = 'FileQuotaExceededError'
  }
}
