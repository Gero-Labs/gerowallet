# gerowallet Native Embed + DexHunter Rip-out Implementation Plan (#3b/#3c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Embed the `<gero-swap>` web component (native mode) in gerowallet — vendored bundle, a native 5-wallet-type signer, a token-metadata resolver — replacing the three DexHunter swap UIs, then rename `dexHunterStore`→`tokenMetadataStore` and delete DexHunter swap-tx code + branding.

**Architecture:** A vendored self-registering IIFE (`gero-swap.js`) loaded from `'self'`; a Vue2 wrapper `GeroSwapEmbed.vue` sets the element's `signer`/`resolveToken`/`tokens` JS properties and surfaces host dialogs (Keystone QR / PassKey popup); `signSwapWitness(cbor)` dispatches password/PRF/Ledger/Trezor/Keystone → witness-set hex; `resolveToken` maps `useMarketData`/`resolveAsset` → `TokenMeta`. The metadata store is renamed but keeps its hydration for ~9 non-swap consumers.

**Tech Stack:** Vue 2.7 + Vuetify 2.7, Vite 4, Vitest 3, `@cardano-sdk/core`, MV3.

## Global Constraints

- Distribution: **vendored** `gero-swap.js` (IIFE, self-contained, self-registers) + `gero-swap.css` under `src/vendor/gero-swap/`, copied to `extension/vendor/gero-swap/`, loaded via `<script>`/`<link>` from `'self'`. NO CDN (`script-src 'self'`). The ESM build is unusable (externalizes `vue`) — use the IIFE.
- Register `gero-swap` in `Vue.config.ignoredElements` (both `sidepanel/main.ts` + `options/main.ts`) so Vue2 doesn't treat it as a component.
- **HW/PRF is a correctness gate:** `SIGN_TX` covers only password+PRF; Ledger/Trezor/Keystone sign client-side. `signSwapWitness` MUST dispatch all 5 types. Never ship a password-only swap.
- **Opaque cbor:** the unsigned tx cbor from the widget flows to signing and to submit untouched; only a witness-set hex is produced. HW paths that need a `Cardano.Tx` object derive it from that SAME cbor (deserialize for signing only; submit the ORIGINAL cbor). Never re-encode the body that gets submitted.
- Amounts string/BigInt; decimals from resolved `TokenMeta` (widget already enforces UNKNOWN_TOKEN_DECIMALS).
- Native mode sends NO partner key; `base-url` = `import.meta.env.VITE_NEXUS_URL` (gero-backend proxy).
- Keep `isSwapEnabled` gate at every swap site. Keep `tokenMetadataStore` hydration (`loadTokens`/`loadBlacklistPolicies`) — ~9 non-swap consumers depend on verified/blacklist/decimals/price.
- Rename is mechanical: STORE_NAME + imports across consumers, not a rewrite.
- Tests: `npx vitest run <path>` (Vitest 3). Commit `git -c commit.gpgsign=false commit --no-verify -m "..."` (docs/superpowers is gitignored → `git add -f` for docs only; source files add normally).
- **Do NOT merge to `development`** (prod-adjacent). Stay on `feat/embed-swap-widget`.
- **E2E gate:** a real end-to-end swap requires #2a's `/api/nexus/api/aggregator/*` routes deployed. Until then, tasks are unit-tested structurally; the live swap is verified post-deploy.

---

## File Structure

- `src/vendor/gero-swap/{gero-swap.js,gero-swap.css,README.md}` — vendored widget (Task 1).
- `src/sidepanel/index.html`, `src/options/index.html` — add `<link>`+`<script>` (Task 1).
- `src/sidepanel/main.ts`, `src/options/main.ts` — `ignoredElements` (Task 1).
- `vite.config.mts` — copy vendor dir (Task 1).
- `src/stores/tokenMetadataStore.ts` (renamed from `dexHunterStore.ts`) + consumer imports (Task 2).
- `src/modules/swap/composables/useSwapTokenResolver.ts` + test (Task 3).
- `src/modules/swap/composables/useNativeSwapSigner.ts` + test (Task 4).
- `src/modules/swap/components/GeroSwapEmbed.vue` + test (Task 5).
- 3 mount sites (Task 6). DexHunter swap-tx removal + rebrand + i18n (Task 7).

---

### Task 1: Vendor the widget + load it CSP-safely

**Files:**
- Create: `src/vendor/gero-swap/gero-swap.js`, `src/vendor/gero-swap/gero-swap.css`, `src/vendor/gero-swap/README.md`
- Modify: `src/sidepanel/index.html`, `src/options/index.html`, `src/sidepanel/main.ts`, `src/options/main.ts`, `vite.config.mts`

**Interfaces:**
- Produces: a globally-registered `<gero-swap>` custom element available in the sidepanel + options pages.

- [ ] **Step 1: Copy the built artifacts**

The widget was built at `/Users/dudiedri/IdeaProjects/A.D. Labs/gero-dex-widget/packages/widget/dist/`. Copy the IIFE + CSS:
```bash
mkdir -p "src/vendor/gero-swap"
cp "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-dex-widget/packages/widget/dist/gero-swap.js" src/vendor/gero-swap/gero-swap.js
cp "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-dex-widget/packages/widget/dist/style.css" src/vendor/gero-swap/gero-swap.css
```
Write `src/vendor/gero-swap/README.md`:
```md
# Vendored @gero/dex-widget (<gero-swap>)

Built IIFE bundle of the Gero DEX aggregator widget. Self-registers `<gero-swap>` on load.

- Source repo: gero-dex-widget (packages/widget), main @ <record the `git rev-parse HEAD` of gero-dex-widget here>
- Rebuild: `pnpm --filter @gero/dex-widget build` then copy `dist/gero-swap.js` + `dist/style.css` here.
- CSP: runtime-only (no template compiler) — enforced by the widget's `verify:csp` build guard.
- Do NOT edit these files by hand; re-vendor from source.
```
Record the actual gero-dex-widget HEAD sha in the README (run `git -C "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-dex-widget" rev-parse --short HEAD`).

- [ ] **Step 2: Copy vendor dir in the build**

In `vite.config.mts`, add a target to the existing `copy({ targets: [...] })` (~line 273):
```js
              { src: 'src/vendor/gero-swap/*', dest: 'extension/vendor/gero-swap', flatten: true },
```

- [ ] **Step 3: Load the bundle in both HTML entrypoints**

In `src/sidepanel/index.html` AND `src/options/index.html`, add inside `<head>` (before the app module script):
```html
    <link rel="stylesheet" href="/vendor/gero-swap/gero-swap.css" />
    <script src="/vendor/gero-swap/gero-swap.js"></script>
```

- [ ] **Step 4: Tell Vue2 to ignore the custom element**

In `src/sidepanel/main.ts` and `src/options/main.ts`, near the other `Vue.config` lines, add:
```ts
Vue.config.ignoredElements = [...(Vue.config.ignoredElements || []), 'gero-swap'];
```

- [ ] **Step 5: Build + verify the element registers**

Run: `npm run build 2>&1 | tail -20` (or the sidepanel/options build). Expected: build succeeds; `extension/vendor/gero-swap/gero-swap.js` + `.css` exist.
Run: `ls -la extension/vendor/gero-swap/`
Expected: both files present.
(Manual runtime check deferred to Task 6 mount; structural presence is the gate here.)

- [ ] **Step 6: Commit**

```bash
git add src/vendor/gero-swap vite.config.mts src/sidepanel/index.html src/options/index.html src/sidepanel/main.ts src/options/main.ts
git -c commit.gpgsign=false commit --no-verify -m "feat(swap): vendor <gero-swap> widget bundle + load under CSP 'self'"
```

---

### Task 2: Rename dexHunterStore → tokenMetadataStore (keep hydration)

**Files:**
- Rename: `src/stores/dexHunterStore.ts` → `src/stores/tokenMetadataStore.ts`
- Modify: every importer (resolver.ts, useMarketData.ts, walletManager.service.ts, PortfolioPage.vue, SendSheet.vue, TokensTab.vue, TokenSelector.vue, SelectTokenDialog.vue, AssetsToSendStep.vue — verify the full set with grep).

**Interfaces:**
- Produces: `tokenMetadataStore` with the same state/actions (`loadTokens`, `loadBlacklistPolicies`, `updatePrices`, `searchTokens`; drop `registerAddress` only if no non-swap caller). Exports keep their names; only the store object + module name change. STORE_NAME constant updated.

- [ ] **Step 1: Inventory every reference**

Run: `grep -rn "dexHunterStore\|DexHunterStore\|dexHunterTokens" src/ --include=*.ts --include=*.vue | grep -v "src/api/dexhunter-api" | sort`
Record the full list. (Expected ~the 9 consumers from the spec + the store file + walletManager hydration.)

- [ ] **Step 2: Write a smoke test that the store hydrates + a consumer reads it**

Create `src/stores/__tests__/tokenMetadataStore.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { tokenMetadataStore } from '../tokenMetadataStore';

describe('tokenMetadataStore', () => {
  it('exposes the metadata state shape used by non-swap consumers', () => {
    expect(tokenMetadataStore).toBeDefined();
    // state map + blacklist are the fields resolver.ts / useMarketData depend on
    expect(tokenMetadataStore.state).toHaveProperty('tokens');            // renamed-neutral token map
    expect(tokenMetadataStore.state).toHaveProperty('blacklistPolicies');
    expect(typeof tokenMetadataStore.loadTokens).toBe('function');
    expect(typeof tokenMetadataStore.loadBlacklistPolicies).toBe('function');
  });
});
```
> Implementer note: match the assertion field names to the store's ACTUAL state shape (the current store uses `dexHunterTokens` — rename the state field to a neutral `tokens` as part of this task, OR keep the field name and adjust the test to the real name; prefer renaming `dexHunterTokens`→`tokens` for a clean end state, updating the ~9 consumers' `.dexHunterTokens` reads accordingly). Keep the assertion meaningful (state map + blacklist + the two load actions exist).

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/stores/__tests__/tokenMetadataStore.test.ts`
Expected: FAIL — module `../tokenMetadataStore` does not exist yet.

- [ ] **Step 4: Rename the store file + neutralize internal names**

`git mv src/stores/dexHunterStore.ts src/stores/tokenMetadataStore.ts`. In the file: rename the exported store object `dexHunterStore`→`tokenMetadataStore`, the interface `DexHunterStore`→`TokenMetadataStore`, the state field `dexHunterTokens`→`tokens`, and the STORE_NAME/broadcast channel constant (e.g. `'dexHunterStore'`→`'tokenMetadataStore'`). Keep ALL actions + the bg↔browser sync logic intact. Remove `registerAddress` only if Step 1 showed no non-swap caller (SwapWidget/SwapSheet/QuickSwap were the callers — those go away in Task 6; if only they called it, remove it here and note it).

- [ ] **Step 5: Update every importer**

For each file from Step 1: change the import path + identifier (`dexHunterStore`→`tokenMetadataStore`) and any `.dexHunterTokens`→`.tokens` access. Keep `walletManager.service.ts` hydration calls (now `tokenMetadataStore.loadTokens()` / `.loadBlacklistPolicies()`).

- [ ] **Step 6: Run test + typecheck + grep-clean**

Run: `npx vitest run src/stores/__tests__/tokenMetadataStore.test.ts`
Expected: PASS.
Run: `npx vue-tsc --noEmit 2>&1 | grep -iE "dexHunter|tokenMetadata|error TS" | head` (or the project's `npm run typecheck`).
Expected: no unresolved-symbol errors referencing the old store.
Run: `grep -rn "dexHunterStore\|DexHunterStore\|\.dexHunterTokens" src/ --include=*.ts --include=*.vue | grep -v "src/api/dexhunter-api"`
Expected: empty (all swapped). (`dexhunter-api.ts` metadata methods stay — they're handled in Task 7.)

- [ ] **Step 7: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit --no-verify -m "refactor(store): rename dexHunterStore -> tokenMetadataStore (keep hydration)"
```

---

### Task 3: useSwapTokenResolver — TokenMeta for the widget

**Files:**
- Create: `src/modules/swap/composables/useSwapTokenResolver.ts`, `src/modules/swap/composables/__tests__/useSwapTokenResolver.test.ts`

**Interfaces:**
- Consumes: `resolveAsset` (`src/shared/utils/resolver.ts:367`) / `useMarketData` decimals+verified, `tokenMetadataStore`.
- Produces: `useSwapTokenResolver()` → `{ resolveToken(unit: string): Promise<TokenMetaLike | null> }` where `TokenMetaLike = { unit; decimals; ticker?; name?; img?; verified?; price? }` (matches the widget's `TokenMeta`). Returns `null` for `'lovelace'` (widget seeds ADA) and for unknown decimals.

- [ ] **Step 1: Write the failing test**

`src/modules/swap/composables/__tests__/useSwapTokenResolver.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/shared/utils/resolver', () => ({
  resolveAsset: vi.fn(async (t: { unit: string }) =>
    t.unit === 'known'
      ? { unit: 'known', metadata: { decimals: 0, ticker: 'SNEK', name: 'Snek' }, img: 'i', verified: true }
      : { unit: t.unit, metadata: {}, verified: false }),
}));

import { useSwapTokenResolver } from '../useSwapTokenResolver';

describe('useSwapTokenResolver', () => {
  it('returns null for lovelace (widget seeds ADA)', async () => {
    const { resolveToken } = useSwapTokenResolver();
    expect(await resolveToken('lovelace')).toBeNull();
  });
  it('maps a known token to TokenMeta with real decimals', async () => {
    const { resolveToken } = useSwapTokenResolver();
    const m = await resolveToken('known');
    expect(m).toMatchObject({ unit: 'known', decimals: 0, ticker: 'SNEK', verified: true });
  });
  it('returns null when decimals are unknown', async () => {
    const { resolveToken } = useSwapTokenResolver();
    expect(await resolveToken('mystery')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/swap/composables/__tests__/useSwapTokenResolver.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the composable**

`src/modules/swap/composables/useSwapTokenResolver.ts`:
```ts
import { resolveAsset } from '@/shared/utils/resolver';

export interface TokenMetaLike {
  unit: string; decimals: number;
  ticker?: string; name?: string; img?: string; verified?: boolean; price?: number;
}

export function useSwapTokenResolver() {
  async function resolveToken(unit: string): Promise<TokenMetaLike | null> {
    if (unit === 'lovelace') return null; // widget seeds ADA (6) itself
    try {
      const asset = await resolveAsset({ unit } as never);
      const decimals = asset?.metadata?.decimals;
      if (decimals == null) return null; // unknown decimals -> widget blocks (UNKNOWN_TOKEN_DECIMALS)
      return {
        unit,
        decimals: Number(decimals),
        ticker: asset?.metadata?.ticker,
        name: asset?.metadata?.name,
        img: asset?.img,
        verified: asset?.verified ?? false,
      };
    } catch {
      return null; // resolution failure -> treat as unknown, widget blocks
    }
  }
  return { resolveToken };
}
```
> Implementer note: `resolveAsset`'s real return shape / how decimals are surfaced (it may back-fill from the store for CIP-68 label 333) is at `resolver.ts:305,318-343,436-443`. Adjust the decimals extraction to the REAL field(s) so a real non-ADA token yields correct decimals; keep the "unknown → null" contract. If `useMarketData` is the cleaner decimals source, use it — the fixed requirement is: correct decimals for known tokens, null for unknown, null for lovelace.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/modules/swap/composables/__tests__/useSwapTokenResolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/swap/composables/useSwapTokenResolver.ts src/modules/swap/composables/__tests__/useSwapTokenResolver.test.ts
git -c commit.gpgsign=false commit --no-verify -m "feat(swap): useSwapTokenResolver (host TokenMeta for the widget)"
```

---

### Task 4: useNativeSwapSigner — 5-wallet-type witness signer

**Files:**
- Create: `src/modules/swap/composables/useNativeSwapSigner.ts`, `src/modules/swap/composables/__tests__/useNativeSwapSigner.test.ts`

**Interfaces:**
- Consumes: `walletStore`, `Messaging`, `MessageTypes`, `WalletType`, `utxoToCip30Hex` (extract/reuse from `useStrikeDeposit.ts:21`), and the HW/PRF helpers (`ledgerUtils.txToLedger`, `MessageTypes.TREZOR`, `createKeystoneSignRequest`/`parseSignature`) exactly as `SwapSheet.vue` uses them.
- Produces: `useNativeSwapSigner(opts)` → `{ signer, keystone }` where `signer` implements the widget's `Signer` (`getAddresses`, `getUtxos`, `signTx(cbor)→witnessHex`, `meta`), and `keystone` exposes the QR state + `onKeystoneScan(ur)` the wrapper renders. `signTx` dispatches by `walletStore.loggedWallet.type` + PRF flag; for password it needs a spending password (obtained via `opts.getPassword()` — a host callback that prompts), for PassKey/PRF via `opts.getPrfBytes()`, for Keystone it resolves when `onKeystoneScan` fires.

- [ ] **Step 1: Write the failing test (password + PRF + error paths, mocked)**

`src/modules/swap/composables/__tests__/useNativeSwapSigner.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendToBackgroundFromOptions = vi.fn();
vi.mock('@/chrome/messaging', () => ({
  Messaging: { sendToBackgroundFromOptions: (...a: unknown[]) => sendToBackgroundFromOptions(...a) },
}));
vi.mock('@/models/MessageTypes', () => ({ MessageTypes: { SIGN_TX: 'SIGN_TX', VERIFY_SPENDING_PASSWORD: 'VERIFY_SPENDING_PASSWORD', TREZOR: 'TREZOR' } }));
const walletState: any = {
  keys: { payment: [{ address: 'addr_p' }], change: [{ address: 'addr_c' }], stake: [] },
  utxos: [],
  loggedWallet: { type: 'Normal', baseAddress: 'addr_base' },
};
vi.mock('@/stores/walletStore', () => ({ walletStore: walletState }));
vi.mock('@/models/types', () => ({ WalletType: { Normal: 'Normal', Ledger: 'Ledger', Trezor: 'Trezor', Keystone: 'Keystone' } }));

import { useNativeSwapSigner } from '../useNativeSwapSigner';

describe('useNativeSwapSigner', () => {
  beforeEach(() => { sendToBackgroundFromOptions.mockReset(); walletState.loggedWallet = { type: 'Normal', baseAddress: 'addr_base' }; });

  it('getAddresses maps walletStore.keys + baseAddress', async () => {
    const { signer } = useNativeSwapSigner({ getPassword: async () => 'pw', getPrfBytes: async () => new Uint8Array() });
    expect(await signer.getAddresses()).toEqual({ used: ['addr_p', 'addr_c'], change: 'addr_base' });
  });

  it('password path: verifies password then SIGN_TX partialSign, returns witnesses', async () => {
    sendToBackgroundFromOptions
      .mockResolvedValueOnce({ data: { success: true } })              // VERIFY_SPENDING_PASSWORD
      .mockResolvedValueOnce({ data: { witnesses: 'WIT' } });          // SIGN_TX
    const { signer } = useNativeSwapSigner({ getPassword: async () => 'pw', getPrfBytes: async () => new Uint8Array() });
    const wit = await signer.signTx('CBOR');
    expect(wit).toBe('WIT');
    const signCall = sendToBackgroundFromOptions.mock.calls.at(-1)![0];
    expect(signCall.method).toBe('SIGN_TX');
    expect(signCall.data.txCbor).toBe('CBOR');       // opaque cbor unchanged
    expect(signCall.data.partialSign).toBe(true);
    expect(signCall.data.mergeWitnesses).toBe(false);
  });

  it('PRF path: SIGN_TX with privateKeyBytes, no password', async () => {
    walletState.loggedWallet = { type: 'Normal', encryptionMethod: 'prf', baseAddress: 'addr_base' };
    sendToBackgroundFromOptions.mockResolvedValueOnce({ data: { witnesses: 'WIT2' } });
    const { signer } = useNativeSwapSigner({ getPassword: async () => '', getPrfBytes: async () => new Uint8Array([1, 2, 3]) });
    expect(await signer.signTx('CBOR')).toBe('WIT2');
    const call = sendToBackgroundFromOptions.mock.calls.at(-1)![0];
    expect(call.data.privateKeyBytes).toEqual([1, 2, 3]);
    expect(call.data.password).toBeUndefined();
  });

  it('throws when SIGN_TX returns no witnesses', async () => {
    sendToBackgroundFromOptions
      .mockResolvedValueOnce({ data: { success: true } })
      .mockResolvedValueOnce({ data: { error: 'bad password' } });
    const { signer } = useNativeSwapSigner({ getPassword: async () => 'pw', getPrfBytes: async () => new Uint8Array() });
    await expect(signer.signTx('CBOR')).rejects.toThrow(/bad password|Signing failed/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/swap/composables/__tests__/useNativeSwapSigner.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the composable (password + PRF fully; Ledger/Trezor/Keystone mirroring SwapSheet)**

`src/modules/swap/composables/useNativeSwapSigner.ts`:
```ts
import { ref } from 'vue';
import { Serialization } from '@cardano-sdk/core';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import ledgerUtils from '@/shared/utils/ledger';
import { createKeystoneSignRequest, parseSignature } from '@/shared/utils/keystone';
import { utxoToCip30Hex } from './utxoToCip30Hex'; // extract the helper from useStrikeDeposit (Step 3b)

export interface NativeSwapSignerOptions {
  getPassword: () => Promise<string>;    // host prompts for spending password
  getPrfBytes: () => Promise<Uint8Array>; // host runs PassKey popup
}

function isPrf(w: any): boolean {
  return w?.encryptionMethod === 'prf' || (!!w?.prfEncryptedPrivateKey && !!w?.webAuthnCredentialId);
}

export function useNativeSwapSigner(opts: NativeSwapSignerOptions) {
  // Keystone QR state the wrapper renders
  const keystoneType = ref('');
  const keystoneCbor = ref('');
  const keystoneShow = ref(false);
  let keystoneResolve: ((witnessHex: string) => void) | null = null;
  let keystoneReject: ((e: Error) => void) | null = null;

  async function getAddresses() {
    const keys = walletStore.keys;
    const used = [...(keys.payment || []), ...(keys.change || [])].map((k: any) => k.address);
    return { used, change: walletStore.loggedWallet.baseAddress };
  }
  async function getUtxos() {
    return (walletStore.utxos || []).map(utxoToCip30Hex);
  }

  async function signPasswordOrPrf(cbor: string): Promise<string> {
    const w = walletStore.loggedWallet;
    const data: any = { txCbor: cbor, partialSign: true, accountIndex: 0,
                        utxos: walletStore.utxos, addresses: walletStore.keys, mergeWitnesses: false };
    if (isPrf(w)) {
      const pk = await opts.getPrfBytes();
      data.privateKeyBytes = Array.from(pk);
    } else {
      const password = await opts.getPassword();
      const verify = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.VERIFY_SPENDING_PASSWORD, data: { password } });
      if (!verify?.data?.success) throw new Error('Invalid spending password');
      data.password = password;
    }
    const res = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.SIGN_TX, data });
    if (!res?.data?.witnesses) throw new Error(res?.data?.error || 'Signing failed');
    return res.data.witnesses;
  }

  async function signLedger(cbor: string): Promise<string> {
    // Derive a Tx from the SAME opaque cbor for HW signing only; submit uses the original cbor.
    const tx = Serialization.Transaction.fromCbor(cbor as never).toCore();
    const network = /* networks[walletStore.loggedWallet.network] */ undefined as never;
    const signatures = await ledgerUtils.txToLedger(tx as never, walletStore.keys as never, walletStore.utxos as never, true as never, network);
    return Serialization.TransactionWitnessSet.fromCore({ signatures } as never).toCbor() as unknown as string;
  }
  async function signTrezor(cbor: string): Promise<string> {
    const res = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.TREZOR, data: { method: 'signTx', txCbor: cbor } });
    const signatures = new Map(res?.data?.signatures || []);
    return Serialization.TransactionWitnessSet.fromCore({ signatures } as never).toCbor() as unknown as string;
  }
  async function signKeystone(cbor: string): Promise<string> {
    const req = createKeystoneSignRequest(cbor as never, walletStore.loggedWallet as never, walletStore.utxos as never, walletStore.keys as never);
    keystoneType.value = (req as any).type; keystoneCbor.value = (req as any).cbor; keystoneShow.value = true;
    return new Promise<string>((resolve, reject) => { keystoneResolve = resolve; keystoneReject = reject; });
  }
  function onKeystoneScan(ur: unknown) {
    try {
      const sig = parseSignature(ur as never);
      keystoneShow.value = false;
      keystoneResolve?.((sig as any).witnessSet);
    } catch (e) { keystoneReject?.(e as Error); }
  }
  function cancelKeystone() { keystoneShow.value = false; keystoneReject?.(new Error('Keystone signing cancelled')); }

  async function signTx(unsignedTxCbor: string): Promise<string> {
    const t = walletStore.loggedWallet?.type;
    if (t === WalletType.Ledger) return signLedger(unsignedTxCbor);
    if (t === WalletType.Trezor) return signTrezor(unsignedTxCbor);
    if (t === WalletType.Keystone) return signKeystone(unsignedTxCbor);
    return signPasswordOrPrf(unsignedTxCbor); // Normal (+ PRF flag)
  }

  const signer = { getAddresses, getUtxos, signTx, meta: { name: 'Gero' } };
  return { signer, keystone: { keystoneType, keystoneCbor, keystoneShow, onKeystoneScan, cancelKeystone } };
}
```
> Implementer notes (verify against the real code — the SwapSheet branches are the source of truth at `SwapSheet.vue:1176-1335`):
> - Extract `utxoToCip30Hex` from `useStrikeDeposit.ts:21-44` into a shared `./utxoToCip30Hex.ts` (Step 3b) and import it in BOTH places (DRY) — or import it from `useStrikeDeposit` if it's already exported. Do not duplicate the Map-reconstruction logic.
> - `signLedger`: use the EXACT args SwapSheet passes (`ledgerUtils.txToLedger(txCore, keys, utxos, !isBT, network)`); `network` from `networks[loggedWallet.network]`; `isBT` from `loggedWallet.btSupported`. Confirm the `Serialization` call that yields the tx CORE from cbor matches how SwapSheet obtains `txCore` (it may already hold the Cardano.Tx from the build response — if so, thread the widget's cbor through the same `serialize/deserialize` used in `cardanoJsSdkCbor.ts` WITHOUT re-encoding the body that submit uses).
> - Trezor/Keystone: mirror `SwapSheet.vue:1258-1268` / `1284-1335` exactly.
> - The password/PRF/error paths are fully specified above and are what the Step 1 test covers. HW paths (Ledger/Trezor/Keystone) are structurally mirrored; their live verification is part of the manual/e2e gate (they need real devices) — the unit test covers the dispatch + password/PRF witness return.

- [ ] **Step 3b: Extract the shared utxo helper**

Create `src/modules/swap/composables/utxoToCip30Hex.ts` exporting `utxoToCip30Hex` (move the body verbatim from `useStrikeDeposit.ts:21-44`), and update `useStrikeDeposit.ts` to import it from there (no behavior change — a pure move to avoid duplication). Add a tiny test `__tests__/utxoToCip30Hex.test.ts` asserting a minimal `Cardano.Utxo` round-trips to a non-empty cbor hex string.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/modules/swap/composables/__tests__/useNativeSwapSigner.test.ts src/modules/swap/composables/__tests__/utxoToCip30Hex.test.ts`
Expected: PASS (getAddresses, password, PRF, error, utxo helper).
Run typecheck for touched files (project `npm run typecheck` or `npx vue-tsc --noEmit`) — resolve type errors in the new files (the HW branches use `as never` casts sparingly to bridge SDK types; keep them minimal and note any).

- [ ] **Step 5: Commit**

```bash
git add src/modules/swap/composables/useNativeSwapSigner.ts src/modules/swap/composables/utxoToCip30Hex.ts src/modules/swap/composables/__tests__/
# include the useStrikeDeposit import change:
git add src/modules/market/composables/useStrikeDeposit.ts
git -c commit.gpgsign=false commit --no-verify -m "feat(swap): native 5-wallet-type swap signer (password/PRF/Ledger/Trezor/Keystone)"
```

---

### Task 5: GeroSwapEmbed.vue — the wrapper

**Files:**
- Create: `src/modules/swap/components/GeroSwapEmbed.vue`, `src/modules/swap/components/__tests__/GeroSwapEmbed.spec.ts`

**Interfaces:**
- Consumes: `useNativeSwapSigner`, `useSwapTokenResolver`, `walletStore`, `featureFlagsStore` (isSwapEnabled), `tokenMetadataStore` (optional `tokens` catalog).
- Produces: a Vue2 component rendering `<gero-swap mode="native" ...>`, setting `signer`/`resolveToken`/`tokens` element properties, wiring events (`swap-submitted`/`swap-error`/`token-change`), and rendering the Keystone QR dialog + PassKey popup host-side. Props: `tokenIn?`, `tokenOut?` (seed the pair), `context?: 'page'|'dialog'|'sidepanel'`.

- [ ] **Step 1: Write the failing test**

`src/modules/swap/components/__tests__/GeroSwapEmbed.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('../../composables/useNativeSwapSigner', () => ({
  useNativeSwapSigner: () => ({ signer: { meta: { name: 'Gero' } }, keystone: { keystoneShow: { value: false }, onKeystoneScan: vi.fn(), cancelKeystone: vi.fn() } }),
}));
vi.mock('../../composables/useSwapTokenResolver', () => ({ useSwapTokenResolver: () => ({ resolveToken: vi.fn() }) }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isSwapEnabled: () => true } }));
vi.mock('@/stores/tokenMetadataStore', () => ({ tokenMetadataStore: { state: { tokens: {} } } }));

import GeroSwapEmbed from '../GeroSwapEmbed.vue';

describe('GeroSwapEmbed', () => {
  it('renders <gero-swap native> and sets signer + resolveToken as element properties', async () => {
    const wrapper = mount(GeroSwapEmbed, { props: { tokenOut: 'SNEK' } });
    const el = wrapper.find('gero-swap').element as any;
    expect(el).toBeTruthy();
    expect(el.getAttribute('mode')).toBe('native');
    expect(el.getAttribute('token-out')).toBe('SNEK');
    await wrapper.vm.$nextTick();
    expect(el.signer).toBeTruthy();
    expect(typeof el.resolveToken).toBe('function');
  });

  it('re-emits swap-submitted from the element', async () => {
    const wrapper = mount(GeroSwapEmbed, {});
    const el = wrapper.find('gero-swap').element;
    el.dispatchEvent(new CustomEvent('swap-submitted', { detail: { txHash: 'TX' } }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('swap-submitted')?.[0]?.[0]).toMatchObject({ txHash: 'TX' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/modules/swap/components/__tests__/GeroSwapEmbed.spec.ts`
Expected: FAIL — component missing.

- [ ] **Step 3: Write GeroSwapEmbed.vue**

`src/modules/swap/components/GeroSwapEmbed.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useNativeSwapSigner } from '../composables/useNativeSwapSigner';
import { useSwapTokenResolver } from '../composables/useSwapTokenResolver';
import { tokenMetadataStore } from '@/stores/tokenMetadataStore';

const props = defineProps<{ tokenIn?: string; tokenOut?: string; context?: 'page' | 'dialog' | 'sidepanel' }>();
const emit = defineEmits<{
  (e: 'swap-submitted', d: unknown): void;
  (e: 'swap-error', d: unknown): void;
  (e: 'token-change', d: unknown): void;
}>();

const el = ref<HTMLElement | null>(null);
// Host prompts (spending password dialog / PassKey popup) are provided to the signer:
const pwPrompt = ref<{ show: boolean; resolve?: (v: string) => void }>({ show: false });
async function getPassword() { return new Promise<string>((resolve) => { pwPrompt.value = { show: true, resolve }; }); }
async function getPrfBytes() { /* run the existing PassKey popup flow, return the PRF bytes */ return new Uint8Array(); }

const { signer, keystone } = useNativeSwapSigner({ getPassword, getPrfBytes });
const { resolveToken } = useSwapTokenResolver();

function wireProps() {
  const node = el.value as any;
  if (!node) return;
  node.signer = signer;
  node.resolveToken = resolveToken;
  node.tokens = Object.values(tokenMetadataStore.state.tokens || {}); // optional catalog
}
onMounted(() => {
  wireProps();
  const node = el.value!;
  node.addEventListener('swap-submitted', (e) => emit('swap-submitted', (e as CustomEvent).detail));
  node.addEventListener('swap-error', (e) => emit('swap-error', (e as CustomEvent).detail));
  node.addEventListener('token-change', (e) => emit('token-change', (e as CustomEvent).detail));
});
watch(() => [props.tokenIn, props.tokenOut], wireProps);
</script>

<template>
  <div class="gero-swap-embed">
    <gero-swap
      ref="el"
      mode="native"
      :network="undefined"
      :base-url="/* VITE_NEXUS_URL */ undefined"
      :token-in="tokenIn"
      :token-out="tokenOut"
    />
    <!-- Keystone QR dialog (host-rendered) -->
    <KeystoneScanDialog
      v-if="keystone.keystoneShow.value"
      :type="keystone.keystoneType.value"
      :cbor="keystone.keystoneCbor.value"
      @scan="keystone.onKeystoneScan"
      @close="keystone.cancelKeystone"
    />
    <!-- Spending-password dialog + PassKey popup rendered here for HW/PRF/password host prompts -->
  </div>
</template>
```
> Implementer notes:
> - Set `base-url` to `import.meta.env['VITE_NEXUS_URL']` and `network` to the wallet's current network string the aggregator expects (e.g. `mainnet`/`preprod` — confirm the exact token the widget/nexus want; the gero-backend proxy uppercases for key selection but the widget passes it through as `network` attr).
> - Reuse the EXISTING Keystone scan dialog + spending-password dialog + PassKey popup components the wallet already has (find them via how SwapSheet/`useTransactionSigning` render Keystone/PassKey) — do NOT build new dialogs. `KeystoneScanDialog` above is a placeholder for the real component name.
> - The `getPrfBytes` must run the real PassKey popup (the same one SwapSheet uses via the PassKey component `@success`). Wire it to that flow.
> - Bind `token-out`/`token-in` as attributes (strings) and set functions/objects (`signer`,`resolveToken`,`tokens`) as properties only.
> - The two tests (element renders native + properties set; re-emits swap-submitted) are the fixed gate; adjust the template ref access to what `@vue/test-utils` exposes for a custom element, keeping those assertions.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/modules/swap/components/__tests__/GeroSwapEmbed.spec.ts`
Expected: PASS.
Typecheck the new component.

- [ ] **Step 5: Commit**

```bash
git add src/modules/swap/components/GeroSwapEmbed.vue src/modules/swap/components/__tests__/GeroSwapEmbed.spec.ts
git -c commit.gpgsign=false commit --no-verify -m "feat(swap): GeroSwapEmbed wrapper (native signer + resolver + host dialogs)"
```

---

### Task 6: Replace the three mount sites

**Files:**
- Modify: `src/modules/swap/Swap.vue:12`, `src/modules/dashboard/dialogs/SwapDialog.vue:14`, `src/modules/dashboard/views/Dashboard.vue:220`, `src/sidepanel/pages/HomePage.vue` (SwapSheet mount), `src/modules/market/components/TokenDetailPanel.vue:145`.

**Interfaces:**
- Consumes: `GeroSwapEmbed`. Produces: the three swap entry points now render the embedded widget; `isSwapEnabled` gate preserved.

- [ ] **Step 1: Replace SwapWidget usages**

In `Swap.vue`, `SwapDialog.vue`, `Dashboard.vue`: replace `<SwapWidget .../>` with `<GeroSwapEmbed :token-out="buyTokenUnit" context="page|dialog" />` (pass the existing buy-token prop where present). Keep the `isSwapEnabled` `v-if` / maintenance overlay exactly as-is. Update imports.

- [ ] **Step 2: Replace SwapSheet (sidepanel)**

In the sidepanel swap flow (`src/sidepanel/pages/HomePage.vue` / the flow router that shows `SwapSheet`), render `<GeroSwapEmbed context="sidepanel" />` inside the existing sheet chrome (keep sheet header/height/back-nav + the `isSwapEnabled` overlay). Remove the `SwapSheet` body.

- [ ] **Step 3: Replace QuickSwap**

In `TokenDetailPanel.vue:145`, replace `<QuickSwap .../>` with `<GeroSwapEmbed :token-out="<detail token unit>" context="dialog" />`.

- [ ] **Step 4: Typecheck + existing tests + build**

Run: `npx vue-tsc --noEmit` (or `npm run typecheck`) → resolve errors from removed props/imports.
Run: `npm run build 2>&1 | tail -20` → succeeds.
Run any existing swap-related unit tests: `npx vitest run src/modules/swap` → green (or updated).

- [ ] **Step 5: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit --no-verify -m "feat(swap): mount GeroSwapEmbed at swap page, dialog, sidepanel, token-detail"
```

---

### Task 7: Remove DexHunter swap-tx code + rebrand + i18n

**Files:**
- Modify/Delete: `src/api/dexhunter-api.ts` (swap-tx methods), delete now-unreferenced `SwapWidget.vue`, `SwapSheet.vue`, `QuickSwap.vue`, `SwapOverviewOverlay.vue`; `TransactionsCard.vue:1280-1300` tagging; `src/utils/assets.ts:144,378` + `src/assets/svg/dexhunter.svg`; i18n `us.ts`/`de.ts`.

**Interfaces:** none new (cleanup). Produces: no DexHunter swap paths / branding remain; metadata methods retained.

- [ ] **Step 1: Delete unreferenced swap components**

Confirm no importers, then delete: `src/modules/swap/components/SwapWidget.vue`, `src/modules/swap/components/SwapOverviewOverlay.vue`, `src/sidepanel/components/flows/SwapSheet.vue`, `src/modules/market/components/QuickSwap.vue`.
Run: `grep -rn "SwapWidget\|SwapOverviewOverlay\|SwapSheet\|QuickSwap" src/ --include=*.ts --include=*.vue` → only the deletions / self-references; fix any stragglers.

- [ ] **Step 2: Remove DexHunter swap-tx API methods**

In `src/api/dexhunter-api.ts`, delete `swap`, `swapLimitBuild`, `swapSign` (and `estimate`/`reverseEstimate`/`getAveragePrice`/`walletBalance` ONLY if grep shows no remaining caller). KEEP `getSwapTokens`, `mCap`, `getAllBlacklistPolicies` (the metadata store still calls them).
Run: `grep -rn "dexHunterApi\.\(swap\|swapLimitBuild\|swapSign\|estimate\|reverseEstimate\)" src/` → empty.

- [ ] **Step 3: Rebrand — logos + tx tagging + i18n**

- Remove `dexHunterLogo` from `src/utils/assets.ts:144,378`; delete `src/assets/svg/dexhunter.svg` (confirm unreferenced first).
- `TransactionsCard.vue:1280-1300`: keep recognizing historical DexHunter txs, but relabel the display to a neutral `transactions.swap` ("Swap"); add recognition of aggregator/Nexus swap txs (order/fee address or metadata heuristic — confirm the aggregator's order address/metadata during this step; if unknown, keep historical tagging + a neutral label and leave a note, do not invent an address).
- i18n `src/plugins/i18n/us.ts`: `common.poweredBy` (unused now — leave or repurpose), `transactions.dexHunter`→ neutral "Swap" (rename key to `transactions.swap`, update usages), `market.verifiedTooltip` "Token identity verified by DexHunter"→ "Token identity verified". Mirror ALL changes in `de.ts` (German).

- [ ] **Step 4: Typecheck + build + full unit suite**

Run: `npx vue-tsc --noEmit` → clean.
Run: `npm run build 2>&1 | tail -20` → succeeds.
Run: `npx vitest run src/modules/swap src/stores/__tests__` → green.

- [ ] **Step 5: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit --no-verify -m "chore(swap): remove DexHunter swap-tx code + rebrand to Gero aggregator"
```

---

### Task 8: Full verification checkpoint

**Files:** none.

- [ ] **Step 1: Typecheck + build + touched-area tests**

Run: `npx vue-tsc --noEmit && npm run build 2>&1 | tail -5 && npx vitest run src/modules/swap src/stores`
Expected: typecheck clean; build succeeds; new/updated tests green.

- [ ] **Step 2: Confirm no DexHunter swap remnants + widget vendored**

Run: `grep -rn "dexHunterStore\|dexHunterApi\.\(swap\|swapSign\|swapLimitBuild\)\|Powered by DexHunter\|dexHunterLogo" src/` → empty.
Run: `ls extension/vendor/gero-swap/` → `gero-swap.js` + `gero-swap.css`.

- [ ] **Step 3: No commit** (verification only).

---

## Self-Review

**Spec coverage:**
- §3.1 vendoring + CSP load + ignoredElements → Task 1. ✓
- §3.2 GeroSwapEmbed wrapper → Task 5. ✓
- §3.3 native 5-type signer (SIGN_TX password+PRF; Ledger/Trezor/Keystone client-side) → Task 4. ✓
- §3.4 resolveToken → Task 3. ✓
- §3.5 mount-site replacement + isSwapEnabled → Task 6. ✓
- §3.6 rebrand (logos, tagging, i18n) → Task 7. ✓
- §3.7 DexHunter removal + store rename → Task 2 (rename) + Task 7 (removal). ✓
- §5 security (opaque cbor, no partner key, blacklist/verified preserved via rename) → Tasks 2,4,6. ✓
- §6 testing → Tasks 2–5 unit tests + Task 8; e2e gated on #2a deploy (noted). ✓
- §7 risks (HW/PRF resolved; sidepanel context; CSS bleed; new-tx tagging) → Tasks 4,6,7 + notes. ✓

**Placeholder scan:** No TBD/TODO. Implementer notes carry explicit "verify against real code" instructions with FIXED assertions (opaque cbor, correct decimals, witness return, properties-not-attributes) — these are legitimate "match the real symbol names" directives, not placeholders. HW-branch live verification is explicitly deferred to the e2e gate (needs devices) with unit coverage of dispatch + password/PRF.

**Type/name consistency:** `signer` shape (`getAddresses`/`getUtxos`/`signTx`/`meta`) matches the widget `Signer` across Task 4 + Task 5. `resolveToken` returns `TokenMetaLike` (⊇ widget `TokenMeta`) consistent Task 3 ↔ Task 5. `tokenMetadataStore.state.tokens` consistent Task 2 ↔ Task 5. `useNativeSwapSigner(opts).{signer,keystone}` consistent Task 4 ↔ Task 5. `utxoToCip30Hex` single shared module (Task 4 Step 3b) consumed by signer + useStrikeDeposit.

---

## Sequencing / hold notes

- Tasks 1–5 are safe + unit-testable in isolation (vendor, store rename, resolver, signer, wrapper). Tasks 6–7 are the irreversible user-facing swap (UI replacement + DexHunter deletion) and **cannot be end-to-end verified until #2a's aggregator proxy routes are deployed** — the native path calls `/api/nexus/api/aggregator/*`, which only exists on the held `feat/aggregator-proxy` branch.
- HW/PRF live signing (Ledger/Trezor/Keystone) needs physical devices — unit tests cover dispatch + password/PRF; device paths verified manually pre-merge.
- Branch `feat/embed-swap-widget` only; do NOT merge to `development` (prod-adjacent) until #2a is live + a preprod end-to-end swap passes on all wallet types.
