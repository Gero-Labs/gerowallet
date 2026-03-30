# Strike v2 Migration — Plan 4: Vaults

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Strike v2 Vault system — browse managed vaults, view performance metrics, deposit/withdraw, and track personal vault positions.

**Architecture:** Vaults are managed trading portfolios where leaders trade and depositors earn returns. Public endpoints (no auth) for browsing/metrics, authenticated endpoints for user-specific position and history data. Vault portfolio data includes TVL, APR, Sharpe ratio, max drawdown, and time-series history.

**Tech Stack:** Vue.js 2.7, TypeScript, Vuetify 2.7, `strike-v2.vaults.ts` from Plan 1

**Depends on:** Plan 1 (API Client + Auth), Plan 3 (Account composable for deposit balance)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/modules/market/composables/useStrikeVaults.ts` | Composable: vault list, details, portfolio, user positions |
| `src/sidepanel/pages/VaultsPage.vue` | Mini-gero vault browsing page |
| `src/sidepanel/components/perps/VaultCard.vue` | Vault summary card (TVL, APR, PnL, status) |
| `src/sidepanel/components/perps/VaultDetailSheet.vue` | Bottom sheet: vault detail + deposit/withdraw |
| `src/sidepanel/components/perps/VaultPortfolioChart.vue` | Vault equity curve (TVL over time) |
| `src/modules/dashboard/dialogs/VaultsDialog.vue` | Full dashboard vault browsing dialog |
| `src/sidepanel/router.ts` | Add `/vaults` route |

---

### Task 1: Vaults Composable

**Files:**
- Create: `src/modules/market/composables/useStrikeVaults.ts`

- [ ] **Step 1: Create vaults composable**

```typescript
// src/modules/market/composables/useStrikeVaults.ts
import { ref, computed } from 'vue';
import { strikeVaultApi } from '@/api/strike-v2.vaults';
import type {
  VaultInfo, VaultListResponse, VaultPortfolioResponse,
  UserVaultPosition, VaultPeriod,
} from '@/api/strike-v2.types';

const vaults = ref<VaultInfo[]>([]);
const totalCount = ref(0);
const userPositions = ref<UserVaultPosition[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

export function useStrikeVaults() {

  async function loadVaults(params: {
    limit?: number;
    offset?: number;
    period?: VaultPeriod;
    type?: 'user' | 'protocol';
    status?: string;
  } = {}): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await strikeVaultApi.listVaults({ limit: 50, status: 'active', ...params });
      vaults.value = res.vaults;
      totalCount.value = res.count;
    } catch (e: any) {
      error.value = e?.message || 'Failed to load vaults';
    } finally {
      loading.value = false;
    }
  }

  async function loadUserPositions(): Promise<void> {
    try {
      const res = await strikeVaultApi.getAllUserVaultPositions();
      userPositions.value = res.positions;
    } catch (e: any) {
      console.error('Failed to load user vault positions:', e);
    }
  }

  async function getVaultDetail(id: string): Promise<VaultInfo | null> {
    try {
      return await strikeVaultApi.getVault(id);
    } catch { return null; }
  }

  async function getVaultPortfolio(id: string, period: VaultPeriod = '30d'): Promise<VaultPortfolioResponse | null> {
    try {
      return await strikeVaultApi.getVaultPortfolio(id, period);
    } catch { return null; }
  }

  async function getUserPosition(vaultId: string): Promise<UserVaultPosition | null> {
    try {
      return await strikeVaultApi.getUserVaultPosition(vaultId);
    } catch { return null; }
  }

  const activeVaults = computed(() =>
    vaults.value.filter(v => v.status === 'active')
  );

  const verifiedVaults = computed(() =>
    vaults.value.filter(v => v.is_verified)
  );

  // User's total vault equity
  const totalVaultEquity = computed(() =>
    userPositions.value.reduce((sum, p) => sum + parseFloat(p.current_value || '0'), 0)
  );

  const totalVaultPnl = computed(() =>
    userPositions.value.reduce((sum, p) => sum + parseFloat(p.pnl || '0'), 0)
  );

  return {
    vaults,
    totalCount,
    userPositions,
    loading,
    error,
    activeVaults,
    verifiedVaults,
    totalVaultEquity,
    totalVaultPnl,
    loadVaults,
    loadUserPositions,
    getVaultDetail,
    getVaultPortfolio,
    getUserPosition,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/market/composables/useStrikeVaults.ts
git commit -m "feat(strike-v2): add vaults composable (list, positions, portfolio)"
```

---

### Task 2: Vault Card Component

**Files:**
- Create: `src/sidepanel/components/perps/VaultCard.vue`

- [ ] **Step 1: Create vault summary card**

Displays:
- Vault name + verified badge
- Type badge (User / Protocol)
- TVL (total value locked)
- APR (annualized return)
- 30d PnL (colored)
- Sharpe ratio
- Max drawdown
- Depositor count
- Click → opens VaultDetailSheet

Styling: liquid glass card matching the wallet's design language.

- [ ] **Step 2: Commit**

---

### Task 3: Vault Detail Bottom Sheet

**Files:**
- Create: `src/sidepanel/components/perps/VaultDetailSheet.vue`

- [ ] **Step 1: Create vault detail sheet**

A BottomSheet showing full vault details:

**Header section:**
- Vault name, description, leader info
- Status badge, verified badge
- Performance metrics row (TVL, APR, Sharpe, Max Drawdown)

**Chart section:**
- VaultPortfolioChart (TVL over time)
- Period selector chips (24h, 7d, 30d, 6m, 1y, all)

**Depositors section:**
- Top depositors list (from `getVaultDepositors`)
- User's own position (if deposited)

**Actions section:**
- Deposit button (opens deposit flow)
- Withdraw button (if user has position)
- Deposit/withdraw amounts with balance preview

**Deposit flow:**
The v2 API likely requires a Cardano transaction to deposit ADA into the vault smart contract. This flow needs:
1. User enters amount
2. Build deposit transaction (may require backend endpoint)
3. Sign with spending password / hardware wallet
4. Submit transaction

**Note:** The vault deposit/withdraw mechanism needs clarification — the v2 API spec shows read-only vault endpoints. The actual deposit/withdraw may still use on-chain transactions via a separate endpoint not in the current docs. **Flag for discussion with Strike team.**

- [ ] **Step 2: Commit**

---

### Task 4: Vault Portfolio Chart Component

**Files:**
- Create: `src/sidepanel/components/perps/VaultPortfolioChart.vue`

- [ ] **Step 1: Create vault equity curve chart**

Uses `VaultPortfolioResponse.history` data:
- Time-series line chart: TVL, PnL, Fees
- Period selector drives API param
- Color-coded: TVL in primary, PnL in green/red

Can reuse the lightweight-charts or existing chart patterns.

- [ ] **Step 2: Commit**

---

### Task 5: Vaults Page (Mini-Gero)

**Files:**
- Create: `src/sidepanel/pages/VaultsPage.vue`
- Modify: `src/sidepanel/router.ts`

- [ ] **Step 1: Create vaults browsing page**

Layout:
1. **Header:** "Vaults" title + search input
2. **Filter chips:** All, Verified, My Deposits
3. **My Deposits section** (if user has vault positions):
   - Summary: total equity, total PnL
   - User's vault position cards
4. **Browse Vaults:**
   - List of VaultCard components
   - Sort by: TVL, APR, PnL
   - Load more pagination

- [ ] **Step 2: Add route**

```typescript
// In src/sidepanel/router.ts
{
  path: '/vaults',
  name: 'vaults',
  component: () => import('../pages/VaultsPage.vue'),
}
```

- [ ] **Step 3: Add navigation**

Add a "Vaults" entry to the perps page or bottom nav if applicable.

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/pages/VaultsPage.vue src/sidepanel/router.ts
git commit -m "feat(strike-v2): add vaults browsing page with portfolio tracking"
```

---

### Task 6: Vaults Dialog (Full Dashboard)

**Files:**
- Create: `src/modules/dashboard/dialogs/VaultsDialog.vue`

- [ ] **Step 1: Create full dashboard vaults dialog**

Same features as VaultsPage but in a dialog layout matching the existing PerpetualsDialog pattern. Can reuse the same composable and sub-components.

- [ ] **Step 2: Commit**

---

### Task 7: i18n Keys for Vaults

**Files:**
- Modify: `src/plugins/i18n/us.ts`
- Modify: `src/plugins/i18n/de.ts`

- [ ] **Step 1: Add vault translation keys**

```typescript
// us.ts additions
'vaults.title': 'Vaults',
'vaults.browse': 'Browse Vaults',
'vaults.myDeposits': 'My Deposits',
'vaults.totalEquity': 'Total Equity',
'vaults.tvl': 'TVL',
'vaults.apr': 'APR',
'vaults.pnl': 'PnL',
'vaults.sharpeRatio': 'Sharpe Ratio',
'vaults.maxDrawdown': 'Max Drawdown',
'vaults.depositors': 'Depositors',
'vaults.deposit': 'Deposit',
'vaults.withdraw': 'Withdraw',
'vaults.verified': 'Verified',
'vaults.protocol': 'Protocol',
'vaults.user': 'User',
'vaults.noVaults': 'No vaults available',
'vaults.noDeposits': 'You have no vault deposits',
'vaults.enterAmount': 'Enter amount',
'vaults.yourPosition': 'Your Position',
'vaults.currentValue': 'Current Value',
'vaults.depositedAmount': 'Deposited',
'vaults.withdrawnAmount': 'Withdrawn',
```

- [ ] **Step 2: Add German translations**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(strike-v2): add vault i18n keys (EN + DE)"
```

---

### Task 8: Feature Flag + Network Guard

**Files:**
- Modify: `src/stores/featureFlagsStore.ts`
- Modify: `src/utils/networks.ts`

- [ ] **Step 1: Add vault support flag**

Ensure vaults are only available on Cardano Mainnet (same as perpetuals):
- Check `perpetualsSupport` flag in networks.ts (already exists)
- Add `isVaultsEnabled` to feature flags if needed
- Guard the vaults route and nav items

- [ ] **Step 2: Commit**

---

## Summary

After completing this plan:
- Browse managed trading vaults with performance metrics
- View vault portfolio charts (TVL, APR, PnL over time)
- Track personal vault deposits and PnL
- Vault detail sheets with depositor info
- Both mini-gero and full dashboard support
- i18n complete (EN + DE)
- Feature-flagged and network-gated (Cardano Mainnet only)

## Open Questions
1. **Vault deposit/withdraw flow:** The v2 API spec shows read-only endpoints. How do users deposit/withdraw? Is there an on-chain transaction flow or a separate API endpoint?
2. **Vault trading:** Can users see the leader's trades/positions within a vault?
3. **Vault creation:** Should Gero support creating vaults (leader functionality)?
