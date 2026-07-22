# Cosmos prototype — working notes for Claude

## What this is
A frontend-only prototype of **Augment Cosmos** (cosmos.augmentcode.com), a cloud
agent-orchestration product. Single-page app: `index.html` + `app.js` + `styles.css`.
No build step, no backend. Open `index.html` (or serve the folder) to run.

**There is a mirror copy at `/Users/jiming/new中转/cosmos-prototype/` with byte-identical
content.** Confirm which one you're editing; keep them in sync if both matter to the user.

## The one rule that governs this project
Everything must stay **aligned to the live product and its docs**, not to marketing
composites. Primary sources:
- Live app captures (sidebar, Home, Experts, Session, Files, Environments) → IA & layout
- `docs.augmentcode.com/cosmos/*` → concepts, labels, exact field names
- `DESIGN_PHILOSOPHY.md` → why it's built this way

When docs and a screenshot disagree, ask the user which wins. When the docs simply
don't cover something (e.g. Cloud env CPU/RAM tiers, MCP transport types), that's a
doc gap — don't invent contradicting data, and don't delete plausible product detail
just because the docs omit it.

## Architecture (app.js)
- Single IIFE. Top: icon defs (`I`), then DATA consts, then `state`, then view/bind fns.
- Key DATA arrays: `EXPERTS`, `MODELS`, `ENVIRONMENTS`, `INTEGRATIONS`, `MCP`,
  `MCP_CATALOG`, `WEBHOOKS`, `SECRETS`, `FILES` (VFS), `EVENTS`, `TRIGGERS`,
  `TRIGGER_TYPES`, `SHORTCUTS`, `SESSIONS`.
- Router: `render()` switch on `state.route`; each route has a `viewX()` + `bindX()`.
- Cross-references by id/name: `TRIGGERS.expertId`, `EVENTS.expert` (display name),
  `SESSIONS.expertId`. **If you rename/remove an Expert, fix all three.**
- After any edit, run `node --check app.js` before claiming done.

## Alignment already done (docs-verified) — do not regress these
- **Experts = the 12 doc template Experts**, in doc order: Cosmos Advisor, PR Author,
  Risk Analyzer, Deep Reviewer, Pair Reviewer, Verifier, Incident Investigator,
  Feedback Triager, Project Builder, Ticket Dispatcher, Data Analyst, Cosmos Analyst.
  (Removed CI Failure Investigator + Security Vulnerability Triager — not in docs.)
  Each desc is that Expert's doc one-line purpose. Ticket Dispatcher legitimately uses
  "under backpressure" — it's the doc's own wording, don't strip it.
- **Secrets scopes = Private | Shared only** (not Space/Org). Auto-export to VM as
  upper-snake-case env vars; value write-only after creation.
- **Webhooks**: field is "Sharing scope"; Bearer Token auth; signing secret shown once;
  URL `POST https://{tenant}.api.augmentcode.com/webhooks/{id}`.
- **Keyboard shortcuts = 6 doc groups**: Global navigation, Command palette, Actions,
  Application, Sessions, Files (see `SHORTCUTS`).
- **Automations sub-nav**: Event Log before Run History; both capitalized as sidebar
  items; the automation-row menu option stays lowercase "Run history".
- **Session visibility default follows Expert origin**: shared/org Expert → Shared,
  personal Expert → Private (Home card click sets `state.isPrivate`).
- **Schedules**: 5-field cron, no macros; overlapping fires skipped, not queued/backfilled.
  Don't reintroduce the word "Singleton mode" (not in docs).
- **Slack trigger**: @-mention fires as both `app_mention` and `message`; filter on
  `event.type` (hint shown in trigger editor).
- Verified-correct, left alone: trigger event types/JSONLogic, 4 artifact labels
  (Pull request | Git branch | Linear issue | Link; branch has no manual add),
  MCP partner catalog, GitHub App vs personal identity split.

## Known doc gaps (intentionally kept despite docs not covering them)
- Cloud environment CPU/RAM "Size" column — real product shows it; docs don't spec tiers.
- MCP transport types (http/sse/stdio) and scope values — not enumerated in docs.

## Open / not yet done
- Nothing outstanding from the last alignment pass. If resuming, re-verify the 12
  Experts render and Automations table is intact before starting new work.
