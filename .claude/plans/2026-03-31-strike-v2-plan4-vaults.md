# Strike v2 Migration — Plan 4: Vaults

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Strike v2 Vault system — browse managed vaults, view performance metrics, deposit/withdraw into vaults, and track personal vault positions.

**Architecture:**

Vaults are managed trading portfolios on the Strike execution layer:
- **Leaders** trade on behalf of the vault using the shared capital pool
- **Depositors** earn/lose based on the leader's trading performance
- **All deposits go through the same on-chain flow as direct account deposits** — send ADA to locker contract, validators verify, volatile assets swapped to stablecoins, USD credited to vault
- **Withdrawals similarly require wallet signature** and go through validators for on-chain settlement
- **Public endpoints** (no auth) for browsing vault listings and performance metrics
- **Authenticated endpoints** for user-specific position, history, and deposit/withdraw actions
- **Performance metrics:** TVL, APR, Sharpe ratio, max drawdown, time-series history

**Tech Stack:** Vue.js 2.7, TypeScript, Vuetify 2.7, `strike-v2.vaults.ts` from Plan 1, Cardano SDK (for deposit tx)

**Depends on:** Plan 1 (API Client + Auth), Plan 3 (Account onboarding + deposit/withdraw composables — reuse the signing infrastructure)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/modules/market/composables/useStrikeVaults.ts` | Composable: vault list, details, portfolio, user positions |
| `src/modules/market/composables/useStrikeVaultDeposit.ts` | Vault-specific deposit flow (reuses Plan 3 signing infra) |
| `src/sidepanel/pages/VaultsPage.vue` | Mini-gero vault browsing + my deposits |
| `src/sidepanel/components/perps/VaultCard.vue` | Vault summary card (TVL, APR, PnL, status) |
| `src/sidepanel/components/perps/VaultDetailSheet.vue` | Bottom sheet: vault detail + performance chart + deposit/withdraw |
| `src/sidepanel/components/perps/VaultPortfolioChart.vue` | Vault equity curve (TVL, PnL over time) |
| `src/sidepanel/components/perps/VaultDepositSheet.vue` | Deposit into vault (Cardano tx flow) |
| `src/sidepanel/components/perps/VaultWithdrawSheet.vue` | Withdraw from vault (wallet signature flow) |
| `src/modules/dashboard/dialogs/VaultsDialog.vue` | Full dashboard vault browsing dialog |
| `src/sidepanel/router.ts` | Add `/vaults` route |

---

### Task 1: Vaults Composable

**Files:**
- Create: `src/modules/market/composables/useStrikeVaults.ts`

- [ ] **Step 1: Create vaults composable**

State: `vaults`, `totalCount`, `userPositions`, `loading`, `error`
Computed: `activeVaults`, `verifiedVaults`, `totalVaultEquity`, `totalVaultPnl`
Methods:
- `loadVaults(params)` — list vaults with filters (period, type, verified, status)
- `loadUserPositions()` — get all user vault positions (authenticated)
- `getVaultDetail(id)` — single vault info
- `getVaultPortfolio(id, period)` — vault performance data + time-series
- `getVaultDepositors(id)` — depositor list
- `getUserPosition(vaultId)` — user's position in specific vault

Sorting: by TVL, APR, PnL (configurable).

- [ ] **Step 2: Commit**

---

### Task 2: Vault Deposit Composable

**Files:**
- Create: `src/modules/market/composables/useStrikeVaultDeposit.ts`

Vault deposits follow the same on-chain flow as direct account deposits (Plan 3), but target a specific vault ID.

- [ ] **Step 1: Create vault deposit composable**

This should reuse the deposit signing infrastructure from Plan 3's `useStrikeDeposit.ts`. The differences:
- Request quote includes `vault_id` parameter
- Confirmation shows the vault name and leader info
- Balance is credited to the vault, not the user's trading account

State: `quote`, `status`, `isLoading`, `error`
Methods:
- `requestVaultDepositQuote(vaultId, amount, asset)`
- `buildAndSignTx(quote, password)` — reuse Plan 3 Cardano tx builder
- `pollStatus(txHash)`

**Note:** Vault-specific deposit/withdraw API endpoints need confirmation from Strike. May be the same as account deposit with a `vault_id` param, or separate endpoints.

- [ ] **Step 2: Commit**

---

### Task 3: Vault Card Component

**Files:**
- Create: `src/sidepanel/components/perps/VaultCard.vue`

- [ ] **Step 1: Create vault card**

Compact card showing vault summary. Liquid glass styling.

Content:
- Vault name + verified badge (checkmark icon if `is_verified`)
- Type badge: "User" (individual trader) or "Protocol" (managed strategy)
- Key metrics row: TVL | APR | 30d PnL
- Secondary: Sharpe ratio, max drawdown, depositor count
- Depositor count: `X depositors`
- Click → emits `select` with vault ID

Styling:
- Green PnL values for positive, red for negative
- Verified badge in primary cyan
- Compact: fits 2-3 cards visible in the viewport

- [ ] **Step 2: Commit**

---

### Task 4: Vault Portfolio Chart

**Files:**
- Create: `src/sidepanel/components/perps/VaultPortfolioChart.vue`

- [ ] **Step 1: Create vault equity chart**

Props: `history` (time-series data from `VaultPortfolioResponse.history`)

Chart:
- Line chart: TVL over time (primary line)
- Overlay: PnL (secondary, can be toggled)
- Period selector chips: 24h, 7d, 30d, 6m, 1y, all
- Emits `period-change(period)` to re-fetch data

Reuse existing chart patterns (lightweight-charts or canvas-based).

- [ ] **Step 2: Commit**

---

### Task 5: Vault Detail Bottom Sheet

**Files:**
- Create: `src/sidepanel/components/perps/VaultDetailSheet.vue`

- [ ] **Step 1: Create vault detail sheet**

A BottomSheet (85% height) with full vault details.

Sections:
1. **Header:** Vault name, description, leader address (truncated), status/verified badges
2. **Performance metrics:** TVL, APR, Sharpe, Max Drawdown, Depositor Count — in a grid
3. **Chart:** VaultPortfolioChart with period selector
4. **Your Position** (if user has deposited):
   - Shares, deposited amount, current value, PnL (colored)
   - Withdraw button
5. **Top Depositors:** List from `getVaultDepositors` (equity, share %, PnL)
6. **Actions:**
   - Deposit button → opens VaultDepositSheet
   - Withdraw button → opens VaultWithdrawSheet (only if user has position)

- [ ] **Step 2: Commit**

---

### Task 6: Vault Deposit/Withdraw Sheets

**Files:**
- Create: `src/sidepanel/components/perps/VaultDepositSheet.vue`
- Create: `src/sidepanel/components/perps/VaultWithdrawSheet.vue`

- [ ] **Step 1: Create vault deposit sheet**

Similar to Plan 3's DepositSheet but vault-specific:
- Shows vault name in header
- Amount input (ADA)
- Preview: estimated shares, estimated USD credit, network fee
- Warning about volatile asset auto-swap to stablecoin
- Signing flow (spending password / hardware / PassKey)
- Progress: building tx → signing → submitting → confirming → credited

- [ ] **Step 2: Create vault withdraw sheet**

- Amount input (USD or shares)
- Preview: estimated ADA received, estimated delivery time
- Warning if withdrawal would significantly impact vault TVL
- Wallet signature step
- Progress: requesting quote → signing → submitted → pending → confirmed

- [ ] **Step 3: Commit**

---

### Task 7: Vaults Page (Mini-Gero)

**Files:**
- Create: `src/sidepanel/pages/VaultsPage.vue`
- Modify: `src/sidepanel/router.ts`

- [ ] **Step 1: Create vaults browsing page**

Layout:
1. **Header:** "Vaults" title + search input
2. **My Deposits section** (shown if user has vault positions):
   - Summary card: total equity across vaults, total PnL
   - Horizontal scroll of user's vault position cards
3. **Browse section:**
   - Filter chips: All, Verified, Protocol
   - Sort dropdown: TVL, APR, PnL
   - List of VaultCard components
   - "Load More" pagination
4. **Empty states** for no vaults and no deposits

- [ ] **Step 2: Add route**

```typescript
{ path: '/vaults', name: 'vaults', component: () => import('../pages/VaultsPage.vue') }
```

- [ ] **Step 3: Add navigation entry** (if adding to bottom nav or perps page)

- [ ] **Step 4: Commit**

---

### Task 8: Vaults Dialog (Full Dashboard)

**Files:**
- Create: `src/modules/dashboard/dialogs/VaultsDialog.vue`

- [ ] **Step 1: Create full dashboard vaults dialog**

Same features as VaultsPage but in a fullscreen dialog layout:
- Left panel: vault list with filters + search
- Right panel: selected vault detail (chart, metrics, depositors, actions)
- Reuse VaultCard, VaultPortfolioChart, VaultDetailSheet components

- [ ] **Step 2: Commit**

---

### Task 9: i18n Keys for Vaults

**Files:**
- Modify: `src/plugins/i18n/us.ts`
- Modify: `src/plugins/i18n/de.ts`

- [ ] **Step 1: Add vault keys**

```
vaults.title, vaults.browse, vaults.myDeposits, vaults.totalEquity,
vaults.tvl, vaults.apr, vaults.pnl, vaults.sharpeRatio, vaults.maxDrawdown,
vaults.depositors, vaults.deposit, vaults.withdraw, vaults.verified,
vaults.protocol, vaults.user, vaults.noVaults, vaults.noDeposits,
vaults.enterAmount, vaults.yourPosition, vaults.currentValue,
vaults.depositedAmount, vaults.withdrawnAmount, vaults.shares,
vaults.estimatedShares, vaults.estimatedReceived, vaults.vaultLeader,
vaults.stablecoinSwapWarning, vaults.depositInProgress, vaults.withdrawInProgress
```

- [ ] **Step 2: Add German translations**
- [ ] **Step 3: Commit**

---

### Task 10: Feature Flag + Network Guard

**Files:**
- Modify: `src/utils/networks.ts` (if needed)
- Modify: `src/sidepanel/router.ts`

- [ ] **Step 1: Add vault route guard**

Vaults should only be available when:
- Chain is Cardano Mainnet (same as perpetuals)
- Strike account is connected (has API keys)
- Feature flag enabled (if using LaunchDarkly)

Guard the `/vaults` route and hide navigation entry when not available.

- [ ] **Step 2: Commit**

---

## Summary

After completing this plan:
- Browse managed trading vaults with performance metrics (TVL, APR, Sharpe, drawdown)
- View vault portfolio charts (time-series TVL/PnL)
- Deposit ADA into vaults via on-chain Cardano transaction (same signing flow as wallet sends)
- Withdraw from vaults via wallet signature + validator settlement
- Track personal vault deposits, shares, PnL
- Both mini-gero and full dashboard support
- i18n complete (EN + DE)
- Feature-flagged and network-gated

## Open Questions
1. **Vault deposit/withdraw API** — Are these the same endpoints as account deposit/withdraw with a `vault_id` param? Or separate vault-specific endpoints?
2. **Vault creation** — Should Gero support creating vaults (leader functionality), or only depositor functionality?
3. **Vault positions** — Can depositors see the leader's open positions and trade history within the vault?
4. **Minimum deposit** — Is there a minimum deposit amount per vault?
5. **Withdrawal lock** — Is there a lock period after depositing before you can withdraw?
