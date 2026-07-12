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
import { usePreferences } from '../preferences'
import type { Run } from '../types'
import { IconButton } from './ui'

type CommandPaletteProps = {
  open: boolean
  runs: Run[]
  onClose: () => void
  onNewTask: () => void
}

type Command = {
  id: string
  label: string
  detail: string
  icon: typeof Bot
  keywords: string
  action: () => void
}

export function CommandPalette({ open, runs, onClose, onNewTask }: CommandPaletteProps) {
  const { locale } = usePreferences()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const copy = locale === 'zh'
    ? { title: '搜索 Relay', placeholder: '查找页面、会话或运行命令…', navigation: '导航与命令', sessions: '会话', empty: '没有匹配结果', newSession: '新建会话', manual: '手动创建', open: '打开' }
    : { title: 'Search Relay', placeholder: 'Find a page, session, or command…', navigation: 'Navigation and commands', sessions: 'Sessions', empty: 'No matching results', newSession: 'New session', manual: 'Create manually', open: 'Open' }

  const closePalette = useCallback(() => {
    setQuery('')
    setActiveIndex(0)
    onClose()
  }, [onClose])

  const go = useCallback((path: string) => {
    navigate(path)
    closePalette()
  }, [closePalette, navigate])

  const navigationCommands = useMemo<Command[]>(() => [
    { id: 'new-session', label: copy.newSession, detail: copy.manual, icon: Plus, keywords: 'new session task create 新建 会话 任务', action: () => { closePalette(); onNewTask() } },
    { id: 'home', label: locale === 'zh' ? '启动页' : 'Home', detail: locale === 'zh' ? '选择 Expert 开始会话' : 'Choose an Expert and start a session', icon: Home, keywords: 'home launcher expert 启动 首页', action: () => go('/home') },
    { id: 'sessions', label: locale === 'zh' ? '会话' : 'Sessions', detail: locale === 'zh' ? '全部会话' : 'All sessions', icon: Bot, keywords: 'sessions 会话', action: () => go('/sessions') },
    { id: 'files', label: locale === 'zh' ? '文件' : 'Files', detail: 'Organization / User', icon: FileText, keywords: 'files memory 文件 记忆', action: () => go('/files') },
    { id: 'approvals', label: locale === 'zh' ? '待处理' : 'Approvals', detail: locale === 'zh' ? '人工输入与审批' : 'Human input and approvals', icon: Inbox, keywords: 'approvals human input 审批 待处理', action: () => go('/approvals') },
    { id: 'automations', label: locale === 'zh' ? '自动化' : 'Automations', detail: locale === 'zh' ? '触发器与订阅' : 'Triggers and subscriptions', icon: Workflow, keywords: 'automation trigger 自动化 触发器', action: () => go('/automations') },
    { id: 'run-history', label: locale === 'zh' ? '运行历史' : 'Run history', detail: 'Automations', icon: CirclePlay, keywords: 'run history 运行 历史', action: () => go('/automations/history') },
    { id: 'experts', label: locale === 'zh' ? '专家' : 'Experts', detail: locale === 'zh' ? '模板与自定义专家' : 'Templates and custom experts', icon: Sparkles, keywords: 'experts agents 专家 智能体', action: () => go('/experts') },
    { id: 'environments', label: locale === 'zh' ? '环境' : 'Environments', detail: 'Cloud / Snapshot', icon: CloudCog, keywords: 'environment cloud vm snapshot 环境', action: () => go('/environments') },
    { id: 'daemons', label: locale === 'zh' ? '守护进程' : 'Daemons', detail: locale === 'zh' ? '自托管执行' : 'Self-hosted execution', icon: ServerCog, keywords: 'daemon pool self hosted 守护 进程', action: () => go('/daemons') },
    { id: 'repositories', label: locale === 'zh' ? '代码仓库' : 'Repositories', detail: 'GitHub', icon: FolderGit2, keywords: 'repositories github repo 仓库', action: () => go('/repositories') },
    { id: 'mcp', label: 'MCP Registry', detail: locale === 'zh' ? '工具服务器' : 'Tool servers', icon: Boxes, keywords: 'mcp registry tool server', action: () => go('/mcp') },
    { id: 'webhooks', label: 'Webhooks', detail: locale === 'zh' ? '事件入口' : 'Event endpoints', icon: Webhook, keywords: 'webhook event 事件', action: () => go('/webhooks') },
    { id: 'secrets', label: locale === 'zh' ? '密钥' : 'Secrets', detail: locale === 'zh' ? '安全值存储' : 'Secure value storage', icon: KeyRound, keywords: 'secret credentials 密钥 凭据', action: () => go('/secrets') },
    { id: 'spaces', label: 'Spaces', detail: locale === 'zh' ? '资源隔离' : 'Resource boundaries', icon: Orbit, keywords: 'spaces scope 空间', action: () => go('/spaces') },
    { id: 'settings', label: locale === 'zh' ? '设置' : 'Settings', detail: locale === 'zh' ? '个人与组织' : 'Personal and organization', icon: Settings, keywords: 'settings preferences 设置', action: () => go('/settings') },
  ], [closePalette, copy.manual, copy.newSession, go, locale, onNewTask])

  const sessionCommands = useMemo<Command[]>(() => runs.slice(0, 12).map((run) => ({
    id: run.id,
    label: run.title,
    detail: `${run.repo} · ${run.expert}`,
    icon: Bot,
    keywords: `${run.title} ${run.repo} ${run.branch} ${run.trigger} ${run.expert}`,
    action: () => go(`/runs/${run.id}`),
  })), [go, runs])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matches = (command: Command) => !normalizedQuery || `${command.label} ${command.detail} ${command.keywords}`.toLocaleLowerCase().includes(normalizedQuery)
  const filteredNavigation = navigationCommands.filter(matches)
  const filteredSessions = sessionCommands.filter(matches)
  const commands = useMemo(() => [...filteredNavigation, ...filteredSessions], [filteredNavigation, filteredSessions])
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, commands.length - 1))

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => inputRef.current?.focus(), 0)
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
      <section className="command-palette" role="dialog" aria-modal="true" aria-label={copy.title}>
        <header>
          <Search aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }} placeholder={copy.placeholder} aria-label={copy.title} />
          <IconButton icon={X} label={locale === 'zh' ? '关闭' : 'Close'} size="sm" onClick={closePalette} />
        </header>
        <div className="command-palette__results">
          {commands.length ? <>{renderGroup(copy.navigation, filteredNavigation)}{renderGroup(copy.sessions, filteredSessions)}</> : (
            <div className="command-palette__empty"><Search aria-hidden="true" /><span>{copy.empty}</span></div>
          )}
        </div>
        <footer><span><kbd>↑</kbd><kbd>↓</kbd>{locale === 'zh' ? '选择' : 'Select'}</span><span><kbd>↵</kbd>{locale === 'zh' ? '打开' : 'Open'}</span><span><kbd>esc</kbd>{locale === 'zh' ? '关闭' : 'Close'}</span></footer>
      </section>
    </div>
  )
}
