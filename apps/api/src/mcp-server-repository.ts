import type {
  CreateMcpServerRequest,
  McpServerDto,
  McpServerMutationResponse,
  UpdateMcpServerRequest,
} from '@cosmos/contracts'

export type McpServerScope = {
  organizationId: string
  spaceId: string
  actorId: string
  requestId: string
}

export type McpServerMutationScope = McpServerScope & {
  mcpServerId: string
  expectedVersion: number
  idempotencyKey: string
}

export interface McpServerRepository {
  listMcpServers(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ items: McpServerDto[]; nextCursor: string | null; hasMore: boolean }>
  getMcpServer(
    organizationId: string,
    spaceId: string,
    mcpServerId: string,
    actorId: string,
  ): Promise<McpServerDto | null>
  createMcpServer(
    scope: McpServerScope & { idempotencyKey: string; request: CreateMcpServerRequest },
  ): Promise<McpServerMutationResponse>
  updateMcpServer(
    scope: McpServerMutationScope & { request: UpdateMcpServerRequest },
  ): Promise<McpServerMutationResponse | null>
  archiveMcpServer(scope: McpServerMutationScope): Promise<McpServerMutationResponse | null>
}

export class McpServerVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super(`MCP server version ${expectedVersion} does not match current version ${actualVersion}.`)
    this.name = 'McpServerVersionConflictError'
  }
}

export class McpServerIdempotencyConflictError extends Error {
  constructor() {
    super('The Idempotency-Key was already used with a different MCP server request.')
    this.name = 'McpServerIdempotencyConflictError'
  }
}

export class McpServerDuplicateError extends Error {
  constructor(readonly name: string) {
    super(`An MCP server named ${name} is already registered in this Space.`)
    this.name = 'McpServerDuplicateError'
  }
}

export class EmptyMcpServerRepository implements McpServerRepository {
  async listMcpServers() {
    return { items: [], nextCursor: null, hasMore: false }
  }

  async getMcpServer() {
    return null
  }

  async createMcpServer(): Promise<McpServerMutationResponse> {
    throw new Error('McpServerRepository not configured.')
  }

  async updateMcpServer() {
    return null
  }

  async archiveMcpServer() {
    return null
  }
}
