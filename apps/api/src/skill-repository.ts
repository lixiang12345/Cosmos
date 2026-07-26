import type {
  CreateSkillRequest,
  SkillDto,
  SkillMutationResponse,
  UpdateSkillRequest,
} from '@cosmos/contracts'

export type SkillScope = {
  organizationId: string
  spaceId: string
  actorId: string
  requestId: string
}

export type SkillMutationScope = SkillScope & {
  skillId: string
  expectedVersion: number
  idempotencyKey: string
}

export interface SkillRepository {
  listSkills(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ items: SkillDto[]; nextCursor: string | null; hasMore: boolean }>
  getSkill(
    organizationId: string,
    spaceId: string,
    skillId: string,
    actorId: string,
  ): Promise<SkillDto | null>
  createSkill(
    scope: SkillScope & { idempotencyKey: string; request: CreateSkillRequest },
  ): Promise<SkillMutationResponse>
  updateSkill(
    scope: SkillMutationScope & { request: UpdateSkillRequest },
  ): Promise<SkillMutationResponse | null>
  archiveSkill(scope: SkillMutationScope): Promise<SkillMutationResponse | null>
}

export class SkillVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super(`Skill version ${expectedVersion} does not match current version ${actualVersion}.`)
    this.name = 'SkillVersionConflictError'
  }
}

export class SkillDuplicateError extends Error {
  constructor(readonly skillName: string) {
    super(`A Skill named ${skillName} already exists in this Space.`)
    this.name = 'SkillDuplicateError'
  }
}

export class SkillSourceMismatchError extends Error {
  constructor(readonly field: 'content' | 'url') {
    super('The update does not match the Skill source: inline Skills accept content, url Skills accept a package URL.')
    this.name = 'SkillSourceMismatchError'
  }
}

export class EmptySkillRepository implements SkillRepository {
  async listSkills() {
    return { items: [], nextCursor: null, hasMore: false }
  }

  async getSkill() {
    return null
  }

  async createSkill(): Promise<SkillMutationResponse> {
    throw new Error('SkillRepository not configured.')
  }

  async updateSkill() {
    return null
  }

  async archiveSkill() {
    return null
  }
}
