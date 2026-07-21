import {
  ContextEngineHitSchema,
  ContextEngineStatusSchema,
  ContextPackResponseSchema,
  ContextSearchResponseSchema,
  type ContextEngineHit,
  type ContextEngineStatus,
  type ContextPackRequest,
  type ContextPackResponse,
  type ContextSearchRequest,
  type ContextSearchResponse,
} from '@relay/contracts'

export type ContextEngineGatewayErrorCode =
  | 'repository_not_configured'
  | 'service_unavailable'
  | 'upstream_error'
  | 'invalid_response'

export class ContextEngineGatewayError extends Error {
  readonly code: ContextEngineGatewayErrorCode
  readonly retryable: boolean
  readonly upstreamStatus?: number

  constructor(options: {
    code: ContextEngineGatewayErrorCode
    message: string
    retryable: boolean
    upstreamStatus?: number
  }) {
    super(options.message)
    this.name = 'ContextEngineGatewayError'
    this.code = options.code
    this.retryable = options.retryable
    this.upstreamStatus = options.upstreamStatus
  }
}

export interface ContextEngineGateway {
  hasRepository(repository: string): boolean
  status(repository: string, signal?: AbortSignal): Promise<ContextEngineStatus>
  search(request: ContextSearchRequest, signal?: AbortSignal): Promise<ContextSearchResponse>
  pack(request: ContextPackRequest, signal?: AbortSignal): Promise<ContextPackResponse>
}

export type HttpContextEngineGatewayOptions = {
  baseUrl: string
  apiKey: string
  workspaces: Readonly<Record<string, string>>
  timeoutMs?: number
  allowInsecureHttp?: boolean
  fetchImpl?: typeof fetch
}

type JsonRecord = Record<string, unknown>

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readInteger(record: JsonRecord | null, keys: readonly string[]) {
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  }
  return 0
}

function readString(record: JsonRecord, key: string, fallback = '') {
  const value = record[key]
  return typeof value === 'string' ? value : fallback
}

function readBoolean(record: JsonRecord | null, keys: readonly string[]) {
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === 'boolean') return value
  }
  return false
}

function readDate(record: JsonRecord | null, keys: readonly string[]) {
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value
  }
  return null
}

function oversizedResponseError() {
  return new ContextEngineGatewayError({
    code: 'invalid_response',
    message: 'Context Engine response exceeded the configured safety limit.',
    retryable: false,
  })
}

async function readBoundedResponseText(response: Response) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isSafeInteger(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw oversizedResponseError()
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (!next.value) continue
      total += next.value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw oversizedResponseError()
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString('utf8')
}

function resolveEndpoint(value: string, allowInsecureHttp: boolean) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Context Engine base URL must be a valid URL.')
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (loopback || allowInsecureHttp))) {
    throw new Error('Context Engine base URL must use HTTPS except for loopback development.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Context Engine base URL must not contain credentials, a query, or a fragment.')
  }
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`
  return url
}

function validateApiKey(value: string) {
  if (!value || value !== value.trim() || /[\r\n]/.test(value)) {
    throw new Error('Context Engine API key must be a non-empty bearer token.')
  }
  return value
}

function validateWorkspaces(workspaces: Readonly<Record<string, string>>) {
  const entries = Object.entries(workspaces)
  if (entries.length === 0) throw new Error('At least one Context Engine workspace mapping is required.')
  return new Map(entries.map(([repository, workspaceId]) => {
    const normalizedRepository = repository.trim()
    const normalizedWorkspaceId = workspaceId.trim()
    if (!normalizedRepository || normalizedRepository.length > 512) {
      throw new Error('Context Engine repository names must contain between 1 and 512 characters.')
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalizedWorkspaceId)) {
      throw new Error(`Context Engine workspace id for ${normalizedRepository} is invalid.`)
    }
    return [normalizedRepository, normalizedWorkspaceId] as const
  }))
}

function normalizeHit(value: unknown): ContextEngineHit {
  if (!isRecord(value)) {
    throw new ContextEngineGatewayError({
      code: 'invalid_response',
      message: 'Context Engine returned an invalid retrieval hit.',
      retryable: false,
    })
  }
  const channels = isRecord(value.channels)
    ? Object.entries(value.channels)
      .filter(([, score]) => typeof score === 'number' && score > 0)
      .map(([channel]) => channel)
      .slice(0, 20)
    : Array.isArray(value.channels)
      ? value.channels.filter((channel): channel is string => typeof channel === 'string').slice(0, 20)
      : []
  return ContextEngineHitSchema.parse({
    path: readString(value, 'path'),
    startLine: value.start_line,
    endLine: value.end_line,
    symbol: typeof value.symbol === 'string' && value.symbol.trim() ? value.symbol : null,
    language: readString(value, 'language', 'unknown') || 'unknown',
    content: readString(value, 'content').slice(0, 200_000),
    preview: readString(value, 'preview', readString(value, 'content')).slice(0, 20_000),
    score: value.score,
    source: readString(value, 'source', 'hybrid') || 'hybrid',
    intent: typeof value.intent === 'string' && value.intent.trim() ? value.intent : null,
    channels,
  })
}

export class HttpContextEngineGateway implements ContextEngineGateway {
  private readonly endpoint: URL
  private readonly apiKey: string
  private readonly workspaces: ReadonlyMap<string, string>
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: HttpContextEngineGatewayOptions) {
    this.endpoint = resolveEndpoint(options.baseUrl, options.allowInsecureHttp === true)
    this.apiKey = validateApiKey(options.apiKey)
    this.workspaces = validateWorkspaces(options.workspaces)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 120_000) {
      throw new Error('Context Engine timeout must be an integer between 100 and 120000 milliseconds.')
    }
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  hasRepository(repository: string) {
    return this.workspaces.has(repository.trim())
  }

  async status(repository: string, signal?: AbortSignal): Promise<ContextEngineStatus> {
    const workspaceId = this.requireWorkspace(repository)
    const payload = await this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/status`, { method: 'GET' }, signal)
    const workspace = isRecord(payload.workspace) ? payload.workspace : null
    const stats = isRecord(payload.stats) ? payload.stats : null
    const hasEmbeddings = readBoolean(stats, ['hasEmbeddings', 'has_embeddings'])
    const chunks = readInteger(stats, ['chunkCount', 'chunk_count', 'chunks', 'totalChunks', 'total_chunks'])
    const embeddedChunks = readInteger(stats, [
      'embeddedChunks', 'embedded_chunks', 'chunksWithEmbeddings', 'chunks_with_embeddings', 'embeddingCount',
    ]) || (hasEmbeddings ? chunks : 0)
    const indexVersion = readInteger(stats, ['indexVersion', 'index_version'])
    return ContextEngineStatusSchema.parse({
      provider: 'contextengine-plugin',
      repository: repository.trim(),
      available: true,
      indexed: payload.indexed === true || chunks > 0,
      revision: indexVersion || (typeof workspace?.revision === 'number' ? workspace.revision : null),
      updatedAt: readDate(stats, ['lastIndexedAt', 'last_indexed_at']) ?? (typeof workspace?.updated_at === 'string' ? workspace.updated_at : null),
      retrievalMode: hasEmbeddings ? 'hybrid' : 'bm25',
      stats: {
        files: readInteger(stats, ['fileCount', 'file_count', 'files', 'totalFiles', 'total_files']),
        chunks,
        symbols: readInteger(stats, ['symbols', 'symbolCount', 'symbol_count', 'totalSymbols', 'total_symbols']),
        embeddedChunks,
      },
    })
  }

  async search(request: ContextSearchRequest, signal?: AbortSignal): Promise<ContextSearchResponse> {
    const startedAt = Date.now()
    const workspaceId = this.requireWorkspace(request.repository)
    const payload = await this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/search`, {
      method: 'POST',
      body: JSON.stringify({
        query: request.query,
        top_k: request.topK,
        mode: request.mode,
        expand_graph: request.expandGraph,
        ...(request.pathPrefix ? { path_prefix: request.pathPrefix } : {}),
        ...(request.language ? { language: request.language } : {}),
        ...(request.neuralRerank === undefined ? {} : { neural_rerank: request.neuralRerank }),
      }),
    }, signal)
    const hits = Array.isArray(payload.results) ? payload.results.map(normalizeHit) : []
    return ContextSearchResponseSchema.parse({
      provider: 'contextengine-plugin',
      repository: request.repository,
      query: request.query,
      mode: request.mode,
      durationMs: Date.now() - startedAt,
      hits,
    })
  }

  async pack(request: ContextPackRequest, signal?: AbortSignal): Promise<ContextPackResponse> {
    const startedAt = Date.now()
    const workspaceId = this.requireWorkspace(request.repository)
    const payload = await this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/context`, {
      method: 'POST',
      body: JSON.stringify({
        task: request.task,
        top_k: request.topK,
        max_tokens: request.maxTokens,
        ...(request.pathPrefix ? { path_prefix: request.pathPrefix } : {}),
      }),
    }, signal)
    const hits = Array.isArray(payload.hits) ? payload.hits.map(normalizeHit) : []
    return ContextPackResponseSchema.parse({
      provider: 'contextengine-plugin',
      repository: request.repository,
      task: readString(payload, 'task', request.task),
      packedText: readString(payload, 'packed_text').slice(0, 1_000_000),
      estimatedTokens: payload.estimated_tokens,
      truncated: payload.truncated === true,
      durationMs: Date.now() - startedAt,
      hits,
    })
  }

  private requireWorkspace(repository: string) {
    const normalized = repository.trim()
    const workspaceId = this.workspaces.get(normalized)
    if (!workspaceId) {
      throw new ContextEngineGatewayError({
        code: 'repository_not_configured',
        message: `Context Engine is not configured for repository ${normalized}.`,
        retryable: false,
      })
    }
    return workspaceId
  }

  private async request(pathname: string, init: RequestInit, outerSignal?: AbortSignal) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    const abortFromOuter = () => controller.abort()
    outerSignal?.addEventListener('abort', abortFromOuter, { once: true })
    try {
      const response = await this.fetchImpl(new URL(pathname.replace(/^\//, ''), this.endpoint), {
        ...init,
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      })
      const body = await readBoundedResponseText(response)
      let payload: unknown
      try {
        payload = body ? JSON.parse(body) : {}
      } catch {
        throw new ContextEngineGatewayError({
          code: 'invalid_response',
          message: 'Context Engine returned a non-JSON response.',
          retryable: false,
        })
      }
      if (!response.ok) {
        const upstreamError = isRecord(payload) && isRecord(payload.error) ? payload.error : null
        throw new ContextEngineGatewayError({
          code: response.status >= 500 ? 'service_unavailable' : 'upstream_error',
          message: upstreamError && typeof upstreamError.message === 'string'
            ? upstreamError.message
            : `Context Engine request failed with status ${response.status}.`,
          retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
          upstreamStatus: response.status,
        })
      }
      if (!isRecord(payload)) {
        throw new ContextEngineGatewayError({
          code: 'invalid_response',
          message: 'Context Engine returned an invalid response envelope.',
          retryable: false,
        })
      }
      return payload
    } catch (error) {
      if (error instanceof ContextEngineGatewayError) throw error
      if (controller.signal.aborted) {
        throw new ContextEngineGatewayError({
          code: 'service_unavailable',
          message: outerSignal?.aborted ? 'Context Engine request was cancelled.' : 'Context Engine request timed out.',
          retryable: !outerSignal?.aborted,
        })
      }
      throw new ContextEngineGatewayError({
        code: 'service_unavailable',
        message: 'Context Engine could not be reached.',
        retryable: true,
      })
    } finally {
      clearTimeout(timeout)
      outerSignal?.removeEventListener('abort', abortFromOuter)
    }
  }
}
