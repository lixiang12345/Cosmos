import { describe, expect, it } from 'vitest'
import { AdvisorPlanDtoSchema, AdvisorPlanProposalSchema } from '../src/index.js'

const now = '2026-07-22T00:00:00.000Z'
const state = {
  name: 'Platform Engineering', description: '', defaultExpertId: null,
  defaultEnvironmentId: null, isDefault: true, version: 1,
}

describe('Advisor contracts', () => {
  it('accepts one controlled mutation plus manual OAuth and Secret actions', () => {
    expect(AdvisorPlanProposalSchema.parse({
      summary: 'Update the Space after the operator completes authorization.',
      dependencies: ['A published Expert is available.'],
      risks: ['New Sessions will inherit the updated defaults.'],
      steps: [
        { kind: 'control_plane', operation: 'space.update', changes: { description: 'Delivery workspace.' }, rationale: 'Clarify ownership.' },
        { kind: 'manual_action', action: 'oauth', label: 'Authorize GitHub', instructions: 'Open trusted integration settings and complete OAuth.' },
        { kind: 'manual_action', action: 'secret', label: 'Add signing key', instructions: 'Create a Secret reference in trusted settings.' },
      ],
    }).steps).toHaveLength(3)
  })

  it('rejects multiple mutations and arbitrary control-plane fields', () => {
    expect(() => AdvisorPlanProposalSchema.parse({
      summary: 'Unsafe plan', dependencies: [], risks: [],
      steps: [
        { kind: 'control_plane', operation: 'organization.set_default_space', rationale: 'Use this Space.' },
        { kind: 'control_plane', operation: 'space.update', changes: { description: 'x' }, rationale: 'Change it.' },
      ],
    })).toThrow()
    expect(() => AdvisorPlanProposalSchema.parse({
      summary: 'Unsafe plan', dependencies: [], risks: [],
      steps: [{ kind: 'control_plane', operation: 'space.update', changes: { secret: 'plaintext' }, rationale: 'No.' }],
    })).toThrow()
  })

  it('parses an authoritative plan with before and after state', () => {
    expect(AdvisorPlanDtoSchema.parse({
      organizationId: 'cosmos', spaceId: 'space-platform', sessionId: 'session-1', id: 'plan-1',
      summary: 'Update the Space description.', dependencies: [], risks: [], status: 'proposed',
      steps: [{
        id: 'step-1', ordinal: 1, kind: 'control_plane', operation: 'space.update',
        targetType: 'space', targetId: 'space-platform', rationale: 'Clarify ownership.',
        before: state, after: { ...state, description: 'Delivery workspace.' }, manualAction: null,
        riskLevel: 'medium', status: 'proposed', failureCode: null, failureMessage: null,
        startedAt: null, completedAt: null, version: 1,
      }],
      requestedBy: 'user-a', confirmedBy: null, confirmedAt: null,
      createdAt: now, updatedAt: now, version: 1,
    }).status).toBe('proposed')
  })
})
