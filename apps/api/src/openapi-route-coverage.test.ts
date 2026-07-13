import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { createApp } from './app.js'

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
const OPENAPI_PATH = fileURLToPath(new URL('../../../docs/api-contract.yaml', import.meta.url))
const INFRASTRUCTURE_OPERATION_COUNT = 2

type HttpMethod = (typeof HTTP_METHODS)[number]
type Reference = { $ref: string }
type MediaType = { schema?: Reference }
type Response = Partial<Reference> & {
  description?: string
  content?: Record<string, MediaType>
}
type Operation = {
  operationId?: string
  requestBody?: { content?: Record<string, MediaType> }
  responses?: Record<string, Response>
  'x-relay-implementation-status'?: 'implemented' | 'partial'
}
type PathItem = Partial<Record<HttpMethod, Operation>> & {
  parameters?: Reference[]
}
type OpenApiDocument = {
  paths: Record<string, PathItem>
  components: {
    responses: Record<string, {
      content?: Record<string, { schema?: Reference }>
    }>
  }
}

function implementedOperations(document: OpenApiDocument) {
  return Object.entries(document.paths).flatMap(([path, pathItem]) => HTTP_METHODS.flatMap((method) => {
    const operation = pathItem[method]
    return operation?.['x-relay-implementation-status'] === 'implemented'
      || operation?.['x-relay-implementation-status'] === 'partial'
      ? [{ method, operation, path, pathItem }]
      : []
  }))
}

function fastifyPath(path: string) {
  return `/api/v1${path.replaceAll(/\{([^}]+)\}/g, ':$1')}`
}

function registeredOperationCount(routes: string) {
  return [...routes.matchAll(/\(([^)]+)\)/g)]
    .flatMap((match) => match[1]?.split(',').map((method) => method.trim()) ?? [])
    .filter((method) => method !== 'HEAD' && method !== 'OPTIONS')
    .length
}

describe('OpenAPI runtime route coverage', () => {
  const app = createApp()
  const document = parse(readFileSync(OPENAPI_PATH, 'utf8')) as OpenApiDocument

  afterAll(async () => {
    await app.close()
  })

  it('keeps every implemented OpenAPI operation aligned with the Fastify route registry', async () => {
    await app.ready()
    const operations = implementedOperations(document)

    for (const { method, operation, path } of operations) {
      expect(
        app.hasRoute({ method: method.toUpperCase() as Uppercase<HttpMethod>, url: fastifyPath(path) }),
        `${method.toUpperCase()} ${path} (${operation.operationId ?? 'missing operationId'})`,
      ).toBe(true)
    }

    expect(app.hasRoute({ method: 'GET', url: '/api/health' })).toBe(true)
    expect(app.hasRoute({ method: 'GET', url: '/api/ready' })).toBe(true)
    expect(registeredOperationCount(app.printRoutes({ commonPrefix: false, includeHooks: false })))
      .toBe(operations.length + INFRASTRUCTURE_OPERATION_COUNT)
  })

  it('uses opaque Session identifiers and the runtime JSON error envelope for implemented operations', () => {
    const operations = implementedOperations(document)
    const sessionOperations = operations.filter(({ path }) => path.includes('/sessions'))

    for (const { operation } of operations) {
      expect(operation.responses?.['401'], `${operation.operationId} must document authentication failure`)
        .toBeDefined()
      expect(operation.responses?.['500'], `${operation.operationId} must document internal failure`)
        .toBeDefined()
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (Number(status) < 400) continue
        expect(response.$ref, `${operation.operationId} ${status}`).toMatch(/^#\/components\/responses\/Runtime/)
        const responseName = response.$ref?.split('/').at(-1)
        const errorSchema = responseName
          ? document.components.responses[responseName]?.content?.['application/json']?.schema?.$ref
          : undefined
        expect(errorSchema, `${operation.operationId} ${status}`).toBe('#/components/schemas/RuntimeApiError')
      }
    }

    for (const { path, pathItem } of sessionOperations) {
      const parameterRefs = pathItem.parameters?.map((parameter) => parameter.$ref) ?? []
      expect(parameterRefs, path).toContain('#/components/parameters/RuntimeOrganizationId')
      expect(parameterRefs, path).toContain('#/components/parameters/RuntimeSpaceId')
      if (path.includes('{sessionId}')) {
        expect(parameterRefs, path).toContain('#/components/parameters/SessionId')
      }
    }

    const collection = document.paths['/organizations/{organizationId}/spaces/{spaceId}/sessions']
    const detail = document.paths['/organizations/{organizationId}/spaces/{spaceId}/sessions/{sessionId}']
    const start = document.paths['/organizations/{organizationId}/spaces/{spaceId}/sessions/{sessionId}/start']
    const messages = document.paths['/organizations/{organizationId}/spaces/{spaceId}/sessions/{sessionId}/messages']
    const pause = document.paths['/organizations/{organizationId}/spaces/{spaceId}/sessions/{sessionId}/pause']
    const resume = document.paths['/organizations/{organizationId}/spaces/{spaceId}/sessions/{sessionId}/resume']
    const cancel = document.paths['/organizations/{organizationId}/spaces/{spaceId}/sessions/{sessionId}/cancel']
    const retry = document.paths['/organizations/{organizationId}/spaces/{spaceId}/sessions/{sessionId}/turns/{turnId}/retry']
    expect(collection?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref)
      .toBe('#/components/schemas/RuntimeSessionListResponse')
    expect(collection?.post?.requestBody?.content?.['application/json']?.schema?.$ref)
      .toBe('#/components/schemas/RuntimeSessionCreate')
    expect(collection?.post?.responses?.['201']?.content?.['application/json']?.schema?.$ref)
      .toBe('#/components/schemas/RuntimeSessionCreateResult')
    expect(detail?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref)
      .toBe('#/components/schemas/RuntimeSession')
    expect(start?.post?.requestBody).toBeUndefined()
    expect(start?.post?.responses?.['202']?.content?.['application/json']?.schema?.$ref)
      .toBe('#/components/schemas/RuntimeSessionStartResult')
    expect(messages?.post?.requestBody?.content?.['application/json']?.schema?.$ref)
      .toBe('#/components/schemas/RuntimeSessionMessageCreate')
    expect(messages?.post?.responses?.['202']?.content?.['application/json']?.schema?.$ref)
      .toBe('#/components/schemas/RuntimeSessionSendResult')
    for (const control of [pause, resume, cancel]) {
      expect(control?.post?.responses?.['202']?.content?.['application/json']?.schema?.$ref)
        .toBe('#/components/schemas/RuntimeSessionControlResult')
    }
    expect(cancel?.post?.requestBody?.content?.['application/json']?.schema?.$ref)
      .toBe('#/components/schemas/RuntimeCancelSessionRequest')
    expect(retry?.post?.requestBody).toBeUndefined()
    expect(retry?.post?.responses?.['202']?.content?.['application/json']?.schema?.$ref)
      .toBe('#/components/schemas/RuntimeRetryTurnResult')
  })
})
