import { describe, expect, it } from 'vitest'
import {
  CreateSpaceRequestSchema,
  SpaceDtoSchema,
  SpaceMigrationPreviewSchema,
  UpdateSpaceRequestSchema,
} from '../src/index.js'

const space = {
  id: 'space-platform', organizationId: 'cosmos', name: 'Platform', slug: 'platform',
  description: 'Platform workspace.', isDefault: true, status: 'active',
  defaultExpertId: null, defaultEnvironmentId: null, settings: {}, version: 1,
  createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
}

describe('Space contracts', () => {
  it('accepts strict authority DTOs and defaults create descriptions', () => {
    expect(SpaceDtoSchema.parse(space)).toEqual(space)
    expect(CreateSpaceRequestSchema.parse({ name: 'Release Engineering' })).toEqual({
      name: 'Release Engineering', description: '',
    })
    expect(CreateSpaceRequestSchema.safeParse({ name: 'Release', slug: 'Not Valid' }).success).toBe(false)
  })

  it('requires a non-empty update and bounded settings', () => {
    expect(UpdateSpaceRequestSchema.safeParse({}).success).toBe(false)
    expect(UpdateSpaceRequestSchema.parse({ defaultExpertId: null })).toEqual({ defaultExpertId: null })
    expect(UpdateSpaceRequestSchema.safeParse({ settings: { value: 'x'.repeat(17_000) } }).success).toBe(false)
  })

  it('keeps migration preview tied to source, target, counts, and blockers', () => {
    expect(SpaceMigrationPreviewSchema.parse({
      source: space,
      target: { ...space, id: 'space-commerce', slug: 'commerce', name: 'Commerce', isDefault: false },
      resourceCounts: { sessions: 2, experts: 1, environments: 1, automations: 0, files: 3 },
      canMigrate: false,
      blockingReasons: ['The Default Space cannot be migrated.'],
    })).toMatchObject({ canMigrate: false, resourceCounts: { sessions: 2 } })
  })
})
