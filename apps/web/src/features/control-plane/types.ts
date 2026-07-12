export const CONTROL_PLANE_SCHEMA_VERSION = 1 as const

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type Space = {
  id: string
  name: string
  slug: string
  description: string
  region: string
  createdAt: string
}

export type ScopedEntity = {
  id: string
  spaceId: string
  createdAt: string
  updatedAt: string
}

export type EnvironmentProvisioningPhase =
  | 'queued'
  | 'pulling_image'
  | 'configuring'
  | 'ready'
  | 'failed'

export type EnvironmentProvisioning = {
  phase: EnvironmentProvisioningPhase
  progress: number
  message: string
  updatedAt: string
}

export type Environment = ScopedEntity & {
  name: string
  slug: string
  image: string
  status: 'provisioning' | 'ready' | 'failed' | 'disabled'
  cpu: number
  memoryGb: number
  timeoutMinutes: number
  networkPolicy: 'restricted' | 'allowlist' | 'unrestricted'
  allowedHosts: string[]
  provisioning: EnvironmentProvisioning
}

export type Daemon = ScopedEntity & {
  name: string
  description: string
  environmentId: string
  enabled: boolean
  status: 'online' | 'offline' | 'degraded'
  capabilities: string[]
  lastHeartbeatAt?: string
}

export type RepositoryProvider = 'github' | 'gitlab' | 'gitee'

export type Repository = ScopedEntity & {
  provider: RepositoryProvider
  owner: string
  name: string
  fullName: string
  defaultBranch: string
  language: string
  installationId: string
  indexStatus: 'ready' | 'indexing' | 'stale' | 'error'
  indexCoverage: number
  policy: 'strict' | 'standard'
  lastSyncedAt: string
}

export type IntegrationType = 'github' | 'slack' | 'jira' | 'pagerduty' | 'linear' | 'custom'

export type Integration = ScopedEntity & {
  type: IntegrationType
  name: string
  status: 'connected' | 'action_required' | 'disconnected'
  health: 'healthy' | 'degraded' | 'unknown'
  scopes: string[]
  externalAccount: string
  connectedAt?: string
  lastEventAt?: string
  diagnostic?: string
}

export type McpServer = ScopedEntity & {
  name: string
  transport: 'stdio' | 'sse' | 'http'
  command?: string
  args: string[]
  endpoint?: string
  enabled: boolean
  status: 'connected' | 'disconnected' | 'error'
  toolCount: number
  secretIds: string[]
}

export type SecretProvider = 'local_reference' | 'vault' | 'aws_secrets_manager' | 'onepassword'

export type Secret = ScopedEntity & {
  name: string
  provider: SecretProvider
  reference: string
  description: string
  lastFour?: string
  lastUsedAt?: string
}

export type Webhook = ScopedEntity & {
  name: string
  url: string
  events: string[]
  secretId?: string
  enabled: boolean
  status: 'healthy' | 'failing' | 'untested'
  lastDeliveryAt?: string
}

export type MemoryFileVersion = {
  id: string
  version: number
  content: string
  createdAt: string
  createdBy: string
}

export type MemoryFile = ScopedEntity & {
  path: string
  description: string
  content: string
  version: number
  versions: MemoryFileVersion[]
}

export type AutomationSource = 'manual' | 'github' | 'slack' | 'jira' | 'pagerduty' | 'schedule' | 'webhook'

export type Automation = ScopedEntity & {
  name: string
  description: string
  trigger: string
  source: AutomationSource
  filter: Record<string, string>
  enabled: boolean
  expertId: string
  repositoryId?: string
  lastMatchedAt?: string
  matchCount: number
}

export type InboundEvent = ScopedEntity & {
  source: AutomationSource
  trigger: string
  externalId: string
  payload: Record<string, JsonValue>
  status: 'matched' | 'unmatched' | 'ignored'
  matchedAutomationId?: string
  matchedSessionId?: string
  receivedAt: string
}

export type SessionDraftInfo = ScopedEntity & {
  title: string
  status: 'draft'
  sourceEventId: string
  automationId: string
  expertId: string
  repositoryId?: string
  summary: string
}

export type AuditResult = 'success' | 'failure'

export type AuditEvent = ScopedEntity & {
  actor: string
  action: string
  targetType: string
  targetId: string
  channel: 'console' | 'automation' | 'system'
  result: AuditResult
  metadata: Record<string, JsonValue>
}

export type ControlPlaneState = {
  schemaVersion: typeof CONTROL_PLANE_SCHEMA_VERSION
  activeSpaceId: string
  spaces: Space[]
  environments: Environment[]
  daemons: Daemon[]
  repositories: Repository[]
  integrations: Integration[]
  mcpServers: McpServer[]
  secrets: Secret[]
  webhooks: Webhook[]
  memoryFiles: MemoryFile[]
  automations: Automation[]
  inboundEvents: InboundEvent[]
  sessionDrafts: SessionDraftInfo[]
  auditEvents: AuditEvent[]
}

export type ControlPlaneScope = {
  space: Space
  environments: Environment[]
  daemons: Daemon[]
  repositories: Repository[]
  integrations: Integration[]
  mcpServers: McpServer[]
  secrets: Secret[]
  webhooks: Webhook[]
  memoryFiles: MemoryFile[]
  automations: Automation[]
  inboundEvents: InboundEvent[]
  sessionDrafts: SessionDraftInfo[]
  auditEvents: AuditEvent[]
}

export type CreateEnvironmentInput = {
  spaceId?: string
  name: string
  slug?: string
  image: string
  cpu?: number
  memoryGb?: number
  timeoutMinutes?: number
  networkPolicy?: Environment['networkPolicy']
  allowedHosts?: string[]
}

export type UpdateEnvironmentInput = Partial<Pick<
  Environment,
  'name' | 'slug' | 'image' | 'cpu' | 'memoryGb' | 'timeoutMinutes' | 'networkPolicy' | 'allowedHosts'
>> & {
  reprovision?: boolean
}

export type ConnectIntegrationInput = Partial<Pick<Integration, 'externalAccount' | 'scopes' | 'diagnostic'>>

export type CreateAutomationInput = {
  spaceId?: string
  name: string
  description?: string
  trigger: string
  source: AutomationSource
  filter?: Record<string, string>
  enabled?: boolean
  expertId: string
  repositoryId?: string
}

export type InjectEventInput = {
  spaceId?: string
  source: AutomationSource
  trigger: string
  externalId: string
  payload: Record<string, JsonValue>
  receivedAt?: string
}

export type InjectEventResult = {
  event: InboundEvent
  sessionDraft?: SessionDraftInfo
  matchedAutomation?: Automation
  duplicate: boolean
}

export type CreateFileInput = {
  spaceId?: string
  path: string
  description?: string
  content?: string
  actorId?: string
}

export type UpdateFileInput = {
  path?: string
  description?: string
  content?: string
  actorId?: string
}

export type CreateSecretInput = {
  spaceId?: string
  name: string
  provider: SecretProvider
  reference: string
  description?: string
  lastFour?: string
}

export type CreateMcpServerInput = {
  spaceId?: string
  name: string
  transport: McpServer['transport']
  command?: string
  args?: string[]
  endpoint?: string
  enabled?: boolean
  toolCount?: number
  secretIds?: string[]
}

export type CreateWebhookInput = {
  spaceId?: string
  name: string
  url: string
  events: string[]
  secretId?: string
  enabled?: boolean
}
