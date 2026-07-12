import { AlertTriangle, LogIn, Orbit } from 'lucide-react'
import type { ReactNode } from 'react'
import { usePreferences } from '../preferences'
import { useAuth } from './context'

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const { locale } = usePreferences()
  if (auth.status === 'authenticated') return children

  const copy = locale === 'zh'
    ? {
        loading: '正在恢复安全会话...', title: '登录 Relay',
        body: '使用组织身份登录后继续访问你的 Space 和 Sessions。',
        signIn: '使用 SSO 登录', config: '身份配置不可用',
      }
    : {
        loading: 'Restoring your secure session...', title: 'Sign in to Relay',
        body: 'Use your organization identity to access your Spaces and Sessions.',
        signIn: 'Sign in with SSO', config: 'Identity configuration unavailable',
      }

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-live="polite">
        <span className="auth-panel__mark"><Orbit aria-hidden="true" /></span>
        {auth.status === 'loading' ? (
          <><span className="auth-spinner" aria-hidden="true" /><p>{copy.loading}</p></>
        ) : auth.status === 'configuration_error' ? (
          <>
            <AlertTriangle aria-hidden="true" className="auth-panel__warning" />
            <h1>{copy.config}</h1>
            <p>{auth.error}</p>
          </>
        ) : (
          <>
            <h1>{copy.title}</h1>
            <p>{copy.body}</p>
            <button type="button" className="button button--primary auth-sign-in" onClick={() => { void auth.signIn() }}>
              <LogIn aria-hidden="true" />{copy.signIn}
            </button>
          </>
        )}
      </section>
    </main>
  )
}
