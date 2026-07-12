import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ControlPlaneContext, type ControlPlaneActions, type ControlPlaneContextValue } from './context'
import {
  advanceEnvironmentProvisioning as advanceEnvironmentProvisioningState,
  connectIntegration as connectIntegrationState,
  createAutomation as createAutomationState,
  createEnvironment as createEnvironmentState,
  createFile as createFileState,
  createMcpServer as createMcpServerState,
  createSecret as createSecretState,
  createWebhook as createWebhookState,
  deleteFile as deleteFileState,
  injectEvent as injectEventState,
  selectControlPlaneScope,
  switchSpace as switchSpaceState,
  toggleAutomation as toggleAutomationState,
  toggleDaemon as toggleDaemonState,
  updateEnvironment as updateEnvironmentState,
  updateFile as updateFileState,
} from './operations'
import {
  loadControlPlaneState,
  saveControlPlaneState,
  type ControlPlaneStorage,
} from './storage'
import type { ControlPlaneState, CreateMcpServerInput } from './types'

export type ControlPlaneProviderProps = {
  children: ReactNode
  initialState?: ControlPlaneState
  storage?: ControlPlaneStorage
  provisioningIntervalMs?: number
}

export function ControlPlaneProvider({
  children,
  initialState,
  storage,
  provisioningIntervalMs = 700,
}: ControlPlaneProviderProps) {
  const [state, setState] = useState<ControlPlaneState>(() => (
    initialState ?? loadControlPlaneState(storage)
  ))
  const stateRef = useRef(state)

  const commit = useCallback((nextState: ControlPlaneState) => {
    stateRef.current = nextState
    setState(nextState)
  }, [])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    saveControlPlaneState(state, storage)
  }, [state, storage])

  useEffect(() => {
    const environment = state.environments.find((item) => item.status === 'provisioning')
    if (!environment) return
    const timer = window.setTimeout(() => {
      const result = advanceEnvironmentProvisioningState(stateRef.current, environment.id)
      commit(result.state)
    }, provisioningIntervalMs)
    return () => window.clearTimeout(timer)
  }, [commit, provisioningIntervalMs, state.environments])

  const actions = useMemo<ControlPlaneActions>(() => {
    const run = <Value,>(result: { state: ControlPlaneState; value: Value }) => {
      commit(result.state)
      return result.value
    }

    const createMcpServer = (input: CreateMcpServerInput) => (
      run(createMcpServerState(stateRef.current, input))
    )

    return {
      switchSpace: (spaceId) => run(switchSpaceState(stateRef.current, spaceId)),
      createEnvironment: (input) => run(createEnvironmentState(stateRef.current, input)),
      updateEnvironment: (environmentId, input) => run(updateEnvironmentState(stateRef.current, environmentId, input)),
      advanceEnvironmentProvisioning: (environmentId) => run(advanceEnvironmentProvisioningState(stateRef.current, environmentId)),
      toggleDaemon: (daemonId, enabled) => run(toggleDaemonState(stateRef.current, daemonId, enabled)),
      connectIntegration: (integrationId, input) => run(connectIntegrationState(stateRef.current, integrationId, input)),
      createAutomation: (input) => run(createAutomationState(stateRef.current, input)),
      toggleAutomation: (automationId, enabled) => run(toggleAutomationState(stateRef.current, automationId, enabled)),
      injectEvent: (input) => run(injectEventState(stateRef.current, input)),
      createFile: (input) => run(createFileState(stateRef.current, input)),
      updateFile: (fileId, input) => run(updateFileState(stateRef.current, fileId, input)),
      deleteFile: (fileId) => run(deleteFileState(stateRef.current, fileId)),
      createSecret: (input) => run(createSecretState(stateRef.current, input)),
      createMcpServer,
      createMcp: createMcpServer,
      createWebhook: (input) => run(createWebhookState(stateRef.current, input)),
    }
  }, [commit])

  const scope = useMemo(() => selectControlPlaneScope(state), [state])
  const value = useMemo<ControlPlaneContextValue>(() => ({
    state,
    activeSpace: scope.space,
    scope,
    actions,
  }), [actions, scope, state])

  return <ControlPlaneContext.Provider value={value}>{children}</ControlPlaneContext.Provider>
}
