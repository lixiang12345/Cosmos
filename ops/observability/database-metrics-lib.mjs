const fixedLabel = (value) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')

function metric(name, labels, value) {
  const renderedLabels = Object.entries(labels)
    .map(([key, label]) => `${key}="${fixedLabel(String(label))}"`)
    .join(',')
  return `${name}${renderedLabels ? `{${renderedLabels}}` : ''} ${value}`
}

export async function renderDatabaseMetrics(client, options = {}) {
  const workerFreshnessSeconds = options.workerFreshnessSeconds ?? 30
  const [commands, jobs, worker, outbox] = await Promise.all([
    client.query(`
      WITH statuses(status) AS (VALUES ('accepted'), ('queued'), ('running'))
      SELECT statuses.status, count(command.status)::bigint AS count,
        COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - min(COALESCE(command.queued_at, command.accepted_at)))), 0) AS oldest_age_seconds,
        COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - max(command.heartbeat_at))), 0) AS heartbeat_age_seconds,
        count(command.status) FILTER (WHERE command.lease_expires_at <= clock_timestamp())::bigint AS expired_leases
      FROM statuses
      LEFT JOIN relay_commands command ON command.status = statuses.status
      GROUP BY statuses.status
      ORDER BY statuses.status
    `),
    client.query(`
      WITH statuses(status) AS (VALUES ('queued'), ('running'))
      SELECT statuses.status, count(job.status)::bigint AS count,
        COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - min(COALESCE(job.available_at, job.created_at)))), 0) AS oldest_age_seconds,
        count(job.status) FILTER (WHERE job.lease_expires_at <= clock_timestamp())::bigint AS expired_leases
      FROM statuses
      LEFT JOIN relay_environment_provisioning_jobs job ON job.status = statuses.status
      GROUP BY statuses.status
      ORDER BY statuses.status
    `),
    client.query(`
      SELECT
        count(*) FILTER (WHERE last_seen_at >= clock_timestamp() - ($1::double precision * interval '1 second'))::bigint AS fresh_count,
        count(*) FILTER (WHERE last_seen_at < clock_timestamp() - ($1::double precision * interval '1 second'))::bigint AS stale_count,
        COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - max(last_seen_at))), 0) AS newest_age_seconds
      FROM relay_worker_heartbeats
    `, [workerFreshnessSeconds]),
    client.query(`
      SELECT stream, count::bigint, oldest_age_seconds
      FROM (
        SELECT 'session' AS stream, count(*)::bigint,
          COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - min(occurred_at))), 0) AS oldest_age_seconds
          FROM relay_outbox_events WHERE published_at IS NULL
        UNION ALL
        SELECT 'environment', count(*)::bigint,
          COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - min(occurred_at))), 0)
          FROM relay_environment_outbox_events WHERE published_at IS NULL
        UNION ALL
        SELECT 'automation', count(*)::bigint,
          COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - min(occurred_at))), 0)
          FROM relay_automation_outbox_events WHERE published_at IS NULL
        UNION ALL
        SELECT 'space', count(*)::bigint,
          COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - min(occurred_at))), 0)
          FROM relay_space_outbox_events WHERE published_at IS NULL
      ) pending
    `),
  ])

  const lines = [
    '# HELP relay_observer_commands_total Commands grouped by low-cardinality status.',
    '# TYPE relay_observer_commands_total gauge',
    ...commands.rows.map((row) => metric('relay_observer_commands_total', { status: row.status }, row.count)),
    '# HELP relay_observer_commands_oldest_age_seconds Age of the oldest command in each status.',
    '# TYPE relay_observer_commands_oldest_age_seconds gauge',
    ...commands.rows.map((row) => metric('relay_observer_commands_oldest_age_seconds', { status: row.status }, Number(row.oldest_age_seconds))),
    '# HELP relay_observer_commands_heartbeat_age_seconds Age of the newest command heartbeat in each status.',
    '# TYPE relay_observer_commands_heartbeat_age_seconds gauge',
    ...commands.rows.map((row) => metric('relay_observer_commands_heartbeat_age_seconds', { status: row.status }, Number(row.heartbeat_age_seconds))),
    '# HELP relay_observer_commands_expired_leases_total Active command leases that have expired.',
    '# TYPE relay_observer_commands_expired_leases_total gauge',
    ...commands.rows.map((row) => metric('relay_observer_commands_expired_leases_total', { status: row.status }, row.expired_leases)),
    '# HELP relay_observer_environment_jobs_total Environment provisioning jobs grouped by status.',
    '# TYPE relay_observer_environment_jobs_total gauge',
    ...jobs.rows.map((row) => metric('relay_observer_environment_jobs_total', { status: row.status }, row.count)),
    '# HELP relay_observer_environment_jobs_oldest_age_seconds Age of the oldest provisioning job in each status.',
    '# TYPE relay_observer_environment_jobs_oldest_age_seconds gauge',
    ...jobs.rows.map((row) => metric('relay_observer_environment_jobs_oldest_age_seconds', { status: row.status }, Number(row.oldest_age_seconds))),
    '# HELP relay_observer_environment_jobs_expired_leases_total Active provisioning leases that have expired.',
    '# TYPE relay_observer_environment_jobs_expired_leases_total gauge',
    ...jobs.rows.map((row) => metric('relay_observer_environment_jobs_expired_leases_total', { status: row.status }, row.expired_leases)),
    '# HELP relay_observer_workers_total Worker heartbeats grouped by freshness state.',
    '# TYPE relay_observer_workers_total gauge',
    metric('relay_observer_workers_total', { state: 'fresh' }, worker.rows[0]?.fresh_count ?? 0),
    metric('relay_observer_workers_total', { state: 'stale' }, worker.rows[0]?.stale_count ?? 0),
    '# HELP relay_observer_worker_newest_heartbeat_age_seconds Age of the newest visible Worker heartbeat.',
    '# TYPE relay_observer_worker_newest_heartbeat_age_seconds gauge',
    metric('relay_observer_worker_newest_heartbeat_age_seconds', {}, Number(worker.rows[0]?.newest_age_seconds ?? 0)),
    '# HELP relay_observer_outbox_pending_total Unpublished Outbox rows grouped by stream.',
    '# TYPE relay_observer_outbox_pending_total gauge',
    ...outbox.rows.map((row) => metric('relay_observer_outbox_pending_total', { stream: row.stream }, row.count)),
    '# HELP relay_observer_outbox_oldest_age_seconds Age of the oldest unpublished Outbox row by stream.',
    '# TYPE relay_observer_outbox_oldest_age_seconds gauge',
    ...outbox.rows.map((row) => metric('relay_observer_outbox_oldest_age_seconds', { stream: row.stream }, Number(row.oldest_age_seconds))),
    '',
  ]
  return `${lines.join('\n')}\n`
}
