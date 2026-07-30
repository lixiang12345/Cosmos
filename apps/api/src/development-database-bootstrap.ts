import type { Pool } from 'pg'

const developmentSpaces = [
  {
    id: 'space-commerce',
    name: 'Commerce Engineering',
    repository: 'cosmos/commerce',
    expertName: 'Commerce Delivery Expert',
  },
  {
    id: 'space-platform',
    name: 'Platform Engineering',
    repository: 'cosmos/platform',
    expertName: 'Platform Delivery Expert',
  },
] as const

const advisorInstructions = `You are Cosmos Advisor, a built-in control-plane Expert. Ask only for missing information. For any supported configuration change, call advisor_plan_propose exactly once with a concise summary, dependencies, risks, and at most one controlled mutation. Supported mutations are space.update for the current Space description/default Expert/default Environment, and organization.set_default_space for the current Space. Represent OAuth and Secret work only as manual_action steps. Never request, read, repeat, or store a Secret value or OAuth token. Never claim a change completed before the governed tool result and explicit user confirmation.`

export async function bootstrapDevelopmentDatabase(pool: Pool, actorId: string) {
  const automationServiceAccountId = 'service-account-automation-local'
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      INSERT INTO cosmos_organizations (id, name)
      VALUES ('cosmos', 'Cosmos')
      ON CONFLICT (id) DO NOTHING
    `)
    await client.query(`
      INSERT INTO cosmos_organization_memberships (organization_id, actor_id, role)
      VALUES ('cosmos', $1, 'organization_owner')
      ON CONFLICT (organization_id, actor_id)
      DO UPDATE SET role = EXCLUDED.role
    `, [actorId])
    await client.query(`
      INSERT INTO cosmos_organization_memberships (organization_id, actor_id, role)
      VALUES ('cosmos', $1, 'member')
      ON CONFLICT (organization_id, actor_id) DO UPDATE SET role = EXCLUDED.role
    `, [automationServiceAccountId])
    await client.query(`
      INSERT INTO cosmos_service_accounts (organization_id, id, audience, status)
      VALUES ('cosmos', $1, 'cosmos-automation-local', 'active')
      ON CONFLICT (organization_id, id) DO UPDATE
      SET audience = EXCLUDED.audience, status = 'active', revoked_at = NULL
    `, [automationServiceAccountId])

    for (const space of developmentSpaces) {
      const environmentId = `environment-${space.id}`
      const environmentRevisionId = `${environmentId}-revision-1`
      const repositoryId = `repository-${space.id}`
      const expertId = `expert-${space.id}`
      const expertRevisionId = `${expertId}-revision-1`
      const advisorId = `expert-advisor-${space.id}`
      const advisorRevisionId = `${advisorId}-revision-1`

      await client.query(`
        INSERT INTO cosmos_spaces (organization_id, id, name)
        VALUES ('cosmos', $1, $2)
        ON CONFLICT (organization_id, id) DO NOTHING
      `, [space.id, space.name])
      await client.query(`
        INSERT INTO cosmos_space_memberships (organization_id, space_id, actor_id, role)
        VALUES ('cosmos', $1, $2, 'space_manager')
        ON CONFLICT (organization_id, space_id, actor_id)
        DO UPDATE SET role = EXCLUDED.role
      `, [space.id, actorId])
      await client.query(`
        INSERT INTO cosmos_environments (
          organization_id, space_id, id, name, description, status, created_by
        ) VALUES (
          'cosmos', $1, $2, 'Local Docker Runtime',
          'Ready local execution environment managed by Docker Compose.', 'draft', $3
        )
        ON CONFLICT (organization_id, space_id, id) DO NOTHING
      `, [space.id, environmentId, actorId])
      await client.query(`
        INSERT INTO cosmos_environment_revisions (
          organization_id, space_id, environment_id, id, revision, status,
          configuration, created_by
        ) VALUES ('cosmos', $1, $2, $3, 1, 'draft', '{"runtime":"docker-compose","image":"ghcr.io/cosmos/runtime:stable","variableReferences":[],"hooks":[],"networkPolicy":{"mode":"restricted","allowedHosts":[]},"sharing":"space","daemonPoolId":null}'::jsonb, $4)
        ON CONFLICT (organization_id, space_id, environment_id, id) DO NOTHING
      `, [space.id, environmentId, environmentRevisionId, actorId])
      await client.query(`
        INSERT INTO cosmos_environment_revision_repositories (
          organization_id, space_id, environment_id, environment_revision_id,
          repository_id, repository, base_branch, is_default
        )
        SELECT 'cosmos', $1, $2, $3, $4, $5, 'main', true
        WHERE NOT EXISTS (
          SELECT 1
          FROM cosmos_environment_revision_repositories
          WHERE organization_id = 'cosmos'
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
        UPDATE cosmos_environment_revisions
        SET status = 'ready'
        WHERE organization_id = 'cosmos'
          AND space_id = $1
          AND environment_id = $2
          AND id = $3
          AND status = 'draft'
      `, [space.id, environmentId, environmentRevisionId])
      await client.query(`
        UPDATE cosmos_environments
        SET status = 'ready', active_revision_id = $3
        WHERE organization_id = 'cosmos'
          AND space_id = $1
          AND id = $2
          AND status = 'draft'
          AND active_revision_id IS NULL
      `, [space.id, environmentId, environmentRevisionId])
      await client.query(`
        INSERT INTO cosmos_experts (
          organization_id, space_id, id, name, description, visibility, status, created_by
        ) VALUES (
          'cosmos', $1, $2, $3,
          'General-purpose software delivery Expert for the local runtime.',
          'space', 'draft', $4
        )
        ON CONFLICT (organization_id, space_id, id) DO NOTHING
      `, [space.id, expertId, space.expertName, actorId])
      await client.query(`
        INSERT INTO cosmos_expert_revisions (
          organization_id, space_id, expert_id, id, revision, status,
          environment_id, environment_revision_id,
          allow_repository_override, allow_base_branch_override,
          instructions, model, configuration, created_by
        ) VALUES (
          'cosmos', $1, $2, $3, 1, 'draft', $4, $5, true, true,
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
        UPDATE cosmos_expert_revisions
        SET status = 'published'
        WHERE organization_id = 'cosmos'
          AND space_id = $1
          AND expert_id = $2
          AND id = $3
          AND status = 'draft'
      `, [space.id, expertId, expertRevisionId])
      await client.query(`
        UPDATE cosmos_experts
        SET status = 'published', published_revision_id = $3
        WHERE organization_id = 'cosmos'
          AND space_id = $1
          AND id = $2
          AND status = 'draft'
          AND published_revision_id IS NULL
      `, [space.id, expertId, expertRevisionId])
      const officialBuiltInExperts = [
        {
          idSuffix: 'delivery',
          name: 'Software Delivery Expert',
          description: 'General-purpose software engineering Expert for full-stack feature delivery, refactoring, and code review.',
          instructions: 'Plan the work, inspect repository evidence, implement carefully across contracts, API, and Web, and verify with automated checks.',
        },
        {
          idSuffix: 'debugger',
          name: 'Bug & Incident Debugger',
          description: 'Specialized Expert for analyzing log tracebacks, isolating root causes, and applying regression fixes.',
          instructions: 'Always read raw failure tracebacks first. Identify the precise root cause before touching code. Do not patch symptoms without fixing underlying contracts.',
        },
        {
          idSuffix: 'architect',
          name: 'Architecture & Refactoring Expert',
          description: 'Focuses on codebase structure, API contracts, domain isolation, and large-scale refactoring.',
          instructions: 'Audit existing decoupling before writing custom helpers. Preserve API contracts, tenant isolation, and optimistic concurrency.',
        },
        {
          idSuffix: 'qa',
          name: 'Quality & Test Automation Expert',
          description: 'Specialized Expert for writing comprehensive unit, integration, and end-to-end tests.',
          instructions: 'Cover positive paths, edge cases, error conditions, and RLS tenant boundaries. Verify test coverage with pnpm check.',
        },
        {
          idSuffix: 'devops',
          name: 'DevOps & Infrastructure Expert',
          description: 'Specialized Expert for CI/CD automation, Docker runtime setup, environment configuration, and database migrations.',
          instructions: 'Ensure non-destructive zero-downtime database migrations, idempotent scripts, and secure secret injection via environment variables.',
        },
      ]

      for (const builtin of officialBuiltInExperts) {
        const builtinId = `expert-builtin-${builtin.idSuffix}-${space.id}`
        const builtinRevisionId = `${builtinId}-revision-1`
        await client.query(`
          INSERT INTO cosmos_experts (
            organization_id, space_id, id, kind, name, description, visibility, status, created_by
          ) VALUES (
            'cosmos', $1, $2, 'built_in', $3, $4, 'space', 'draft', $5
          )
          ON CONFLICT (organization_id, space_id, id) DO NOTHING
        `, [space.id, builtinId, builtin.name, builtin.description, actorId])
        await client.query(`
          INSERT INTO cosmos_expert_revisions (
            organization_id, space_id, expert_id, id, revision, status,
            environment_id, environment_revision_id,
            allow_repository_override, allow_base_branch_override,
            instructions, model, configuration, created_by
          ) VALUES (
            'cosmos', $1, $2, $3, 1, 'draft', $4, $5, true, true,
            $6, 'gpt-5.6-sol', '{}', $7
          )
          ON CONFLICT (organization_id, space_id, expert_id, id) DO NOTHING
        `, [
          space.id,
          builtinId,
          builtinRevisionId,
          environmentId,
          environmentRevisionId,
          builtin.instructions,
          actorId,
        ])
        await client.query(`
          UPDATE cosmos_expert_revisions
          SET status = 'published'
          WHERE organization_id = 'cosmos' AND space_id = $1 AND expert_id = $2
            AND id = $3 AND status = 'draft'
        `, [space.id, builtinId, builtinRevisionId])
        await client.query(`
          UPDATE cosmos_experts
          SET status = 'published', published_revision_id = $3
          WHERE organization_id = 'cosmos' AND space_id = $1 AND id = $2
            AND status = 'draft' AND published_revision_id IS NULL
        `, [space.id, builtinId, builtinRevisionId])
      }

      await client.query(`
        INSERT INTO cosmos_experts (
          organization_id, space_id, id, kind, name, description, visibility, status, created_by
        ) VALUES (
          'cosmos', $1, $2, 'built_in', 'Cosmos Advisor',
          'Plans and applies bounded control-plane changes after explicit confirmation.',
          'space', 'draft', $3
        )
        ON CONFLICT (organization_id, space_id, id) DO NOTHING
      `, [space.id, advisorId, actorId])
      await client.query(`
        INSERT INTO cosmos_expert_revisions (
          organization_id, space_id, expert_id, id, revision, status,
          environment_id, environment_revision_id,
          allow_repository_override, allow_base_branch_override,
          instructions, model, configuration, created_by
        ) VALUES (
          'cosmos', $1, $2, $3, 1, 'draft', $4, $5, false, false,
          $6, 'gpt-5.6-sol',
          '{"capabilities":["advisor.control_plane.plan"],"launchGuidance":"Describe the Space configuration outcome you want. Cosmos Advisor will show a plan and diff before any write."}'::jsonb,
          $7
        )
        ON CONFLICT (organization_id, space_id, expert_id, id) DO NOTHING
      `, [
        space.id,
        advisorId,
        advisorRevisionId,
        environmentId,
        environmentRevisionId,
        advisorInstructions,
        actorId,
      ])
      await client.query(`
        UPDATE cosmos_expert_revisions
        SET status = 'published'
        WHERE organization_id = 'cosmos' AND space_id = $1 AND expert_id = $2
          AND id = $3 AND status = 'draft'
      `, [space.id, advisorId, advisorRevisionId])
      await client.query(`
        UPDATE cosmos_experts
        SET status = 'published', published_revision_id = $3
        WHERE organization_id = 'cosmos' AND space_id = $1 AND id = $2
          AND status = 'draft' AND published_revision_id IS NULL
      `, [space.id, advisorId, advisorRevisionId])
      await client.query(`
        INSERT INTO cosmos_space_memberships (organization_id, space_id, actor_id, role)
        VALUES ('cosmos', $1, $2, 'member')
        ON CONFLICT (organization_id, space_id, actor_id) DO UPDATE SET role = EXCLUDED.role
      `, [space.id, automationServiceAccountId])
      await client.query(`
        INSERT INTO cosmos_service_account_bindings (
          organization_id, space_id, service_account_id, id,
          scope, resource_type, resource_id
        ) VALUES ('cosmos', $1, $2, $3, 'session.create', 'expert', $4)
        ON CONFLICT (organization_id, space_id, service_account_id, id) DO NOTHING
      `, [
        space.id,
        automationServiceAccountId,
        `binding-automation-${space.id}`,
        expertId,
      ])
    }

    await client.query(`
      UPDATE cosmos_organizations
      SET default_space_id = 'space-platform'
      WHERE id = 'cosmos' AND default_space_id IS NULL
    `)
    for (const space of developmentSpaces) {
      await client.query(`
        UPDATE cosmos_spaces
        SET default_expert_id = COALESCE(default_expert_id, $2),
            default_environment_id = COALESCE(default_environment_id, $3),
            updated_at = GREATEST(updated_at, created_at)
        WHERE organization_id = 'cosmos' AND id = $1
      `, [space.id, `expert-${space.id}`, `environment-${space.id}`])
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
