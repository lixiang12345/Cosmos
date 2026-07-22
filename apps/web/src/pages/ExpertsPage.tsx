import { SUPPORTED_AGENT_MODELS } from '@cosmos/contracts'
import {
  Archive,
  ArrowLeft,
  Beaker,
  Bot,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleOff,
  Code2,
  Eye,
  GitBranch,
  History,
  Menu,
  Network,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Users,
  Webhook,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GlobalControls } from '../components/GlobalControls'
import { IconButton } from '../components/ui'
import {
  expertTemplateCategories,
  expertTemplates,
  type ExpertTemplate,
  type ExpertTemplateCategory,
} from '../data/expertTemplates'
import {
  ExpertValidationError,
  archiveExpert,
  disableExpert,
  enableExpert,
  listExpertVersions,
  publishExpert,
  restoreExpert,
  rollbackExpert,
  updateExpert,
  validateExpertConfig,
  type Expert,
  type ExpertApprovalAction,
  type ExpertConfig,
  type ExpertStatus,
  type ExpertStore,
  type ExpertToolPermission,
  type ExpertTriggerType,
} from '../features/experts'
import { usePreferences } from '../preferences'

const repositories = [
  'commerce/payment-service',
  'commerce/billing-web',
  'commerce/inventory-service',
  'platform/identity-service',
]

const iconOptions: Array<{ value: string; icon: LucideIcon }> = [
  { value: 'Sparkles', icon: Sparkles },
  { value: 'Bot', icon: Bot },
  { value: 'Code2', icon: Code2 },
  { value: 'ShieldCheck', icon: ShieldCheck },
  { value: 'Workflow', icon: Workflow },
]

const expertIcons: Record<string, LucideIcon> = Object.fromEntries(
  iconOptions.map((option) => [option.value, option.icon]),
)

const capabilityOptions = [
  { id: 'read-code', icon: Eye, zh: '读取与检索代码', en: 'Read and search code' },
  { id: 'write-code', icon: Code2, zh: '修改代码与配置', en: 'Write code and configuration' },
  { id: 'run-command', icon: TerminalSquare, zh: '执行命令与测试', en: 'Run commands and tests' },
  { id: 'create-pr', icon: GitBranch, zh: '创建和更新 Pull Request', en: 'Create and update pull requests' },
  { id: 'browse-web', icon: Network, zh: '访问受控网络', en: 'Use controlled network access' },
]

const toolOptions: Array<{
  id: string
  name: string
  icon: LucideIcon
  permissions: ExpertToolPermission[]
  zh: string
  en: string
}> = [
  { id: 'github', name: 'GitHub', icon: GitBranch, permissions: ['read', 'write'], zh: '仓库、Issue、PR 与检查', en: 'Repositories, issues, PRs, and checks' },
  { id: 'shell', name: 'Shell', icon: TerminalSquare, permissions: ['read', 'execute'], zh: '沙箱命令、测试与构建', en: 'Sandbox commands, tests, and builds' },
  { id: 'browser', name: 'Browser', icon: Eye, permissions: ['read', 'execute'], zh: '页面验证与外部资料读取', en: 'Page verification and external research' },
  { id: 'slack', name: 'Slack', icon: Webhook, permissions: ['read', 'write'], zh: '读取上下文并发布结果', en: 'Read context and post results' },
]

const triggerOptions: Array<{ type: ExpertTriggerType; zh: string; en: string; event: string }> = [
  { type: 'manual', zh: '手动启动', en: 'Manual launch', event: 'manual' },
  { type: 'github', zh: 'GitHub 事件', en: 'GitHub event', event: 'pull_request.opened' },
  { type: 'slack', zh: 'Slack 消息', en: 'Slack message', event: 'message.posted' },
  { type: 'schedule', zh: '定时运行', en: 'Schedule', event: '0 9 * * 1-5' },
  { type: 'webhook', zh: 'Webhook', en: 'Webhook', event: 'custom.event' },
]

const approvalActions: Array<{ id: ExpertApprovalAction; zh: string; en: string }> = [
  { id: 'write_code', zh: '写入代码', en: 'Write code' },
  { id: 'run_command', zh: '执行高风险命令', en: 'Run privileged commands' },
  { id: 'create_pull_request', zh: '创建 Pull Request', en: 'Create pull request' },
  { id: 'post_comment', zh: '发布外部评论', en: 'Post external comments' },
  { id: 'deploy', zh: '部署或发布', en: 'Deploy or release' },
]

const sectionIds = [
  'identity',
  'instructions',
  'context',
  'capabilities',
  'runtime',
  'orchestration',
  'governance',
  'test',
  'versions',
] as const

type EditorSectionId = typeof sectionIds[number]

function getCopy(locale: 'zh' | 'en') {
  const zh = locale === 'zh'
  return {
    title: zh ? '专家' : 'Experts',
    description: zh ? '创建、测试和发布可复用的 Agent 配置' : 'Create, test, and publish reusable Agent configurations',
    create: zh ? '创建专家' : 'Create expert',
    mine: zh ? '我的专家' : 'My experts',
    templates: zh ? '工作流模板' : 'Workflow starters',
    searchMine: zh ? '搜索专家名称或职责' : 'Search experts by name or role',
    searchTemplates: zh ? '搜索工作流名称或能力' : 'Search workflow names or capabilities',
    allStatuses: zh ? '全部状态' : 'All statuses',
    allCategories: zh ? '全部' : 'All',
    name: zh ? '专家' : 'Expert',
    status: zh ? '状态' : 'Status',
    scope: zh ? '范围' : 'Scope',
    triggers: zh ? '触发器' : 'Triggers',
    version: zh ? '版本' : 'Version',
    updated: zh ? '最近更新' : 'Updated',
    start: zh ? '发起会话' : 'Start session',
    edit: zh ? '配置专家' : 'Configure expert',
    disable: zh ? '停用' : 'Disable',
    enable: zh ? '启用' : 'Enable',
    archive: zh ? '归档' : 'Archive',
    restore: zh ? '恢复' : 'Restore',
    emptyMine: zh ? '没有匹配的专家' : 'No matching experts',
    emptyTemplates: zh ? '没有匹配的工作流模板' : 'No matching workflow templates',
    fork: zh ? '基于模板创建' : 'Create from template',
    sourceWorkflow: zh ? '查看原始流程' : 'View source workflow',
    templateNote: zh ? '基于公开 Workflows 目录整理。创建后生成可完整编辑的 Cosmos 自定义 Expert，不等同于 Cosmos 托管模板。' : 'Based on the public Workflows catalog. Each starter creates a fully editable Cosmos custom Expert, not a managed Cosmos template.',
    templatesCount: zh ? `${expertTemplates.length} 个工作流模板` : `${expertTemplates.length} workflow templates`,
    expertsCount: (count: number) => zh ? `${count} 个专家` : `${count} experts`,
    statusLabels: {
      draft: zh ? '草稿' : 'Draft',
      published: zh ? '已发布' : 'Published',
      disabled: zh ? '已停用' : 'Disabled',
      archived: zh ? '已归档' : 'Archived',
    } satisfies Record<ExpertStatus, string>,
    noRepo: zh ? '未绑定仓库' : 'No repositories',
    manualOnly: zh ? '仅手动' : 'Manual only',
    justNow: zh ? '刚刚' : 'Just now',
    back: zh ? '返回专家列表' : 'Back to experts',
    saveDraft: zh ? '保存草稿' : 'Save draft',
    dryRun: zh ? 'Dry Run' : 'Dry run',
    publish: zh ? '发布专家' : 'Publish expert',
    publishUpdate: zh ? '发布新版本' : 'Publish new version',
    unsaved: zh ? '有未保存更改' : 'Unsaved changes',
    saved: zh ? '配置已保存' : 'Configuration saved',
    published: zh ? '专家已发布，可用于新会话' : 'Expert published and ready for new sessions',
    rolledBack: zh ? '已回滚并发布为新版本' : 'Rolled back and published as a new version',
    disabled: zh ? '专家已停用' : 'Expert disabled',
    enabled: zh ? '专家已重新启用' : 'Expert enabled',
    archived: zh ? '专家已归档' : 'Expert archived',
    restored: zh ? '专家已恢复' : 'Expert restored',
    forked: zh ? '已创建专家草稿' : 'Expert draft created',
    validationFailed: zh ? '请先补齐必填配置' : 'Complete the required configuration first',
    sections: {
      identity: zh ? '基本信息' : 'Identity',
      instructions: zh ? '指令与验收' : 'Instructions',
      context: zh ? '上下文' : 'Context',
      capabilities: zh ? '能力与工具' : 'Capabilities',
      runtime: zh ? '模型与环境' : 'Runtime',
      orchestration: zh ? '触发器与 Workers' : 'Triggers & workers',
      governance: zh ? '审批与可见性' : 'Governance',
      test: zh ? '测试' : 'Test',
      versions: zh ? '版本历史' : 'Version history',
    } satisfies Record<EditorSectionId, string>,
    sectionDescriptions: {
      identity: zh ? '定义用户在专家库和会话选择器中看到的身份。' : 'Define how this Expert appears in the library and session picker.',
      instructions: zh ? '明确职责、边界以及什么结果才算完成。' : 'Set responsibilities, boundaries, and the definition of done.',
      context: zh ? '限制专家可以读取和修改的仓库与路径。' : 'Limit the repositories and paths available to this Expert.',
      capabilities: zh ? '只授予完成职责所需的能力和连接器。' : 'Grant only the capabilities and connectors required for the role.',
      runtime: zh ? '选择模型、沙箱环境、超时和网络策略。' : 'Choose the model, sandbox, timeout, and network policy.',
      orchestration: zh ? '配置人工、事件和定时入口，以及可委派的 Worker。' : 'Configure manual, event, and scheduled entry points plus worker delegation.',
      governance: zh ? '为外部写操作和高风险动作设置人工边界。' : 'Set human boundaries for external writes and privileged actions.',
      test: zh ? '预览专家会如何规划任务，不产生外部写操作。' : 'Preview how the Expert would plan a task without external writes.',
      versions: zh ? '已发布版本不可变；回滚会创建一个新的版本。' : 'Published versions are immutable; rollback creates a new version.',
    } satisfies Record<EditorSectionId, string>,
    displayName: zh ? '显示名称' : 'Display name',
    roleDescription: zh ? '职责说明' : 'Role description',
    category: zh ? '领域' : 'Category',
    visibility: zh ? '可见范围' : 'Visibility',
    workspace: zh ? '工作区' : 'Workspace',
    private: zh ? '仅自己' : 'Private',
    icon: zh ? '图标' : 'Icon',
    instructionsLabel: zh ? '系统指令' : 'System instructions',
    instructionsPlaceholder: zh ? '描述专家的职责、执行方式和决策原则…' : 'Describe the Expert role, operating method, and decision principles…',
    workflowStarterNote: zh ? '此 Expert 来自 Cosmos 工作流起点，下面的指令属于你的自定义配置，可以完整修改。' : 'This Expert was created from a Cosmos workflow starter. The instructions below are your custom configuration and remain fully editable.',
    constraints: zh ? '约束条件' : 'Constraints',
    lineHint: zh ? '每行一条' : 'One item per line',
    completion: zh ? '完成定义' : 'Definition of done',
    launchGuidance: zh ? '启动说明' : 'Launch guidance',
    launchPlaceholder: zh ? '告诉用户如何给这个专家一个高质量任务…' : 'Help users provide a high-quality task for this Expert…',
    repositories: zh ? '可访问仓库' : 'Accessible repositories',
    pathScopes: zh ? '路径范围' : 'Path scopes',
    knowledgeFiles: zh ? '知识文件' : 'Knowledge files',
    capabilitiesLabel: zh ? '核心能力' : 'Core capabilities',
    toolsLabel: zh ? '连接器与工具' : 'Connectors and tools',
    model: zh ? '模型' : 'Model',
    environment: zh ? '环境镜像' : 'Environment image',
    timeout: zh ? '超时（分钟）' : 'Timeout (minutes)',
    networkPolicy: zh ? '网络策略' : 'Network policy',
    allowedHosts: zh ? '允许的主机' : 'Allowed hosts',
    restricted: zh ? '完全受限' : 'Restricted',
    allowlist: zh ? '仅允许列表' : 'Allowlist only',
    unrestricted: zh ? '不限制' : 'Unrestricted',
    triggersLabel: zh ? '启动入口' : 'Launch triggers',
    workersLabel: zh ? 'Worker 委派' : 'Worker delegation',
    addWorker: zh ? '添加 Worker' : 'Add worker',
    workerName: zh ? 'Worker 名称' : 'Worker name',
    concurrency: zh ? '并发数' : 'Concurrency',
    workerInstructions: zh ? '委派说明' : 'Delegation instructions',
    remove: zh ? '移除' : 'Remove',
    approvalMode: zh ? '审批模式' : 'Approval mode',
    riskBased: zh ? '按风险判断' : 'Risk based',
    always: zh ? '所有外部写操作' : 'All external writes',
    never: zh ? '不要求审批' : 'Never require approval',
    protectedActions: zh ? '需要审批的动作' : 'Protected actions',
    testTask: zh ? '示例任务' : 'Sample task',
    testPlaceholder: zh ? '例如：检查支付服务的重试策略并准备一个最小风险 PR。' : 'Example: Review the payment retry policy and prepare a minimal-risk PR.',
    runPreview: zh ? '运行预览' : 'Run preview',
    runningPreview: zh ? '正在生成计划…' : 'Preparing a plan…',
    previewReady: zh ? '配置通过，执行计划已生成' : 'Configuration passed and a plan was generated',
    previewFailed: zh ? '配置校验未通过' : 'Configuration validation failed',
    noVersions: zh ? '尚未发布版本' : 'No published versions yet',
    current: zh ? '当前' : 'Current',
    rollback: zh ? '回滚到此版本' : 'Roll back to this version',
    versionBy: zh ? '发布者' : 'Published by',
    confirmLeave: zh ? '当前有未保存更改，确定离开吗？' : 'You have unsaved changes. Leave this page?',
  }
}

function ExpertStatusLabel({ status, label }: { status: ExpertStatus; label: string }) {
  return (
    <span className={`expert-status expert-status--${status}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  )
}

function ExpertAvatar({ expert, template }: { expert?: Expert; template?: ExpertTemplate }) {
  const iconName = expert?.draftConfig.icon ?? (template?.category === 'Security' ? 'ShieldCheck' : template?.category === 'Coding' ? 'Code2' : 'Sparkles')
  const Icon = expertIcons[iconName] ?? Sparkles
  return <span className="expert-avatar"><Icon aria-hidden="true" /></span>
}

function formatUpdated(value: string, locale: 'zh' | 'en') {
  const elapsed = Date.now() - Date.parse(value)
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return locale === 'zh' ? '刚刚' : 'Just now'
  const minutes = Math.max(1, Math.round(elapsed / 60_000))
  if (minutes < 60) return locale === 'zh' ? `${minutes} 分钟前` : `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return locale === 'zh' ? `${hours} 小时前` : `${hours}h ago`
  const days = Math.round(hours / 24)
  return locale === 'zh' ? `${days} 天前` : `${days}d ago`
}

type ExpertsPageProps = {
  store: ExpertStore
  onStoreChange: (store: ExpertStore) => void
  onOpenNavigation: () => void
  onCreateBlank: () => void
  onForkTemplate: (templateId: string) => void
  onEditExpert: (expertId: string) => void
  onStartSession: (expertId: string) => void
  onNotify: (message: string) => void
}

export function ExpertsPage({
  store,
  onStoreChange,
  onOpenNavigation,
  onCreateBlank,
  onForkTemplate,
  onEditExpert,
  onStartSession,
  onNotify,
}: ExpertsPageProps) {
  const { locale } = usePreferences()
  const copy = getCopy(locale)
  const [tab, setTab] = useState<'mine' | 'templates'>('mine')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | ExpertStatus>('all')
  const [category, setCategory] = useState<'All' | ExpertTemplateCategory>('All')

  const normalizedQuery = query.trim().toLowerCase()
  const filteredExperts = useMemo(() => store.experts.filter((expert) => {
    const matchesStatus = status === 'all' || expert.status === status
    const matchesQuery = !normalizedQuery
      || expert.draftConfig.name.toLowerCase().includes(normalizedQuery)
      || expert.draftConfig.description.toLowerCase().includes(normalizedQuery)
    return matchesStatus && matchesQuery
  }), [normalizedQuery, status, store.experts])

  const filteredTemplates = useMemo(() => expertTemplates.filter((template) => {
    const matchesCategory = category === 'All' || template.category === category
    const matchesQuery = !normalizedQuery
      || template.name.toLowerCase().includes(normalizedQuery)
      || template.description.toLowerCase().includes(normalizedQuery)
    return matchesCategory && matchesQuery
  }), [category, normalizedQuery])

  const updateLifecycle = (expert: Expert, action: 'disable' | 'enable' | 'archive' | 'restore') => {
    const result = action === 'disable'
      ? disableExpert(store, expert.id)
      : action === 'enable'
        ? enableExpert(store, expert.id)
        : action === 'archive'
          ? archiveExpert(store, expert.id)
          : restoreExpert(store, expert.id)
    onStoreChange(result.store)
    onNotify(copy[action === 'disable' ? 'disabled' : action === 'enable' ? 'enabled' : action === 'archive' ? 'archived' : 'restored'])
  }

  return (
    <main className="module-page experts-page">
      <header className="module-header">
        <div className="module-header__copy">
          <IconButton icon={Menu} label={locale === 'zh' ? '打开导航' : 'Open navigation'} className="mobile-menu" onClick={onOpenNavigation} />
          <div><h1>{copy.title}</h1><p>{copy.description}</p></div>
        </div>
        <div className="module-header__actions">
          <GlobalControls />
          <button type="button" className="button button--primary" onClick={onCreateBlank}><Plus aria-hidden="true" />{copy.create}</button>
        </div>
      </header>

      <div className="module-scroll experts-page__scroll">
        <div className="experts-tabs" role="tablist" aria-label={copy.title}>
          <button type="button" role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'experts-tab experts-tab--active' : 'experts-tab'} onClick={() => { setTab('mine'); setQuery('') }}>
            <Bot aria-hidden="true" />{copy.mine}<span>{store.experts.filter((expert) => expert.status !== 'archived').length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'templates'} className={tab === 'templates' ? 'experts-tab experts-tab--active' : 'experts-tab'} onClick={() => { setTab('templates'); setQuery('') }}>
            <Sparkles aria-hidden="true" />{copy.templates}<span>{expertTemplates.length}</span>
          </button>
        </div>

        {tab === 'mine' ? (
          <section className="experts-surface" aria-label={copy.mine}>
            <div className="experts-toolbar">
              <div><strong>{copy.expertsCount(filteredExperts.length)}</strong><span>{locale === 'zh' ? '专家是可复用配置，会话是一次具体运行。' : 'Experts are reusable configurations; Sessions are concrete runs.'}</span></div>
              <div className="experts-toolbar__controls">
                <label className="search-field experts-search"><Search aria-hidden="true" /><input aria-label={copy.searchMine} placeholder={copy.searchMine} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
                <label className="experts-select"><span className="sr-only">{copy.status}</span><select aria-label={copy.status} value={status} onChange={(event) => setStatus(event.target.value as 'all' | ExpertStatus)}>
                  <option value="all">{copy.allStatuses}</option>
                  {(Object.keys(copy.statusLabels) as ExpertStatus[]).map((item) => <option value={item} key={item}>{copy.statusLabels[item]}</option>)}
                </select></label>
              </div>
            </div>

            <div className="expert-console-list" role="table" aria-label={copy.mine}>
              <div className="expert-console-row expert-console-row--head" role="row">
                <span>{copy.name}</span><span>{copy.status}</span><span>{copy.scope}</span><span>{copy.triggers}</span><span>{copy.version}</span><span>{copy.updated}</span><span />
              </div>
              {filteredExperts.map((expert) => {
                const enabledTriggers = expert.draftConfig.triggers.filter((trigger) => trigger.enabled)
                const isArchived = expert.status === 'archived'
                return (
                  <article className="expert-console-row" role="row" key={expert.id}>
                    <button type="button" className="expert-console-row__identity" onClick={() => !isArchived && onEditExpert(expert.id)} disabled={isArchived}>
                      <ExpertAvatar expert={expert} />
                      <span><strong>{expert.draftConfig.name}</strong><small>{expert.draftConfig.description}</small></span>
                    </button>
                    <span className="expert-console-row__status"><ExpertStatusLabel status={expert.status} label={copy.statusLabels[expert.status]} />{expert.hasUnpublishedChanges && expert.status !== 'draft' ? <small>{copy.unsaved}</small> : null}</span>
                    <span className="expert-console-row__meta" data-label={copy.scope}><strong>{expert.draftConfig.repositories.length ? expert.draftConfig.repositories.length : copy.noRepo}</strong><small>{expert.draftConfig.repositories.slice(0, 1).join('')}</small></span>
                    <span className="expert-console-row__meta" data-label={copy.triggers}><strong>{enabledTriggers.length || copy.manualOnly}</strong><small>{enabledTriggers.map((trigger) => trigger.type).join(' · ')}</small></span>
                    <span className="expert-console-row__version" data-label={copy.version}>v{expert.latestVersion || 0}</span>
                    <span className="expert-console-row__updated" data-label={copy.updated}>{formatUpdated(expert.updatedAt, locale)}</span>
                    <span className="expert-console-row__actions">
                      {expert.status === 'published' ? <IconButton icon={Play} label={`${copy.start}: ${expert.draftConfig.name}`} size="sm" onClick={() => onStartSession(expert.id)} /> : null}
                      {!isArchived ? <IconButton icon={Wrench} label={`${copy.edit}: ${expert.draftConfig.name}`} size="sm" onClick={() => onEditExpert(expert.id)} /> : null}
                      {expert.status === 'published' ? <IconButton icon={CircleOff} label={`${copy.disable}: ${expert.draftConfig.name}`} size="sm" onClick={() => updateLifecycle(expert, 'disable')} /> : null}
                      {expert.status === 'disabled' ? <IconButton icon={CheckCircle2} label={`${copy.enable}: ${expert.draftConfig.name}`} size="sm" onClick={() => updateLifecycle(expert, 'enable')} /> : null}
                      {expert.status === 'archived'
                        ? <IconButton icon={RotateCcw} label={`${copy.restore}: ${expert.draftConfig.name}`} size="sm" onClick={() => updateLifecycle(expert, 'restore')} />
                        : <IconButton icon={Archive} label={`${copy.archive}: ${expert.draftConfig.name}`} size="sm" onClick={() => updateLifecycle(expert, 'archive')} />}
                    </span>
                  </article>
                )
              })}
              {filteredExperts.length === 0 ? <p className="experts-empty">{copy.emptyMine}</p> : null}
            </div>
          </section>
        ) : (
          <section className="experts-surface" aria-label={copy.templates}>
            <div className="template-library-intro">
              <div><strong>{copy.templatesCount}</strong><span>{copy.templateNote}</span></div>
              <label className="search-field experts-search"><Search aria-hidden="true" /><input aria-label={copy.searchTemplates} placeholder={copy.searchTemplates} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            </div>
            <div className="template-filters" role="group" aria-label={copy.allCategories}>
              <button type="button" className={category === 'All' ? 'template-filter template-filter--active' : 'template-filter'} aria-pressed={category === 'All'} onClick={() => setCategory('All')}>{copy.allCategories}<span>{expertTemplates.length}</span></button>
              {expertTemplateCategories.map((item) => {
                const count = expertTemplates.filter((template) => template.category === item).length
                return <button type="button" className={category === item ? 'template-filter template-filter--active' : 'template-filter'} aria-pressed={category === item} onClick={() => setCategory(item)} key={item}>{item}<span>{count}</span></button>
              })}
            </div>
            <div className="expert-template-grid">
              {filteredTemplates.map((template) => (
                <article className="expert-template-card" key={template.id}>
                  <header><ExpertAvatar template={template} /><span><small>{template.category}</small><h2>{template.name}</h2></span></header>
                  <p>{template.description}</p>
                  <footer>
                    <a href={`https://www.augmentcode.com${template.sourcePath}`} target="_blank" rel="noreferrer">{copy.sourceWorkflow}<ChevronRight aria-hidden="true" /></a>
                    <button type="button" className="button button--ghost button--compact" onClick={() => onForkTemplate(template.id)}><Plus aria-hidden="true" />{copy.fork}</button>
                  </footer>
                </article>
              ))}
            </div>
            {filteredTemplates.length === 0 ? <p className="experts-empty">{copy.emptyTemplates}</p> : null}
          </section>
        )}
      </div>
    </main>
  )
}

type ExpertEditorPageProps = {
  store: ExpertStore
  expertId: string
  onStoreChange: (store: ExpertStore) => void
  onOpenNavigation: () => void
  onBack: () => void
  onStartSession: (expertId: string) => void
  onNotify: (message: string) => void
}

function splitLines(value: string) {
  return value.split('\n').map((item) => item.trim()).filter(Boolean)
}

function joinLines(value: string[]) {
  return value.join('\n')
}

export function ExpertEditorPage({
  store,
  expertId,
  onStoreChange,
  onOpenNavigation,
  onBack,
  onStartSession,
  onNotify,
}: ExpertEditorPageProps) {
  const { locale } = usePreferences()
  const copy = getCopy(locale)
  const expert = store.experts.find((item) => item.id === expertId)
  const [draft, setDraft] = useState<ExpertConfig | null>(() => expert ? expert.draftConfig : null)
  const [activeSection, setActiveSection] = useState<EditorSectionId>('identity')
  const [dryRunState, setDryRunState] = useState<'idle' | 'running' | 'passed' | 'failed'>('idle')
  const [dryRunIssues, setDryRunIssues] = useState<string[]>([])
  const [sampleTask, setSampleTask] = useState(locale === 'zh' ? '检查支付服务的重试策略并准备一个最小风险 PR。' : 'Review the payment retry policy and prepare a minimal-risk PR.')
  const dryRunTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => {
    if (dryRunTimer.current) window.clearTimeout(dryRunTimer.current)
  }, [])

  if (!expert || !draft) return null

  const dirty = JSON.stringify(draft) !== JSON.stringify(expert.draftConfig)
  const versions = listExpertVersions(store, expert.id)

  const replaceDraft = <Key extends keyof ExpertConfig>(key: Key, value: ExpertConfig[Key]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current)
    setDryRunState('idle')
  }

  const saveDraft = () => {
    const result = updateExpert(store, expert.id, draft)
    onStoreChange(result.store)
    onNotify(copy.saved)
    return result.store
  }

  const publish = () => {
    let nextStore = store
    if (dirty) nextStore = updateExpert(nextStore, expert.id, draft).store
    try {
      const result = publishExpert(nextStore, expert.id)
      onStoreChange(result.store)
      onNotify(copy.published)
      setDryRunIssues([])
    } catch (error) {
      if (error instanceof ExpertValidationError) {
        setDryRunState('failed')
        setDryRunIssues(error.issues.map((issue) => issue.message))
        onNotify(copy.validationFailed)
        document.getElementById('expert-section-test')?.scrollIntoView?.({ behavior: 'smooth' })
        return
      }
      throw error
    }
  }

  const runDryRun = () => {
    if (dryRunTimer.current) window.clearTimeout(dryRunTimer.current)
    document.getElementById('expert-section-test')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    const issues = validateExpertConfig(draft)
    if (issues.length) {
      setDryRunIssues(issues.map((issue) => issue.message))
      setDryRunState('failed')
      return
    }
    setDryRunIssues([])
    setDryRunState('running')
    dryRunTimer.current = window.setTimeout(() => {
      setDryRunState('passed')
      onNotify(copy.previewReady)
    }, 520)
  }

  const leaveEditor = () => {
    if (dirty && !window.confirm(copy.confirmLeave)) return
    onBack()
  }

  const scrollToSection = (section: EditorSectionId) => {
    setActiveSection(section)
    document.getElementById(`expert-section-${section}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  const toggleRepository = (repository: string) => {
    const next = draft.repositories.includes(repository)
      ? draft.repositories.filter((item) => item !== repository)
      : [...draft.repositories, repository]
    replaceDraft('repositories', next)
  }

  const toggleCapability = (capability: string) => {
    const next = draft.capabilities.includes(capability)
      ? draft.capabilities.filter((item) => item !== capability)
      : [...draft.capabilities, capability]
    replaceDraft('capabilities', next)
  }

  const toggleTool = (toolId: string) => {
    const option = toolOptions.find((item) => item.id === toolId)!
    const existing = draft.tools.find((tool) => tool.id === toolId)
    const next = existing
      ? draft.tools.map((tool) => tool.id === toolId ? { ...tool, enabled: !tool.enabled } : tool)
      : [...draft.tools, { id: option.id, name: option.name, enabled: true, permissions: option.permissions }]
    replaceDraft('tools', next)
  }

  const toggleTrigger = (type: ExpertTriggerType) => {
    const option = triggerOptions.find((item) => item.type === type)!
    const existing = draft.triggers.find((trigger) => trigger.type === type)
    const next = existing
      ? draft.triggers.map((trigger) => trigger.type === type ? { ...trigger, enabled: !trigger.enabled } : trigger)
      : [...draft.triggers, { id: `trigger-${type}`, type, enabled: true, event: option.event, filter: {} }]
    replaceDraft('triggers', next)
  }

  const addWorker = () => {
    let nextWorkerIndex = draft.workers.length + 1
    while (draft.workers.some((worker) => worker.id === `worker-${nextWorkerIndex}`)) nextWorkerIndex += 1
    replaceDraft('workers', [...draft.workers, {
      id: `worker-${nextWorkerIndex}`,
      name: locale === 'zh' ? '验证 Worker' : 'Verifier worker',
      instructions: locale === 'zh' ? '独立验证主专家的结果并返回证据。' : 'Independently verify the primary Expert output and return evidence.',
      concurrency: 1,
    }])
  }

  const toggleApprovalAction = (action: ExpertApprovalAction) => {
    const current = draft.approvalPolicy.requiredFor
    const requiredFor = current.includes(action) ? current.filter((item) => item !== action) : [...current, action]
    replaceDraft('approvalPolicy', { ...draft.approvalPolicy, requiredFor })
  }

  const rollback = (versionId: string) => {
    const result = rollbackExpert(store, expert.id, versionId)
    onStoreChange(result.store)
    setDraft(result.expert.draftConfig)
    onNotify(copy.rolledBack)
  }

  return (
    <main className="module-page expert-editor-page">
      <header className="module-header expert-editor-header">
        <div className="module-header__copy">
          <IconButton icon={Menu} label={locale === 'zh' ? '打开导航' : 'Open navigation'} className="mobile-menu" onClick={onOpenNavigation} />
          <IconButton icon={ArrowLeft} label={copy.back} onClick={leaveEditor} />
          <div className="expert-editor-header__identity"><h1>{draft.name || (locale === 'zh' ? '未命名专家' : 'Untitled expert')}</h1><p>{copy.statusLabels[expert.status]} · v{expert.latestVersion}{dirty ? ` · ${copy.unsaved}` : ''}</p></div>
        </div>
        <div className="module-header__actions expert-editor-header__actions">
          <GlobalControls />
          {expert.status === 'published' && !dirty ? <IconButton icon={Play} label={copy.start} onClick={() => onStartSession(expert.id)} /> : null}
          <button type="button" className="button button--ghost" aria-label={copy.dryRun} title={copy.dryRun} onClick={runDryRun}><Beaker aria-hidden="true" />{copy.dryRun}</button>
          <button type="button" className="button button--ghost" aria-label={copy.saveDraft} title={copy.saveDraft} disabled={!dirty} onClick={saveDraft}><Save aria-hidden="true" />{copy.saveDraft}</button>
          <button type="button" className="button button--primary" aria-label={expert.latestVersion ? copy.publishUpdate : copy.publish} title={expert.latestVersion ? copy.publishUpdate : copy.publish} onClick={publish}><Check aria-hidden="true" />{expert.latestVersion ? copy.publishUpdate : copy.publish}</button>
        </div>
      </header>

      <div className="expert-editor-layout">
        <nav className="expert-editor-nav" aria-label={locale === 'zh' ? '专家配置分区' : 'Expert configuration sections'}>
          <div className="expert-editor-nav__summary">
            <ExpertAvatar expert={{ ...expert, draftConfig: draft }} />
            <span><strong>{draft.name || 'Untitled expert'}</strong><small>{draft.model}</small></span>
          </div>
          {sectionIds.map((section) => (
            <button type="button" className={activeSection === section ? 'expert-editor-nav__item expert-editor-nav__item--active' : 'expert-editor-nav__item'} onClick={() => scrollToSection(section)} key={section}>
              {copy.sections[section]}
              <ChevronRight aria-hidden="true" />
            </button>
          ))}
        </nav>

        <div className="expert-editor-scroll">
          <div className="expert-editor-form">
            <section className="expert-form-section" id="expert-section-identity">
              <header><span><h2>{copy.sections.identity}</h2><p>{copy.sectionDescriptions.identity}</p></span></header>
              <div className="expert-form-grid expert-form-grid--two">
                <label className="field"><span>{copy.displayName}</span><input aria-label={copy.displayName} value={draft.name} onChange={(event) => replaceDraft('name', event.target.value)} /></label>
                <label className="field field--select"><span>{copy.category}</span><span className="select-shell"><Sparkles aria-hidden="true" /><select aria-label={copy.category} value={draft.category} onChange={(event) => replaceDraft('category', event.target.value as ExpertTemplateCategory)}>{expertTemplateCategories.map((item) => <option key={item}>{item}</option>)}</select><ChevronRight aria-hidden="true" /></span></label>
              </div>
              <label className="field"><span>{copy.roleDescription}</span><textarea aria-label={copy.roleDescription} rows={3} value={draft.description} onChange={(event) => replaceDraft('description', event.target.value)} /></label>
              <div className="expert-inline-setting">
                <span><strong>{copy.icon}</strong><small>{locale === 'zh' ? '使用统一线性图标，保证不同主题下清晰可辨。' : 'Use a consistent line icon that remains clear in both themes.'}</small></span>
                <div className="expert-icon-picker" role="group" aria-label={copy.icon}>{iconOptions.map((option) => { const Icon = option.icon; return <button type="button" aria-label={option.value} aria-pressed={draft.icon === option.value} className={draft.icon === option.value ? 'expert-icon-option expert-icon-option--active' : 'expert-icon-option'} onClick={() => replaceDraft('icon', option.value)} key={option.value}><Icon aria-hidden="true" /></button> })}</div>
              </div>
              <fieldset className="expert-radio-group"><legend>{copy.visibility}</legend><label><input type="radio" name="visibility" checked={draft.visibility === 'workspace'} onChange={() => replaceDraft('visibility', 'workspace')} /><span><Users aria-hidden="true" /><strong>{copy.workspace}</strong></span></label><label><input type="radio" name="visibility" checked={draft.visibility === 'private'} onChange={() => replaceDraft('visibility', 'private')} /><span><Eye aria-hidden="true" /><strong>{copy.private}</strong></span></label></fieldset>
            </section>

            <section className="expert-form-section" id="expert-section-instructions">
              <header><span><h2>{copy.sections.instructions}</h2><p>{copy.sectionDescriptions.instructions}</p></span></header>
              {expert.sourceTemplateId ? <p className="expert-source-note"><Sparkles aria-hidden="true" />{copy.workflowStarterNote}</p> : null}
              <label className="field"><span>{copy.instructionsLabel}</span><textarea className="expert-prompt-input" aria-label={copy.instructionsLabel} placeholder={copy.instructionsPlaceholder} rows={10} value={draft.instructions} onChange={(event) => replaceDraft('instructions', event.target.value)} /></label>
              <div className="expert-form-grid expert-form-grid--two">
                <label className="field"><span>{copy.constraints}<small>{copy.lineHint}</small></span><textarea aria-label={copy.constraints} rows={5} value={joinLines(draft.constraints)} onChange={(event) => replaceDraft('constraints', splitLines(event.target.value))} /></label>
                <label className="field"><span>{copy.completion}<small>{copy.lineHint}</small></span><textarea aria-label={copy.completion} rows={5} value={joinLines(draft.completionCriteria)} onChange={(event) => replaceDraft('completionCriteria', splitLines(event.target.value))} /></label>
              </div>
              <label className="field"><span>{copy.launchGuidance}</span><textarea aria-label={copy.launchGuidance} placeholder={copy.launchPlaceholder} rows={3} value={draft.launchGuidance} onChange={(event) => replaceDraft('launchGuidance', event.target.value)} /></label>
            </section>

            <section className="expert-form-section" id="expert-section-context">
              <header><span><h2>{copy.sections.context}</h2><p>{copy.sectionDescriptions.context}</p></span></header>
              <fieldset className="expert-check-list"><legend>{copy.repositories}</legend>{repositories.map((repository) => <label key={repository}><input type="checkbox" checked={draft.repositories.includes(repository)} onChange={() => toggleRepository(repository)} /><span><GitBranch aria-hidden="true" /><strong>{repository}</strong></span></label>)}</fieldset>
              <div className="expert-form-grid expert-form-grid--two">
                <label className="field"><span>{copy.pathScopes}<small>{copy.lineHint}</small></span><textarea aria-label={copy.pathScopes} rows={4} value={joinLines(draft.context.pathScopes)} onChange={(event) => replaceDraft('context', { ...draft.context, pathScopes: splitLines(event.target.value) })} placeholder={'src/**\ntest/**'} /></label>
                <label className="field"><span>{copy.knowledgeFiles}<small>{copy.lineHint}</small></span><textarea aria-label={copy.knowledgeFiles} rows={4} value={joinLines(draft.context.knowledgeFiles)} onChange={(event) => replaceDraft('context', { ...draft.context, knowledgeFiles: splitLines(event.target.value) })} placeholder={'AGENTS.md\ndocs/architecture.md'} /></label>
              </div>
            </section>

            <section className="expert-form-section" id="expert-section-capabilities">
              <header><span><h2>{copy.sections.capabilities}</h2><p>{copy.sectionDescriptions.capabilities}</p></span></header>
              <h3 className="expert-subsection-title">{copy.capabilitiesLabel}</h3>
              <div className="expert-toggle-list">{capabilityOptions.map((option) => { const Icon = option.icon; const enabled = draft.capabilities.includes(option.id); return <label className="expert-toggle-row" key={option.id}><span className="expert-toggle-row__icon"><Icon aria-hidden="true" /></span><span><strong>{locale === 'zh' ? option.zh : option.en}</strong><small>{option.id}</small></span><input type="checkbox" role="switch" checked={enabled} onChange={() => toggleCapability(option.id)} /></label> })}</div>
              <h3 className="expert-subsection-title">{copy.toolsLabel}</h3>
              <div className="expert-toggle-list">{toolOptions.map((option) => { const Icon = option.icon; const enabled = draft.tools.find((tool) => tool.id === option.id)?.enabled ?? false; return <label className="expert-toggle-row" key={option.id}><span className="expert-toggle-row__icon"><Icon aria-hidden="true" /></span><span><strong>{option.name}</strong><small>{locale === 'zh' ? option.zh : option.en}</small></span><input type="checkbox" role="switch" checked={enabled} onChange={() => toggleTool(option.id)} /></label> })}</div>
            </section>

            <section className="expert-form-section" id="expert-section-runtime">
              <header><span><h2>{copy.sections.runtime}</h2><p>{copy.sectionDescriptions.runtime}</p></span></header>
              <div className="expert-form-grid expert-form-grid--two">
                <label className="field field--select"><span>{copy.model}</span><span className="select-shell"><Sparkles aria-hidden="true" /><select aria-label={copy.model} value={draft.model} onChange={(event) => replaceDraft('model', event.target.value)}>{SUPPORTED_AGENT_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}</select><ChevronRight aria-hidden="true" /></span></label>
                <label className="field field--select"><span>{copy.environment}</span><span className="select-shell"><Box aria-hidden="true" /><select aria-label={copy.environment} value={draft.environment.image} onChange={(event) => replaceDraft('environment', { ...draft.environment, image: event.target.value })}><option value="">{locale === 'zh' ? '选择环境' : 'Select environment'}</option><option>cosmos-ubuntu-22.04</option><option>node-22-browser</option><option>go-1.24-services</option><option>read-only-analysis</option></select><ChevronRight aria-hidden="true" /></span></label>
                <label className="field"><span>{copy.timeout}</span><input aria-label={copy.timeout} type="number" min="1" max="480" value={draft.environment.timeoutMinutes} onChange={(event) => replaceDraft('environment', { ...draft.environment, timeoutMinutes: Number(event.target.value) })} /></label>
                <label className="field field--select"><span>{copy.networkPolicy}</span><span className="select-shell"><Network aria-hidden="true" /><select aria-label={copy.networkPolicy} value={draft.environment.networkPolicy} onChange={(event) => replaceDraft('environment', { ...draft.environment, networkPolicy: event.target.value as ExpertConfig['environment']['networkPolicy'] })}><option value="restricted">{copy.restricted}</option><option value="allowlist">{copy.allowlist}</option><option value="unrestricted">{copy.unrestricted}</option></select><ChevronRight aria-hidden="true" /></span></label>
              </div>
              <label className="field"><span>{copy.allowedHosts}<small>{copy.lineHint}</small></span><textarea aria-label={copy.allowedHosts} rows={3} value={joinLines(draft.environment.allowedHosts)} onChange={(event) => replaceDraft('environment', { ...draft.environment, allowedHosts: splitLines(event.target.value) })} placeholder={'github.com\napi.github.com'} /></label>
            </section>

            <section className="expert-form-section" id="expert-section-orchestration">
              <header><span><h2>{copy.sections.orchestration}</h2><p>{copy.sectionDescriptions.orchestration}</p></span></header>
              <h3 className="expert-subsection-title">{copy.triggersLabel}</h3>
              <div className="expert-toggle-list">{triggerOptions.map((option) => { const trigger = draft.triggers.find((item) => item.type === option.type); return <label className="expert-toggle-row" key={option.type}><span className="expert-toggle-row__icon"><Webhook aria-hidden="true" /></span><span><strong>{locale === 'zh' ? option.zh : option.en}</strong><small>{trigger?.event ?? option.event}</small></span><input type="checkbox" role="switch" checked={trigger?.enabled ?? false} onChange={() => toggleTrigger(option.type)} /></label> })}</div>
              <div className="expert-subsection-heading"><h3 className="expert-subsection-title">{copy.workersLabel}</h3><button type="button" className="button button--ghost button--compact" onClick={addWorker}><Plus aria-hidden="true" />{copy.addWorker}</button></div>
              <div className="expert-worker-list">{draft.workers.map((worker) => <article className="expert-worker-row" key={worker.id}><span className="expert-worker-row__icon"><Users aria-hidden="true" /></span><label className="field"><span>{copy.workerName}</span><input value={worker.name} onChange={(event) => replaceDraft('workers', draft.workers.map((item) => item.id === worker.id ? { ...item, name: event.target.value } : item))} /></label><label className="field"><span>{copy.concurrency}</span><input type="number" min="1" max="8" value={worker.concurrency} onChange={(event) => replaceDraft('workers', draft.workers.map((item) => item.id === worker.id ? { ...item, concurrency: Number(event.target.value) } : item))} /></label><label className="field expert-worker-row__instructions"><span>{copy.workerInstructions}</span><input value={worker.instructions} onChange={(event) => replaceDraft('workers', draft.workers.map((item) => item.id === worker.id ? { ...item, instructions: event.target.value } : item))} /></label><button type="button" className="expert-text-button expert-text-button--danger" onClick={() => replaceDraft('workers', draft.workers.filter((item) => item.id !== worker.id))}>{copy.remove}</button></article>)}{draft.workers.length === 0 ? <p className="expert-inline-empty">{locale === 'zh' ? '当前专家独立执行，不会委派 Worker。' : 'This Expert runs independently and does not delegate workers.'}</p> : null}</div>
            </section>

            <section className="expert-form-section" id="expert-section-governance">
              <header><span><h2>{copy.sections.governance}</h2><p>{copy.sectionDescriptions.governance}</p></span></header>
              <fieldset className="expert-radio-group expert-radio-group--three"><legend>{copy.approvalMode}</legend><label><input type="radio" name="approval" checked={draft.approvalPolicy.mode === 'risk_based'} onChange={() => replaceDraft('approvalPolicy', { ...draft.approvalPolicy, mode: 'risk_based' })} /><span><ShieldCheck aria-hidden="true" /><strong>{copy.riskBased}</strong></span></label><label><input type="radio" name="approval" checked={draft.approvalPolicy.mode === 'always'} onChange={() => replaceDraft('approvalPolicy', { ...draft.approvalPolicy, mode: 'always' })} /><span><Users aria-hidden="true" /><strong>{copy.always}</strong></span></label><label><input type="radio" name="approval" checked={draft.approvalPolicy.mode === 'never'} onChange={() => replaceDraft('approvalPolicy', { ...draft.approvalPolicy, mode: 'never' })} /><span><CircleOff aria-hidden="true" /><strong>{copy.never}</strong></span></label></fieldset>
              <fieldset className="expert-check-list"><legend>{copy.protectedActions}</legend>{approvalActions.map((action) => <label key={action.id}><input type="checkbox" disabled={draft.approvalPolicy.mode === 'never'} checked={draft.approvalPolicy.requiredFor.includes(action.id)} onChange={() => toggleApprovalAction(action.id)} /><span><ShieldCheck aria-hidden="true" /><strong>{locale === 'zh' ? action.zh : action.en}</strong></span></label>)}</fieldset>
            </section>

            <section className="expert-form-section" id="expert-section-test">
              <header><span><h2>{copy.sections.test}</h2><p>{copy.sectionDescriptions.test}</p></span></header>
              <div className="expert-dry-run">
                <label className="field"><span>{copy.testTask}</span><textarea aria-label={copy.testTask} placeholder={copy.testPlaceholder} rows={4} value={sampleTask} onChange={(event) => setSampleTask(event.target.value)} /></label>
                <button type="button" className="button button--ghost" disabled={!sampleTask.trim() || dryRunState === 'running'} onClick={runDryRun}><Beaker aria-hidden="true" />{dryRunState === 'running' ? copy.runningPreview : copy.runPreview}</button>
                {dryRunState === 'passed' ? <div className="expert-dry-run-result expert-dry-run-result--passed"><header><CheckCircle2 aria-hidden="true" /><span><strong>{copy.previewReady}</strong><small>{locale === 'zh' ? '模拟模式 · 不会写入仓库或外部系统' : 'Simulation mode · no repository or external writes'}</small></span></header><ol><li>{locale === 'zh' ? '读取绑定仓库和知识文件' : 'Load bound repositories and knowledge files'}</li><li>{locale === 'zh' ? '生成风险分级执行计划' : 'Prepare a risk-classified execution plan'}</li><li>{locale === 'zh' ? '在审批边界前停止并输出证据' : 'Stop at approval boundaries and return evidence'}</li></ol></div> : null}
                {dryRunState === 'failed' ? <div className="expert-dry-run-result expert-dry-run-result--failed"><header><CircleOff aria-hidden="true" /><span><strong>{copy.previewFailed}</strong><small>{copy.validationFailed}</small></span></header><ul>{dryRunIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}
              </div>
            </section>

            <section className="expert-form-section" id="expert-section-versions">
              <header><span><h2>{copy.sections.versions}</h2><p>{copy.sectionDescriptions.versions}</p></span></header>
              <div className="expert-version-list">{versions.map((version) => { const current = version.id === expert.publishedVersionId; return <article className="expert-version-row" key={version.id}><span className="expert-version-row__icon"><History aria-hidden="true" /></span><span><strong>v{version.version} {current ? `· ${copy.current}` : ''}</strong><small>{new Date(version.createdAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')} · {copy.versionBy} {version.createdBy}</small></span><span className="expert-version-row__model">{version.configSnapshot.model}</span>{current ? <span className="expert-status expert-status--published"><span aria-hidden="true" />{copy.current}</span> : <button type="button" className="button button--ghost button--compact" onClick={() => rollback(version.id)}><RotateCcw aria-hidden="true" />{copy.rollback}</button>}</article> })}{versions.length === 0 ? <p className="expert-inline-empty">{copy.noVersions}</p> : null}</div>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
