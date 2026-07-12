import { createContext } from 'react'
import type {
  Automation,
  ConnectIntegrationInput,
  ControlPlaneScope,
  ControlPlaneState,
  CreateAutomationInput,
  CreateEnvironmentInput,
  CreateFileInput,
  CreateMcpServerInput,
  CreateSecretInput,
  CreateWebhookInput,
  Daemon,
  Environment,
  InjectEventInput,
  InjectEventResult,
  Integration,
  McpServer,
  MemoryFile,
  Secret,
  Space,
  UpdateEnvironmentInput,
  UpdateFileInput,
  Webhook,
} from './types'

export type ControlPlaneActions = {
  switchSpace: (spaceId: string) => Space
  createEnvironment: (input: CreateEnvironmentInput) => Environment
  updateEnvironment: (environmentId: string, input: UpdateEnvironmentInput) => Environment
  advanceEnvironmentProvisioning: (environmentId: string) => Environment
  toggleDaemon: (daemonId: string, enabled?: boolean) => Daemon
  connectIntegration: (integrationId: string, input?: ConnectIntegrationInput) => Integration
  createAutomation: (input: CreateAutomationInput) => Automation
  toggleAutomation: (automationId: string, enabled?: boolean) => Automation
  injectEvent: (input: InjectEventInput) => InjectEventResult
  createFile: (input: CreateFileInput) => MemoryFile
  updateFile: (fileId: string, input: UpdateFileInput) => MemoryFile
  deleteFile: (fileId: string) => string
  createSecret: (input: CreateSecretInput) => Secret
  createMcpServer: (input: CreateMcpServerInput) => McpServer
  createMcp: (input: CreateMcpServerInput) => McpServer
  createWebhook: (input: CreateWebhookInput) => Webhook
}

export type ControlPlaneContextValue = {
  state: ControlPlaneState
  activeSpace: Space
  scope: ControlPlaneScope
  actions: ControlPlaneActions
}

export const ControlPlaneContext = createContext<ControlPlaneContextValue | undefined>(undefined)
