export type RunStatus = 'queued' | 'running' | 'paused' | 'waiting' | 'completed' | 'failed' | 'canceled'

export type StepStatus = 'completed' | 'active' | 'pending' | 'failed'

export type RunStep = {
  id: string
  label: string
  detail: string
  status: StepStatus
  duration?: string
}

export type RunEvent = {
  id: string
  kind: 'request' | 'agent' | 'tool' | 'result' | 'approval'
  actor: string
  title: string
  body: string
  timestamp: string
  meta?: string
  status?: 'success' | 'working' | 'warning'
}

export type ChangedFile = {
  path: string
  status: 'M' | 'A' | 'D'
  additions: number
  deletions: number
}

export type Approval = {
  title: string
  risk: 'low' | 'medium' | 'high'
  reasons: string[]
  recommendation: string
  id?: string
  status?: 'pending' | 'approved' | 'changes_requested' | 'expired'
  requestedAt?: string
  decidedAt?: string
  decisionNote?: string
  commitSha?: string
}

export type RunAttempt = {
  id: string
  number: number
  status: 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
  startedAt: string
  finishedAt?: string
  duration?: string
  failureReason?: string
}

export type RunArtifact = {
  id: string
  type: 'pull_request' | 'branch' | 'linear_issue' | 'link' | 'test_report'
  label: string
  url: string
  status?: 'open' | 'merged' | 'ready' | 'generated'
}

export type RunWorker = {
  id: string
  name: string
  task: string
  status: 'queued' | 'running' | 'completed' | 'failed'
}

export type Run = {
  id: string
  spaceId?: string
  title: string
  favorite?: boolean
  archived?: boolean
  repo: string
  branch: string
  expert: string
  expertId?: string
  expertVersion?: number
  status: RunStatus
  trigger: string
  source?: 'manual' | 'automation'
  automationId?: string
  sourceEventId?: string
  environmentId?: string
  visibility?: 'private' | 'space'
  updatedAt: string
  elapsed: string
  progress: number
  model: string
  summary: string
  baseBranch?: string
  acceptanceCriteria?: string[]
  contextItems?: TaskContextItem[]
  attachments?: string[]
  steps: RunStep[]
  events: RunEvent[]
  files: ChangedFile[]
  terminal: string[]
  approval?: Approval
  attempts?: RunAttempt[]
  artifacts?: RunArtifact[]
  workers?: RunWorker[]
}

export type TaskContextItem = {
  id: string
  kind: 'github' | 'slack'
  label: string
  url: string
}

export type TaskCreateMode = 'run' | 'draft'

export type NewTaskInput = {
  title: string
  description: string
  repo: string
  expert: string
  expertId?: string
  expertVersion?: number
  environmentId?: string
  visibility?: 'private' | 'space'
  baseBranch: string
  acceptanceCriteria: string[]
  contextItems: TaskContextItem[]
  attachments?: string[]
}
