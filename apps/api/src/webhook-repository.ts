import type {
  CreateWebhookRequest,
  WebhookDto,
  WebhookMutationResponse,
} from '@cosmos/contracts'

export type WebhookScope = {
  organizationId: string
  spaceId: string
  actorId: string
  requestId: string
}

export type WebhookMutationScope = WebhookScope & {
  webhookId: string
  expectedVersion: number
  idempotencyKey: string
}

export interface WebhookRepository {
  listWebhooks(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ items: WebhookDto[]; nextCursor: string | null; hasMore: boolean }>
  getWebhook(
    organizationId: string,
    spaceId: string,
    webhookId: string,
    actorId: string,
  ): Promise<WebhookDto | null>
  createWebhook(
    scope: WebhookScope & { idempotencyKey: string; request: CreateWebhookRequest },
  ): Promise<WebhookMutationResponse>
  archiveWebhook(scope: WebhookMutationScope): Promise<WebhookMutationResponse | null>
}

export class WebhookVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super(`Webhook version ${expectedVersion} does not match current version ${actualVersion}.`)
    this.name = 'WebhookVersionConflictError'
  }
}

export class WebhookIdempotencyConflictError extends Error {
  constructor() {
    super('The Idempotency-Key was already used with a different Webhook request.')
    this.name = 'WebhookIdempotencyConflictError'
  }
}

export class WebhookDuplicateError extends Error {
  constructor(readonly scope: string, readonly name: string) {
    super(`An active ${scope} Webhook named ${name} already exists in this Space.`)
    this.name = 'WebhookDuplicateError'
  }
}

export class EmptyWebhookRepository implements WebhookRepository {
  async listWebhooks() {
    return { items: [], nextCursor: null, hasMore: false }
  }

  async getWebhook() {
    return null
  }

  async createWebhook(): Promise<WebhookMutationResponse> {
    throw new Error('WebhookRepository not configured.')
  }

  async archiveWebhook() {
    return null
  }
}
