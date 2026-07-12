import type {
  AuditEvent,
  Automation,
  ConnectIntegrationInput,
  ControlPlaneScope,
  ControlPlaneState,
  CreateAutomationInput,
  CreateEnvironmentInput,
  CreateFileInput,
  CreateMcpServerInput,
  CreateSecretInput,
  CreateWebhookInput,
  Daemon,
  Environment,
  InboundEvent,
  InjectEventInput,
  InjectEventResult,
  Integration,
  JsonValue,
  McpServer,
  MemoryFile,
  Secret,
  SessionDraftInfo,
  Space,
  UpdateEnvironmentInput,
  UpdateFileInput,
  Webhook,
} from './types'

export type ControlPlaneMutation<T> = {
  state: ControlPlaneState
  value: T
}

function timestamp(value?: string) {
  return value ?? new Date().toISOString()
}

function entityId(prefix: string) {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${randomId}`
}

function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function slugify(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || `resource-${stableHash(value.trim())}`
}

function requireSpace(state: ControlPlaneState, spaceId: string) {
  const space = state.spaces.find((item) => item.id === spaceId)
  if (!space) throw new Error(`Space not found: ${spaceId}`)
  return space
}

function requireScopedEntity<T extends { id: string; spaceId: string }>(
  entities: T[],
  id: string,
  label: string,
) {
  const entity = entities.find((item) => item.id === id)
  if (!entity) throw new Error(`${label} not found: ${id}`)
  return entity
}

function appendAudit(
  state: ControlPlaneState,
  input: Omit<AuditEvent, 'id' | 'createdAt' | 'updatedAt'> & { at?: string },
) {
  const at = timestamp(input.at)
  const audit: AuditEvent = {
    id: entityId('audit'),
    spaceId: input.spaceId,
    actor: input.actor,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    channel: input.channel,
    result: input.result,
    metadata: input.metadata,
    createdAt: at,
    updatedAt: at,
  }
  return { ...state, auditEvents: [audit, ...state.auditEvents] }
}

function scopedSpaceId(state: ControlPlaneState, requested?: string) {
  const spaceId = requested ?? state.activeSpaceId
  requireSpace(state, spaceId)
  return spaceId
}

export function selectControlPlaneScope(
  state: ControlPlaneState,
  spaceId: string = state.activeSpaceId,
): ControlPlaneScope {
  const space = requireSpace(state, spaceId)
  const inSpace = <T extends { spaceId: string }>(items: T[]) => items.filter((item) => item.spaceId === spaceId)
  return {
    space,
    environments: inSpace(state.environments),
    daemons: inSpace(state.daemons),
    repositories: inSpace(state.repositories),
    integrations: inSpace(state.integrations),
    mcpServers: inSpace(state.mcpServers),
    secrets: inSpace(state.secrets),
    webhooks: inSpace(state.webhooks),
    memoryFiles: inSpace(state.memoryFiles),
    automations: inSpace(state.automations),
    inboundEvents: inSpace(state.inboundEvents),
    sessionDrafts: inSpace(state.sessionDrafts),
    auditEvents: inSpace(state.auditEvents),
  }
}

export function switchSpace(state: ControlPlaneState, spaceId: string, at?: string): ControlPlaneMutation<Space> {
  const space = requireSpace(state, spaceId)
  const next = appendAudit(
    { ...state, activeSpaceId: spaceId },
    {
      spaceId,
      actor: 'local-user',
      action: 'space.switched',
      targetType: 'space',
      targetId: spaceId,
      channel: 'console',
      result: 'success',
      metadata: {},
      at,
    },
  )
  return { state: next, value: space }
}

export function createEnvironment(
  state: ControlPlaneState,
  input: CreateEnvironmentInput,
  at?: string,
): ControlPlaneMutation<Environment> {
  const spaceId = scopedSpaceId(state, input.spaceId)
  const now = timestamp(at)
  const slug = input.slug?.trim() || slugify(input.name)
  if (!slug) throw new Error('Environment slug is required')
  if (state.environments.some((item) => item.spaceId === spaceId && item.slug === slug)) {
    throw new Error(`Environment slug already exists: ${slug}`)
  }
  const environment: Environment = {
    id: entityId('environment'),
    spaceId,
    name: input.name.trim(),
    slug,
    image: input.image.trim(),
    status: 'provisioning',
    cpu: input.cpu ?? 2,
    memoryGb: input.memoryGb ?? 4,
    timeoutMinutes: input.timeoutMinutes ?? 30,
    networkPolicy: input.networkPolicy ?? 'restricted',
    allowedHosts: [...(input.allowedHosts ?? [])],
    provisioning: {
      phase: 'queued',
      progress: 5,
      message: 'Provisioning request queued',
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  }
  const next = appendAudit(
    { ...state, environments: [environment, ...state.environments] },
    {
      spaceId,
      actor: 'local-user',
      action: 'environment.created',
      targetType: 'environment',
      targetId: environment.id,
      channel: 'console',
      result: 'success',
      metadata: { image: environment.image },
      at: now,
    },
  )
  return { state: next, value: environment }
}

export function updateEnvironment(
  state: ControlPlaneState,
  environmentId: string,
  input: UpdateEnvironmentInput,
  at?: string,
): ControlPlaneMutation<Environment> {
  const environment = requireScopedEntity(state.environments, environmentId, 'Environment')
  const now = timestamp(at)
  const { reprovision, ...patch } = input
  const shouldProvision = Boolean(reprovision || (patch.image && patch.image !== environment.image))
  if (patch.slug && state.environments.some((item) => (
    item.id !== environmentId && item.spaceId === environment.spaceId && item.slug === patch.slug
  ))) {
    throw new Error(`Environment slug already exists: ${patch.slug}`)
  }
  const nextEnvironment: Environment = {
    ...environment,
    ...patch,
    allowedHosts: patch.allowedHosts ? [...patch.allowedHosts] : environment.allowedHosts,
    status: shouldProvision ? 'provisioning' : environment.status,
    provisioning: shouldProvision
      ? {
          phase: 'queued',
          progress: 5,
          message: 'Provisioning request queued',
          updatedAt: now,
        }
      : environment.provisioning,
    updatedAt: now,
  }
  const next = appendAudit(
    {
      ...state,
      environments: state.environments.map((item) => item.id === environmentId ? nextEnvironment : item),
    },
    {
      spaceId: environment.spaceId,
      actor: 'local-user',
      action: shouldProvision ? 'environment.reprovisioned' : 'environment.updated',
      targetType: 'environment',
      targetId: environmentId,
      channel: 'console',
      result: 'success',
      metadata: {},
      at: now,
    },
  )
  return { state: next, value: nextEnvironment }
}

export function advanceEnvironmentProvisioning(
  state: ControlPlaneState,
  environmentId: string,
  at?: string,
): ControlPlaneMutation<Environment> {
  const environment = requireScopedEntity(state.environments, environmentId, 'Environment')
  if (environment.status !== 'provisioning') return { state, value: environment }
  const now = timestamp(at)
  const transitions: Record<Environment['provisioning']['phase'], Environment['provisioning']> = {
    queued: { phase: 'pulling_image', progress: 30, message: 'Pulling environment image', updatedAt: now },
    pulling_image: { phase: 'configuring', progress: 72, message: 'Applying runtime and network policy', updatedAt: now },
    configuring: { phase: 'ready', progress: 100, message: 'Environment is ready', updatedAt: now },
    ready: environment.provisioning,
    failed: environment.provisioning,
  }
  const provisioning = transitions[environment.provisioning.phase]
  const nextEnvironment: Environment = {
    ...environment,
    status: provisioning.phase === 'ready' ? 'ready' : 'provisioning',
    provisioning,
    updatedAt: now,
  }
  const next = appendAudit(
    {
      ...state,
      environments: state.environments.map((item) => item.id === environmentId ? nextEnvironment : item),
    },
    {
      spaceId: environment.spaceId,
      actor: 'environment-provisioner',
      action: `environment.provisioning.${provisioning.phase}`,
      targetType: 'environment',
      targetId: environmentId,
      channel: 'system',
      result: 'success',
      metadata: { progress: provisioning.progress },
      at: now,
    },
  )
  return { state: next, value: nextEnvironment }
}

export function toggleDaemon(
  state: ControlPlaneState,
  daemonId: string,
  enabled?: boolean,
  at?: string,
): ControlPlaneMutation<Daemon> {
  const daemon = requireScopedEntity(state.daemons, daemonId, 'Daemon')
  const now = timestamp(at)
  const nextEnabled = enabled ?? !daemon.enabled
  const nextDaemon: Daemon = {
    ...daemon,
    enabled: nextEnabled,
    status: nextEnabled ? 'online' : 'offline',
    lastHeartbeatAt: nextEnabled ? now : daemon.lastHeartbeatAt,
    updatedAt: now,
  }
  const next = appendAudit(
    { ...state, daemons: state.daemons.map((item) => item.id === daemonId ? nextDaemon : item) },
    {
      spaceId: daemon.spaceId,
      actor: 'local-user',
      action: nextEnabled ? 'daemon.enabled' : 'daemon.disabled',
      targetType: 'daemon',
      targetId: daemonId,
      channel: 'console',
      result: 'success',
      metadata: {},
      at: now,
    },
  )
  return { state: next, value: nextDaemon }
}

export function connectIntegration(
  state: ControlPlaneState,
  integrationId: string,
  input: ConnectIntegrationInput = {},
  at?: string,
): ControlPlaneMutation<Integration> {
  const integration = requireScopedEntity(state.integrations, integrationId, 'Integration')
  const now = timestamp(at)
  const nextIntegration: Integration = {
    ...integration,
    ...input,
    scopes: input.scopes ? [...input.scopes] : integration.scopes,
    status: 'connected',
    health: 'healthy',
    connectedAt: integration.connectedAt ?? now,
    diagnostic: undefined,
    updatedAt: now,
  }
  const next = appendAudit(
    {
      ...state,
      integrations: state.integrations.map((item) => item.id === integrationId ? nextIntegration : item),
    },
    {
      spaceId: integration.spaceId,
      actor: 'local-user',
      action: 'integration.connected',
      targetType: 'integration',
      targetId: integrationId,
      channel: 'console',
      result: 'success',
      metadata: { type: integration.type },
      at: now,
    },
  )
  return { state: next, value: nextIntegration }
}

export function createAutomation(
  state: ControlPlaneState,
  input: CreateAutomationInput,
  at?: string,
): ControlPlaneMutation<Automation> {
  const spaceId = scopedSpaceId(state, input.spaceId)
  if (input.repositoryId) {
    const repository = requireScopedEntity(state.repositories, input.repositoryId, 'Repository')
    if (repository.spaceId !== spaceId) throw new Error('Automation repository belongs to another Space')
  }
  const now = timestamp(at)
  const automation: Automation = {
    id: entityId('automation'),
    spaceId,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    trigger: input.trigger.trim(),
    source: input.source,
    filter: { ...(input.filter ?? {}) },
    enabled: input.enabled ?? true,
    expertId: input.expertId,
    repositoryId: input.repositoryId,
    matchCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  const next = appendAudit(
    { ...state, automations: [automation, ...state.automations] },
    {
      spaceId,
      actor: 'local-user',
      action: 'automation.created',
      targetType: 'automation',
      targetId: automation.id,
      channel: 'console',
      result: 'success',
      metadata: { source: automation.source, trigger: automation.trigger },
      at: now,
    },
  )
  return { state: next, value: automation }
}

export function toggleAutomation(
  state: ControlPlaneState,
  automationId: string,
  enabled?: boolean,
  at?: string,
): ControlPlaneMutation<Automation> {
  const automation = requireScopedEntity(state.automations, automationId, 'Automation')
  const now = timestamp(at)
  const nextEnabled = enabled ?? !automation.enabled
  const nextAutomation: Automation = { ...automation, enabled: nextEnabled, updatedAt: now }
  const next = appendAudit(
    {
      ...state,
      automations: state.automations.map((item) => item.id === automationId ? nextAutomation : item),
    },
    {
      spaceId: automation.spaceId,
      actor: 'local-user',
      action: nextEnabled ? 'automation.enabled' : 'automation.disabled',
      targetType: 'automation',
      targetId: automationId,
      channel: 'console',
      result: 'success',
      metadata: {},
      at: now,
    },
  )
  return { state: next, value: nextAutomation }
}

function readPayloadPath(payload: Record<string, JsonValue>, path: string): JsonValue | undefined {
  let value: JsonValue | undefined = payload
  for (const segment of path.split('.')) {
    if (!value || Array.isArray(value) || typeof value !== 'object') return undefined
    value = value[segment]
  }
  return value
}

function matchesAutomation(automation: Automation, input: InjectEventInput) {
  if (!automation.enabled || automation.source !== input.source || automation.trigger !== input.trigger) return false
  return Object.entries(automation.filter).every(([path, expected]) => {
    const actual = readPayloadPath(input.payload, path)
    if (expected === '*') return actual !== undefined
    return String(actual) === expected
  })
}

function eventTitle(input: InjectEventInput) {
  const candidates = [
    readPayloadPath(input.payload, 'title'),
    readPayloadPath(input.payload, 'issue.title'),
    readPayloadPath(input.payload, 'pull_request.title'),
    readPayloadPath(input.payload, 'text'),
  ]
  const title = candidates.find((value) => typeof value === 'string' && value.trim())
  return typeof title === 'string' ? title : `${input.source} ${input.trigger}`
}

export function injectEvent(
  state: ControlPlaneState,
  input: InjectEventInput,
): ControlPlaneMutation<InjectEventResult> {
  const spaceId = scopedSpaceId(state, input.spaceId)
  const existing = state.inboundEvents.find((event) => (
    event.spaceId === spaceId && event.source === input.source && event.externalId === input.externalId
  ))
  if (existing) {
    return {
      state,
      value: {
        event: existing,
        sessionDraft: state.sessionDrafts.find((session) => session.id === existing.matchedSessionId),
        matchedAutomation: state.automations.find((automation) => automation.id === existing.matchedAutomationId),
        duplicate: true,
      },
    }
  }

  const receivedAt = timestamp(input.receivedAt)
  const automation = state.automations
    .filter((item) => item.spaceId === spaceId && matchesAutomation(item, input))
    .sort((left, right) => left.id.localeCompare(right.id))[0]
  const eventId = `event-${stableHash(`${spaceId}:${input.source}:${input.externalId}`)}`
  const sessionId = automation
    ? `session-draft-${stableHash(`${eventId}:${automation.id}`)}`
    : undefined
  const event: InboundEvent = {
    id: eventId,
    spaceId,
    source: input.source,
    trigger: input.trigger,
    externalId: input.externalId,
    payload: { ...input.payload },
    status: automation ? 'matched' : 'unmatched',
    matchedAutomationId: automation?.id,
    matchedSessionId: sessionId,
    receivedAt,
    createdAt: receivedAt,
    updatedAt: receivedAt,
  }
  const repositoryFullName = readPayloadPath(input.payload, 'repository.full_name')
  const matchedRepository = automation?.repositoryId
    ? state.repositories.find((repository) => repository.id === automation.repositoryId)
    : typeof repositoryFullName === 'string'
      ? state.repositories.find((repository) => repository.spaceId === spaceId && repository.fullName === repositoryFullName)
      : undefined
  const sessionDraft: SessionDraftInfo | undefined = automation && sessionId
    ? {
        id: sessionId,
        spaceId,
        title: eventTitle(input),
        status: 'draft',
        sourceEventId: event.id,
        automationId: automation.id,
        expertId: automation.expertId,
        repositoryId: matchedRepository?.id,
        summary: `Created from ${input.source} ${input.trigger} via ${automation.name}.`,
        createdAt: receivedAt,
        updatedAt: receivedAt,
      }
    : undefined
  const matchedAutomation = automation
    ? {
        ...automation,
        matchCount: automation.matchCount + 1,
        lastMatchedAt: receivedAt,
        updatedAt: receivedAt,
      }
    : undefined
  let next: ControlPlaneState = {
    ...state,
    inboundEvents: [event, ...state.inboundEvents],
    sessionDrafts: sessionDraft ? [sessionDraft, ...state.sessionDrafts] : state.sessionDrafts,
    automations: matchedAutomation
      ? state.automations.map((item) => item.id === matchedAutomation.id ? matchedAutomation : item)
      : state.automations,
  }
  next = appendAudit(next, {
    spaceId,
    actor: 'event-router',
    action: automation ? 'inbound_event.matched' : 'inbound_event.unmatched',
    targetType: 'inbound_event',
    targetId: event.id,
    channel: 'automation',
    result: 'success',
    metadata: {
      source: input.source,
      trigger: input.trigger,
      automationId: automation?.id ?? null,
      sessionId: sessionDraft?.id ?? null,
    },
    at: receivedAt,
  })

  return {
    state: next,
    value: {
      event,
      sessionDraft,
      matchedAutomation,
      duplicate: false,
    },
  }
}

export function createFile(
  state: ControlPlaneState,
  input: CreateFileInput,
  at?: string,
): ControlPlaneMutation<MemoryFile> {
  const spaceId = scopedSpaceId(state, input.spaceId)
  const path = input.path.trim()
  if (!path) throw new Error('File path is required')
  if (state.memoryFiles.some((file) => file.spaceId === spaceId && file.path === path)) {
    throw new Error(`Memory file already exists: ${path}`)
  }
  const now = timestamp(at)
  const content = input.content ?? ''
  const fileId = entityId('memory-file')
  const file: MemoryFile = {
    id: fileId,
    spaceId,
    path,
    description: input.description?.trim() ?? '',
    content,
    version: 1,
    versions: [{
      id: `${fileId}-v1`,
      version: 1,
      content,
      createdAt: now,
      createdBy: input.actorId ?? 'local-user',
    }],
    createdAt: now,
    updatedAt: now,
  }
  const next = appendAudit(
    { ...state, memoryFiles: [file, ...state.memoryFiles] },
    {
      spaceId,
      actor: input.actorId ?? 'local-user',
      action: 'memory_file.created',
      targetType: 'memory_file',
      targetId: file.id,
      channel: 'console',
      result: 'success',
      metadata: { path },
      at: now,
    },
  )
  return { state: next, value: file }
}

export function updateFile(
  state: ControlPlaneState,
  fileId: string,
  input: UpdateFileInput,
  at?: string,
): ControlPlaneMutation<MemoryFile> {
  const file = requireScopedEntity(state.memoryFiles, fileId, 'Memory file')
  const nextPath = input.path?.trim() ?? file.path
  if (state.memoryFiles.some((item) => (
    item.id !== fileId && item.spaceId === file.spaceId && item.path === nextPath
  ))) {
    throw new Error(`Memory file already exists: ${nextPath}`)
  }
  const now = timestamp(at)
  const contentChanged = input.content !== undefined && input.content !== file.content
  const nextVersion = contentChanged ? file.version + 1 : file.version
  const nextFile: MemoryFile = {
    ...file,
    path: nextPath,
    description: input.description?.trim() ?? file.description,
    content: input.content ?? file.content,
    version: nextVersion,
    versions: contentChanged
      ? [...file.versions, {
          id: `${file.id}-v${nextVersion}`,
          version: nextVersion,
          content: input.content ?? '',
          createdAt: now,
          createdBy: input.actorId ?? 'local-user',
        }]
      : file.versions,
    updatedAt: now,
  }
  const next = appendAudit(
    {
      ...state,
      memoryFiles: state.memoryFiles.map((item) => item.id === fileId ? nextFile : item),
    },
    {
      spaceId: file.spaceId,
      actor: input.actorId ?? 'local-user',
      action: contentChanged ? 'memory_file.version_created' : 'memory_file.updated',
      targetType: 'memory_file',
      targetId: fileId,
      channel: 'console',
      result: 'success',
      metadata: { path: nextPath, version: nextVersion },
      at: now,
    },
  )
  return { state: next, value: nextFile }
}

export function deleteFile(
  state: ControlPlaneState,
  fileId: string,
  at?: string,
): ControlPlaneMutation<string> {
  const file = requireScopedEntity(state.memoryFiles, fileId, 'Memory file')
  const next = appendAudit(
    { ...state, memoryFiles: state.memoryFiles.filter((item) => item.id !== fileId) },
    {
      spaceId: file.spaceId,
      actor: 'local-user',
      action: 'memory_file.deleted',
      targetType: 'memory_file',
      targetId: fileId,
      channel: 'console',
      result: 'success',
      metadata: { path: file.path },
      at,
    },
  )
  return { state: next, value: fileId }
}

export function createSecret(
  state: ControlPlaneState,
  input: CreateSecretInput,
  at?: string,
): ControlPlaneMutation<Secret> {
  const spaceId = scopedSpaceId(state, input.spaceId)
  const now = timestamp(at)
  if (!input.reference.trim()) throw new Error('Secret reference is required')
  const secret: Secret = {
    id: entityId('secret'),
    spaceId,
    name: input.name.trim(),
    provider: input.provider,
    reference: input.reference.trim(),
    description: input.description?.trim() ?? '',
    lastFour: input.lastFour,
    createdAt: now,
    updatedAt: now,
  }
  const next = appendAudit(
    { ...state, secrets: [secret, ...state.secrets] },
    {
      spaceId,
      actor: 'local-user',
      action: 'secret.reference_created',
      targetType: 'secret',
      targetId: secret.id,
      channel: 'console',
      result: 'success',
      metadata: { provider: secret.provider },
      at: now,
    },
  )
  return { state: next, value: secret }
}

export function createMcpServer(
  state: ControlPlaneState,
  input: CreateMcpServerInput,
  at?: string,
): ControlPlaneMutation<McpServer> {
  const spaceId = scopedSpaceId(state, input.spaceId)
  const secretIds = [...(input.secretIds ?? [])]
  secretIds.forEach((secretId) => {
    const secret = requireScopedEntity(state.secrets, secretId, 'Secret')
    if (secret.spaceId !== spaceId) throw new Error('MCP secret belongs to another Space')
  })
  const now = timestamp(at)
  const enabled = input.enabled ?? true
  const server: McpServer = {
    id: entityId('mcp'),
    spaceId,
    name: input.name.trim(),
    transport: input.transport,
    command: input.command?.trim(),
    args: [...(input.args ?? [])],
    endpoint: input.endpoint?.trim(),
    enabled,
    status: enabled ? 'connected' : 'disconnected',
    toolCount: input.toolCount ?? 0,
    secretIds,
    createdAt: now,
    updatedAt: now,
  }
  const next = appendAudit(
    { ...state, mcpServers: [server, ...state.mcpServers] },
    {
      spaceId,
      actor: 'local-user',
      action: 'mcp_server.created',
      targetType: 'mcp_server',
      targetId: server.id,
      channel: 'console',
      result: 'success',
      metadata: { transport: server.transport },
      at: now,
    },
  )
  return { state: next, value: server }
}

export function createWebhook(
  state: ControlPlaneState,
  input: CreateWebhookInput,
  at?: string,
): ControlPlaneMutation<Webhook> {
  const spaceId = scopedSpaceId(state, input.spaceId)
  if (input.secretId) {
    const secret = requireScopedEntity(state.secrets, input.secretId, 'Secret')
    if (secret.spaceId !== spaceId) throw new Error('Webhook secret belongs to another Space')
  }
  const now = timestamp(at)
  const webhook: Webhook = {
    id: entityId('webhook'),
    spaceId,
    name: input.name.trim(),
    url: input.url.trim(),
    events: [...input.events],
    secretId: input.secretId,
    enabled: input.enabled ?? true,
    status: 'untested',
    createdAt: now,
    updatedAt: now,
  }
  const next = appendAudit(
    { ...state, webhooks: [webhook, ...state.webhooks] },
    {
      spaceId,
      actor: 'local-user',
      action: 'webhook.created',
      targetType: 'webhook',
      targetId: webhook.id,
      channel: 'console',
      result: 'success',
      metadata: { events: webhook.events },
      at: now,
    },
  )
  return { state: next, value: webhook }
}
