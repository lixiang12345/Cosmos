import { AlertTriangle, Building2, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/context'
import { usePreferences } from '../preferences'
import { useWorkspace } from './context'

export function WorkspaceGate({ children }: { children: ReactNode }) {
  const workspace = useWorkspace()
  const auth = useAuth()
  const { locale } = usePreferences()
  if (workspace.status === 'ready') return children

  const copy = locale === 'zh'
    ? {
        loading: '正在加载你的工作区...', emptyTitle: '尚未分配工作区',
        emptyBody: '你的身份已通过验证，但还没有任何 Organization 或 Space 权限。',
        errorTitle: '无法加载工作区', retry: '重试', signOut: '退出登录',
      }
    : {
        loading: 'Loading your Workspaces...', emptyTitle: 'No Workspace access',
        emptyBody: 'Your identity is verified, but no Organization or Space has been assigned yet.',
        errorTitle: 'Unable to load Workspaces', retry: 'Retry', signOut: 'Sign out',
      }

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-live="polite">
        <span className="auth-panel__mark"><Building2 aria-hidden="true" /></span>
        {workspace.status === 'loading' ? (
          <><span className="auth-spinner" aria-hidden="true" /><p>{copy.loading}</p></>
        ) : workspace.status === 'empty' ? (
          <>
            <h1>{copy.emptyTitle}</h1>
            <p>{copy.emptyBody}</p>
            {auth.mode === 'oidc' ? <button type="button" className="button button--secondary" onClick={() => { void auth.signOut() }}>{copy.signOut}</button> : null}
          </>
        ) : (
          <>
            <AlertTriangle aria-hidden="true" className="auth-panel__warning" />
            <h1>{copy.errorTitle}</h1>
            <p>{workspace.error}</p>
            <button type="button" className="button button--primary" onClick={workspace.refresh}>
              <RefreshCw aria-hidden="true" />{copy.retry}
            </button>
          </>
        )}
      </section>
    </main>
  )
}
