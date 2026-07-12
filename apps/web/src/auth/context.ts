import { createContext, useContext } from 'react'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'configuration_error'

export type AuthContextValue = {
  status: AuthStatus
  mode?: 'development' | 'oidc'
  actorId?: string
  displayName?: string
  organizationId?: string
  spaceId?: string
  demoMode: boolean
  accessToken?: string
  error?: string
  handleUnauthorized: () => Promise<void>
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider.')
  return value
}
