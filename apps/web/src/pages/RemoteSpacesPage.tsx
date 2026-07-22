import type { MeSpace, SpaceDto, SpaceMigrationPreview } from '@cosmos/contracts'
import {
  CheckCircle2,
  ChevronRight,
  CircleDot,
  LoaderCircle,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { GlobalControls } from '../components/GlobalControls'
import { IconButton } from '../components/ui'
import { usePreferences, type Locale } from '../preferences'
import {
  createSpace,
  listSpaces,
  previewSpaceMigration,
  setDefaultSpace,
  updateSpace,
  type CosmosApiAuthContext,
} from '../services/cosmosApi'

type Props = {
  organizationId: string
  accessibleSpaces: MeSpace[]
  activeSpaceId: string
  auth: CosmosApiAuthContext
  credentialVersion: number
  canManage: boolean
  onSelectSpace: (spaceId: string) => void
  onWorkspaceRefresh: () => void
  onOpenNavigation?: () => void
}

function copy(locale: Locale, zh: string, en: string) { return locale === 'zh' ? zh : en }
function key(prefix: string) { return `${prefix}-${crypto.randomUUID()}`.slice(0, 128) }
function date(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value))
}

function Header({ onOpenNavigation }: { onOpenNavigation?: () => void }) {
  const { locale } = usePreferences()
  return <header className="cosmos-page-header"><div className="cosmos-page-header__leading"><IconButton icon={Shield} label={copy(locale, '打开导航', 'Open navigation')} onClick={onOpenNavigation} /><div><p>Cosmos · Control Plane</p><h1>{copy(locale, 'Spaces', 'Spaces')}</h1><span>{copy(locale, '组织默认值与真实工作区边界', 'Organization defaults and the authoritative workspace boundary')}</span></div></div><GlobalControls /></header>
}

function SpaceEditor({ initial, busy, onCancel, onSave }: {
  initial: { name: string; description: string; defaultExpertId: string; defaultEnvironmentId: string }
  busy: boolean
  onCancel: () => void
  onSave: (value: typeof initial) => Promise<void>
}) {
  const { locale } = usePreferences()
  const [value, setValue] = useState(initial)
  const submit = (event: FormEvent) => { event.preventDefault(); void onSave(value) }
  return <form className="remote-space-editor cosmos-panel" onSubmit={submit}><header><div><p>{copy(locale, 'Space 设置', 'Space settings')}</p><h2>{copy(locale, '编辑工作区', 'Edit workspace')}</h2></div><IconButton icon={X} label={copy(locale, '关闭编辑器', 'Close editor')} onClick={onCancel} /></header><div className="remote-space-form-grid"><label><span>{copy(locale, '名称', 'Name')}</span><input required value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} /></label><label><span>{copy(locale, '描述', 'Description')}</span><input value={value.description} onChange={(event) => setValue({ ...value, description: event.target.value })} /></label><label><span>Default Expert ID</span><input placeholder="optional" value={value.defaultExpertId} onChange={(event) => setValue({ ...value, defaultExpertId: event.target.value })} /></label><label><span>Default Environment ID</span><input placeholder="optional" value={value.defaultEnvironmentId} onChange={(event) => setValue({ ...value, defaultEnvironmentId: event.target.value })} /></label></div><footer className="cosmos-form-actions"><button type="button" className="cosmos-button cosmos-button--ghost" onClick={onCancel}>{copy(locale, '取消', 'Cancel')}</button><button type="submit" className="cosmos-button cosmos-button--primary" disabled={busy}>{busy ? copy(locale, '保存中…', 'Saving…') : copy(locale, '保存 Space', 'Save Space')}</button></footer></form>
}

function MigrationPreview({ preview, onClose }: { preview: SpaceMigrationPreview; onClose: () => void }) {
  const { locale } = usePreferences()
  const counts = Object.entries(preview.resourceCounts)
  return <div className="remote-space-preview cosmos-panel"><header><div><p>{copy(locale, '删除前安全检查', 'Pre-delete safety check')}</p><h2>{preview.source.name} → {preview.target.name}</h2></div><IconButton icon={X} label={copy(locale, '关闭预览', 'Close preview')} onClick={onClose} /></header><p>{preview.canMigrate ? copy(locale, '迁移影响已计算；当前版本只提供预览，不会自动移动或删除资源。', 'Migration impact calculated; this release provides preview only and will not move or delete resources.') : copy(locale, '迁移被阻止，先解决以下边界条件。', 'Migration is blocked until the following conditions are resolved.')}</p><dl className="remote-space-counts">{counts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>{preview.blockingReasons.length ? <ul className="cosmos-field-error">{preview.blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p className="cosmos-inline-success"><CheckCircle2 aria-hidden="true" />{copy(locale, '没有发现阻塞条件。', 'No blocking conditions found.')}</p>}<small>{copy(locale, '真实迁移执行将在具备逐资源重写、幂等恢复和审计回滚后开放。', 'Execution will remain gated until per-resource rewrite, idempotent recovery, and audit rollback are available.')}</small></div>
}

export function RemoteSpacesPage(props: Props) {
  const { locale } = usePreferences()
  const [spaces, setSpaces] = useState<SpaceDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error>()
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<SpaceDto>()
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<SpaceMigrationPreview>()
  const [previewTarget, setPreviewTarget] = useState('')
  const reload = useCallback(() => {
    setLoading(true)
    void listSpaces(props.organizationId, props.auth).then((response) => { setSpaces(response.items); setError(undefined) }, (cause: unknown) => setError(cause instanceof Error ? cause : new Error('Unable to load Spaces.'))).finally(() => setLoading(false))
  }, [props.auth, props.organizationId])
  useEffect(() => {
    void Promise.resolve().then(reload)
  }, [props.credentialVersion, reload])
  const roleById = useMemo(() => new Map(props.accessibleSpaces.map((space) => [space.id, space.role])), [props.accessibleSpaces])
  const save = async (value: { name: string; description: string; defaultExpertId: string; defaultEnvironmentId: string }) => {
    setBusy(true)
    try {
      if (editing) {
        const next = await updateSpace(props.organizationId, editing.id, { name: value.name, description: value.description, defaultExpertId: value.defaultExpertId || null, defaultEnvironmentId: value.defaultEnvironmentId || null }, editing.version, key('space-update'), props.auth)
        setSpaces((items) => items.map((item) => item.id === next.id ? next : item)); setNotice(copy(locale, 'Space 已更新。', 'Space updated.'))
      } else {
        const next = await createSpace(props.organizationId, { name: value.name, description: value.description }, key('space-create'), props.auth)
        setSpaces((items) => [next, ...items]); setNotice(copy(locale, 'Space 已创建。', 'Space created.'))
      }
      setEditing(undefined); setCreating(false); props.onWorkspaceRefresh()
    } catch (cause) { setError(cause instanceof Error ? cause : new Error('Unable to save Space.')) } finally { setBusy(false) }
  }
  const chooseDefault = async (space: SpaceDto) => {
    setBusy(true)
    try {
      const next = await setDefaultSpace(props.organizationId, space.id, space.version, key('space-default'), props.auth)
      setSpaces((items) => items.map((item) => item.id === next.id ? next : { ...item, isDefault: false })); setNotice(copy(locale, 'Default Space 已切换。', 'Default Space changed.')); props.onWorkspaceRefresh()
    } catch (cause) { setError(cause instanceof Error ? cause : new Error('Unable to change the Default Space.')) } finally { setBusy(false) }
  }
  const runPreview = () => {
    if (!previewTarget || previewTarget === props.activeSpaceId) return
    setBusy(true); setError(undefined)
    void previewSpaceMigration(props.organizationId, props.activeSpaceId, previewTarget, props.auth).then(setPreview, (cause: unknown) => setError(cause instanceof Error ? cause : new Error('Unable to preview migration.'))).finally(() => setBusy(false))
  }
  const active = spaces.find((space) => space.id === props.activeSpaceId)
  const canManage = props.canManage
  return <main className="cosmos-page remote-space-page"><Header onOpenNavigation={props.onOpenNavigation} /><div className="cosmos-page__content">{notice ? <p className="cosmos-notice" role="status">{notice}</p> : null}{error ? <p className="cosmos-field-error" role="alert">{error.message}</p> : null}<section className="cosmos-section-heading"><div><p>{copy(locale, 'Organization / Space', 'Organization / Space')}</p><h2>{copy(locale, '工作区', 'Workspaces')}</h2></div>{canManage ? <button type="button" className="cosmos-button cosmos-button--primary" onClick={() => { setCreating(true); setEditing(undefined) }}><Plus aria-hidden="true" />{copy(locale, '创建 Space', 'Create Space')}</button> : null}</section>{creating ? <SpaceEditor initial={{ name: '', description: '', defaultExpertId: '', defaultEnvironmentId: '' }} busy={busy} onCancel={() => setCreating(false)} onSave={save} /> : null}{editing ? <SpaceEditor initial={{ name: editing.name, description: editing.description, defaultExpertId: editing.defaultExpertId ?? '', defaultEnvironmentId: editing.defaultEnvironmentId ?? '' }} busy={busy} onCancel={() => setEditing(undefined)} onSave={save} /> : null}{loading ? <p className="cosmos-empty-state"><LoaderCircle className="spin" aria-hidden="true" />{copy(locale, '加载中…', 'Loading…')}</p> : !spaces.length ? <p className="cosmos-empty-state">{copy(locale, '当前 Organization 没有可访问的 Space。', 'No accessible Spaces in this Organization.')}</p> : <div className="remote-space-list">{spaces.map((space) => <article className={`cosmos-panel remote-space-card${space.id === props.activeSpaceId ? ' remote-space-card--active' : ''}`} key={space.id}><header><div><p>{space.slug} · {roleById.get(space.id) ?? copy(locale, '成员', 'Member')}</p><h2>{space.name}{space.isDefault ? <span className="remote-space-default"><Sparkles aria-hidden="true" />{copy(locale, '默认', 'Default')}</span> : null}</h2></div><span className={`remote-space-status remote-space-status--${space.status}`}><CircleDot aria-hidden="true" />{space.status}</span></header><p>{space.description || copy(locale, '尚未填写描述。', 'No description yet.')}</p><small>{copy(locale, '更新于', 'Updated')} {date(space.updatedAt, locale)}</small><footer className="cosmos-form-actions"><button type="button" className="cosmos-button cosmos-button--primary" onClick={() => props.onSelectSpace(space.id)} disabled={space.id === props.activeSpaceId}>{space.id === props.activeSpaceId ? copy(locale, '当前 Space', 'Current Space') : copy(locale, '切换到此 Space', 'Switch to Space')}<ChevronRight aria-hidden="true" /></button>{canManage && roleById.get(space.id) !== 'viewer' ? <><button type="button" className="cosmos-button cosmos-button--secondary" onClick={() => { setEditing(space); setCreating(false) }} disabled={busy}>{copy(locale, '编辑', 'Edit')}</button>{!space.isDefault ? <button type="button" className="cosmos-button cosmos-button--ghost" onClick={() => void chooseDefault(space)} disabled={busy}>{copy(locale, '设为默认', 'Make default')}</button> : null}</> : null}</footer></article>)}</div>}{active && canManage && spaces.length > 1 ? <section className="remote-space-migration cosmos-panel"><header><div><p>{copy(locale, '迁移影响预览', 'Migration impact preview')}</p><h2>{copy(locale, '删除前选择迁移目标', 'Choose a target before deleting')}</h2></div></header><div className="remote-space-migration__controls"><select aria-label={copy(locale, '迁移目标 Space', 'Migration target Space')} value={previewTarget} onChange={(event) => setPreviewTarget(event.target.value)}><option value="">{copy(locale, '选择目标 Space', 'Select target Space')}</option>{spaces.filter((space) => space.id !== active.id).map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select><button type="button" className="cosmos-button cosmos-button--secondary" onClick={runPreview} disabled={!previewTarget || busy}><RefreshCw aria-hidden="true" />{copy(locale, '计算影响', 'Calculate impact')}</button></div></section> : null}{preview ? <MigrationPreview preview={preview} onClose={() => setPreview(undefined)} /> : null}{!loading ? <button type="button" className="cosmos-button cosmos-button--ghost" onClick={reload}><RefreshCw aria-hidden="true" />{copy(locale, '刷新', 'Refresh')}</button> : null}</div></main>
}
