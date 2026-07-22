import { describe, expect, it } from 'vitest'
import {
  EnvironmentDetailDtoSchema,
  EnvironmentListResponseSchema,
  EnvironmentStatusSchema,
  EnvironmentSummaryDtoSchema,
  EnvironmentTypeSchema,
  EnvironmentVisibilitySchema,
} from '../src/environment.js'

const defaultRepository = {
  repositoryId: 'repository-checkout',
  repository: 'commerce/checkout',
  baseBranch: 'main',
  isDefault: true,
} as const

const activeRevision = {
  id: 'environment-revision-3',
  environmentId: 'environment-commerce',
  revision: 3,
  status: 'ready',
  image: 'ghcr.io/cosmos/runtime:stable',
  repositoryBindings: [defaultRepository],
  variableReferences: [],
  hooks: [],
  networkPolicy: { mode: 'restricted', allowedHosts: [] },
  sharing: 'space',
  daemonPoolId: null,
  checksum: 'a'.repeat(64),
  defaultRepository,
  createdAt: '2026-07-13T08:00:00.000Z',
} as const

const latestRevision = {
  id: activeRevision.id,
  environmentId: activeRevision.environmentId,
  revision: activeRevision.revision,
  status: activeRevision.status,
  image: activeRevision.image,
  repositoryBindings: activeRevision.repositoryBindings,
  variableReferences: activeRevision.variableReferences,
  hooks: activeRevision.hooks,
  networkPolicy: activeRevision.networkPolicy,
  sharing: activeRevision.sharing,
  daemonPoolId: activeRevision.daemonPoolId,
  checksum: activeRevision.checksum,
  createdAt: activeRevision.createdAt,
} as const

const activeRevisionSummary = {
  id: activeRevision.id,
  environmentId: activeRevision.environmentId,
  revision: activeRevision.revision,
  status: activeRevision.status,
  defaultRepository: activeRevision.defaultRepository,
  createdAt: activeRevision.createdAt,
} as const

const environmentSummary = {
  id: 'environment-commerce',
  organizationId: 'organization-cosmos',
  spaceId: 'space-commerce',
  type: 'cloud',
  name: 'Commerce runtime',
  description: 'Isolated runtime for commerce repositories.',
  visibility: 'space',
  status: 'ready',
  activeRevisionId: activeRevision.id,
  activeRevision: activeRevisionSummary,
  provisioning: null,
  version: 1,
  createdAt: '2026-07-13T07:00:00.000Z',
  updatedAt: '2026-07-13T08:00:00.000Z',
} as const

describe('Environment contracts', () => {
  it('accepts supported type, status, and visibility projections', () => {
    for (const type of ['cloud', 'daemon']) expect(EnvironmentTypeSchema.parse(type)).toBe(type)
    for (const status of ['draft', 'provisioning', 'ready', 'updating', 'failed', 'disabled', 'archived']) {
      expect(EnvironmentStatusSchema.parse(status)).toBe(status)
    }
    for (const visibility of ['private', 'space']) {
      expect(EnvironmentVisibilitySchema.parse(visibility)).toBe(visibility)
    }

    expect(EnvironmentTypeSchema.safeParse('local').success).toBe(false)
    expect(EnvironmentStatusSchema.safeParse('active').success).toBe(false)
    expect(EnvironmentVisibilitySchema.safeParse('public').success).toBe(false)
  })

  it('accepts a tenant-scoped summary and permits unprojected target-only fields', () => {
    expect(EnvironmentSummaryDtoSchema.parse(environmentSummary)).toEqual(environmentSummary)

    const migrationBackedSummary = {
      id: environmentSummary.id,
      organizationId: environmentSummary.organizationId,
      spaceId: environmentSummary.spaceId,
      type: environmentSummary.type,
      name: environmentSummary.name,
      description: environmentSummary.description,
      visibility: environmentSummary.visibility,
      status: environmentSummary.status,
      activeRevisionId: environmentSummary.activeRevisionId,
      activeRevision: {
        id: activeRevision.id,
        environmentId: activeRevision.environmentId,
        revision: activeRevision.revision,
        status: activeRevision.status,
        defaultRepository: activeRevision.defaultRepository,
        createdAt: activeRevision.createdAt,
      },
      provisioning: null,
      version: environmentSummary.version,
      createdAt: environmentSummary.createdAt,
      updatedAt: environmentSummary.updatedAt,
    }
    expect(EnvironmentSummaryDtoSchema.parse(migrationBackedSummary)).toEqual(migrationBackedSummary)
  })

  it('accepts detail repository bindings and a strict list envelope', () => {
    const detail = {
      ...environmentSummary,
      activeRevision: {
        ...activeRevision,
        repositoryBindings: [
          defaultRepository,
          {
            repositoryId: 'repository-payments',
            repository: 'commerce/payments',
            baseBranch: 'release',
            isDefault: false,
          },
        ],
      },
      latestRevision,
      provisioningHistory: [],
    }

    expect(EnvironmentDetailDtoSchema.parse(detail)).toEqual(detail)
    expect(EnvironmentListResponseSchema.parse({
      items: [environmentSummary],
      page: {
        nextCursor: null,
        hasMore: false,
        projectionUpdatedAt: environmentSummary.updatedAt,
      },
    }).items).toEqual([environmentSummary])
    expect(EnvironmentListResponseSchema.safeParse({
      items: [environmentSummary],
      page: { nextCursor: null, hasMore: true, projectionUpdatedAt: environmentSummary.updatedAt },
    }).success).toBe(false)
    expect(EnvironmentListResponseSchema.safeParse({
      items: Array.from({ length: 101 }, () => environmentSummary),
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: environmentSummary.updatedAt },
    }).success).toBe(false)
  })

  it('enforces active revision identity and ready-state invariants', () => {
    expect(EnvironmentSummaryDtoSchema.safeParse({
      ...environmentSummary,
      activeRevisionId: 'environment-revision-other',
    }).success).toBe(false)
    expect(EnvironmentSummaryDtoSchema.safeParse({
      ...environmentSummary,
      activeRevision: { ...activeRevision, environmentId: 'environment-other' },
    }).success).toBe(false)
    expect(EnvironmentSummaryDtoSchema.safeParse({
      ...environmentSummary,
      activeRevisionId: null,
      activeRevision: null,
    }).success).toBe(false)
  })

  it('requires one unique default repository in a ready revision', () => {
    expect(EnvironmentDetailDtoSchema.safeParse({
      ...environmentSummary,
      activeRevision: {
        ...activeRevision,
        repositoryBindings: [defaultRepository, defaultRepository],
      },
    }).success).toBe(false)
    expect(EnvironmentDetailDtoSchema.safeParse({
      ...environmentSummary,
      activeRevision: {
        ...activeRevision,
        repositoryBindings: [{ ...defaultRepository, isDefault: false }],
      },
    }).success).toBe(false)
    expect(EnvironmentDetailDtoSchema.safeParse({
      ...environmentSummary,
      activeRevision: {
        ...activeRevision,
        defaultRepository: { ...defaultRepository, baseBranch: 'release' },
        repositoryBindings: [defaultRepository],
      },
    }).success).toBe(false)
  })

  it('never accepts arbitrary configuration or Secret values', () => {
    expect(EnvironmentDetailDtoSchema.safeParse({
      ...environmentSummary,
      activeRevision: {
        ...activeRevision,
        repositoryBindings: [defaultRepository],
        configuration: { API_TOKEN: 'plaintext-secret' },
      },
    }).success).toBe(false)
    expect(EnvironmentDetailDtoSchema.safeParse({
      ...environmentSummary,
      activeRevision: {
        ...activeRevision,
        repositoryBindings: [defaultRepository],
        variableReferences: [{ name: 'API_TOKEN', secretId: 'secret-api', value: 'plaintext-secret' }],
      },
    }).success).toBe(false)
    expect(EnvironmentSummaryDtoSchema.safeParse({ ...environmentSummary, unexpected: true }).success).toBe(false)
    expect(EnvironmentSummaryDtoSchema.safeParse({ ...environmentSummary, version: 0 }).success).toBe(false)
  })
})
