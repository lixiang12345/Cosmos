import {
  Boxes,
  ChevronDown,
  ChevronRight,
  CloudCog,
  FileText,
  FolderGit2,
  Globe2,
  History,
  KeyRound,
  LayoutGrid,
  LogOut,
  MessageCircle,
  Orbit,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plug,
  Plus,
  ServerCog,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Webhook,
  Workflow,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useControlPlane } from '../features/control-plane'
import { usePreferences } from '../preferences'
import type { Run } from '../types'
import { useActiveWorkspace } from '../workspace'
import { GlobalControls } from './GlobalControls'
import { IconButton, StatusBadge } from './ui'

type SidebarProps = {
  runs: Run[]
  prototypeNavigation?: boolean
  open: boolean
  collapsed: boolean
  onClose: () => void
  onNewTask: () => void
  sessionCreationEnabled?: boolean
  onToggleCollapsed: () => void
}

type NavItem = {
  to: string
  label: { zh: string; en: string }
  icon?: typeof Sparkles
}

const configurationItems: NavItem[] = [
  { to: '/experts', label: { zh: '专家', en: 'Experts' }, icon: Sparkles },
  { to: '/environments', label: { zh: '环境', en: 'Environments' }, icon: CloudCog },
  { to: '/daemons', label: { zh: '守护进程', en: 'Daemons' }, icon: ServerCog },
  { to: '/integrations', label: { zh: '集成', en: 'Integrations' }, icon: Plug },
  { to: '/mcp', label: { zh: 'MCP 注册表', en: 'MCP Registry' }, icon: Boxes },
  { to: '/webhooks', label: { zh: 'Webhooks', en: 'Webhooks' }, icon: Webhook },
  { to: '/secrets', label: { zh: '密钥', en: 'Secrets' }, icon: KeyRound },
  { to: '/repositories', label: { zh: '仓库', en: 'Repositories' }, icon: FolderGit2 },
  { to: '/spaces', label: { zh: '空间', en: 'Spaces' }, icon: Globe2 },
  { to: '/settings', label: { zh: '设置', en: 'Settings' }, icon: Settings2 },
]

const automationItems: NavItem[] = [
  { to: '/automations', label: { zh: '概览', en: 'Overview' }, icon: Workflow },
  { to: '/automations/events', label: { zh: '事件日志', en: 'Event Log' }, icon: LayoutGrid },
  { to: '/automations/history', label: { zh: '运行历史', en: 'Run History' }, icon: History },
]

const fileItems: NavItem[] = [
  { to: '/files/organization', label: { zh: '组织', en: 'Organization' } },
  { to: '/files/user', label: { zh: '个人', en: 'User' } },
]

function SidebarLink({ item, nested = false, badge, onNavigate }: { item: NavItem; nested?: boolean; badge?: number; onNavigate: () => void }) {
  const { locale } = usePreferences()
  const label = item.label[locale]
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) => `sidebar-link${nested ? ' sidebar-link--nested' : ''}${isActive ? ' sidebar-link--active' : ''}`}
      aria-label={label}
      data-tooltip={label}
      onClick={onNavigate}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span>{label}</span>
      {badge ? <span className="sidebar-link__badge">{badge}</span> : null}
    </NavLink>
  )
}

export function Sidebar({
  runs,
  prototypeNavigation = true,
  open,
  collapsed,
  onClose,
  onNewTask,
  sessionCreationEnabled = true,
  onToggleCollapsed,
}: SidebarProps) {
  const auth = useAuth()
  const { locale, t } = usePreferences()
  const { activeSpace, actions, state } = useControlPlane()
  const workspace = useActiveWorkspace()
  const location = useLocation()
  const [spaceSwitcherOpen, setSpaceSwitcherOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(true)
  const [automationsOpen, setAutomationsOpen] = useState(true)
  const [configurationOpen, setConfigurationOpen] = useState(true)
  const pinnedRuns = runs.filter((run) => run.favorite && !run.archived).slice(0, 3)
  const recentRuns = runs.filter((run) => !run.archived && !run.favorite).slice(0, 6)
  const visibleConfigurationItems = prototypeNavigation
    ? configurationItems
    : configurationItems.filter((item) => item.to === '/experts' || item.to === '/environments')
  const copy = locale === 'zh'
    ? { files: '文件', automations: '自动化', configuration: '配置', pinned: '置顶', recent: '最近会话', expand: '展开导航', collapse: '收起导航', role: '已认证组织成员', signOut: '退出登录' }
    : { files: 'Files', automations: 'Automations', configuration: 'Configuration', pinned: 'Pinned', recent: 'Recent Sessions', expand: 'Expand navigation', collapse: 'Collapse navigation', role: 'Authenticated organization member', signOut: 'Sign out' }
  const displayName = auth.displayName ?? auth.actorId ?? 'Relay user'
  const avatar = Array.from(displayName.trim())[0]?.toLocaleUpperCase() ?? 'R'

  return (
    <>
      <button type="button" className={`sidebar-scrim${open ? ' sidebar-scrim--visible' : ''}`} aria-label={t('common.close')} onClick={onClose} />
      <aside className={`sidebar sidebar--cosmos${open ? ' sidebar--open' : ''}${collapsed ? ' sidebar--collapsed' : ''}`}>
        <div className="sidebar__brand">
          <NavLink to="/home" className="brand" onClick={onClose} aria-label="Relay">
            <span className="brand__mark"><Orbit aria-hidden="true" /></span>
            <span className="brand__copy"><strong>Relay</strong><small>Agent OS</small></span>
          </NavLink>
          <IconButton icon={X} label={t('common.close')} className="sidebar__mobile-close" onClick={onClose} />
        </div>

        <div className="sidebar__space-switcher">
          <button type="button" className="space-switcher-btn" aria-expanded={spaceSwitcherOpen} onClick={() => setSpaceSwitcherOpen((value) => !value)}>
            <Globe2 aria-hidden="true" />
            <span>{activeSpace.name}</span>
            <ChevronDown aria-hidden="true" />
          </button>
          {spaceSwitcherOpen ? (
            <ul className="space-switcher-menu">
              {workspace.me.organizations.flatMap((organization) => organization.spaces.length ? [
                <li key={organization.id} className="space-switcher-menu__organization">
                  <p>{organization.name}</p>
                  <ul>
                    {organization.spaces.map((space) => {
                      const current = workspace.organization.id === organization.id && activeSpace.id === space.id
                      return (
                        <li key={`${organization.id}:${space.id}`}>
                          <button
                            type="button"
                            aria-current={current}
                            onClick={() => {
                              if (workspace.organization.id === organization.id && state.spaces.some((item) => item.id === space.id)) {
                                actions.switchSpace(space.id)
                              } else {
                                workspace.selectSpace(organization.id, space.id)
                              }
                              setSpaceSwitcherOpen(false)
                            }}
                          >
                            {space.name}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </li>,
              ] : [])}
            </ul>
          ) : null}
        </div>

        {sessionCreationEnabled ? <div className="sidebar__quick-actions sidebar__quick-actions--cosmos">
          <button type="button" className="sidebar-new-session" onClick={onNewTask} aria-label={t('sessions.new')} data-tooltip={t('sessions.new')}>
            <Plus aria-hidden="true" />
            <span>{t('sessions.new')}</span>
          </button>
        </div> : null}

        <nav className="sidebar__nav sidebar__nav--cosmos" aria-label={t('nav.mainLabel')}>
          <SidebarLink item={{ to: '/sessions', label: { zh: '会话', en: 'Sessions' }, icon: MessageCircle }} onNavigate={onClose} />

          {pinnedRuns.length ? <div className="sidebar__group sidebar__favorites">
            <div className="sidebar__group-heading"><p className="sidebar__group-label">{copy.pinned}</p><Pin aria-hidden="true" /></div>
            {pinnedRuns.map((run) => {
              const active = location.pathname === `/sessions/${run.id}`
              return <NavLink key={run.id} to={`/sessions/${run.id}`} className={`recent-run${active ? ' recent-run--active' : ''}`} onClick={onClose}><span className="recent-run__title">{run.title}</span><StatusBadge status={run.status} /></NavLink>
            })}
          </div> : null}

          <div className="sidebar__group sidebar__recent">
            <div className="sidebar__group-heading"><p className="sidebar__group-label">{copy.recent}</p><History aria-hidden="true" /></div>
            {recentRuns.map((run) => {
              const active = location.pathname === `/sessions/${run.id}`
              return <NavLink key={run.id} to={`/sessions/${run.id}`} className={`recent-run${active ? ' recent-run--active' : ''}`} onClick={onClose}><span className="recent-run__title">{run.title}</span><StatusBadge status={run.status} /></NavLink>
            })}
          </div>

          {prototypeNavigation ? <div className="sidebar__configuration sidebar__files">
            <button type="button" className="sidebar-configuration-toggle" aria-expanded={filesOpen} onClick={() => setFilesOpen((value) => !value)}>
              <FileText aria-hidden="true" />
              <span>{copy.files}</span>
              {filesOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </button>
            {filesOpen ? (
              <div className="sidebar-configuration-list">
                {fileItems.map((item) => <SidebarLink key={item.to} item={item} nested onNavigate={onClose} />)}
              </div>
            ) : null}
          </div> : null}

          {prototypeNavigation ? <div className="sidebar__configuration sidebar__automations">
            <button type="button" className="sidebar-configuration-toggle" aria-expanded={automationsOpen} onClick={() => setAutomationsOpen((value) => !value)}>
              <Workflow aria-hidden="true" />
              <span>{copy.automations}</span>
              {automationsOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </button>
            {automationsOpen ? (
              <div className="sidebar-configuration-list">
                {automationItems.map((item) => <SidebarLink key={item.to} item={item} nested onNavigate={onClose} />)}
              </div>
            ) : null}
          </div> : null}

          <div className="sidebar__configuration">
            <button type="button" className="sidebar-configuration-toggle" aria-expanded={configurationOpen} onClick={() => setConfigurationOpen((value) => !value)}>
              <SlidersHorizontal aria-hidden="true" />
              <span>{copy.configuration}</span>
              {configurationOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </button>
            {configurationOpen ? (
              <div className="sidebar-configuration-list">
                {visibleConfigurationItems.map((item) => <SidebarLink key={item.to} item={item} nested onNavigate={onClose} />)}
              </div>
            ) : null}
          </div>

        </nav>

        <div className="sidebar-mobile-preferences"><GlobalControls /></div>
        <div className="sidebar__account">
          <span className="account-avatar">{avatar}</span>
          <span><strong>{displayName}</strong><small>{copy.role}</small></span>
          {auth.mode === 'oidc' ? <IconButton icon={LogOut} label={copy.signOut} size="sm" onClick={() => { void auth.signOut() }} /> : null}
          <IconButton icon={collapsed ? PanelLeftOpen : PanelLeftClose} label={collapsed ? copy.expand : copy.collapse} size="sm" onClick={onToggleCollapsed} />
        </div>
      </aside>
    </>
  )
}
