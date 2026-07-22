import type { ApprovalDecisionValue, ApprovalDto, ApprovalStatus } from '@cosmos/contracts'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  Inbox,
  LoaderCircle,
  Menu,
  Pencil,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GlobalControls } from '../components/GlobalControls'
import { IconButton } from '../components/ui'
import { usePreferences, type Locale } from '../preferences'
import {
  CosmosApiError,
  decideApproval,
  listApprovals,
  type CosmosApiAuthContext,
} from '../services/cosmosApi'

export type RemoteApprovalsPageProps = {
  organizationId: string
  spaceId: string
  auth: CosmosApiAuthContext
  credentialVersion: number
  onOpenNavigation?: () => void
  onOpenSession: (sessionId: string) => void
}

type View = 'pending' | 'assigned' | 'all'
type Snapshot = {
  identity: string
  status: 'ready' | 'error'
  items: ApprovalDto[]
  nextCursor: string | null
  loadingMore: boolean
  fetchedAt: number
  error?: Error
}

function text(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en
}

function errorValue(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause : new Error(fallback)
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function riskLabel(locale: Locale, risk: ApprovalDto['riskLevel']) {
  return {
    low: text(locale, '低风险', 'Low risk'),
    medium: text(locale, '中风险', 'Medium risk'),
    high: text(locale, '高风险', 'High risk'),
    critical: text(locale, '关键风险', 'Critical risk'),
  }[risk]
}

function statusLabel(locale: Locale, status: ApprovalStatus) {
  return {
    pending: text(locale, '待决策', 'Pending'),
    approved: text(locale, '已批准', 'Approved'),
    changes_requested: text(locale, '要求修改', 'Changes requested'),
    rejected: text(locale, '已拒绝', 'Rejected'),
    expired: text(locale, '已过期', 'Expired'),
    canceled: text(locale, '已取消', 'Canceled'),
  }[status]
}

function makeIdempotencyKey(approvalId: string, version: number, decision: ApprovalDecisionValue) {
  const entropy = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `approval:${approvalId}:${version}:${decision}:${entropy}`.slice(0, 128)
}

export function RemoteApprovalsPage({
  organizationId,
  spaceId,
  auth,
  credentialVersion,
  onOpenNavigation,
  onOpenSession,
}: RemoteApprovalsPageProps) {
  const { locale } = usePreferences()
  const requestAuth = useMemo<CosmosApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: auth.requestIdentity,
    onUnauthorized: auth.onUnauthorized,
  }), [auth.accessToken, auth.onUnauthorized, auth.requestIdentity])
  const [view, setView] = useState<View>('pending')
  const [retryVersion, setRetryVersion] = useState(0)
  const identity = [organizationId, spaceId, credentialVersion, view, retryVersion].join('\u0000')
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const current = snapshot?.identity === identity ? snapshot : undefined
  const [selectedId, setSelectedId] = useState<string>()
  const items = useMemo(() => current?.items ?? [], [current])
  const selected = items.find(({ id }) => id === selectedId) ?? items[0]
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState<ApprovalDecisionValue>()
  const keys = useRef(new Map<string, string>())

  const options = useMemo(() => ({
    limit: 100,
    status: view === 'all' ? undefined : 'pending' as const,
    assignedToMe: view === 'assigned' ? true : undefined,
  }), [view])

  useEffect(() => {
    const controller = new AbortController()
    void listApprovals(
      organizationId, spaceId, options, requestAuth, controller.signal,
    ).then((page) => {
      if (!controller.signal.aborted) setSnapshot({
        identity,
        status: 'ready',
        items: page.items,
        nextCursor: page.page.nextCursor,
        loadingMore: false,
        fetchedAt: Date.now(),
      })
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setSnapshot({
        identity,
        status: 'error',
        items: [],
        nextCursor: null,
        loadingMore: false,
        fetchedAt: Date.now(),
        error: errorValue(cause, 'Unable to load Approvals.'),
      })
    })
    return () => { controller.abort() }
  }, [identity, options, organizationId, requestAuth, spaceId])

  const refresh = useCallback(() => setRetryVersion((version) => version + 1), [])

  const loadMore = () => {
    if (!current?.nextCursor || current.loadingMore) return
    setSnapshot({ ...current, loadingMore: true })
    void listApprovals(
      organizationId,
      spaceId,
      { ...options, cursor: current.nextCursor },
      requestAuth,
    ).then((page) => setSnapshot((value) => value?.identity === identity ? {
      ...value,
      status: 'ready',
      items: [...value.items, ...page.items],
      nextCursor: page.page.nextCursor,
      loadingMore: false,
    } : value), (cause: unknown) => setSnapshot((value) => value?.identity === identity ? {
      ...value,
      loadingMore: false,
      error: errorValue(cause, 'Unable to load more Approvals.'),
    } : value))
  }

  const decide = async (decision: ApprovalDecisionValue) => {
    if (!selected || submitting || selected.status !== 'pending') return
    if (decision !== 'approved' && !note.trim()) return
    const keyScope = `${selected.id}:${selected.version}:${decision}`
    const idempotencyKey = keys.current.get(keyScope)
      ?? makeIdempotencyKey(selected.id, selected.version, decision)
    keys.current.set(keyScope, idempotencyKey)
    setSubmitting(decision)
    setNotice('')
    try {
      const updated = await decideApproval(
        organizationId,
        spaceId,
        selected.id,
        { decision, note: note.trim() || undefined },
        selected.version,
        idempotencyKey,
        requestAuth,
      )
      keys.current.delete(keyScope)
      setSnapshot((value) => value?.identity === identity ? {
        ...value,
        items: view === 'all' || updated.status === 'pending'
          ? value.items.map((item) => item.id === updated.id ? updated : item)
          : value.items.filter((item) => item.id !== updated.id),
      } : value)
      setNote('')
      setNotice(updated.status === 'pending'
        ? text(locale, '你的批准已记录，仍在等待另一位审批人。', 'Your approval was recorded; another approver is still required.')
        : text(locale, '决策已记录，门禁状态已更新。', 'Decision recorded and the gate was updated.'))
    } catch (cause) {
      if (cause instanceof CosmosApiError && [409, 412].includes(cause.status ?? 0)) refresh()
      setNotice(errorValue(cause, 'Unable to record the Approval decision.').message)
    } finally {
      setSubmitting(undefined)
    }
  }

  const pendingCount = items.filter(({ status }) => status === 'pending').length
  const assignedCount = items.filter(({ assignedTo }) => assignedTo.includes(auth.requestIdentity?.split('\u0000')[0] ?? '')).length
  const urgentCount = items.filter(({ status, riskLevel }) => status === 'pending' && ['high', 'critical'].includes(riskLevel)).length
  const dueSoonCount = items.filter(({ status, expiresAt }) => (
    status === 'pending' && Date.parse(expiresAt) - (current?.fetchedAt ?? 0) < 60 * 60 * 1_000
  )).length
  const alreadyDecided = selected?.actorHasDecided ?? false
  const canDecide = selected?.status === 'pending' && !alreadyDecided

  return (
    <main className="cosmos-page cosmos-approvals-page remote-approvals-page">
      <header className="cosmos-page-header">
        <div className="cosmos-page-header__identity">
          <IconButton icon={Menu} label={text(locale, '打开导航', 'Open navigation')} className="cosmos-mobile-menu" onClick={onOpenNavigation} />
          <span className="cosmos-page-header__icon"><ShieldCheck aria-hidden="true" /></span>
          <div><h1>{text(locale, '审批', 'Approvals')}</h1><p>{organizationId} / {spaceId}</p></div>
        </div>
        <div className="cosmos-page-header__actions">
          <GlobalControls className="cosmos-global-controls" />
          <IconButton icon={RefreshCw} label={text(locale, '刷新审批', 'Refresh Approvals')} onClick={refresh} />
        </div>
      </header>

      <div className="cosmos-page__content">
        {notice ? <div className="cosmos-notice" role="status"><CheckCircle2 aria-hidden="true" /><span>{notice}</span></div> : null}
        <section className="cosmos-approval-metrics" aria-label={text(locale, '审批概览', 'Approval overview')}>
          <article><Clock3 aria-hidden="true" /><span>{text(locale, '当前待处理', 'Pending')}</span><strong>{pendingCount}</strong></article>
          <article><Inbox aria-hidden="true" /><span>{text(locale, '指派给我', 'Assigned to me')}</span><strong>{assignedCount}</strong></article>
          <article><AlertTriangle aria-hidden="true" /><span>{text(locale, '高风险', 'High risk')}</span><strong>{urgentCount}</strong></article>
          <article><ShieldCheck aria-hidden="true" /><span>{text(locale, '一小时内到期', 'Due within 1h')}</span><strong>{dueSoonCount}</strong></article>
        </section>

        <div className="remote-approvals-toolbar">
          <div className="cosmos-segmented-control" role="tablist" aria-label={text(locale, '审批视图', 'Approval view')}>
            {([
              ['pending', text(locale, '待处理', 'Pending')],
              ['assigned', text(locale, '指派给我', 'Assigned to me')],
              ['all', text(locale, '全部', 'All')],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'cosmos-segmented-control__active' : ''} onClick={() => { setView(id); setSelectedId(undefined); setNote('') }}>{label}</button>
            ))}
          </div>
        </div>

        <div className="cosmos-approvals-layout">
          <section className="cosmos-approval-inbox" aria-labelledby="remote-approval-inbox-title">
            <div className="cosmos-section-heading"><div><p>{text(locale, '决策收件箱', 'Decision inbox')}</p><h2 id="remote-approval-inbox-title">{text(locale, '治理请求', 'Governed requests')}</h2></div><strong>{items.length}</strong></div>
            <div className="cosmos-approval-list">
              {!current ? <div className="remote-approvals-state" role="status"><LoaderCircle className="cosmos-spin" aria-hidden="true" />{text(locale, '正在加载审批…', 'Loading Approvals…')}</div> : null}
              {current?.status === 'error' ? <div className="remote-approvals-state remote-approvals-state--error" role="alert"><AlertTriangle aria-hidden="true" /><span>{current.error?.message}</span><button type="button" onClick={refresh}><RefreshCw aria-hidden="true" />{text(locale, '重试', 'Retry')}</button></div> : null}
              {current?.status === 'ready' ? items.map((approval) => (
                <button type="button" className={`cosmos-approval-row${approval.id === selected?.id ? ' cosmos-approval-row--active' : ''}`} key={approval.id} onClick={() => { setSelectedId(approval.id); setNote('') }}>
                  <AlertTriangle aria-hidden="true" />
                  <span><strong>{approval.action}</strong><small>{approval.toolCallId} · {formatDate(approval.expiresAt, locale)}</small></span>
                  <span className={`cosmos-status cosmos-status--${approval.status}`}>{statusLabel(locale, approval.status)}</span>
                </button>
              )) : null}
              {current?.status === 'ready' && !items.length ? <p className="cosmos-empty-state">{text(locale, '当前没有可见审批', 'No visible Approvals')}</p> : null}
              {current?.nextCursor ? <button type="button" className="remote-approvals-load-more" disabled={current.loadingMore} onClick={loadMore}>{current.loadingMore ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}{text(locale, '加载更多', 'Load more')}</button> : null}
            </div>
          </section>

          <section className="cosmos-approval-detail" aria-labelledby="remote-approval-detail-title">
            {selected ? <>
              <header>
                <div><p>{selected.id}</p><h2 id="remote-approval-detail-title">{selected.action}</h2><span>{selected.toolCallId} · {selected.sessionId}</span></div>
                <span className={`cosmos-status cosmos-status--${selected.riskLevel}`}>{riskLabel(locale, selected.riskLevel)}</span>
              </header>
              <dl className="remote-approval-metadata">
                <div><dt>{text(locale, '状态', 'Status')}</dt><dd>{statusLabel(locale, selected.status)}</dd></div>
                <div><dt>{text(locale, '审批进度', 'Approval progress')}</dt><dd>{selected.approvalCount} / {selected.requiredApprovals}</dd></div>
                <div><dt>{text(locale, '请求人', 'Requested by')}</dt><dd>{selected.requestedBy}</dd></div>
                <div><dt>{text(locale, '到期时间', 'Expires')}</dt><dd>{formatDate(selected.expiresAt, locale)}</dd></div>
              </dl>
              <section className="remote-approval-reasons">
                <h3>{text(locale, '需要审批的原因', 'Why approval is required')}</h3>
                <ul>{selected.reasons.map((reason) => <li key={reason}><Check aria-hidden="true" />{reason}</li>)}</ul>
              </section>
              <section>
                <h3>{text(locale, '决策证据', 'Decision evidence')}</h3>
                <div className="cosmos-approval-evidence">
                  {selected.evidence.map((evidence, index) => <div key={`${evidence.type}:${evidence.label}:${index}`}><span>{evidence.type}</span><strong>{evidence.label}</strong><p>{evidence.value}</p></div>)}
                  {!selected.evidence.length ? <p className="cosmos-empty-state">{text(locale, '没有附加证据', 'No additional evidence')}</p> : null}
                </div>
              </section>
              {selected.status === 'pending' ? <label className="cosmos-approval-note">
                {text(locale, '决策说明', 'Decision note')}
                <textarea rows={4} maxLength={5000} value={note} onChange={(event) => setNote(event.target.value)} disabled={!canDecide || Boolean(submitting)} placeholder={text(locale, '拒绝或要求修改时必须说明原因', 'A note is required for rejection or requested changes')} />
              </label> : selected.decisionNote ? <section className="remote-approval-decision"><h3>{text(locale, '最终决定', 'Final decision')}</h3><p>{selected.decisionNote}</p><small>{selected.decidedBy} · {selected.decidedAt ? formatDate(selected.decidedAt, locale) : ''}</small></section> : null}
              <div className="cosmos-form-actions cosmos-form-actions--split remote-approval-actions">
                <button type="button" className="cosmos-button cosmos-button--ghost" onClick={() => onOpenSession(selected.sessionId)}><ExternalLink aria-hidden="true" />{text(locale, '查看完整会话', 'Open Session')}</button>
                {selected.status === 'pending' ? <div>
                  <button type="button" className="cosmos-button cosmos-button--ghost remote-approval-reject" disabled={!canDecide || !note.trim() || Boolean(submitting)} onClick={() => { void decide('rejected') }}>{submitting === 'rejected' ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : <X aria-hidden="true" />}{text(locale, '拒绝', 'Reject')}</button>
                  <button type="button" className="cosmos-button cosmos-button--secondary" disabled={!canDecide || !note.trim() || Boolean(submitting)} onClick={() => { void decide('changes_requested') }}>{submitting === 'changes_requested' ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : <Pencil aria-hidden="true" />}{text(locale, '要求修改', 'Request changes')}</button>
                  <button type="button" className="cosmos-button cosmos-button--primary" disabled={!canDecide || Boolean(submitting)} onClick={() => { void decide('approved') }}>{submitting === 'approved' ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}{text(locale, '批准并继续', 'Approve and continue')}</button>
                </div> : null}
              </div>
              {alreadyDecided && selected.status === 'pending' ? <p className="remote-approval-waiting"><Clock3 aria-hidden="true" />{text(locale, '你的决定已记录，等待其他审批人。', 'Your decision is recorded; waiting for other approvers.')}</p> : null}
            </> : <div className="remote-approvals-empty"><ShieldCheck aria-hidden="true" /><h2>{text(locale, '没有待处理决策', 'No decisions waiting')}</h2></div>}
          </section>
        </div>
      </div>
    </main>
  )
}
