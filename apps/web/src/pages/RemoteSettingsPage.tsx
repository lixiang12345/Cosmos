import type { MeResponse, MeOrganization, MeSpace, OrganizationRole, SpaceRole } from '@cosmos/contracts'
import {
  Building2,
  ChevronRight,
  Languages,
  Moon,
  Paintbrush,
  ShieldCheck,
  Sun,
  SunMoon,
  UserRound,
} from 'lucide-react'
import { useState } from 'react'
import { GlobalControls } from '../components/GlobalControls'
import { IconButton } from '../components/ui'
import { usePreferences, type Locale } from '../preferences'

type SettingsSection = 'account' | 'organization' | 'appearance'

type Props = {
  me: MeResponse
  organization: MeOrganization
  activeSpaceId: string
  onOpenNavigation?: () => void
}

function copy(locale: Locale, zh: string, en: string) { return locale === 'zh' ? zh : en }

function organizationRoleLabel(locale: Locale, role: OrganizationRole) {
  switch (role) {
    case 'organization_owner': return copy(locale, '组织所有者', 'Organization owner')
    case 'organization_admin': return copy(locale, '组织管理员', 'Organization admin')
    case 'member': return copy(locale, '成员', 'Member')
    case 'viewer': return copy(locale, '只读成员', 'Viewer')
  }
}

function spaceRoleLabel(locale: Locale, role: SpaceRole) {
  switch (role) {
    case 'space_manager': return copy(locale, 'Space 管理员', 'Space manager')
    case 'member': return copy(locale, '成员', 'Member')
    case 'viewer': return copy(locale, '只读成员', 'Viewer')
  }
}

function actorKindLabel(locale: Locale, kind: MeResponse['actor']['kind']) {
  return kind === 'service_account'
    ? copy(locale, '服务账号', 'Service account')
    : copy(locale, '用户', 'User')
}

function Header({ onOpenNavigation }: { onOpenNavigation?: () => void }) {
  const { locale } = usePreferences()
  return (
    <header className="cosmos-page-header">
      <div className="cosmos-page-header__leading">
        <IconButton icon={ShieldCheck} label={copy(locale, '打开导航', 'Open navigation')} onClick={onOpenNavigation} />
        <div>
          <p>Cosmos · Control Plane</p>
          <h1>{copy(locale, '设置', 'Settings')}</h1>
          <span>{copy(locale, '账号身份、组织成员关系与界面偏好', 'Account identity, organization membership, and interface preferences')}</span>
        </div>
      </div>
      <GlobalControls />
    </header>
  )
}

export function RemoteSettingsPage({ me, organization, activeSpaceId, onOpenNavigation }: Props) {
  const { locale, theme, setLocale, setTheme } = usePreferences()
  const [section, setSection] = useState<SettingsSection>('account')

  const sections: Array<{ id: SettingsSection; icon: typeof UserRound; zh: string; en: string }> = [
    { id: 'account', icon: UserRound, zh: '账号', en: 'Account' },
    { id: 'organization', icon: Building2, zh: '组织与 Space', en: 'Organization & Spaces' },
    { id: 'appearance', icon: Paintbrush, zh: '外观与语言', en: 'Appearance & language' },
  ]

  const spaces: MeSpace[] = organization.spaces

  return (
    <main className="cosmos-page">
      <Header onOpenNavigation={onOpenNavigation} />
      <div className="cosmos-page__scroll">
        <div className="cosmos-settings-layout">
          <nav className="cosmos-settings-nav" aria-label={copy(locale, '设置分类', 'Settings categories')}>
            {sections.map((item) => {
              const Icon = item.icon
              return (
                <button
                  type="button"
                  className={section === item.id ? 'cosmos-settings-nav__item cosmos-settings-nav__item--active' : 'cosmos-settings-nav__item'}
                  aria-pressed={section === item.id}
                  onClick={() => setSection(item.id)}
                  key={item.id}
                >
                  <Icon aria-hidden="true" />{copy(locale, item.zh, item.en)}<ChevronRight aria-hidden="true" />
                </button>
              )
            })}
          </nav>
          <section className="cosmos-panel cosmos-settings-panel">
            {section === 'account' ? (
              <>
                <header className="cosmos-section-heading">
                  <div><span>{copy(locale, '账号', 'Account')}</span><h2>{copy(locale, '身份信息', 'Identity')}</h2></div>
                </header>
                <div className="cosmos-detail-list">
                  <div><span>{copy(locale, '账号标识', 'Actor ID')}</span><strong><code>{me.actor.id}</code></strong></div>
                  <div><span>{copy(locale, '账号类型', 'Actor kind')}</span><strong>{actorKindLabel(locale, me.actor.kind)}</strong></div>
                  <div><span>{copy(locale, '可访问组织', 'Organizations')}</span><strong>{me.organizations.length}</strong></div>
                </div>
                <div className="cosmos-settings-entry">
                  <div>
                    <ShieldCheck aria-hidden="true" />
                    <span>
                      <strong>{copy(locale, '账号安全', 'Account security')}</strong>
                      <p>{copy(locale, '登录方式与令牌由身份提供方管理，请在你的 IdP 控制台完成变更。', 'Sign-in methods and tokens are managed by your identity provider; make changes in your IdP console.')}</p>
                    </span>
                  </div>
                </div>
              </>
            ) : null}
            {section === 'organization' ? (
              <>
                <header className="cosmos-section-heading">
                  <div><span>{copy(locale, '组织', 'Organization')}</span><h2>{organization.name}</h2></div>
                </header>
                <div className="cosmos-detail-list">
                  <div><span>{copy(locale, '组织标识', 'Organization ID')}</span><strong><code>{organization.id}</code></strong></div>
                  <div><span>{copy(locale, '当前角色', 'Current role')}</span><strong>{organizationRoleLabel(locale, organization.role)}</strong></div>
                  <div><span>{copy(locale, '可访问 Space', 'Accessible Spaces')}</span><strong>{spaces.length}</strong></div>
                </div>
                <section className="remote-detail-section">
                  <header><Building2 aria-hidden="true" /><h3>{copy(locale, 'Space 成员关系', 'Space membership')}</h3></header>
                  <ul className="cosmos-settings-space-list">
                    {spaces.map((space) => (
                      <li className={space.id === activeSpaceId ? 'cosmos-settings-space-row cosmos-settings-space-row--active' : 'cosmos-settings-space-row'} key={space.id}>
                        <span className="cosmos-settings-space-row__identity">
                          <strong>{space.name}</strong>
                          <small>{spaceRoleLabel(locale, space.role)}{space.isDefault ? copy(locale, ' · 默认', ' · Default') : ''}</small>
                        </span>
                        {space.id === activeSpaceId ? <span className="cosmos-status-label cosmos-status-label--ok">{copy(locale, '当前', 'Active')}</span> : null}
                      </li>
                    ))}
                  </ul>
                  <small>{copy(locale, '成员与权限变更在“组织成员”管理界面进行；此处仅展示你当前的成员关系。', 'Member and permission changes happen in organization administration; this view shows your current membership only.')}</small>
                </section>
              </>
            ) : null}
            {section === 'appearance' ? (
              <>
                <header className="cosmos-section-heading">
                  <div><span>{copy(locale, '界面', 'Interface')}</span><h2>{copy(locale, '外观与语言', 'Appearance & language')}</h2></div>
                </header>
                <div className="cosmos-preference-list">
                  <div className="cosmos-preference-row">
                    <span className="cosmos-preference-row__identity">
                      <SunMoon aria-hidden="true" />
                      <span><strong>{copy(locale, '主题', 'Theme')}</strong><small>{copy(locale, '立即应用并持久化到当前浏览器。', 'Applies immediately and persists in this browser.')}</small></span>
                    </span>
                    <div className="cosmos-preference-segmented" role="group" aria-label={copy(locale, '主题', 'Theme')}>
                      <button type="button" className={theme === 'light' ? 'cosmos-preference-segmented__button cosmos-preference-segmented__button--active' : 'cosmos-preference-segmented__button'} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
                        <Sun aria-hidden="true" />{copy(locale, '浅色', 'Light')}
                      </button>
                      <button type="button" className={theme === 'dark' ? 'cosmos-preference-segmented__button cosmos-preference-segmented__button--active' : 'cosmos-preference-segmented__button'} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
                        <Moon aria-hidden="true" />{copy(locale, '深色', 'Dark')}
                      </button>
                    </div>
                  </div>
                  <label className="cosmos-preference-row">
                    <span className="cosmos-preference-row__identity">
                      <Languages aria-hidden="true" />
                      <span><strong>{copy(locale, '语言', 'Language')}</strong><small>{copy(locale, '切换整个界面的显示语言。', 'Switches the interface language across the app.')}</small></span>
                    </span>
                    <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
                      <option value="zh">简体中文</option>
                      <option value="en">English</option>
                    </select>
                  </label>
                </div>
              </>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  )
}
