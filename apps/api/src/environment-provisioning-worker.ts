import {
  EnvironmentProvisionerError,
  type EnvironmentProvisioner,
  type EnvironmentProvisioningClaim,
  type EnvironmentProvisioningRepository,
} from './environment-provisioning-repository.js'
import type { ExecutionWorkerLogger } from './execution-worker.js'

export type EnvironmentProvisioningWorkerOptions = {
  repository: EnvironmentProvisioningRepository
  provisioner: EnvironmentProvisioner
  workerId: string
  leaseDurationMs: number
  heartbeatIntervalMs: number
  pollIntervalMs: number
  recoveryBatchSize: number
  retryDelayMs?: number
  logger?: ExecutionWorkerLogger
}

const noOpLogger: ExecutionWorkerLogger = { info() {}, error() {} }

function abortableDelay(durationMs: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, durationMs)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export class EnvironmentProvisioningWorker {
  private readonly retryDelayMs: number
  private readonly logger: ExecutionWorkerLogger

  constructor(private readonly options: EnvironmentProvisioningWorkerOptions) {
    this.retryDelayMs = options.retryDelayMs ?? 5_000
    this.logger = options.logger ?? noOpLogger
  }

  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const claimed = await this.runOnce(signal)
        if (!claimed) await abortableDelay(this.options.pollIntervalMs, signal)
      } catch {
        this.logger.error('environment_provisioning_iteration_failed')
        await abortableDelay(this.options.pollIntervalMs, signal)
      }
    }
  }

  async runOnce(signal: AbortSignal = new AbortController().signal) {
    if (signal.aborted) return false
    const recovered = await this.options.repository.reapExpired({
      limit: this.options.recoveryBatchSize,
      retryDelayMs: this.retryDelayMs,
    })
    if (recovered.requeued || recovered.failed) {
      this.logger.info('environment_provisioning_leases_recovered', recovered)
    }
    const claim = await this.options.repository.claimNext({
      leaseOwner: this.options.workerId,
      leaseDurationMs: this.options.leaseDurationMs,
    })
    if (!claim) return false
    await this.executeClaim(claim, signal)
    return true
  }

  private async executeClaim(claim: EnvironmentProvisioningClaim, shutdownSignal: AbortSignal) {
    const provisionAbort = new AbortController()
    const heartbeatStop = new AbortController()
    let leaseLost = false
    const heartbeat = this.maintainHeartbeat(claim, heartbeatStop.signal, () => {
      leaseLost = true
      provisionAbort.abort()
    })
    try {
      await this.options.provisioner.provision(
        claim,
        AbortSignal.any([shutdownSignal, provisionAbort.signal]),
      )
      heartbeatStop.abort()
      await heartbeat
      if (shutdownSignal.aborted || leaseLost) return
      const completed = await this.options.repository.complete(claim)
      if (!completed) this.logger.info('environment_provisioning_completion_fence_lost', { jobId: claim.jobId })
    } catch (error) {
      heartbeatStop.abort()
      await heartbeat
      if (shutdownSignal.aborted || leaseLost) return
      const failure = error instanceof EnvironmentProvisionerError
        ? { code: error.code, message: error.message, retryable: error.retryable }
        : {
            code: 'provisioner_internal_error',
            message: 'The Environment provisioner encountered an internal error.',
            retryable: false,
          }
      await this.options.repository.fail({ claim, failure, retryDelayMs: this.retryDelayMs })
    } finally {
      heartbeatStop.abort()
    }
  }

  private async maintainHeartbeat(
    claim: EnvironmentProvisioningClaim,
    stopSignal: AbortSignal,
    onLost: () => void,
  ) {
    while (!stopSignal.aborted) {
      await abortableDelay(this.options.heartbeatIntervalMs, stopSignal)
      if (stopSignal.aborted) return
      try {
        if (!await this.options.repository.heartbeat({
          claim,
          leaseDurationMs: this.options.leaseDurationMs,
        })) {
          onLost()
          return
        }
      } catch {
        this.logger.error('environment_provisioning_heartbeat_failed', { jobId: claim.jobId })
        onLost()
        return
      }
    }
  }
}
