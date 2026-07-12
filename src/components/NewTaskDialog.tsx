import {
  Bot,
  Check,
  ChevronDown,
  FileImage,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Paperclip,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  WandSparkles,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePreferences } from '../preferences'
import type { NewTaskInput, TaskCreateMode } from '../types'
import { deriveSessionTitle, detectTaskContextItems } from '../features/run/sessionDraft'
import { IconButton } from './ui'

type NewTaskDialogProps = {
  open: boolean
  initialExpertId?: string
  initialPrompt?: string
  experts: NewTaskExpertOption[]
  repositories: Array<{ id: string; fullName: string; defaultBranch: string }>
  environments: Array<{ id: string; name: string; image: string; ready: boolean }>
  onClose: () => void
  onCreate: (input: NewTaskInput, mode: TaskCreateMode) => void
}

export type NewTaskExpertOption = {
  id: string
  version: number
  name: string
  description: string
  launchGuidance: string
  group: string
  tools: string
  environment: string
  environmentId?: string
  repository?: string
  approval: string
  successRate: string
  builtIn?: boolean
}

type StartState = 'idle' | 'checking' | 'ready'

export function NewTaskDialog({
  open,
  initialExpertId,
  initialPrompt = '',
  experts,
  repositories,
  environments,
  onClose,
  onCreate,
}: NewTaskDialogProps) {
  const { locale } = usePreferences()
  const copy = locale === 'zh'
    ? {
        eyebrow: '新建会话', title: '选择一个 Expert 开始', expert: '执行 Expert', task: '会话任务',
        prompt: '描述目标、上下文和期望结果。输入 / 可使用命令…', attach: '添加文件或图片',
        enhance: '增强提示词', start: '开始会话', checking: '正在启动…', ready: '环境已就绪',
        private: '仅自己', shared: '当前 Space', visibility: '可见范围', configured: '由 Expert 配置',
        environment: '运行环境', capabilities: '能力', policy: '策略', noExperts: '当前 Space 没有可用 Expert',
        noExpertsDetail: '请先发布一个 Expert，或切换到包含可用 Expert 的 Space。', remove: '移除附件',
        shortcut: 'Enter 发送 · Shift + Enter 换行', advisor: '内置',
      }
    : {
        eyebrow: 'New session', title: 'Choose an Expert to begin', expert: 'Expert', task: 'Session task',
        prompt: 'Describe the outcome, context, and expected result. Type / for commands…', attach: 'Attach files or images',
        enhance: 'Enhance prompt', start: 'Start session', checking: 'Starting…', ready: 'Environment ready',
        private: 'Private', shared: 'Current Space', visibility: 'Visibility', configured: 'Configured by Expert',
        environment: 'Environment', capabilities: 'Capabilities', policy: 'Policy', noExperts: 'No Experts are available in this Space',
        noExpertsDetail: 'Publish an Expert first, or switch to a Space with an available Expert.', remove: 'Remove attachment',
        shortcut: 'Enter to send · Shift + Enter for a new line', advisor: 'Built-in',
      }

  const initialExpert = experts.find((expert) => expert.id === initialExpertId) ?? experts[0]
  const [selectedExpertId, setSelectedExpertId] = useState(initialExpert?.id ?? '')
  const [prompt, setPrompt] = useState(initialPrompt)
  const [visibility, setVisibility] = useState<NonNullable<NewTaskInput['visibility']>>('private')
  const [attachments, setAttachments] = useState<string[]>([])
  const [startState, setStartState] = useState<StartState>('idle')
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const startTimerRef = useRef<number | undefined>(undefined)

  const selectedExpert = experts.find((expert) => expert.id === selectedExpertId) ?? initialExpert
  const selectedEnvironment = environments.find((environment) => environment.id === selectedExpert?.environmentId)
    ?? environments.find((environment) => environment.ready)
  const selectedRepository = repositories.find((repository) => repository.fullName === selectedExpert?.repository)
    ?? repositories[0]
  const groups = useMemo(() => [...new Set(experts.map((expert) => expert.group))], [experts])
  const contextItems = useMemo(() => detectTaskContextItems(prompt), [prompt])

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => promptRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  useEffect(() => () => {
    if (startTimerRef.current) window.clearTimeout(startTimerRef.current)
  }, [])

  if (!open) return null

  const canStart = Boolean(prompt.trim() && selectedExpert && selectedEnvironment?.ready)

  const closeDialog = () => {
    if (startTimerRef.current) window.clearTimeout(startTimerRef.current)
    setStartState('idle')
    onClose()
  }

  const startSession = () => {
    if (!canStart || !selectedExpert || !selectedEnvironment || !selectedRepository || startState !== 'idle') return
    const value = prompt.trim()
    const input: NewTaskInput = {
      title: deriveSessionTitle(value),
      description: value,
      repo: selectedRepository.fullName,
      expert: selectedExpert.name,
      expertId: selectedExpert.id,
      expertVersion: selectedExpert.version,
      environmentId: selectedEnvironment.id,
      visibility,
      baseBranch: selectedRepository.defaultBranch,
      acceptanceCriteria: [],
      contextItems,
      attachments,
    }

    setStartState('checking')
    startTimerRef.current = window.setTimeout(() => {
      setStartState('ready')
      startTimerRef.current = window.setTimeout(() => onCreate(input, 'run'), 220)
    }, 420)
  }

  return (
    <div className="dialog-backdrop session-launcher-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeDialog()
    }}>
      <section className="dialog session-launcher" role="dialog" aria-modal="true" aria-labelledby="session-launcher-title">
        <header className="session-launcher__header">
          <div>
            <p>{copy.eyebrow}</p>
            <h2 id="session-launcher-title">{copy.title}</h2>
          </div>
          <IconButton icon={X} label={locale === 'zh' ? '关闭' : 'Close'} onClick={closeDialog} />
        </header>

        {experts.length ? (
          <div className="session-launcher__body">
            <aside className="session-launcher__experts" aria-label={copy.expert}>
              {groups.map((group) => (
                <section key={group}>
                  <h3>{group}</h3>
                  {experts.filter((expert) => expert.group === group).map((expert) => {
                    const selected = expert.id === selectedExpert?.id
                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`session-expert-option${selected ? ' session-expert-option--selected' : ''}`}
                        key={expert.id}
                        onClick={() => setSelectedExpertId(expert.id)}
                      >
                        <span className="session-expert-option__icon">{expert.builtIn ? <Sparkles aria-hidden="true" /> : <Bot aria-hidden="true" />}</span>
                        <span><strong>{expert.name}</strong><small>{expert.description}</small></span>
                        {expert.builtIn ? <em>{copy.advisor}</em> : null}
                        {selected ? <Check aria-hidden="true" /> : null}
                      </button>
                    )
                  })}
                </section>
              ))}
            </aside>

            <div className="session-launcher__compose">
              <header className="session-launcher__expert-summary">
                <div>
                  <span className="session-expert-option__icon">{selectedExpert?.builtIn ? <Sparkles aria-hidden="true" /> : <Bot aria-hidden="true" />}</span>
                  <span><strong>{selectedExpert?.name}</strong><small>{selectedExpert?.launchGuidance || selectedExpert?.description}</small></span>
                </div>
                <dl>
                  <div><dt>{copy.environment}</dt><dd>{selectedEnvironment?.name ?? selectedExpert?.environment}</dd></div>
                  <div><dt>{copy.capabilities}</dt><dd>{selectedExpert?.tools || '—'}</dd></div>
                  <div><dt>{copy.policy}</dt><dd>{selectedExpert?.approval || '—'}</dd></div>
                </dl>
              </header>

              <label className="session-launcher__prompt">
                <span>{copy.task}</span>
                <textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      startSession()
                    }
                  }}
                  placeholder={copy.prompt}
                  rows={7}
                />
              </label>

              {contextItems.length ? (
                <div className="new-task-context" aria-label={locale === 'zh' ? '已识别上下文' : 'Detected context'}>
                  <div className="new-task-context__chips">
                    {contextItems.map((item) => (
                      <span className="new-task-context-chip" key={item.id}>
                        <Link2 aria-hidden="true" />
                        <a href={item.url} target="_blank" rel="noreferrer">{item.label}</a>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {attachments.length ? (
                <div className="session-launcher__attachments">
                  {attachments.map((name) => (
                    <span key={name}>
                      <FileImage aria-hidden="true" />{name}
                      <button type="button" aria-label={`${copy.remove}: ${name}`} onClick={() => setAttachments((items) => items.filter((item) => item !== name))}><X aria-hidden="true" /></button>
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="session-launcher__controls">
                <div>
                  <input
                    ref={fileInputRef}
                    className="visually-hidden"
                    type="file"
                    hidden
                    aria-hidden="true"
                    tabIndex={-1}
                    multiple
                    accept="image/*,.txt,.md,.json,.log,.pdf"
                    onChange={(event) => {
                      const names = Array.from(event.target.files ?? []).slice(0, 10).map((file) => file.name)
                      setAttachments((items) => [...new Set([...items, ...names])].slice(0, 10))
                      event.target.value = ''
                    }}
                  />
                  <IconButton icon={Paperclip} label={copy.attach} onClick={() => fileInputRef.current?.click()} />
                  <IconButton icon={WandSparkles} label={copy.enhance} disabled={!prompt.trim()} onClick={() => setPrompt((value) => value.trim()
                    ? `${value.trim()}\n\n${locale === 'zh' ? '请先确认目标、约束、风险和可验证的完成标准。' : 'First confirm the goal, constraints, risks, and verifiable completion criteria.'}`
                    : value)} />
                  <label className="session-visibility-select">
                    {visibility === 'private' ? <LockKeyhole aria-hidden="true" /> : <Users aria-hidden="true" />}
                    <span className="visually-hidden">{copy.visibility}</span>
                    <select value={visibility} onChange={(event) => setVisibility(event.target.value as NonNullable<NewTaskInput['visibility']>)}>
                      <option value="private">{copy.private}</option>
                      <option value="space">{copy.shared}</option>
                    </select>
                    <ChevronDown aria-hidden="true" />
                  </label>
                </div>
                <button
                  type="button"
                  className={`button button--primary session-launcher__start session-launcher__start--${startState}`}
                  disabled={!canStart || startState !== 'idle'}
                  aria-busy={startState === 'checking'}
                  onClick={startSession}
                >
                  {startState === 'checking' ? <LoaderCircle className="new-task-submit-spinner" aria-hidden="true" /> : null}
                  {startState === 'ready' ? <Check aria-hidden="true" /> : null}
                  {startState === 'idle' ? <Send aria-hidden="true" /> : null}
                  {startState === 'checking' ? copy.checking : startState === 'ready' ? copy.ready : copy.start}
                </button>
              </div>
              <footer><span><ShieldCheck aria-hidden="true" />{copy.configured}</span><kbd>{copy.shortcut}</kbd></footer>
            </div>
          </div>
        ) : (
          <div className="session-launcher__empty"><Bot aria-hidden="true" /><h3>{copy.noExperts}</h3><p>{copy.noExpertsDetail}</p></div>
        )}
      </section>
    </div>
  )
}
