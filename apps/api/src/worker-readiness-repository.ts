export type WorkerReadinessQuery = Readonly<{
  maxAgeMs: number
  workerId?: string
  now?: Date
}>

export interface WorkerReadinessRepository {
  recordHeartbeat(workerId: string, now?: Date): Promise<void>
  removeHeartbeat(workerId: string): Promise<void>
  hasRecentHeartbeat(query: WorkerReadinessQuery): Promise<boolean>
}
