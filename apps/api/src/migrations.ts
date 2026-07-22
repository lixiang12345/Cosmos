import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')
const nonTransactionalMarker = '-- cosmos-migration: non-transactional'
const concurrentIndexMarker = /^-- cosmos-migration: concurrent-index ([a-z][a-z0-9_]*)$/m
const knownLegacyMigrationVersions = new Set([
  '010_tenant_reference_constraints.sql',
  '011_session_audit_ledgers.sql',
])

async function migrationFiles() {
  return (await readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort()
}

export async function assertMigrationsCurrent(pool: Pool) {
  const files = await migrationFiles()
  const applied = await pool.query<{ version: string }>(
    'SELECT version FROM cosmos_schema_migrations',
  )
  const appliedVersions = new Set(applied.rows.map((row) => row.version))
  const pending = files.filter((file) => !appliedVersions.has(file))
  const unexpected = [...appliedVersions].filter((version) => (
    !files.includes(version) && !knownLegacyMigrationVersions.has(version)
  ))
  if (pending.length > 0) {
    throw new Error(`Database schema has ${pending.length} pending migration(s).`)
  }
  if (unexpected.length > 0) {
    throw new Error(`Database schema has ${unexpected.length} unknown migration(s).`)
  }
}

export async function runMigrations(pool: Pool) {
  const files = await migrationFiles()

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cosmos_schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const client = await pool.connect()
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('cosmos-schema-migrations', 0))")
    for (const version of files) {
      const sql = await readFile(resolve(migrationsDirectory, version), 'utf8')
      if (sql.startsWith(nonTransactionalMarker)) {
        const applied = await client.query(
          'SELECT version FROM cosmos_schema_migrations WHERE version = $1',
          [version],
        )
        if (applied.rowCount === 0) {
          const concurrentIndex = sql.match(concurrentIndexMarker)?.[1]
          if (!concurrentIndex) {
            await client.query(sql)
            await client.query(
              'INSERT INTO cosmos_schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
              [version],
            )
            continue
          }
          await client.query("SET lock_timeout = '5s'")
          try {
            await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${concurrentIndex}"`)
            await client.query(sql)
            await client.query(
              'INSERT INTO cosmos_schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
              [version],
            )
          } finally {
            await client.query('RESET lock_timeout')
          }
        }
        continue
      }

      await client.query('BEGIN')
      try {
        const applied = await client.query(
          'SELECT version FROM cosmos_schema_migrations WHERE version = $1',
          [version],
        )
        if (applied.rowCount === 0) {
          await client.query(sql)
          await client.query('INSERT INTO cosmos_schema_migrations (version) VALUES ($1)', [version])
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended('cosmos-schema-migrations', 0))")
    client.release()
  }
}
