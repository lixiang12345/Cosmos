import { createHash, randomUUID } from 'node:crypto'
import {
  SpaceDtoSchema,
  SpaceMigrationPreviewSchema,
  SpaceMutationResponseSchema,
  type SpaceDto,
} from '@relay/contracts'
import type { Pool, PoolClient } from 'pg'
import { queryWithApiDatabaseContext, withApiDatabaseContext } from './postgres-runtime-database.js'
import {
  SpaceIdempotencyConflictError,
  SpacePermissionError,
  SpaceValidationError,
  SpaceVersionConflictError,
  type SpaceMutationResult,
  type SpaceMutationScope,
  type SpaceRepository,
  type SpaceScope,
} from './space-repository.js'

type SpaceRow = {
  id: string
  organization_id: string
  name: string
  slug: string
  description: string
  is_default: boolean
  status: 'active' | 'migrating' | 'archived'
  default_expert_id: string | null
  default_environment_id: string | null
  settings: unknown
  version: number
  created_at: string | Date
  updated_at: string | Date
}

const columns = `space.id, space.organization_id, space.name, space.slug,
  space.description, COALESCE(organization.default_space_id = space.id, false) AS is_default,
  space.status, space.default_expert_id, space.default_environment_id,
  space.settings, space.version, space.created_at, space.updated_at`

function timestamp(value: string | Date) {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function mapSpace(row: SpaceRow): SpaceDto {
  return SpaceDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    isDefault: row.is_default,
    status: row.status,
    defaultExpertId: row.default_expert_id,
    defaultEnvironmentId: row.default_environment_id,
    settings: row.settings,
    version: row.version,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  })
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function slugify(name: string) {
  const slug = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || `space-${hash(name).slice(0, 8)}`
}

export type PostgresSpaceRepositoryOptions = {
  createId?: () => string
  now?: () => Date
  idempotencyTtlMs?: number
}

export class PostgresSpaceRepository implements SpaceRepository {
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly idempotencyTtlMs: number

  constructor(private readonly pool: Pool, options: PostgresSpaceRepositoryOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.idempotencyTtlMs = options.idempotencyTtlMs ?? 24 * 60 * 60 * 1_000
  }

  private async prepareIdempotency(
    client: PoolClient,
    input: SpaceScope & { method: 'POST' | 'PATCH'; canonicalPath: string; idempotencyKey: string; request: unknown },
  ) {
    const keyHash = hash(input.idempotencyKey)
    const requestHash = hash(canonicalJson(input.request))
    const now = this.now()
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify([input.organizationId, input.actorId, input.method, input.canonicalPath, keyHash]),
    ])
    const existing = await client.query<{ request_hash: string; response_body: unknown }>(`
      SELECT request_hash, response_body FROM relay_space_idempotency
      WHERE organization_id = $1 AND actor_id = $2 AND method = $3
        AND canonical_path = $4 AND idempotency_key_hash = $5 AND expires_at > $6
    `, [input.organizationId, input.actorId, input.method, input.canonicalPath, keyHash, now.toISOString()])
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) throw new SpaceIdempotencyConflictError()
      return { keyHash, requestHash, now, replay: existing.rows[0].response_body }
    }
    await client.query(`DELETE FROM relay_space_idempotency
      WHERE organization_id = $1 AND actor_id = $2 AND method = $3
        AND canonical_path = $4 AND idempotency_key_hash = $5 AND expires_at <= $6`,
    [input.organizationId, input.actorId, input.method, input.canonicalPath, keyHash, now.toISOString()])
    return { keyHash, requestHash, now, replay: null }
  }

  private async saveIdempotency(client: PoolClient, input: SpaceScope & {
    method: 'POST' | 'PATCH'; canonicalPath: string; keyHash: string; requestHash: string
    responseBody: unknown; statusCode: number
  }) {
    await client.query(`INSERT INTO relay_space_idempotency (
      organization_id, actor_id, method, canonical_path, idempotency_key_hash,
      request_hash, status_code, response_body, expires_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`, [
      input.organizationId, input.actorId, input.method, input.canonicalPath, input.keyHash,
      input.requestHash, input.statusCode, JSON.stringify(input.responseBody),
      new Date(this.now().getTime() + this.idempotencyTtlMs).toISOString(),
    ])
  }

  private async appendLedger(client: PoolClient, input: SpaceScope & {
    spaceId: string; action: string; version: number; keyHash?: string
  }) {
    const occurredAt = this.now().toISOString()
    await client.query(`INSERT INTO relay_space_audit_events (
      organization_id,id,space_id,actor_id,action,resource_version,request_id,
      idempotency_key_hash,occurred_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
      input.organizationId, this.createId(), input.spaceId, input.actorId,
      input.action, input.version, input.requestId, input.keyHash ?? null, occurredAt,
    ])
    await client.query(`INSERT INTO relay_space_outbox_events (
      organization_id,id,space_id,event_type,payload,occurred_at
    ) VALUES ($1,$2,$3,$4,'{}'::jsonb,$5)`, [
      input.organizationId, this.createId(), input.spaceId, input.action, occurredAt,
    ])
  }

  private selectOne(client: PoolClient, organizationId: string, spaceId: string, lock = false) {
    return client.query<SpaceRow>(`SELECT ${columns} FROM relay_spaces space
      JOIN relay_organizations organization ON organization.id = space.organization_id
      WHERE space.organization_id = $1 AND space.id = $2${lock ? ' FOR UPDATE OF space' : ''}`,
    [organizationId, spaceId])
  }

  async listSpaces(organizationId: string, actorId: string) {
    const result = await queryWithApiDatabaseContext<SpaceRow>(this.pool, { organizationId, actorId }, `
      SELECT ${columns} FROM relay_spaces space
      JOIN relay_organizations organization ON organization.id = space.organization_id
      WHERE space.organization_id = $1 AND space.status <> 'archived'
      ORDER BY is_default DESC, space.name, space.id
    `, [organizationId])
    return result.rows.map(mapSpace)
  }

  async getSpace(organizationId: string, spaceId: string, actorId: string) {
    const result = await queryWithApiDatabaseContext<SpaceRow>(this.pool, {
      organizationId, spaceId, actorId,
    }, `SELECT ${columns} FROM relay_spaces space
      JOIN relay_organizations organization ON organization.id = space.organization_id
      WHERE space.organization_id = $1 AND space.id = $2`, [organizationId, spaceId])
    return result.rows[0] ? mapSpace(result.rows[0]) : null
  }

  async createSpace(record: SpaceScope & { idempotencyKey: string; request: { name: string; slug?: string; description: string } }) {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const canonicalPath = `/v1/organizations/${record.organizationId}/spaces`
      const idempotency = await this.prepareIdempotency(client, {
        ...record, method: 'POST', canonicalPath, request: record.request,
      })
      if (idempotency.replay) {
        const response = SpaceMutationResponseSchema.parse(idempotency.replay)
        return { space: response.space, replayed: true }
      }
      const role = await client.query<{ role: string }>(`SELECT role FROM relay_organization_memberships
        WHERE organization_id = $1 AND actor_id = $2`, [record.organizationId, record.actorId])
      if (!['organization_owner', 'organization_admin'].includes(role.rows[0]?.role ?? '')) {
        throw new SpacePermissionError('Only Organization owners and admins can create Spaces.')
      }
      const id = this.createId()
      const now = idempotency.now.toISOString()
      const slug = record.request.slug ?? slugify(record.request.name)
      try {
        await client.query(`INSERT INTO relay_spaces (
          organization_id,id,name,slug,description,status,settings,version,created_at,updated_at
        ) VALUES ($1,$2,$3,$4,$5,'active','{}'::jsonb,1,$6,$6)
        `, [
          record.organizationId, id, record.request.name, slug, record.request.description, now,
        ])
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new SpaceValidationError('Space slug already exists.', 'slug')
        throw error
      }
      await client.query(`INSERT INTO relay_space_memberships (
        organization_id,space_id,actor_id,role,created_at
      ) VALUES ($1,$2,$3,'space_manager',$4)`, [record.organizationId, id, record.actorId, now])
      await client.query(`UPDATE relay_organizations SET default_space_id = COALESCE(default_space_id, $2)
        WHERE id = $1`, [record.organizationId, id])
      const selected = await this.selectOne(client, record.organizationId, id)
      const space = mapSpace(selected.rows[0]!)
      await this.appendLedger(client, { ...record, spaceId: id, action: 'space.created', version: 1, keyHash: idempotency.keyHash })
      const response = SpaceMutationResponseSchema.parse({ space, replayed: false })
      await this.saveIdempotency(client, {
        ...record, method: 'POST', canonicalPath, keyHash: idempotency.keyHash,
        requestHash: idempotency.requestHash, responseBody: response, statusCode: 201,
      })
      return { space, replayed: false }
    })
  }

  private async lockSpace(client: PoolClient, record: SpaceMutationScope) {
    const result = await this.selectOne(client, record.organizationId, record.spaceId, true)
    const row = result.rows[0]
    if (!row) return null
    if (row.version !== record.expectedVersion) throw new SpaceVersionConflictError(record.expectedVersion, row.version)
    return row
  }

  private async validateDefaults(client: PoolClient, record: SpaceMutationScope & {
    request: { defaultExpertId?: string | null; defaultEnvironmentId?: string | null }
  }) {
    if (record.request.defaultExpertId) {
      const expert = await client.query(`SELECT 1 FROM relay_experts WHERE organization_id=$1 AND space_id=$2
        AND id=$3 AND status='published' AND published_revision_id IS NOT NULL`, [
        record.organizationId, record.spaceId, record.request.defaultExpertId,
      ])
      if (!expert.rows[0]) throw new SpaceValidationError('Default Expert must be published in this Space.', 'defaultExpertId')
    }
    if (record.request.defaultEnvironmentId) {
      const environment = await client.query(`SELECT 1 FROM relay_environments WHERE organization_id=$1 AND space_id=$2
        AND id=$3 AND status='ready' AND active_revision_id IS NOT NULL`, [
        record.organizationId, record.spaceId, record.request.defaultEnvironmentId,
      ])
      if (!environment.rows[0]) throw new SpaceValidationError('Default Environment must be ready in this Space.', 'defaultEnvironmentId')
    }
  }

  async updateSpace(record: SpaceMutationScope & { request: {
    name?: string; description?: string; defaultExpertId?: string | null
    defaultEnvironmentId?: string | null; settings?: Record<string, unknown>
  } }): Promise<SpaceMutationResult | null> {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}`
      const idempotency = await this.prepareIdempotency(client, {
        ...record, method: 'PATCH', canonicalPath,
        request: { expectedVersion: record.expectedVersion, ...record.request },
      })
      if (idempotency.replay) {
        const response = SpaceMutationResponseSchema.parse(idempotency.replay)
        return { space: response.space, replayed: true }
      }
      const current = await this.lockSpace(client, record)
      if (!current) return null
      if (current.is_default && record.request.name !== undefined && record.request.name !== current.name) {
        throw new SpaceValidationError('The Default Space cannot be renamed.', 'name')
      }
      if (current.status !== 'active') throw new SpaceValidationError('Only active Spaces can be updated.')
      await this.validateDefaults(client, record)
      const now = idempotency.now.toISOString()
      const result = await client.query<SpaceRow>(`UPDATE relay_spaces space SET
        name=COALESCE($3,space.name), description=COALESCE($4,space.description),
        default_expert_id=CASE WHEN $5 THEN $6 ELSE space.default_expert_id END,
        default_environment_id=CASE WHEN $7 THEN $8 ELSE space.default_environment_id END,
        settings=COALESCE($9::jsonb,space.settings), version=space.version+1, updated_at=$10
        FROM relay_organizations organization
        WHERE space.organization_id=$1 AND space.id=$2 AND organization.id=space.organization_id
        RETURNING ${columns}
      `, [record.organizationId, record.spaceId, record.request.name ?? null,
        record.request.description ?? null, record.request.defaultExpertId !== undefined,
        record.request.defaultExpertId ?? null, record.request.defaultEnvironmentId !== undefined,
        record.request.defaultEnvironmentId ?? null,
        record.request.settings === undefined ? null : JSON.stringify(record.request.settings), now])
      const space = mapSpace(result.rows[0]!)
      await this.appendLedger(client, { ...record, action: 'space.updated', version: space.version, keyHash: idempotency.keyHash })
      const response = SpaceMutationResponseSchema.parse({ space, replayed: false })
      await this.saveIdempotency(client, { ...record, method: 'PATCH', canonicalPath,
        keyHash: idempotency.keyHash, requestHash: idempotency.requestHash,
        responseBody: response, statusCode: 200 })
      return { space, replayed: false }
    })
  }

  async setDefaultSpace(record: SpaceMutationScope): Promise<SpaceMutationResult | null> {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/default`
      const idempotency = await this.prepareIdempotency(client, { ...record, method: 'POST', canonicalPath,
        request: { expectedVersion: record.expectedVersion } })
      if (idempotency.replay) {
        const response = SpaceMutationResponseSchema.parse(idempotency.replay)
        return { space: response.space, replayed: true }
      }
      const current = await this.lockSpace(client, record)
      if (!current) return null
      if (current.status !== 'active') throw new SpaceValidationError('Only an active Space can become the Default Space.')
      const role = await client.query<{ role: string }>(`SELECT role FROM relay_organization_memberships
        WHERE organization_id=$1 AND actor_id=$2`, [record.organizationId, record.actorId])
      if (!['organization_owner', 'organization_admin'].includes(role.rows[0]?.role ?? '')) {
        throw new SpacePermissionError('Only Organization owners and admins can change the Default Space.')
      }
      await client.query('UPDATE relay_organizations SET default_space_id=$2 WHERE id=$1', [record.organizationId, record.spaceId])
      const now = idempotency.now.toISOString()
      const updated = await client.query<SpaceRow>(`UPDATE relay_spaces space SET version=version+1,updated_at=$3
        FROM relay_organizations organization WHERE space.organization_id=$1 AND space.id=$2
          AND organization.id=space.organization_id RETURNING ${columns}`,
      [record.organizationId, record.spaceId, now])
      const space = mapSpace(updated.rows[0]!)
      await this.appendLedger(client, { ...record, action: 'space.default_changed', version: space.version, keyHash: idempotency.keyHash })
      const response = SpaceMutationResponseSchema.parse({ space, replayed: false })
      await this.saveIdempotency(client, { ...record, method: 'POST', canonicalPath,
        keyHash: idempotency.keyHash, requestHash: idempotency.requestHash,
        responseBody: response, statusCode: 200 })
      return { space, replayed: false }
    })
  }

  async previewMigration(organizationId: string, spaceId: string, targetSpaceId: string, actorId: string) {
    return withApiDatabaseContext(this.pool, { organizationId, spaceId, actorId }, async (client) => {
      if (spaceId === targetSpaceId) throw new SpaceValidationError('Migration target must be a different Space.', 'targetSpaceId')
      const [sourceResult, targetResult] = await Promise.all([
        this.selectOne(client, organizationId, spaceId), this.selectOne(client, organizationId, targetSpaceId),
      ])
      if (!sourceResult.rows[0] || !targetResult.rows[0]) return null
      const source = mapSpace(sourceResult.rows[0])
      const target = mapSpace(targetResult.rows[0])
      const counts = await client.query<{ sessions: string; experts: string; environments: string; automations: string; files: string }>(`
        SELECT
          (SELECT count(*) FROM relay_sessions WHERE organization_id=$1 AND space_id=$2)::text AS sessions,
          (SELECT count(*) FROM relay_experts WHERE organization_id=$1 AND space_id=$2)::text AS experts,
          (SELECT count(*) FROM relay_environments WHERE organization_id=$1 AND space_id=$2)::text AS environments,
          (SELECT count(*) FROM relay_expert_triggers WHERE organization_id=$1 AND space_id=$2)::text AS automations,
          (SELECT count(*) FROM relay_files WHERE organization_id=$1 AND space_id=$2)::text AS files
      `, [organizationId, spaceId])
      const blockingReasons = [
        ...(source.isDefault ? ['The Default Space cannot be migrated or deleted. Select another Default Space first.'] : []),
        ...(source.status !== 'active' ? ['Only an active source Space can enter migration.'] : []),
        ...(target.status !== 'active' ? ['The migration target must be active.'] : []),
      ]
      const row = counts.rows[0]!
      return SpaceMigrationPreviewSchema.parse({
        source, target,
        resourceCounts: {
          sessions: Number(row.sessions), experts: Number(row.experts),
          environments: Number(row.environments), automations: Number(row.automations), files: Number(row.files),
        },
        canMigrate: blockingReasons.length === 0,
        blockingReasons,
      })
    })
  }
}
