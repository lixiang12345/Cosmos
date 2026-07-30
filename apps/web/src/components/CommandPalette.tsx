import {
  Bot,
  Boxes,
  CirclePlay,
  CloudCog,
  FileText,
  FolderGit2,
  Home,
  Inbox,
  KeyRound,
  Network,
  Orbit,
  Plus,
  Search,
  ServerCog,
  Settings,
  Sparkles,
  Webhook,
  Workflow,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ArtifactDto, SearchResultItemDto } from '@cosmos/contracts'
import { usePreferences } from '../preferences'
import type { Run } from '../types'
import { IconButton } from './ui'

type CommandPaletteProps = {
  open: boolean
  runs: Run[]
  prototypeNavigation?: boolean
  sessionCreationEnabled?: boolean
  onClose: () => void
  onNewTask: () => void
  searchArtifacts?: (query: string, signal: AbortSignal) => Promise<ArtifactDto[]>
  onSearch?: (query: string, signal: AbortSignal) => Promise<SearchResultItemDto[]>
}

type Command = {
  id: string
  label: string
  detail: string
  icon: typeof Bot
  keywords: string
  action: () => void
}

export function CommandPalette({
  open,
  runs,
  prototypeNavigation = true,
  sessionCreationEnabled = true,
  onClose,
  onNewTask,
  searchArtifacts,
  onSearch,
}: CommandPaletteProps) {
  const { locale } = usePreferences()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [artifactResults, setArtifactResults] = useState<ArtifactDto[]>([])
  const [globalSearchResults, setGlobalSearchResults] = useState<SearchResultItemDto[]>([])
  const dialogRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const copy = locale === 'zh'
    ? { title: '搜索 Cosmos', placeholder: '查找页面、会话或运行命令…', navigation: '导航与命令', sessions: '会话', empty: '没有匹配结果', newSession: '新建会话', manual: '手动创建', open: '打开', experts: '专家', artifacts: '产出物', environments: '环境', automations: '自动化' }
    : { title: 'Search Cosmos', placeholder: 'Find a page, session, or command…', navigation: 'Navigation and commands', sessions: 'Sessions', empty: 'No matching results', newSession: 'New session', manual: 'Create manually', open: 'Open', experts: 'Experts', artifacts: 'Artifacts', environments: 'Environments', automations: 'Automations' }
  const artifactsTitle = locale === 'zh' ? '产出物' : 'Artifacts'

  const closePalette = useCallback(() => {
    setQuery('')
    setArtifactResults([])
    setGlobalSearchResults([])
    setActiveIndex(0)
    onClose()
  }, [onClose])

  const go = useCallback((path: string) => {
    navigate(path)
    closePalette()
  }, [closePalette, navigate])

  const navigationCommands = useMemo<Command[]>(() => [
    ...(sessionCreationEnabled ? [{ id: 'new-session', label: copy.newSession, detail: copy.manual, icon: Plus, keywords: 'new session task create 新建 会话 任务', action: () => { closePalette(); onNewTask() } }] : []),
    { id: 'home', label: locale === 'zh' ? '启动页' : 'Home', detail: prototypeNavigation
      ? (locale === 'zh' ? '选择 Expert 开始会话' : 'Choose an Expert and start a session')
      : (locale === 'zh' ? '选择 Expert 保存会话草稿' : 'Choose an Expert and save a Session draft'), icon: Home, keywords: 'home launcher expert 启动 首页', action: () => go('/home') },
    { id: 'sessions', label: locale === 'zh' ? '会话' : 'Sessions', detail: locale === 'zh' ? '全部会话' : 'All sessions', icon: Bot, keywords: 'sessions 会话', action: () => go('/sessions') },
    { id: 'context', label: locale === 'zh' ? '上下文工作区' : 'Context workspace', detail: locale === 'zh' ? '检索、审阅并打包代码证据' : 'Retrieve, review, and pack code evidence', icon: Network, keywords: 'context code search retrieval evidence 上下文 代码 检索 证据', action: () => go('/context') },
    { id: 'files', label: locale === 'zh' ? '文件' : 'Files', detail: locale === 'zh' ? '组织 / 个人' : 'Organization / User', icon: FileText, keywords: 'files memory 文件 记忆', action: () => go('/files') },
    { id: 'approvals', label: locale === 'zh' ? '待处理' : 'Approvals', detail: locale === 'zh' ? '人工输入与审批' : 'Human input and approvals', icon: Inbox, keywords: 'approvals human input 审批 待处理', action: () => go('/approvals') },
    { id: 'automations', label: locale === 'zh' ? '自动化' : 'Automations', detail: locale === 'zh' ? '触发器与订阅' : 'Triggers and subscriptions', icon: Workflow, keywords: 'automation trigger 自动化 触发器', action: () => go('/automations') },
    { id: 'run-history', label: locale === 'zh' ? '运行历史' : 'Run history', detail: locale === 'zh' ? '自动化' : 'Automations', icon: CirclePlay, keywords: 'run history 运行 历史', action: () => go('/automations/history') },
    { id: 'experts', label: locale === 'zh' ? '专家' : 'Experts', detail: locale === 'zh' ? '模板与自定义专家' : 'Templates and custom experts', icon: Sparkles, keywords: 'experts agents 专家 智能体', action: () => go('/experts') },
    { id: 'environments', label: locale === 'zh' ? '环境' : 'Environments', detail: locale === 'zh' ? '云 / 快照' : 'Cloud / Snapshot', icon: CloudCog, keywords: 'environment cloud vm snapshot 环境', action: () => go('/environments') },
    { id: 'daemons', label: locale === 'zh' ? '守护进程' : 'Daemons', detail: locale === 'zh' ? '自托管执行' : 'Self-hosted execution', icon: ServerCog, keywords: 'daemon pool self hosted 守护 进程', action: () => go('/daemons') },
    { id: 'repositories', label: locale === 'zh' ? '代码仓库' : 'Repositories', detail: 'GitHub', icon: FolderGit2, keywords: 'repositories github repo 仓库', action: () => go('/repositories') },
    { id: 'mcp', label: locale === 'zh' ? 'MCP 注册表' : 'MCP Registry', detail: locale === 'zh' ? '工具服务器' : 'Tool servers', icon: Boxes, keywords: 'mcp registry tool server', action: () => go('/mcp') },
    { id: 'webhooks', label: 'Webhooks', detail: locale === 'zh' ? '事件入口' : 'Event endpoints', icon: Webhook, keywords: 'webhook event 事件', action: () => go('/webhooks') },
    { id: 'secrets', label: locale === 'zh' ? '密钥' : 'Secrets', detail: locale === 'zh' ? '安全值存储' : 'Secure value storage', icon: KeyRound, keywords: 'secret credentials 密钥 凭据', action: () => go('/secrets') },
    { id: 'spaces', label: 'Spaces', detail: locale === 'zh' ? '资源隔离' : 'Resource boundaries', icon: Orbit, keywords: 'spaces scope 空间', action: () => go('/spaces') },
    { id: 'settings', label: locale === 'zh' ? '设置' : 'Settings', detail: locale === 'zh' ? '个人与组织' : 'Personal and organization', icon: Settings, keywords: 'settings preferences 设置', action: () => go('/settings') },
  ], [closePalette, copy.manual, copy.newSession, go, locale, onNewTask, prototypeNavigation, sessionCreationEnabled])

  useEffect(() => {
    if (!open) return
    const normalized = query.trim().toLocaleLowerCase()
    if (normalized.length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      if (onSearch) {
        onSearch(normalized, controller.signal).then((items) => {
          if (!controller.signal.aborted) setGlobalSearchResults(items)
        }, () => {})
      } else if (searchArtifacts) {
        searchArtifacts(normalized, controller.signal).then((items) => {
          if (!controller.signal.aborted) setArtifactResults(items)
        }, () => {})
      }
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [onSearch, open, query, searchArtifacts])

  const artifactCommands = useMemo<Command[]>(() => artifactResults.slice(0, 8).map((artifact) => ({
    id: `artifact-${artifact.id}`,
    label: artifact.label,
    detail: `${artifact.type.replace('_', ' ')} · ${artifact.url}`,
    icon: FolderGit2,
    keywords: `${artifact.label} ${artifact.url} ${artifact.type}`,
    action: () => go(`/sessions/${artifact.sessionId}`),
  })), [artifactResults, go])

  const globalSearchCommands = useMemo<Command[]>(() => globalSearchResults.map((item) => {
    let icon = Bot
    if (item.type === 'expert') icon = Sparkles
    else if (item.type === 'artifact') icon = FolderGit2
    else if (item.type === 'environment') icon = CloudCog
    else if (item.type === 'automation') icon = Workflow

    return {
      id: `search-${item.type}-${item.id}`,
      label: item.title,
      detail: item.subtitle ?? item.type,
      icon,
      keywords: `${item.title} ${item.subtitle ?? ''} ${item.type}`,
      action: () => go(item.url),
    }
  }), [globalSearchResults, go])

  const sessionCommands = useMemo<Command[]>(() => runs.slice(0, 12).map((run) => ({
    id: run.id,
    label: run.title,
    detail: `${run.repo} · ${run.expert}`,
    icon: Bot,
    keywords: `${run.title} ${run.repo} ${run.branch} ${run.trigger} ${run.expert}`,
    action: () => go(`/sessions/${run.id}`),
  })), [go, runs])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const { filteredNavigation, filteredSessions, filteredArtifacts, filteredSearchResults } = useMemo(() => {
    const matches = (command: Command) => !normalizedQuery
      || `${command.label} ${command.detail} ${command.keywords}`.toLocaleLowerCase().includes(normalizedQuery)
    return {
      filteredNavigation: navigationCommands.filter(matches),
      filteredSessions: sessionCommands.filter(matches),
      filteredArtifacts: normalizedQuery.length >= 2 ? artifactCommands.filter(matches) : [],
      filteredSearchResults: globalSearchCommands,
    }
  }, [artifactCommands, globalSearchCommands, navigationCommands, normalizedQuery, sessionCommands])
  const commands = useMemo(
    () => [...filteredNavigation, ...filteredSearchResults, ...filteredSessions, ...filteredArtifacts],
    [filteredArtifacts, filteredNavigation, filteredSearchResults, filteredSessions],
  )
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, commands.length - 1))

  useEffect(() => {
    if (!open) return
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(focusTimer)
      triggerRef.current?.focus()
      triggerRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closePalette()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((index) => commands.length ? (index + 1) % commands.length : 0)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((index) => commands.length ? (index - 1 + commands.length) % commands.length : 0)
      } else if (event.key === 'Enter' && commands[safeActiveIndex]) {
        event.preventDefault()
        commands[safeActiveIndex].action()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closePalette, commands, open, safeActiveIndex])

  if (!open) return null

  let rowIndex = 0
  const renderGroup = (title: string, group: Command[]) => group.length ? (
    <section className="command-palette__group" aria-label={title}>
      <p>{title}</p>
      {group.map((command) => {
        const Icon = command.icon
        const index = rowIndex++
        return (
          <button
            type="button"
            className={`command-palette__item${index === safeActiveIndex ? ' command-palette__item--active' : ''}`}
            key={command.id}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={command.action}
          >
            <span><Icon aria-hidden="true" /></span>
            <span><strong>{command.label}</strong><small>{command.detail}</small></span>
            <kbd>{copy.open}</kbd>
          </button>
        )
      })}
    </section>
  ) : null

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closePalette()
    }}>
      <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label={copy.title} onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ))
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }}>
        <header>
          <Search aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }} placeholder={copy.placeholder} aria-label={copy.title} />
          <IconButton icon={X} label={locale === 'zh' ? '关闭' : 'Close'} size="sm" onClick={closePalette} />
        </header>
        <div className="command-palette__results">
          {commands.length ? <>{renderGroup(copy.navigation, filteredNavigation)}{renderGroup(locale === 'zh' ? '搜索结果' : 'Search Results', filteredSearchResults)}{renderGroup(copy.sessions, filteredSessions)}{renderGroup(artifactsTitle, filteredArtifacts)}</> : (
            <div className="command-palette__empty"><Search aria-hidden="true" /><span>{copy.empty}</span></div>
          )}
        </div>
        <footer><span><kbd>↑</kbd><kbd>↓</kbd>{locale === 'zh' ? '选择' : 'Select'}</span><span><kbd>↵</kbd>{locale === 'zh' ? '打开' : 'Open'}</span><span><kbd>esc</kbd>{locale === 'zh' ? '关闭' : 'Close'}</span></footer>
      </section>
    </div>
  )
}
