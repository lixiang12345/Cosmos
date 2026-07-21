export type EnvironmentProvisioningClaim = {
  organizationId: string
  spaceId: string
  jobId: string
  environmentId: string
  environmentRevisionId: string
  environmentType: 'cloud' | 'daemon'
  image: string
  daemonPoolId: string | null
  attempt: number
  maxAttempts: number
  leaseOwner: string
  leaseToken: number
}

export type EnvironmentProvisioningFailure = {
  code: string
  message: string
  retryable: boolean
}

export interface EnvironmentProvisioningRepository {
  reapExpired(input: { limit: number; retryDelayMs: number }): Promise<{ requeued: number; failed: number }>
  claimNext(input: { leaseOwner: string; leaseDurationMs: number }): Promise<EnvironmentProvisioningClaim | null>
  heartbeat(input: { claim: EnvironmentProvisioningClaim; leaseDurationMs: number }): Promise<boolean>
  complete(claim: EnvironmentProvisioningClaim): Promise<boolean>
  fail(input: {
    claim: EnvironmentProvisioningClaim
    failure: EnvironmentProvisioningFailure
    retryDelayMs: number
  }): Promise<'requeued' | 'failed' | 'fence_lost'>
}

export class EnvironmentProvisionerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'EnvironmentProvisionerError'
  }
}

export interface EnvironmentProvisioner {
  provision(claim: EnvironmentProvisioningClaim, signal: AbortSignal): Promise<void>
}

export class UnavailableEnvironmentProvisioner implements EnvironmentProvisioner {
  provision(claim: EnvironmentProvisioningClaim): Promise<void> {
    return Promise.reject(claim.environmentType === 'cloud'
      ? new EnvironmentProvisionerError(
          'cloud_provisioner_unavailable',
          'Cloud provisioning is unavailable because no provider credential is configured.',
          false,
        )
      : new EnvironmentProvisionerError(
          'daemon_pool_unavailable',
          'Daemon provisioning is unavailable because the selected daemon pool is not connected.',
          true,
        ))
  }
}
