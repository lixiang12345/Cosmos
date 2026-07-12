import {
  Activity,
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronRight,
  CirclePlay,
  Clock3,
  Filter,
  FolderGit2,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  TicketCheck,
  Workflow,
} from 'lucide-react'
import { SiGithub } from 'react-icons/si'
import { Link } from 'react-router-dom'
import { GlobalControls } from '../components/GlobalControls'
import { usePreferences, type TranslationKey } from '../preferences'
import { automationRows, integrationRows } from '../data/mockData'
import type { Run } from '../types'
import { IconButton, SectionTitle, StatusBadge } from '../components/ui'

type PageProps = {
  runs: Run[]
  onOpenNavigation: () => void
  onNewTask: (expert?: string) => void
}

function ModuleHeader({
  title,
  description,
  onOpenNavigation,
  action,
}: {
  title: string
  description: string
  onOpenNavigation: () => void
  action?: React.ReactNode
}) {
  const { t } = usePreferences()
  return (
    <header className="module-header">
      <div className="module-header__copy">
        <IconButton icon={Menu} label={t('workbench.openNavigation')} className="mobile-menu" onClick={onOpenNavigation} />
        <div><h1>{title}</h1><p>{description}</p></div>
      </div>
      <div className="module-header__actions">
        <GlobalControls />
        {action}
      </div>
    </header>
  )
}

export function RunsOverview({ runs, onOpenNavigation, onNewTask }: PageProps) {
  const { t } = usePreferences()
  const waiting = runs.filter((run) => run.status === 'waiting').length
  const running = runs.filter((run) => run.status === 'running').length
  const failed = runs.filter((run) => run.status === 'failed').length
  const completed = runs.filter((run) => run.status === 'completed').length

  return (
    <main className="module-page">
      <ModuleHeader
        title={t('runs.title')}
        description={t('runs.description')}
        onOpenNavigation={onOpenNavigation}
        action={<button type="button" className="button button--primary" onClick={() => onNewTask()}><Plus aria-hidden="true" />{t('common.newTask')}</button>}
      />
      <div className="module-scroll">
        <section className="metrics-band" aria-label={t('runs.overview')}>
          <div><span><Clock3 aria-hidden="true" />{t('runs.waiting')}</span><strong>{waiting}</strong><small>{t('runs.waitingHint')}</small></div>
          <div><span><CirclePlay aria-hidden="true" />{t('status.running')}</span><strong>{running}</strong><small>{t('runs.runningHint')}</small></div>
          <div><span><AlertTriangle aria-hidden="true" />{t('status.failed')}</span><strong>{failed}</strong><small>{t('runs.failedHint')}</small></div>
          <div><span><CheckCircle2 aria-hidden="true" />{t('runs.completedToday')}</span><strong>{completed + 14}</strong><small>{t('runs.completedHint')}</small></div>
        </section>

        <section className="data-section">
          <SectionTitle eyebrow={t('runs.eyebrow')} title={t('runs.recent')} action={
            <div className="table-tools">
              <label className="search-field"><Search aria-hidden="true" /><input aria-label={t('common.search')} placeholder={t('runs.searchPlaceholder')} /></label>
              <button type="button" className="button button--ghost button--compact"><Filter aria-hidden="true" />{t('common.filter')}</button>
            </div>
          } />
          <div className="data-table runs-table" role="table" aria-label={t('runs.title')}>
            <div className="data-table__row data-table__head" role="row">
              <span>{t('sessions.task')}</span><span>{t('sessions.status')}</span><span>{t('sessions.expert')}</span><span>{t('sessions.progress')}</span><span>{t('sessions.updated')}</span><span />
            </div>
            {runs.map((run) => (
              <Link to={`/sessions/${run.id}`} className="data-table__row runs-table__row" role="row" key={run.id}>
                <span className="table-primary"><strong>{run.title}</strong><small>{run.repo}</small></span>
                <span className="runs-status-cell" data-label={t('sessions.status')}><StatusBadge status={run.status} /></span>
                <span className="runs-expert-cell" data-label={t('sessions.expert')}>{run.expert}</span>
                <span className="progress-cell runs-progress-cell" data-label={t('sessions.progress')}><i><b style={{ width: `${run.progress}%` }} /></i><small>{run.progress}%</small></span>
                <span className="runs-updated-cell" data-label={t('sessions.updated')}>{run.updatedAt}</span>
                <ChevronRight aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

export function AutomationsPage({ onOpenNavigation }: PageProps) {
  const { locale, t } = usePreferences()
  return (
    <main className="module-page">
      <ModuleHeader
        title={t('automations.title')}
        description={t('automations.description')}
        onOpenNavigation={onOpenNavigation}
        action={<button type="button" className="button button--primary"><Plus aria-hidden="true" />{t('automations.create')}</button>}
      />
      <div className="module-scroll">
        <section className="data-section">
          <SectionTitle eyebrow={t('automations.eyebrow')} title={t('automations.listTitle')} action={<IconButton icon={Settings2} label={t('automations.settings')} />} />
          <div className="automation-list">
            {automationRows.map((row, index) => {
              const translatedRows = [
                { name: 'Alert to remediation PR', trigger: 'Feishu keyword + PagerDuty', pipeline: 'Triage → Author → Test → Approval' },
                { name: 'Dependency upgrade review', trigger: 'GitHub pull_request', pipeline: 'Risk review → Compatibility test → Decision' },
                { name: 'Issue delivery workflow', trigger: 'Jira status change', pipeline: 'Plan → Author → Dual review → Deliver' },
              ]
              const display = locale === 'zh' ? row : { ...row, ...translatedRows[index] }
              const published = row.status === '已发布'
              return (
                <article className="automation-row" key={row.name}>
                  <span className="automation-row__icon"><Workflow aria-hidden="true" /></span>
                  <div className="automation-row__main"><h3>{display.name}</h3><p>{display.pipeline}</p></div>
                  <div><small>{t('automations.trigger')}</small><strong>{display.trigger}</strong></div>
                  <div><small>{t('automations.successRate')}</small><strong>{row.success}</strong></div>
                  <div><small>{t('automations.runCount')}</small><strong>{row.runs}</strong></div>
                  <span className={published ? 'state-label state-label--active' : 'state-label'}>{t(published ? 'automations.published' : 'automations.draft')}</span>
                  <IconButton icon={MoreHorizontal} label={`${display.name} · ${t('common.more')}`} />
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}

const repositories: Array<{ name: string; language: string; indexedKey: TranslationKey; coverage: string; policy: 'strict' | 'standard' }> = [
  { name: 'commerce/payment-service', language: 'TypeScript', indexedKey: 'repositories.now', coverage: '100%', policy: 'strict' },
  { name: 'commerce/billing-web', language: 'TypeScript', indexedKey: 'repositories.minutesAgo8', coverage: '98%', policy: 'standard' },
  { name: 'commerce/inventory-service', language: 'Go', indexedKey: 'repositories.minutesAgo21', coverage: '96%', policy: 'standard' },
  { name: 'platform/identity-service', language: 'Kotlin', indexedKey: 'repositories.hourAgo', coverage: '100%', policy: 'strict' },
]

export function RepositoriesPage({ onOpenNavigation }: PageProps) {
  const { t } = usePreferences()
  return (
    <main className="module-page">
      <ModuleHeader title={t('repositories.title')} description={t('repositories.description')} onOpenNavigation={onOpenNavigation} action={<button type="button" className="button button--primary"><Plus aria-hidden="true" />{t('repositories.connect')}</button>} />
      <div className="module-scroll">
        <section className="data-section">
          <SectionTitle eyebrow={t('repositories.eyebrow')} title={t('repositories.listTitle')} />
          <div className="simple-list">
            {repositories.map((repo) => (
              <article className="simple-row" key={repo.name}>
                <span className="simple-row__icon"><FolderGit2 aria-hidden="true" /></span>
                <div className="simple-row__copy"><h3>{repo.name}</h3><p>{repo.language}</p></div>
                <div><small>{t('repositories.coverage')}</small><strong>{repo.coverage}</strong></div>
                <div><small>{t('repositories.lastSync')}</small><strong>{t(repo.indexedKey)}</strong></div>
                <span className={repo.policy === 'strict' ? 'state-label state-label--warning' : 'state-label'}>{t(repo.policy === 'strict' ? 'repositories.strictPolicy' : 'repositories.standardPolicy')}</span>
                <IconButton icon={MoreHorizontal} label={`${repo.name} · ${t('common.more')}`} />
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

const integrationIcons = [SiGithub, MessageSquareText, TicketCheck, BellRing]

export function IntegrationsPage({ onOpenNavigation }: PageProps) {
  const { locale, t } = usePreferences()
  const detailKeys: TranslationKey[] = [
    'integrations.githubDetail',
    'integrations.feishuDetail',
    'integrations.jiraDetail',
    'integrations.pagerDutyDetail',
  ]
  return (
    <main className="module-page">
      <ModuleHeader title={t('integrations.title')} description={t('integrations.description')} onOpenNavigation={onOpenNavigation} action={<button type="button" className="button button--primary"><Plus aria-hidden="true" />{t('integrations.add')}</button>} />
      <div className="module-scroll">
        <section className="data-section">
          <SectionTitle eyebrow={t('integrations.eyebrow')} title={t('integrations.listTitle')} />
          <div className="integration-grid">
            {integrationRows.map((row, index) => {
              const IntegrationIcon = integrationIcons[index]
              return (
                <article className="integration-item" key={row.name}>
                  <header><span><IntegrationIcon aria-hidden="true" /></span><IconButton icon={MoreHorizontal} label={`${row.name} · ${t('common.more')}`} /></header>
                  <h3>{locale === 'en' && row.name === '飞书' ? 'Feishu' : row.name}</h3>
                  <p>{t(detailKeys[index])}</p>
                  <footer><span className={row.state === '已连接' ? 'state-label state-label--active' : 'state-label state-label--warning'}>{t(row.state === '已连接' ? 'integrations.connected' : 'integrations.actionRequired')}</span><small>{t(row.health === '健康' ? 'integrations.healthy' : 'integrations.missingWebhook')}</small></footer>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}

export function GovernancePage({ runs, onOpenNavigation }: PageProps) {
  const { t } = usePreferences()
  const pending = runs.find((run) => run.status === 'waiting')
  return (
    <main className="module-page">
      <ModuleHeader title={t('governance.title')} description={t('governance.description')} onOpenNavigation={onOpenNavigation} action={<button type="button" className="button button--ghost"><ShieldCheck aria-hidden="true" />{t('governance.policySettings')}</button>} />
      <div className="module-scroll">
        <section className="metrics-band metrics-band--three">
          <div><span>{t('governance.policyCoverage')}</span><strong>97.2%</strong><small>{t('governance.policyCoverageHint')}</small></div>
          <div><span>{t('governance.humanWait')}</span><strong>6m 18s</strong><small>{t('governance.humanWaitHint')}</small></div>
          <div><span>{t('governance.autoDecisions')}</span><strong>1,284</strong><small>{t('governance.autoDecisionsHint')}</small></div>
        </section>
        <section className="data-section">
          <SectionTitle eyebrow={t('governance.eyebrow')} title={t('governance.pending')} />
          {pending ? (
            <Link className="decision-row" to={`/sessions/${pending.id}`}>
              <span className="decision-row__risk"><AlertTriangle aria-hidden="true" /></span>
              <div><h3>{pending.approval?.title}</h3><p>{pending.title} · {pending.repo}</p></div>
              <span><small>{t('governance.matchedPolicy')}</small><strong>{t('governance.externalBudget')}</strong></span>
              <span><small>{t('governance.waitTime')}</small><strong>2m 14s</strong></span>
              <ChevronRight aria-hidden="true" />
            </Link>
          ) : <p className="empty-inline">{t('governance.empty')}</p>}
        </section>
      </div>
    </main>
  )
}

const activityRows = [
  { time: '10:22:18', actor: '林澈', action: { zh: '批准运行 run-482 的外部调用预算变更', en: 'approved the external call budget change for run-482' }, target: 'payment-service' },
  { time: '10:21:44', actor: 'Automated deep review on every PR', action: { zh: '创建人工审批请求', en: 'created a human approval request' }, target: 'run-482' },
  { time: '10:16:03', actor: 'Unit-test coverage gap analysis and draft PR', action: { zh: '完成 126 项测试', en: 'completed 126 tests' }, target: 'run-482' },
  { time: '09:52:31', actor: 'Ticket or task to a merged PR', action: { zh: '创建 Pull Request #913', en: 'created Pull Request #913' }, target: 'billing-web' },
]

export function ActivityPage({ onOpenNavigation }: PageProps) {
  const { locale, t } = usePreferences()
  return (
    <main className="module-page">
      <ModuleHeader title={t('activity.title')} description={t('activity.description')} onOpenNavigation={onOpenNavigation} action={<button type="button" className="button button--ghost"><Filter aria-hidden="true" />{t('activity.filter')}</button>} />
      <div className="module-scroll">
        <section className="data-section">
          <SectionTitle eyebrow={t('activity.eyebrow')} title={t('activity.recent')} />
          <div className="activity-list">
            {activityRows.map((row) => (
              <article key={`${row.time}-${row.action}`}>
                <span className="activity-list__icon"><Activity aria-hidden="true" /></span>
                <time>{row.time}</time>
                <p><strong>{row.actor}</strong> {row.action[locale]}</p>
                <code>{row.target}</code>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
