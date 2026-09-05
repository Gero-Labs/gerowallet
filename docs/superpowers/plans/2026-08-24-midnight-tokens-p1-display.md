# Midnight Token Display (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make non-NIGHT Midnight unshielded tokens (e.g. USDM) visible in the wallet's holdings table and DApp connector, instead of being silently discarded at sync.

**Architecture:** The wallet already receives every token color — gero-sync forwards them and Nexus persists them. The sync layer's two ingest paths disagree: the CATCH_UP snapshot path admits every color, while the per-transaction delta path drops non-native creations but still processes their removals — so token balances decay toward zero over a live session. Nothing in the UI renders a non-NIGHT color either. We delete that filter, derive per-color balances as a pure function over the UTxO set that already carries `tokenType`, and render extra rows. No new store, table, endpoint, or component. `nightUnshielded` is untouched: both balance paths already filter to native NIGHT independently, which Task 2 asserts rather than assumes.

**Tech Stack:** TypeScript, Vue 2.7 + Vuetify 2.7, Vitest, Dexie (IndexedDB), Chrome MV3 messaging.

**Spec:** `docs/superpowers/specs/2026-08-24-midnight-token-support-design.md`

**Base:** branch `feat/midnight-tokens`, worktree off `origin/development` @ `e0af42bc`. All line numbers below are verified against this base.

---

## Scope

Tasks 1–5 are wallet-only and have **no backend dependency** — they deliver the user-visible fix (USDM appears with its balance). Metadata enrichment (names/decimals) is deferred to **P1b**, which requires a Nexus change and is scoped at the end of this document rather than planned blind.

Out of scope for P1: sending tokens (P2), per-token history (P3), fiat valuation (P4).

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/chains/midnight/midnightTokenBalances.ts` | Pure, dependency-free helpers: native-NIGHT predicate + per-color balance derivation | **Create** |
| `src/chains/midnight/midnightTokenBalances.spec.ts` | Unit tests for the above | **Create** |
| `src/services/midnight-sync.service.ts` | Stop discarding non-native outputs; delegate the predicate | Modify (`:390`, `:526-529`) |
| `src/stores/midnightStore.ts` | Reuse the shared predicate instead of a local copy | Modify (`~:956-959`) |
| `src/modules/dashboard/components/MidnightHoldingsTable.vue` | Render one row per held color | Modify (`:217`) |
| `src/chrome/background.ts` | Connector returns every color, not just NIGHT | Modify (`:5305-5312`) |
| `src/sidepanel/components/flows/ReceiveSheet.vue` | Copy: this address receives all unshielded tokens | Modify |
| `src/plugins/i18n/us.ts`, `de.ts` | New copy keys (both files — house rule) | Modify |

Why a new file rather than adding to `midnightStore.ts`: the store is ~1060 lines and imports Vue, chrome storage, and messaging, so unit-testing a selector through it drags in the whole extension context. A pure module is directly testable and lets the three existing copies of the "is this native NIGHT?" check collapse to one.

---

### Task 1: Pure per-color balance selector

**Files:**
- Create: `src/chains/midnight/midnightTokenBalances.ts`
- Test: `src/chains/midnight/midnightTokenBalances.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/chains/midnight/midnightTokenBalances.spec.ts
import { describe, it, expect } from 'vitest';
import { isNativeNight, midnightTokenBalances } from './midnightTokenBalances';
import type { MidnightUnshieldedUtxo } from './midnightTypes';

const USDM = '8c2c22bc0c37fa999d0611cb5c570f587938ac5ffc8b0925143dad4c0764e94b';
const NIGHT_ZERO = '0'.repeat(64);

function utxo(tokenType: string, value: bigint, outputIndex = 0): MidnightUnshieldedUtxo {
  return {
    owner: 'mn_addr1test',
    tokenType,
    value,
    intentHash: `intent${outputIndex}`,
    outputIndex,
    initialNonce: '',
    registeredForDustGeneration: false,
  };
}

describe('isNativeNight', () => {
  it('treats empty and all-zero token types as native NIGHT', () => {
    expect(isNativeNight('')).toBe(true);
    expect(isNativeNight(undefined)).toBe(true);
    expect(isNativeNight(NIGHT_ZERO)).toBe(true);
  });

  it('treats a real token color as non-native', () => {
    expect(isNativeNight(USDM)).toBe(false);
  });
});

describe('midnightTokenBalances', () => {
  it('returns an empty map when the wallet holds only NIGHT', () => {
    expect(midnightTokenBalances([utxo(NIGHT_ZERO, 100n), utxo('', 50n, 1)])).toEqual({});
  });

  it('sums a single non-native color', () => {
    expect(midnightTokenBalances([utxo(USDM, 5000000n)])).toEqual({ [USDM]: 5000000n });
  });

  it('sums multiple UTxOs of the same color and excludes NIGHT', () => {
    const result = midnightTokenBalances([
      utxo(USDM, 5000000n, 0),
      utxo(USDM, 2500000n, 1),
      utxo(NIGHT_ZERO, 999n, 2),
    ]);
    expect(result).toEqual({ [USDM]: 7500000n });
  });

  it('keeps distinct colors separate', () => {
    const other = 'ab'.repeat(32);
    const result = midnightTokenBalances([utxo(USDM, 1n, 0), utxo(other, 2n, 1)]);
    expect(result).toEqual({ [USDM]: 1n, [other]: 2n });
  });

  it('returns an empty map for an empty UTxO set', () => {
    expect(midnightTokenBalances([])).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/chains/midnight/midnightTokenBalances.spec.ts`
Expected: FAIL — `Failed to resolve import "./midnightTokenBalances"`

- [ ] **Step 3: Write the implementation**

```ts
// src/chains/midnight/midnightTokenBalances.ts
/**
 * Per-color balance derivation for Midnight unshielded UTxOs.
 *
 * Every UTxO the wallet stores already carries `tokenType`, so per-color
 * balances are DERIVED, never stored — there is no new state to keep in sync
 * and nothing extra to broadcast across contexts.
 *
 * Native NIGHT is deliberately excluded here. It has its own balance field
 * (`MidnightBalances.nightUnshielded`) maintained by the sync service, and
 * that field has twice been zeroed by regressions; nothing in this module
 * writes to it.
 */
import type { MidnightUnshieldedUtxo } from './midnightTypes';

/**
 * Native NIGHT is the 32-byte-zero token type. gero-sync sometimes emits an
 * empty string instead (older indexer schemas), so both mean "native".
 */
export function isNativeNight(tokenType: string | undefined | null): boolean {
  const tt = tokenType ?? '';
  return tt === '' || /^0+$/.test(tt);
}

/**
 * Sum unshielded UTxOs per non-native token color.
 *
 * @returns map of token color → balance in base units. Empty when the wallet
 *          holds only NIGHT. Callers must divide by the token's decimals,
 *          which come from metadata and may be unknown.
 */
export function midnightTokenBalances(
  utxos: ReadonlyArray<MidnightUnshieldedUtxo>,
): Record<string, bigint> {
  const balances: Record<string, bigint> = {};
  for (const u of utxos) {
    const tokenType = u.tokenType ?? '';
    if (isNativeNight(tokenType)) continue;
    balances[tokenType] = (balances[tokenType] ?? 0n) + u.value;
  }
  return balances;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/chains/midnight/midnightTokenBalances.spec.ts`
Expected: PASS — 7 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/chains/midnight/midnightTokenBalances.ts src/chains/midnight/midnightTokenBalances.spec.ts
git commit -m "feat(midnight): derive per-color unshielded balances from the UTxO set"
```

---

### Task 2: Stop discarding non-native outputs at sync

This makes the delta path agree with the snapshot path (which already admits every color) and stops the live-session decay. It is not what first makes USDM visible — Task 3 is — but without it a freshly received token disappears again until the next full snapshot. The regression test matters more than the change: `nightUnshielded` must not move when a non-native UTxO enters the set.

**Files:**
- Modify: `src/services/midnight-sync.service.ts:390`, `:526-529`
- Modify: `src/stores/midnightStore.ts` (`isNight` local copy, ~`:956-959`)
- Test: `src/chains/midnight/midnightTokenBalances.spec.ts` (extend)

- [ ] **Step 1: Write the invariant test — it MUST drive the real store**

> **Corrected 2026-08-24 after review.** The first version of this step asserted the invariant by
> re-implementing the filter inside the test body (`set.filter(isNativeNight).reduce(...)`) and never
> imported production code. It could not fail: deleting both real guards left it green. A test that
> restates the implementation proves nothing. The replacement below drives
> `midnightActions.applyUtxoDeltas` and asserts against the real store field.

Feasibility is confirmed: `broadcastFromBackground` returns early when `context !== 'background'`
(`midnightStore.ts:646`), vitest runs happy-dom so `getContextType()` returns `'content'`, and
`src/stores/featureFlagsStore.spec.ts` is the in-repo precedent for importing a store directly.

Write a test that:
- imports `midnightStore` and `midnightActions` from `@/stores/midnightStore`,
- resets store state first so it does not depend on execution order,
- calls `applyUtxoDeltas` with an `added` array mixing a native-NIGHT UTxO and a USDM UTxO,
- asserts `midnightStore.balances.nightUnshielded` equals **only** the NIGHT value.

- [ ] **Step 2: Prove the test is not theatre**

Temporarily delete the `if (isNight(u))` guard at `midnightStore.ts:983`. Run
`npx vitest run src/chains/midnight/midnightTokenBalances.spec.ts` and confirm the new test goes
**RED**. Restore the guard and confirm **GREEN**. Record both observations.

A test guarding a twice-regressed money field is worth only as much as its demonstrated ability to
fail. If it stays green with the guard removed, it is still theatre — iterate until it fails.

- [ ] **Step 3: Remove the ingest gate**

In `src/services/midnight-sync.service.ts`, find at `:388-392`:

```ts
        for (const o of this.readOutputs(rawTx, 'created')) {
          if (o.owner !== myUnshielded) continue;
          if (!this.isNightOutput(o)) continue;
          added.push(this.outputToUtxo(o));
        }
```

Replace with:

```ts
        for (const o of this.readOutputs(rawTx, 'created')) {
          if (o.owner !== myUnshielded) continue;
          // Every token color is admitted. `nightUnshielded` stays native-only:
          // the delta path (midnightStore.applyUtxoDeltas) and the CATCH_UP
          // snapshot re-sum below each apply their own isNativeNight filter, so
          // non-native UTxOs enter the set without moving the NIGHT balance.
          added.push(this.outputToUtxo(o));
        }
```

- [ ] **Step 4: Collapse the duplicated predicate**

In `src/services/midnight-sync.service.ts`, add to the imports:

```ts
import { isNativeNight } from '@/chains/midnight/midnightTokenBalances';
```

Replace the body of `isNightOutput` at `:526-529`:

```ts
  /** Empty token type or 32-byte-zero token type both mean native NIGHT. */
  private isNightOutput(o: WsMidnightOutput): boolean {
    return isNativeNight(o.tokenType ?? o.token_type);
  }
```

In `src/stores/midnightStore.ts`, add the same import and replace the local copy inside `applyUtxoDeltas`:

```ts
    const isNight = (u: MidnightUnshieldedUtxo) => isNativeNight(u.tokenType);
```

Leave `NIGHT_TOKEN_TYPE_NULL` (`midnight-sync.service.ts:124`) exported and unchanged — `background.ts` imports it.

- [ ] **Step 5: Verify types and lint**

Run: `npm run typecheck && npx eslint src/services/midnight-sync.service.ts src/stores/midnightStore.ts src/chains/midnight/midnightTokenBalances.ts`
Expected: no errors. Fix any ESLint findings in these files before continuing (house rule).

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — no regressions, especially in `src/api/midnight-api.spec.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/services/midnight-sync.service.ts src/stores/midnightStore.ts src/chains/midnight/midnightTokenBalances.spec.ts
git commit -m "fix(midnight): stop discarding non-NIGHT unshielded tokens at sync"
```

---

### Task 3: Render one holdings row per held color

Without metadata (deferred to P1b) we know the color and the raw amount but not the decimals. Following the precedent PR #1005 set on Cardano, an unscaled balance is **flagged, never presented as fact**.

**Files:**
- Modify: `src/modules/dashboard/components/MidnightHoldingsTable.vue:217`
- Modify: `src/plugins/i18n/us.ts`, `src/plugins/i18n/de.ts`

- [ ] **Step 1: Add the i18n keys**

In `src/plugins/i18n/us.ts`, inside the `midnight` section:

```ts
    unknownToken: 'Unknown token',
    rawBalanceTooltip: 'Decimals for this token are unknown, so the raw on-chain amount is shown.',
```

In `src/plugins/i18n/de.ts`, the same section (house rule — never add a key to one file only):

```ts
    unknownToken: 'Unbekanntes Token',
    rawBalanceTooltip: 'Die Dezimalstellen dieses Tokens sind unbekannt, daher wird der rohe On-Chain-Betrag angezeigt.',
```

- [ ] **Step 2: Derive the token rows**

In `src/modules/dashboard/components/MidnightHoldingsTable.vue`, add to the imports:

```ts
import { midnightTokenBalances } from '@/chains/midnight/midnightTokenBalances';
```

Add above the existing `rows` computed at `:217`:

```ts
/**
 * One row per non-NIGHT color the wallet holds. Until the metadata resolver
 * lands (P1b) we have no decimals, so the raw base-unit amount is shown
 * and explicitly flagged — the same choice PR #1005 made on Cardano rather
 * than silently rendering a number 10^n too large.
 */
const tokenRows = computed<MidnightHoldingRow[]>(() =>
  Object.entries(midnightTokenBalances(midnightStore.utxos)).map(([color, amount]) => ({
    ticker: `${color.slice(0, 8)}…`,
    name: t('midnight.unknownToken') as string,
    balanceFormatted: `${amount.toString()} (raw)`,
    breakdownText: t('midnight.rawBalanceTooltip') as string,
    price: '—',
    value: '—',
    change24h: '—',
    change24hRaw: null,
    mcap: '—',
    avgCost: '—',
    pnl: '—',
    icon: 'mdi-help-circle-outline',
    iconBg: 'grey darken-4',
    iconColor: 'grey',
  })),
);
```

- [ ] **Step 3: Append the token rows to the table**

Change the `rows` computed at `:217` from `computed<MidnightHoldingRow[]>(() => [ { …NIGHT row… } ])` so the NIGHT row object is followed by a spread of the token rows. The closing of the array becomes:

```ts
  },
  ...tokenRows.value,
]);
```

`iconColor` and any other `MidnightHoldingRow` fields the NIGHT row sets must also be set on token rows — the interface at `:165-183` is the contract; do not add fields to it.

- [ ] **Step 4: Verify types, lint, and the design ratchet**

Run: `npm run typecheck && npx eslint src/modules/dashboard/components/MidnightHoldingsTable.vue && node scripts/design/audit.mjs`
Expected: typecheck clean, no ESLint errors, and every ratchet metric at or below its budget. The row reuses existing tokens (`grey darken-4`, an existing mdi glyph) so no metric should move. If `corruptedMdiNames` moves, the glyph name is wrong.

- [ ] **Step 5: Commit**

```bash
git add src/modules/dashboard/components/MidnightHoldingsTable.vue src/plugins/i18n/us.ts src/plugins/i18n/de.ts
git commit -m "feat(midnight): show held non-NIGHT tokens in the holdings table"
```

---

### Task 4: DApp connector returns every color

**Files:**
- Modify: `src/chrome/background.ts:5305-5312`

- [ ] **Step 1: Replace the NIGHT-only sum**

The handler at `:5285` currently sums only native NIGHT into a single-key record. Replace the body between the wallet guard and `sendResponse` with:

```ts
  // Report every unshielded color the wallet holds. Native NIGHT is normalized
  // to the canonical 32-byte-zero key a dapp checking nativeToken().raw expects;
  // Gero stores it internally as an empty tokenType.
  const { midnightTokenBalances } = await import('@/chains/midnight/midnightTokenBalances');
  let night = 0n;
  for (const u of midnightStore.utxos) {
    const tt = u.tokenType ?? '';
    if (tt === '' || tt === NIGHT_TOKEN_TYPE_NULL) night += u.value;
  }
  const data: Record<string, string> = {};
  if (night > 0n) data[NIGHT_TOKEN_TYPE_NULL] = night.toString();
  for (const [color, amount] of Object.entries(midnightTokenBalances(midnightStore.utxos))) {
    data[color] = amount.toString();
  }
  sendResponse({ id: request.id, data, target: TARGET, sender: SENDER.extension });
```

Leave `getShieldedBalances` at `:5327` unchanged — shielded per-token breakdown is out of scope (spec §11).

- [ ] **Step 2: Verify types and lint**

Run: `npm run typecheck && npx eslint src/chrome/background.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/chrome/background.ts
git commit -m "feat(midnight): connector reports every unshielded token color"
```

---

### Task 5: Receive-sheet copy

The unshielded address already accepts every color; only the copy implies NIGHT-only.

**Files:**
- Modify: `src/sidepanel/components/flows/ReceiveSheet.vue`
- Modify: `src/plugins/i18n/us.ts`, `src/plugins/i18n/de.ts`

- [ ] **Step 1: Add the i18n keys**

`src/plugins/i18n/us.ts`, `midnight` section:

```ts
    receiveAllTokens: 'This address receives NIGHT and all other unshielded Midnight tokens.',
```

`src/plugins/i18n/de.ts`, same section:

```ts
    receiveAllTokens: 'Diese Adresse empfängt NIGHT und alle anderen nicht abgeschirmten Midnight-Token.',
```

- [ ] **Step 2: Render the line for Midnight wallets**

In `ReceiveSheet.vue`, inside the existing Midnight branch of the template, add a caption under the address using the existing caption class used by neighbouring hint text (do not introduce a new class or colour):

```html
<p class="t-caption">{{ $t('midnight.receiveAllTokens') }}</p>
```

- [ ] **Step 3: Verify lint, i18n parity, and ratchet**

Run: `npx eslint src/sidepanel/components/flows/ReceiveSheet.vue && node scripts/design/audit.mjs`
Expected: no errors, no ratchet movement. Confirm by inspection that every key added in Tasks 3 and 5 exists in **both** `us.ts` and `de.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/components/flows/ReceiveSheet.vue src/plugins/i18n/us.ts src/plugins/i18n/de.ts
git commit -m "feat(midnight): say that the receive address accepts all unshielded tokens"
```

---

## Deferred: metadata enrichment (P1b — needs its own plan)

Turning `8c2c22bc…` into "USDM" with 6 decimals is **not planned here**, deliberately. It depends on a
Nexus endpoint that does not yet exist, and this plan's rule is no step without real code — writing
the wallet-side mapping against an imagined response shape would be guesswork dressed as a plan.

Tasks 1–5 above ship the user-visible fix without it.

**Prerequisite — run this first; it decides whether P1b can be planned at all:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$VITE_BACKEND_URL/api/assets/info?chain=MIDNIGHT&network=MAINNET&provider=NEXUS" \
  -H 'Content-Type: application/json' \
  -d '["8c2c22bc0c37fa999d0611cb5c570f587938ac5ffc8b0925143dad4c0764e94b"]'
```

- **404 / empty array** → the Nexus resolver is not deployed. P1b starts as a *Nexus* task: add a
  `chain=MIDNIGHT` branch to the assets-info resolver backed by the curated list. Gero's endpoint is
  already chain-parameterized (`api.ts:89-92`), so no wallet API change is needed.
- **200 with rows** → capture the exact response body and write the P1b plan against it.

**Two verified facts the P1b plan must build on:**

- `walletBg.ts:217` — *"Midnight runs through midnightSyncService"*. The Cardano sync path never runs
  for Midnight wallets, so `syncAssets` is not called for them today; the hook has to be added on the
  Midnight path, reusing the existing `walletBg.syncService` instance so there stays exactly one owner
  of the blockchain DB handle.
- `syncAssets` (`sync.service.ts:~759`) already implements the 24h metadata-retry TTL from PR #1005
  (`:762-772`) — precisely the behaviour a manually-curated Midnight list needs, since colors will sit
  unresolved until someone curates them.

**The raw-and-flagged row from Task 3 is permanent, not a stopgap.** With manual curation there will
always be held colors with no metadata, so that branch must survive P1b rather than being replaced.

---

## Definition of done (P1)

- [ ] A Midnight mainnet wallet holding USDM shows a USDM row in the holdings table.
- [ ] `nightUnshielded` is byte-identical before and after the change for a NIGHT-only wallet.
- [ ] `getUnshieldedBalances` returns both the NIGHT key and the USDM color.
- [ ] Every new i18n key exists in both `us.ts` and `de.ts`.
- [ ] `node scripts/design/audit.mjs` and `node scripts/design/contrast.mjs` pass with no budget increase.
- [ ] `npm run typecheck` and `npx vitest run` pass.

## Manual verification

The reported wallet is the test case. Restore/watch `mn_addr12pwxhsg2uv706sdjxkt4wct95makknh9camu0f4wxn7fja77jqfsevmpxm` on Midnight mainnet and confirm a row appears for color `8c2c22bc…64e94b` with raw balance `5000000` (or `5.00 USDM` once P1b lands). Confirm the NIGHT balance is unchanged from before the upgrade — that is the regression that matters.
