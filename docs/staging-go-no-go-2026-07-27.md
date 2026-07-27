# Staging Go / No-Go Evidence — 2026-07-27

## Decision

**NO-GO for customer-data staging promotion or public exposure.** The repository and local Docker
runtime pass bounded execution, failure, and recovery rehearsals, but no controlled staging
deployment or external dependency authority was available. Local evidence must not be relabeled as
OIDC, managed Object Storage, Daemon/Cloud provider, Alertmanager, or managed PITR evidence.

## Evaluated release

- Source baseline: `0ebbcbd3c88263354a6f8a30bc5443c904ce7de5` on `main` / `origin/main`.
- Database: PostgreSQL 17; 89 migrations through `089_space_migration_execution.sql`.
- Local runtime: PostgreSQL, API, Worker, and Web healthy after every drill.
- Credential handling: only configuration presence and provider catalog matches were recorded.
  Credential values, provider endpoints, model output, file paths, and response bodies were not
  written to this report.

## External preflight result

| Dependency | Evidence | Result |
| --- | --- | --- |
| Model Provider | Authenticated model catalog request and real Worker execution | Partial pass |
| OIDC | No staging issuer, audience, client, or short-lived test identity available | Blocked |
| Object Storage | No staging S3-compatible endpoint or scoped IAM identity available | Blocked |
| Daemon / Cloud provider | No connected pool or cloud provisioning credential available | Blocked |
| Monitoring delivery | Rules exist; no Prometheus scrape, Alertmanager receiver, or acknowledgement | Blocked |
| Managed PITR | Local archive contract passed; no platform retention or restore evidence | Blocked |

GitHub exposed only the `github-pages` environment and no repository Actions Secret or Variable.
The local machine had no Kubernetes context. `.env.local` provided only model Provider configuration;
no value was printed or copied.

## Execution and safe-failure evidence

### Provider, ToolCall, and Artifact

- The Provider catalog returned three models; only `claude-opus-4-8` matched the governed Cosmos
  catalog.
- The default `gpt-5.6-sol` fixture executed five bounded attempts and failed safely with four
  `provider_http_error` results followed by `provider_connection_timeout`. Persisted messages were
  the fixed, redacted unavailable/timeout diagnostics.
- A temporary private Expert pinned to `claude-opus-4-8` completed a real Session through
  `queued → active → completed`.
- The Session produced one successful low-risk `workspace_files_list` ToolCall and one associated
  `test_report` Artifact. No model response text or workspace path was captured.
- The evaluated rehearsal produced no Approval because its Worker exposed only low-risk workspace
  reads and Advisor plan proposal. A follow-up repository slice now adds the capability-gated
  `approved_webhook_delivery` path described below; it is not counted as external Staging evidence
  until deployed with a real receiver, Secret Manager configuration and distinct OIDC identities.

### Repository unblock after the rehearsal

- `approved_webhook_delivery` appears in the Provider catalog only when the Worker receives a fixed
  HTTPS URL, server-side Bearer credential and 1–20 independent human approver IDs together.
- The model can provide only a 1–64 character safe label. It cannot choose a URL, Header, Token,
  arbitrary body, Shell command or code write.
- A high-risk ToolCall enters pending Approval before any network request. Approval binds the exact
  input hash; requester self-approval, viewer/non-member review, rejection and expiry fail closed.
- Approved execution writes a prepared SideEffect before one idempotent POST. HTTP 2xx resolves it
  succeeded, 4xx failed, and redirect/5xx/network/timeout unknown; unknown prevents Session success
  until an operator reconciles the receiver ledger.
- Approval waiting maintains the Command lease. Each Worker loop expires overdue Approvals before
  execution lease recovery, so restart/crash does not leave an Approval permanently waiting.
- Verification passed 250 API tests, 224 Web tests, 62 Contracts tests, 7 Ops tests and 158
  PostgreSQL integration tests. Docker PostgreSQL/API/Worker/Web rebuilt healthy. These are code and
  local runtime facts, not the missing external receiver/OIDC evidence.

### Dependency failure injection

- An offline Daemon Environment retried three times, failed with
  `daemon_pool_unavailable` (`retryable=true`), and was archived.
- Loading Worker configuration with `NODE_ENV=staging` and no Object Storage configuration failed
  closed before startup with `Object Storage must be configured in staging and production.`
- The unsupported Provider model path stayed bounded and did not expose endpoint, credential, or
  arbitrary provider response content.

## Load and journey evidence

| Run | Result |
| --- | --- |
| 400 authenticated reads, concurrency 20 | 400×200, 0 errors; p50 20.35ms, p95 80.52ms, p99 88.39ms, max 106.63ms |
| 10 Session journeys, concurrency 2 | 10 passed; 20 create events observed |
| 1,000 reads, concurrency 25, concurrent with 25 journeys | 581×200, 419×429; p95 123.57ms |

The first capacity boundary was the configured 600 requests / 60 seconds instance rate limit, not
request latency. Unexpected 429 responses at the intended traffic tier are a rollback condition.
These bounded local numbers are not production throughput or a multi-hour soak claim.

## Fault and recovery evidence

- Worker readiness: execution capability disabled after heartbeat expiry; API health and ready
  remained available; capability recovered after Worker restart.
- Database readiness: API health stayed 200, ready failed closed with 503, and ready returned to 200
  after PostgreSQL restart.
- Both drills explicitly bypass ambient HTTP proxies for their validated loopback URL. This fixes a
  discovered false-timeout and credential-routing risk on proxy-configured development machines.
- All four Compose services were healthy after recovery.

## Backup, restore, and PITR evidence

- Logical custom-format backup: 682,676 bytes, SHA-256 verified, completed in 2 seconds.
- Isolated restore RTO: 5 seconds. The restore verified exact migration history, required tables,
  FORCE RLS, API/Worker ACL, Organization quotas, and FileVersion invariants.
- Source and restored Organization, Session, ToolCall, and Artifact counts matched.
- Archive-mode PITR preflight: forced WAL switch passed in 6 seconds; two successful archives,
  zero failed archives, and a recorded latest archive. `archive_timeout=30s` was within the 300s RPO
  target.
- The backup existed only inside an ephemeral container; the isolated database and PITR container
  were removed after verification.

This proves the local scripts and archive contract. It does not prove an encrypted remote backup,
managed retention window, earliest recovery point, cross-account restore, or application cutover.

## SLO and alert evidence

- Observer query: no accepted/queued/running Commands; one fresh Worker and zero stale Workers;
  newest heartbeat age was approximately three seconds.
- Alert file: one rule group, three recording rules, and eight alerts covering availability,
  latency, SSE capacity, Worker readiness, command queue age, Outbox lag, and stale heartbeat.
- The protected API metrics endpoint returned 404 without a configured scrape token.
- Local pending Outbox was above the five-minute alert threshold: eight Session records (oldest
  approximately 3,190 seconds) and three Environment records (oldest approximately 786 seconds).
  No dispatcher/receiver delivery evidence was present.

## Promotion gates

Promotion remains blocked until all of the following have external evidence:

1. Controlled staging URL, immutable image digests, release migration job, and short-lived OIDC
   identity scoped to an isolated Organization and Space.
2. Scoped S3-compatible bucket with versioning, encryption, public-access block, retention, and a
   successful object-backed FileVersion read/checksum drill.
3. Connected Daemon pool or Cloud provider with readiness, retry, and failure-injection controls.
4. Deploy and configure `approved_webhook_delivery` against a controlled receiver, then capture real
   approve, reject, expiry, idempotent SideEffect and Artifact evidence using distinct OIDC actors.
5. Outbox delivery with bounded retry/dead-letter behavior and no item older than the alert threshold.
6. Prometheus rule evaluation, Alertmanager page/ticket delivery, and on-call acknowledgement.
7. Managed PITR retention and an actual point-in-time restore into an isolated instance, including
   application readiness and tenant-isolation checks.
8. Multi-hour execution soak covering Session start/send, SSE, provider 429/timeout, object-store
   5xx, database exhaustion, lease fencing, and rolling deployment.

## Go criteria and rollback conditions

Re-evaluation may return **GO** only when every promotion gate has an attached external artifact and
the target-environment soak stays within the agreed error budget. Roll back or stop canary expansion
when any of these occurs:

- unexpected 429/5xx or p95 above 500ms at the approved traffic tier;
- Command, Outbox, or execution queue age above 300 seconds;
- no fresh Worker heartbeat while execution is enabled;
- readiness does not fail closed for a broken dependency or does not recover inside the approved RTO;
- Object Storage checksum, tenant isolation, approval idempotency, or audit continuity fails;
- backup/PITR evidence cannot meet RPO 300 seconds or RTO 3,600 seconds.

Until then, Cosmos remains suitable for internal Alpha and controlled local verification only.
