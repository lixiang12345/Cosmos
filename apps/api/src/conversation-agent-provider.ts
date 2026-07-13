export type ConversationAgentExecutionInput = Readonly<{
  model: string
  systemPrompt: string
  taskContext: string
  tools?: readonly ConversationAgentToolDefinition[]
  toolExchanges?: readonly ConversationAgentToolExchange[]
  signal?: AbortSignal
}>

export type ConversationAgentToolDefinition = Readonly<{
  name: string
  description: string
  inputSchema: Readonly<Record<string, unknown>>
}>

export type ConversationAgentToolCall = Readonly<{
  providerToolCallId: string
  name: string
  input: Readonly<Record<string, unknown>>
}>

export type ConversationAgentToolExchange = Readonly<{
  call: ConversationAgentToolCall
  assistantText: string
  result: string
}>

export type ConversationAgentExecutionResult = Readonly<{
  providerResponseId: string
  providerModel: string
  text: string
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls'
  toolCall?: ConversationAgentToolCall
  usage?: Readonly<{
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }>
}>

export interface ConversationAgentProvider {
  execute(input: ConversationAgentExecutionInput): Promise<ConversationAgentExecutionResult>
}

export type AgentProviderErrorClassification = 'transient' | 'terminal'

export type AgentProviderErrorCode =
  | 'execution_cancelled'
  | 'provider_configuration_error'
  | 'provider_connection_timeout'
  | 'provider_http_error'
  | 'provider_network_error'
  | 'provider_not_configured'
  | 'provider_rate_limited'
  | 'provider_response_invalid'
  | 'provider_response_too_large'
  | 'provider_timeout'
  | 'provider_validation_error'

export class AgentProviderError extends Error {
  readonly classification: AgentProviderErrorClassification
  readonly code: AgentProviderErrorCode
  readonly statusCode?: number

  constructor(options: {
    classification: AgentProviderErrorClassification
    code: AgentProviderErrorCode
    message: string
    statusCode?: number
  }) {
    super(options.message)
    this.name = 'AgentProviderError'
    this.classification = options.classification
    this.code = options.code
    this.statusCode = options.statusCode
  }
}

export type OpenAiCompatibleChatCompletionsProviderOptions = Readonly<{
  baseUrl: string
  apiKey?: string
  apiKeysByModel?: Readonly<Record<string, string>>
  allowedModels?: readonly string[]
  connectionTimeoutMs?: number
  totalTimeoutMs?: number
  maxOutputTokens?: number
  maxOutputCharacters?: number
  maxResponseBytes?: number
  fetchImpl?: typeof fetch
}>

const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000
const DEFAULT_TOTAL_TIMEOUT_MS = 120_000
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096
const DEFAULT_MAX_OUTPUT_CHARACTERS = 100_000
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576
const MAX_MODEL_LENGTH = 256
const MAX_SYSTEM_PROMPT_LENGTH = 200_000
const MAX_TASK_CONTEXT_LENGTH = 1_000_000
const MAX_TOOL_DESCRIPTION_LENGTH = 4_000
const MAX_TOOL_ARGUMENTS_LENGTH = 100_000
const MAX_TOOL_RESULT_LENGTH = 100_000
const MAX_TOOL_EXCHANGES = 8
const PROVIDER_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

type ResolvedProviderOptions = {
  endpoint: URL
  fallbackApiKey: string | null
  apiKeysByModel: ReadonlyMap<string, string>
  allowedModels: ReadonlySet<string> | null
  connectionTimeoutMs: number
  totalTimeoutMs: number
  maxOutputTokens: number
  maxOutputCharacters: number
  maxResponseBytes: number
  fetchImpl: typeof fetch
}

function terminalError(code: AgentProviderErrorCode, message: string) {
  return new AgentProviderError({ classification: 'terminal', code, message })
}

function validateInteger(value: number, name: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw terminalError(
      'provider_validation_error',
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    )
  }
  return value
}

function createEndpoint(baseUrl: string) {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw terminalError('provider_validation_error', 'Provider base URL must be a valid URL.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw terminalError(
      'provider_validation_error',
      'Provider base URL must not contain credentials, a query, or a fragment.',
    )
  }
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw terminalError(
      'provider_validation_error',
      'Provider base URL must use HTTPS, except for a loopback development endpoint.',
    )
  }
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`
  return new URL('chat/completions', url)
}

function validateApiKey(value: string, name: string) {
  const apiKey = value.trim()
  if (!apiKey || apiKey !== value || /\s/.test(apiKey)) {
    throw terminalError('provider_validation_error', `${name} must be a non-empty bearer token.`)
  }
  return apiKey
}

function validateModelIdentifier(value: string, name: string) {
  if (!value || value !== value.trim() || value.length > MAX_MODEL_LENGTH) {
    throw terminalError('provider_validation_error', `${name} must be a valid model identifier.`)
  }
  return value
}

function validateToolName(value: string, name: string) {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw terminalError('provider_validation_error', `${name} must be a safe tool identifier.`)
  }
  return value
}

function resolveOptions(options: OpenAiCompatibleChatCompletionsProviderOptions): ResolvedProviderOptions {
  const fallbackApiKey = options.apiKey === undefined
    ? null
    : validateApiKey(options.apiKey, 'Provider API key')
  const apiKeysByModel = new Map(Object.entries(options.apiKeysByModel ?? {}).map(([model, apiKey]) => [
    validateModelIdentifier(model, 'Provider credential model'),
    validateApiKey(apiKey, 'Provider model API key'),
  ]))
  if (fallbackApiKey === null && apiKeysByModel.size === 0) {
    throw terminalError('provider_validation_error', 'At least one Provider API key is required.')
  }
  const allowedModels = options.allowedModels === undefined
    ? null
    : new Set(options.allowedModels.map((model) => validateModelIdentifier(model, 'Allowed Provider model')))
  if (allowedModels?.size === 0 || allowedModels?.size !== options.allowedModels?.length) {
    throw terminalError('provider_validation_error', 'Allowed Provider models must be non-empty and unique.')
  }
  for (const model of allowedModels ?? []) {
    if (fallbackApiKey === null && !apiKeysByModel.has(model)) {
      throw terminalError('provider_validation_error', 'Every allowed Provider model requires a credential.')
    }
  }
  const connectionTimeoutMs = validateInteger(
    options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    'Provider connection timeout',
    100,
    300_000,
  )
  const totalTimeoutMs = validateInteger(
    options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS,
    'Provider total timeout',
    100,
    300_000,
  )
  if (connectionTimeoutMs > totalTimeoutMs) {
    throw terminalError(
      'provider_validation_error',
      'Provider connection timeout must not exceed the total timeout.',
    )
  }
  return {
    endpoint: createEndpoint(options.baseUrl),
    fallbackApiKey,
    apiKeysByModel,
    allowedModels,
    connectionTimeoutMs,
    totalTimeoutMs,
    maxOutputTokens: validateInteger(
      options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      'Provider maximum output tokens',
      1,
      32_768,
    ),
    maxOutputCharacters: validateInteger(
      options.maxOutputCharacters ?? DEFAULT_MAX_OUTPUT_CHARACTERS,
      'Provider maximum output characters',
      1,
      1_000_000,
    ),
    maxResponseBytes: validateInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      'Provider maximum response bytes',
      1_024,
      10_485_760,
    ),
    fetchImpl: options.fetchImpl ?? fetch,
  }
}

function apiKeyForModel(options: ResolvedProviderOptions, model: string) {
  if (options.allowedModels && !options.allowedModels.has(model)) {
    throw terminalError('provider_validation_error', 'Pinned model is not enabled for this Worker.')
  }
  const apiKey = options.apiKeysByModel.get(model) ?? options.fallbackApiKey
  if (!apiKey) {
    throw terminalError('provider_configuration_error', 'Pinned model has no configured Provider credential.')
  }
  return apiKey
}

function validateInput(input: ConversationAgentExecutionInput) {
  if (
    typeof input.model !== 'string'
    || !input.model
    || input.model !== input.model.trim()
    || input.model.length > MAX_MODEL_LENGTH
  ) {
    throw terminalError('provider_validation_error', 'Pinned model must be a non-empty model identifier.')
  }
  if (
    typeof input.systemPrompt !== 'string'
    || !input.systemPrompt.trim()
    || input.systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH
  ) {
    throw terminalError('provider_validation_error', 'Pinned system prompt is invalid or too large.')
  }
  if (
    typeof input.taskContext !== 'string'
    || !input.taskContext.trim()
    || input.taskContext.length > MAX_TASK_CONTEXT_LENGTH
  ) {
    throw terminalError('provider_validation_error', 'Pinned task context is invalid or too large.')
  }
  const tools = input.tools ?? []
  if (tools.length > 20) {
    throw terminalError('provider_validation_error', 'At most 20 tools can be enabled for one execution.')
  }
  const names = new Set<string>()
  for (const tool of tools) {
    const name = validateToolName(tool.name, 'Tool name')
    if (names.has(name)) {
      throw terminalError('provider_validation_error', 'Enabled tool names must be unique.')
    }
    names.add(name)
    if (
      typeof tool.description !== 'string'
      || !tool.description.trim()
      || tool.description !== tool.description.trim()
      || tool.description.length > MAX_TOOL_DESCRIPTION_LENGTH
      || !isRecord(tool.inputSchema)
    ) {
      throw terminalError('provider_validation_error', 'Enabled tool metadata is invalid.')
    }
  }
  const toolExchanges = input.toolExchanges ?? []
  if (toolExchanges.length > MAX_TOOL_EXCHANGES || (toolExchanges.length > 0 && tools.length === 0)) {
    throw terminalError('provider_validation_error', 'Tool exchange history is invalid.')
  }
  for (const exchange of toolExchanges) {
    if (
      !exchange
      || !isRecord(exchange.call.input)
      || typeof exchange.call.providerToolCallId !== 'string'
      || !exchange.call.providerToolCallId.trim()
      || exchange.call.providerToolCallId.length > 512
      || !names.has(exchange.call.name)
      || typeof exchange.assistantText !== 'string'
      || exchange.assistantText.length > MAX_SYSTEM_PROMPT_LENGTH
      || typeof exchange.result !== 'string'
      || !exchange.result
      || exchange.result.length > MAX_TOOL_RESULT_LENGTH
    ) {
      throw terminalError('provider_validation_error', 'Tool exchange history is invalid.')
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readSafeInteger(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function hasBoundedJsonComplexity(value: unknown) {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || current.depth > 10 || ++nodes > 1_000) return false
    if (typeof current.value === 'string' && current.value.length > 20_000) return false
    if (Array.isArray(current.value)) {
      for (const entry of current.value) pending.push({ value: entry, depth: current.depth + 1 })
    } else if (isRecord(current.value)) {
      const entries = Object.entries(current.value)
      if (entries.length > 100) return false
      for (const [key, entry] of entries) {
        if (key.length > 256) return false
        pending.push({ value: entry, depth: current.depth + 1 })
      }
    }
  }
  return true
}

function parseProviderResponse(
  value: unknown,
  maxOutputCharacters: number,
  allowedToolNames: ReadonlySet<string>,
): ConversationAgentExecutionResult {
  if (!isRecord(value) || value.object !== 'chat.completion') {
    throw terminalError('provider_response_invalid', 'Provider returned an invalid chat completion response.')
  }
  const id = value.id
  const model = value.model
  const choices = value.choices
  if (
    typeof id !== 'string'
    || !id.trim()
    || id !== id.trim()
    || id.length > 512
    || typeof model !== 'string'
    || !model.trim()
    || model !== model.trim()
    || model.length > MAX_MODEL_LENGTH
    || !Array.isArray(choices)
    || choices.length !== 1
  ) {
    throw terminalError('provider_response_invalid', 'Provider returned an invalid chat completion response.')
  }
  const choice = choices[0]
  if (!isRecord(choice) || choice.index !== 0 || !isRecord(choice.message)) {
    throw terminalError('provider_response_invalid', 'Provider returned an invalid chat completion choice.')
  }
  const message = choice.message
  if (
    message.role !== 'assistant'
    || (typeof message.content !== 'string' && message.content !== null)
    || Object.hasOwn(message, 'function_call')
  ) {
    throw terminalError('provider_response_invalid', 'Provider returned an invalid assistant response.')
  }
  const content = message.content ?? ''
  if (content.length > maxOutputCharacters) {
    throw terminalError('provider_response_too_large', 'Provider output exceeded the configured size limit.')
  }
  const finishReason = choice.finish_reason
  if (
    finishReason !== 'stop'
    && finishReason !== 'length'
    && finishReason !== 'content_filter'
    && finishReason !== 'tool_calls'
  ) {
    throw terminalError('provider_response_invalid', 'Provider returned an unsupported finish reason.')
  }
  let toolCall: ConversationAgentToolCall | undefined
  const toolCalls = message.tool_calls
  if (finishReason === 'tool_calls') {
    if (!Array.isArray(toolCalls) || toolCalls.length !== 1 || allowedToolNames.size === 0) {
      throw terminalError('provider_response_invalid', 'Provider returned an invalid tool request.')
    }
    const candidate = toolCalls[0]
    if (
      !isRecord(candidate)
      || candidate.type !== 'function'
      || typeof candidate.id !== 'string'
      || !candidate.id.trim()
      || candidate.id !== candidate.id.trim()
      || candidate.id.length > 512
      || !isRecord(candidate.function)
      || typeof candidate.function.name !== 'string'
      || !allowedToolNames.has(candidate.function.name)
      || typeof candidate.function.arguments !== 'string'
      || candidate.function.arguments.length > MAX_TOOL_ARGUMENTS_LENGTH
    ) {
      throw terminalError('provider_response_invalid', 'Provider returned an invalid tool request.')
    }
    let parsedInput: unknown
    try {
      parsedInput = JSON.parse(candidate.function.arguments)
    } catch {
      throw terminalError('provider_response_invalid', 'Provider returned malformed tool arguments.')
    }
    if (!isRecord(parsedInput) || !hasBoundedJsonComplexity(parsedInput)) {
      throw terminalError('provider_response_invalid', 'Provider tool arguments must be a bounded JSON object.')
    }
    toolCall = {
      providerToolCallId: candidate.id,
      name: candidate.function.name,
      input: parsedInput,
    }
  } else if (toolCalls !== undefined) {
    throw terminalError('provider_response_invalid', 'Provider returned tool calls without a tool finish reason.')
  }
  let usage: ConversationAgentExecutionResult['usage']
  if (value.usage !== undefined) {
    if (!isRecord(value.usage)) {
      throw terminalError('provider_response_invalid', 'Provider returned invalid token usage.')
    }
    const inputTokens = readSafeInteger(value.usage, 'prompt_tokens')
    const outputTokens = readSafeInteger(value.usage, 'completion_tokens')
    const totalTokens = readSafeInteger(value.usage, 'total_tokens')
    if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) {
      throw terminalError('provider_response_invalid', 'Provider returned invalid token usage.')
    }
    usage = { inputTokens, outputTokens, totalTokens }
  }
  return {
    providerResponseId: id,
    providerModel: model,
    text: content,
    finishReason,
    ...(toolCall ? { toolCall } : {}),
    ...(usage ? { usage } : {}),
  }
}

async function readBoundedJson(response: Response, maxResponseBytes: number): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase()
  if (!contentType?.includes('application/json')) {
    throw terminalError('provider_response_invalid', 'Provider response must be JSON.')
  }
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const length = Number(declaredLength)
    if (!Number.isSafeInteger(length) || length < 0) {
      throw terminalError('provider_response_invalid', 'Provider returned an invalid content length.')
    }
    if (length > maxResponseBytes) {
      try {
        await response.body?.cancel()
      } catch {
        // The size classification remains authoritative even if the stream cannot be cancelled.
      }
      throw terminalError('provider_response_too_large', 'Provider response exceeded the configured size limit.')
    }
  }
  if (!response.body) {
    throw terminalError('provider_response_invalid', 'Provider returned an empty response body.')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      received += chunk.value.byteLength
      if (received > maxResponseBytes) {
        try {
          await reader.cancel()
        } catch {
          // The size classification remains authoritative even if the stream cannot be cancelled.
        }
        throw terminalError('provider_response_too_large', 'Provider response exceeded the configured size limit.')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw terminalError('provider_response_invalid', 'Provider returned malformed JSON.')
  }
}

function httpError(statusCode: number) {
  if (PROVIDER_REDIRECT_STATUSES.has(statusCode)) {
    return new AgentProviderError({
      classification: 'terminal',
      code: 'provider_configuration_error',
      message: 'Provider endpoint redirected the request; configure the final endpoint directly.',
      statusCode,
    })
  }
  if (statusCode === 429) {
    return new AgentProviderError({
      classification: 'transient',
      code: 'provider_rate_limited',
      message: 'Provider rate limit was reached.',
      statusCode,
    })
  }
  const classification = statusCode === 408 || statusCode >= 500 ? 'transient' : 'terminal'
  return new AgentProviderError({
    classification,
    code: 'provider_http_error',
    message: classification === 'transient'
      ? 'Provider is temporarily unavailable.'
      : 'Provider rejected the request.',
    statusCode,
  })
}

/** Non-streaming `/chat/completions` adapter that never sends or accepts tool/function calls. */
export class OpenAiCompatibleChatCompletionsProvider implements ConversationAgentProvider {
  readonly #options: ResolvedProviderOptions

  constructor(options: OpenAiCompatibleChatCompletionsProviderOptions) {
    this.#options = resolveOptions(options)
  }

  async execute(input: ConversationAgentExecutionInput): Promise<ConversationAgentExecutionResult> {
    validateInput(input)
    const apiKey = apiKeyForModel(this.#options, input.model)
    const tools = input.tools ?? []
    const allowedToolNames = new Set(tools.map((tool) => tool.name))
    if (input.signal?.aborted) {
      throw terminalError('execution_cancelled', 'Agent execution was cancelled.')
    }
    const connectionTimeout = new AbortController()
    const totalTimeout = new AbortController()
    const signals = [connectionTimeout.signal, totalTimeout.signal]
    if (input.signal) signals.push(input.signal)
    const signal = AbortSignal.any(signals)
    const connectionTimer = setTimeout(
      () => connectionTimeout.abort(),
      this.#options.connectionTimeoutMs,
    )
    const totalTimer = setTimeout(() => totalTimeout.abort(), this.#options.totalTimeoutMs)

    try {
      let response: Response
      try {
        response = await this.#options.fetchImpl(this.#options.endpoint, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: input.model,
            messages: [
              { role: 'system', content: input.systemPrompt },
              { role: 'user', content: input.taskContext },
              ...(input.toolExchanges ?? []).flatMap((exchange) => [
                {
                  role: 'assistant',
                  content: exchange.assistantText || null,
                  tool_calls: [{
                    id: exchange.call.providerToolCallId,
                    type: 'function',
                    function: {
                      name: exchange.call.name,
                      arguments: JSON.stringify(exchange.call.input),
                    },
                  }],
                },
                {
                  role: 'tool',
                  tool_call_id: exchange.call.providerToolCallId,
                  content: exchange.result,
                },
              ]),
            ],
            ...(tools.length > 0 ? {
              tools: tools.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
              })),
              tool_choice: 'auto',
              parallel_tool_calls: false,
            } : {}),
            max_tokens: this.#options.maxOutputTokens,
            stream: false,
          }),
          redirect: 'manual',
          signal,
        })
      } catch {
        if (input.signal?.aborted) {
          throw terminalError('execution_cancelled', 'Agent execution was cancelled.')
        }
        if (connectionTimeout.signal.aborted) {
          throw new AgentProviderError({
            classification: 'transient',
            code: 'provider_connection_timeout',
            message: 'Provider connection timed out.',
          })
        }
        if (totalTimeout.signal.aborted) {
          throw new AgentProviderError({
            classification: 'transient',
            code: 'provider_timeout',
            message: 'Provider request timed out.',
          })
        }
        throw new AgentProviderError({
          classification: 'transient',
          code: 'provider_network_error',
          message: 'Provider network request failed.',
        })
      } finally {
        clearTimeout(connectionTimer)
      }

      if (!response.ok) {
        try {
          await response.body?.cancel()
        } catch {
          // HTTP status remains authoritative even if the error body cannot be cancelled.
        }
        throw httpError(response.status)
      }
      const value = await readBoundedJson(response, this.#options.maxResponseBytes)
      return parseProviderResponse(value, this.#options.maxOutputCharacters, allowedToolNames)
    } catch (error) {
      if (error instanceof AgentProviderError) throw error
      if (input.signal?.aborted) {
        throw terminalError('execution_cancelled', 'Agent execution was cancelled.')
      }
      if (totalTimeout.signal.aborted) {
        throw new AgentProviderError({
          classification: 'transient',
          code: 'provider_timeout',
          message: 'Provider request timed out.',
        })
      }
      throw new AgentProviderError({
        classification: 'transient',
        code: 'provider_network_error',
        message: 'Provider response could not be read.',
      })
    } finally {
      clearTimeout(connectionTimer)
      clearTimeout(totalTimer)
    }
  }
}

export class UnavailableConversationAgentProvider implements ConversationAgentProvider {
  async execute(): Promise<never> {
    throw terminalError(
      'provider_not_configured',
      'Agent execution provider is not configured.',
    )
  }
}

export function createConversationAgentProvider(
  options?: OpenAiCompatibleChatCompletionsProviderOptions,
): ConversationAgentProvider {
  return options
    ? new OpenAiCompatibleChatCompletionsProvider(options)
    : new UnavailableConversationAgentProvider()
}

export type DeterministicConversationAgentResponseValue = string | Readonly<{
  text: string
  finishReason: ConversationAgentExecutionResult['finishReason']
  toolCall?: ConversationAgentToolCall
}>

export type DeterministicConversationAgentResponse = DeterministicConversationAgentResponseValue | ((
  input: ConversationAgentExecutionInput,
  invocation: number,
) => DeterministicConversationAgentResponseValue)

export class DeterministicConversationAgentProvider implements ConversationAgentProvider {
  private readonly executedInputs: ConversationAgentExecutionInput[] = []

  constructor(
    private readonly response: DeterministicConversationAgentResponse = 'Deterministic agent response.',
  ) {}

  get calls(): readonly ConversationAgentExecutionInput[] {
    return this.executedInputs.map((input) => ({ ...input }))
  }

  async execute(
    input: ConversationAgentExecutionInput,
  ): Promise<ConversationAgentExecutionResult> {
    if (input.signal?.aborted) {
      throw terminalError('execution_cancelled', 'Agent execution was cancelled.')
    }
    const invocation = this.executedInputs.length + 1
    const capturedInput = { ...input }
    this.executedInputs.push(capturedInput)
    const response = typeof this.response === 'function'
      ? this.response(capturedInput, invocation)
      : this.response
    const normalized = typeof response === 'string'
      ? { text: response, finishReason: 'stop' as const }
      : response
    return {
      providerResponseId: `deterministic-${invocation}`,
      providerModel: input.model,
      ...normalized,
    }
  }
}
