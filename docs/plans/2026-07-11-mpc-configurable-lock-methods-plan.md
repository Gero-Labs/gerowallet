# MPC Configurable Lock Methods — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let MPC "Sign in with Google" wallets choose a session lock method (None / Passkey / Spending Password), where None = no within-session lock or prompt, so MPC rides the standard `unlockMethod` machinery instead of always forcing the creation device secret.

**Architecture:** Mostly *reverts* three MPC-specific hacks (`a84d24f0`, `0c05e993`, `e52e6f89`) so MPC uses the same `unlockMethod`-driven auto-lock / nav-button / display as Normal wallets; un-hides the `LockSettingsDialog` unlock-method section for MPC with only None + a device-secret option; extracts a pure, unit-tested `shouldAutoLock` predicate. No new crypto: the secure "wipe-on-lock + rebuild-from-cached-login-share" already exists.

**Tech Stack:** Vue 2.7 `<script setup>` + Vuetify 2.7, TypeScript, Vitest, Dexie config table, Vite (4 configs). Design spec: `docs/plans/2026-07-11-mpc-configurable-lock-methods-design.md`.

## Global Constraints

- Extension only, branch `feat/google-mpc-wallet` in worktree `gerowallet-google-mpc`. No backend changes.
- **Never commit `src/stores/featureFlagsStore.ts`** (local `isGoogleWalletEnabled` flag flip; ships dark).
- MPC lock methods are exactly: **None**, **Passkey**, **Spending Password**. **No PIN/Pattern for MPC.**
- `unlockMethod` value for MPC: `'passkey'` (passkey wallet) or `'password'` (spending-password wallet) when locked-enabled; `null` for None. It is a *flag*; MPC unlock does NOT route through `verifyUnlockCredentials`/`UNLOCK` — it uses the `isMpcWallet`+`mpcUsesPasskey` branch → `UNLOCK_MPC_WALLET` (unchanged).
- `mpcUsesPasskey` for a wallet = `!!webAuthnCredentialId && !!mpcPrfSaltId` on the wallet record.
- Fix any ESLint issues in every file touched. Add German (`de.ts`) for every new `us.ts` key.
- After a `src/chrome/` change, the background bundle must be rebuilt separately (`vite.config.background.mts`); UI changes rebuild the web bundle (`vite.config.mts`). Static build: `cp .env.development .env.production` → build → `rm .env.production`.

---

### Task 1: Pure `shouldAutoLock` predicate + drop the MPC auto-lock exemptions

**Files:**
- Create: `src/services/autoLock.ts`
- Create: `src/services/autoLock.spec.ts`
- Modify: `src/chrome/background.ts` (`checkAutoLock` ~L339-354; startup stale-lock guard ~L80-92)

**Interfaces:**
- Produces: `shouldAutoLock(params: { autoLockMinutes: number; hasUnlockMethod: boolean; inactiveMinutes: number }): boolean`
- Consumes: nothing from other tasks.

Context: today `checkAutoLock` skips locking for MPC even without a lock method (`&& wallet.encryptionMethod !== 'mpc'`), and the startup stale-lock clear refuses to clear an MPC lock. Both are being reverted so MPC follows the standard "lock only if `unlockMethod` is set" rule. The gate logic is extracted into a pure predicate so it is unit-testable (auto-lock has repeatedly regressed and currently has zero tests).

- [ ] **Step 1: Write the failing test**

Create `src/services/autoLock.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldAutoLock } from './autoLock';

describe('shouldAutoLock', () => {
  it('does not lock when auto-lock is disabled (0 minutes)', () => {
    expect(shouldAutoLock({ autoLockMinutes: 0, hasUnlockMethod: true, inactiveMinutes: 999 })).toBe(false);
  });

  it('does not lock when no unlock method is configured', () => {
    // MPC with lock method None, or a Normal wallet with None — either way, nothing to unlock with.
    expect(shouldAutoLock({ autoLockMinutes: 1, hasUnlockMethod: false, inactiveMinutes: 999 })).toBe(false);
  });

  it('does not lock before the inactivity threshold', () => {
    expect(shouldAutoLock({ autoLockMinutes: 5, hasUnlockMethod: true, inactiveMinutes: 4.9 })).toBe(false);
  });

  it('locks once inactivity reaches the threshold and a method is set', () => {
    expect(shouldAutoLock({ autoLockMinutes: 1, hasUnlockMethod: true, inactiveMinutes: 1 })).toBe(true);
    expect(shouldAutoLock({ autoLockMinutes: 5, hasUnlockMethod: true, inactiveMinutes: 10 })).toBe(true);
  });

  it('ignores wallet type entirely (no MPC special-case)', () => {
    // Same inputs → same result regardless of what wallet produced them.
    expect(shouldAutoLock({ autoLockMinutes: 1, hasUnlockMethod: true, inactiveMinutes: 2 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/autoLock.spec.ts`
Expected: FAIL — `Cannot find module './autoLock'`.

- [ ] **Step 3: Create the pure predicate**

Create `src/services/autoLock.ts`:

```ts
/**
 * Pure decision for the background auto-lock alarm. Kept side-effect-free so it
 * is unit-testable — the alarm handler (`checkAutoLock` in background.ts) reads
 * config/timestamps and calls this.
 *
 * Deliberately wallet-type agnostic: a wallet auto-locks iff a lock method is
 * configured AND the inactivity timer has elapsed. MPC wallets are NOT special —
 * "None" means no `unlockMethod`, so `hasUnlockMethod` is false and they don't lock,
 * exactly like a Normal wallet set to None.
 */
export function shouldAutoLock(params: {
  autoLockMinutes: number;
  hasUnlockMethod: boolean;
  inactiveMinutes: number;
}): boolean {
  if (params.autoLockMinutes <= 0) return false;
  if (!params.hasUnlockMethod) return false;
  return params.inactiveMinutes >= params.autoLockMinutes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/autoLock.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire `checkAutoLock` to the predicate and remove the MPC exemption**

In `src/chrome/background.ts`, add the import near the other imports at the top of the file:

```ts
import { shouldAutoLock } from '@/services/autoLock';
```

Replace the body of `checkAutoLock` from the `unlockMethod` read through the lock call. The current code is:

```ts
    const autoLockConfig = await configTable.where({ key: 'autoLockMinutes' }).first();
    const autoLockMinutes = autoLockConfig?.value || 0;

    // If auto-lock is disabled (0), don't lock
    if (autoLockMinutes === 0) {
      return;
    }

    // Get unlock method - CRITICAL: Don't lock if no unlock method is configured
    const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();
    const unlockMethod = unlockMethodConfig?.value;

    // If no unlock method is set, skip auto-lock (user won't be able to unlock!).
    // MPC "Sign in with Google" wallets are exempt: they have no local unlock-method
    // row but can ALWAYS be re-unlocked (Google + passkey/spending password), so
    // they must still honor the auto-lock timer.
    if (!unlockMethod && wallet.encryptionMethod !== 'mpc') {
      return;
    }

    // Get last activity timestamp
    const lastActivityConfig = await configTable.where({ key: 'lastActivityTimestamp' }).first();

    // If lastActivityTimestamp doesn't exist, it means the wallet was just logged in
    // and the activity tracker hasn't run yet. Skip the check.
    if (!lastActivityConfig || !lastActivityConfig.value) {
      return;
    }

    const lastActivityTimestamp = lastActivityConfig.value;

    // Calculate time since last activity
    const now = Date.now();
    const inactiveMinutes = (now - lastActivityTimestamp) / (1000 * 60);

    // Lock wallet if inactive for longer than configured time
    if (inactiveMinutes >= autoLockMinutes) {
      await walletManager.lock();
    }
```

Replace it with:

```ts
    const autoLockConfig = await configTable.where({ key: 'autoLockMinutes' }).first();
    const autoLockMinutes = autoLockConfig?.value || 0;

    // Lock method: a wallet auto-locks only when one is configured. MPC wallets
    // set unlockMethod to 'passkey'/'password' when their session lock is enabled
    // and leave it null for "None" — same rule as Normal wallets, no special case.
    const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();
    const hasUnlockMethod = !!unlockMethodConfig?.value;

    // Last activity: absent means the wallet just logged in and the tracker hasn't
    // run yet — skip this tick.
    const lastActivityConfig = await configTable.where({ key: 'lastActivityTimestamp' }).first();
    if (!lastActivityConfig || !lastActivityConfig.value) {
      return;
    }

    const inactiveMinutes = (Date.now() - lastActivityConfig.value) / (1000 * 60);

    if (shouldAutoLock({ autoLockMinutes, hasUnlockMethod, inactiveMinutes })) {
      await walletManager.lock();
    }
```

- [ ] **Step 6: Revert the startup stale-lock MPC guard**

In `src/chrome/background.ts`, the startup block currently reads:

```ts
        const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();
        // MPC wallets have no unlock-method row but are NOT trapped when locked
        // (they re-unlock with Google + passkey/password), so don't clear their lock.
        if (!unlockMethodConfig?.value && walletStore.loggedWallet?.encryptionMethod !== 'mpc') {
          WalletStore.setLocked(false);
          console.log('🔓 Cleared stale lock — no unlock method configured');
        }
      } catch (e) {
        console.warn('Failed to check unlock method for stale lock:', e);
        if (walletStore.loggedWallet?.encryptionMethod !== 'mpc') {
          WalletStore.setLocked(false);
        }
      }
```

Replace with:

```ts
        const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();
        // Clear a stray lock when no unlock method is configured (incl. MPC set to
        // None) so the user is never trapped on a lock screen they can't dismiss.
        if (!unlockMethodConfig?.value) {
          WalletStore.setLocked(false);
          console.log('🔓 Cleared stale lock — no unlock method configured');
        }
      } catch (e) {
        console.warn('Failed to check unlock method for stale lock:', e);
        WalletStore.setLocked(false);
      }
```

- [ ] **Step 7: Rebuild the background bundle**

Run: `cd . && cp .env.development .env.production && NODE_OPTIONS='--max-old-space-size=6144' npx vite build --config vite.config.background.mts --mode production; rm -f .env.production`
Expected: `✓ built` with no `error`/`Could not resolve`.

- [ ] **Step 8: Commit**

```bash
git add src/services/autoLock.ts src/services/autoLock.spec.ts src/chrome/background.ts
git commit -m "feat(mpc): auto-lock follows unlockMethod for MPC via pure shouldAutoLock predicate"
```

---

### Task 2: `LockSettingsDialog` — MPC unlock-method choice (None / device secret)

**Files:**
- Modify: `src/shared/utils/security.ts:34` (extend `UnlockMethod`)
- Modify: `src/modules/dashboard/dialogs/LockSettingsDialog.vue`
- Modify: `src/plugins/i18n/us.ts`, `src/plugins/i18n/de.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: writes `unlockMethod` config = `'passkey' | 'password' | null` for MPC wallets (read by Task 1's `checkAutoLock`, Task 3's display, and the nav-drawer button).

- [ ] **Step 1: Extend the `UnlockMethod` type**

In `src/shared/utils/security.ts`, line 34 is:

```ts
export type UnlockMethod = 'password' | 'pin' | 'pattern' | null;
```

Change to:

```ts
export type UnlockMethod = 'password' | 'pin' | 'pattern' | 'passkey' | null;
```

(`'passkey'` is only ever set for MPC passkey wallets, and MPC never routes through `verifyUnlockCredentials`, so no other consumer needs a new branch.)

- [ ] **Step 2: Add i18n keys**

In `src/plugins/i18n/us.ts`, add near the other `security.*` keys:

```ts
  'security.passkey': 'Passkey',
  'security.mpcLockNoneDesc': 'No lock — stay signed in until you log out',
  'security.mpcLockPasskeyDesc': 'Require your passkey to unlock',
  'security.mpcLockPasswordDesc': 'Require your spending password to unlock',
```

In `src/plugins/i18n/de.ts`, add the matching German:

```ts
  'security.passkey': 'Passkey',
  'security.mpcLockNoneDesc': 'Keine Sperre — bleib angemeldet, bis du dich abmeldest',
  'security.mpcLockPasskeyDesc': 'Zum Entsperren deinen Passkey verlangen',
  'security.mpcLockPasswordDesc': 'Zum Entsperren dein Ausgabepasswort verlangen',
```

- [ ] **Step 3: Un-hide the unlock-method card for MPC and render MPC-specific items**

In `src/modules/dashboard/dialogs/LockSettingsDialog.vue`, the unlock-method card currently starts (line ~13):

```html
      <!-- Unlock Method Section (hidden for MPC — unlock is fixed to Google + creation secret) -->
      <v-card v-if="!isMpcWallet" class="transparent" flat>
        <v-card-title class="justify-center pt-0">
          <v-icon color="primary" class="mr-1" small>mdi-lock-outline</v-icon>
          <span class="subtitle-1 font-weight-bold">{{ $t('security.unlockMethod') }}</span>
        </v-card-title>
        <v-card-subtitle class="text-center">
          {{ $t('security.selectHowToUnlock') }}
        </v-card-subtitle>
        <v-card-text class="pa-0">
          <v-list dense class="pa-0 transparent" nav>
```

Change the card opener so it is shown for all wallets, and inside the `<v-list>` gate the existing four Normal items with `v-if="!isMpcWallet"` and add an MPC block. Replace the card opener line:

```html
      <!-- Unlock Method Section -->
      <v-card class="transparent" flat>
        <v-card-title class="justify-center pt-0">
          <v-icon color="primary" class="mr-1" small>mdi-lock-outline</v-icon>
          <span class="subtitle-1 font-weight-bold">{{ $t('security.unlockMethod') }}</span>
        </v-card-title>
        <v-card-subtitle class="text-center">
          {{ $t('security.selectHowToUnlock') }}
        </v-card-subtitle>
        <v-card-text class="pa-0">
          <v-list v-if="isMpcWallet" dense class="pa-0 transparent" nav>
            <!-- None -->
            <v-list-item two-line @click="handleUnlockMethodSelect(null)" class="mb-0">
              <v-list-item-avatar class="my-0"><v-icon>mdi-lock-off-outline</v-icon></v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.none') }}</v-list-item-title>
                <v-list-item-subtitle>{{ $t('security.mpcLockNoneDesc') }}</v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-icon v-if="selectedUnlockMethod === null" style="align-self: center;">
                <v-icon color="primary">mdi-check-circle</v-icon>
              </v-list-item-icon>
            </v-list-item>

            <v-divider class="mx-1" />

            <!-- Device secret: passkey OR spending password, per how the wallet was created -->
            <v-list-item two-line @click="handleMpcLockSelect()" class="mb-0">
              <v-list-item-avatar class="my-0">
                <v-icon>{{ isMpcPasskeyWallet ? 'mdi-fingerprint' : 'mdi-form-textbox-password' }}</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ isMpcPasskeyWallet ? $t('security.passkey') : $t('security.spendingPassword') }}</v-list-item-title>
                <v-list-item-subtitle>{{ isMpcPasskeyWallet ? $t('security.mpcLockPasskeyDesc') : $t('security.mpcLockPasswordDesc') }}</v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-icon v-if="selectedUnlockMethod !== null" style="align-self: center;">
                <v-icon color="primary">mdi-check-circle</v-icon>
              </v-list-item-icon>
            </v-list-item>
          </v-list>

          <v-list v-else dense class="pa-0 transparent" nav>
```

(The `v-else` keeps the existing None/Password/PIN/Pattern `<v-list-item>`s for non-MPC wallets exactly as they are — do not modify them. The original `<v-list dense class="pa-0 transparent" nav>` line is replaced by the `v-else` version above; its four child items and closing `</v-list>` stay.)

- [ ] **Step 4: Add the MPC save handler**

In `src/modules/dashboard/dialogs/LockSettingsDialog.vue` `<script setup>`, add next to `handleUnlockMethodSelect`:

```ts
// MPC wallets: the "device secret" lock method (passkey or spending password) is
// whatever the wallet was created with — no setup dialog, just enable the lock by
// persisting the corresponding unlockMethod flag. Unlock itself uses the MPC
// device-secret branch in UnlockWalletDialog, not verifyUnlockCredentials.
async function handleMpcLockSelect() {
  errorMessage.value = '';
  await saveUnlockMethod(isMpcPasskeyWallet.value ? 'passkey' : 'password');
}
```

- [ ] **Step 5: Revert the title and the auto-lock disable to standard**

Title — line ~4 currently:

```html
    :title="(isPrfWallet || isMpcWallet) ? t('security.lockSettingsOnly') : t('security.lockSettings')"
```

Change to (MPC now shows the full settings, not "only"):

```html
    :title="isPrfWallet ? t('security.lockSettingsOnly') : t('security.lockSettings')"
```

Auto-lock card — line ~99 currently:

```html
      <!-- Auto-Lock Timer Section (always enabled for MPC — it locks then requires Google re-unlock) -->
      <v-card class="transparent" flat :disabled="selectedUnlockMethod === null && !isMpcWallet">
```

Change to (auto-lock is meaningless with no lock method, for MPC too):

```html
      <!-- Auto-Lock Timer Section -->
      <v-card class="transparent" flat :disabled="selectedUnlockMethod === null">
```

Also restore the divider between the unlock-method card and the auto-lock card. Line ~96 currently:

```html
      <v-divider class="my-5 mx-1" v-if="!isMpcWallet" />
```

Change to:

```html
      <v-divider class="my-5 mx-1" />
```

Leave the PassKey section (`showPassKeySection`, the `isMpcPasskeyWallet` protection branches, and the `v-if="!isMpcWallet"` on the two "Use PassKey for Unlock" toggles) exactly as-is — that protection stays.

- [ ] **Step 6: Rebuild the web bundle**

Run: `cp .env.development .env.production && NODE_OPTIONS='--max-old-space-size=6144' npx vite build --config vite.config.mts --mode production; rm -f .env.production`
Expected: `✓ built`, no `[vue/compiler-sfc]` or `error` lines.

- [ ] **Step 7: Commit**

```bash
git add src/shared/utils/security.ts src/modules/dashboard/dialogs/LockSettingsDialog.vue src/plugins/i18n/us.ts src/plugins/i18n/de.ts
git commit -m "feat(mpc): configurable lock method (None/Passkey/Spending Password) in LockSettingsDialog"
```

---

### Task 3: `NavigationDrawer` + `SecurityTab` — MPC lock display follows `unlockMethod`

**Files:**
- Modify: `src/modules/navigation/components/NavigationDrawer.vue` (lock button ~L184; `isMpcWallet` ~L275)
- Modify: `src/modules/dashboard/components/SecurityTab.vue` (title ~L121; subtitle ~L124-131; `unlockMethodText` ~L508)

**Interfaces:**
- Consumes: `unlockMethod` config written by Task 2 (`'passkey' | 'password' | null`).
- Produces: nothing downstream.

- [ ] **Step 1: NavigationDrawer — manual-lock button follows `hasUnlockMethod`**

In `src/modules/navigation/components/NavigationDrawer.vue`, line ~184 currently:

```html
          <v-tooltip v-if="hasUnlockMethod || isMpcWallet" top content-class="custom-tooltip">
```

Change to:

```html
          <v-tooltip v-if="hasUnlockMethod" top content-class="custom-tooltip">
```

Then remove the now-unused `isMpcWallet` computed (lines ~271-275):

```ts
// MPC "Sign in with Google" wallets have no local unlock-method config row, so
// hasUnlockMethod is false for them — but they CAN always be re-unlocked via
// Google, and LOCK clears their session cache. So the manual lock button must
// be available for MPC regardless of hasUnlockMethod.
const isMpcWallet = computed(() => loggedWallet.value?.encryptionMethod === 'mpc');
```

Delete that block. (If `isMpcWallet` is referenced anywhere else in this file, keep it — verify with a grep for `isMpcWallet` in this file before deleting; at plan time the button `v-if` is the only use.)

- [ ] **Step 2: SecurityTab — show the real method + auto-lock (no PassKey chunk), map `'passkey'`**

In `src/modules/dashboard/components/SecurityTab.vue`, the row title (line ~121) currently:

```html
              {{ (isPrfWallet || isMpcWallet) ? $t('security.lockSettingsOnly') : $t('security.lockSettings') }}
```

Change to:

```html
              {{ isPrfWallet ? $t('security.lockSettingsOnly') : $t('security.lockSettings') }}
```

The subtitle block (lines ~124-131) currently:

```html
          <v-list-item-subtitle class="text-left">
            <template v-if="isMpcWallet">
              {{ $t('security.autoLock') }}: {{ autoLockText }}
            </template>
            <template v-else-if="isPrfWallet">
              {{ $t('security.unlockMethod') }}: {{ unlockMethodText }} • {{ $t('security.autoLock') }}: {{ autoLockText }}
            </template>
            <template v-else>
              {{ $t('security.unlockMethod') }}: {{ unlockMethodText }} • {{ $t('security.autoLock') }}: {{ autoLockText }} • PassKey: {{ passKeyText }}
            </template>
          </v-list-item-subtitle>
```

Change the MPC branch to show the unlock method + auto-lock (drop the Normal-only PassKey chunk):

```html
          <v-list-item-subtitle class="text-left">
            <template v-if="isMpcWallet || isPrfWallet">
              {{ $t('security.unlockMethod') }}: {{ unlockMethodText }} • {{ $t('security.autoLock') }}: {{ autoLockText }}
            </template>
            <template v-else>
              {{ $t('security.unlockMethod') }}: {{ unlockMethodText }} • {{ $t('security.autoLock') }}: {{ autoLockText }} • PassKey: {{ passKeyText }}
            </template>
          </v-list-item-subtitle>
```

Then map the `'passkey'` value in `unlockMethodText` (line ~508). Current:

```ts
  switch (unlockMethod.value) {
    case 'password':
      return t('security.spendingPassword');
    case 'pin':
      return t('security.pin');
    case 'pattern':
      return t('security.pattern');
    default:
      return t('security.none');
  }
```

Change to:

```ts
  switch (unlockMethod.value) {
    case 'passkey':
      return t('security.passkey');
    case 'password':
      return t('security.spendingPassword');
    case 'pin':
      return t('security.pin');
    case 'pattern':
      return t('security.pattern');
    default:
      return t('security.none');
  }
```

Keep the `isMpcWallet` computed in SecurityTab (still used by the subtitle branch).

- [ ] **Step 3: Rebuild the web bundle**

Run: `cp .env.development .env.production && NODE_OPTIONS='--max-old-space-size=6144' npx vite build --config vite.config.mts --mode production; rm -f .env.production`
Expected: `✓ built`, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/navigation/components/NavigationDrawer.vue src/modules/dashboard/components/SecurityTab.vue
git commit -m "fix(mpc): nav lock button and security-tab summary follow unlockMethod"
```

---

## Manual verification (human-gated, real device — after all tasks)

Reload the extension (background changed in Task 1) + wake the service worker, hard-refresh the options tab. For the MPC passkey wallet:

1. **None:** LockSettings → Unlock Method = None. Confirm: no manual-lock button in the nav drawer; set Auto-Lock 1 min and leave idle — it does **not** lock; SecurityTab shows "Unlock Method: None • Auto-Lock: …".
2. **Passkey:** LockSettings → Unlock Method = Passkey. Confirm: manual-lock button appears; lock → unlock prompts **only the passkey** (no Google, within a session); Auto-Lock 1 min locks after ~1–2 min idle.
3. **Switch back to None** while unlocked → confirm it stops auto-locking.
4. **Service-worker death:** with Passkey set, let the SW idle out, then unlock → passkey (Google only if the login-share session also expired).

---

## Self-review (completed by plan author)

- **Spec coverage:** None/Passkey/Password choice → Task 2. None=no lock (auto-lock skip, nav button hidden, stale-lock clear) → Task 1 + Task 3. Passkey/Password wipe-on-lock + device-secret unlock → unchanged (verified in spec). SecurityTab no-misleading-PassKey → Task 3. Revert `a84d24f0`/`0c05e993`/`e52e6f89` → Tasks 1–3. No PIN/Pattern for MPC → Task 2 renders only None + device secret.
- **Placeholder scan:** none — every step shows exact before/after code.
- **Type consistency:** `UnlockMethod` gains `'passkey'` (Task 2 Step 1) before it is written (Task 2) and read (`unlockMethodText`, Task 3). `handleMpcLockSelect` / `isMpcPasskeyWallet` / `saveUnlockMethod` names match the existing dialog. `shouldAutoLock` signature identical across `autoLock.ts`, its spec, and `background.ts`.
