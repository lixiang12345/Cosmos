import { describe, expect, it, vi } from 'vitest'
import { ContextEngineGatewayError, HttpContextEngineGateway } from './context-engine-gateway.js'

const options = {
  baseUrl: 'https://context.example/api',
  apiKey: 'context-secret',
  workspaces: { 'relay/platform': 'workspace-platform' },
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('HttpContextEngineGateway', () => {
  it('maps ContextEngine 0.4 status fields and sends the bearer token only to the configured origin', async () => {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({
      indexed: true,
      stats: {
        chunkCount: 42,
        fileCount: 7,
        hasEmbeddings: true,
        embeddingModel: 'text-embedding-3-small',
        lastIndexedAt: '2026-07-20T09:30:00.000Z',
        indexVersion: 3,
        hasFts: true,
      },
    }))
    const gateway = new HttpContextEngineGateway({ ...options, fetchImpl: fetchMock as typeof fetch })

    await expect(gateway.status('relay/platform')).resolves.toEqual({
      provider: 'contextengine-plugin',
      repository: 'relay/platform',
      available: true,
      indexed: true,
      revision: 3,
      updatedAt: '2026-07-20T09:30:00.000Z',
      retrievalMode: 'hybrid',
      stats: { files: 7, chunks: 42, symbols: 0, embeddedChunks: 42 },
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://context.example/api/v1/workspaces/workspace-platform/status')
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer context-secret',
      },
    })
  })

  it('converts weighted retrieval channels to channel labels and sends plugin request fields', async () => {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({
      results: [{
        path: 'src/context.ts',
        start_line: 12,
        end_line: 28,
        symbol: 'retrieveContext',
        language: 'typescript',
        content: 'export function retrieveContext() {}',
        preview: 'retrieveContext',
        score: 0.91,
        source: 'hybrid',
        intent: 'implementation',
        channels: { fts: 0.8, symbol: 0, path: 0.2, semantic: 0.7, graph: 0, neural: 0.4 },
      }],
    }))
    const gateway = new HttpContextEngineGateway({ ...options, fetchImpl: fetchMock as typeof fetch })

    const result = await gateway.search({
      repository: 'relay/platform',
      query: 'context retrieval',
      topK: 8,
      mode: 'hybrid',
      pathPrefix: 'src',
      expandGraph: true,
      neuralRerank: true,
    })

    expect(result.hits[0]?.channels).toEqual(['fts', 'path', 'semantic', 'neural'])
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'context retrieval',
      top_k: 8,
      mode: 'hybrid',
      expand_graph: true,
      path_prefix: 'src',
      neural_rerank: true,
    })
  })

  it('fails closed for unknown repositories and malformed upstream responses', async () => {
    const gateway = new HttpContextEngineGateway({
      ...options,
      fetchImpl: (async () => jsonResponse({ results: [{ path: '' }] })) as typeof fetch,
    })

    await expect(gateway.status('other/repository')).rejects.toMatchObject({
      code: 'repository_not_configured',
      retryable: false,
    })
    await expect(gateway.search({
      repository: 'relay/platform',
      query: 'test',
      topK: 5,
      mode: 'auto',
      expandGraph: true,
    })).rejects.toBeInstanceOf(Error)
  })

  it('turns timeouts into retryable service errors', async () => {
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })) as typeof fetch
    const gateway = new HttpContextEngineGateway({ ...options, timeoutMs: 100, fetchImpl })

    await expect(gateway.status('relay/platform')).rejects.toEqual(expect.objectContaining<Partial<ContextEngineGatewayError>>({
      code: 'service_unavailable',
      retryable: true,
      message: 'Context Engine request timed out.',
    }))
  })

  it('rejects oversized responses before buffering or parsing them', async () => {
    const gateway = new HttpContextEngineGateway({
      ...options,
      fetchImpl: (async () => new Response(null, {
        status: 200,
        headers: { 'Content-Length': String(8 * 1024 * 1024 + 1) },
      })) as typeof fetch,
    })

    await expect(gateway.status('relay/platform')).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: false,
    })
  })

  it('caps chunked responses while reading the upstream stream', async () => {
    const oversized = new Uint8Array(8 * 1024 * 1024 + 1)
    const gateway = new HttpContextEngineGateway({
      ...options,
      fetchImpl: (async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(oversized)
          controller.close()
        },
      }), { status: 200 })) as typeof fetch,
    })

    await expect(gateway.status('relay/platform')).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: false,
    })
  })
})
