# Market Page — Outstanding Gaps

Tracked from PR #600 code review. None of these block the merge but should be addressed in follow-up work.

---

## Bugs (Low Priority)

### BUG-3: `searchWatcherRegistered` never reset in useGlobalSearch
**File:** `src/shared/composables/useGlobalSearch.ts`

The `searchWatcherRegistered` flag is set to `true` on first use but never reset. Unlike `useMarketData`, there is no consumer counting or cleanup. The debounced `watch(query, ...)` remains active forever after first use. Practically low-risk since `query` only changes via the search dialog, but inconsistent with the cleanup pattern in `useMarketData`.

**Fix:** Add consumer counting and `onUnmounted` cleanup, or at minimum reset the flag when no consumers remain.

---

### BUG-5: Portfolio cache singleton ignores subsequent option overrides
**File:** `src/shared/composables/usePortfolioData.ts`

The singleton `sharedCacheService` is created on first call with the provided options. Subsequent calls with different `cacheTimeMs` or `enableCache` values silently get the first instance's settings. Fine for current usage (same defaults everywhere), but could bite future callers.

**Fix:** Either document the singleton behavior or compare options on subsequent calls and warn if they differ.

---

## Security (Low Risk)

### SEC-1: QuickSwap does not prompt for spending password
**File:** `src/modules/market/components/QuickSwap.vue`

`executeSwap()` builds, signs, and submits a swap transaction without explicitly prompting for the spending password. The signing call goes through the background `METHOD.signTx` handler which may or may not enforce password verification depending on context.

**Action:** Verify the background signing path enforces password confirmation for options-context requests. If not, add a spending password prompt before signing (matching the pattern in `SwapWidget.vue`).

---

### SEC-2: Market API base URL from env variable not validated
**File:** `src/api/market-api.ts`

`import.meta.env['VITE_MARKET_API_URL']` is used directly as the axios `baseURL`. If tampered at build time, all market API calls would be redirected. Low risk since env variables are set at build time and the fallback URL is correct.

**Action:** No immediate fix needed. Consider adding a URL format validation if the env variable is present.

---

## Code Quality

### QUALITY-4: `policyLocked` hardcoded to `true`
**File:** `src/modules/market/composables/useMarketData.ts` (~line 116)

All tokens are marked as `policyLocked: true` with a TODO comment. `TokenDetailPanel.vue` renders a lock/unlock icon based on this value, so all tokens currently show a green lock icon — misleading for tokens with open minting policies.

**Fix:** Fetch actual policy lock status from the market API or blockchain, or remove the lock icon until accurate data is available.

---

### Compensation BPS persistence (from PR #599)
**File:** `src/stores/governanceStore.ts`

`currentCompensationBps` is in-memory only — lost on extension reload or wallet switch. The restoration code in `CardanoGovernance.vue` only runs when the user navigates to the governance tab. Staking withdrawals made without visiting governance first will not include the compensation donation.

**Fix:** Persist `currentCompensationBps` to the wallet-db `config` table and restore during wallet initialization.
