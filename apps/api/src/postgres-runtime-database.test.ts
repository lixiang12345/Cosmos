import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { PoolClient } from 'pg'
import { createRuntimePool } from './postgres-runtime-database.js'

describe('runtime database pool', () => {
  it('routes pool and active client errors to the required handler', async () => {
    const onClientError = vi.fn()
    const pool = createRuntimePool('cosmos_api_runtime', {
      connectionString: 'postgres://unused:unused@127.0.0.1:1/unused',
    }, onClientError)
    const poolError = new Error('sensitive idle connection failure')
    const clientError = new Error('sensitive active connection failure')
    const client = new EventEmitter() as unknown as PoolClient

    pool.emit('error', poolError)
    pool.emit('connect', client)
    client.emit('error', clientError)

    expect(onClientError).toHaveBeenNthCalledWith(1, poolError)
    expect(onClientError).toHaveBeenNthCalledWith(2, clientError)
    await pool.end()
  })
})
