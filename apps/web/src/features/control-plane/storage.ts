import { createSeededControlPlaneState } from './seed'
import {
  CONTROL_PLANE_SCHEMA_VERSION,
  type ControlPlaneState,
} from './types'

export const CONTROL_PLANE_STORAGE_KEY = 'cosmos.controlPlane.v1'

export type ControlPlaneStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function browserStorage(): ControlPlaneStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseControlPlaneState(serialized: string | null): ControlPlaneState | undefined {
  if (!serialized) return undefined
  try {
    const value: unknown = JSON.parse(serialized)
    if (!isRecord(value) || value.schemaVersion !== CONTROL_PLANE_SCHEMA_VERSION) return undefined
    const collectionKeys = [
      'spaces',
      'environments',
      'daemons',
      'repositories',
      'integrations',
      'mcpServers',
      'secrets',
      'webhooks',
      'memoryFiles',
      'automations',
      'inboundEvents',
      'sessionDrafts',
      'auditEvents',
    ]
    if (typeof value.activeSpaceId !== 'string') return undefined
    if (collectionKeys.some((key) => !Array.isArray(value[key]))) return undefined
    const state = value as ControlPlaneState
    if (!state.spaces.some((space) => space.id === state.activeSpaceId)) return undefined
    return state
  } catch {
    return undefined
  }
}

export function loadControlPlaneState(
  storage: ControlPlaneStorage | null | undefined = browserStorage(),
  fallback: ControlPlaneState = createSeededControlPlaneState(),
): ControlPlaneState {
  if (!storage) return fallback
  try {
    return parseControlPlaneState(storage.getItem(CONTROL_PLANE_STORAGE_KEY)) ?? fallback
  } catch {
    return fallback
  }
}

export function saveControlPlaneState(
  state: ControlPlaneState,
  storage: ControlPlaneStorage | null | undefined = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(CONTROL_PLANE_STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function clearControlPlaneState(
  storage: ControlPlaneStorage | undefined = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.removeItem(CONTROL_PLANE_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
