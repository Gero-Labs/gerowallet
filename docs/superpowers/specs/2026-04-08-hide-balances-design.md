# Hide Balances — Design Spec

## Overview

Add an eye icon toggle to the dashboard that hides all monetary values, replacing them with bullet masks (`••••••`). This is a privacy feature so users can open the wallet without exposing their holdings to onlookers.

**Reference:** Eternl wallet's hide balance feature (see screenshots in conversation).

## Scope

**Dashboard screen only.** Other screens (staking, governance, assets, etc.) are unaffected.

## Data & State

- Add `hideBalances: boolean` to the per-wallet config interface (default: `false`)
- Persist via `setWalletConfiguration(walletId, 'hideBalances', value)` — same pattern as `hideScamTokens`
- Dashboard components read from `walletStore.config.hideBalances`
- Broadcast change via `broadcastFromBackground()` so all extension contexts stay in sync
- Setting persists across sessions (survives close/reopen)
- Per-wallet: each wallet can have its own hide/show preference

## Eye Icon Placement & Behavior

- **Location:** Top-right corner of the PortfolioChart card
- **Icons:** `mdi-eye` when balances visible, `mdi-eye-off` when hidden
- **Style:** Small, muted/subtle — does not compete with chart content
- **Action:** Click toggles `hideBalances` in wallet config
- **Currency toggle** (`toggleCurrency` on balance click): Disabled while balances are hidden

## Masking Rules

When `hideBalances` is `true`, all monetary values on the dashboard are replaced with bullet masks. The currency symbol prefix is preserved.

### What gets masked

| Component | Element | Masked Display |
|-----------|---------|----------------|
| PortfolioChart.vue | Portfolio total (OdometerCounter) | `••••••` (with currency symbol prefix) |
| PortfolioChart.vue | Fiat equivalent | `$•••` or equivalent |
| PortfolioChart.vue | Chart Y-axis price labels | `••••••` |
| BitcoinBalanceCard.vue | BTC balance | `••••••` |
| BitcoinBalanceCard.vue | Sats amount | `••••••` |
| BitcoinBalanceCard.vue | USD equivalent | `$•••` |
| Dashboard transaction list | ADA amounts (send/receive) | `₳ ••••••` |
| Dashboard transaction list | Fiat equivalents | `$•••` |
| Dashboard token/asset amounts | Token balances | `••••••` |
| Dashboard swap section | "Available for swap" amount | `••••••` |

### What stays visible

- Chart lines and bars (trends, not numbers)
- Transaction dates, descriptions, counterparty names
- Token names and icons
- Navigation, action buttons (Receive, Send, Swap)
- Non-monetary text (pool info, stake key, etc.)

## i18n

Add translation keys to `us.ts` and `de.ts`:

- `dashboard.hideBalances` — tooltip for the eye icon (e.g. "Hide balances" / "Show balances")

## Files to Modify

1. **Wallet config interface** — add `hideBalances` field
2. **PortfolioChart.vue** — eye icon button + masking logic for portfolio total, fiat, Y-axis labels
3. **BitcoinBalanceCard.vue** — masking logic for BTC/sats/USD
4. **Dashboard.vue** — pass/provide `hideBalances` state to child components if needed
5. **Dashboard transaction/asset components** — mask amounts
6. **i18n files** (`us.ts`, `de.ts`) — add translation keys
