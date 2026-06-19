# Collateral Auto-Detect (Eternl-Style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match Eternl's "automatic collateral" UX so users don't need to manually configure collateral, AND fix the latent bug where the auto-picked collateral UTxO can be accidentally spent by a regular send during a dApp session.

**Architecture:** Gero already auto-picks a candidate collateral UTxO in `walletStore.setUtxos()` and exposes it via CIP-30 `getCollateral()` in `serialization.ts`. Two changes are needed: (1) **safety** — exclude the auto-picked UTxO from the coin selector input pool in `builder.ts` so regular sends don't spend it; (2) **UX** — replace the always-prominent "Set Collateral" button in `CollateralTab.vue` with a status banner that hides the action when auto-detection succeeds, plus a tooltip explaining the auto behavior.

**Tech Stack:** Vue 2.7, TypeScript, Vuetify 2.7, `@cardano-sdk/core`, custom Vue Observable stores.

**Out of scope (intentional):**
- No pooled hot-wallet "sponsored collateral" service — Eternl's tooltip wording confirms they only do client-side auto-detection.
- No DB persistence of a user-locked collateral UTxO — auto-detection re-runs on every sync, so a stable identity isn't needed.
- No per-dApp opt-in for collateral usage.
- No protocol-level CIP-40 `collateralReturn` work.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/shared/utils/builder.ts` | **Modify** | Add `excludeCollateral?: boolean` parameter (default `true`); filter `walletStore.collateral` from `formattedUtxos` before input selection. |
| `src/modules/dashboard/components/CollateralTab.vue` | **Modify** | Replace always-visible action button with status banner (auto-detected vs needs setup). Add Eternl-style tooltip on the title. |
| `src/plugins/i18n/us.ts` | **Modify** | Add new English keys for status banner, tooltip, status labels. |
| `src/plugins/i18n/de.ts` | **Modify** | Add German translations for the same keys. |
| `src/modules/dashboard/components/CollateralTab.vue` (script section) | **Modify** | Pass `excludeCollateral: false` when building the explicit "create collateral UTxO" tx (so the existing CollateralTab flow doesn't break itself). |

**Files NOT touched:**
- `src/stores/walletStore.ts` — auto-pick logic in `setUtxos()` already works correctly. No change needed.
- `src/chrome/serialization.ts` — `getCollateral()` already filters pure-ADA UTxOs at request time. No change needed.
- `src/modules/dashboard/dialogs/SettingsDialog.vue` — leaves the Collateral tab visible (the cleaned-up CollateralTab content makes the tab unobtrusive on its own).
- All 12 other call sites of `buildCardanoTransaction` — they get the safe default (`excludeCollateral: true`) for free.

---

## Key Context for the Engineer

**How collateral works in Gero today (read this first):**

1. On every UTxO sync, `walletStore.setUtxos()` (lines 239–247) auto-picks the smallest pure-ADA UTxO between 5 and 20 ADA and stores it in `walletStore.collateral`. This is in-memory only — it's recomputed on every sync, so there's no persistence layer to worry about.
2. When a dApp calls CIP-30 `getCollateral()`, `serialization.ts:getCollateral()` (lines 424–467) **independently** scans pure-ADA UTxOs from `storedUtxos` and returns ones meeting the requested amount. It does NOT use `walletStore.collateral`. This is the "Eternl-style automatic" path — it already works.
3. `CollateralTab.vue` exists as a manual escape hatch: if `walletStore.collateral` is null (no candidate found), it lets the user submit a self-send tx that creates a 5 ADA pure-ADA UTxO. The tab is currently always visible in Settings even when collateral is already auto-detected.

**The latent bug being fixed:**
- A dApp connects, the wallet auto-picks UTxO `X` for collateral.
- The dApp asks `getCollateral()` and embeds `X` in a tx it's preparing.
- Before the dApp's tx is signed, the user does a normal send. `builder.ts` runs coin selection over **all** UTxOs including `X` and might consume `X` as a regular input.
- The user signs the send. `X` is now spent.
- The dApp tx fails on submission because input `X` no longer exists.

**The fix:** Filter `walletStore.collateral` out of the input pool in `builder.ts` by default. The CollateralTab's own "Set Collateral" flow opts out via `excludeCollateral: false` because it can't exclude what doesn't exist yet.

**Edge case:** When `walletStore.collateral` is the *only* UTxO available (e.g., a freshly funded wallet with exactly one UTxO), filtering it would leave coin selection with nothing. Eternl handles this by falling back to using collateral as a regular input. We replicate that: if filtering would result in an empty UTxO set, return the unfiltered list.

---

## Tasks

### Task 1: Add i18n keys

**Files:**
- Modify: `src/plugins/i18n/us.ts`
- Modify: `src/plugins/i18n/de.ts`

- [ ] **Step 1: Find the existing `settings.collateral` block in `us.ts`**

Run: `grep -n "settings.collateral" "src/plugins/i18n/us.ts"`

Expected output should include line ~1707-1711:
```
1707:  'settings.collateral': 'Collateral',
1708:  'settings.collateralDescription': 'Collateral is used to cover network fees for smart contract transactions',
1709:  'settings.collateralTxSetSuccess': 'Collateral Tx Set Successfully. Tx ID: {txId}',
```

- [ ] **Step 2: Add new English keys after `settings.collateralDescription` in `us.ts`**

Edit `src/plugins/i18n/us.ts` to add these keys directly under `'settings.collateralDescription'`:

```typescript
  'settings.collateralAutoDetected': 'Collateral ready',
  'settings.collateralAutoDetectedDesc': 'A suitable ADA-only UTxO is available. Gero will use it automatically when a dApp requires collateral. No setup needed.',
  'settings.collateralNotFound': 'No suitable collateral UTxO',
  'settings.collateralNotFoundDesc': 'You don\'t have an ADA-only UTxO that can be used as collateral. Set one up below to interact with smart contracts.',
  'settings.collateralTooltip': 'Smart contracts may require collateral if validation fails. Gero handles this automatically when a suitable ADA-only UTxO is available in your wallet — no manual setup needed.',
  'settings.collateralAmount': 'Amount',
  'settings.collateralUtxoRef': 'UTxO',
```

- [ ] **Step 3: Add the matching German translations in `de.ts`**

Run: `grep -n "settings.collateralDescription" "src/plugins/i18n/de.ts"` to find the same anchor.

Edit `src/plugins/i18n/de.ts` and add directly under `'settings.collateralDescription'`:

```typescript
  'settings.collateralAutoDetected': 'Sicherheitsleistung bereit',
  'settings.collateralAutoDetectedDesc': 'Ein geeignetes reines-ADA-UTxO ist verfügbar. Gero verwendet es automatisch, wenn eine dApp Sicherheit benötigt. Keine Einrichtung erforderlich.',
  'settings.collateralNotFound': 'Keine geeignete Sicherheitsleistung',
  'settings.collateralNotFoundDesc': 'Sie haben kein reines-ADA-UTxO, das als Sicherheitsleistung verwendet werden kann. Richten Sie unten eines ein, um mit Smart Contracts interagieren zu können.',
  'settings.collateralTooltip': 'Smart Contracts erfordern möglicherweise eine Sicherheitsleistung, wenn die Validierung fehlschlägt. Gero verwaltet dies automatisch, wenn ein geeignetes reines-ADA-UTxO in Ihrer Wallet verfügbar ist — keine manuelle Einrichtung erforderlich.',
  'settings.collateralAmount': 'Betrag',
  'settings.collateralUtxoRef': 'UTxO',
```

- [ ] **Step 4: Verify both files parse**

Run: `npx tsc --noEmit src/plugins/i18n/us.ts src/plugins/i18n/de.ts 2>&1 | grep -E "(us|de)\.ts" | head -5`

Expected: no errors mentioning `us.ts` or `de.ts` (you may see unrelated pre-existing project errors — ignore them).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/i18n/us.ts src/plugins/i18n/de.ts
git commit -m "feat(i18n): add collateral auto-detect status keys"
```

---

### Task 2: Add `excludeCollateral` option to `buildCardanoTransaction`

**Files:**
- Modify: `src/shared/utils/builder.ts:76-102` (function signature)
- Modify: `src/shared/utils/builder.ts:282-310` (utxo formatting)

- [ ] **Step 1: Read the current function signature and understand the input flow**

Run: `sed -n '76,102p' "src/shared/utils/builder.ts"`

Expected: shows the `buildCardanoTransaction` parameter destructure ending with `auxiliaryData?: Cardano.AuxiliaryData;`.

Run: `sed -n '282,315p' "src/shared/utils/builder.ts"`

Expected: shows the `formattedUtxos` mapping that converts incoming `utxos` to BigInt-coin Cardano UTxOs, ending with `const utxoSet = new Set(formattedUtxos);`.

- [ ] **Step 2: Add the `excludeCollateral` parameter and import `walletStore`**

At the top of `src/shared/utils/builder.ts`, find the existing imports. Add this import alongside other store imports (search for `from '@/stores/` to find the right neighborhood — if there are no store imports yet, add it after the `@cardano-sdk/core` imports):

```typescript
import { walletStore } from '@/stores/walletStore';
```

Then modify the destructured parameter block (lines 76–102). Find the `auxiliaryData?` line and the closing brace `}`. Add `excludeCollateral` to both the destructure and the type annotation:

**Before** (lines 76–102):
```typescript
export async function buildCardanoTransaction({
  certificates = [],
  withdrawals = [],
  outputs = [],
  utxos,
  epochParams,
  changeAddress,
  tip,
  implicitCoin = BigInt(0),
  walletContext,
  auxiliaryData
}: {
  certificates?: Cardano.Certificate[];
  withdrawals?: Cardano.Withdrawal[];
  outputs?: Cardano.TxOut[];
  utxos: Cardano.Utxo[];
  epochParams: any;
  changeAddress: string;
  tip: any;
  implicitCoin?: bigint; // For deposits (positive) or deposit returns (negative)
  walletContext?: {
    keys: any;
    stakeAddress: string;
    accountIndex: number;
  };
  auxiliaryData?: Cardano.AuxiliaryData;
}): Promise<Cardano.Tx> {
```

**After:**
```typescript
export async function buildCardanoTransaction({
  certificates = [],
  withdrawals = [],
  outputs = [],
  utxos,
  epochParams,
  changeAddress,
  tip,
  implicitCoin = BigInt(0),
  walletContext,
  auxiliaryData,
  excludeCollateral = true
}: {
  certificates?: Cardano.Certificate[];
  withdrawals?: Cardano.Withdrawal[];
  outputs?: Cardano.TxOut[];
  utxos: Cardano.Utxo[];
  epochParams: any;
  changeAddress: string;
  tip: any;
  implicitCoin?: bigint; // For deposits (positive) or deposit returns (negative)
  walletContext?: {
    keys: any;
    stakeAddress: string;
    accountIndex: number;
  };
  auxiliaryData?: Cardano.AuxiliaryData;
  excludeCollateral?: boolean;
}): Promise<Cardano.Tx> {
```

- [ ] **Step 3: Filter the collateral UTxO out of `utxos` before the existing `formattedUtxos.map`**

Find line 282 — the start of the `const formattedUtxos: Cardano.Utxo[] = utxos.map(...)` block.

**Insert** the following filter logic immediately **before** the `formattedUtxos` line (so that the input array passed to `.map()` is already filtered). Replace the existing `const formattedUtxos: Cardano.Utxo[] = utxos.map((utxo: any) => {` with this expanded block:

```typescript
  // Eternl-style: exclude the auto-picked collateral UTxO from coin selection
  // so a regular send doesn't accidentally spend the UTxO that dApps will use
  // for collateral. Callers that explicitly need to use the collateral UTxO
  // (e.g. CollateralTab.vue's "Set Collateral" flow) pass excludeCollateral: false.
  let inputUtxos = utxos;
  if (excludeCollateral && walletStore.collateral) {
    const collateralRef = `${walletStore.collateral[0].txId}#${walletStore.collateral[0].index}`;
    const filtered = utxos.filter(u => `${u[0].txId}#${u[0].index}` !== collateralRef);
    // Edge case: if filtering leaves no UTxOs (e.g. wallet has only the collateral
    // UTxO), fall back to the unfiltered list so the tx can still be built.
    inputUtxos = filtered.length > 0 ? filtered : utxos;
  }

  // Convert UTXOs to proper format with BigInt values and ensure assets is always a Map
  const formattedUtxos: Cardano.Utxo[] = inputUtxos.map((utxo: any) => {
```

(The original `utxos.map((utxo: any) => {` becomes `inputUtxos.map((utxo: any) => {`.)

- [ ] **Step 4: Update the CollateralTab caller to opt out of the filter**

Open `src/modules/dashboard/components/CollateralTab.vue` and find the `buildCardanoTransaction` call (~line 104). Add `excludeCollateral: false` to the parameter object so the existing "Set Collateral" tx can still build itself even when a stale/invalid collateral pointer is set in the store:

**Before:**
```typescript
    const txData = await buildCardanoTransaction({
      outputs: [collateralOutput],
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value,
      walletContext: {
        keys: keys.value,
        stakeAddress: loggedWallet.value.stakeAddress,
        accountIndex: 0
      }
    });
```

**After:**
```typescript
    const txData = await buildCardanoTransaction({
      outputs: [collateralOutput],
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value,
      walletContext: {
        keys: keys.value,
        stakeAddress: loggedWallet.value.stakeAddress,
        accountIndex: 0
      },
      excludeCollateral: false
    });
```

- [ ] **Step 5: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -E "builder\.ts|CollateralTab\.vue" | head -10`

Expected: no errors mentioning `builder.ts` or `CollateralTab.vue`. (Ignore unrelated pre-existing errors elsewhere in the project.)

- [ ] **Step 6: Manual verification — sanity check the filter logic**

Open the wallet in dev mode (`npm run dev`), unlock, and open the JS console on the options page. Run:

```javascript
// Inspect the auto-picked collateral
console.log('collateral:', JSON.parse(JSON.stringify(window.walletStore?.collateral || 'none')));
console.log('utxo count:', window.walletStore?.utxos?.length);
```

You should see a non-null `collateral` object with `txId` and `index` if your test wallet has a 5–20 ADA pure-ADA UTxO. (If not, send 5 ADA to your test wallet first.)

Then trigger a small send (1 ADA → another address). Open the tx confirm dialog. Inspect the `inputs` of the proposed transaction. Verify that the `txId#index` matching `walletStore.collateral` is **NOT** in the inputs list.

Expected: the collateral UTxO is excluded from the regular send.

- [ ] **Step 7: Commit**

```bash
git add src/shared/utils/builder.ts src/modules/dashboard/components/CollateralTab.vue
git commit -m "fix(builder): exclude auto-picked collateral UTxO from coin selection

Adds an excludeCollateral option (default true) to buildCardanoTransaction
so regular sends don't accidentally spend the UTxO that CIP-30 getCollateral
will return to dApps. CollateralTab opts out so the explicit setup flow
can still build a 5 ADA self-send."
```

---

### Task 3: Rebuild `CollateralTab.vue` UI with status banner + tooltip

**Files:**
- Modify: `src/modules/dashboard/components/CollateralTab.vue:1-42` (template)

- [ ] **Step 1: Read the current template structure**

Run: `sed -n '1,42p' "src/modules/dashboard/components/CollateralTab.vue"`

You should see the current template: a `v-card-title`, `v-card-subtitle`, a data table, and a row with the "Set Collateral" button. The data table is always shown; the button is `:disabled="collateralCandidate.length !== 0"` which means it's disabled (greyed out) when collateral is already detected. This is unclear UX — replace it with explicit status states.

- [ ] **Step 2: Replace the entire template (lines 1–42) with a status-banner-driven version**

Replace lines 1–42 of `src/modules/dashboard/components/CollateralTab.vue` with this exact block:

```vue
<template>
  <v-tab-item>
    <v-card flat class="transparent">
      <v-card-title class="px-0 text-left d-flex align-center">
        <span>{{ $t('settings.whatIsCollateral') }}</span>
        <v-tooltip right max-width="320" content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <v-icon small class="ml-2" color="grey lighten-1" v-bind="attrs" v-on="on">
              mdi-information-outline
            </v-icon>
          </template>
          <span>{{ $t('settings.collateralTooltip') }}</span>
        </v-tooltip>
      </v-card-title>
      <v-card-subtitle class="px-0 text-left">
        {{ $t('settings.collateralDescription') }}
      </v-card-subtitle>

      <v-card-text class="text-left px-0">
        <!-- Status: auto-detected (success) -->
        <v-alert
          v-if="collateral"
          dense
          outlined
          color="success"
          icon="mdi-check-circle-outline"
          class="mb-4"
        >
          <div class="font-weight-bold">{{ $t('settings.collateralAutoDetected') }}</div>
          <div class="caption mt-1">{{ $t('settings.collateralAutoDetectedDesc') }}</div>
          <v-row no-gutters class="mt-3" align="center">
            <v-col cols="auto" class="caption mr-2">{{ $t('settings.collateralAmount') }}:</v-col>
            <v-col cols="auto" class="font-weight-medium">
              {{ filters.toCurrency(collateral[1].value.coins.toString(), false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', false, 6) }}
            </v-col>
          </v-row>
          <v-row no-gutters class="mt-1" align="center">
            <v-col cols="auto" class="caption mr-2">{{ $t('settings.collateralUtxoRef') }}:</v-col>
            <v-col cols="auto" class="caption">
              {{ filters.truncate(`${collateral[0].txId}#${collateral[0].index}`) }}
            </v-col>
            <v-col cols="auto" class="ml-1">
              <CopyButton x-small :value="`${collateral[0].txId}#${collateral[0].index}`" />
            </v-col>
          </v-row>
        </v-alert>

        <!-- Status: not found (warning + setup action) -->
        <v-alert
          v-else
          dense
          outlined
          color="warning"
          icon="mdi-alert-circle-outline"
          class="mb-4"
        >
          <div class="font-weight-bold">{{ $t('settings.collateralNotFound') }}</div>
          <div class="caption mt-1">{{ $t('settings.collateralNotFoundDesc') }}</div>
          <div class="mt-3">
            <v-btn
              small
              class="geroButton"
              style="color: black!important;"
              :loading="isCreating"
              @click="setCollateral"
            >
              {{ $t('settings.setCollateral') }}
            </v-btn>
          </div>
        </v-alert>
      </v-card-text>
    </v-card>
  </v-tab-item>
</template>
```

- [ ] **Step 3: Add an `isCreating` ref and wrap `setCollateral()` to set it**

In the script section of `CollateralTab.vue`, find the existing `const setCollateral = async () => {` block. Add a new ref above it and wrap the body with try/finally:

**Before:**
```typescript
const collateralCandidate = computed<any>(() => {
  if (collateral.value) {
    return [collateral.value].map((utxo: Cardano.Utxo) => ({
      utxo: `${utxo[0].txId}#${utxo[0].index}`,
      address: utxo[1].address,
      balance: utxo[1].value.coins.toString()
    }));
  }
  return [];
});

// Methods
const setCollateral = async () => {
  try {
```

**After:**
```typescript
const isCreating = ref(false);

// Methods
const setCollateral = async () => {
  isCreating.value = true;
  try {
```

Then find the end of `setCollateral` (the last `} catch` block) and ensure `isCreating.value = false;` runs in the catch block AND after `submit()` succeeds. The simplest fix: find the `catch` block (around line 134) and insert the reset.

**Before** (around lines 133-141):
```typescript
  } catch (error: any) {
    console.error('Error building collateral transaction:', error);
    if (error.message?.includes('UTxO Balance Insufficient')) {
      snackbar.setError(t('settings.insufficientAdaForCollateral'));
    } else {
      snackbar.setError(t('settings.failedToBuildCollateral'));
    }
  }
};
```

**After:**
```typescript
  } catch (error: any) {
    console.error('Error building collateral transaction:', error);
    if (error.message?.includes('UTxO Balance Insufficient')) {
      snackbar.setError(t('settings.insufficientAdaForCollateral'));
    } else {
      snackbar.setError(t('settings.failedToBuildCollateral'));
    }
  } finally {
    isCreating.value = false;
  }
};
```

- [ ] **Step 4: Remove the now-unused `headers` ref and `collateralCandidate` computed**

The new template no longer references `headers` or `collateralCandidate`. Delete these blocks from the script section:

**Delete lines** (find them with `grep -n "headers = ref\|collateralCandidate = computed" "src/modules/dashboard/components/CollateralTab.vue"`):

```typescript
const headers = ref([
  {text: t('settings.utxo'), sortable: false, value: 'utxo'},
  {text: t('common.address'), sortable: false, value: 'address'},
  {text: t('common.balance'), sortable: false, value: 'balance'},
]);

const collateralCandidate = computed<any>(() => {
  if (collateral.value) {
    return [collateral.value].map((utxo: Cardano.Utxo) => ({
      utxo: `${utxo[0].txId}#${utxo[0].index}`,
      address: utxo[1].address,
      balance: utxo[1].value.coins.toString()
    }));
  }
  return [];
});
```

- [ ] **Step 5: TypeScript + lint check**

Run: `npx tsc --noEmit 2>&1 | grep -E "CollateralTab\.vue" | head -10`

Expected: no errors mentioning `CollateralTab.vue`. (Pre-existing project errors elsewhere are fine.)

Run: `npx eslint "src/modules/dashboard/components/CollateralTab.vue" 2>&1 | head -20`

Expected: no errors or warnings. If you see "no-unused-vars" for any deleted bindings, double-check Step 4.

- [ ] **Step 6: Manual verification — auto-detected state**

1. `npm run dev:background && npm run dev` (rebuild background script if needed — see CLAUDE.md "Background Polling" section)
2. Reload the wallet extension
3. Unlock a test wallet that has at least one 5–20 ADA pure-ADA UTxO
4. Open Settings → Collateral tab
5. **Expected**: Green `success` alert with title "Collateral ready", body text matching the new tooltip wording, the UTxO amount and truncated `txHash#index` displayed with a CopyButton. **No "Set Collateral" button visible.**
6. Hover over the `mdi-information-outline` icon next to the tab title
7. **Expected**: Tooltip shows the long-form Eternl-style explanation.

- [ ] **Step 7: Manual verification — needs setup state**

1. Switch to (or create) a test wallet that has *only* multi-asset UTxOs (no pure ADA), OR a wallet with no funds at all
2. Open Settings → Collateral tab
3. **Expected**: Yellow `warning` alert with title "No suitable collateral UTxO" and the "Set Collateral" button visible inside the alert.
4. (Optional, if wallet has enough ADA to fund one) Click "Set Collateral". The button shows a loading spinner. After the tx submits, the wallet syncs, `walletStore.collateral` becomes set, and the alert switches to the green success state on next render.

- [ ] **Step 8: Commit**

```bash
git add src/modules/dashboard/components/CollateralTab.vue
git commit -m "feat(settings): redesign CollateralTab with auto-detect status banner

Replaces the always-visible data table + greyed-out button with two
status states: a green 'Collateral ready' alert showing the auto-picked
UTxO, or a yellow 'No suitable collateral' alert with the setup button.
Adds a tooltip explaining the auto-detect behavior to match Eternl's UX."
```

---

### Task 4: Add a feature notification badge for the redesigned tab

**Files:**
- Modify: `src/shared/composables/useFeatureNotifications.ts`
- Modify: `src/modules/dashboard/components/CollateralTab.vue` (script: mark as seen on mount)
- Modify: `src/modules/dashboard/dialogs/SettingsDialog.vue` (add dot to tab label)

**Why:** Existing users will already have collateral set up but never see the new banner / tooltip. A small "new feature" indicator on the Collateral tab nudges them to look once.

- [ ] **Step 1: Add the feature definition**

Open `src/shared/composables/useFeatureNotifications.ts`. Find the `FEATURE_DEFINITIONS` array. Add a new entry alongside the existing 2.7.0 features:

```typescript
  // Settings > Collateral > Auto-detect status banner
  {
    id: 'settings.collateral.autoDetect',
    version: '2.7.0',
    path: ['settings', 'collateral', 'autoDetect']
  },
```

- [ ] **Step 2: Mark the feature as seen when the tab is opened**

In `src/modules/dashboard/components/CollateralTab.vue`, add an import for the feature notification helpers near the top of the `<script setup>` block:

```typescript
import { isFeatureNew, markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';
```

Then add a computed and an `onMounted` hook (add `onMounted` to the existing `vue` import line if it's not there):

```typescript
const hasNewCollateralFeature = computed(() => isFeatureNew('settings.collateral.autoDetect'));

onMounted(() => {
  if (hasNewCollateralFeature.value) {
    markFeatureAsSeen('settings.collateral.autoDetect');
  }
});
```

- [ ] **Step 3: Add a notification dot to the Collateral tab label in SettingsDialog**

Open `src/modules/dashboard/dialogs/SettingsDialog.vue`. Find line ~105:

```typescript
  { label: t('settings.collateral'), value: 'collateral', disabled: false },
```

Find where the tabs are rendered (search for `v-tab` in the file). The exact rendering depends on the existing template, but the goal is to show a small red dot next to the "Collateral" tab label when `hasNewFeaturesInPath(['settings', 'collateral'])` is true.

Add this import to the script section:

```typescript
import { hasNewFeaturesInPath } from '@/shared/composables/useFeatureNotifications';
```

Add this computed:

```typescript
const hasNewCollateralFeature = computed(() => hasNewFeaturesInPath(['settings', 'collateral']));
```

In the template, find the `v-tab` that renders the collateral tab. Inline the dot inside the label:

```vue
<v-tab :key="tab.value" :disabled="tab.disabled">
  {{ tab.label }}
  <v-icon
    v-if="tab.value === 'collateral' && hasNewCollateralFeature"
    x-small
    color="error"
    class="ml-1"
  >
    mdi-circle
  </v-icon>
</v-tab>
```

If the existing template doesn't iterate tabs with `tab.value`, adapt the condition to whatever discriminator the file uses. (If you can't find an iteration pattern, paste the relevant `v-tabs` block and reason about it before editing.)

- [ ] **Step 4: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -E "(CollateralTab|SettingsDialog|useFeatureNotifications)\.(ts|vue)" | head -10`

Expected: no errors in those three files.

- [ ] **Step 5: Manual verification**

1. Open dev tools → Application → Local Storage → find the `gero_feature_notifications` key
2. Delete it (or set the `seenFeatures` value to `{}`) to simulate a user who hasn't seen anything new
3. Reload the extension
4. Open Settings — the Collateral tab label should have a red dot next to it
5. Click the Collateral tab — the dot should disappear (the `onMounted` marks it as seen)
6. Close and reopen Settings — the dot stays gone

- [ ] **Step 6: Commit**

```bash
git add src/shared/composables/useFeatureNotifications.ts src/modules/dashboard/components/CollateralTab.vue src/modules/dashboard/dialogs/SettingsDialog.vue
git commit -m "feat(notifications): badge the redesigned Collateral tab as new in 2.7.0"
```

---

### Task 5: End-to-end smoke test

**Files:** none

This task is verification-only. No code changes.

- [ ] **Step 1: Set up a test scenario with a fresh wallet**

1. Create a new test wallet (or use a known test wallet) on **Preprod** (not mainnet — we're going to spend ADA).
2. Fund it with ~10 ADA from the [Cardano Testnets faucet](https://docs.cardano.org/cardano-testnets/tools/faucet).
3. Wait for the sync to complete. Confirm the wallet shows the funded balance.

- [ ] **Step 2: Verify auto-detection works on the fresh wallet**

1. Open Settings → Collateral.
2. Expected: green "Collateral ready" banner showing one UTxO around 5–10 ADA.
3. Note the UTxO `txId#index` — write it down.

- [ ] **Step 3: Trigger a regular send and confirm the collateral UTxO is preserved**

1. From the Dashboard, send 1 ADA to any address (e.g. another preprod test wallet you control).
2. Open the tx confirm dialog **before** signing.
3. In dev tools → Vue devtools or `console.log(JSON.stringify(tx.value.body.inputs))`, inspect the inputs.
4. Expected: the `txId#index` you noted in Step 2 is **NOT** in the inputs.
5. Sign and submit the send.
6. After the next sync, reopen Settings → Collateral. Expected: the banner still shows the same collateral UTxO `txId#index` (it was not consumed).

- [ ] **Step 4: Connect to a Preprod dApp and verify CIP-30 `getCollateral` returns the auto-picked UTxO**

1. Open a Preprod dApp that requires collateral. Suggestion: [Preprod MuesliSwap](https://preprod.muesliswap.com) or any test dApp that triggers `cardano.gero.getCollateral`.
2. Connect Gero to the dApp.
3. In dev tools, set a breakpoint or `console.log` inside `src/chrome/serialization.ts:getCollateral()` (or just `console.log` the returned UTxO refs).
4. Trigger an action that requires collateral (e.g. start a swap quote → submit).
5. Verify the returned collateral UTxO `txId#index` matches the one in `walletStore.collateral`. (They might differ — `getCollateral()` re-scans rather than reading from the store. That's fine; both should be valid pure-ADA UTxOs ≥ requested amount.)
6. Sign the dApp's tx. Verify it submits successfully.

- [ ] **Step 5: Verify the "needs setup" path works**

1. Switch to a wallet that has **only** multi-asset UTxOs (or fund a new wallet with exactly 1 ADA — too small to be a candidate).
2. Open Settings → Collateral.
3. Expected: yellow "No suitable collateral" banner with a "Set Collateral" button.
4. Send 5 ADA to this wallet from another wallet.
5. After sync, the banner should automatically flip to the green success state.

- [ ] **Step 6: Sanity-check the unrelated callers of `buildCardanoTransaction`**

The new `excludeCollateral` parameter defaults to `true`, so all 12 existing callers automatically get the safe behavior. Spot-check one or two to make sure nothing broke:

1. Send a token (not just ADA) — exercises `SendDialog.vue:429`
2. Delegate to a stake pool — exercises `useDelegation.ts:157`

Both should succeed. If either fails with an "insufficient UTxO" error specifically because the collateral UTxO was the difference between success and failure, the edge-case fallback in Task 2 Step 3 should have caught it. If it didn't, file a bug — there's likely a UTxO accounting issue.

- [ ] **Step 7: No commit needed for this task**

Verification only.

---

## Self-Review Checklist

After completing all tasks, verify:

1. **Spec coverage:**
   - [x] Eternl-style auto-detect tooltip added (Task 1, Task 3)
   - [x] Status banner replaces always-visible action button (Task 3)
   - [x] Collateral UTxO excluded from coin selection (Task 2)
   - [x] CollateralTab's own setup flow opts out of the filter (Task 2 Step 4)
   - [x] German translations added for all new strings (Task 1 Step 3)
   - [x] Feature notification badge for existing users (Task 4)
   - [x] End-to-end manual verification plan (Task 5)

2. **Files explicitly NOT touched (verify nothing slipped in):**
   - `src/stores/walletStore.ts` — unchanged
   - `src/chrome/serialization.ts` — unchanged
   - All callers of `buildCardanoTransaction` other than `CollateralTab.vue` — unchanged

3. **No leftover references to deleted code:**
   - `headers` ref deleted in Task 3 Step 4 — grep `CollateralTab.vue` for `headers` after Task 3 to confirm
   - `collateralCandidate` deleted in Task 3 Step 4 — same check

4. **Commits are atomic:**
   - 4 commits total (i18n / builder / collateraltab / notifications)
   - Each is independently revertable
