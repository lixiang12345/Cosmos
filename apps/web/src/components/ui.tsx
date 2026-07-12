import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { usePreferences, type TranslationKey } from '../preferences'
import type { RunStatus } from '../types'

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  label: string
  size?: 'sm' | 'md'
}

export function IconButton({ icon: Icon, label, size = 'md', className = '', ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button icon-button--${size} ${className}`.trim()}
      aria-label={label}
      data-tooltip={label}
      {...props}
    >
      <Icon aria-hidden="true" />
    </button>
  )
}

const statusLabels: Record<RunStatus, TranslationKey> = {
  draft: 'status.draft',
  queued: 'status.queued',
  running: 'status.running',
  paused: 'status.paused',
  waiting: 'status.waiting',
  completed: 'status.completed',
  failed: 'status.failed',
  canceled: 'status.canceled',
}

export function StatusBadge({ status }: { status: RunStatus }) {
  const { t } = usePreferences()
  return (
    <span className={`status-badge status-badge--${status}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {t(statusLabels[status])}
    </span>
  )
}

export function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="section-title">
      <div>
        {eyebrow ? <p className="section-title__eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  )
}
