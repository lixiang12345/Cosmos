import { describe, expect, it } from 'vitest'
import {
  FileDtoSchema,
  FileListResponseSchema,
  FilePathSchema,
  FilePrefixSchema,
  FileVersionDtoSchema,
  SessionEventDtoSchema,
} from '../src/index.js'

const file = {
  organizationId: 'relay',
  spaceId: null,
  id: 'file-1',
  scope: 'user',
  ownerUserId: 'user-1',
  sessionId: null,
  path: 'knowledge/checkout.md',
  mimeType: 'text/markdown',
  size: 42,
  latestVersionId: 'file-version-2',
  lastWrittenByToolCallId: 'tool-call-2',
  lastWrittenByExpertId: 'expert-1',
  createdAt: '2026-07-13T01:00:00.000Z',
  updatedAt: '2026-07-13T02:00:00.000Z',
  archivedAt: null,
  version: 2,
} as const

describe('File runtime contracts', () => {
  it('accepts canonical scoped File and immutable FileVersion projections', () => {
    expect(FileDtoSchema.parse(file)).toEqual(file)
    expect(FileVersionDtoSchema.parse({
      organizationId: file.organizationId,
      spaceId: null,
      fileId: file.id,
      id: file.latestVersionId,
      version: 2,
      contentHash: 'a'.repeat(64),
      size: file.size,
      createdByToolCallId: file.lastWrittenByToolCallId,
      sourceSessionId: 'session-1',
      sourceTurnId: 'turn-1',
      createdAt: file.updatedAt,
    }).version).toBe(2)
  })

  it('rejects path traversal, alternate separators, and Unicode ambiguity', () => {
    for (const path of [
      '/etc/passwd',
      '../secret',
      'knowledge/../secret',
      'knowledge\\secret',
      'knowledge//secret',
      'knowledge/./secret',
      'knowledge/secret\0.txt',
      'knowledge/zero\u200bwidth.txt',
      'cafe\u0301/readme.md',
    ]) {
      expect(FilePathSchema.safeParse(path).success).toBe(false)
    }
    expect(FilePathSchema.parse('knowledge/caf\u00e9.md')).toBe('knowledge/caf\u00e9.md')
    expect(FilePrefixSchema.parse('knowledge/')).toBe('knowledge/')
  })

  it('enforces scope tuples and page scope consistency', () => {
    expect(FileDtoSchema.safeParse({ ...file, ownerUserId: null }).success).toBe(false)
    expect(FileDtoSchema.safeParse({
      ...file, scope: 'workspace', ownerUserId: null, spaceId: 'space-1', sessionId: 'session-1',
    }).success).toBe(true)
    expect(FileListResponseSchema.parse({
      organizationId: file.organizationId,
      requestedSpaceId: 'space-1',
      scope: 'user',
      ownerUserId: file.ownerUserId,
      sessionId: null,
      items: [file],
      page: { nextCursor: null, hasMore: false },
    }).items).toEqual([file])
    expect(FileListResponseSchema.safeParse({
      organizationId: file.organizationId,
      requestedSpaceId: 'space-1',
      scope: 'organization',
      ownerUserId: null,
      sessionId: null,
      items: [file],
      page: { nextCursor: null, hasMore: false },
    }).success).toBe(false)
  })

  it('accepts a redacted File version Session event', () => {
    expect(SessionEventDtoSchema.parse({
      organizationId: file.organizationId,
      spaceId: 'space-1',
      sessionId: 'session-1',
      eventId: 'event-file-1',
      sequence: 5,
      type: 'file.version.created',
      resourceType: 'file',
      resourceId: file.id,
      actorId: file.ownerUserId,
      commandId: null,
      requestId: 'request-file-1',
      occurredAt: file.updatedAt,
      payload: {
        fileId: file.id,
        fileVersionId: file.latestVersionId,
        scope: file.scope,
        path: file.path,
        version: file.version,
        size: file.size,
      },
    }).type).toBe('file.version.created')
  })
})
