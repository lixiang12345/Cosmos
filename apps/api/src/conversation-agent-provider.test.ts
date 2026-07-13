import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentProviderError,
  DeterministicConversationAgentProvider,
  OpenAiCompatibleChatCompletionsProvider,
  createConversationAgentProvider,
  type ConversationAgentExecutionInput,
} from './conversation-agent-provider.js'

const input: ConversationAgentExecutionInput = {
  model: 'pinned-model-v1',
  systemPrompt: 'You are a repository analysis expert.',
  taskContext: 'Review the pinned task context without using tools.',
}

const workspaceListTool = {
  name: 'workspace_files_list',
  description: 'List current workspace files.',
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } },
    additionalProperties: false,
  },
} as const

function completionResponse(content = 'The analysis is complete.', overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion',
    model: 'pinned-model-v1',
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    ...overrides,
  }), { headers: { 'content-type': 'application/json' } })
}

function providerWith(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return new OpenAiCompatibleChatCompletionsProvider({
    baseUrl: 'https://provider.example/v1',
    apiKey: 'provider-secret-key',
    fetchImpl,
    ...overrides,
  })
}

async function caughtError(promise: Promise<unknown>) {
  try {
    await promise
    throw new Error('Expected provider execution to fail.')
  } catch (error) {
    expect(error).toBeInstanceOf(AgentProviderError)
    return error as AgentProviderError
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('OpenAI-compatible conversation provider', () => {
  it('sends one bounded conversation request and returns a normalized result', async () => {
    const fetchMock = vi.fn(async () => completionResponse())
    const fetchImpl = fetchMock as unknown as typeof fetch
    const provider = providerWith(fetchImpl, { maxOutputTokens: 321 })
    expect(JSON.stringify(provider)).not.toContain('provider-secret-key')

    await expect(provider.execute(input)).resolves.toEqual({
      providerResponseId: 'chatcmpl-1',
      providerModel: 'pinned-model-v1',
      text: 'The analysis is complete.',
      finishReason: 'stop',
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.toString()).toBe('https://provider.example/v1/chat/completions')
    expect(request.method).toBe('POST')
    expect(request.redirect).toBe('manual')
    expect(new Headers(request.headers).get('authorization')).toBe('Bearer provider-secret-key')
    const body = JSON.parse(String(request.body))
    expect(body).toEqual({
      model: 'pinned-model-v1',
      messages: [
        { role: 'system', content: 'You are a repository analysis expert.' },
        { role: 'user', content: 'Review the pinned task context without using tools.' },
      ],
      max_tokens: 321,
      stream: false,
    })
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('functions')
    expect(body).not.toHaveProperty('tool_choice')
    expect(body).not.toHaveProperty('function_call')
  })

  it('routes credentials by pinned model and rejects models outside the allowlist', async () => {
    const fetchMock = vi.fn(async () => completionResponse())
    const provider = new OpenAiCompatibleChatCompletionsProvider({
      baseUrl: 'https://provider.example/v1',
      apiKeysByModel: {
        'gpt-5.6-sol': 'gpt-provider-key',
        'claude-sonnet-5': 'claude-provider-key',
      },
      allowedModels: ['gpt-5.6-sol', 'claude-sonnet-5'],
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    await provider.execute({ ...input, model: 'gpt-5.6-sol' })
    await provider.execute({ ...input, model: 'claude-sonnet-5' })
    const calls = fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>
    expect(new Headers(calls[0]?.[1].headers).get('authorization'))
      .toBe('Bearer gpt-provider-key')
    expect(new Headers(calls[1]?.[1].headers).get('authorization'))
      .toBe('Bearer claude-provider-key')
    await expect(provider.execute({ ...input, model: 'unlisted-model' })).rejects.toMatchObject({
      classification: 'terminal', code: 'provider_validation_error',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(provider)).not.toContain('provider-key')
  })

  it('preserves a provider-reported model alias for downstream provenance', async () => {
    const provider = providerWith(
      vi.fn(async () => completionResponse('Alias response.', {
        model: 'pinned-model-v1-20260701',
      })) as unknown as typeof fetch,
    )

    await expect(provider.execute(input)).resolves.toMatchObject({
      providerModel: 'pinned-model-v1-20260701',
      text: 'Alias response.',
    })
  })

  it('normalizes one governed tool request and sends its result in continuation history', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completionResponse('', {
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'provider-tool-1',
              type: 'function',
              function: { name: 'workspace_files_list', arguments: '{"limit":5}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      }))
      .mockResolvedValueOnce(completionResponse('There are no files.'))
    const provider = providerWith(fetchMock as unknown as typeof fetch)

    const first = await provider.execute({ ...input, tools: [workspaceListTool] })
    expect(first).toEqual({
      providerResponseId: 'chatcmpl-1',
      providerModel: 'pinned-model-v1',
      text: '',
      finishReason: 'tool_calls',
      toolCall: {
        providerToolCallId: 'provider-tool-1',
        name: 'workspace_files_list',
        input: { limit: 5 },
      },
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
    })
    await provider.execute({
      ...input,
      tools: [workspaceListTool],
      toolExchanges: [{
        call: first.toolCall!,
        assistantText: first.text,
        result: '{"ok":true,"files":[],"hasMore":false}',
      }],
    })

    const firstBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))
    expect(firstBody).toMatchObject({
      tools: [{ type: 'function', function: { name: 'workspace_files_list' } }],
      tool_choice: 'auto',
      parallel_tool_calls: false,
    })
    const continuation = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))
    expect(continuation.messages.slice(-2)).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'provider-tool-1',
          type: 'function',
          function: { name: 'workspace_files_list', arguments: '{"limit":5}' },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'provider-tool-1',
        content: '{"ok":true,"files":[],"hasMore":false}',
      },
    ])
  })

  it.each([
    ['unknown_tool', '{}'],
    ['workspace_files_list', '{'],
    ['workspace_files_list', '[]'],
  ])('rejects an invalid governed tool request for %s', async (name, argumentsValue) => {
    const provider = providerWith(vi.fn(async () => completionResponse('', {
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'provider-tool-invalid',
            type: 'function',
            function: { name, arguments: argumentsValue },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    })) as unknown as typeof fetch)

    await expect(provider.execute({ ...input, tools: [workspaceListTool] })).rejects.toMatchObject({
      classification: 'terminal', code: 'provider_response_invalid',
    })
  })

  it.each([
    [408, 'provider_http_error'],
    [429, 'provider_rate_limited'],
    [500, 'provider_http_error'],
    [503, 'provider_http_error'],
  ])('classifies HTTP %i as transient', async (status, code) => {
    const fetchImpl = vi.fn(async () => new Response('provider-secret-key', { status })) as unknown as typeof fetch
    const error = await caughtError(providerWith(fetchImpl).execute(input))
    expect(error).toMatchObject({ classification: 'transient', code, statusCode: status })
    expect(JSON.stringify(error)).not.toContain('provider-secret-key')
    expect(error.message).not.toContain('provider-secret-key')
  })

  it.each([400, 401, 403, 404, 422])('classifies HTTP %i as terminal without exposing the body', async (status) => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'provider-secret-key' } }),
      { status, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch
    const error = await caughtError(providerWith(fetchImpl).execute(input))
    expect(error).toMatchObject({
      classification: 'terminal', code: 'provider_http_error', statusCode: status,
    })
    expect(error.message).not.toContain('provider-secret-key')
    expect(error.cause).toBeUndefined()
  })

  it.each([301, 302, 303, 307, 308])(
    'refuses HTTP %i redirects as terminal configuration failures without exposing Location',
    async (status) => {
      const fetchMock = vi.fn(async () => new Response('provider-secret-key', {
        status,
        headers: { location: 'https://unexpected.example/?token=provider-secret-key' },
      }))
      const error = await caughtError(
        providerWith(fetchMock as unknown as typeof fetch).execute(input),
      )

      expect(error).toMatchObject({
        classification: 'terminal',
        code: 'provider_configuration_error',
        statusCode: status,
      })
      expect(error.message).not.toContain('unexpected.example')
      expect(JSON.stringify(error)).not.toContain('provider-secret-key')
      expect(error.cause).toBeUndefined()
      expect(fetchMock).toHaveBeenCalledOnce()
      const [, request] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
      expect(request.redirect).toBe('manual')
    },
  )

  it('does not follow a native fetch redirect or forward the bearer credential', async () => {
    const requests: Array<{ authorization?: string, url?: string }> = []
    const server = createServer((request, response) => {
      requests.push({
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
        ...(request.url ? { url: request.url } : {}),
      })
      response.writeHead(request.url === '/v1/chat/completions' ? 308 : 200, {
        location: '/unexpected-endpoint',
      })
      response.end()
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server address.')

    try {
      const provider = new OpenAiCompatibleChatCompletionsProvider({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKey: 'provider-secret-key',
      })

      await expect(provider.execute(input)).rejects.toMatchObject({
        classification: 'terminal',
        code: 'provider_configuration_error',
        statusCode: 308,
      })
      expect(requests).toEqual([{
        authorization: 'Bearer provider-secret-key',
        url: '/v1/chat/completions',
      }])
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  it('classifies network failures as transient and does not retain a credential-bearing cause', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('request failed with Bearer provider-secret-key')
    }) as unknown as typeof fetch
    const error = await caughtError(providerWith(fetchImpl).execute(input))
    expect(error).toMatchObject({ classification: 'transient', code: 'provider_network_error' })
    expect(error.message).not.toContain('provider-secret-key')
    expect(error.cause).toBeUndefined()
  })

  it('enforces the time-to-headers connection timeout', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((_url: string | URL | Request, request?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      request?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })) as unknown as typeof fetch
    const execution = providerWith(fetchImpl, {
      connectionTimeoutMs: 100,
      totalTimeoutMs: 1_000,
    }).execute(input).catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(100)

    await expect(execution).resolves.toMatchObject({
      classification: 'transient', code: 'provider_connection_timeout',
    })
  })

  it('enforces the total timeout while reading the response body', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async (_url: string | URL | Request, request?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          request?.signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        },
      })
      return new Response(body, { headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    const execution = providerWith(fetchImpl, {
      connectionTimeoutMs: 100,
      totalTimeoutMs: 200,
    }).execute(input).catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(200)

    await expect(execution).resolves.toMatchObject({
      classification: 'transient', code: 'provider_timeout',
    })
  })

  it('treats caller cancellation as terminal and passes the signal to fetch', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn((_url: string | URL | Request, request?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      request?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })) as unknown as typeof fetch
    const execution = providerWith(fetchImpl).execute({ ...input, signal: controller.signal })
    controller.abort()
    const error = await caughtError(execution)
    expect(error).toMatchObject({ classification: 'terminal', code: 'execution_cancelled' })
  })

  it('rejects malformed JSON, invalid response shapes, and unsolicited tool calls as terminal', async () => {
    const malformed = providerWith(vi.fn(async () => new Response('{', {
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch)
    await expect(malformed.execute(input)).rejects.toMatchObject({
      classification: 'terminal', code: 'provider_response_invalid',
    })

    const missingChoices = providerWith(vi.fn(async () => completionResponse('answer', { choices: [] })) as unknown as typeof fetch)
    await expect(missingChoices.execute(input)).rejects.toMatchObject({
      classification: 'terminal', code: 'provider_response_invalid',
    })

    const toolCall = providerWith(vi.fn(async () => completionResponse('answer', {
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'answer', tool_calls: [] },
        finish_reason: 'stop',
      }],
    })) as unknown as typeof fetch)
    await expect(toolCall.execute(input)).rejects.toMatchObject({
      classification: 'terminal', code: 'provider_response_invalid',
    })
  })

  it('bounds both normalized output characters and raw response bytes', async () => {
    const tooManyCharacters = providerWith(
      vi.fn(async () => completionResponse('long answer')) as unknown as typeof fetch,
      { maxOutputCharacters: 4 },
    )
    await expect(tooManyCharacters.execute(input)).rejects.toMatchObject({
      classification: 'terminal', code: 'provider_response_too_large',
    })

    const tooManyBytes = providerWith(
      vi.fn(async () => completionResponse('x'.repeat(2_000))) as unknown as typeof fetch,
      { maxResponseBytes: 1_024 },
    )
    await expect(tooManyBytes.execute(input)).rejects.toMatchObject({
      classification: 'terminal', code: 'provider_response_too_large',
    })
  })

  it('validates endpoint, credential, timeout, and pinned context before network access', async () => {
    expect(() => new OpenAiCompatibleChatCompletionsProvider({
      baseUrl: 'http://provider.example/v1', apiKey: 'secret',
    })).toThrow('HTTPS')
    expect(() => new OpenAiCompatibleChatCompletionsProvider({
      baseUrl: 'https://provider.example/v1?api_key=secret', apiKey: 'secret',
    })).toThrow('query')
    expect(() => new OpenAiCompatibleChatCompletionsProvider({
      baseUrl: 'https://provider.example/v1', apiKey: ' secret ',
    })).toThrow('bearer token')
    expect(() => new OpenAiCompatibleChatCompletionsProvider({
      baseUrl: 'https://provider.example/v1', apiKey: 'secret',
      connectionTimeoutMs: 200, totalTimeoutMs: 100,
    })).toThrow('must not exceed')
    expect(() => new OpenAiCompatibleChatCompletionsProvider({
      baseUrl: 'https://provider.example/v1',
      apiKeysByModel: { 'gpt-5.6-sol': 'secret' },
      allowedModels: ['gpt-5.6-sol', 'claude-sonnet-5'],
    })).toThrow('Every allowed Provider model requires a credential')

    const fetchImpl = vi.fn(async () => completionResponse()) as unknown as typeof fetch
    const provider = providerWith(fetchImpl)
    await expect(provider.execute({ ...input, model: ' ' })).rejects.toMatchObject({
      classification: 'terminal', code: 'provider_validation_error',
    })
    await expect(provider.execute({ ...input, systemPrompt: '' })).rejects.toMatchObject({
      classification: 'terminal', code: 'provider_validation_error',
    })
    await expect(provider.execute({ ...input, taskContext: '' })).rejects.toMatchObject({
      classification: 'terminal', code: 'provider_validation_error',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('conversation provider selection and deterministic fake', () => {
  it('fails closed when no production provider is configured', async () => {
    const error = await caughtError(createConversationAgentProvider().execute(input))
    expect(error).toMatchObject({
      classification: 'terminal', code: 'provider_not_configured',
    })
  })

  it('offers an explicit deterministic fake without making it a runtime fallback', async () => {
    const provider = new DeterministicConversationAgentProvider(
      (execution, invocation) => `${invocation}:${execution.model}:${execution.taskContext}`,
    )
    await expect(provider.execute(input)).resolves.toMatchObject({
      providerResponseId: 'deterministic-1',
      providerModel: 'pinned-model-v1',
      text: '1:pinned-model-v1:Review the pinned task context without using tools.',
      finishReason: 'stop',
    })
    expect(provider.calls).toEqual([input])
  })
})
