import { createHash, randomUUID } from 'node:crypto'
import {
  FileDtoSchema,
  FilePathSchema,
  FileVersionDtoSchema,
  type FileDto,
  type FileScope,
  type FileVersionDto,
} from '@relay/contracts'
import type { Pool, PoolClient } from 'pg'
import {
  FileQuotaExceededError,
  FileValidationError,
  type AppendFileVersionRecord,
  type AppendFileVersionResult,
  type FileContent,
  type FileListOptions,
  type FileListPage,
  type FileRepository,
  type FileVersionListOptions,
  type FileVersionListPage,
  type FileWriterRepository,
} from './file-repository.js'
import { setLocalApiDatabaseContext } from './postgres-runtime-database.js'
import { AuthorizationChangedError } from './session-repository.js'
import { ObjectStorageError, type ObjectStore } from './object-storage.js'

type TimestampValue = Date | string

type FileRow = {
  organization_id: string
  space_id: string | null
  id: string
  scope: FileScope
  owner_user_id: string | null
  session_id: string | null
  path: string
  mime_type: string
  size: number
  latest_version_id: string
  last_written_by_tool_call_id: string
  last_written_by_expert_id: string
  created_at: TimestampValue
  updated_at: TimestampValue
  archived_at: TimestampValue | null
  version: number
}

type FileVersionRow = {
  organization_id: string
  space_id: string | null
  file_id: string
  id: string
  version: number
  content_hash: string
  size: number
  created_by_tool_call_id: string
  source_session_id: string
  source_turn_id: string
  created_at: TimestampValue
  storage_backend: 'inline' | 'object'
  object_key: string | null
}

type FileContentRow = FileVersionRow & { content: Buffer | null }

const fileColumns = `
  organization_id, space_id, id, scope, owner_user_id, session_id, path,
  mime_type, size, latest_version_id, last_written_by_tool_call_id,
  last_written_by_expert_id, created_at, updated_at, archived_at, version
`

const fileVersionColumns = `
  organization_id, space_id, file_id, id, version, content_hash, size,
  created_by_tool_call_id, source_session_id, source_turn_id, created_at,
  storage_backend, object_key
`

function timestamp(value: TimestampValue) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapFile(row: FileRow): FileDto {
  return FileDtoSchema.parse({
    organizationId: row.organization_id,
    spaceId: row.space_id,
    id: row.id,
    scope: row.scope,
    ownerUserId: row.owner_user_id,
    sessionId: row.session_id,
    path: row.path,
    mimeType: row.mime_type,
    size: row.size,
    latestVersionId: row.latest_version_id,
    lastWrittenByToolCallId: row.last_written_by_tool_call_id,
    lastWrittenByExpertId: row.last_written_by_expert_id,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    archivedAt: row.archived_at === null ? null : timestamp(row.archived_at),
    version: row.version,
  })
}

function mapFileVersion(row: FileVersionRow): FileVersionDto {
  return FileVersionDtoSchema.parse({
    organizationId: row.organization_id,
    spaceId: row.space_id,
    fileId: row.file_id,
    id: row.id,
    version: row.version,
    contentHash: row.content_hash,
    size: row.size,
    createdByToolCallId: row.created_by_tool_call_id,
    sourceSessionId: row.source_session_id,
    sourceTurnId: row.source_turn_id,
    createdAt: timestamp(row.created_at),
  })
}

async function transaction<T>(
  pool: Pool,
  context: { organizationId: string; spaceId: string; actorId: string } | null,
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (context) await setLocalApiDatabaseContext(client, context)
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function canReadWorkspaceSession(
  client: PoolClient,
  organizationId: string,
  spaceId: string,
  sessionId: string,
  actorId: string,
) {
  const result = await client.query(`
    SELECT 1
    FROM relay_sessions session
    JOIN relay_organization_memberships organization_membership
      ON organization_membership.organization_id = session.organization_id
      AND organization_membership.actor_id = $4
    JOIN relay_space_memberships space_membership
      ON space_membership.organization_id = session.organization_id
      AND space_membership.space_id = session.space_id
      AND space_membership.actor_id = $4
    WHERE session.organization_id = $1 AND session.space_id = $2 AND session.id = $3
      AND (
        session.visibility = 'space' OR session.created_by = $4
        OR EXISTS (
          SELECT 1 FROM relay_session_share_grants share_grant
          WHERE share_grant.organization_id = session.organization_id
            AND share_grant.space_id = session.space_id
            AND share_grant.session_id = session.id
            AND share_grant.revoked_at IS NULL
            AND (share_grant.expires_at IS NULL
              OR share_grant.expires_at > transaction_timestamp())
            AND (
              (share_grant.principal_type = 'user' AND share_grant.principal_id = $4)
              OR (
                share_grant.principal_type = 'group'
                AND EXISTS (
                  SELECT 1 FROM relay_group_memberships group_membership
                  WHERE group_membership.organization_id = share_grant.organization_id
                    AND group_membership.group_id = share_grant.principal_id
                    AND group_membership.actor_id = $4
                )
              )
            )
        )
      )
  `, [organizationId, spaceId, sessionId, actorId])
  return Boolean(result.rowCount)
}

async function canReadOtherUserFiles(
  client: PoolClient,
  organizationId: string,
  actorId: string,
) {
  const result = await client.query<{ role: string }>(`
    SELECT role FROM relay_organization_memberships
    WHERE organization_id = $1 AND actor_id = $2
      AND role IN ('organization_admin', 'organization_owner')
  `, [organizationId, actorId])
  return Boolean(result.rowCount)
}

async function readableFile(
  client: PoolClient,
  organizationId: string,
  requestedSpaceId: string,
  fileId: string,
  actorId: string,
): Promise<FileDto | null> {
  const result = await client.query<FileRow>(`
    SELECT ${fileColumns.split(',').map((column) => `file.${column.trim()}`).join(', ')}
    FROM relay_files file
    WHERE file.organization_id = $1 AND file.id = $2
      AND file.version > 0 AND file.archived_at IS NULL
  `, [organizationId, fileId])
  const row = result.rows[0]
  if (!row) return null
  if (row.scope === 'organization') return mapFile(row)
  if (row.scope === 'user') {
    if (row.owner_user_id === actorId || await canReadOtherUserFiles(client, organizationId, actorId)) {
      return mapFile(row)
    }
    return null
  }
  if (
    row.space_id === requestedSpaceId
    && row.session_id
    && await canReadWorkspaceSession(
      client, organizationId, requestedSpaceId, row.session_id, actorId,
    )
  ) return mapFile(row)
  return null
}

export class PostgresFileRepository implements FileRepository {
  constructor(private readonly pool: Pool, private readonly objectStore?: ObjectStore) {}

  async list(
    organizationId: string,
    requestedSpaceId: string,
    actorId: string,
    options: FileListOptions,
  ): Promise<FileListPage | null> {
    const pageLimit = options.limit ?? 25
    if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100) {
      throw new RangeError('File page limit must be an integer between 1 and 100.')
    }
    return transaction(
      this.pool,
      { organizationId, spaceId: requestedSpaceId, actorId },
      async (client) => {
        if (options.scope === 'workspace') {
          if (!options.sessionId || !await canReadWorkspaceSession(
            client, organizationId, requestedSpaceId, options.sessionId, actorId,
          )) return null
        }
        if (
          options.scope === 'user'
          && options.ownerUserId !== actorId
          && !await canReadOtherUserFiles(client, organizationId, actorId)
        ) throw new AuthorizationChangedError()

        const parameters: unknown[] = [organizationId, options.scope]
        const clauses = ['file.organization_id = $1', 'file.scope = $2', 'file.version > 0', 'file.archived_at IS NULL']
        if (options.scope === 'workspace') {
          parameters.push(requestedSpaceId, options.sessionId)
          clauses.push(`file.space_id = $3 AND file.session_id = $4`)
        } else if (options.scope === 'user') {
          parameters.push(options.ownerUserId)
          clauses.push(`file.owner_user_id = $3`)
        }
        if (options.prefix) {
          parameters.push(`${options.prefix.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`)
          clauses.push(`file.path LIKE $${parameters.length} ESCAPE '\\'`)
        }
        if (options.search) {
          parameters.push(`%${options.search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`)
          clauses.push(`file.path ILIKE $${parameters.length} ESCAPE '\\'`)
        }
        if (options.cursor) {
          parameters.push(options.cursor.path, options.cursor.id)
          clauses.push(`(file.path, file.id) > ($${parameters.length - 1}, $${parameters.length})`)
        }
        parameters.push(pageLimit + 1)
        const result = await client.query<FileRow>(`
          SELECT ${fileColumns.split(',').map((column) => `file.${column.trim()}`).join(', ')}
          FROM relay_files file
          WHERE ${clauses.join('\n            AND ')}
          ORDER BY file.path ASC, file.id ASC
          LIMIT $${parameters.length}
        `, parameters)
        const hasMore = result.rows.length > pageLimit
        const items = result.rows.slice(0, pageLimit).map(mapFile)
        const last = items.at(-1)
        return {
          items,
          hasMore,
          nextCursor: hasMore && last ? { path: last.path, id: last.id } : null,
        }
      },
    )
  }

  async get(organizationId: string, requestedSpaceId: string, fileId: string, actorId: string) {
    return transaction(
      this.pool,
      { organizationId, spaceId: requestedSpaceId, actorId },
      (client) => readableFile(client, organizationId, requestedSpaceId, fileId, actorId),
    )
  }

  async listVersions(
    organizationId: string,
    requestedSpaceId: string,
    fileId: string,
    actorId: string,
    options: FileVersionListOptions = {},
  ): Promise<FileVersionListPage | null> {
    const pageLimit = options.limit ?? 25
    if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100) {
      throw new RangeError('FileVersion page limit must be an integer between 1 and 100.')
    }
    return transaction(
      this.pool,
      { organizationId, spaceId: requestedSpaceId, actorId },
      async (client) => {
        const file = await readableFile(client, organizationId, requestedSpaceId, fileId, actorId)
        if (!file) return null
        const parameters: unknown[] = [organizationId, fileId]
        let cursorClause = ''
        if (options.cursor) {
          parameters.push(options.cursor.version, options.cursor.id)
          cursorClause = 'AND (version, id) < ($3, $4)'
        }
        parameters.push(pageLimit + 1)
        const result = await client.query<FileVersionRow>(`
          SELECT ${fileVersionColumns}
          FROM relay_file_versions
          WHERE organization_id = $1 AND file_id = $2 ${cursorClause}
          ORDER BY version DESC, id DESC
          LIMIT $${parameters.length}
        `, parameters)
        const hasMore = result.rows.length > pageLimit
        const items = result.rows.slice(0, pageLimit).map(mapFileVersion)
        const last = items.at(-1)
        return {
          file,
          items,
          hasMore,
          nextCursor: hasMore && last ? { version: last.version, id: last.id } : null,
        }
      },
    )
  }

  async getContent(
    organizationId: string,
    requestedSpaceId: string,
    fileId: string,
    actorId: string,
    version?: number,
  ): Promise<FileContent | null> {
    const stored = await transaction(
      this.pool,
      { organizationId, spaceId: requestedSpaceId, actorId },
      async (client) => {
        const file = await readableFile(client, organizationId, requestedSpaceId, fileId, actorId)
        if (!file) return null
        const result = await client.query<FileContentRow>(`
          SELECT ${fileVersionColumns}, content
          FROM relay_file_versions
          WHERE organization_id = $1 AND file_id = $2
            AND version = $3
        `, [organizationId, fileId, version ?? file.version])
        if (!result.rows[0]) return null
        const row = result.rows[0]
        return {
          file,
          version: mapFileVersion(row),
          content: row.content,
          storageBackend: row.storage_backend,
          objectKey: row.object_key,
        }
      },
    )
    if (!stored) return null
    let content = stored.content
    if (stored.storageBackend === 'object') {
      if (!this.objectStore || !stored.objectKey) {
        throw new ObjectStorageError('Object-backed File content is unavailable.')
      }
      content = await this.objectStore.get(stored.objectKey)
      if (!content) throw new ObjectStorageError('Object-backed File content is missing.')
    }
    if (!content) throw new ObjectStorageError('Inline File content is missing.')
    const hash = createHash('sha256').update(content).digest('hex')
    if (content.byteLength !== stored.version.size || hash !== stored.version.contentHash) {
      throw new ObjectStorageError('Stored File content failed integrity verification.')
    }
    return { file: stored.file, version: stored.version, content }
  }
}

export type PostgresFileWriterRepositoryOptions = {
  createId?: () => string
  now?: () => Date
  maxVersionBytes?: number
  maxOrganizationBytes?: number
  objectStore?: ObjectStore
}

export class PostgresFileWriterRepository implements FileWriterRepository {
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly maxVersionBytes: number
  private readonly maxOrganizationBytes: number
  private readonly objectStore?: ObjectStore

  constructor(private readonly pool: Pool, options: PostgresFileWriterRepositoryOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.maxVersionBytes = options.maxVersionBytes ?? 1_048_576
    this.maxOrganizationBytes = options.maxOrganizationBytes ?? 100 * 1_048_576
    this.objectStore = options.objectStore
    if (this.maxVersionBytes < 1 || this.maxVersionBytes > 1_048_576) {
      throw new Error('maxVersionBytes must be between 1 and 1048576.')
    }
    if (this.maxOrganizationBytes < this.maxVersionBytes) {
      throw new Error('maxOrganizationBytes must be at least maxVersionBytes.')
    }
  }

  async append(record: AppendFileVersionRecord): Promise<AppendFileVersionResult> {
    const path = FilePathSchema.safeParse(record.path)
    if (!path.success) throw new FileValidationError('path', path.error.issues[0]?.message ?? 'Invalid File path.')
    const mimeType = record.mimeType.trim()
    if (!mimeType || mimeType.length > 255 || /[\r\n]/.test(mimeType)) {
      throw new FileValidationError('mimeType', 'File mimeType must contain 1 to 255 characters without line breaks.')
    }
    if (record.content.byteLength > this.maxVersionBytes) {
      throw new FileValidationError('content', `File content cannot exceed ${this.maxVersionBytes} bytes.`)
    }
    const fileVersionId = this.createId()
    const storage = this.objectStore ? {
      backend: 'object' as const,
      objectKey: `organizations/${createHash('sha256').update(record.organizationId).digest('hex')}/file-versions/${fileVersionId}`,
    } : { backend: 'inline' as const, objectKey: null }
    if (this.objectStore && storage.objectKey) {
      await this.objectStore.put(storage.objectKey, record.content, mimeType)
    }
    try {
      return await transaction(this.pool, null, (client) => this.appendInTransaction(client, {
        ...record, path: path.data, mimeType,
      }, fileVersionId, storage))
    } catch (error) {
      if (this.objectStore && storage.objectKey) {
        try { await this.objectStore.delete(storage.objectKey) } catch { /* inaccessible orphan; GC can reap it */ }
      }
      throw error
    }
  }

  private async appendInTransaction(
    client: PoolClient,
    record: AppendFileVersionRecord,
    fileVersionId: string,
    storage: { backend: 'inline' | 'object'; objectKey: string | null },
  ): Promise<AppendFileVersionResult> {
    if (record.actorKind !== 'user') throw new AuthorizationChangedError()
    const access = await client.query<{
      organization_role: string
      space_role: string
      created_by: string
      visibility: 'private' | 'space'
      expert_id: string
    }>(`
      SELECT organization_membership.role AS organization_role,
        space_membership.role AS space_role, session.created_by,
        session.visibility, session.expert_id
      FROM relay_sessions session
      JOIN relay_turns turn
        ON turn.organization_id = session.organization_id
        AND turn.space_id = session.space_id
        AND turn.session_id = session.id
        AND turn.id = $4
      JOIN relay_organization_memberships organization_membership
        ON organization_membership.organization_id = session.organization_id
        AND organization_membership.actor_id = $5
      JOIN relay_space_memberships space_membership
        ON space_membership.organization_id = session.organization_id
        AND space_membership.space_id = session.space_id
        AND space_membership.actor_id = $5
      WHERE session.organization_id = $1 AND session.space_id = $2 AND session.id = $3
      FOR UPDATE OF session, turn, organization_membership, space_membership
    `, [record.organizationId, record.spaceId, record.sessionId, record.turnId, record.actorId])
    const actor = access.rows[0]
    if (!actor || actor.expert_id !== record.expertId) throw new AuthorizationChangedError()
    const creator = actor.created_by === record.actorId
    const manager = actor.visibility === 'space' && actor.space_role === 'space_manager'
    if (record.scope === 'workspace' && !creator && !manager) throw new AuthorizationChangedError()
    if (record.scope === 'user' && !creator) throw new AuthorizationChangedError()
    if (
      record.scope === 'organization'
      && (!['organization_admin', 'organization_owner'].includes(actor.organization_role)
        || actor.space_role !== 'space_manager'
        || (!creator && actor.visibility !== 'space'))
    ) throw new AuthorizationChangedError()

    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify(['file-quota', record.organizationId]),
    ])
    const quota = await client.query<{ bytes: string }>(`
      SELECT COALESCE(sum(size), 0)::text AS bytes
      FROM relay_file_versions WHERE organization_id = $1
    `, [record.organizationId])
    if (Number(quota.rows[0]?.bytes ?? 0) + record.content.byteLength > this.maxOrganizationBytes) {
      throw new FileQuotaExceededError(this.maxOrganizationBytes)
    }

    const ownerUserId = record.scope === 'user' ? record.actorId : null
    const fileSpaceId = record.scope === 'workspace' ? record.spaceId : null
    const fileSessionId = record.scope === 'workspace' ? record.sessionId : null
    const selected = await client.query<FileRow>(`
      SELECT ${fileColumns}
      FROM relay_files
      WHERE organization_id = $1 AND scope = $2 AND path = $3
        AND owner_user_id IS NOT DISTINCT FROM $4
        AND space_id IS NOT DISTINCT FROM $5
        AND session_id IS NOT DISTINCT FROM $6
      FOR UPDATE
    `, [
      record.organizationId, record.scope, record.path,
      ownerUserId, fileSpaceId, fileSessionId,
    ])
    const occurredAt = this.now().toISOString()
    const fileId = selected.rows[0]?.id ?? this.createId()
    const previous = selected.rows[0] ? mapFile(selected.rows[0]) : null
    if (previous?.archivedAt) throw new AuthorizationChangedError()
    if (!selected.rows[0]) {
      await client.query(`
        INSERT INTO relay_files (
          organization_id, space_id, id, scope, owner_user_id, session_id,
          path, mime_type, size, latest_version_id,
          last_written_by_tool_call_id, last_written_by_expert_id,
          created_at, updated_at, archived_at, version
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, 0, NULL, NULL, NULL,
          $9, $9, NULL, 0
        )
      `, [
        record.organizationId, fileSpaceId, fileId, record.scope,
        ownerUserId, fileSessionId, record.path, record.mimeType, occurredAt,
      ])
    }
    const nextVersion = (previous?.version ?? 0) + 1
    const contentHash = createHash('sha256').update(record.content).digest('hex')
    await client.query(`
      INSERT INTO relay_file_versions (
        organization_id, space_id, file_id, id, version, content,
        content_hash, size, created_by_tool_call_id, source_space_id,
        source_session_id, source_turn_id, created_at, storage_backend, object_key
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )
    `, [
      record.organizationId, fileSpaceId, fileId, fileVersionId, nextVersion,
      storage.backend === 'inline' ? record.content : null,
      contentHash, record.content.byteLength, record.toolCallId,
      record.spaceId, record.sessionId, record.turnId, occurredAt,
      storage.backend, storage.objectKey,
    ])
    const updated = await client.query<FileRow>(`
      UPDATE relay_files
      SET mime_type = $3, size = $4, latest_version_id = $5,
        last_written_by_tool_call_id = $6, last_written_by_expert_id = $7,
        updated_at = $8, version = version + 1
      WHERE organization_id = $1 AND id = $2
      RETURNING ${fileColumns}
    `, [
      record.organizationId, fileId, record.mimeType, record.content.byteLength,
      fileVersionId, record.toolCallId, record.expertId, occurredAt,
    ])
    const file = mapFile(updated.rows[0])
    const versionResult = await client.query<FileVersionRow>(`
      SELECT ${fileVersionColumns}
      FROM relay_file_versions
      WHERE organization_id = $1 AND file_id = $2 AND id = $3
    `, [record.organizationId, fileId, fileVersionId])
    const fileVersion = mapFileVersion(versionResult.rows[0])
    await this.appendLedgers(client, record, previous, file, fileVersion, occurredAt)
    return { file, fileVersion }
  }

  private async appendLedgers(
    client: PoolClient,
    record: AppendFileVersionRecord,
    before: FileDto | null,
    file: FileDto,
    fileVersion: FileVersionDto,
    occurredAt: string,
  ) {
    const projection = {
      fileId: file.id,
      fileVersionId: fileVersion.id,
      scope: file.scope,
      path: file.path,
      version: fileVersion.version,
      size: fileVersion.size,
    }
    const reservation = await client.query<{ sequence: string }>(`
      UPDATE relay_sessions SET last_event_sequence = last_event_sequence + 1
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      RETURNING last_event_sequence AS sequence
    `, [record.organizationId, record.spaceId, record.sessionId])
    if (!reservation.rows[0]) throw new Error('The File event sequence could not be reserved.')
    await client.query(`
      INSERT INTO relay_session_events (
        organization_id, space_id, session_id, event_id, sequence,
        event_type, resource_type, resource_id, payload, actor_id,
        actor_kind, file_id, file_version_id, command_id, request_id, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, 'file.version.created', 'file', $6,
        $7::jsonb, $8, 'user', $6, $9, NULL, $10, $11
      )
    `, [
      record.organizationId, record.spaceId, record.sessionId, this.createId(),
      reservation.rows[0].sequence, file.id, JSON.stringify(projection), record.actorId,
      fileVersion.id, record.requestId, occurredAt,
    ])
    const beforeState = before === null ? null : {
      fileId: before.id, scope: before.scope, path: before.path,
      version: before.version, size: before.size,
    }
    await client.query(`
      INSERT INTO relay_audit_events (
        organization_id, audit_event_id, space_id, session_id,
        actor_id, actor_kind, delegation_chain, action,
        target_type, target_id, result, request_id, idempotency_key_hash,
        policy_decision, policy_reason, before_state, after_state, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, 'user', '[]'::jsonb, 'file.version.create',
        'file', $6, 'success', $7, NULL, 'allow', $8, $9::jsonb, $10::jsonb, $11
      )
    `, [
      record.organizationId, this.createId(), record.spaceId, record.sessionId,
      record.actorId, file.id, record.requestId, `${record.scope}_file_write`,
      beforeState === null ? null : JSON.stringify(beforeState),
      JSON.stringify(projection), occurredAt,
    ])
    await client.query(`
      INSERT INTO relay_outbox_events (
        id, organization_id, space_id, session_id, aggregate_type,
        aggregate_id, event_type, payload, occurred_at
      ) VALUES (
        $1, $2, $3, $4, 'file', $5, 'file.version.created', $6::jsonb, $7
      )
    `, [
      this.createId(), record.organizationId, record.spaceId, record.sessionId,
      file.id, JSON.stringify({ sessionId: record.sessionId, ...projection }), occurredAt,
    ])
  }
}
