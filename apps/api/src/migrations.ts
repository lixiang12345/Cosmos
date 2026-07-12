import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')
const nonTransactionalMarker = '-- relay-migration: non-transactional'

export async function runMigrations(pool: Pool) {
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort()

  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const client = await pool.connect()
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('relay-schema-migrations', 0))")
    for (const version of files) {
      const sql = await readFile(resolve(migrationsDirectory, version), 'utf8')
      if (sql.startsWith(nonTransactionalMarker)) {
        const applied = await client.query(
          'SELECT version FROM relay_schema_migrations WHERE version = $1',
          [version],
        )
        if (applied.rowCount === 0) {
          await client.query(sql)
          await client.query(
            'INSERT INTO relay_schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
            [version],
          )
        }
        continue
      }

      await client.query('BEGIN')
      try {
        const applied = await client.query(
          'SELECT version FROM relay_schema_migrations WHERE version = $1',
          [version],
        )
        if (applied.rowCount === 0) {
          await client.query(sql)
          await client.query('INSERT INTO relay_schema_migrations (version) VALUES ($1)', [version])
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended('relay-schema-migrations', 0))")
    client.release()
  }
}
