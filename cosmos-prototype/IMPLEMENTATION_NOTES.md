# Cosmos prototype implementation notes

## What this is

A frontend-only prototype of Augment Cosmos (cosmos.augmentcode.com), a cloud
agent-orchestration product. It is a single-page app made from `index.html`,
`app.js`, and `styles.css`. There is no build step or backend.

## Alignment source of truth

Keep production UI work aligned to this prototype's information architecture,
layout, styling, copy, and interactions while preserving real production API,
RBAC, tenant isolation, validation, and failure behavior.

Primary references:

- Live app captures for information architecture and layout.
- `docs.augmentcode.com/cosmos/*` for concepts, labels, and field names.
- `DESIGN_PHILOSOPHY.md` for product and interaction rationale.

When a reference conflicts with the prototype, record the decision before
changing behavior. Do not invent unsupported production data or let a simulated
prototype action masquerade as a production result.

## Architecture

- `app.js` is a single IIFE containing icon definitions, data, state, views,
  bindings, and the router.
- Key data arrays include `EXPERTS`, `MODELS`, `ENVIRONMENTS`, `INTEGRATIONS`,
  `MCP`, `MCP_CATALOG`, `WEBHOOKS`, `SECRETS`, `FILES`, `EVENTS`, `TRIGGERS`,
  `TRIGGER_TYPES`, `SHORTCUTS`, and `SESSIONS`.
- Cross-references use IDs and names. If an Expert changes, update its Trigger,
  Event, and Session references together.
- After edits, run `node --check app.js`.

## Verified alignment that must not regress

- Experts are the 12 documented template Experts in documented order.
- Secret scopes are `Private` and `Shared`; values are write-only after create.
- Webhooks use Sharing scope, Bearer Token auth, and a one-time signing secret.
- Keyboard shortcuts retain the six documented groups.
- Automation navigation orders Event Log before Run History.
- Session visibility follows Expert origin.
- Schedules use five-field cron and skip overlapping fires.
- Slack trigger filters use `event.type`.
- Artifact labels, MCP catalog, and GitHub identity split remain unchanged.

## Known documentation gaps

- Cloud Environment CPU/RAM size tiers appear in the product but are not
  specified in documentation.
- MCP transport types and scope values are not fully enumerated.

## Current state

The latest prototype alignment pass has no known open item. Before new work,
verify that all 12 Experts render and the Automations table remains intact.
