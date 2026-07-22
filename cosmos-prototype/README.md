# Cosmos prototype — aligned to the **real product**

This is a frontend prototype of **[Cosmos](https://cosmos.augmentcode.com)** (Augment Code), aligned to the **live product IA and docs**, not marketing mock composites.

## What “product alignment” means

| Source | Used for |
|--------|----------|
| Live app captures (sidebar, Home, Experts, Session, Files, Environments) | Real navigation order & layout |
| [docs.augmentcode.com/cosmos/*](https://docs.augmentcode.com/cosmos/getting-started) | Concepts, Automations Event Log / Run History, Advisor rules |
| [DESIGN_PHILOSOPHY.md](./DESIGN_PHILOSOPHY.md) | Why the product is designed that way |

**Not primary:** Marketing hero overlays (optional **Showcase** only). Those stack multiple panels for the website.

## Real product sidebar (matched)

```
+ New session
  Sessions
  Files ▸ Organization · User
  Configuration ▸ Experts · Environments · Integrations · MCP · Webhooks · Secrets
  Automations ▸ Automations · Event Log · Run History
  Favorites (drag to pin)
  Recent Sessions
```

## Open

```bash
open index.html
```

Default theme: **light** (live product). Toggle dark in the top bar if needed.

## Honest limit

No real login, OAuth, agent VM, or billing — this is a **product-faithful shell** for design/demo. Live product remains `cosmos.augmentcode.com`.
