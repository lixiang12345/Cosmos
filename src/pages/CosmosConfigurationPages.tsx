import {
  Activity,
  AlertTriangle,
  Beaker,
  Box,
  Boxes,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Copy,
  Database,
  EyeOff,
  FolderGit2,
  GitBranch,
  Globe2,
  History,
  KeyRound,
  Languages,
  LoaderCircle,
  Menu,
  Minus,
  Network,
  Paintbrush,
  PlugZap,
  Plus,
  Play,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SquareTerminal,
  SunMoon,
  UserRound,
  Users,
  Webhook,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { GlobalControls } from '../components/GlobalControls'
import { IconButton } from '../components/ui'
import {
  useControlPlane,
  type ControlPlaneScope,
  type CreateSecretInput,
  type Environment,
  type Integration,
  type McpServer,
  type Secret,
} from '../features/control-plane'
import { usePreferences, type Locale } from '../preferences'

export type CosmosConfigurationPageProps = {
  onOpenNavigation?: () => void
}

function copy(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en
}

function formatTime(value: string | undefined, locale: Locale) {
  if (!value) return copy(locale, '暂无', 'Never')
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function PageHeader({
  icon: Icon,
  title,
  description,
  onOpenNavigation,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  onOpenNavigation?: () => void
  action?: ReactNode
}) {
  const { locale } = usePreferences()
  return (
    <header className="cosmos-page-header">
      <div className="cosmos-page-header__identity">
        <IconButton
          icon={Menu}
          label={copy(locale, '打开导航', 'Open navigation')}
          className="cosmos-mobile-menu"
          onClick={() => onOpenNavigation?.()}
        />
        <span className="cosmos-page-header__icon"><Icon aria-hidden="true" /></span>
        <div><h1>{title}</h1><p>{description}</p></div>
      </div>
      <div className="cosmos-page-header__actions"><GlobalControls className="cosmos-global-controls" />{action}</div>
    </header>
  )
}

function PrototypeNote({ children }: { children: ReactNode }) {
  const { locale } = usePreferences()
  return (
    <div className="cosmos-prototype-note" role="note">
      <Beaker aria-hidden="true" />
      <span><strong>{copy(locale, '原型模拟', 'Prototype simulation')}</strong>{children}</span>
    </div>
  )
}

const commonStatusCopy: Record<string, { zh: string; en: string }> = {
  active: { zh: '当前', en: 'Active' },
  ready: { zh: '可用', en: 'Ready' },
  provisioning: { zh: '配置中', en: 'Provisioning' },
  failed: { zh: '失败', en: 'Failed' },
  disabled: { zh: '已停用', en: 'Disabled' },
  online: { zh: '在线', en: 'Online' },
  offline: { zh: '离线', en: 'Offline' },
  degraded: { zh: '异常', en: 'Degraded' },
  indexing: { zh: '索引中', en: 'Indexing' },
  stale: { zh: '需更新', en: 'Stale' },
  error: { zh: '错误', en: 'Error' },
  strict: { zh: '严格', en: 'Strict' },
  standard: { zh: '标准', en: 'Standard' },
  connected: { zh: '已连接', en: 'Connected' },
  disconnected: { zh: '未连接', en: 'Disconnected' },
  action_required: { zh: '需要处理', en: 'Action required' },
  healthy: { zh: '健康', en: 'Healthy' },
  unknown: { zh: '未知', en: 'Unknown' },
  failing: { zh: '投递失败', en: 'Failing' },
  untested: { zh: '未测试', en: 'Untested' },
}

function StatusLabel({ status, label }: { status: string; label?: string }) {
  const { locale } = usePreferences()
  const translated = commonStatusCopy[status]
  const fallback = status.replaceAll('_', ' ')
  return <span className={`cosmos-status cosmos-status--${status}`}><i aria-hidden="true" />{label ?? (translated ? translated[locale] : fallback)}</span>
}

function EmptyState({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return <div className="cosmos-empty"><Icon aria-hidden="true" /><strong>{title}</strong><p>{body}</p></div>
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { locale } = usePreferences()
  return (
    <div className="cosmos-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="cosmos-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><IconButton icon={X} label={copy(locale, '关闭', 'Close')} onClick={onClose} /></header>
        {children}
      </section>
    </div>
  )
}

const environmentImages = ['relay-ubuntu-22.04', 'node-22-browser', 'go-1.24-services', 'read-only-analysis']

type EnvironmentDraft = {
  name: string
  image: string
  repositoryIds: string[]
}

const initialEnvironmentDraft: EnvironmentDraft = {
  name: '',
  image: environmentImages[0],
  repositoryIds: [],
}

type EnvironmentDetailSection = 'overview' | 'repositories' | 'variables' | 'hooks' | 'terminal' | 'history'

type EnvironmentVariableDraft = {
  id: string
  key: string
  value: string
  secret: boolean
}

type EnvironmentHookDraft = {
  id: string
  name: string
  phase: 'setup' | 'startup'
  command: string
  enabled: boolean
}

type EnvironmentHistoryEntry = {
  id: string
  action: string
  detail: string
  at: string
}

type EnvironmentPrototypeConfig = {
  repositoryIds: string[]
  variables: EnvironmentVariableDraft[]
  hooks: EnvironmentHookDraft[]
  terminalLines: string[]
  history: EnvironmentHistoryEntry[]
}

function defaultEnvironmentConfig(environment: Environment, repositoryIds: string[]): EnvironmentPrototypeConfig {
  const packageCommand = environment.image.includes('go-') ? 'go mod download' : 'pnpm install --frozen-lockfile'
  return {
    repositoryIds: [...repositoryIds],
    variables: [{ id: 'variable-1', key: 'CI', value: 'true', secret: false }],
    hooks: [{ id: 'hook-1', name: 'Install dependencies', phase: 'setup', command: packageCommand, enabled: true }],
    terminalLines: [
      'Relay Cloud Environment Terminal (prototype)',
      `Image: ${environment.image}`,
      'No command is sent to a real VM.',
    ],
    history: [],
  }
}

function nextEnvironmentRowId(prefix: string, rows: Array<{ id: string }>) {
  const highest = rows.reduce((value, row) => {
    const suffix = Number(row.id.split('-').at(-1))
    return Number.isFinite(suffix) ? Math.max(value, suffix) : value
  }, 0)
  return `${prefix}-${highest + 1}`
}

export function EnvironmentsPage({ onOpenNavigation }: CosmosConfigurationPageProps) {
  const { locale } = usePreferences()
  const { activeSpace, scope, actions } = useControlPlane()
  const [selectedId, setSelectedId] = useState<string>()
  const [detailSection, setDetailSection] = useState<EnvironmentDetailSection>('overview')
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1)
  const [draft, setDraft] = useState<EnvironmentDraft>(initialEnvironmentDraft)
  const [prototypeConfigs, setPrototypeConfigs] = useState<Record<string, EnvironmentPrototypeConfig>>({})
  const [terminalInput, setTerminalInput] = useState('')
  const [notice, setNotice] = useState('')
  const selected = scope.environments.find((item) => item.id === selectedId) ?? scope.environments[0]
  const suggestedRepositoryIds = scope.repositories.slice(0, 2).map((repository) => repository.id)
  const selectedConfig = selected
    ? prototypeConfigs[selected.id] ?? defaultEnvironmentConfig(selected, suggestedRepositoryIds)
    : undefined

  const openWizard = () => {
    setDraft({ ...initialEnvironmentDraft, repositoryIds: suggestedRepositoryIds })
    setWizardStep(1)
    setWizardOpen(true)
  }

  const closeWizard = () => setWizardOpen(false)
  const nextWizardStep = () => setWizardStep((step) => step === 1 ? 2 : 3)
  const previousWizardStep = () => setWizardStep((step) => step === 3 ? 2 : 1)

  const createEnvironment = () => {
    if (!draft.name.trim()) return
    const environment = actions.createEnvironment({
      name: draft.name.trim(),
      image: draft.image,
    })
    const createdAt = new Date().toISOString()
    const config = defaultEnvironmentConfig(environment, draft.repositoryIds)
    setPrototypeConfigs((current) => ({
      ...current,
      [environment.id]: {
        ...config,
        history: [{
          id: 'history-1',
          action: copy(locale, '创建 Environment', 'Environment created'),
          detail: copy(locale, '已加入配置队列（原型模拟）', 'Added to the provisioning queue (prototype simulation)'),
          at: createdAt,
        }],
      },
    }))
    setSelectedId(environment.id)
    setDetailSection('overview')
    setNotice(copy(locale, 'Environment 已创建，配置进度为原型模拟。', 'Environment created. Provisioning progress is simulated.'))
    setWizardOpen(false)
  }

  const updateSelectedConfig = (update: (config: EnvironmentPrototypeConfig) => EnvironmentPrototypeConfig) => {
    if (!selected) return
    setPrototypeConfigs((current) => ({
      ...current,
      [selected.id]: update(current[selected.id] ?? defaultEnvironmentConfig(selected, suggestedRepositoryIds)),
    }))
  }

  const recordPrototypeChange = (action: string, detail: string) => {
    if (!selected) return
    const at = new Date().toISOString()
    updateSelectedConfig((config) => ({
      ...config,
      history: [{ id: `history-${config.history.length + 1}`, action, detail, at }, ...config.history],
    }))
    setNotice(copy(locale, `${action}已保存到当前原型状态。`, `${action} was saved to the current prototype state.`))
  }

  const toggleDraftRepository = (repositoryId: string) => {
    setDraft((current) => ({
      ...current,
      repositoryIds: current.repositoryIds.includes(repositoryId)
        ? current.repositoryIds.filter((id) => id !== repositoryId)
        : [...current.repositoryIds, repositoryId],
    }))
  }

  const toggleSelectedRepository = (repositoryId: string) => {
    updateSelectedConfig((config) => ({
      ...config,
      repositoryIds: config.repositoryIds.includes(repositoryId)
        ? config.repositoryIds.filter((id) => id !== repositoryId)
        : [...config.repositoryIds, repositoryId],
    }))
  }

  const runTerminalCommand = () => {
    if (!selected || !selectedConfig) return
    const command = terminalInput.trim()
    if (!command) return
    if (command === 'clear') {
      updateSelectedConfig((config) => ({ ...config, terminalLines: [] }))
      setTerminalInput('')
      return
    }
    const repositoryNames = scope.repositories
      .filter((repository) => selectedConfig.repositoryIds.includes(repository.id))
      .map((repository) => repository.fullName)
    const output = command === 'pwd'
      ? '/workspace'
      : command === 'ls'
        ? (repositoryNames.join('\n') || 'No repositories attached')
        : command === 'node --version'
          ? 'v22.12.0 (prototype)'
          : command === 'printenv'
            ? (selectedConfig.variables.map((variable) => `${variable.key}=${variable.secret ? '••••••••' : variable.value}`).join('\n') || 'No variables configured')
            : copy(locale, '原型：命令已接收，但没有连接或操作真实 VM。', 'Prototype: command accepted, but no real VM was connected or changed.')
    const at = new Date().toISOString()
    updateSelectedConfig((config) => ({
      ...config,
      terminalLines: [...config.terminalLines, `$ ${command}`, output],
      history: [{
        id: `history-${config.history.length + 1}`,
        action: copy(locale, 'Terminal 命令', 'Terminal command'),
        detail: command,
        at,
      }, ...config.history],
    }))
    setTerminalInput('')
  }

  const reprovisionSelected = () => {
    if (!selected) return
    actions.updateEnvironment(selected.id, { reprovision: true })
    recordPrototypeChange(
      copy(locale, '重建 Environment', 'Environment reprovisioned'),
      copy(locale, '已重新进入配置队列（原型模拟）', 'Returned to the provisioning queue (prototype simulation)'),
    )
  }

  const updateFromTerminal = () => {
    if (!selected) return
    actions.updateEnvironment(selected.id, { reprovision: true })
    recordPrototypeChange(
      copy(locale, '从 Terminal 更新 Environment', 'Environment updated from Terminal'),
      copy(locale, '当前 Terminal 配置已创建新的模拟快照', 'The current Terminal configuration created a new simulated snapshot'),
    )
  }

  const statusCopy: Record<Environment['status'], string> = {
    provisioning: copy(locale, '配置中', 'Provisioning'),
    ready: copy(locale, '可用', 'Ready'),
    failed: copy(locale, '失败', 'Failed'),
    disabled: copy(locale, '已停用', 'Disabled'),
  }

  const phaseCopy: Record<Environment['provisioning']['phase'], string> = {
    queued: copy(locale, '等待资源', 'Queued'),
    pulling_image: copy(locale, '拉取镜像', 'Pulling image'),
    configuring: copy(locale, '配置运行时', 'Configuring runtime'),
    ready: copy(locale, '环境可用', 'Environment ready'),
    failed: copy(locale, '配置失败', 'Provisioning failed'),
  }

  const detailSections: Array<{ id: EnvironmentDetailSection; icon: LucideIcon; label: string }> = [
    { id: 'overview', icon: Activity, label: copy(locale, '概览', 'Overview') },
    { id: 'repositories', icon: FolderGit2, label: copy(locale, '仓库', 'Repositories') },
    { id: 'variables', icon: KeyRound, label: copy(locale, '变量', 'Variables') },
    { id: 'hooks', icon: Wrench, label: 'Hooks' },
    { id: 'terminal', icon: SquareTerminal, label: 'Terminal' },
    { id: 'history', icon: History, label: copy(locale, '历史', 'History') },
  ]

  const wizardCanContinue = wizardStep === 1
    ? Boolean(draft.name.trim() && draft.image)
    : wizardStep === 2
      ? scope.repositories.length === 0 || draft.repositoryIds.length > 0
      : true

  return (
    <main className="cosmos-page environment-page">
      <PageHeader
        icon={Cloud}
        title={copy(locale, '运行环境', 'Environments')}
        description={copy(locale, `为 ${activeSpace.name} 管理 Cloud 快照与 Self-hosted 执行容量`, `Manage Cloud snapshots and self-hosted execution capacity for ${activeSpace.name}`)}
        onOpenNavigation={onOpenNavigation}
        action={<button type="button" className="cosmos-button cosmos-button--primary" onClick={openWizard}><Plus aria-hidden="true" />{copy(locale, '创建环境', 'Create environment')}</button>}
      />
      <div className="cosmos-page__scroll">
        <nav className="environment-runtime-tabs" aria-label={copy(locale, '运行环境类型', 'Environment types')}>
          <span className="environment-runtime-tab environment-runtime-tab--active" aria-current="page"><Cloud aria-hidden="true" /><span><strong>Cloud</strong><small>{copy(locale, '托管快照', 'Managed snapshots')}</small></span></span>
          <Link className="environment-runtime-tab" to="/daemons"><Server aria-hidden="true" /><span><strong>Self-hosted</strong><small>{scope.daemons.filter((daemon) => daemon.enabled).length}/{scope.daemons.length} {copy(locale, '台 Daemon 可用', 'Daemons available')}</small></span><ChevronRight aria-hidden="true" /></Link>
        </nav>
        <PrototypeNote>{copy(locale, 'Cloud Environment、Terminal、更新和配置进度均为确定性的原型模拟，不会创建真实快照或执行命令；Self-hosted 容量由 Daemon 管理。', 'Cloud Environments, Terminal, updates, and provisioning are deterministic prototype simulations; no real snapshot is created and no command is executed. Self-hosted capacity is managed by Daemons.')}</PrototypeNote>
        <div className="cosmos-master-detail environment-layout">
          <section className="cosmos-panel cosmos-environment-list environment-list" aria-label={copy(locale, '环境列表', 'Environment list')}>
            <header className="cosmos-section-heading"><div><span>Cloud</span><h2>{scope.environments.length} {copy(locale, '个 Environment', 'Environments')}</h2></div></header>
            {scope.environments.length ? scope.environments.map((environment) => (
              <button
                type="button"
                className={`cosmos-resource-row${selected?.id === environment.id ? ' cosmos-resource-row--selected' : ''}`}
                key={environment.id}
                onClick={() => { setSelectedId(environment.id); setDetailSection('overview'); setTerminalInput(''); setNotice('') }}
              >
                <span className="cosmos-resource-row__icon"><Box aria-hidden="true" /></span>
                <span className="cosmos-resource-row__copy"><strong>{environment.name}</strong><small>{environment.image} · {prototypeConfigs[environment.id]?.repositoryIds.length ?? suggestedRepositoryIds.length} repos</small></span>
                <StatusLabel status={environment.status} label={statusCopy[environment.status]} />
                <ChevronRight aria-hidden="true" />
              </button>
            )) : <EmptyState icon={Cloud} title={copy(locale, '还没有环境', 'No environments yet')} body={copy(locale, '创建第一个可复现运行时。', 'Create the first reproducible runtime.')} />}
          </section>

          <section className="cosmos-panel cosmos-detail-panel environment-detail">
            {selected && selectedConfig ? <>
              <header className="cosmos-detail-panel__header">
                <div><span>Cloud Environment</span><h2>{selected.name}</h2><code>{selected.slug} · {selected.image}</code></div>
                <StatusLabel status={selected.status} label={statusCopy[selected.status]} />
              </header>
              <div className="environment-detail-tabs" role="tablist" aria-label={copy(locale, 'Environment 详情', 'Environment details')}>
                {detailSections.map((section) => {
                  const Icon = section.icon
                  return <button type="button" role="tab" id={`environment-tab-${section.id}`} aria-controls={`environment-panel-${section.id}`} aria-selected={detailSection === section.id} className={detailSection === section.id ? 'environment-detail-tab environment-detail-tab--active' : 'environment-detail-tab'} key={section.id} onClick={() => { setDetailSection(section.id); setNotice('') }}><Icon aria-hidden="true" />{section.label}</button>
                })}
              </div>
              {notice ? <div className="environment-notice" role="status"><CheckCircle2 aria-hidden="true" />{notice}</div> : null}

              <div className="environment-detail-content" role="tabpanel" id={`environment-panel-${detailSection}`} aria-labelledby={`environment-tab-${detailSection}`}>
                {detailSection === 'overview' ? <div className="environment-overview">
                  <dl className="environment-overview-grid">
                    <div><dt><Box aria-hidden="true" />{copy(locale, '基础镜像', 'Base image')}</dt><dd>{selected.image}</dd></div>
                    <div><dt><FolderGit2 aria-hidden="true" />{copy(locale, '仓库', 'Repositories')}</dt><dd>{selectedConfig.repositoryIds.length}</dd></div>
                    <div><dt><Users aria-hidden="true" />{copy(locale, '共享范围', 'Sharing')}</dt><dd>{activeSpace.name}</dd></div>
                    <div><dt><Network aria-hidden="true" />{copy(locale, '网络', 'Network')}</dt><dd>{selected.networkPolicy}</dd></div>
                  </dl>
                  {selected.status === 'provisioning' || selected.status === 'failed' ? <div className="environment-provisioning">
                    <div><span><LoaderCircle aria-hidden="true" /><strong>{phaseCopy[selected.provisioning.phase]}</strong></span><small>{selected.provisioning.progress}%</small></div>
                    <div className="cosmos-progress" aria-label={`${selected.provisioning.progress}%`}><i style={{ width: `${selected.provisioning.progress}%` }} /></div>
                    <p>{selected.provisioning.message}</p>
                  </div> : <div className="environment-ready-summary"><CheckCircle2 aria-hidden="true" /><span><strong>{copy(locale, '可创建隔离 Session 快照', 'Ready for isolated Session snapshots')}</strong><small>{copy(locale, `最近更新 ${formatTime(selected.updatedAt, locale)}`, `Updated ${formatTime(selected.updatedAt, locale)}`)}</small></span></div>}
                  <section className="environment-definition">
                    <header><div><span>{copy(locale, 'Environment 定义', 'Environment definition')}</span><h3>{copy(locale, '配置来源', 'Configuration sources')}</h3></div></header>
                    <div><span>{copy(locale, '仓库', 'Repositories')}</span><strong>{selectedConfig.repositoryIds.length ? scope.repositories.filter((repository) => selectedConfig.repositoryIds.includes(repository.id)).map((repository) => repository.fullName).join(', ') : copy(locale, '未关联', 'None attached')}</strong></div>
                    <div><span>{copy(locale, '变量', 'Variables')}</span><strong>{selectedConfig.variables.length}</strong></div>
                    <div><span>Hooks</span><strong>{selectedConfig.hooks.filter((hook) => hook.enabled).length}/{selectedConfig.hooks.length} {copy(locale, '已启用', 'enabled')}</strong></div>
                    <div><span>{copy(locale, '允许主机', 'Allowed hosts')}</span><strong>{selected.allowedHosts.length ? selected.allowedHosts.join(', ') : copy(locale, '无外部访问', 'No external access')}</strong></div>
                  </section>
                  <details className="environment-advanced-policy">
                    <summary><Settings2 aria-hidden="true" /><span><strong>{copy(locale, 'Relay 高级运行策略', 'Relay advanced runtime policy')}</strong><small>{copy(locale, 'Cloud 资源按工作负载扩展；以下固定值仅为 Relay 原型策略。', 'Cloud resources scale with workload; fixed values below are Relay prototype policy.')}</small></span><ChevronRight aria-hidden="true" /></summary>
                    <dl><div><dt>vCPU</dt><dd>{selected.cpu}</dd></div><div><dt>{copy(locale, '内存', 'Memory')}</dt><dd>{selected.memoryGb} GB</dd></div><div><dt>{copy(locale, '会话超时', 'Session timeout')}</dt><dd>{selected.timeoutMinutes} min</dd></div></dl>
                  </details>
                  <footer className="environment-section-actions">
                    {selected.status === 'provisioning' ? <button type="button" className="cosmos-button cosmos-button--primary" onClick={() => { actions.advanceEnvironmentProvisioning(selected.id); recordPrototypeChange(copy(locale, '推进配置', 'Provisioning advanced'), phaseCopy[selected.provisioning.phase]) }}><RefreshCw aria-hidden="true" />{copy(locale, '推进配置模拟', 'Advance simulation')}</button> : <button type="button" className="cosmos-button cosmos-button--secondary" onClick={reprovisionSelected}><RefreshCw aria-hidden="true" />{copy(locale, '重建 Environment（模拟）', 'Reprovision (simulation)')}</button>}
                  </footer>
                </div> : null}

                {detailSection === 'repositories' ? <section className="environment-section">
                  <header className="environment-section-header"><div><span>{copy(locale, '代码上下文', 'Code context')}</span><h3>{copy(locale, '关联仓库', 'Attached repositories')}</h3><p>{copy(locale, '每个 Session 从这些仓库的新隔离快照启动。', 'Each Session starts from a fresh isolated snapshot of these repositories.')}</p></div><strong>{selectedConfig.repositoryIds.length}/{scope.repositories.length}</strong></header>
                  <div className="environment-selection-list">
                    {scope.repositories.map((repository) => <label key={repository.id}><input type="checkbox" checked={selectedConfig.repositoryIds.includes(repository.id)} onChange={() => toggleSelectedRepository(repository.id)} /><span className="cosmos-resource-row__icon"><FolderGit2 aria-hidden="true" /></span><span><strong>{repository.fullName}</strong><small>{repository.defaultBranch} · {repository.language} · {repository.indexStatus}</small></span></label>)}
                    {!scope.repositories.length ? <EmptyState icon={FolderGit2} title={copy(locale, '没有可用仓库', 'No repositories available')} body={copy(locale, '先连接仓库，再将它加入 Environment。', 'Connect a repository before attaching it to this Environment.')} /> : null}
                  </div>
                  <footer className="environment-section-actions"><button type="button" className="cosmos-button cosmos-button--primary" onClick={() => recordPrototypeChange(copy(locale, '仓库配置', 'Repository configuration'), copy(locale, `${selectedConfig.repositoryIds.length} 个仓库`, `${selectedConfig.repositoryIds.length} repositories`))}><Save aria-hidden="true" />{copy(locale, '保存仓库（模拟）', 'Save repositories (simulation)')}</button></footer>
                </section> : null}

                {detailSection === 'variables' ? <section className="environment-section">
                  <header className="environment-section-header"><div><span>{copy(locale, '运行时配置', 'Runtime configuration')}</span><h3>{copy(locale, '环境变量', 'Environment variables')}</h3><p>{copy(locale, '敏感值仅展示占位；真实产品使用 Secret 引用。', 'Sensitive values are masked; the real product uses Secret references.')}</p></div><button type="button" className="cosmos-button cosmos-button--secondary" onClick={() => updateSelectedConfig((config) => ({ ...config, variables: [...config.variables, { id: nextEnvironmentRowId('variable', config.variables), key: '', value: '', secret: false }] }))}><Plus aria-hidden="true" />{copy(locale, '添加变量', 'Add variable')}</button></header>
                  <div className="environment-editor-list">
                    {selectedConfig.variables.map((variable) => <div className="environment-editor-row environment-variable-row" key={variable.id}><label><span>{copy(locale, '名称', 'Name')}</span><input value={variable.key} placeholder="API_BASE_URL" onChange={(event) => updateSelectedConfig((config) => ({ ...config, variables: config.variables.map((item) => item.id === variable.id ? { ...item, key: event.target.value } : item) }))} /></label><label><span>{copy(locale, '值或引用', 'Value or reference')}</span><input type={variable.secret ? 'password' : 'text'} value={variable.value} placeholder={variable.secret ? 'secret://reference' : 'value'} onChange={(event) => updateSelectedConfig((config) => ({ ...config, variables: config.variables.map((item) => item.id === variable.id ? { ...item, value: event.target.value } : item) }))} /></label><label className="environment-inline-toggle"><input type="checkbox" checked={variable.secret} onChange={(event) => updateSelectedConfig((config) => ({ ...config, variables: config.variables.map((item) => item.id === variable.id ? { ...item, secret: event.target.checked } : item) }))} /><span>{copy(locale, '敏感值', 'Sensitive')}</span></label><IconButton icon={X} label={copy(locale, '移除变量', 'Remove variable')} size="sm" onClick={() => updateSelectedConfig((config) => ({ ...config, variables: config.variables.filter((item) => item.id !== variable.id) }))} /></div>)}
                    {!selectedConfig.variables.length ? <EmptyState icon={KeyRound} title={copy(locale, '没有变量', 'No variables')} body={copy(locale, '添加非敏感值或 Secret 引用。', 'Add a non-sensitive value or Secret reference.')} /> : null}
                  </div>
                  <footer className="environment-section-actions"><button type="button" className="cosmos-button cosmos-button--primary" onClick={() => recordPrototypeChange(copy(locale, '变量配置', 'Variable configuration'), copy(locale, `${selectedConfig.variables.length} 个变量`, `${selectedConfig.variables.length} variables`))}><Save aria-hidden="true" />{copy(locale, '保存变量（模拟）', 'Save variables (simulation)')}</button></footer>
                </section> : null}

                {detailSection === 'hooks' ? <section className="environment-section">
                  <header className="environment-section-header"><div><span>{copy(locale, '生命周期', 'Lifecycle')}</span><h3>Hooks</h3><p>{copy(locale, 'Setup 在快照更新时运行，Startup 在 Session 启动时运行。', 'Setup runs when the snapshot updates; Startup runs when a Session starts.')}</p></div><button type="button" className="cosmos-button cosmos-button--secondary" onClick={() => updateSelectedConfig((config) => ({ ...config, hooks: [...config.hooks, { id: nextEnvironmentRowId('hook', config.hooks), name: '', phase: 'setup', command: '', enabled: true }] }))}><Plus aria-hidden="true" />{copy(locale, '添加 Hook', 'Add hook')}</button></header>
                  <div className="environment-editor-list">
                    {selectedConfig.hooks.map((hook) => <div className="environment-editor-row environment-hook-row" key={hook.id}><label><span>{copy(locale, '名称', 'Name')}</span><input value={hook.name} placeholder="Install dependencies" onChange={(event) => updateSelectedConfig((config) => ({ ...config, hooks: config.hooks.map((item) => item.id === hook.id ? { ...item, name: event.target.value } : item) }))} /></label><label><span>{copy(locale, '阶段', 'Phase')}</span><select value={hook.phase} onChange={(event) => updateSelectedConfig((config) => ({ ...config, hooks: config.hooks.map((item) => item.id === hook.id ? { ...item, phase: event.target.value as EnvironmentHookDraft['phase'] } : item) }))}><option value="setup">Setup</option><option value="startup">Startup</option></select></label><label><span>{copy(locale, '命令', 'Command')}</span><input value={hook.command} placeholder="pnpm install --frozen-lockfile" onChange={(event) => updateSelectedConfig((config) => ({ ...config, hooks: config.hooks.map((item) => item.id === hook.id ? { ...item, command: event.target.value } : item) }))} /></label><label className="environment-inline-toggle"><input type="checkbox" checked={hook.enabled} onChange={(event) => updateSelectedConfig((config) => ({ ...config, hooks: config.hooks.map((item) => item.id === hook.id ? { ...item, enabled: event.target.checked } : item) }))} /><span>{copy(locale, '启用', 'Enabled')}</span></label><IconButton icon={X} label={copy(locale, '移除 Hook', 'Remove hook')} size="sm" onClick={() => updateSelectedConfig((config) => ({ ...config, hooks: config.hooks.filter((item) => item.id !== hook.id) }))} /></div>)}
                    {!selectedConfig.hooks.length ? <EmptyState icon={Wrench} title={copy(locale, '没有 Hooks', 'No hooks')} body={copy(locale, '添加可重复的 setup 或 startup 命令。', 'Add a repeatable setup or startup command.')} /> : null}
                  </div>
                  <footer className="environment-section-actions"><button type="button" className="cosmos-button cosmos-button--primary" onClick={() => recordPrototypeChange('Hooks', copy(locale, `${selectedConfig.hooks.filter((hook) => hook.enabled).length} 个已启用`, `${selectedConfig.hooks.filter((hook) => hook.enabled).length} enabled`))}><Save aria-hidden="true" />{copy(locale, '保存 Hooks（模拟）', 'Save hooks (simulation)')}</button></footer>
                </section> : null}

                {detailSection === 'terminal' ? <section className="environment-section environment-terminal-section">
                  <header className="environment-section-header"><div><span>Web Terminal</span><h3>{selected.name}</h3><p>{copy(locale, '使用 pwd、ls、node --version 或 printenv 查看确定性的模拟输出。', 'Use pwd, ls, node --version, or printenv for deterministic simulated output.')}</p></div><StatusLabel status="ready" label={copy(locale, '本地模拟', 'Local simulation')} /></header>
                  <div className="environment-terminal-warning"><Beaker aria-hidden="true" /><span><strong>{copy(locale, '未连接真实 VM', 'No real VM connected')}</strong>{copy(locale, '命令不会访问网络、仓库或本机文件系统。', 'Commands cannot access a network, repository, or local filesystem.')}</span></div>
                  <pre className="environment-terminal-output" aria-live="polite">{selectedConfig.terminalLines.map((line, index) => <code key={`${index}-${line}`}>{line}</code>)}</pre>
                  <form className="environment-terminal-form" onSubmit={(event) => { event.preventDefault(); runTerminalCommand() }}><span>$</span><input value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} aria-label={copy(locale, 'Terminal 命令', 'Terminal command')} placeholder="pwd" autoComplete="off" /><button type="submit" className="cosmos-button cosmos-button--secondary" disabled={!terminalInput.trim()}><Play aria-hidden="true" />{copy(locale, '运行', 'Run')}</button></form>
                  <footer className="environment-section-actions environment-section-actions--split"><button type="button" className="cosmos-button cosmos-button--ghost" onClick={() => updateSelectedConfig((config) => ({ ...config, terminalLines: [] }))}>{copy(locale, '清空输出', 'Clear output')}</button><button type="button" className="cosmos-button cosmos-button--primary" onClick={updateFromTerminal}><RefreshCw aria-hidden="true" />{copy(locale, 'Update Environment（模拟）', 'Update Environment (simulation)')}</button></footer>
                </section> : null}

                {detailSection === 'history' ? <section className="environment-section">
                  <header className="environment-section-header"><div><span>{copy(locale, '不可变记录', 'Immutable record')}</span><h3>{copy(locale, '更新历史', 'Update history')}</h3><p>{copy(locale, '当前列表合并 Control Plane 时间与页面内原型操作。', 'This list combines Control Plane timestamps with in-page prototype actions.')}</p></div></header>
                  <div className="environment-history-list">
                    {selectedConfig.history.map((entry) => <article key={entry.id}><span><History aria-hidden="true" /></span><div><strong>{entry.action}</strong><p>{entry.detail}</p></div><time>{formatTime(entry.at, locale)}</time></article>)}
                    <article><span><RefreshCw aria-hidden="true" /></span><div><strong>{copy(locale, 'Environment 最近更新', 'Environment last updated')}</strong><p>{selected.image} · {selected.provisioning.phase}</p></div><time>{formatTime(selected.updatedAt, locale)}</time></article>
                    <article><span><Plus aria-hidden="true" /></span><div><strong>{copy(locale, 'Environment 创建', 'Environment created')}</strong><p>{selected.slug}</p></div><time>{formatTime(selected.createdAt, locale)}</time></article>
                  </div>
                </section> : null}
              </div>
            </> : <EmptyState icon={Box} title={copy(locale, '选择一个环境', 'Select an environment')} body={copy(locale, '查看资源、网络和配置进度。', 'Inspect resources, network, and provisioning progress.')} />}
          </section>
        </div>
      </div>

      {wizardOpen ? <Modal title={copy(locale, '创建云环境', 'Create cloud environment')} onClose={closeWizard}>
        <div className="cosmos-wizard-steps" aria-label={copy(locale, '创建进度', 'Creation progress')}>
          {[1, 2, 3].map((step) => <span className={wizardStep >= step ? 'cosmos-wizard-step cosmos-wizard-step--active' : 'cosmos-wizard-step'} key={step}><i>{wizardStep > step ? <Check aria-hidden="true" /> : step}</i>{[copy(locale, '基础', 'Basics'), copy(locale, '仓库', 'Repositories'), copy(locale, '确认', 'Review')][step - 1]}</span>)}
        </div>
        <div className="cosmos-modal__body">
          {wizardStep === 1 ? <div className="cosmos-form-grid">
            <label className="cosmos-field cosmos-field--wide"><span>{copy(locale, '环境名称', 'Environment name')}</span><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={copy(locale, '例如：支付服务验证', 'Example: Payment verification')} /></label>
            <label className="cosmos-field cosmos-field--wide"><span>{copy(locale, '基础镜像', 'Base image')}</span><select value={draft.image} onChange={(event) => setDraft({ ...draft, image: event.target.value })}>{environmentImages.map((image) => <option key={image}>{image}</option>)}</select></label>
            <PrototypeNote>{copy(locale, 'Cloud 计算资源由平台按工作负载扩展；CPU/内存不再作为创建首屏必填项。', 'Cloud compute scales with workload; CPU and memory are no longer required on the creation path.')}</PrototypeNote>
          </div> : null}
          {wizardStep === 2 ? <fieldset className="environment-wizard-repositories"><legend>{copy(locale, '选择 Session 可以访问的仓库', 'Choose repositories available to Sessions')}</legend><p>{copy(locale, '可在 Environment 详情中继续调整。每个 Session 会从新的隔离快照启动。', 'You can adjust this later. Each Session starts from a fresh isolated snapshot.')}</p><div>{scope.repositories.map((repository) => <label key={repository.id}><input type="checkbox" checked={draft.repositoryIds.includes(repository.id)} onChange={() => toggleDraftRepository(repository.id)} /><span className="cosmos-resource-row__icon"><FolderGit2 aria-hidden="true" /></span><span><strong>{repository.fullName}</strong><small>{repository.defaultBranch} · {repository.language}</small></span><Check aria-hidden="true" /></label>)}{!scope.repositories.length ? <EmptyState icon={FolderGit2} title={copy(locale, '没有已连接仓库', 'No connected repositories')} body={copy(locale, '仍可创建基础 Environment，之后再连接仓库。', 'You can create the base Environment and attach repositories later.')} /> : null}</div>{scope.repositories.length > 0 && !draft.repositoryIds.length ? <p className="cosmos-field-error">{copy(locale, '至少选择一个仓库。', 'Select at least one repository.')}</p> : null}</fieldset> : null}
          {wizardStep === 3 ? <div className="cosmos-review-list">
            <div><span>{copy(locale, '名称', 'Name')}</span><strong>{draft.name}</strong></div><div><span>{copy(locale, '基础镜像', 'Base image')}</span><code>{draft.image}</code></div><div><span>{copy(locale, '仓库', 'Repositories')}</span><strong>{draft.repositoryIds.length ? scope.repositories.filter((repository) => draft.repositoryIds.includes(repository.id)).map((repository) => repository.fullName).join(', ') : copy(locale, '稍后关联', 'Attach later')}</strong></div><div><span>{copy(locale, '执行模式', 'Execution mode')}</span><strong>Augment Cloud · isolated snapshot</strong></div>
            <PrototypeNote>{copy(locale, '确认后只会创建 provisioning 记录和页面内配置，不会启动真实 VM。Variables、Hooks 与 Terminal 可在详情中继续配置。', 'Confirmation only creates a provisioning record and in-page configuration; it does not start a real VM. Variables, Hooks, and Terminal remain configurable in details.')}</PrototypeNote>
          </div> : null}
        </div>
        <footer className="cosmos-modal__footer">
          <button type="button" className="cosmos-button cosmos-button--ghost" onClick={closeWizard}>{copy(locale, '取消', 'Cancel')}</button>
          <span />
          {wizardStep > 1 ? <button type="button" className="cosmos-button cosmos-button--secondary" onClick={previousWizardStep}><ChevronLeft aria-hidden="true" />{copy(locale, '上一步', 'Back')}</button> : null}
          {wizardStep < 3 ? <button type="button" className="cosmos-button cosmos-button--primary" disabled={!wizardCanContinue} onClick={nextWizardStep}>{copy(locale, '下一步', 'Continue')}<ChevronRight aria-hidden="true" /></button> : <button type="button" className="cosmos-button cosmos-button--primary" onClick={createEnvironment}><Cloud aria-hidden="true" />{copy(locale, '创建并模拟配置', 'Create and simulate provisioning')}</button>}
        </footer>
      </Modal> : null}
    </main>
  )
}

export function DaemonsPage({ onOpenNavigation }: CosmosConfigurationPageProps) {
  const { locale } = usePreferences()
  const { activeSpace, scope, actions } = useControlPlane()
  const [view, setView] = useState<'machines' | 'pools'>('machines')
  const [slots, setSlots] = useState<Record<string, number>>({})
  const concurrencyFor = (daemonId: string) => slots[daemonId] ?? 4
  const changeConcurrency = (daemonId: string, delta: number) => setSlots((current) => ({ ...current, [daemonId]: Math.min(16, Math.max(1, (current[daemonId] ?? 4) + delta)) }))
  const pools = scope.environments.map((environment) => ({ environment, daemons: scope.daemons.filter((daemon) => daemon.environmentId === environment.id) }))

  const daemonRow = (daemon: ControlPlaneScope['daemons'][number]) => (
    <article className="cosmos-daemon-row" key={daemon.id}>
      <span className="cosmos-resource-row__icon"><Server aria-hidden="true" /></span>
      <div className="cosmos-daemon-row__identity"><strong>{daemon.name}</strong><small>{daemon.description}</small><code>{daemon.capabilities.join(' · ')}</code></div>
      <div className="cosmos-daemon-row__heartbeat"><span>{copy(locale, '心跳', 'Heartbeat')}</span><strong>{formatTime(daemon.lastHeartbeatAt, locale)}</strong></div>
      <div className="cosmos-slot-stepper" aria-label={copy(locale, '并发槽位', 'Concurrency slots')}>
        <span>{copy(locale, '并发槽位', 'Slots')}</span>
        <div><IconButton icon={Minus} size="sm" label={copy(locale, '减少槽位', 'Decrease slots')} onClick={() => changeConcurrency(daemon.id, -1)} /><strong>{concurrencyFor(daemon.id)}</strong><IconButton icon={Plus} size="sm" label={copy(locale, '增加槽位', 'Increase slots')} onClick={() => changeConcurrency(daemon.id, 1)} /></div>
      </div>
      <label className="cosmos-switch"><input type="checkbox" checked={daemon.enabled} onChange={() => actions.toggleDaemon(daemon.id)} /><span aria-hidden="true" /><em>{daemon.enabled ? copy(locale, '在线', 'Online') : copy(locale, '离线', 'Offline')}</em></label>
    </article>
  )

  return (
    <main className="cosmos-page">
      <PageHeader icon={Server} title={copy(locale, 'Daemon Pools', 'Daemon pools')} description={copy(locale, `管理 ${activeSpace.name} 的自托管执行机器与容量`, `Manage self-hosted execution machines and capacity for ${activeSpace.name}`)} onOpenNavigation={onOpenNavigation} />
      <div className="cosmos-page__scroll">
        <PrototypeNote>{copy(locale, '在线开关和并发槽位只改变原型控制面，不会连接、关闭或扩缩真实机器。', 'Online toggles and slots only change the prototype control plane; no real machines are connected, stopped, or scaled.')}</PrototypeNote>
        <div className="cosmos-toolbar">
          <div className="cosmos-segmented" role="group" aria-label={copy(locale, '视图', 'View')}>
            <button type="button" className={view === 'machines' ? 'cosmos-segmented__button cosmos-segmented__button--active' : 'cosmos-segmented__button'} onClick={() => setView('machines')}><Server aria-hidden="true" />{copy(locale, '机器', 'Machines')}</button>
            <button type="button" className={view === 'pools' ? 'cosmos-segmented__button cosmos-segmented__button--active' : 'cosmos-segmented__button'} onClick={() => setView('pools')}><Boxes aria-hidden="true" />Pools</button>
          </div>
          <span className="cosmos-toolbar__summary">{scope.daemons.filter((daemon) => daemon.enabled).length}/{scope.daemons.length} {copy(locale, '台在线', 'online')}</span>
        </div>
        {view === 'machines' ? <section className="cosmos-panel cosmos-list-panel">
          <header className="cosmos-section-heading"><div><span>{copy(locale, '执行容量', 'Execution capacity')}</span><h2>{copy(locale, '已注册机器', 'Registered machines')}</h2></div></header>
          <div className="cosmos-daemon-list">{scope.daemons.length ? scope.daemons.map(daemonRow) : <EmptyState icon={Server} title={copy(locale, '没有机器', 'No machines')} body={copy(locale, '当前 Space 尚未注册 Daemon。', 'No daemons are registered in this Space.')} />}</div>
        </section> : <div className="cosmos-pool-grid">{pools.map(({ environment, daemons }) => <section className="cosmos-panel cosmos-pool" key={environment.id}><header><span className="cosmos-resource-row__icon"><Boxes aria-hidden="true" /></span><div><h2>{environment.name}</h2><p>{environment.image}</p></div><StatusLabel status={daemons.some((daemon) => daemon.enabled) ? 'online' : 'offline'} label={daemons.some((daemon) => daemon.enabled) ? copy(locale, '可调度', 'Schedulable') : copy(locale, '无容量', 'No capacity')} /></header><div className="cosmos-pool__metrics"><div><span>{copy(locale, '机器', 'Machines')}</span><strong>{daemons.length}</strong></div><div><span>{copy(locale, '在线', 'Online')}</span><strong>{daemons.filter((daemon) => daemon.enabled).length}</strong></div><div><span>{copy(locale, '总槽位', 'Total slots')}</span><strong>{daemons.reduce((sum, daemon) => sum + concurrencyFor(daemon.id), 0)}</strong></div></div><div className="cosmos-pool__machines">{daemons.length ? daemons.map((daemon) => <div key={daemon.id}><Server aria-hidden="true" /><span><strong>{daemon.name}</strong><small>{concurrencyFor(daemon.id)} {copy(locale, '槽位', 'slots')}</small></span><StatusLabel status={daemon.status} /></div>) : <p>{copy(locale, '此 Pool 没有已注册机器。', 'No machines are registered in this pool.')}</p>}</div></section>)}</div>}
      </div>
    </main>
  )
}

export function RepositoriesControlPage({ onOpenNavigation }: CosmosConfigurationPageProps) {
  const { locale } = usePreferences()
  const { activeSpace, scope } = useControlPlane()
  const [query, setQuery] = useState('')
  const [syncingId, setSyncingId] = useState<string>()
  const [connectOpen, setConnectOpen] = useState(false)
  const filtered = scope.repositories.filter((repository) => repository.fullName.toLowerCase().includes(query.trim().toLowerCase()))

  const syncRepository = (repositoryId: string) => {
    setSyncingId(repositoryId)
    window.setTimeout(() => setSyncingId((current) => current === repositoryId ? undefined : current), 900)
  }

  return (
    <main className="cosmos-page">
      <PageHeader icon={FolderGit2} title={copy(locale, '仓库', 'Repositories')} description={copy(locale, `管理 ${activeSpace.name} 的代码连接与索引覆盖`, `Manage code connections and index coverage for ${activeSpace.name}`)} onOpenNavigation={onOpenNavigation} action={<button type="button" className="cosmos-button cosmos-button--primary" onClick={() => setConnectOpen(true)}><GitBranch aria-hidden="true" />{copy(locale, '连接仓库', 'Connect repository')}</button>} />
      <div className="cosmos-page__scroll">
        <PrototypeNote>{copy(locale, '连接授权和重新索引均为原型模拟，不会发起真实 Git Provider OAuth 或读取仓库。', 'Connection and reindexing are prototype simulations; no Git provider OAuth or repository access occurs.')}</PrototypeNote>
        <section className="cosmos-panel cosmos-list-panel">
          <header className="cosmos-section-heading cosmos-section-heading--toolbar"><div><span>{copy(locale, '代码上下文', 'Code context')}</span><h2>{copy(locale, '已连接仓库', 'Connected repositories')}</h2></div><label className="cosmos-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={copy(locale, '搜索仓库', 'Search repositories')} placeholder={copy(locale, '搜索仓库', 'Search repositories')} /></label></header>
          <div className="cosmos-table" role="table" aria-label={copy(locale, '仓库', 'Repositories')}>
            <div className="cosmos-table__row cosmos-table__head" role="row"><span>{copy(locale, '仓库', 'Repository')}</span><span>{copy(locale, '索引', 'Index')}</span><span>{copy(locale, '覆盖率', 'Coverage')}</span><span>{copy(locale, '策略', 'Policy')}</span><span>{copy(locale, '最近同步', 'Last sync')}</span><span /></div>
            {filtered.map((repository) => {
              const syncing = syncingId === repository.id
              return <div className="cosmos-table__row cosmos-repository-row" role="row" key={repository.id}><span className="cosmos-table__primary"><span className="cosmos-resource-row__icon"><FolderGit2 aria-hidden="true" /></span><span><strong>{repository.fullName}</strong><small>{repository.provider} · {repository.language} · {repository.defaultBranch}</small></span></span><span><StatusLabel status={syncing ? 'indexing' : repository.indexStatus} label={syncing ? copy(locale, '索引中', 'Indexing') : repository.indexStatus} /></span><span className="cosmos-coverage"><i><b style={{ width: `${syncing ? 72 : repository.indexCoverage}%` }} /></i><strong>{syncing ? 72 : repository.indexCoverage}%</strong></span><span><StatusLabel status={repository.policy} label={repository.policy} /></span><span>{formatTime(repository.lastSyncedAt, locale)}</span><span><IconButton icon={RefreshCw} label={copy(locale, `重新索引 ${repository.fullName}（原型模拟）`, `Reindex ${repository.fullName} (prototype simulation)`)} onClick={() => syncRepository(repository.id)} /></span></div>
            })}
          </div>
          {!filtered.length ? <EmptyState icon={Search} title={copy(locale, '没有匹配仓库', 'No matching repositories')} body={copy(locale, '尝试更换搜索关键词。', 'Try a different search term.')} /> : null}
        </section>
      </div>
      {connectOpen ? <Modal title={copy(locale, '连接 Git Provider', 'Connect Git provider')} onClose={() => setConnectOpen(false)}><div className="cosmos-modal__body"><PrototypeNote>{copy(locale, '此操作只演示 OAuth 入口，当前不会打开或授权外部账号。', 'This demonstrates the OAuth entry only; no external account is opened or authorized.')}</PrototypeNote><div className="cosmos-provider-list"><button type="button" className="cosmos-provider-button" onClick={() => setConnectOpen(false)}><GitBranch aria-hidden="true" /><span><strong>GitHub</strong><small>{copy(locale, '原型模拟连接', 'Prototype connection')}</small></span><ChevronRight aria-hidden="true" /></button><button type="button" className="cosmos-provider-button" onClick={() => setConnectOpen(false)}><GitBranch aria-hidden="true" /><span><strong>GitLab</strong><small>{copy(locale, '原型模拟连接', 'Prototype connection')}</small></span><ChevronRight aria-hidden="true" /></button><button type="button" className="cosmos-provider-button" onClick={() => setConnectOpen(false)}><GitBranch aria-hidden="true" /><span><strong>Gitee</strong><small>{copy(locale, '原型模拟连接', 'Prototype connection')}</small></span><ChevronRight aria-hidden="true" /></button></div></div><footer className="cosmos-modal__footer"><button type="button" className="cosmos-button cosmos-button--ghost" onClick={() => setConnectOpen(false)}>{copy(locale, '取消', 'Cancel')}</button></footer></Modal> : null}
    </main>
  )
}

const integrationIcons: Record<Integration['type'], LucideIcon> = {
  github: GitBranch,
  slack: PlugZap,
  jira: CheckCircle2,
  pagerduty: AlertTriangle,
  linear: Activity,
  custom: Wrench,
}

export function IntegrationsControlPage({ onOpenNavigation }: CosmosConfigurationPageProps) {
  const { locale } = usePreferences()
  const { activeSpace, scope, actions } = useControlPlane()
  const [workingId, setWorkingId] = useState<string>()

  const connect = (integration: Integration) => {
    setWorkingId(integration.id)
    actions.connectIntegration(integration.id, { externalAccount: integration.externalAccount || 'prototype-account' })
    window.setTimeout(() => setWorkingId((current) => current === integration.id ? undefined : current), 700)
  }

  return (
    <main className="cosmos-page">
      <PageHeader icon={PlugZap} title={copy(locale, '集成', 'Integrations')} description={copy(locale, `连接 ${activeSpace.name} 的开发与协作系统`, `Connect development and collaboration systems for ${activeSpace.name}`)} onOpenNavigation={onOpenNavigation} />
      <div className="cosmos-page__scroll">
        <PrototypeNote>{copy(locale, '连接、诊断和修复操作不会访问外部账号；结果由本地控制面模拟。', 'Connect, diagnose, and repair actions do not access external accounts; results are simulated locally.')}</PrototypeNote>
        <div className="cosmos-integration-grid">
          {scope.integrations.map((integration) => {
            const IntegrationIcon = integrationIcons[integration.type]
            const working = workingId === integration.id
            const needsRepair = integration.status === 'action_required' || integration.health === 'degraded'
            return <article className="cosmos-panel cosmos-integration-card" key={integration.id}><header><span className="cosmos-integration-card__icon"><IntegrationIcon aria-hidden="true" /></span><StatusLabel status={integration.status} label={integration.status === 'action_required' ? copy(locale, '需要处理', 'Action required') : integration.status} /></header><h2>{integration.name}</h2><p>{integration.externalAccount || copy(locale, '尚未绑定账号', 'No account connected')}</p><dl><div><dt>{copy(locale, '健康状态', 'Health')}</dt><dd><StatusLabel status={integration.health} label={integration.health} /></dd></div><div><dt>Scopes</dt><dd>{integration.scopes.join(', ') || '—'}</dd></div><div><dt>{copy(locale, '最近事件', 'Last event')}</dt><dd>{formatTime(integration.lastEventAt, locale)}</dd></div></dl>{integration.diagnostic ? <div className="cosmos-diagnostic"><AlertTriangle aria-hidden="true" /><span><strong>{copy(locale, '诊断', 'Diagnostic')}</strong>{integration.diagnostic}</span></div> : null}<footer><button type="button" className={needsRepair ? 'cosmos-button cosmos-button--primary' : 'cosmos-button cosmos-button--secondary'} onClick={() => connect(integration)}>{working ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : needsRepair ? <Wrench aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}{working ? copy(locale, '模拟处理中…', 'Simulating…') : needsRepair ? copy(locale, '修复连接（原型模拟）', 'Repair (prototype simulation)') : copy(locale, '检查连接（原型模拟）', 'Check (prototype simulation)')}</button></footer></article>
          })}
        </div>
      </div>
    </main>
  )
}

type McpDraft = { name: string; transport: McpServer['transport']; endpoint: string; command: string; secretId: string }
const initialMcpDraft: McpDraft = { name: '', transport: 'http', endpoint: '', command: '', secretId: '' }

export function McpRegistryPage({ onOpenNavigation }: CosmosConfigurationPageProps) {
  const { locale } = usePreferences()
  const { activeSpace, scope, actions } = useControlPlane()
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<McpDraft>(initialMcpDraft)

  const openForm = () => { setDraft(initialMcpDraft); setFormOpen(true) }
  const createServer = () => {
    if (!draft.name.trim() || (draft.transport === 'stdio' ? !draft.command.trim() : !draft.endpoint.trim())) return
    actions.createMcp({ name: draft.name.trim(), transport: draft.transport, command: draft.transport === 'stdio' ? draft.command.trim() : undefined, endpoint: draft.transport === 'stdio' ? undefined : draft.endpoint.trim(), secretIds: draft.secretId ? [draft.secretId] : [], enabled: true })
    setFormOpen(false)
  }

  return (
    <main className="cosmos-page">
      <PageHeader icon={Database} title="MCP Registry" description={copy(locale, `管理 ${activeSpace.name} 可供专家调用的 MCP servers`, `Manage MCP servers available to Experts in ${activeSpace.name}`)} onOpenNavigation={onOpenNavigation} action={<button type="button" className="cosmos-button cosmos-button--primary" onClick={openForm}><Plus aria-hidden="true" />{copy(locale, '新增 Server', 'Add server')}</button>} />
      <div className="cosmos-page__scroll">
        <PrototypeNote>{copy(locale, '新增 Server 会写入原型注册表，但不会建立真实 MCP 连接或发现工具。', 'Adding a server writes to the prototype registry but does not establish a real MCP connection or discover tools.')}</PrototypeNote>
        <section className="cosmos-panel cosmos-list-panel"><header className="cosmos-section-heading"><div><span>Registry</span><h2>{scope.mcpServers.length} MCP servers</h2></div></header><div className="cosmos-mcp-list">{scope.mcpServers.map((server) => <article className="cosmos-mcp-row" key={server.id}><span className="cosmos-resource-row__icon"><Database aria-hidden="true" /></span><div><strong>{server.name}</strong><code>{server.transport === 'stdio' ? server.command : server.endpoint}</code></div><span><small>Transport</small><strong>{server.transport}</strong></span><span><small>Tools</small><strong>{server.toolCount}</strong></span><span><small>Secrets</small><strong>{server.secretIds.length}</strong></span><StatusLabel status={server.status} /></article>)}{!scope.mcpServers.length ? <EmptyState icon={Database} title={copy(locale, '注册表为空', 'Registry is empty')} body={copy(locale, '新增一个 MCP server 作为专家工具入口。', 'Add an MCP server as an Expert tool source.')} /> : null}</div></section>
      </div>
      {formOpen ? <Modal title={copy(locale, '新增 MCP Server', 'Add MCP server')} onClose={() => setFormOpen(false)}><div className="cosmos-modal__body"><div className="cosmos-form-grid"><label className="cosmos-field cosmos-field--wide"><span>{copy(locale, '名称', 'Name')}</span><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Internal Docs MCP" /></label><label className="cosmos-field"><span>Transport</span><select value={draft.transport} onChange={(event) => setDraft({ ...draft, transport: event.target.value as McpServer['transport'] })}><option value="http">HTTP</option><option value="sse">SSE</option><option value="stdio">stdio</option></select></label><label className="cosmos-field"><span>{copy(locale, '凭证引用', 'Secret reference')}</span><select value={draft.secretId} onChange={(event) => setDraft({ ...draft, secretId: event.target.value })}><option value="">{copy(locale, '无需凭证', 'No secret')}</option>{scope.secrets.map((secret) => <option value={secret.id} key={secret.id}>{secret.name}</option>)}</select></label>{draft.transport === 'stdio' ? <label className="cosmos-field cosmos-field--wide"><span>Command</span><input value={draft.command} onChange={(event) => setDraft({ ...draft, command: event.target.value })} placeholder="npx @company/mcp-server" /></label> : <label className="cosmos-field cosmos-field--wide"><span>Endpoint</span><input value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} placeholder="https://mcp.example.com/api" /></label>}</div><PrototypeNote>{copy(locale, '保存后状态和工具数量为原型模拟。', 'Status and tool count are simulated after save.')}</PrototypeNote></div><footer className="cosmos-modal__footer"><button type="button" className="cosmos-button cosmos-button--ghost" onClick={() => setFormOpen(false)}>{copy(locale, '取消', 'Cancel')}</button><span /><button type="button" className="cosmos-button cosmos-button--primary" onClick={createServer}><Database aria-hidden="true" />{copy(locale, '新增 Server', 'Add server')}</button></footer></Modal> : null}
    </main>
  )
}

type WebhookDraft = { name: string; url: string; events: string; secretId: string }
const initialWebhookDraft: WebhookDraft = { name: '', url: '', events: 'session.completed', secretId: '' }

function createPrototypeWebhookToken() {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? `${Date.now()}prototype`
  return `whsec_${random.slice(0, 24)}`
}

export function WebhooksPage({ onOpenNavigation }: CosmosConfigurationPageProps) {
  const { locale } = usePreferences()
  const { activeSpace, scope, actions } = useControlPlane()
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<WebhookDraft>(initialWebhookDraft)
  const [oneTimeToken, setOneTimeToken] = useState<string>()
  const [copied, setCopied] = useState(false)

  const openForm = () => { setDraft(initialWebhookDraft); setFormOpen(true) }
  const createWebhook = () => {
    if (!draft.name.trim() || !draft.url.trim()) return
    actions.createWebhook({ name: draft.name.trim(), url: draft.url.trim(), events: draft.events.split(',').map((event) => event.trim()).filter(Boolean), secretId: draft.secretId || undefined, enabled: true })
    setOneTimeToken(createPrototypeWebhookToken())
    setCopied(false)
    setFormOpen(false)
  }
  const copyToken = async () => {
    if (!oneTimeToken) return
    await navigator.clipboard?.writeText(oneTimeToken)
    setCopied(true)
  }

  return (
    <main className="cosmos-page">
      <PageHeader icon={Webhook} title="Webhooks" description={copy(locale, `管理 ${activeSpace.name} 的出站事件订阅`, `Manage outbound event subscriptions for ${activeSpace.name}`)} onOpenNavigation={onOpenNavigation} action={<button type="button" className="cosmos-button cosmos-button--primary" onClick={openForm}><Plus aria-hidden="true" />{copy(locale, '创建 Webhook', 'Create webhook')}</button>} />
      <div className="cosmos-page__scroll">
        <PrototypeNote>{copy(locale, '创建与投递行为均为原型模拟；不会向目标 URL 发送网络请求。', 'Creation and delivery are prototype simulations; no network request is sent to the target URL.')}</PrototypeNote>
        {oneTimeToken ? <section className="cosmos-one-time-secret" role="status"><KeyRound aria-hidden="true" /><div><strong>{copy(locale, '签名 Token 仅显示一次', 'Signing token shown once')}</strong><p>{copy(locale, '关闭后无法再次查看。当前 Token 由原型本地生成，不用于真实请求签名。', 'It cannot be viewed again after dismissal. This token is generated locally by the prototype and is not used to sign real requests.')}</p><code>{oneTimeToken}</code></div><div><IconButton icon={Copy} label={copied ? copy(locale, '已复制', 'Copied') : copy(locale, '复制 Token', 'Copy token')} onClick={copyToken} /><IconButton icon={EyeOff} label={copy(locale, '隐藏且不再显示', 'Hide permanently')} onClick={() => setOneTimeToken(undefined)} /></div></section> : null}
        <section className="cosmos-panel cosmos-list-panel"><header className="cosmos-section-heading"><div><span>{copy(locale, '事件出口', 'Event delivery')}</span><h2>{scope.webhooks.length} Webhooks</h2></div></header><div className="cosmos-webhook-list">{scope.webhooks.map((hook) => <article className="cosmos-webhook-row" key={hook.id}><span className="cosmos-resource-row__icon"><Webhook aria-hidden="true" /></span><div><strong>{hook.name}</strong><code>{hook.url}</code><small>{hook.events.join(' · ')}</small></div><span><small>{copy(locale, '最近投递', 'Last delivery')}</small><strong>{formatTime(hook.lastDeliveryAt, locale)}</strong></span><StatusLabel status={hook.status} /></article>)}{!scope.webhooks.length ? <EmptyState icon={Webhook} title={copy(locale, '还没有 Webhook', 'No webhooks yet')} body={copy(locale, '创建一个出站事件订阅。', 'Create an outbound event subscription.')} /> : null}</div></section>
      </div>
      {formOpen ? <Modal title={copy(locale, '创建 Webhook', 'Create webhook')} onClose={() => setFormOpen(false)}><div className="cosmos-modal__body"><div className="cosmos-form-grid"><label className="cosmos-field cosmos-field--wide"><span>{copy(locale, '名称', 'Name')}</span><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Session delivery" /></label><label className="cosmos-field cosmos-field--wide"><span>{copy(locale, '目标 URL', 'Target URL')}</span><input type="url" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://example.com/hooks/cosmos" /></label><label className="cosmos-field cosmos-field--wide"><span>{copy(locale, '事件（逗号分隔）', 'Events (comma separated)')}</span><input value={draft.events} onChange={(event) => setDraft({ ...draft, events: event.target.value })} /></label><label className="cosmos-field cosmos-field--wide"><span>{copy(locale, '凭证引用（可选）', 'Secret reference (optional)')}</span><select value={draft.secretId} onChange={(event) => setDraft({ ...draft, secretId: event.target.value })}><option value="">{copy(locale, '自动生成一次性签名 Token', 'Generate a one-time signing token')}</option>{scope.secrets.map((secret) => <option value={secret.id} key={secret.id}>{secret.name}</option>)}</select></label></div></div><footer className="cosmos-modal__footer"><button type="button" className="cosmos-button cosmos-button--ghost" onClick={() => setFormOpen(false)}>{copy(locale, '取消', 'Cancel')}</button><span /><button type="button" className="cosmos-button cosmos-button--primary" onClick={createWebhook}><Webhook aria-hidden="true" />{copy(locale, '创建（原型模拟）', 'Create (prototype simulation)')}</button></footer></Modal> : null}
    </main>
  )
}

type SecretDraft = { name: string; provider: Secret['provider']; value: string; description: string }
const initialSecretDraft: SecretDraft = { name: '', provider: 'local_reference', value: '', description: '' }

function secretSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'secret'
}

export function SecretsPage({ onOpenNavigation }: CosmosConfigurationPageProps) {
  const { locale } = usePreferences()
  const { activeSpace, scope, actions } = useControlPlane()
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<SecretDraft>(initialSecretDraft)
  const [confirmation, setConfirmation] = useState<string>()

  const openForm = () => { setDraft(initialSecretDraft); setFormOpen(true) }
  const createSecret = () => {
    if (!draft.name.trim() || !draft.value.trim()) return
    const isLocalValue = draft.provider === 'local_reference'
    const input: CreateSecretInput = {
      name: draft.name.trim(),
      provider: draft.provider,
      reference: isLocalValue ? `local-reference://${secretSlug(draft.name)}-${Date.now()}` : draft.value.trim(),
      description: draft.description.trim(),
      lastFour: isLocalValue ? draft.value.trim().slice(-4) : undefined,
    }
    actions.createSecret(input)
    setConfirmation(draft.name.trim())
    setDraft(initialSecretDraft)
    setFormOpen(false)
  }

  return (
    <main className="cosmos-page">
      <PageHeader icon={KeyRound} title={copy(locale, '密钥', 'Secrets')} description={copy(locale, `管理 ${activeSpace.name} 的只写凭证引用`, `Manage write-only credential references for ${activeSpace.name}`)} onOpenNavigation={onOpenNavigation} action={<button type="button" className="cosmos-button cosmos-button--primary" onClick={openForm}><Plus aria-hidden="true" />{copy(locale, '创建密钥', 'Create secret')}</button>} />
      <div className="cosmos-page__scroll">
        <div className="cosmos-security-note"><ShieldCheck aria-hidden="true" /><span><strong>{copy(locale, '密钥值不可回读', 'Secret values cannot be read back')}</strong>{copy(locale, '创建时输入的值不会写入持久化控制面或资源列表；之后只能替换或删除引用。', 'The value entered at creation is not written to the persistent control plane or resource list; it can only be replaced or its reference removed later.')}</span></div>
        {confirmation ? <div className="cosmos-inline-success" role="status"><CheckCircle2 aria-hidden="true" /><span><strong>{confirmation}</strong>{copy(locale, ' 已创建，原始值已从表单清除且无法回读。', ' was created. The original value was cleared and cannot be read back.')}</span><IconButton icon={X} label={copy(locale, '关闭提示', 'Dismiss')} onClick={() => setConfirmation(undefined)} /></div> : null}
        <section className="cosmos-panel cosmos-list-panel"><header className="cosmos-section-heading"><div><span>{copy(locale, '凭证目录', 'Credential directory')}</span><h2>{scope.secrets.length} {copy(locale, '个密钥引用', 'secret references')}</h2></div></header><div className="cosmos-secret-list">{scope.secrets.map((secret) => <article className="cosmos-secret-row" key={secret.id}><span className="cosmos-resource-row__icon"><KeyRound aria-hidden="true" /></span><div><strong>{secret.name}</strong><p>{secret.description || copy(locale, '无说明', 'No description')}</p></div><span><small>{copy(locale, 'Provider', 'Provider')}</small><strong>{secret.provider}</strong></span><span><small>{copy(locale, '引用', 'Reference')}</small><code>{secret.reference}</code></span><span><small>{copy(locale, '密钥值', 'Secret value')}</small><strong>•••• {secret.lastFour ?? '••••'}</strong></span><span><small>{copy(locale, '最近使用', 'Last used')}</small><strong>{formatTime(secret.lastUsedAt, locale)}</strong></span></article>)}{!scope.secrets.length ? <EmptyState icon={KeyRound} title={copy(locale, '还没有密钥', 'No secrets yet')} body={copy(locale, '创建第一个只写凭证引用。', 'Create the first write-only credential reference.')} /> : null}</div></section>
      </div>
      {formOpen ? <Modal title={copy(locale, '创建密钥', 'Create secret')} onClose={() => { setDraft(initialSecretDraft); setFormOpen(false) }}><div className="cosmos-modal__body"><div className="cosmos-form-grid"><label className="cosmos-field cosmos-field--wide"><span>{copy(locale, '名称', 'Name')}</span><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Production API token" /></label><label className="cosmos-field"><span>Provider</span><select value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value as Secret['provider'], value: '' })}><option value="local_reference">Local write-only</option><option value="vault">Vault</option><option value="aws_secrets_manager">AWS Secrets Manager</option><option value="onepassword">1Password</option></select></label><label className="cosmos-field"><span>{draft.provider === 'local_reference' ? copy(locale, '密钥值', 'Secret value') : copy(locale, '外部引用', 'External reference')}</span><input type={draft.provider === 'local_reference' ? 'password' : 'text'} autoComplete="new-password" value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} placeholder={draft.provider === 'local_reference' ? '••••••••••••' : 'vault://team/path'} /></label><label className="cosmos-field cosmos-field--wide"><span>{copy(locale, '说明', 'Description')}</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label></div><div className="cosmos-security-note cosmos-security-note--compact"><EyeOff aria-hidden="true" /><span><strong>{copy(locale, '保存后不可查看', 'Not viewable after save')}</strong>{copy(locale, '提交后输入值立即从本地表单状态清除。', 'The entered value is immediately cleared from local form state after submission.')}</span></div></div><footer className="cosmos-modal__footer"><button type="button" className="cosmos-button cosmos-button--ghost" onClick={() => { setDraft(initialSecretDraft); setFormOpen(false) }}>{copy(locale, '取消', 'Cancel')}</button><span /><button type="button" className="cosmos-button cosmos-button--primary" onClick={createSecret}><KeyRound aria-hidden="true" />{copy(locale, '创建且不回显', 'Create without readback')}</button></footer></Modal> : null}
    </main>
  )
}

export function SpacesPage({ onOpenNavigation }: CosmosConfigurationPageProps) {
  const { locale } = usePreferences()
  const { state, activeSpace, actions } = useControlPlane()
  const countsFor = (spaceId: string) => ({ environments: state.environments.filter((item) => item.spaceId === spaceId).length, repositories: state.repositories.filter((item) => item.spaceId === spaceId).length, experts: state.automations.filter((item) => item.spaceId === spaceId).length, daemons: state.daemons.filter((item) => item.spaceId === spaceId).length })
  return (
    <main className="cosmos-page">
      <PageHeader icon={Building2} title="Spaces" description={copy(locale, '在组织内隔离资源、权限与执行上下文', 'Isolate resources, permissions, and execution context within the organization')} onOpenNavigation={onOpenNavigation} />
      <div className="cosmos-page__scroll">
        <section className="cosmos-current-space"><span className="cosmos-current-space__icon"><Building2 aria-hidden="true" /></span><div><span>{copy(locale, '当前 Space', 'Current Space')}</span><h2>{activeSpace.name}</h2><p>{activeSpace.description}</p></div><StatusLabel status="active" label={copy(locale, '当前', 'Current')} /></section>
        <div className="cosmos-space-grid">{state.spaces.map((space) => { const counts = countsFor(space.id); const current = space.id === activeSpace.id; return <article className={current ? 'cosmos-panel cosmos-space-card cosmos-space-card--current' : 'cosmos-panel cosmos-space-card'} key={space.id}><header><span className="cosmos-resource-row__icon"><Building2 aria-hidden="true" /></span><div><h2>{space.name}</h2><code>{space.slug}</code></div>{current ? <CheckCircle2 aria-hidden="true" /> : null}</header><p>{space.description}</p><div className="cosmos-space-card__metrics"><div><Cloud aria-hidden="true" /><span><strong>{counts.environments}</strong>{copy(locale, '环境', 'Environments')}</span></div><div><FolderGit2 aria-hidden="true" /><span><strong>{counts.repositories}</strong>{copy(locale, '仓库', 'Repositories')}</span></div><div><Server aria-hidden="true" /><span><strong>{counts.daemons}</strong>Daemons</span></div><div><Activity aria-hidden="true" /><span><strong>{counts.experts}</strong>{copy(locale, '自动化', 'Automations')}</span></div></div><footer>{current ? <span className="cosmos-current-label"><Check aria-hidden="true" />{copy(locale, '正在使用', 'In use')}</span> : <button type="button" className="cosmos-button cosmos-button--secondary" onClick={() => actions.switchSpace(space.id)}>{copy(locale, '切换到此 Space', 'Switch to Space')}<ChevronRight aria-hidden="true" /></button>}</footer></article> })}</div>
      </div>
    </main>
  )
}

type SettingsSection = 'personal' | 'organization' | 'appearance'

export function SettingsPage({ onOpenNavigation }: CosmosConfigurationPageProps) {
  const { locale, theme, setLocale, setTheme } = usePreferences()
  const [section, setSection] = useState<SettingsSection>('personal')
  const [notice, setNotice] = useState<string>()
  const sections: Array<{ id: SettingsSection; icon: LucideIcon; zh: string; en: string }> = [
    { id: 'personal', icon: UserRound, zh: '个人设置', en: 'Personal' },
    { id: 'organization', icon: Users, zh: '组织设置', en: 'Organization' },
    { id: 'appearance', icon: Paintbrush, zh: '外观与语言', en: 'Appearance & language' },
  ]

  return (
    <main className="cosmos-page">
      <PageHeader icon={Settings2} title={copy(locale, '设置', 'Settings')} description={copy(locale, '管理个人偏好、组织入口和界面外观', 'Manage personal preferences, organization entry points, and appearance')} onOpenNavigation={onOpenNavigation} />
      <div className="cosmos-page__scroll">
        <div className="cosmos-settings-layout">
          <nav className="cosmos-settings-nav" aria-label={copy(locale, '设置分类', 'Settings categories')}>{sections.map((item) => { const Icon = item.icon; return <button type="button" className={section === item.id ? 'cosmos-settings-nav__item cosmos-settings-nav__item--active' : 'cosmos-settings-nav__item'} onClick={() => { setSection(item.id); setNotice(undefined) }} key={item.id}><Icon aria-hidden="true" />{copy(locale, item.zh, item.en)}<ChevronRight aria-hidden="true" /></button> })}</nav>
          <section className="cosmos-panel cosmos-settings-panel">
            {notice ? <div className="cosmos-inline-success" role="status"><CheckCircle2 aria-hidden="true" /><span>{notice}</span><IconButton icon={X} label={copy(locale, '关闭提示', 'Dismiss')} onClick={() => setNotice(undefined)} /></div> : null}
            {section === 'personal' ? <><header className="cosmos-section-heading"><div><span>{copy(locale, '账号', 'Account')}</span><h2>{copy(locale, '个人设置', 'Personal settings')}</h2></div></header><div className="cosmos-profile-row"><span className="cosmos-avatar">LC</span><div><strong>{copy(locale, '林澈', 'Lin Che')}</strong><p>lin.che@example.com</p></div><button type="button" className="cosmos-button cosmos-button--secondary" onClick={() => setNotice(copy(locale, '个人资料编辑为原型模拟，未提交到身份系统。', 'Profile editing is a prototype simulation and was not submitted to an identity system.'))}><UserRound aria-hidden="true" />{copy(locale, '编辑资料（原型模拟）', 'Edit profile (prototype simulation)')}</button></div><div className="cosmos-settings-entry"><div><ShieldCheck aria-hidden="true" /><span><strong>{copy(locale, '账号安全', 'Account security')}</strong><p>{copy(locale, '登录方式、多因素认证与活跃会话入口。', 'Sign-in methods, multi-factor authentication, and active sessions.')}</p></span></div><button type="button" className="cosmos-button cosmos-button--ghost" onClick={() => setNotice(copy(locale, '安全中心为原型入口，未打开外部身份系统。', 'Security center is a prototype entry and did not open an external identity system.'))}>{copy(locale, '打开（原型模拟）', 'Open (prototype simulation)')}<ChevronRight aria-hidden="true" /></button></div></> : null}
            {section === 'organization' ? <><header className="cosmos-section-heading"><div><span>{copy(locale, '组织', 'Organization')}</span><h2>Acme Engineering</h2></div></header><div className="cosmos-detail-list"><div><span>{copy(locale, '当前角色', 'Current role')}</span><strong>Organization admin</strong></div><div><span>{copy(locale, '默认区域', 'Default region')}</span><strong>cn-east-1</strong></div><div><span>{copy(locale, '成员', 'Members')}</span><strong>42</strong></div></div><div className="cosmos-settings-entry"><div><Users aria-hidden="true" /><span><strong>{copy(locale, '成员与权限', 'Members and permissions')}</strong><p>{copy(locale, '邀请成员、分配角色并配置 Space 访问。', 'Invite members, assign roles, and configure Space access.')}</p></span></div><button type="button" className="cosmos-button cosmos-button--secondary" onClick={() => setNotice(copy(locale, '成员管理为原型模拟，未发送邀请或修改权限。', 'Member management is a prototype simulation; no invitations or permissions were changed.'))}>{copy(locale, '管理（原型模拟）', 'Manage (prototype simulation)')}<ChevronRight aria-hidden="true" /></button></div><div className="cosmos-settings-entry"><div><Globe2 aria-hidden="true" /><span><strong>{copy(locale, '组织域名', 'Organization domains')}</strong><p>example.com</p></span></div><button type="button" className="cosmos-button cosmos-button--ghost" onClick={() => setNotice(copy(locale, '域名验证为原型模拟。', 'Domain verification is a prototype simulation.'))}>{copy(locale, '验证（原型模拟）', 'Verify (prototype simulation)')}</button></div></> : null}
            {section === 'appearance' ? <><header className="cosmos-section-heading"><div><span>{copy(locale, '界面', 'Interface')}</span><h2>{copy(locale, '外观与语言', 'Appearance & language')}</h2></div><GlobalControls className="cosmos-settings-controls" /></header><div className="cosmos-preference-list"><label><span><SunMoon aria-hidden="true" /><span><strong>{copy(locale, '主题', 'Theme')}</strong><small>{copy(locale, '立即应用并持久化到当前浏览器。', 'Applies immediately and persists in this browser.')}</small></span></span><select value={theme} onChange={(event) => setTheme(event.target.value as 'light' | 'dark')}><option value="dark">{copy(locale, '深色', 'Dark')}</option><option value="light">{copy(locale, '浅色', 'Light')}</option></select></label><label><span><Languages aria-hidden="true" /><span><strong>{copy(locale, '语言', 'Language')}</strong><small>{copy(locale, '切换整个原型的界面语言。', 'Switches the interface language across the prototype.')}</small></span></span><select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}><option value="zh">简体中文</option><option value="en">English</option></select></label></div><footer className="cosmos-settings-panel__footer"><button type="button" className="cosmos-button cosmos-button--ghost" onClick={() => { setTheme('dark'); setLocale('zh'); setNotice('已恢复默认外观偏好') }}><RefreshCw aria-hidden="true" />{copy(locale, '恢复默认', 'Restore defaults')}</button></footer></> : null}
          </section>
        </div>
      </div>
    </main>
  )
}
