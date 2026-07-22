import type { AutomationFilter } from '@cosmos/contracts'

const sensitiveKey = /authorization|cookie|token|secret|password|signature|api[-_]?key/i

function property(value: unknown, path: string, fallback?: unknown): unknown {
  if (path === '') return value
  let current = value
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return fallback
    current = (current as Record<string, unknown>)[segment]
    if (current === undefined) return fallback
  }
  return current
}

function operand(value: unknown, payload: Record<string, unknown>): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const entry = Object.entries(value)[0]
  if (!entry || entry[0] !== 'var') return evaluate(value as AutomationFilter, payload)
  const argument = entry[1]
  if (typeof argument === 'string') return property(payload, argument)
  if (Array.isArray(argument) && typeof argument[0] === 'string') {
    return property(payload, argument[0], argument[1])
  }
  return undefined
}

function evaluate(filter: AutomationFilter, payload: Record<string, unknown>): boolean {
  const entry = Object.entries(filter)[0]
  if (!entry) return true
  const [operator, argument] = entry
  if (operator === 'and' && Array.isArray(argument)) {
    return argument.every((child) => evaluate(child as AutomationFilter, payload))
  }
  if (operator === 'or' && Array.isArray(argument)) {
    return argument.some((child) => evaluate(child as AutomationFilter, payload))
  }
  if ((operator === '==' || operator === '!=') && Array.isArray(argument)) {
    const equal = operand(argument[0], payload) === operand(argument[1], payload)
    return operator === '==' ? equal : !equal
  }
  if (operator === 'in' && Array.isArray(argument)) {
    const needle = operand(argument[0], payload)
    const haystack = operand(argument[1], payload)
    if (typeof haystack === 'string' && typeof needle === 'string') return haystack.includes(needle)
    if (Array.isArray(haystack)) return haystack.includes(needle)
    return false
  }
  if (operator === 'var') return Boolean(operand(filter, payload))
  return false
}

export function evaluateAutomationFilter(
  filter: AutomationFilter,
  payload: Record<string, unknown>,
) {
  return evaluate(filter, payload)
}

export function redactAutomationData(
  value: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (depth > 8) return { truncated: true }
  return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, item]) => {
    if (sensitiveKey.test(key)) return [key, '[REDACTED]']
    if (Array.isArray(item)) {
      return [key, item.slice(0, 100).map((child) => (
        typeof child === 'object' && child !== null && !Array.isArray(child)
          ? redactAutomationData(child as Record<string, unknown>, depth + 1)
          : child
      ))]
    }
    if (typeof item === 'object' && item !== null) {
      return [key, redactAutomationData(item as Record<string, unknown>, depth + 1)]
    }
    return [key, item]
  }))
}

export function automationEventMessage(input: {
  source: string
  eventType: string
  externalId: string
  payload: Record<string, unknown>
}) {
  const serialized = JSON.stringify(input.payload, null, 2)
  const bounded = serialized.length > 20_000 ? `${serialized.slice(0, 20_000)}\n…[truncated]` : serialized
  return `Automation event received.\nSource: ${input.source}\nEvent type: ${input.eventType}\nExternal ID: ${input.externalId}\nPayload:\n${bounded}`
}
