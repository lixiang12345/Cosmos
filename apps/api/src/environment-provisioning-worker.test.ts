import { describe, expect, it, vi } from 'vitest'
import {
  EnvironmentProvisionerError,
  UnavailableEnvironmentProvisioner,
  type EnvironmentProvisioningClaim,
  type EnvironmentProvisioningRepository,
} from './environment-provisioning-repository.js'
import { EnvironmentProvisioningWorker } from './environment-provisioning-worker.js'

const claim: EnvironmentProvisioningClaim = {
  organizationId: 'organization-a',
  spaceId: 'space-a',
  jobId: 'job-1',
  environmentId: 'environment-a',
  environmentRevisionId: 'revision-1',
  environmentType: 'cloud',
  image: 'ghcr.io/cosmos/runtime:stable',
  daemonPoolId: null,
  attempt: 1,
  maxAttempts: 3,
  leaseOwner: 'worker-1',
  leaseToken: 1,
}

function repository(overrides: Partial<EnvironmentProvisioningRepository> = {}) {
  return {
    reapExpired: vi.fn().mockResolvedValue({ requeued: 0, failed: 0 }),
    claimNext: vi.fn().mockResolvedValue(claim),
    heartbeat: vi.fn().mockResolvedValue(true),
    complete: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue('failed'),
    ...overrides,
  } satisfies EnvironmentProvisioningRepository
}

function worker(
  environmentRepository: EnvironmentProvisioningRepository,
  provisioner: { provision: (claim: EnvironmentProvisioningClaim, signal: AbortSignal) => Promise<void> },
) {
  return new EnvironmentProvisioningWorker({
    repository: environmentRepository,
    provisioner,
    workerId: 'worker-1',
    leaseDurationMs: 30_000,
    heartbeatIntervalMs: 5_000,
    pollIntervalMs: 10,
    recoveryBatchSize: 10,
  })
}

describe('EnvironmentProvisioningWorker', () => {
  it('completes a claimed Environment only after the provisioner succeeds', async () => {
    const environmentRepository = repository()
    const provision = vi.fn().mockResolvedValue(undefined)

    await expect(worker(environmentRepository, { provision }).runOnce()).resolves.toBe(true)

    expect(provision).toHaveBeenCalledWith(claim, expect.any(AbortSignal))
    expect(environmentRepository.complete).toHaveBeenCalledWith(claim)
    expect(environmentRepository.fail).not.toHaveBeenCalled()
  })

  it('records a safe unavailable failure instead of reporting a fake ready state', async () => {
    const environmentRepository = repository()

    await worker(environmentRepository, new UnavailableEnvironmentProvisioner()).runOnce()

    expect(environmentRepository.complete).not.toHaveBeenCalled()
    expect(environmentRepository.fail).toHaveBeenCalledWith({
      claim,
      failure: {
        code: 'cloud_provisioner_unavailable',
        message: 'Cloud provisioning is unavailable because no provider credential is configured.',
        retryable: false,
      },
      retryDelayMs: 5_000,
    })
  })

  it('maps unexpected provisioner errors to a bounded internal failure', async () => {
    const environmentRepository = repository()
    const provision = vi.fn().mockRejectedValue(new Error('provider response with private detail'))

    await worker(environmentRepository, { provision }).runOnce()

    expect(environmentRepository.fail).toHaveBeenCalledWith(expect.objectContaining({
      failure: {
        code: 'provisioner_internal_error',
        message: 'The Environment provisioner encountered an internal error.',
        retryable: false,
      },
    }))
  })

  it('preserves an explicitly classified safe provisioner error', async () => {
    const environmentRepository = repository()
    const provision = vi.fn().mockRejectedValue(new EnvironmentProvisionerError(
      'daemon_pool_unavailable', 'The daemon pool is not connected.', true,
    ))

    await worker(environmentRepository, { provision }).runOnce()

    expect(environmentRepository.fail).toHaveBeenCalledWith(expect.objectContaining({
      failure: { code: 'daemon_pool_unavailable', message: 'The daemon pool is not connected.', retryable: true },
    }))
  })
})
