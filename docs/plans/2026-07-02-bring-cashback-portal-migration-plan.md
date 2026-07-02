# Bring Cashback Portal Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wallet's custom cashback screens with the Bring-hosted Cashback Portal embedded as an `<iframe>`, wired through the README's postMessage contract and bootstrapped via a gero-backend proxy.

**Architecture:** A single `CashbackPortal.vue` hosts the iframe and owns the bridge; pure bridge helpers live in `portalBridge.ts` (unit-tested). Both the sidepanel and options cashback screens render `CashbackPortal`. Wallet address/token come from a backend proxy (`POST /api/bring/portal`); message signing reuses the existing background `signData` path. Custom retailer/reward/claim UI + `bringStore` are removed.

**Tech Stack:** Vue 2.7, Vuetify 2.7, TypeScript, Vite, Vitest, axios, `@cardano-sdk/core`.

## Global Constraints

- Vue 2.7 `<script setup>` + Vuetify 2.7; TypeScript throughout.
- All user-facing text via `$t()`; every new `us.ts` key gets a matching `de.ts` key.
- Resolve all ESLint errors/warnings in every touched file.
- `postMessage` MUST use the explicit portal origin (`new URL(portalUrl).origin`), never `'*'`.
- Inbound messages MUST be validated: `event.origin === portalOrigin && event.data?.from === 'bringweb3'`.
- `iframe.src` is set only from the backend-returned `portalUrl` (no user-controlled URL).
- The Bring `x-api-key` stays server-side (gero-backend); never in the extension bundle.
- Keep `@bringweb3/chrome-extension-kit` (content-script popup) untouched.
- Cashback address = `loggedWallet.baseAddress`; ticker = `networks.resolveCurrencyTicker(chain, network)`.
- Vitest command: `npm test` (aliased to `vitest test`). Run a single file with `npx vitest run <path>`.

---

### Task 1: `cashback-api.portal()` — backend bootstrap proxy call

**Files:**
- Modify: `src/api/cashback-api.ts` (add method + response type near top-level export)

**Interfaces:**
- Produces: `portal(walletAddress: string | null, theme: 'dark' | 'light'): Promise<{ portalUrl: string; token: string }>`

- [ ] **Step 1: Add the response type + method.** After the existing `import` lines in `src/api/cashback-api.ts`, add:

```ts
export interface CashbackPortalBootstrap {
  portalUrl: string;
  token: string;
}
```

Inside the default export object (same style as `checkAvailability`), add:

```ts
  async portal(walletAddress: string | null, theme: 'dark' | 'light' = 'dark'): Promise<CashbackPortalBootstrap> {
    try {
      const { data, status } = await axiosInstance.post('/api/bring/portal', { walletAddress, theme });
      if (status === 200 && data?.portalUrl) return { portalUrl: data.portalUrl, token: data.token };
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
```

- [ ] **Step 2: Typecheck.**

Run: `npm run typecheck 2>&1 | grep -E "cashback-api\.ts\([0-9]" || echo OK`
Expected: `OK`

- [ ] **Step 3: Commit.**

```bash
git add src/api/cashback-api.ts
git commit -m "feat(cashback): add portal() bootstrap proxy call"
```

---

### Task 2: `portalBridge.ts` — pure, unit-tested bridge helpers

**Files:**
- Create: `src/modules/cashback/portalBridge.ts`
- Test: `src/modules/cashback/portalBridge.spec.ts`

**Interfaces:**
- Produces:
  - `PortalInboundAction = 'LOGIN' | 'SIGN_MESSAGE' | 'POPUP_CLOSED'`
  - `isTrustedPortalMessage(event: MessageEvent, portalOrigin: string): boolean`
  - `sessionUpdateMessage(token: string): { to: 'bringweb3'; action: 'SESSION_UPDATE'; token: string }`
  - `signatureMessage(signature: string, key: string, message: string): { to: 'bringweb3'; action: 'SIGNATURE'; signature: string; key: string; message: string }`
  - `abortSignMessage(): { to: 'bringweb3'; action: 'ABORT_SIGN_MESSAGE' }`

- [ ] **Step 1: Write the failing test.** Create `src/modules/cashback/portalBridge.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  isTrustedPortalMessage,
  sessionUpdateMessage,
  signatureMessage,
  abortSignMessage,
} from './portalBridge';

const ORIGIN = 'https://portal.bringweb3.io';
const evt = (origin: string, data: unknown) => ({ origin, data } as MessageEvent);

describe('isTrustedPortalMessage', () => {
  it('accepts a bringweb3 message from the portal origin with an action', () => {
    expect(isTrustedPortalMessage(evt(ORIGIN, { from: 'bringweb3', action: 'LOGIN' }), ORIGIN)).toBe(true);
  });
  it('rejects a wrong origin', () => {
    expect(isTrustedPortalMessage(evt('https://evil.example', { from: 'bringweb3', action: 'LOGIN' }), ORIGIN)).toBe(false);
  });
  it('rejects a non-bringweb3 sender', () => {
    expect(isTrustedPortalMessage(evt(ORIGIN, { from: 'someoneelse', action: 'LOGIN' }), ORIGIN)).toBe(false);
  });
  it('rejects a message with no action', () => {
    expect(isTrustedPortalMessage(evt(ORIGIN, { from: 'bringweb3' }), ORIGIN)).toBe(false);
  });
  it('rejects null/undefined data', () => {
    expect(isTrustedPortalMessage(evt(ORIGIN, null), ORIGIN)).toBe(false);
  });
});

describe('outbound builders', () => {
  it('builds SESSION_UPDATE', () => {
    expect(sessionUpdateMessage('tok')).toEqual({ to: 'bringweb3', action: 'SESSION_UPDATE', token: 'tok' });
  });
  it('builds SIGNATURE', () => {
    expect(signatureMessage('sig', 'k', 'msg')).toEqual({ to: 'bringweb3', action: 'SIGNATURE', signature: 'sig', key: 'k', message: 'msg' });
  });
  it('builds ABORT_SIGN_MESSAGE', () => {
    expect(abortSignMessage()).toEqual({ to: 'bringweb3', action: 'ABORT_SIGN_MESSAGE' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run src/modules/cashback/portalBridge.spec.ts`
Expected: FAIL — cannot resolve `./portalBridge`.

- [ ] **Step 3: Implement.** Create `src/modules/cashback/portalBridge.ts`:

```ts
// Pure helpers for the Bring Cashback Portal postMessage bridge.
// See docs/plans/2026-07-02-bring-cashback-portal-migration-design.md

export type PortalInboundAction = 'LOGIN' | 'SIGN_MESSAGE' | 'POPUP_CLOSED';

/**
 * A portal message is trusted only when it comes from the exact portal origin
 * and is tagged `from: 'bringweb3'` with an action. Never widen this.
 */
export function isTrustedPortalMessage(event: MessageEvent, portalOrigin: string): boolean {
  if (!portalOrigin || event.origin !== portalOrigin) return false;
  const data = event.data as { from?: unknown; action?: unknown } | null | undefined;
  return !!data && data.from === 'bringweb3' && typeof data.action === 'string' && data.action.length > 0;
}

export function sessionUpdateMessage(token: string) {
  return { to: 'bringweb3' as const, action: 'SESSION_UPDATE' as const, token };
}

export function signatureMessage(signature: string, key: string, message: string) {
  return { to: 'bringweb3' as const, action: 'SIGNATURE' as const, signature, key, message };
}

export function abortSignMessage() {
  return { to: 'bringweb3' as const, action: 'ABORT_SIGN_MESSAGE' as const };
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest run src/modules/cashback/portalBridge.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint + commit.**

```bash
npx eslint src/modules/cashback/portalBridge.ts src/modules/cashback/portalBridge.spec.ts
git add src/modules/cashback/portalBridge.ts src/modules/cashback/portalBridge.spec.ts
git commit -m "feat(cashback): pure portal postMessage bridge helpers + tests"
```

---

### Task 3: `CashbackPortal.vue` — iframe host + bridge

**Files:**
- Create: `src/modules/cashback/CashbackPortal.vue`
- Modify: `src/plugins/i18n/us.ts`, `src/plugins/i18n/de.ts` (error/retry copy)

**Interfaces:**
- Consumes: `cashbackApi.portal()` (Task 1); `portalBridge` helpers (Task 2).
- Produces: `<CashbackPortal />` — no props; self-contained.

- [ ] **Step 1: Add i18n keys.** In `src/plugins/i18n/us.ts` (near other `cashback.*` keys) add:

```ts
  'cashback.portalLoadError': 'Couldn\'t load cashback right now.',
  'cashback.retry': 'Retry',
```

In `src/plugins/i18n/de.ts` add:

```ts
  'cashback.portalLoadError': 'Cashback konnte gerade nicht geladen werden.',
  'cashback.retry': 'Erneut versuchen',
```

- [ ] **Step 2: Create the component.** Create `src/modules/cashback/CashbackPortal.vue`:

```vue
<template>
  <div class="cashback-portal">
    <div v-if="errorState" class="portal-state">
      <v-icon size="40" color="#F97066" class="mb-2">mdi-alert-circle-outline</v-icon>
      <p class="grey--text mb-3">{{ $t('cashback.portalLoadError') }}</p>
      <v-btn class="geroButton" rounded depressed :loading="loading" @click="bootstrap()">{{ $t('cashback.retry') }}</v-btn>
    </div>
    <div v-else-if="loading && !portalUrl" class="portal-state">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <iframe
      v-show="portalUrl && !errorState"
      ref="frame"
      :src="portalUrl"
      class="portal-frame"
      title="Bring Cashback"
    />
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import cashbackApi from '@/api/cashback-api';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { stringToHex } from '@/shared/utils/converter';
import {
  isTrustedPortalMessage,
  sessionUpdateMessage,
  signatureMessage,
  abortSignMessage,
} from './portalBridge';

const frame = ref<HTMLIFrameElement | null>(null);
const portalUrl = ref('');
const token = ref('');
const loading = ref(false);
const errorState = ref(false);

const theme = 'dark';

function baseAddress(): string | null {
  return walletStore.loggedWallet?.baseAddress ?? null;
}

function portalOrigin(): string {
  try { return new URL(portalUrl.value).origin; } catch { return ''; }
}

function post(message: object) {
  const origin = portalOrigin();
  if (origin) frame.value?.contentWindow?.postMessage(message, origin);
}

// Fetch a fresh portalUrl+token. First call sets iframe.src; later calls (wallet/theme
// change, or LOGIN) push SESSION_UPDATE so the loaded portal re-syncs without a reload.
async function bootstrap(reason: 'initial' | 'resync' = 'initial') {
  loading.value = true;
  errorState.value = false;
  try {
    const res = await cashbackApi.portal(baseAddress(), theme);
    token.value = res.token;
    if (reason === 'initial' || !portalUrl.value) {
      portalUrl.value = res.portalUrl;
    } else {
      post(sessionUpdateMessage(res.token));
    }
  } catch {
    errorState.value = true;
  } finally {
    loading.value = false;
  }
}

async function signForPortal(messageToSign: string) {
  const addr = baseAddress();
  if (!addr) { post(abortSignMessage()); return; }
  try {
    const res = await Messaging.sendToBackground({
      method: MessageTypes.signData,
      data: { address: Cardano.Address.fromBech32(addr).toBytes(), payload: stringToHex(messageToSign) },
    }) as { data?: { signature?: string; key?: string } };
    const signature = res.data?.signature;
    const key = res.data?.key;
    if (signature && key) post(signatureMessage(signature, key, messageToSign));
    else post(abortSignMessage());
  } catch {
    post(abortSignMessage());
  }
}

async function onMessage(event: MessageEvent) {
  if (!isTrustedPortalMessage(event, portalOrigin())) return;
  const action = (event.data as { action: string }).action;
  if (action === 'LOGIN') {
    await bootstrap('resync');
  } else if (action === 'SIGN_MESSAGE') {
    await signForPortal((event.data as { messageToSign: string }).messageToSign);
  }
  // POPUP_CLOSED: informational, ignore.
}

watch(() => walletStore.loggedWallet?.baseAddress, (addr, prev) => {
  if (addr !== prev && portalUrl.value) bootstrap('resync');
});

onMounted(() => {
  window.addEventListener('message', onMessage);
  bootstrap('initial');
});
onBeforeUnmount(() => window.removeEventListener('message', onMessage));
</script>
<style scoped>
.cashback-portal { width: 100%; height: 100%; position: relative; }
.portal-frame { width: 100%; height: 100%; border: 0; display: block; }
.portal-state {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; padding: 24px;
}
</style>
```

- [ ] **Step 3: Verify imports resolve.** Confirm the two util imports exist (they are used by the code being replaced). If `stringToHex` is not at `@/shared/utils/converter`, find it:

Run: `cd "$(git rev-parse --show-toplevel)" && grep -rn "export .*stringToHex" src | head -1`
Then set the import path in `CashbackPortal.vue` to the reported file (drop `src/` → `@/`, drop extension).

- [ ] **Step 4: Typecheck + lint.**

Run: `npm run typecheck 2>&1 | grep -E "CashbackPortal\.vue\([0-9]" || echo OK`
Expected: `OK`
Run: `npx eslint src/modules/cashback/CashbackPortal.vue`
Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/cashback/CashbackPortal.vue src/plugins/i18n/us.ts src/plugins/i18n/de.ts
git commit -m "feat(cashback): CashbackPortal iframe host + postMessage bridge"
```

---

### Task 4: CSP — allow the portal origin in `frame-src`

**Files:**
- Modify: `scripts/manifest.ts` (the `frameSrc` array in `buildCSP`)

- [ ] **Step 1: Add the portal origin.** In `scripts/manifest.ts`, change the `frameSrc` array to include the Bring portal origin:

```ts
  const frameSrc = [
    ...(dev ? ['http://localhost:*'] : ['https://api.gerowallet.io/', 'https://guardarian.com/']),
    'https://*.moonpay.com/',
    'https://connect.trezor.io/',
    'https://www.kaiserex.com/',
    'https://kaiserex.com/',
    'https://forms.zohopublic.eu/',
    'https://*.bringweb3.io/',
  ];
```

> NOTE: `https://*.bringweb3.io/` covers `portal.bringweb3.io`. Confirm the real portal host against a live `/api/bring/portal` response; narrow to the exact host if preferred.

- [ ] **Step 2: Regenerate the committed manifest.**

Run: `NODE_ENV=development npx tsx scripts/prepare.ts && grep -o "frame-src[^;]*" extension/manifest.json`
Expected: output contains `https://*.bringweb3.io/`.

- [ ] **Step 3: Commit.**

```bash
git add scripts/manifest.ts extension/manifest.json
git commit -m "feat(cashback): allow Bring portal origin in CSP frame-src"
```

---

### Task 5: Wire the two cashback screens to the portal

**Files:**
- Modify: `src/sidepanel/pages/CashbackPage.vue` (replace body with `<CashbackPortal>`, keep header/back chrome)
- Modify: `src/modules/cashback/Cashback.vue` (replace body with `<CashbackPortal>`)

**Interfaces:**
- Consumes: `CashbackPortal` (Task 3).

- [ ] **Step 1: Sidepanel screen.** In `src/sidepanel/pages/CashbackPage.vue`, keep the existing header/back-button markup; replace the deals/search/list body with a full-height portal host, and remove the now-unused deal/search/`bringCache` logic and dialog usage. Template body becomes:

```vue
    <div class="cashback-body">
      <CashbackPortal />
    </div>
```

Add to `<script setup>`: `import CashbackPortal from '@/modules/cashback/CashbackPortal.vue';` and delete imports/refs for `cashbackApi` retailer/category/deal state, `bringStore`, and the bottom-sheet deal detail. Ensure `.cashback-body` fills remaining height:

```css
.cashback-body { flex: 1; min-height: 0; display: flex; }
```

- [ ] **Step 2: Options screen.** In `src/modules/cashback/Cashback.vue`, replace the whole retailer-grid/summary/dialog template with:

```vue
<template>
  <div class="cashback-root">
    <CashbackPortal />
  </div>
</template>
<script setup lang="ts">
import CashbackPortal from '@/modules/cashback/CashbackPortal.vue';
</script>
<style scoped>
.cashback-root { width: 100%; height: 100%; min-height: 480px; display: flex; }
</style>
```

- [ ] **Step 3: Typecheck + lint.**

Run: `npm run typecheck 2>&1 | grep -E "CashbackPage\.vue\([0-9]|cashback/Cashback\.vue\([0-9]" || echo OK`
Expected: `OK`
Run: `npx eslint src/sidepanel/pages/CashbackPage.vue src/modules/cashback/Cashback.vue`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add src/sidepanel/pages/CashbackPage.vue src/modules/cashback/Cashback.vue
git commit -m "feat(cashback): render portal iframe in sidepanel + options screens"
```

---

### Task 6: Dashboard `CashbackCard` → CTA teaser

**Files:**
- Modify: `src/modules/dashboard/components/CashbackCard.vue`

- [ ] **Step 1: Strip live-data deps, keep promo + CTA.** Remove `bringCache`/reward-number bindings and the mock deals array; keep the visual shell and the navigate button. The button must route to the cashback screen exactly as it does today — locate the existing navigation and reuse it:

Run: `grep -n "router\|\$router\|push(\|cashback" src/modules/dashboard/components/CashbackCard.vue | head`

Keep that navigation handler; delete the reward summary sections (`bringCache.data.eligible` / `.totalPendings`) and the sushi-train carousel data source. Replace reward numbers with the existing promo copy (reuse a current `cashback.*` i18n key already used in the card; do not invent one unless none fits).

- [ ] **Step 2: Typecheck + lint.**

Run: `npm run typecheck 2>&1 | grep -E "CashbackCard\.vue\([0-9]" || echo OK`
Expected: `OK`
Run: `npx eslint src/modules/dashboard/components/CashbackCard.vue`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add src/modules/dashboard/components/CashbackCard.vue
git commit -m "feat(cashback): CashbackCard becomes a CTA teaser (portal owns data)"
```

---

### Task 7: Delete dead code (dialogs, store, unused API), fix dangling refs

**Files:**
- Delete: `src/modules/cashback/dialogs/RetailerDialog.vue`, `src/modules/cashback/dialogs/ViewRewardsDialog.vue`, `src/modules/cashback/dialogs/HowItWorksDialog.vue`
- Delete: `src/stores/bringStore.ts`
- Modify: `src/api/cashback-api.ts` (remove now-unused methods)

- [ ] **Step 1: Confirm the dialogs + store have no remaining importers** (Tasks 5–6 removed them):

Run: `grep -rn "RetailerDialog\|ViewRewardsDialog\|HowItWorksDialog\|bringStore\|loadBringCache\|bringCache" src --include="*.vue" --include="*.ts" | grep -v "dialogs/RetailerDialog.vue\|dialogs/ViewRewardsDialog.vue\|dialogs/HowItWorksDialog.vue\|stores/bringStore.ts"`
Expected: no output. If any remain, remove those imports/usages first.

- [ ] **Step 2: Delete the files.**

```bash
git rm src/modules/cashback/dialogs/RetailerDialog.vue \
       src/modules/cashback/dialogs/ViewRewardsDialog.vue \
       src/modules/cashback/dialogs/HowItWorksDialog.vue \
       src/stores/bringStore.ts
```

- [ ] **Step 3: Remove unused `cashback-api` methods.** In `src/api/cashback-api.ts`, delete `checkAvailability`, `categories`, `categoriesSearch`, `searchTerms`, `retailers`, `cache`, `activate`, `claimInit`, `claimSubmit`, `analytics`. Keep only `portal()`. Then confirm nothing else referenced the removed methods:

Run: `grep -rn "cashbackApi\.\(checkAvailability\|categories\|categoriesSearch\|searchTerms\|retailers\|cache\|activate\|claimInit\|claimSubmit\|analytics\)\b" src`
Expected: no output.

- [ ] **Step 4: Typecheck + lint the whole surface.**

Run: `npm run typecheck 2>&1 | grep -E "error TS" | grep -vE "Cannot find module.*\.vue" | grep -iE "cashback|bring" || echo OK`
Expected: `OK`
Run: `npx eslint src/api/cashback-api.ts src/modules/cashback`
Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "refactor(cashback): remove custom screens, bringStore, unused API"
```

---

### Task 8: Full verification

- [ ] **Step 1: Run the test suite.**

Run: `npx vitest run src/modules/cashback/portalBridge.spec.ts`
Expected: PASS.

- [ ] **Step 2: Full typecheck — confirm no NEW errors vs. the known dev-side baseline.**

Run: `npm run typecheck 2>&1 | grep -E "error TS" | grep -vE "Cannot find module.*\.vue" | grep -iE "cashback|bring|portalBridge" || echo "no cashback/bring type errors"`
Expected: `no cashback/bring type errors`

- [ ] **Step 3: Lint touched files.**

Run: `npx eslint src/modules/cashback src/api/cashback-api.ts src/sidepanel/pages/CashbackPage.vue src/modules/dashboard/components/CashbackCard.vue scripts/manifest.ts`
Expected: no errors.

- [ ] **Step 4: Manual smoke (requires the backend `/api/bring/portal` endpoint or a stub).** Rebuild (`npm run dev` + `npm run dev:background`), reload the extension, open the cashback screen: iframe loads; switching wallets pushes `SESSION_UPDATE`; a claim triggers a sign round-trip. If the backend endpoint is absent, confirm the error panel + Retry render instead of a crash.

---

## Notes / follow-ups (not code tasks)

- **gero-backend (separate repo):** implement `POST /api/bring/portal` that injects `x-api-key` and proxies Bring's `/v1/extension/check/portal`, returning `{ portalUrl, token }`. Frontend is blocked end-to-end until this ships.
- **Confirm** the real portal host (CSP `frame-src` + postMessage origin) and that the token is embedded in `portalUrl`, against a live response.
- Orphaned `cashback.*` i18n keys (retailer/rewards/claim copy) may be left in place; deleting them is optional and out of scope (harmless, and risky to prune blindly).
