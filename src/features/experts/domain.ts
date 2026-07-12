import { expertTemplateCategories, expertTemplates, type ExpertTemplateCategory } from '../../data/expertTemplates'

export const EXPERT_STORE_SCHEMA_VERSION = 1 as const

export type ExpertStatus = 'draft' | 'published' | 'disabled' | 'archived'

export type ExpertToolPermission = 'read' | 'write' | 'execute'

export type ExpertToolConfig = {
  id: string
  name: string
  enabled: boolean
  permissions: ExpertToolPermission[]
}

export type ExpertTriggerType = 'manual' | 'github' | 'slack' | 'schedule' | 'webhook'

export type ExpertTriggerConfig = {
  id: string
  type: ExpertTriggerType
  enabled: boolean
  event: string
  filter: Record<string, string>
}

export type ExpertNetworkPolicy = 'restricted' | 'allowlist' | 'unrestricted'

export type ExpertEnvironmentConfig = {
  environmentId?: string
  image: string
  timeoutMinutes: number
  networkPolicy: ExpertNetworkPolicy
  allowedHosts: string[]
}

export type ExpertApprovalMode = 'always' | 'risk_based' | 'never'

export type ExpertApprovalAction =
  | 'write_code'
  | 'run_command'
  | 'create_pull_request'
  | 'post_comment'
  | 'deploy'

export type ExpertApprovalPolicy = {
  mode: ExpertApprovalMode
  requiredFor: ExpertApprovalAction[]
}

export type ExpertContextConfig = {
  pathScopes: string[]
  knowledgeFiles: string[]
}

export type ExpertWorkerConfig = {
  id: string
  name: string
  expertId?: string
  instructions: string
  concurrency: number
}

export type ExpertVisibility = 'private' | 'workspace'

export type ExpertConfig = {
  name: string
  description: string
  category: ExpertTemplateCategory
  icon: string
  instructions: string
  model: string
  repositories: string[]
  capabilities: string[]
  constraints: string[]
  completionCriteria: string[]
  context: ExpertContextConfig
  tools: ExpertToolConfig[]
  environment: ExpertEnvironmentConfig
  triggers: ExpertTriggerConfig[]
  workers: ExpertWorkerConfig[]
  approvalPolicy: ExpertApprovalPolicy
  visibility: ExpertVisibility
  launchGuidance: string
}

export type Expert = {
  id: string
  spaceId?: string
  sourceTemplateId?: string
  status: ExpertStatus
  draftConfig: ExpertConfig
  publishedVersionId?: string
  latestVersion: number
  hasUnpublishedChanges: boolean
  createdAt: string
  updatedAt: string
  archivedAt?: string
  archivedFromStatus?: Exclude<ExpertStatus, 'archived'>
}

export type ExpertVersion = {
  id: string
  expertId: string
  version: number
  configSnapshot: ExpertConfig
  createdAt: string
  createdBy: string
  rolledBackFromVersionId?: string
}

export type ExpertStore = {
  schemaVersion: typeof EXPERT_STORE_SCHEMA_VERSION
  experts: Expert[]
  versions: ExpertVersion[]
}

export type ExpertConfigPatch = Partial<
  Omit<ExpertConfig, 'context' | 'environment' | 'approvalPolicy'>
> & {
  context?: Partial<ExpertContextConfig>
  environment?: Partial<ExpertEnvironmentConfig>
  approvalPolicy?: Partial<ExpertApprovalPolicy>
}

export type ExpertValidationIssue = {
  field: string
  code: 'required' | 'invalid' | 'duplicate'
  message: string
}

export class ExpertValidationError extends Error {
  readonly issues: ExpertValidationIssue[]

  constructor(issues: ExpertValidationIssue[]) {
    super('Expert configuration is not ready to publish')
    this.name = 'ExpertValidationError'
    this.issues = issues
  }
}

export type ExpertChangeResult = {
  store: ExpertStore
  expert: Expert
}

export type ExpertPublishResult = ExpertChangeResult & {
  version: ExpertVersion
}

export type CreateExpertOptions = {
  id?: string
  now?: string
  config?: ExpertConfigPatch
}

export type PublishExpertOptions = {
  versionId?: string
  now?: string
  actorId?: string
}

export type RollbackExpertOptions = PublishExpertOptions

const defaultApprovalActions: ExpertApprovalAction[] = [
  'write_code',
  'create_pull_request',
  'deploy',
]

function timestamp(now?: string) {
  return now ?? new Date().toISOString()
}

function entityId(prefix: string) {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${randomId}`
}

function requireExpert(store: ExpertStore, expertId: string) {
  const expert = store.experts.find((item) => item.id === expertId)
  if (!expert) throw new Error(`Expert not found: ${expertId}`)
  return expert
}

function requireEditableExpert(store: ExpertStore, expertId: string) {
  const expert = requireExpert(store, expertId)
  if (expert.status === 'archived') throw new Error(`Archived expert cannot be edited: ${expertId}`)
  return expert
}

function replaceExpert(store: ExpertStore, nextExpert: Expert): ExpertStore {
  return {
    ...store,
    experts: store.experts.map((expert) => expert.id === nextExpert.id ? nextExpert : expert),
  }
}

function assertUniqueId(store: ExpertStore, id: string) {
  if (store.experts.some((expert) => expert.id === id)) {
    throw new Error(`Expert id already exists: ${id}`)
  }
}

export function createEmptyExpertStore(): ExpertStore {
  return {
    schemaVersion: EXPERT_STORE_SCHEMA_VERSION,
    experts: [],
    versions: [],
  }
}

export function cloneExpertConfig(config: ExpertConfig): ExpertConfig {
  return {
    ...config,
    repositories: [...config.repositories],
    capabilities: [...config.capabilities],
    constraints: [...config.constraints],
    completionCriteria: [...config.completionCriteria],
    context: {
      pathScopes: [...config.context.pathScopes],
      knowledgeFiles: [...config.context.knowledgeFiles],
    },
    tools: config.tools.map((tool) => ({ ...tool, permissions: [...tool.permissions] })),
    environment: {
      ...config.environment,
      allowedHosts: [...config.environment.allowedHosts],
    },
    triggers: config.triggers.map((trigger) => ({ ...trigger, filter: { ...trigger.filter } })),
    workers: config.workers.map((worker) => ({ ...worker })),
    approvalPolicy: {
      ...config.approvalPolicy,
      requiredFor: [...config.approvalPolicy.requiredFor],
    },
  }
}

export function createExpertConfig(
  category: ExpertTemplateCategory = 'Coding',
  patch: ExpertConfigPatch = {},
): ExpertConfig {
  const base: ExpertConfig = {
    name: 'Untitled expert',
    description: '',
    category,
    icon: 'Bot',
    instructions: '',
    model: 'GPT-5.4',
    repositories: [],
    capabilities: [],
    constraints: [],
    completionCriteria: [],
    context: {
      pathScopes: [],
      knowledgeFiles: [],
    },
    tools: [],
    environment: {
      image: '',
      timeoutMinutes: 30,
      networkPolicy: 'restricted',
      allowedHosts: [],
    },
    triggers: [{
      id: entityId('trigger'),
      type: 'manual',
      enabled: true,
      event: 'manual',
      filter: {},
    }],
    workers: [],
    approvalPolicy: {
      mode: 'risk_based',
      requiredFor: [...defaultApprovalActions],
    },
    visibility: 'workspace',
    launchGuidance: '',
  }

  return mergeExpertConfig(base, patch)
}

export function mergeExpertConfig(config: ExpertConfig, patch: ExpertConfigPatch): ExpertConfig {
  return cloneExpertConfig({
    ...config,
    ...patch,
    context: {
      ...config.context,
      ...patch.context,
    },
    environment: {
      ...config.environment,
      ...patch.environment,
    },
    approvalPolicy: {
      ...config.approvalPolicy,
      ...patch.approvalPolicy,
    },
  })
}

export function createBlankExpert(
  store: ExpertStore,
  options: CreateExpertOptions = {},
): ExpertChangeResult {
  const id = options.id ?? entityId('expert')
  assertUniqueId(store, id)
  const now = timestamp(options.now)
  const category = options.config?.category ?? 'Coding'
  const expert: Expert = {
    id,
    status: 'draft',
    draftConfig: createExpertConfig(category, options.config),
    latestVersion: 0,
    hasUnpublishedChanges: true,
    createdAt: now,
    updatedAt: now,
  }

  return {
    store: { ...store, experts: [expert, ...store.experts] },
    expert,
  }
}

export function createExpertFromTemplate(
  store: ExpertStore,
  templateId: string,
  options: CreateExpertOptions = {},
): ExpertChangeResult {
  const template = expertTemplates.find((item) => item.id === templateId)
  if (!template) throw new Error(`Expert template not found: ${templateId}`)

  const result = createBlankExpert(store, {
    ...options,
    config: {
      name: template.name,
      description: template.description,
      category: template.category,
      instructions: template.description,
      ...options.config,
    },
  })
  const expert = { ...result.expert, sourceTemplateId: template.id }

  return {
    store: replaceExpert(result.store, expert),
    expert,
  }
}

export function updateExpert(
  store: ExpertStore,
  expertId: string,
  patch: ExpertConfigPatch,
  now?: string,
): ExpertChangeResult {
  const expert = requireEditableExpert(store, expertId)
  const nextExpert: Expert = {
    ...expert,
    draftConfig: mergeExpertConfig(expert.draftConfig, patch),
    hasUnpublishedChanges: true,
    updatedAt: timestamp(now),
  }

  return { store: replaceExpert(store, nextExpert), expert: nextExpert }
}

export function validateExpertConfig(config: ExpertConfig): ExpertValidationIssue[] {
  const issues: ExpertValidationIssue[] = []
  if (!config.name.trim()) issues.push({ field: 'name', code: 'required', message: 'Name is required' })
  if (!config.description.trim()) issues.push({ field: 'description', code: 'required', message: 'Description is required' })
  if (!config.instructions.trim()) issues.push({ field: 'instructions', code: 'required', message: 'Instructions are required' })
  if (!config.model.trim()) issues.push({ field: 'model', code: 'required', message: 'Model is required' })
  if (!expertTemplateCategories.includes(config.category)) {
    issues.push({ field: 'category', code: 'invalid', message: 'Category is invalid' })
  }
  if (!Number.isFinite(config.environment.timeoutMinutes) || config.environment.timeoutMinutes <= 0) {
    issues.push({ field: 'environment.timeoutMinutes', code: 'invalid', message: 'Timeout must be greater than zero' })
  }

  const toolIds = config.tools.map((tool) => tool.id)
  if (new Set(toolIds).size !== toolIds.length) {
    issues.push({ field: 'tools', code: 'duplicate', message: 'Tool ids must be unique' })
  }
  const triggerIds = config.triggers.map((trigger) => trigger.id)
  if (new Set(triggerIds).size !== triggerIds.length) {
    issues.push({ field: 'triggers', code: 'duplicate', message: 'Trigger ids must be unique' })
  }
  const workerIds = config.workers.map((worker) => worker.id)
  if (new Set(workerIds).size !== workerIds.length) {
    issues.push({ field: 'workers', code: 'duplicate', message: 'Worker ids must be unique' })
  }
  if (config.workers.some((worker) => !Number.isInteger(worker.concurrency) || worker.concurrency <= 0)) {
    issues.push({ field: 'workers.concurrency', code: 'invalid', message: 'Worker concurrency must be a positive integer' })
  }

  return issues
}

export function publishExpert(
  store: ExpertStore,
  expertId: string,
  options: PublishExpertOptions = {},
): ExpertPublishResult {
  const expert = requireEditableExpert(store, expertId)
  const issues = validateExpertConfig(expert.draftConfig)
  if (issues.length > 0) throw new ExpertValidationError(issues)

  const now = timestamp(options.now)
  const version: ExpertVersion = {
    id: options.versionId ?? entityId('expert-version'),
    expertId,
    version: expert.latestVersion + 1,
    configSnapshot: cloneExpertConfig(expert.draftConfig),
    createdAt: now,
    createdBy: options.actorId ?? 'local-user',
  }
  if (store.versions.some((item) => item.id === version.id)) {
    throw new Error(`Expert version id already exists: ${version.id}`)
  }

  const nextExpert: Expert = {
    ...expert,
    status: 'published',
    publishedVersionId: version.id,
    latestVersion: version.version,
    hasUnpublishedChanges: false,
    updatedAt: now,
    archivedAt: undefined,
    archivedFromStatus: undefined,
  }
  return {
    store: {
      ...replaceExpert(store, nextExpert),
      versions: [...store.versions, version],
    },
    expert: nextExpert,
    version,
  }
}

export function disableExpert(store: ExpertStore, expertId: string, now?: string): ExpertChangeResult {
  const expert = requireEditableExpert(store, expertId)
  if (!expert.publishedVersionId) throw new Error(`Only a published expert can be disabled: ${expertId}`)
  const nextExpert: Expert = { ...expert, status: 'disabled', updatedAt: timestamp(now) }
  return { store: replaceExpert(store, nextExpert), expert: nextExpert }
}

export function enableExpert(store: ExpertStore, expertId: string, now?: string): ExpertChangeResult {
  const expert = requireExpert(store, expertId)
  if (expert.status !== 'disabled') throw new Error(`Expert is not disabled: ${expertId}`)
  const nextExpert: Expert = { ...expert, status: 'published', updatedAt: timestamp(now) }
  return { store: replaceExpert(store, nextExpert), expert: nextExpert }
}

export function archiveExpert(store: ExpertStore, expertId: string, now?: string): ExpertChangeResult {
  const expert = requireExpert(store, expertId)
  if (expert.status === 'archived') return { store, expert }
  const archivedAt = timestamp(now)
  const nextExpert: Expert = {
    ...expert,
    status: 'archived',
    archivedAt,
    archivedFromStatus: expert.status,
    updatedAt: archivedAt,
  }
  return { store: replaceExpert(store, nextExpert), expert: nextExpert }
}

export function restoreExpert(store: ExpertStore, expertId: string, now?: string): ExpertChangeResult {
  const expert = requireExpert(store, expertId)
  if (expert.status !== 'archived') throw new Error(`Expert is not archived: ${expertId}`)
  const nextExpert: Expert = {
    ...expert,
    status: expert.archivedFromStatus ?? (expert.publishedVersionId ? 'disabled' : 'draft'),
    archivedAt: undefined,
    archivedFromStatus: undefined,
    updatedAt: timestamp(now),
  }
  return { store: replaceExpert(store, nextExpert), expert: nextExpert }
}

export function deleteDraftExpert(store: ExpertStore, expertId: string): ExpertStore {
  const expert = requireExpert(store, expertId)
  const hasVersions = store.versions.some((version) => version.expertId === expertId)
  if (expert.status !== 'draft' || hasVersions) {
    throw new Error(`Only an unversioned draft expert can be deleted: ${expertId}`)
  }
  return { ...store, experts: store.experts.filter((item) => item.id !== expertId) }
}

export function listExpertVersions(store: ExpertStore, expertId: string): ExpertVersion[] {
  requireExpert(store, expertId)
  return store.versions
    .filter((version) => version.expertId === expertId)
    .sort((left, right) => right.version - left.version)
}

export function getExpertVersion(store: ExpertStore, versionId: string): ExpertVersion | undefined {
  return store.versions.find((version) => version.id === versionId)
}

export function rollbackExpert(
  store: ExpertStore,
  expertId: string,
  targetVersionId: string,
  options: RollbackExpertOptions = {},
): ExpertPublishResult {
  const expert = requireEditableExpert(store, expertId)
  const targetVersion = store.versions.find((version) => (
    version.id === targetVersionId && version.expertId === expertId
  ))
  if (!targetVersion) throw new Error(`Expert version not found: ${targetVersionId}`)

  const now = timestamp(options.now)
  const version: ExpertVersion = {
    id: options.versionId ?? entityId('expert-version'),
    expertId,
    version: expert.latestVersion + 1,
    configSnapshot: cloneExpertConfig(targetVersion.configSnapshot),
    createdAt: now,
    createdBy: options.actorId ?? 'local-user',
    rolledBackFromVersionId: targetVersion.id,
  }
  if (store.versions.some((item) => item.id === version.id)) {
    throw new Error(`Expert version id already exists: ${version.id}`)
  }

  const nextExpert: Expert = {
    ...expert,
    status: 'published',
    draftConfig: cloneExpertConfig(targetVersion.configSnapshot),
    publishedVersionId: version.id,
    latestVersion: version.version,
    hasUnpublishedChanges: false,
    updatedAt: now,
  }
  return {
    store: {
      ...replaceExpert(store, nextExpert),
      versions: [...store.versions, version],
    },
    expert: nextExpert,
    version,
  }
}

export function createSeededExpertStore(
  templateIds: readonly string[] = ['pr-author', 'deep-code-reviewer', 'incident-investigator'],
  now?: string,
): ExpertStore {
  let store = createEmptyExpertStore()
  const createdAt = timestamp(now)

  templateIds.forEach((templateId) => {
    const created = createExpertFromTemplate(store, templateId, {
      id: `expert-seed-${templateId}`,
      now: createdAt,
    })
    const published = publishExpert(created.store, created.expert.id, {
      versionId: `expert-version-seed-${templateId}-1`,
      now: createdAt,
      actorId: 'system-seed',
    })
    store = published.store
  })

  return store
}
