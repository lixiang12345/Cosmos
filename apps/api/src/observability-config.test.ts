import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const rulesPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../ops/observability/relay-alerts.yaml',
)

describe('observability deployment assets', () => {
  it('ships bounded SLO recording rules and actionable alerts', async () => {
    const source = await readFile(rulesPath, 'utf8')
    const document = parse(source) as {
      groups?: Array<{ rules?: Array<Record<string, unknown>> }>
    }
    const rules = document.groups?.flatMap((group) => group.rules ?? []) ?? []
    const alertNames = rules.flatMap((rule) => typeof rule.alert === 'string' ? [rule.alert] : [])

    expect(alertNames).toEqual(expect.arrayContaining([
      'RelayApiTargetDown',
      'RelayApiAvailabilityFastBurn',
      'RelayApiLatencyP95High',
      'RelaySseConnectionCapacityHigh',
    ]))
    expect(rules.filter((rule) => rule.alert).every((rule) => (
      typeof rule.for === 'string'
      && typeof rule.expr === 'string'
      && !rule.expr.includes('organization_id')
      && !rule.expr.includes('session_id')
      && !rule.expr.includes('actor_id')
    ))).toBe(true)
    expect(source).toContain('sum by (cluster, environment, service)')
    expect(source).not.toMatch(/password|secret|token|webhook_url/i)
  })
})
