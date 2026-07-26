import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import {
  SkillDtoSchema,
  SkillMutationResponseSchema,
  type CreateSkillRequest,
  type SkillDto,
  type SkillMutationResponse,
  type UpdateSkillRequest,
} from '@cosmos/contracts'
import { withApiDatabaseContext } from './postgres-runtime-database.js'
import {
  EmptySkillRepository,
  SkillDuplicateError,
  SkillSourceMismatchError,
  SkillVersionConflictError,
  type SkillMutationScope,
  type SkillRepository,
  type SkillScope,
} from './skill-repository.js'

type SkillRow = {
  organization_id: string
  space_id: string
  id: string
  name: string
  description: string
  source: string
  content: string | null
  url: string | null
  tags: string[]
  status: string
  version: number
  created_by: string
  created_at: Date
  updated_at: Date
  archived_at: Date | null
}

function rowToDto(row: SkillRow): SkillDto {
  return SkillDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    name: row.name,
    description: row.description,
    source: row.source,
    content: row.content,
    url: row.url,
    tags: row.tags,
    status: row.status,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
  })
}

function encodeSkillCursor(row: SkillRow): string {
  return Buffer.from(`${row.updated_at.toISOString()}\u0000${row.id}`).toString('base64url')
}

function decodeSkillCursor(cursor: string | undefined): { updatedAt: string; id: string } | null {
  if (!cursor) return null
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
  const separator = decoded.indexOf('\u0000')
  if (separator <= 0) return null
  const updatedAt = decoded.slice(0, separator)
  const id = decoded.slice(separator + 1)
  if (!id || Number.isNaN(Date.parse(updatedAt))) return null
  return { updatedAt, id }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && (error as { code?: string }).code === '23505'
}

export class PostgresSkillRepository implements SkillRepository {
  constructor(private readonly pool: Pool) {}

  async listSkills(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<{ items: SkillDto[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(options.limit ?? 50, 100)
    const cursor = decodeSkillCursor(options.cursor)
    const rows = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const result = await client.query<SkillRow>(
        `SELECT * FROM cosmos_skills
         WHERE organization_id = $1 AND space_id = $2
           AND status <> 'archived'
           AND ($4::timestamptz IS NULL OR (updated_at, id) < ($4::timestamptz, $5::text))
         ORDER BY updated_at DESC, id DESC
         LIMIT $3`,
        [organizationId, spaceId, limit + 1, cursor?.updatedAt ?? null, cursor?.id ?? null],
      )
      return result.rows
    })
    const hasMore = rows.length > limit
    const items = rows.slice(0, limit).map(rowToDto)
    const last = rows.length > limit ? rows[limit - 1] : undefined
    return {
      items,
      nextCursor: hasMore && last ? encodeSkillCursor(last) : null,
      hasMore,
    }
  }

  async getSkill(
    organizationId: string,
    spaceId: string,
    skillId: string,
    actorId: string,
  ): Promise<SkillDto | null> {
    const row = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const result = await client.query<SkillRow>(
        `SELECT * FROM cosmos_skills
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, skillId],
      )
      return result.rows[0] ?? null
    })
    return row ? rowToDto(row) : null
  }

  async createSkill(
    scope: SkillScope & { idempotencyKey: string; request: CreateSkillRequest },
  ): Promise<SkillMutationResponse> {
    const { organizationId, spaceId, actorId, requestId, idempotencyKey, request } = scope
    const id = randomUUID()
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')
    const isInline = request.source === 'inline'
    const content = isInline ? request.content ?? null : null
    const url = isInline ? null : request.url ?? null

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<SkillRow>(
        `SELECT s.* FROM cosmos_skills s
         JOIN cosmos_skill_audit_events a
           ON a.organization_id = s.organization_id
          AND a.space_id = s.space_id
          AND a.skill_id = s.id
         WHERE a.organization_id = $1 AND a.space_id = $2
           AND a.idempotency_key_hash = $3 AND a.action = 'create'
         LIMIT 1`,
        [organizationId, spaceId, idempotencyKeyHash],
      )
      if (existing.rows[0]) {
        return { row: existing.rows[0], replayed: true }
      }

      const duplicate = await client.query(
        `SELECT 1 FROM cosmos_skills
         WHERE organization_id = $1 AND space_id = $2
           AND name = $3
           AND status <> 'archived'`,
        [organizationId, spaceId, request.name],
      )
      if (duplicate.rowCount && duplicate.rowCount > 0) {
        throw new SkillDuplicateError(request.name)
      }

      let inserted
      try {
        inserted = await client.query<SkillRow>(
          `INSERT INTO cosmos_skills
             (organization_id, space_id, id, name, description, source, content, url, tags, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [organizationId, spaceId, id, request.name, request.description,
            request.source, content, url, request.tags, actorId],
        )
      } catch (error) {
        if (isUniqueViolation(error)) throw new SkillDuplicateError(request.name)
        throw error
      }

      await client.query(
        `INSERT INTO cosmos_skill_audit_events
           (organization_id, space_id, id, skill_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'create', 1, $6, $7)`,
        [organizationId, spaceId, randomUUID(), id, actorId, requestId, idempotencyKeyHash],
      )

      await client.query(
        `INSERT INTO cosmos_skill_outbox_events
           (organization_id, space_id, id, skill_id, event_type, payload)
         VALUES ($1, $2, $3, $4, 'skill.created', $5::jsonb)`,
        [organizationId, spaceId, randomUUID(), id, JSON.stringify({ source: request.source })],
      )

      return { row: inserted.rows[0]!, replayed: false }
    })

    return SkillMutationResponseSchema.parse({
      skill: rowToDto(result.row),
      replayed: result.replayed,
    })
  }

  async updateSkill(
    scope: SkillMutationScope & { request: UpdateSkillRequest },
  ): Promise<SkillMutationResponse | null> {
    const { organizationId, spaceId, skillId, actorId, requestId, expectedVersion, idempotencyKey, request } = scope
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<SkillRow>(
        `SELECT * FROM cosmos_skills
         WHERE organization_id = $1 AND space_id = $2 AND id = $3
         FOR UPDATE`,
        [organizationId, spaceId, skillId],
      )
      if (!existing.rows[0]) return null

      const current = existing.rows[0]
      if (current.status === 'archived') return null
      if (current.version !== expectedVersion) {
        throw new SkillVersionConflictError(expectedVersion, current.version)
      }
      if (request.content !== undefined && current.source !== 'inline') {
        throw new SkillSourceMismatchError('content')
      }
      if (request.url !== undefined && current.source !== 'url') {
        throw new SkillSourceMismatchError('url')
      }

      const updated = await client.query<SkillRow>(
        `UPDATE cosmos_skills
         SET description = COALESCE($4, description),
             content = COALESCE($5, content),
             url = COALESCE($6, url),
             tags = COALESCE($7, tags)
         WHERE organization_id = $1 AND space_id = $2 AND id = $3
         RETURNING *`,
        [organizationId, spaceId, skillId,
          request.description ?? null, request.content ?? null,
          request.url ?? null, request.tags ?? null],
      )

      await client.query(
        `INSERT INTO cosmos_skill_audit_events
           (organization_id, space_id, id, skill_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'update', $6, $7, $8)`,
        [organizationId, spaceId, randomUUID(), skillId, actorId,
          updated.rows[0]!.version, requestId, idempotencyKeyHash],
      )

      return { row: updated.rows[0]!, replayed: false }
    })

    if (!result) return null
    return SkillMutationResponseSchema.parse({
      skill: rowToDto(result.row),
      replayed: result.replayed,
    })
  }

  async archiveSkill(scope: SkillMutationScope): Promise<SkillMutationResponse | null> {
    const { organizationId, spaceId, skillId, actorId, requestId, expectedVersion, idempotencyKey } = scope
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<SkillRow>(
        `SELECT * FROM cosmos_skills
         WHERE organization_id = $1 AND space_id = $2 AND id = $3
         FOR UPDATE`,
        [organizationId, spaceId, skillId],
      )
      if (!existing.rows[0]) return null

      const current = existing.rows[0]
      if (current.status === 'archived') return null
      if (current.version !== expectedVersion) {
        throw new SkillVersionConflictError(expectedVersion, current.version)
      }

      const archived = await client.query<SkillRow>(
        `UPDATE cosmos_skills
         SET status = 'archived', archived_at = now()
         WHERE organization_id = $1 AND space_id = $2 AND id = $3
         RETURNING *`,
        [organizationId, spaceId, skillId],
      )

      await client.query(
        `INSERT INTO cosmos_skill_audit_events
           (organization_id, space_id, id, skill_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'archive', $6, $7, $8)`,
        [organizationId, spaceId, randomUUID(), skillId, actorId,
          archived.rows[0]!.version, requestId, idempotencyKeyHash],
      )

      return { row: archived.rows[0]!, replayed: false }
    })

    if (!result) return null
    return SkillMutationResponseSchema.parse({
      skill: rowToDto(result.row),
      replayed: result.replayed,
    })
  }
}

export { EmptySkillRepository }
