# Glass table migration — dashboard, tokens, staking, governance

**Date:** 2026-07-15
**Goal:** every table/widget container on the dashboard reads as the same liquid glass as the
portfolio chart and Recent Transactions hero panels (Material 4 `.glass-panel`), while the
hierarchy *inside* each table (header rows, row hovers, badges, filters, nested tiles) is
retained exactly — only the material changes.

## Current state (inventoried 2026-07-15)

All on-screen table/widget containers use **Material 3 "popover"** (`.liquid-glass` /
`.liquid-glass-compact`: `rgba(18,21,28,0.97)`, blur 26 / sat 1.25, hairline-2, shadow-menu) or
solid `--g-surface` cards. None uses **Material 4 `.glass-panel`**
(`rgba(0,0,0,0.4)`, blur 20 / sat 1.8, hairline-1 border, `--g-r-card`, no shadow) — the recipe
PortfolioChart + RecentTransactionsCard carry locally.

## Design

### 1. Material mapping (containers → `.glass-panel`)

| Surface | File | Today |
|---|---|---|
| Holdings table shell (Cardano + Midnight branches) | `PortfolioPage.vue` L36, L169 | `.liquid-glass` |
| Market stat bar | `market/components/MarketStatBar.vue` | `.liquid-glass-compact` + local 8px radius |
| Pool list/table card | `staking/Staking.vue` L8 | `.liquid-glass` |
| Delegation + rewards widgets (`.stk-card`) | `dashboard/components/StakingCard.vue` | solid `--g-surface` |
| Current-delegation, gov-tools, DRep list cards | `governance/components/CardanoGovernance.vue` L10, L131, L183 | `.liquid-glass` |
| DAO status bar + member-growth chart cards | `governance/components/DAO.vue` L8, L96 | `.liquid-glass` |
| DAO collapsible sections (header + body) | `DAO.vue` `.dao-collapsible`, `.dao-collapsible-body` | solid `--g-surface` / `--g-raised` |

`MarketTokenTable.vue`, the DAO inner tables, and the DRep table have no surface of their own —
they inherit the container and keep their row/hover/divider CSS unchanged.

### 2. Hierarchy over glass (the rules)

The existing hierarchy is retained; only *opaque* fills that would punch solid slabs into a
see-through panel are translated to the equivalent translucent step:

- **Table header rows:** solid fills (`--g-surface` on holdings th, `--g-raised` on staking
  `.v-data-table-header`) → `transparent`. The tracked-caps `--g-text-3` type + hairline-1
  bottom border already carry the header tier (this is how the DRep table renders today,
  verified legible over glass). Headers are not sticky, so nothing scrolls beneath them.
- **Nested raised surfaces** (tiles/cards *inside* a glass panel — `.stk-tile`, `.pool-card`,
  DAO collapsible body): solid `--g-overlay`/`--g-raised`/cardBackground → `var(--g-hairline-1)`
  translucent fill (the same "raised over glass" step the portfolio chart's segmented controls
  use). Borders, radii, hover states unchanged. No nested `backdrop-filter` — one blur per
  panel, nested tiers are tints.
- **Everything already translucent stays byte-identical:** row hovers (`--g-hairline-1`),
  success/error fills, accent chips, search field fills, saturation bars, live dot, dividers.
- **CIP-149 banner** (`CardanoGovernance.vue`): hardcoded `#1a2332` v-sheet → hairline-1 tint
  (removes one raw hex).

### 3. `v-card` specificity

`options/App.vue` declares unscoped `.v-card { background-color: … !important }`. `.glass-panel`
is currently unflagged (consumers were plain divs). Since most migrated containers are v-cards,
`liquid-glass.css` gains flagged `.v-card.glass-panel` variants (base + no-blur fallback +
reduced-transparency + increased-contrast blocks), mirroring the existing `.v-card.liquid-glass`
pattern.

### 4. Consolidation (pays the ratchet)

Five components hand-roll the identical Material 4 recipe locally; they move onto the shared
class and the local copies are deleted: `PortfolioChart.vue` (2 panels),
`RecentTransactionsCard.vue`, `MidnightTransactionsCard.vue`, `MidnightPortfolioChart.vue`
(2 panels), `CashbackCard.vue`. `TransactionsCard.vue` (transactions view table) also swaps its
Cardano-branch `.liquid-glass` to `glass-panel` so the full transactions table matches the home
card. Net effect on the design ratchet: `backdropFilters`, `importantCount` and
`hexOccurrences` go **down**; the budgets are re-ratcheted with `--write` after the pass.

### Out of scope

- Dead code (never imported, left untouched): `TokensMarketCards.vue`, `StakingCard2.vue`,
  `governance/components/Cards/*` + `Tabs/*`.
- Chart internals (Highcharts hardcoded hexes), the filter-panel popover (a popover, not a
  panel), dialogs/overlays (Material 2), sidepanel.

### Accessibility

`.glass-panel` already collapses to opaque under `prefers-reduced-transparency`,
`prefers-contrast: more`, and the no-`backdrop-filter` fallback; v-card variants join those
blocks. `node scripts/design/contrast.mjs` must stay green.
