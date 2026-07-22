import { describe, expect, it } from 'vitest'
import {
  advanceEnvironmentProvisioning,
  createEnvironment,
  createFile,
  injectEvent,
  selectControlPlaneScope,
  switchSpace,
  updateFile,
} from './operations'
import { createSeededControlPlaneState } from './seed'

describe('control plane operations', () => {
  it('filters resources after switching Spaces', () => {
    const initial = createSeededControlPlaneState()
    const switched = switchSpace(initial, 'space-platform', '2026-07-12T04:00:00.000Z')
    const scope = selectControlPlaneScope(switched.state)

    expect(scope.space.id).toBe('space-platform')
    expect(scope.repositories.map((repository) => repository.fullName)).toEqual(['platform/identity-service'])
    expect(scope.repositories.every((repository) => repository.spaceId === 'space-platform')).toBe(true)
  })

  it('advances environment provisioning deterministically', () => {
    const initial = createSeededControlPlaneState()
    const created = createEnvironment(initial, {
      name: 'Payment verification',
      image: 'cosmos-ubuntu-22.04',
    }, '2026-07-12T04:00:00.000Z')

    const pulling = advanceEnvironmentProvisioning(created.state, created.value.id, '2026-07-12T04:00:01.000Z')
    const configuring = advanceEnvironmentProvisioning(pulling.state, created.value.id, '2026-07-12T04:00:02.000Z')
    const ready = advanceEnvironmentProvisioning(configuring.state, created.value.id, '2026-07-12T04:00:03.000Z')

    expect(pulling.value.provisioning.phase).toBe('pulling_image')
    expect(configuring.value.provisioning.phase).toBe('configuring')
    expect(ready.value).toMatchObject({ status: 'ready', provisioning: { phase: 'ready', progress: 100 } })
  })

  it('matches inbound events once and returns a Session draft', () => {
    const initial = createSeededControlPlaneState()
    const input = {
      source: 'github' as const,
      trigger: 'issues.opened',
      externalId: 'github:issue:payment:42',
      receivedAt: '2026-07-12T04:00:00.000Z',
      payload: {
        action: 'opened',
        title: 'Protect coupon redemption from concurrent requests',
        repository: { full_name: 'commerce/payment-service', owner: 'commerce' },
      },
    }

    const injected = injectEvent(initial, input)
    const duplicate = injectEvent(injected.state, input)

    expect(injected.value.event).toMatchObject({
      status: 'matched',
      matchedAutomationId: 'automation-github-issue-pr',
    })
    expect(injected.value.sessionDraft).toMatchObject({
      expertId: 'expert-seed-pr-author',
      repositoryId: 'repo-payment-service',
    })
    expect(duplicate.value.duplicate).toBe(true)
    expect(duplicate.state.inboundEvents).toHaveLength(injected.state.inboundEvents.length)
  })

  it('creates immutable MemoryFile versions on content updates', () => {
    const initial = createSeededControlPlaneState()
    const created = createFile(initial, {
      path: 'docs/release-policy.md',
      content: 'Require approval before production release.',
    }, '2026-07-12T04:00:00.000Z')
    const updated = updateFile(created.state, created.value.id, {
      content: 'Require approval and rollback evidence before production release.',
    }, '2026-07-12T04:01:00.000Z')

    expect(updated.value.version).toBe(2)
    expect(updated.value.versions.map((version) => version.version)).toEqual([1, 2])
    expect(updated.value.versions[0].content).toBe('Require approval before production release.')
  })
})
