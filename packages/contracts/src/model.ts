import { z } from 'zod'

export const SUPPORTED_AGENT_MODELS = [
  'gpt-5.6-sol',
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-sonnet-5',
  'grok-4.5',
] as const

export const DEFAULT_AGENT_MODEL = SUPPORTED_AGENT_MODELS[0]

export const SupportedAgentModelSchema = z.enum(SUPPORTED_AGENT_MODELS)
export type SupportedAgentModel = z.infer<typeof SupportedAgentModelSchema>

export const AGENT_MODEL_FAMILY_BY_MODEL: Readonly<Record<SupportedAgentModel, 'gpt' | 'claude' | 'grok'>> = {
  'gpt-5.6-sol': 'gpt',
  'claude-fable-5': 'claude',
  'claude-opus-4-8': 'claude',
  'claude-sonnet-5': 'claude',
  'grok-4.5': 'grok',
}
