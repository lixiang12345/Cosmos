import {
  AlertTriangle,
  BellRing,
  Bot,
  Building2,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Clipboard,
  Clock3,
  Code2,
  Download,
  FileCode2,
  FileText,
  Files,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  HardDrive,
  Link2,
  Layers3,
  Menu,
  MessageSquareText,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  Share2,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  TestTube2,
  Trash2,
  UserRoundCheck,
  WandSparkles,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GlobalControls } from '../../components/GlobalControls'
import { usePreferences, type TranslationKey } from '../../preferences'
import type { Run, RunArtifact, RunEvent } from '../../types'
import { IconButton, StatusBadge } from '../../components/ui'

type RunWorkbenchProps = {
  run: Run
  onOpenNavigation: () => void
  onDecision: (runId: string, decision: 'approved' | 'changes') => void
  onRetry: (runId: string) => void
  onPause: (runId: string) => void
  onStop: (runId: string) => void
}

type RunTab = 'conversation' | 'changes' | 'files' | 'terminal' | 'subscriptions' | 'approval'

const tabItems: Array<{ id: RunTab; labelKey: TranslationKey; icon: typeof Bot }> = [
  { id: 'conversation', labelKey: 'workbench.conversation', icon: MessageSquareText },
  { id: 'changes', labelKey: 'workbench.changes', icon: FileCode2 },
  { id: 'files', labelKey: 'workbench.files', icon: Files },
  { id: 'terminal', labelKey: 'workbench.terminal', icon: TerminalSquare },
  { id: 'subscriptions', labelKey: 'workbench.subscriptions', icon: BellRing },
  { id: 'approval', labelKey: 'workbench.approval', icon: UserRoundCheck },
]

const eventIcons: Record<RunEvent['kind'], typeof Bot> = {
  request: MessageSquareText,
  agent: Bot,
  tool: TerminalSquare,
  result: ShieldAlert,
  approval: UserRoundCheck,
}

function EventCard({ event }: { event: RunEvent }) {
  const { t, locale } = usePreferences()
  const [outputExpanded, setOutputExpanded] = useState(false)
  const EventIcon = eventIcons[event.kind]

  // For tool events, parse command name (first line) and output (rest)
  const isToolEvent = event.kind === 'tool'
  const bodyLines = isToolEvent ? event.body.split('\n') : []
  const commandName = isToolEvent ? bodyLines[0] : ''
  const commandOutput = isToolEvent ? bodyLines.slice(1).join('\n').trim() : ''

  return (
    <article className={`event-card event-card--${event.kind}`}>
      <div className="event-card__rail">
        <span className={`event-card__icon event-card__icon--${event.status ?? 'default'}`}>
          <EventIcon aria-hidden="true" />
        </span>
      </div>
      <div className="event-card__content">
        <header className="event-card__header">
          <span><strong>{event.actor}</strong><time>{event.timestamp}</time></span>
          {event.status === 'working' ? <span className="working-indicator">{t('workbench.working')}</span> : null}
        </header>
        <h3>{event.title}</h3>
        {isToolEvent ? (
          <div className="event-card__tool-body">
            <div className="event-card__tool-command">
              <code>{commandName}</code>
              <span className={`event-card__exit-code event-card__exit-code--${event.status === 'success' ? 'success' : event.status === 'warning' ? 'failure' : 'default'}`}>
                {event.status === 'success' ? <Check aria-hidden="true" /> : event.status === 'warning' ? <XCircle aria-hidden="true" /> : null}
                {event.status === 'success' ? (locale === 'zh' ? '成功' : 'exit 0') : event.status === 'warning' ? (locale === 'zh' ? '失败' : 'failed') : ''}
              </span>
            </div>
            {commandOutput ? (
              <div className="event-card__tool-output">
                <button
                  type="button"
                  className="event-card__tool-output-toggle"
                  onClick={() => setOutputExpanded(v => !v)}
                  aria-expanded={outputExpanded}
                >
                  <ChevronDown className={`event-card__tool-output-chevron${outputExpanded ? '' : ' event-card__tool-output-chevron--collapsed'}`} aria-hidden="true" />
                  {outputExpanded ? (locale === 'zh' ? '收起输出' : 'Hide output') : (locale === 'zh' ? '显示输出' : 'Show output')}
                </button>
                {outputExpanded ? <pre className="event-card__tool-output-content">{commandOutput}</pre> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p>{event.body}</p>
        )}
        {event.meta ? <footer>{event.meta}</footer> : null}
      </div>
    </article>
  )
}

function ApprovalPanel({ run, onDecision }: { run: Run; onDecision: RunWorkbenchProps['onDecision'] }) {
  const { t } = usePreferences()
  if (!run.approval) {
    return (
      <div className="empty-state">
        <CheckCircle2 aria-hidden="true" />
        <h3>{t('workbench.noApprovalTitle')}</h3>
        <p>{t('workbench.noApprovalDescription')}</p>
      </div>
    )
  }

  const waiting = run.status === 'waiting'

  return (
    <section className="approval-panel" aria-labelledby="approval-title">
      <header className="approval-panel__header">
        <span className="approval-panel__icon"><AlertTriangle aria-hidden="true" /></span>
        <div>
          <p>{t('workbench.policyDecision')}</p>
          <h3 id="approval-title">{run.approval.title}</h3>
        </div>
        <span className={`risk-label risk-label--${run.approval.risk}`}>{t('workbench.mediumRisk')}</span>
      </header>

      <div className="approval-panel__body">
        <p className="approval-panel__summary">{run.approval.recommendation}</p>
        <ul>
          {run.approval.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
        <div className="evidence-row">
          <span><TestTube2 aria-hidden="true" />{t('workbench.testsPassed')}</span>
          <span><FileCode2 aria-hidden="true" />{t('workbench.changedFilesSummary')}</span>
          <span><RotateCcw aria-hidden="true" />{t('workbench.rollbackReady')}</span>
        </div>
      </div>

      <footer className="approval-panel__actions">
        {waiting ? (
          <>
            <button type="button" className="button button--ghost" onClick={() => onDecision(run.id, 'changes')}>
              {t('common.requestChanges')}
            </button>
            <button type="button" className="button button--warning" onClick={() => onDecision(run.id, 'approved')}>
              <Check aria-hidden="true" />
              {t('workbench.approveContinue')}
            </button>
          </>
        ) : (
          <span className="decision-confirmed"><CheckCircle2 aria-hidden="true" />{t('workbench.decisionRecorded')}</span>
        )}
      </footer>
    </section>
  )
}

function ConversationView({ run, onDecision }: { run: Run; onDecision: RunWorkbenchProps['onDecision'] }) {
  const { locale, t } = usePreferences()
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const slashCommands = locale === 'zh'
    ? [
        { command: '/plan', label: '先生成执行计划', detail: '列出步骤、风险和验证方式' },
        { command: '/files', label: '定位相关文件', detail: '搜索当前工作区与持久文件' },
        { command: '/status', label: '总结当前进度', detail: '说明已完成、进行中和待处理事项' },
      ]
    : [
        { command: '/plan', label: 'Prepare a plan first', detail: 'List steps, risks, and verification' },
        { command: '/files', label: 'Find relevant files', detail: 'Search the workspace and persistent files' },
        { command: '/status', label: 'Summarize progress', detail: 'Report completed, active, and pending work' },
      ]
  const slashQuery = message.startsWith('/') && !message.includes(' ')
    ? message.slice(1).toLowerCase()
    : null
  const matchingCommands = slashQuery === null
    ? []
    : slashCommands.filter((item) => item.command.slice(1).includes(slashQuery))

  const sendMessage = () => {
    const value = message.trim()
    if (!value) return
    setQueuedMessages((items) => [...items, value])
    setMessage('')
  }

  const enhanceMessage = () => {
    if (!message.trim()) return
    setMessage((value) => `${value.trim()}\n\n${locale === 'zh' ? '请确认目标、约束、风险和可验证的完成标准。' : 'Confirm the goal, constraints, risks, and verifiable completion criteria.'}`)
  }

  return (
    <div className="conversation-layout">
      <div className="conversation-scroll">
        <div className="conversation">
          <section className="task-summary">
            <span className="task-summary__label">{t('workbench.taskBrief')}</span>
            <h2>{run.title}</h2>
            <p>{run.summary}</p>
            <div className="task-summary__meta">
              <span><GitBranch aria-hidden="true" />{run.repo}</span>
              <span><Link2 aria-hidden="true" />{run.trigger}</span>
            </div>
          </section>

          <div className="event-list">
            {run.events.map((event) => <EventCard key={event.id} event={event} />)}
            {queuedMessages.map((item, index) => (
              <EventCard
                key={`${item}-${index}`}
                event={{
                  id: `${index}`,
                  kind: 'request',
                  actor: '林澈',
                  title: t('workbench.queuedInstruction'),
                  body: item,
                  timestamp: t('workbench.justNow'),
                  meta: run.status === 'running' ? t('workbench.executeAfterStep') : t('workbench.addedToContext'),
                }}
              />
            ))}
          </div>

          {run.approval ? <ApprovalPanel run={run} onDecision={onDecision} /> : null}
        </div>
      </div>

      <div className="composer-shell">
        <div className="composer">
          {attachments.length ? (
            <div className="composer__attachments">
              {attachments.map((name) => (
                <span key={name}><Paperclip aria-hidden="true" />{name}<button type="button" aria-label={`${locale === 'zh' ? '移除附件' : 'Remove attachment'}: ${name}`} onClick={() => setAttachments((items) => items.filter((item) => item !== name))}>×</button></span>
              ))}
            </div>
          ) : null}
          {run.status === 'running' || run.status === 'queued' ? (
            <div className="composer__queue-state" aria-live="polite">
              <span className="composer__queue-dot" aria-hidden="true" />
              <span>
                {locale === 'zh'
                  ? `Expert 正在工作，后续消息将在当前回合结束后发送${queuedMessages.length ? ` · 已排队 ${queuedMessages.length} 条` : ''}`
                  : `The Expert is working. Follow-up messages will send when this turn finishes${queuedMessages.length ? ` · ${queuedMessages.length} queued` : ''}`}
              </span>
            </div>
          ) : null}
          {matchingCommands.length ? (
            <div className="composer-command-menu" role="listbox" aria-label={locale === 'zh' ? '可用命令' : 'Available commands'}>
              {matchingCommands.map((item) => (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  key={item.command}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setMessage(`${item.command} `)}
                >
                  <code>{item.command}</code>
                  <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                sendMessage()
              }
            }}
            placeholder={t('workbench.inputPlaceholder')}
            rows={2}
            aria-label={t('workbench.inputPlaceholder')}
          />
          <div className="composer__toolbar">
            <div className="composer__tools">
              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                hidden
                aria-hidden="true"
                tabIndex={-1}
                multiple
                aria-label={t('workbench.attachFile')}
                onChange={(event) => {
                  const names = Array.from(event.target.files ?? []).map((file) => file.name)
                  setAttachments((items) => [...new Set([...items, ...names])])
                  event.target.value = ''
                }}
              />
              <IconButton icon={Paperclip} label={t('workbench.attachFile')} size="sm" onClick={() => fileInputRef.current?.click()} />
              <IconButton
                icon={WandSparkles}
                label={locale === 'zh' ? '增强提示词' : 'Enhance prompt'}
                size="sm"
                disabled={!message.trim()}
                onClick={enhanceMessage}
              />
              <span className="composer-model" title={locale === 'zh' ? '模型由 Expert 配置' : 'Configured by the Expert'}>
                <Sparkles aria-hidden="true" />
                {run.model}
                <small>{locale === 'zh' ? 'Expert 配置' : 'Expert'}</small>
              </span>
            </div>
            <button type="button" className="send-button" onClick={sendMessage} disabled={!message.trim()} aria-label={t('workbench.sendInstruction')}>
              <Send aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TerminalView({ run }: { run: Run }) {
  const { t } = usePreferences()
  return (
    <div className="terminal-view">
      <header>
        <div>
          <span className="terminal-dots" aria-hidden="true"><i /><i /><i /></span>
          <strong>cosmos-sandbox · {run.repo}</strong>
        </div>
        <span>{t('workbench.readOnlyReplay')}</span>
      </header>
      <pre aria-label={t('workbench.terminalOutput')}>
        {run.terminal.map((line, index) => (
          <code key={`${line}-${index}`} className={line.startsWith('$') ? 'terminal-command' : line.includes('Error') ? 'terminal-error' : ''}>
            {line}{'\n'}
          </code>
        ))}
        {run.status === 'running' ? <code className="terminal-cursor">▋</code> : null}
      </pre>
    </div>
  )
}

const diffLines = [
  { type: 'context', old: '41', next: '41', text: 'export const retryPolicy = {' },
  { type: 'removed', old: '42', next: '', text: '  maxAttempts: 3,' },
  { type: 'added', old: '', next: '42', text: '  maxAttempts: 5,' },
  { type: 'added', old: '', next: '43', text: '  backoff: exponentialWithJitter({' },
  { type: 'added', old: '', next: '44', text: '    baseMs: 250,' },
  { type: 'added', old: '', next: '45', text: '    maxMs: 8_000,' },
  { type: 'added', old: '', next: '46', text: '  }),' },
  { type: 'context', old: '43', next: '47', text: '  shouldRetry: isTransientProviderError,' },
  { type: 'context', old: '44', next: '48', text: '}' },
]

function ChangesView({ run }: { run: Run }) {
  const { t } = usePreferences()
  const [activeFile, setActiveFile] = useState(run.files[0]?.path ?? '')
  const [splitView, setSplitView] = useState(false)

  return (
    <div className="files-view">
      <aside className="file-list" aria-label={t('workbench.changedFiles')}>
        <header><strong>{t('workbench.changedFiles')}</strong><span>{run.files.length}</span></header>
        {run.files.map((file) => (
          <button
            type="button"
            key={file.path}
            className={activeFile === file.path ? 'file-row file-row--active' : 'file-row'}
            onClick={() => setActiveFile(file.path)}
          >
            <span className={`file-status file-status--${file.status.toLowerCase()}`}>{file.status}</span>
            <span className="file-row__path">{file.path}</span>
            <span className="file-row__stats"><i>+{file.additions}</i><b>-{file.deletions}</b></span>
          </button>
        ))}
      </aside>
      <section className={`diff-view${splitView ? ' diff-view--split' : ''}`} aria-label={t('workbench.codeDiff')}>
        <header>
          <span><FileCode2 aria-hidden="true" />{activeFile}</span>
          <button type="button" className="button button--ghost button--compact" aria-pressed={splitView} onClick={() => setSplitView((value) => !value)}>{t('workbench.splitView')}</button>
        </header>
        <div className="diff-code">
          {diffLines.map((line, index) => (
            <div key={`${line.text}-${index}`} className={`diff-line diff-line--${line.type}`}>
              <span>{line.old}</span><span>{line.next}</span><code>{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}{line.text}</code>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

type SessionFileScope = 'workspace' | 'user' | 'organization'

const sessionFiles: Record<SessionFileScope, Array<{ path: string; updated: string; author: string; content: string }>> = {
  workspace: [
    {
      path: 'src/retry/retry-policy.ts',
      updated: '10:18',
      author: 'Ticket or task to a merged PR',
      content: 'export const retryPolicy = {\n  maxAttempts: 5,\n  backoff: exponentialWithJitter({ baseMs: 250, maxMs: 8_000 }),\n}\n',
    },
    {
      path: 'docs/verification.md',
      updated: '10:20',
      author: 'Automated deep review on every PR',
      content: '# Verification\n\n- 126 tests passed\n- Lint passed\n- Rollback plan prepared\n',
    },
  ],
  user: [
    {
      path: 'preferences/review-style.md',
      updated: '昨天',
      author: 'Cosmos Advisor',
      content: '# Review preferences\n\nPrioritize correctness, rollback safety, and concrete verification evidence.\n',
    },
    {
      path: 'notes/payment-domain.md',
      updated: '3 天前',
      author: 'Incident Investigator',
      content: '# Payment domain notes\n\nThe provider timeout budget is owned by the payments platform team.\n',
    },
  ],
  organization: [
    {
      path: 'standards/engineering.md',
      updated: '5 天前',
      author: 'Project Builder',
      content: '# Engineering standards\n\nAll production changes require tests, an owner, and a rollback path.\n',
    },
    {
      path: 'runbooks/payment-timeout.md',
      updated: '1 周前',
      author: 'Incident Investigator',
      content: '# Payment timeout runbook\n\nCheck provider latency, retry volume, and idempotency conflicts before mitigation.\n',
    },
  ],
}

function SessionFilesView() {
  const { locale } = usePreferences()
  const [scope, setScope] = useState<SessionFileScope>('workspace')
  const [activePath, setActivePath] = useState(sessionFiles.workspace[0].path)
  const files = sessionFiles[scope]
  const activeFile = files.find((file) => file.path === activePath) ?? files[0]
  const copy = locale === 'zh'
    ? {
        title: '会话文件', workspace: '工作区', user: '个人', organization: '组织',
        updated: '更新', by: '写入者', copyPath: '复制路径', copyContent: '复制内容', download: '下载文件',
        note: '持久文件由 Expert 在会话中写入；此处用于浏览和引用。',
      }
    : {
        title: 'Session files', workspace: 'Workspace', user: 'User', organization: 'Organization',
        updated: 'Updated', by: 'Written by', copyPath: 'Copy path', copyContent: 'Copy content', download: 'Download file',
        note: 'Persistent files are written by Experts in sessions; browse and reference them here.',
      }
  const scopes: Array<{ id: SessionFileScope; label: string; icon: typeof HardDrive }> = [
    { id: 'workspace', label: copy.workspace, icon: HardDrive },
    { id: 'user', label: copy.user, icon: UserRoundCheck },
    { id: 'organization', label: copy.organization, icon: Building2 },
  ]

  const selectScope = (nextScope: SessionFileScope) => {
    setScope(nextScope)
    setActivePath(sessionFiles[nextScope][0].path)
  }

  const downloadFile = () => {
    const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = activeFile.path.split('/').pop() ?? 'session-file.txt'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="session-files-view">
      <aside className="session-files-browser">
        <header><span><FolderOpen aria-hidden="true" /><strong>{copy.title}</strong></span><small>{copy.note}</small></header>
        <div className="session-files-scopes" role="tablist" aria-label={copy.title}>
          {scopes.map((item) => {
            const Icon = item.icon
            return (
              <button type="button" role="tab" aria-selected={scope === item.id} className={scope === item.id ? 'session-files-scope session-files-scope--active' : 'session-files-scope'} key={item.id} onClick={() => selectScope(item.id)}>
                <Icon aria-hidden="true" />{item.label}<span>{sessionFiles[item.id].length}</span>
              </button>
            )
          })}
        </div>
        <div className="session-files-list">
          {files.map((file) => (
            <button type="button" className={activeFile.path === file.path ? 'session-file-row session-file-row--active' : 'session-file-row'} key={file.path} onClick={() => setActivePath(file.path)}>
              <FileText aria-hidden="true" />
              <span><strong>{file.path}</strong><small>{copy.updated} {file.updated} · {file.author}</small></span>
            </button>
          ))}
        </div>
      </aside>
      <section className="session-file-preview" aria-label={activeFile.path}>
        <header>
          <div><span>{scope}</span><strong>{activeFile.path}</strong><small>{copy.by} {activeFile.author} · {activeFile.updated}</small></div>
          <div>
            <IconButton icon={Clipboard} label={copy.copyPath} size="sm" onClick={() => navigator.clipboard?.writeText(activeFile.path)} />
            <IconButton icon={FileText} label={copy.copyContent} size="sm" onClick={() => navigator.clipboard?.writeText(activeFile.content)} />
            <IconButton icon={Download} label={copy.download} size="sm" onClick={downloadFile} />
          </div>
        </header>
        <pre><code>{activeFile.content}</code></pre>
      </section>
    </div>
  )
}

function SubscriptionsView({ run }: { run: Run }) {
  const { locale } = usePreferences()
  const [watchingReview, setWatchingReview] = useState(run.source === 'automation')
  const [watchingChecks, setWatchingChecks] = useState(true)
  const copy = locale === 'zh'
    ? {
        title: '会话订阅',
        description: '订阅会把后续事件送回当前会话，不会创建新会话。它会在会话结束时一并关闭。',
        review: 'PR 审查评论',
        reviewDetail: '收到 review_comment 后唤醒当前专家',
        checks: 'CI 检查状态',
        checksDetail: '检查失败或完成时继续当前会话',
        active: '已订阅',
        paused: '已暂停',
        provenance: '由专家在运行时创建 · 原型模拟',
      }
    : {
        title: 'Session subscriptions',
        description: 'Subscriptions deliver later events back to this session instead of creating a new one. They end with the session.',
        review: 'PR review comments',
        reviewDetail: 'Wake the current Expert when a review_comment arrives',
        checks: 'CI check status',
        checksDetail: 'Continue this session when checks fail or complete',
        active: 'Subscribed',
        paused: 'Paused',
        provenance: 'Created by the Expert at runtime · Prototype simulation',
      }
  const rows = [
    { id: 'review', title: copy.review, detail: copy.reviewDetail, trigger: 'github.pull_request.review_comment', enabled: watchingReview, toggle: () => setWatchingReview((value) => !value) },
    { id: 'checks', title: copy.checks, detail: copy.checksDetail, trigger: 'github.check_suite.completed', enabled: watchingChecks, toggle: () => setWatchingChecks((value) => !value) },
  ]
  return (
    <div className="subscription-view">
      <header><BellRing aria-hidden="true" /><div><h2>{copy.title}</h2><p>{copy.description}</p></div></header>
      <div className="subscription-list">
        {rows.map((row) => (
          <article key={row.id}>
            <span className="subscription-list__icon"><BellRing aria-hidden="true" /></span>
            <div><h3>{row.title}</h3><p>{row.detail}</p><code>{row.trigger}</code></div>
            <span className={row.enabled ? 'state-label state-label--active' : 'state-label'}>{row.enabled ? copy.active : copy.paused}</span>
            <button type="button" className="button button--ghost button--compact" onClick={row.toggle}>{row.enabled ? copy.paused : copy.active}</button>
          </article>
        ))}
      </div>
      <p className="subscription-view__note"><Clock3 aria-hidden="true" />{copy.provenance}</p>
    </div>
  )
}

function RunInspector({ run }: { run: Run }) {
  const { locale, t } = usePreferences()
  const [artifacts, setArtifacts] = useState<RunArtifact[]>(run.artifacts ?? [])
  const [addingArtifact, setAddingArtifact] = useState(false)
  const [artifactDraft, setArtifactDraft] = useState({ label: '', url: '' })

  const addArtifact = () => {
    const label = artifactDraft.label.trim()
    const url = artifactDraft.url.trim()
    if (!label || !url) return
    setArtifacts((items) => [...items, {
      id: `artifact-${Date.now()}`,
      type: 'link',
      label,
      url,
      status: 'ready',
    }])
    setArtifactDraft({ label: '', url: '' })
    setAddingArtifact(false)
  }

  return (
    <aside className="run-inspector">
      <header className="run-inspector__header">
        <div><p>{t('inspector.eyebrow')}</p><h2>{t('workbench.details')}</h2></div>
        <span className="run-id">{run.id}</span>
      </header>

      <section className="inspector-section">
        <h3>{t('inspector.currentExecutor')}</h3>
        <div className="expert-row">
          <span className="expert-avatar"><Bot aria-hidden="true" /></span>
          <span><strong>{run.expert}</strong><small>{run.model} · {t('inspector.policyConstrained')}</small></span>
          <span className="presence-dot" aria-label={t('inspector.online')} />
        </div>
      </section>

      {run.workers?.length ? (
        <section className="inspector-section">
          <h3>{locale === 'zh' ? 'Worker 关系' : 'Worker tree'}</h3>
          <div className="worker-tree">
            <div className="worker-tree__root"><Bot aria-hidden="true" /><span><strong>{run.expert}</strong><small>{locale === 'zh' ? '主 Expert' : 'Primary Expert'}</small></span></div>
            {run.workers.map((worker) => (
              <div className="worker-tree__child" key={worker.id}>
                <span aria-hidden="true" />
                <Bot aria-hidden="true" />
                <span><strong>{worker.name}</strong><small>{worker.task} · {worker.status}</small></span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="inspector-section">
        <h3>{t('inspector.metrics')}</h3>
        <dl className="metric-grid">
          <div><dt>{t('inspector.elapsed')}</dt><dd>{run.elapsed}</dd></div>
          <div><dt>{locale === 'zh' ? '事件' : 'Events'}</dt><dd>{run.events.length}</dd></div>
          <div><dt>{t('inspector.context')}</dt><dd>38.2k</dd></div>
          <div><dt>{t('inspector.estimatedCost')}</dt><dd>{new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { style: 'currency', currency: 'CNY' }).format(4.82)}</dd></div>
        </dl>
      </section>

      <section className="inspector-section">
        <h3>{locale === 'zh' ? '运行环境' : 'Environment'}</h3>
        <div className="inspector-resource">
          <HardDrive aria-hidden="true" />
          <span><strong>{run.environmentId ?? (locale === 'zh' ? '默认 Cloud 环境' : 'Default cloud environment')}</strong><small>{locale === 'zh' ? '隔离 Snapshot · 会话结束后释放' : 'Isolated snapshot · released after the session'}</small></span>
        </div>
      </section>

      <section className="inspector-section">
        <h3>{locale === 'zh' ? '运行尝试' : 'Run attempts'}</h3>
        <div className="attempt-list">
          {(run.attempts ?? []).map((attempt) => (
            <div key={attempt.id}>
              <span><Layers3 aria-hidden="true" /></span>
              <span><strong>Attempt {attempt.number}</strong><small>{attempt.failureReason ?? attempt.duration ?? attempt.startedAt}</small></span>
              <em className={`attempt-list__status attempt-list__status--${attempt.status}`}>{attempt.status}</em>
            </div>
          ))}
          {run.attempts?.length ? null : <p className="empty-inline">Attempt 1 · {run.status}</p>}
        </div>
      </section>

      <section className="inspector-section">
        <div className="inspector-section__heading">
          <h3>{locale === 'zh' ? '产物' : 'Artifacts'}</h3>
          <IconButton icon={Plus} label={locale === 'zh' ? '添加链接产物' : 'Add link artifact'} size="sm" onClick={() => setAddingArtifact((value) => !value)} />
        </div>
        {addingArtifact ? (
          <div className="artifact-form">
            <label><span>{locale === 'zh' ? '名称' : 'Label'}</span><input value={artifactDraft.label} onChange={(event) => setArtifactDraft((value) => ({ ...value, label: event.target.value }))} /></label>
            <label><span>URL</span><input type="url" value={artifactDraft.url} onChange={(event) => setArtifactDraft((value) => ({ ...value, url: event.target.value }))} /></label>
            <div><button type="button" className="button button--ghost button--compact" onClick={() => setAddingArtifact(false)}>{locale === 'zh' ? '取消' : 'Cancel'}</button><button type="button" className="button button--primary button--compact" disabled={!artifactDraft.label.trim() || !artifactDraft.url.trim()} onClick={addArtifact}>{locale === 'zh' ? '添加' : 'Add'}</button></div>
          </div>
        ) : null}
        <div className="artifact-list">
          {artifacts.map((artifact) => (
            <div className="artifact-row" key={artifact.id}>
              <a href={artifact.url} target={artifact.url.startsWith('http') ? '_blank' : undefined} rel={artifact.url.startsWith('http') ? 'noreferrer' : undefined}>
                {artifact.type === 'pull_request' ? <GitPullRequest aria-hidden="true" /> : <Link2 aria-hidden="true" />}
                <span><strong>{artifact.label}</strong><small>{artifact.type.replace('_', ' ')} · {artifact.status}</small></span>
              </a>
              <IconButton icon={Trash2} label={`${locale === 'zh' ? '移除产物' : 'Remove artifact'}: ${artifact.label}`} size="sm" onClick={() => setArtifacts((items) => items.filter((item) => item.id !== artifact.id))} />
            </div>
          ))}
          {artifacts.length ? null : <p className="empty-inline">{locale === 'zh' ? '尚未生成产物' : 'No artifacts yet'}</p>}
        </div>
      </section>

      <section className="inspector-section">
        <h3>{t('inspector.contextSources')}</h3>
        <ul className="context-list">
          <li><Code2 aria-hidden="true" /><span><strong>{t('inspector.codeGraph')}</strong><small>{t('inspector.relatedFiles')}</small></span><Check aria-hidden="true" /></li>
          <li><Braces aria-hidden="true" /><span><strong>{t('inspector.teamStandards')}</strong><small>payments/standards.md</small></span><Check aria-hidden="true" /></li>
          <li><GitPullRequest aria-hidden="true" /><span><strong>{t('inspector.changeHistory')}</strong><small>{t('inspector.similarPrs')}</small></span><Check aria-hidden="true" /></li>
        </ul>
      </section>

      <section className="inspector-section">
        <h3>{t('inspector.permissions')}</h3>
        <div className="permission-row"><span>{t('inspector.codeWrite')}</span><strong>{t('inspector.temporaryBranch')}</strong></div>
        <div className="permission-row"><span>{t('inspector.externalNetwork')}</span><strong>{t('inspector.allowlist')}</strong></div>
        <div className="permission-row"><span>{t('inspector.mergePermission')}</span><strong className="text-warning">{t('inspector.approvalRequired')}</strong></div>
      </section>
    </aside>
  )
}

export function RunWorkbench({ run, onOpenNavigation, onDecision, onRetry, onPause, onStop }: RunWorkbenchProps) {
  const { locale, t } = usePreferences()
  const [activeTab, setActiveTab] = useState<RunTab>('conversation')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [shareNotice, setShareNotice] = useState('')
  const shareTimerRef = useRef<number | undefined>(undefined)

  const fileCount = run.files.length
  const approvalCount = run.status === 'waiting' && run.approval ? 1 : 0
  const tabCounts = useMemo<Record<RunTab, number | undefined>>(() => ({
    conversation: undefined,
    changes: fileCount || undefined,
    terminal: undefined,
    files: sessionFiles.workspace.length + sessionFiles.user.length + sessionFiles.organization.length,
    subscriptions: run.source === 'automation' ? 2 : 1,
    approval: approvalCount || undefined,
  }), [approvalCount, fileCount, run.source])
  const visibleTabs = useMemo(() => tabItems.filter((tab) => {
    if (tab.id === 'changes') return run.files.length > 0
    if (tab.id === 'terminal') return run.terminal.length > 0
    if (tab.id === 'subscriptions') return run.source === 'automation'
    if (tab.id === 'approval') return Boolean(run.approval)
    return true
  }), [run.approval, run.files.length, run.source, run.terminal.length])

  useEffect(() => () => {
    if (shareTimerRef.current) window.clearTimeout(shareTimerRef.current)
  }, [])

  const shareSession = async () => {
    try {
      await navigator.clipboard?.writeText(window.location.href)
      setShareNotice(locale === 'zh' ? '会话链接已复制' : 'Session link copied')
    } catch {
      setShareNotice(locale === 'zh' ? '无法访问剪贴板，请复制地址栏链接' : 'Clipboard unavailable. Copy the address bar URL.')
    }
    if (shareTimerRef.current) window.clearTimeout(shareTimerRef.current)
    shareTimerRef.current = window.setTimeout(() => setShareNotice(''), 2400)
  }

  return (
    <main className="workspace">
      <header className="workspace-header">
        <div className="workspace-header__title">
          <IconButton icon={Menu} label={t('workbench.openNavigation')} className="mobile-menu" onClick={onOpenNavigation} />
          <div>
            <h1>{run.title}</h1>
            <span><GitBranch aria-hidden="true" />{run.repo}</span>
          </div>
          <StatusBadge status={run.status} />
        </div>
        <div className="workspace-header__actions">
          <GlobalControls className="workspace-preferences" />
          <IconButton icon={Share2} label={t('workbench.shareSession')} onClick={shareSession} />
          {run.status === 'failed' ? (
            <button type="button" className="button button--ghost" onClick={() => onRetry(run.id)}><RotateCcw aria-hidden="true" />{t('workbench.retryStep')}</button>
          ) : (
            <IconButton icon={run.status === 'running' ? Pause : Play} label={run.status === 'running' ? t('workbench.pauseRun') : t('workbench.resumeRun')} onClick={() => onPause(run.id)} disabled={run.status === 'completed' || run.status === 'canceled'} />
          )}
          <IconButton icon={CircleStop} label={t('workbench.stopRun')} className="workspace-stop-action" onClick={() => onStop(run.id)} disabled={run.status === 'completed' || run.status === 'canceled'} />
          <IconButton
            icon={inspectorOpen ? PanelRightClose : PanelRightOpen}
            label={inspectorOpen ? t('workbench.closeInspector') : t('workbench.openInspector')}
            className="workspace-inspector-action"
            onClick={() => setInspectorOpen((value) => !value)}
          />
        </div>
      </header>

      {shareNotice ? <div className="toast" role="status"><CheckCircle2 aria-hidden="true" /><span>{shareNotice}</span></div> : null}

      <nav className="workspace-tabs" aria-label={t('workbench.viewLabel')}>
        {visibleTabs.map((tab) => {
          const TabIcon = tab.icon
          return (
            <button
              type="button"
              key={tab.id}
              className={activeTab === tab.id ? 'workspace-tab workspace-tab--active' : 'workspace-tab'}
              onClick={() => setActiveTab(tab.id)}
            >
              <TabIcon aria-hidden="true" />
              {t(tab.labelKey)}
              {tabCounts[tab.id] ? <span>{tabCounts[tab.id]}</span> : null}
            </button>
          )
        })}
      </nav>

      <div className={`workspace-body${inspectorOpen ? '' : ' workspace-body--wide'}`}>
        <section className="run-panel">
          <div className="run-view">
            {activeTab === 'conversation' ? <ConversationView run={run} onDecision={onDecision} /> : null}
            {activeTab === 'changes' ? <ChangesView run={run} /> : null}
            {activeTab === 'files' ? <SessionFilesView /> : null}
            {activeTab === 'terminal' ? <TerminalView run={run} /> : null}
            {activeTab === 'subscriptions' ? <SubscriptionsView run={run} /> : null}
            {activeTab === 'approval' ? <div className="approval-view"><ApprovalPanel run={run} onDecision={onDecision} /></div> : null}
          </div>
        </section>
        {inspectorOpen ? <RunInspector run={run} /> : null}
      </div>
    </main>
  )
}
