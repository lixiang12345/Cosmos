# Repository Delivery Rules

These rules apply to every implementation task in this repository.

## Completion workflow

For each completed vertical slice:

1. Inspect `git status --short --branch` before editing and preserve unrelated user changes.
2. Implement the complete slice across contracts, API, persistence/migrations, worker behavior, Web UI, tests, and documentation as applicable. Do not ship a static or demo-only control-plane action as production behavior.
3. Run the smallest relevant checks while iterating, then run `pnpm check` and `pnpm openapi:lint` before delivery. Run PostgreSQL integration tests and rebuild/restart Docker when the change affects runtime, API, migrations, or the Web production bundle.
4. Verify the changed workflow in the running application, including loading, empty, error, permission, keyboard, mobile, and desktop states when applicable. Never print, screenshot, commit, or push API keys, tokens, or secret values.
5. Update the relevant product/engineering documentation and record the verification evidence in the delivery notes.
6. Commit the finished change directly to `main` with a concise conventional commit message, then push `main` to `origin`.
7. Fetch `origin/main` and confirm that local `main` and `origin/main` resolve to the same commit. Report the commit, checks, runtime status, and any explicitly deferred work.

Do not stop after local implementation or wait for a reminder to push. If a required check fails, fix it or clearly report the blocker instead of pushing an unverified change. Keep unrelated worktree changes intact.

## Product boundaries

- Keep the monochrome Cosmos-inspired visual system: white/graphite surfaces, restrained semantic colors, compact density, consistent interaction states, and no decorative gradients.
- Preserve tenant isolation, RBAC, optimistic concurrency, idempotency, auditability, and immutable published revisions for control-plane writes.
- Treat prototype/demo behavior as explicitly labeled and capability-gated; it must never masquerade as a production API result.
- Keep secrets server-side and inject them through environment variables or a secret manager. Never put credentials in the Web bundle, URLs, localStorage, logs, screenshots, or Git history.
