import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useControlPlane } from '../features/control-plane'
import { usePreferences } from '../preferences'
import type { Run } from '../types'
import { useActiveWorkspace } from '../workspace'
import {
  PrototypeAutomationIcon,
  PrototypeChevronDownIcon,
  PrototypeChevronRightIcon,
  PrototypeConfigurationIcon,
  PrototypeFolderIcon,
  PrototypePlusIcon,
  PrototypeSessionsIcon,
  PrototypeSidebarIcon,
} from './PrototypeIcons'

type SidebarProps = {
  runs: Run[]
  open: boolean
  collapsed: boolean
  onClose: () => void
  sessionCreationEnabled?: boolean
  onToggleCollapsed: () => void
}

type SidebarRoute = {
  to: string
  en: string
  zh: string
}

const files: SidebarRoute[] = [
  { to: '/files/organization', en: 'Organization', zh: '组织' },
  { to: '/files/user', en: 'User', zh: '个人' },
]

const foundation: SidebarRoute[] = [
  { to: '/experts', en: 'Experts', zh: '专家' },
  { to: '/environments', en: 'Environments', zh: '环境' },
]

const capabilities: SidebarRoute[] = [
  { to: '/integrations', en: 'Integrations', zh: '集成' },
  { to: '/mcp', en: 'MCP Registry', zh: 'MCP 注册表' },
  { to: '/skills', en: 'Skills', zh: '技能' },
  { to: '/webhooks', en: 'Webhooks', zh: 'Webhooks' },
  { to: '/secrets', en: 'Secrets', zh: '密钥' },
]

const automations: SidebarRoute[] = [
  { to: '/automations', en: 'Automations', zh: '自动化' },
  { to: '/automations/events', en: 'Event Log', zh: '事件日志' },
  { to: '/automations/history', en: 'Run History', zh: '运行历史' },
]

function SidebarSubLink({ route, onNavigate }: { route: SidebarRoute; onNavigate: () => void }) {
  const { locale } = usePreferences()
  return (
    <NavLink
      to={route.to}
      className={({ isActive }) => `sb-sub${isActive ? ' active' : ''}`}
      aria-label={route[locale]}
      onClick={onNavigate}
    >
      {route[locale]}
    </NavLink>
  )
}

export function Sidebar({
  runs,
  open,
  collapsed,
  onClose,
  sessionCreationEnabled = true,
  onToggleCollapsed,
}: SidebarProps) {
  const auth = useAuth()
  const { locale, t, toggleLocale } = usePreferences()
  const { activeSpace, actions, state } = useControlPlane()
  const workspace = useActiveWorkspace()
  const location = useLocation()
  const [spaceSwitcherOpen, setSpaceSwitcherOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(true)
  const [configurationOpen, setConfigurationOpen] = useState(true)
  const [automationsOpen, setAutomationsOpen] = useState(true)
  const sidebarToggleRef = useRef<HTMLButtonElement>(null)
  const wasCollapsedRef = useRef(collapsed)
  const pinnedRuns = runs.filter((run) => run.favorite && !run.archived).slice(0, 3)
  const recentRuns = runs.filter((run) => !run.archived).slice(0, 6)
  const displayName = auth.displayName ?? auth.actorId ?? 'Cosmos user'
  const avatar = Array.from(displayName.trim())[0]?.toLocaleUpperCase() ?? 'U'
  const role = locale === 'zh' ? '已认证组织成员' : 'Authenticated organization member'

  useEffect(() => {
    if (!spaceSwitcherOpen && !accountMenuOpen) return
    const closeMenus = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSpaceSwitcherOpen(false)
      setAccountMenuOpen(false)
    }
    window.addEventListener('keydown', closeMenus)
    return () => window.removeEventListener('keydown', closeMenus)
  }, [accountMenuOpen, spaceSwitcherOpen])

  useEffect(() => {
    if (wasCollapsedRef.current && !collapsed) sidebarToggleRef.current?.focus()
    wasCollapsedRef.current = collapsed
  }, [collapsed])

  const switchSpace = (organizationId: string, spaceId: string) => {
    if (workspace.organization.id === organizationId && state.spaces.some((item) => item.id === spaceId)) {
      actions.switchSpace(spaceId)
    } else {
      workspace.selectSpace(organizationId, spaceId)
    }
    setSpaceSwitcherOpen(false)
  }

  return (
    <>
      <button type="button" className={`sidebar-scrim${open ? ' sidebar-scrim--visible' : ''}`} aria-label={t('common.close')} onClick={onClose} />
      <aside aria-hidden={collapsed || undefined} inert={collapsed ? true : undefined} className={`sidebar prototype-sidebar${open ? ' sidebar--open' : ''}${collapsed ? ' sidebar--collapsed' : ''}`}>
        <div className="sb-header" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSpaceSwitcherOpen(false) }}>
          <button type="button" className="logo" aria-label={locale === 'zh' ? '切换空间' : 'Switch Space'} aria-expanded={spaceSwitcherOpen} onClick={() => setSpaceSwitcherOpen((value) => !value)}>
            <img className="logo-icon" src="/assets/cosmos-logo.svg" width="18" height="16" alt="" />
            <span>Cosmos</span>
            <PrototypeChevronDownIcon className="chev" aria-hidden="true" />
          </button>
          <button ref={sidebarToggleRef} type="button" className="icon-btn" title={locale === 'zh' ? '收起导航' : 'Toggle sidebar'} aria-label={locale === 'zh' ? '收起导航' : 'Toggle sidebar'} onClick={onToggleCollapsed}>
            <PrototypeSidebarIcon aria-hidden="true" />
          </button>
          {spaceSwitcherOpen ? (
            <ul className="prototype-space-menu">
              {workspace.me.organizations.map((organization) => (
                <li key={organization.id}>
                  <p>{organization.name}</p>
                  {organization.spaces.map((space) => {
                    const current = workspace.organization.id === organization.id && activeSpace.id === space.id
                    return (
                      <button type="button" key={space.id} aria-current={current} onClick={() => switchSpace(organization.id, space.id)}>
                        {space.name}
                      </button>
                    )
                  })}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {sessionCreationEnabled ? (
          <NavLink to="/home" className={({ isActive }) => `sb-new${isActive ? ' active' : ''}`} aria-label={locale === 'zh' ? '新建会话' : 'New session'} onClick={onClose}>
            <PrototypePlusIcon aria-hidden="true" />
            {locale === 'zh' ? '新建会话' : 'New session'}
          </NavLink>
        ) : (
          <button type="button" className="sb-new" aria-label={locale === 'zh' ? '新建会话' : 'New session'} disabled title={locale === 'zh' ? '当前 Space 只有查看权限' : 'View-only access in this Space'}>
            <PrototypePlusIcon aria-hidden="true" />
            {locale === 'zh' ? '新建会话' : 'New session'}
          </button>
        )}

        <nav className="sb-nav" aria-label={t('nav.mainLabel')}>
          <NavLink to="/sessions" className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`} aria-label={locale === 'zh' ? '会话' : 'Sessions'} onClick={onClose}>
            <PrototypeSessionsIcon aria-hidden="true" />
            {locale === 'zh' ? '会话' : 'Sessions'}
          </NavLink>

          <button type="button" className={`sb-group${filesOpen ? '' : ' collapsed'}`} aria-label={locale === 'zh' ? '文件' : 'Files'} aria-expanded={filesOpen} onClick={() => setFilesOpen((value) => !value)}>
            <span className="sb-group-left"><PrototypeFolderIcon aria-hidden="true" />{locale === 'zh' ? '文件' : 'Files'}</span>
            <PrototypeChevronRightIcon className="chev" aria-hidden="true" />
          </button>
          <div className={`sb-collapse${filesOpen ? ' open' : ''}`}>
            {files.map((route) => <SidebarSubLink key={route.to} route={route} onNavigate={onClose} />)}
          </div>

          <button type="button" className={`sb-group${configurationOpen ? '' : ' collapsed'}`} aria-label={locale === 'zh' ? '配置' : 'Configuration'} aria-expanded={configurationOpen} onClick={() => setConfigurationOpen((value) => !value)}>
            <span className="sb-group-left"><PrototypeConfigurationIcon aria-hidden="true" />{locale === 'zh' ? '配置' : 'Configuration'}</span>
            <PrototypeChevronRightIcon className="chev" aria-hidden="true" />
          </button>
          <div className={`sb-collapse${configurationOpen ? ' open' : ''}`}>
            <div className="sb-sec">{locale === 'zh' ? '基础' : 'Foundation'}</div>
            {foundation.map((route) => <SidebarSubLink key={route.to} route={route} onNavigate={onClose} />)}
            <div className="sb-sec">{locale === 'zh' ? '能力' : 'Capabilities'}</div>
            {capabilities.map((route) => <SidebarSubLink key={route.to} route={route} onNavigate={onClose} />)}
          </div>

          <button type="button" className={`sb-group${automationsOpen ? '' : ' collapsed'}`} aria-label={locale === 'zh' ? '自动化' : 'Automations'} aria-expanded={automationsOpen} onClick={() => setAutomationsOpen((value) => !value)}>
            <span className="sb-group-left"><PrototypeAutomationIcon aria-hidden="true" />{locale === 'zh' ? '自动化' : 'Automations'}</span>
            <PrototypeChevronRightIcon className="chev" aria-hidden="true" />
          </button>
          <div className={`sb-collapse${automationsOpen ? ' open' : ''}`}>
            {automations.map((route) => <SidebarSubLink key={route.to} route={route} onNavigate={onClose} />)}
          </div>
        </nav>

        <div className="sb-section-label">{locale === 'zh' ? '收藏' : 'Favorites'}</div>
        <div className="sb-fav-drop" title="Pinned sessions appear here">
          {pinnedRuns.length ? pinnedRuns.map((run) => (
            <NavLink key={run.id} to={`/sessions/${run.id}`} className="sb-fav-item" onClick={onClose}>★ {run.title}</NavLink>
          )) : <span className="sb-fav-hint">{locale === 'zh' ? '拖入会话以收藏' : 'Drag sessions here to pin'}</span>}
        </div>

        <div className="sb-section-label row-between"><span>{locale === 'zh' ? '最近会话' : 'Recent Sessions'}</span></div>
        <div className="sb-recents">
          {recentRuns.map((run) => {
            const active = location.pathname === `/sessions/${run.id}`
            return (
              <NavLink key={run.id} to={`/sessions/${run.id}`} className={`sb-recent${run.favorite ? ' pinned' : ''}${active ? ' active' : ''}`} onClick={onClose}>
                {run.title}
              </NavLink>
            )
          })}
        </div>

        <div className="sb-user-wrap" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setAccountMenuOpen(false) }}>
          <button type="button" className="sb-user" aria-label={displayName} aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((value) => !value)}>
            <span className="avatar">{avatar}</span>
            <span className="user-info"><span className="user-name">{displayName}</span><span className="user-email">{role}</span></span>
          </button>
          {accountMenuOpen ? (
            <div className="prototype-user-menu">
              <span>{activeSpace.name}</span>
              <button type="button" onClick={() => { toggleLocale(); setAccountMenuOpen(false) }}>{locale === 'zh' ? 'Switch to English' : '切换到中文'}</button>
              {auth.mode === 'oidc' ? <button type="button" onClick={() => { void auth.signOut() }}>{locale === 'zh' ? '退出登录' : 'Sign out'}</button> : null}
            </div>
          ) : null}
        </div>
      </aside>
    </>
  )
}
