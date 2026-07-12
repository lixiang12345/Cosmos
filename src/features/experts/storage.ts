import {
  EXPERT_STORE_SCHEMA_VERSION,
  createSeededExpertStore,
  type ExpertStore,
} from './domain'

export const EXPERT_STORAGE_KEY = 'relay.experts'

export type ExpertStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function browserStorage(): ExpertStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseExpertStore(serialized: string | null): ExpertStore | undefined {
  if (!serialized) return undefined
  try {
    const value: unknown = JSON.parse(serialized)
    if (!isRecord(value)) return undefined
    if (value.schemaVersion !== EXPERT_STORE_SCHEMA_VERSION) return undefined
    if (!Array.isArray(value.experts) || !Array.isArray(value.versions)) return undefined
    return value as ExpertStore
  } catch {
    return undefined
  }
}

export function loadExpertStore(
  storage: ExpertStorage | undefined = browserStorage(),
  fallback: ExpertStore = createSeededExpertStore(),
): ExpertStore {
  if (!storage) return fallback
  try {
    return parseExpertStore(storage.getItem(EXPERT_STORAGE_KEY)) ?? fallback
  } catch {
    return fallback
  }
}

export function saveExpertStore(
  store: ExpertStore,
  storage: ExpertStorage | undefined = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(EXPERT_STORAGE_KEY, JSON.stringify(store))
    return true
  } catch {
    return false
  }
}

export function clearExpertStore(storage: ExpertStorage | undefined = browserStorage()): boolean {
  if (!storage) return false
  try {
    storage.removeItem(EXPERT_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
