import { describe, expect, it } from 'vitest'
import { automationEventMessage, evaluateAutomationFilter, redactAutomationData } from './automation-filter.js'

describe('Automation filter runtime', () => {
  it('evaluates restricted JSONLogic without executing code', () => {
    const payload = { action: 'opened', labels: ['bug', 'p1'], repository: { name: 'platform' } }
    expect(evaluateAutomationFilter({ '==': [{ var: 'action' }, 'opened'] }, payload)).toBe(true)
    expect(evaluateAutomationFilter({ and: [{ '==': [{ var: 'action' }, 'opened'] }, { in: ['p1', { var: 'labels' }] }] }, payload)).toBe(true)
    expect(evaluateAutomationFilter({ '==': [{ var: 'action' }, 'closed'] }, payload)).toBe(false)
  })

  it('redacts sensitive headers and payload keys before persistence or Session messages', () => {
    const safe = redactAutomationData({ authorization: 'Bearer secret', nested: { token: 'hidden', ok: true } })
    expect(safe).toEqual({ authorization: '[REDACTED]', nested: { token: '[REDACTED]', ok: true } })
    expect(automationEventMessage({ source: 'github', eventType: 'pull_request.opened', externalId: 'event-1', payload: safe })).not.toContain('Bearer secret')
  })
})
