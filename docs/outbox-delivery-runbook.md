# Core Outbox Delivery Runbook

This runbook covers the metadata-only dispatcher for the `session`, `environment`,
`automation`, and `space` Outbox streams. It does not turn local delivery into
external Staging evidence and does not dispatch Repository/Secret/Webhook/MCP/
Daemon/Integration/Skill catalog events, whose consumers remain capability-specific.

## Authority and startup

The dispatcher is absent unless the Worker receives both values from the target
environment's Secret Manager:

- `OUTBOX_RECEIVER_URL`: one fixed HTTPS URL without userinfo, query, or fragment.
- `OUTBOX_RECEIVER_BEARER_TOKEN`: 16–4096 non-whitespace characters.

Partial or unsafe authority fails Worker startup. The bounded controls are:

- `OUTBOX_DELIVERY_LEASE_DURATION_MS` (default 30000, 1000–300000).
- `OUTBOX_RECEIVER_REQUEST_TIMEOUT_MS` (default 10000, 100–60000 and shorter than the lease).
- `OUTBOX_POLL_INTERVAL_MS` (default 500, 50–60000).
- `OUTBOX_MAX_ATTEMPTS` (default 5, 1–20).
- `OUTBOX_RETRY_BASE_DELAY_MS` (default 1000, 100–60000).
- `OUTBOX_RETRY_MAX_DELAY_MS` (default 60000, base delay–3600000).

Do not place real values in `.env.example`, the Web bundle, image layers, URLs,
logs, screenshots, Git history, or Notion.

## Delivery contract

Each POST carries a stable SHA-256 `Idempotency-Key` and a versioned field
allowlist: delivery ID, stream, source event ID/type, Organization/Space IDs,
and occurred timestamp. Source `payload` and receiver response bodies are never
read or forwarded. Redirects are not followed, so the Authorization header cannot
move to a second origin.

- HTTP 2xx: delivery becomes `delivered` and the source row receives `published_at`.
- HTTP 4xx: deterministic rejection becomes `dead_letter` immediately.
- Redirect, 5xx, network failure, or timeout: `retrying` with bounded exponential backoff.
- Final uncertain attempt: `dead_letter`; no infinite retry.
- Crash after an external request: an expired lease can be claimed again with the
  same idempotency key. The receiver must enforce that key before Staging promotion.

Migrations 090–091 create the delivery state and enforce least-privilege column
grants. Claims use PostgreSQL `FOR UPDATE SKIP LOCKED`, lease owner/expiry and version
fencing. Every claim, result, retry, dead-letter, and replay writes an append-only
operational audit fact without payload or error body.

## Dead-letter operations

Run only from a controlled terminal with a short-lived database identity that can
assume `cosmos_worker_runtime`. `OUTBOX_OPERATOR_ID` is required for replay:

```bash
OUTBOX_OPERATOR_ID=operator-id pnpm outbox:dead-letter list 20
OUTBOX_OPERATOR_ID=operator-id pnpm outbox:dead-letter replay \
  session organization-id space-id source-id 4 receiver_recovered
```

Allowed replay reason codes are `receiver_policy_fixed`, `receiver_recovered`,
and `operator_reconciled`. Replay requires the current delivery version, so stale
or concurrent commands fail closed. The list is metadata-only but still contains
tenant/resource identifiers; do not paste it into public tickets.

Never repair delivery by deleting source Outbox/audit rows or manually setting
`published_at`. Reconcile the receiver's idempotency ledger, fix the cause, replay
through the CLI, then confirm pending age/count and dead-letter metrics return to zero.

## Verification boundary

Repository verification requires unit tests, PostgreSQL integration, `pnpm check`,
OpenAPI lint, and a rebuilt healthy Worker with the dispatcher unconfigured.
External verification additionally requires a controlled HTTPS receiver, Secret
Manager injection, receiver idempotency evidence, alert delivery/acknowledgement,
and a target-environment retry/dead-letter/replay drill. A loopback receiver or
database fixture cannot satisfy that boundary.
