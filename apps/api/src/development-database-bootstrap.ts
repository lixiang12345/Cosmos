import type { Pool } from 'pg'

const developmentSpaces = [
  {
    id: 'space-commerce',
    name: 'Commerce Engineering',
    repository: 'relay/commerce',
    expertName: 'Commerce Delivery Expert',
  },
  {
    id: 'space-platform',
    name: 'Platform Engineering',
    repository: 'relay/platform',
    expertName: 'Platform Delivery Expert',
  },
] as const

export async function bootstrapDevelopmentDatabase(pool: Pool, actorId: string) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      INSERT INTO relay_organizations (id, name)
      VALUES ('relay', 'Relay')
      ON CONFLICT (id) DO NOTHING
    `)
    await client.query(`
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role)
      VALUES ('relay', $1, 'organization_owner')
      ON CONFLICT (organization_id, actor_id)
      DO UPDATE SET role = EXCLUDED.role
    `, [actorId])

    for (const space of developmentSpaces) {
      const environmentId = `environment-${space.id}`
      const environmentRevisionId = `${environmentId}-revision-1`
      const repositoryId = `repository-${space.id}`
      const expertId = `expert-${space.id}`
      const expertRevisionId = `${expertId}-revision-1`

      await client.query(`
        INSERT INTO relay_spaces (organization_id, id, name)
        VALUES ('relay', $1, $2)
        ON CONFLICT (organization_id, id) DO NOTHING
      `, [space.id, space.name])
      await client.query(`
        INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
        VALUES ('relay', $1, $2, 'space_manager')
        ON CONFLICT (organization_id, space_id, actor_id)
        DO UPDATE SET role = EXCLUDED.role
      `, [space.id, actorId])
      await client.query(`
        INSERT INTO relay_environments (
          organization_id, space_id, id, name, description, status, created_by
        ) VALUES (
          'relay', $1, $2, 'Local Docker Runtime',
          'Ready local execution environment managed by Docker Compose.', 'draft', $3
        )
        ON CONFLICT (organization_id, space_id, id) DO NOTHING
      `, [space.id, environmentId, actorId])
      await client.query(`
        INSERT INTO relay_environment_revisions (
          organization_id, space_id, environment_id, id, revision, status,
          configuration, created_by
        ) VALUES ('relay', $1, $2, $3, 1, 'draft', '{"runtime":"docker-compose"}'::jsonb, $4)
        ON CONFLICT (organization_id, space_id, environment_id, id) DO NOTHING
      `, [space.id, environmentId, environmentRevisionId, actorId])
      await client.query(`
        INSERT INTO relay_environment_revision_repositories (
          organization_id, space_id, environment_id, environment_revision_id,
          repository_id, repository, base_branch, is_default
        )
        SELECT 'relay', $1, $2, $3, $4, $5, 'main', true
        WHERE NOT EXISTS (
          SELECT 1
          FROM relay_environment_revision_repositories
          WHERE organization_id = 'relay'
            AND space_id = $1
            AND environment_id = $2
            AND environment_revision_id = $3
            AND repository_id = $4
        )
      `, [
        space.id,
        environmentId,
        environmentRevisionId,
        repositoryId,
        space.repository,
      ])
      await client.query(`
        UPDATE relay_environment_revisions
        SET status = 'ready'
        WHERE organization_id = 'relay'
          AND space_id = $1
          AND environment_id = $2
          AND id = $3
          AND status = 'draft'
      `, [space.id, environmentId, environmentRevisionId])
      await client.query(`
        UPDATE relay_environments
        SET status = 'ready', active_revision_id = $3
        WHERE organization_id = 'relay'
          AND space_id = $1
          AND id = $2
          AND status = 'draft'
          AND active_revision_id IS NULL
      `, [space.id, environmentId, environmentRevisionId])
      await client.query(`
        INSERT INTO relay_experts (
          organization_id, space_id, id, name, description, visibility, status, created_by
        ) VALUES (
          'relay', $1, $2, $3,
          'General-purpose software delivery Expert for the local runtime.',
          'space', 'draft', $4
        )
        ON CONFLICT (organization_id, space_id, id) DO NOTHING
      `, [space.id, expertId, space.expertName, actorId])
      await client.query(`
        INSERT INTO relay_expert_revisions (
          organization_id, space_id, expert_id, id, revision, status,
          environment_id, environment_revision_id,
          allow_repository_override, allow_base_branch_override,
          instructions, model, configuration, created_by
        ) VALUES (
          'relay', $1, $2, $3, 1, 'draft', $4, $5, true, true,
          'Plan the work, inspect repository evidence, implement carefully, and verify the result.',
          'gpt-5.6-sol', '{}', $6
        )
        ON CONFLICT (organization_id, space_id, expert_id, id) DO NOTHING
      `, [
        space.id,
        expertId,
        expertRevisionId,
        environmentId,
        environmentRevisionId,
        actorId,
      ])
      await client.query(`
        UPDATE relay_expert_revisions
        SET status = 'published'
        WHERE organization_id = 'relay'
          AND space_id = $1
          AND expert_id = $2
          AND id = $3
          AND status = 'draft'
      `, [space.id, expertId, expertRevisionId])
      await client.query(`
        UPDATE relay_experts
        SET status = 'published', published_revision_id = $3
        WHERE organization_id = 'relay'
          AND space_id = $1
          AND id = $2
          AND status = 'draft'
          AND published_revision_id IS NULL
      `, [space.id, expertId, expertRevisionId])
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
