import type { SessionDto, SessionMessageDto, SessionStatus } from '@cosmos/contracts'
import { useState } from 'react'
import { RemoteSessionWorkbench } from '../session/RemoteSessionWorkbench'
import { usePreferences } from '../../preferences'
import type { Run } from '../../types'

type RunWorkbenchProps = {
  run: Run
  onOpenNavigation: () => void
  navigationCollapsed?: boolean
  onOpenCommand?: () => void
  onBack?: () => void
  onDecision: (runId: string, decision: 'approved' | 'changes') => void
  onRetry: (runId: string) => void
  onPause: (runId: string) => void
  onStop: (runId: string) => void
}

function safeTimestamp(value: string) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString()
}

function sessionStatus(run: Run): SessionStatus {
  if (run.status === 'running') return 'active'
  return run.status
}

function demoSession(run: Run): SessionDto {
  const timestamp = safeTimestamp(run.updatedAt)
  return {
    id: run.id,
    organizationId: 'demo-organization',
    spaceId: run.spaceId ?? 'demo-space',
    title: run.title,
    summary: run.summary,
    expertId: run.expertId ?? 'demo-expert',
    expertName: run.expert,
    expertVersion: run.expertVersion,
    environmentId: run.environmentId,
    configurationResolutionVersion: 0,
    repository: run.repo,
    baseBranch: run.baseBranch ?? run.branch,
    visibility: run.visibility ?? 'private',
    status: sessionStatus(run),
    attachments: run.attachments ?? [],
    source: run.source ?? 'manual',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    archivedAt: run.archived ? timestamp : null,
    version: run.serverVersion ?? 1,
  }
}

function demoMessages(run: Run): SessionMessageDto[] {
  const timestamp = safeTimestamp(run.updatedAt)
  return run.events.map((event, index) => ({
    id: event.id,
    organizationId: 'demo-organization',
    spaceId: run.spaceId ?? 'demo-space',
    sessionId: run.id,
    sequence: index + 1,
    role: event.kind === 'request' ? 'user' : event.kind === 'tool' ? 'tool' : 'agent',
    actorId: event.actor || null,
    content: event.kind === 'tool' ? `${event.title}\n${event.body}` : event.body,
    attachments: [],
    createdAt: Number.isFinite(Date.parse(event.timestamp)) ? new Date(event.timestamp).toISOString() : timestamp,
  }))
}

export function RunWorkbench({
  run,
  onOpenNavigation,
  navigationCollapsed = false,
  onOpenCommand,
  onBack = () => undefined,
  onDecision,
  onRetry,
  onPause,
  onStop,
}: RunWorkbenchProps) {
  const { locale } = usePreferences()
  const [queuedMessages, setQueuedMessages] = useState<SessionMessageDto[]>([])
  const session = demoSession(run)
  const localize = (zh: string, en: string) => locale === 'zh' ? zh : en
  const messages = [...demoMessages(run), ...queuedMessages]

  const sendMessage = async (content: string) => {
    setQueuedMessages((current) => [...current, {
      id: `demo-message-${run.id}-${messages.length + 1}`,
      organizationId: session.organizationId,
      spaceId: session.spaceId,
      sessionId: session.id,
      sequence: messages.length + 1,
      role: 'user',
      actorId: 'demo-user',
      content,
      attachments: [],
      createdAt: new Date().toISOString(),
    }])
  }

  const approvalPanel = run.approval ? (
    <section className="prototype-demo-approval" aria-label={localize('审批', 'Approval')}>
      <header><span>{localize('策略决策', 'Policy decision')}</span><strong>{run.approval.title}</strong><em>{run.approval.risk}</em></header>
      <p>{run.approval.recommendation}</p>
      <ul>{run.approval.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      {run.status === 'waiting' ? <footer><button type="button" onClick={() => onDecision(run.id, 'changes')}>{localize('请求更改', 'Request changes')}</button><button type="button" className="primary" onClick={() => onDecision(run.id, 'approved')}>{localize('批准并继续', 'Approve and continue')}</button></footer> : <span>{localize('决策已记录', 'Decision recorded')}</span>}
    </section>
  ) : null

  return (
    <RemoteSessionWorkbench
      session={session}
      messages={messages}
      events={[]}
      timelineStatus="ready"
      executionEnabled={run.status !== 'completed' && run.status !== 'canceled'}
      onSend={sendMessage}
      onPause={() => onPause(run.id)}
      onResume={() => onPause(run.id)}
      onCancel={() => onStop(run.id)}
      onRetry={run.status === 'failed' ? () => onRetry(run.id) : undefined}
      onBack={onBack}
      onOpenNavigation={onOpenNavigation}
      navigationCollapsed={navigationCollapsed}
      onOpenCommand={onOpenCommand}
      embeddedPanel={approvalPanel}
      localFiles={run.files.map((file) => ({ path: file.path, detail: `${file.status} · +${file.additions} −${file.deletions}` }))}
      localArtifacts={(run.artifacts ?? []).map((artifact) => ({ id: artifact.id, label: artifact.label, type: artifact.type, status: artifact.status }))}
      terminalLines={run.terminal}
    />
  )
}
