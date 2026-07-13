import { describe, expect, it } from 'vitest'
import {
  AGENT_MODEL_FAMILY_BY_MODEL,
  DEFAULT_AGENT_MODEL,
  SUPPORTED_AGENT_MODELS,
  SupportedAgentModelSchema,
} from '../src/model.js'

describe('agent model catalog', () => {
  it('contains only the enabled model identifiers', () => {
    expect(SUPPORTED_AGENT_MODELS).toEqual([
      'gpt-5.6-sol',
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-sonnet-5',
      'grok-4.5',
    ])
    expect(DEFAULT_AGENT_MODEL).toBe('gpt-5.6-sol')
  })

  it('rejects removed or unknown models', () => {
    expect(SupportedAgentModelSchema.safeParse('GPT-5.4').success).toBe(false)
    expect(SupportedAgentModelSchema.safeParse('gemini-3.1-pro').success).toBe(false)
  })

  it('maps every enabled model to one credential family', () => {
    expect(SUPPORTED_AGENT_MODELS.map((model) => AGENT_MODEL_FAMILY_BY_MODEL[model]))
      .toEqual(['gpt', 'claude', 'claude', 'claude', 'grok'])
  })
})
