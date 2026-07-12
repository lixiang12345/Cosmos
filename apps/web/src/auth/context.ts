import { createContext, useContext } from 'react'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'configuration_error'

export type AuthContextValue = {
  status: AuthStatus
  mode?: 'development' | 'oidc'
  actorId?: string
  displayName?: string
  demoMode: boolean
  accessToken?: string
  credentialVersion: number
  error?: string
  handleUnauthorized: (failedAccessToken: string | undefined) => Promise<void>
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider.')
  return value
}
