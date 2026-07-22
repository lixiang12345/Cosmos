import type { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg'
import { Pool as PostgresPool } from 'pg'

export type RuntimeDatabaseRole =
  | 'relay_api_runtime'
  | 'relay_worker_runtime'
  | 'relay_observer_runtime'

export type ApiDatabaseContext = {
  actorId: string
  organizationId?: string
  spaceId?: string
}

function contextValue(value: string | undefined, name: string) {
  const normalized = value?.trim() ?? ''
  if (normalized.length > 256) throw new Error(`${name} must not exceed 256 characters.`)
  return normalized
}

export async function setLocalApiDatabaseContext(
  client: Pick<PoolClient, 'query'>,
  context: ApiDatabaseContext,
) {
  const actorId = contextValue(context.actorId, 'Database actor id')
  if (!actorId) throw new Error('Database actor id is required.')
  await client.query(`
    SELECT
      set_config('relay.actor_id', $1, true),
      set_config('relay.organization_id', $2, true),
      set_config('relay.space_id', $3, true)
  `, [
    actorId,
    contextValue(context.organizationId, 'Database organization id'),
    contextValue(context.spaceId, 'Database Space id'),
  ])
}

export async function withApiDatabaseContext<T>(
  pool: Pool,
  context: ApiDatabaseContext,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await setLocalApiDatabaseContext(client, context)
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

export async function queryWithApiDatabaseContext<Row extends QueryResultRow>(
  pool: Pool,
  context: ApiDatabaseContext,
  query: string,
  values: unknown[],
): Promise<QueryResult<Row>> {
  return withApiDatabaseContext(pool, context, (client) => client.query<Row>(query, values))
}

export function createRuntimePool(
  role: RuntimeDatabaseRole,
  config: Omit<PoolConfig, 'options'>,
  onClientError: (error: Error) => void,
): Pool {
  const pool = new PostgresPool({ ...config, options: `-c role=${role}` })
  pool.on('error', onClientError)
  pool.on('connect', (client) => client.on('error', onClientError))
  return pool
}

export async function assertRuntimeDatabaseRole(pool: Pool, expected: RuntimeDatabaseRole) {
  const result = await pool.query<{
    role: string
    superuser: boolean
    bypassrls: boolean
    canlogin: boolean
    inherit: boolean
  }>(`
    SELECT current_user AS role, rolsuper AS superuser, rolbypassrls AS bypassrls,
      rolcanlogin AS canlogin, rolinherit AS inherit
    FROM pg_roles
    WHERE rolname = current_user
  `)
  const role = result.rows[0]
  if (!role
    || role.role !== expected
    || role.superuser
    || role.bypassrls
    || role.canlogin
    || role.inherit) {
    throw new Error(`Database connection must assume the restricted ${expected} role.`)
  }
}
