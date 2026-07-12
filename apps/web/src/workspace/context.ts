import type { MeOrganization, MeResponse, MeSpace } from '@relay/contracts'
import { createContext, useContext } from 'react'

export type WorkspaceStatus = 'loading' | 'ready' | 'empty' | 'error'

export type WorkspaceContextValue = {
  status: WorkspaceStatus
  me?: MeResponse
  activeOrganization?: MeOrganization
  activeSpace?: MeSpace
  error?: string
  selectSpace: (organizationId: string, spaceId: string) => void
  refresh: () => void
}

export type ActiveWorkspace = {
  me: MeResponse
  organization: MeOrganization
  space: MeSpace
  selectSpace: WorkspaceContextValue['selectSpace']
}

export const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined)

export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider.')
  return value
}

export function useActiveWorkspace(): ActiveWorkspace {
  const workspace = useWorkspace()
  if (workspace.status !== 'ready' || !workspace.me || !workspace.activeOrganization || !workspace.activeSpace) {
    throw new Error('An active Workspace is required.')
  }
  return {
    me: workspace.me,
    organization: workspace.activeOrganization,
    space: workspace.activeSpace,
    selectSpace: workspace.selectSpace,
  }
}
