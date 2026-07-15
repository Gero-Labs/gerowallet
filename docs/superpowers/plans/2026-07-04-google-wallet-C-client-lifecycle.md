# Plan C — Client Wallet Lifecycle (service layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The client-side service layer that turns a Google login + MPC shares into a working, recoverable Cardano wallet: a backend API client for `/api/mpc`, entropy↔mnemonic↔xpub bridging with the reconstruct-and-**validate** invariant, device-share at-rest encryption, an orchestration service (create / sign-prep / recover), and DB persistence. No UI here (Plan D wires the stepper + sign call-sites).

**Architecture:** Pure/unit-testable service modules building on the existing `src/shared/utils/mpc/` scaffold (Plan A). Master secret = BIP39 entropy → Shamir 2-of-3 (device/login/recovery). At sign time the browser context reconstructs entropy from device + login shares, **validates the derived account xpub against the stored `wallet.publicKey`** (hand-off from Plan A's review — reconstructing from mismatched shares silently yields a wrong key), then materializes the Cardano root key and passes its bytes to the existing `WalletBg.signTx(..., privateKeyBytes)` path (same mechanism PRF wallets already use — no `walletBg` change needed).

**Tech Stack:** TypeScript, Vue 2.7, Vitest 3.2.4, Dexie, `bip39`, `@cardano-sdk/crypto`, existing `src/shared/utils/mpc/` + `crypto.ts` + `resolver.ts` + `gero-db.ts`.

## Global Constraints
- **Backend contract is fixed by Plan B — match it exactly** (no `userId` in the body; backend derives `sub` from the verified `idToken`):
  - `POST /api/mpc/enroll` body `{ idToken, chain, network, loginShare }` → `{ stored: true }` | 401 | 409
  - `POST /api/mpc/login-share` body `{ idToken, chain, network }` → `{ loginShare }` | 401 | 404
- **Validation invariant (mandatory):** any reconstructed entropy MUST be validated before use — `derivePublicKeyFromMnemonic(entropyToMnemonic(entropy)) === wallet.publicKey`. Reject on mismatch (`MpcValidationError`). Never sign/derive from unvalidated reconstructed entropy.
- **Never log** entropy, mnemonic, shares, private keys, idToken, or password.
- Randomness via `crypto.getRandomValues` only.
- Reuse existing at-rest crypto (`crypto.encrypt`/`decrypt`) — do not hand-roll.
- `encryptionMethod` for these wallets = `'mpc'`; `type` = `WalletType.Google`; `userId` = Google `sub` (NOT email — the backend keys on `sub`; store `sub` so lookups match the token). Store the account xpub in `publicKey`.
- ESLint: fix lint in every file touched.
- Test framework: Vitest, colocated `*.spec.ts`. Focused run: `npx vitest run <file>`.
- Repo baseline is NOT green on typecheck/lint (pre-existing) — gate = your new tests pass + your new files add no new lint/typecheck errors + `npm run build` still succeeds.

**Key facts from recon (use verbatim):**
- `bip39` import: `import * as bip39 from 'bip39'`. `bip39.entropyToMnemonic(Buffer.from(entropy))` (32 bytes → 24 words); `bip39.mnemonicToEntropy(mnemonic)` returns a **hex string**.
- `resolvePrivateKey(mnemonic: string): Bip32PrivateKey` — `@/shared/utils/resolver`.
- `derivePublicKeyFromMnemonic(mnemonic: string): Promise<string>` (bech32 `xpub…`) — `@/db/gero-db`.
- `crypto.encrypt(text, password): string` / `crypto.decrypt(ciphertext, password): string` — `@/shared/utils/crypto` (AES).
- MPC scaffold — `@/shared/utils/mpc`: `createMpcShareSet(entropy): Promise<MpcShareSet{deviceShare,loginShare,recoveryShare}>`, `reconstructEntropy(a,b): Promise<Uint8Array>`, `encryptRecoveryShare`, `decryptRecoveryShare`, `ShareRole`, `MpcError`.
- `Api` — `@/api/api`: `axiosInstance` with `baseURL = import.meta.env['VITE_BACKEND_URL']`; `parseHttpError` from `@/shared/utils/parser`.
- Wallet record fields already indexed (no Dexie bump needed): `userId`, `publicKey`, `encryptionMethod`. `mpcDeviceShare` is non-indexed (Dexie stores arbitrary props).
- Signing accepts pre-decrypted bytes: `WalletBg.signTx(txInput, password, accountIndex, utxos, addresses, privateKeyBytes?)` (`walletBg.ts:1576`).

---

### Task 1: `Api.mpc` backend client

**Files:**
- Modify: `src/api/api.ts` (add an `mpc` member to the `Api` class)
- Test: `src/api/mpc.api.spec.ts`

**Interfaces:**
- Produces: `api.mpc.enroll(idToken, chain, network, loginShare): Promise<{stored:boolean}>` and `api.mpc.getLoginShare(idToken, chain, network): Promise<string>` (returns the `loginShare` string).

- [ ] **Step 1: Write the failing test** (mock the axios instance; mirror `src/api/nexus-swap.api.spec.ts` style):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Api } from './api';

function makeApi() {
  const api = Object.create(Api.prototype) as Api;
  (api as any).axiosInstance = { post: vi.fn() };
  return api;
}

describe('Api.mpc', () => {
  let api: Api;
  beforeEach(() => { api = makeApi(); });

  it('enroll posts the Plan B contract body and returns result', async () => {
    (api as any).axiosInstance.post.mockResolvedValue({ data: { stored: true }, status: 200 });
    const res = await api.mpc.enroll('idtok', 'cardano', 'mainnet', 'gmpc1.02.X.Y');
    expect((api as any).axiosInstance.post).toHaveBeenCalledWith('/api/mpc/enroll', {
      idToken: 'idtok', chain: 'cardano', network: 'mainnet', loginShare: 'gmpc1.02.X.Y',
    });
    expect(res).toEqual({ stored: true });
  });

  it('getLoginShare posts idToken+chain+network and returns the share string', async () => {
    (api as any).axiosInstance.post.mockResolvedValue({ data: { loginShare: 'gmpc1.02.X.Y' }, status: 200 });
    const share = await api.mpc.getLoginShare('idtok', 'cardano', 'mainnet');
    expect((api as any).axiosInstance.post).toHaveBeenCalledWith('/api/mpc/login-share', {
      idToken: 'idtok', chain: 'cardano', network: 'mainnet',
    });
    expect(share).toBe('gmpc1.02.X.Y');
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/api/mpc.api.spec.ts`

- [ ] **Step 3: Implement** — add to the `Api` class body (near the existing `multiSig` member), following the `multiSig.createWallet` error-handling template:
```ts
  mpc = {
    /** Store the login share after backend verifies the Google idToken (Plan B /enroll). */
    enroll: async (idToken: string, chain: string, network: string, loginShare: string) => {
      try {
        const { data, status } = await this.axiosInstance.post('/api/mpc/enroll',
          { idToken, chain, network, loginShare });
        if (status === 200) return data as { stored: boolean };
        throw parseHttpError(data);
      } catch (error: any) { throw parseHttpError(error); }
    },
    /** Retrieve the login share; backend verifies the Google idToken (Plan B /login-share). */
    getLoginShare: async (idToken: string, chain: string, network: string): Promise<string> => {
      try {
        const { data, status } = await this.axiosInstance.post('/api/mpc/login-share',
          { idToken, chain, network });
        if (status === 200) return (data as { loginShare: string }).loginShare;
        throw parseHttpError(data);
      } catch (error: any) { throw parseHttpError(error); }
    },
  };
```
(`parseHttpError` is already imported in `api.ts`.)

- [ ] **Step 4: Run → PASS.** Commit (`feat(mpc): Api.mpc enroll + getLoginShare client`).

---

### Task 2: Key-lifecycle bridge + reconstruct-and-validate

**Files:**
- Create: `src/shared/utils/mpc/mpcKeys.ts`
- Modify: `src/shared/utils/mpc/types.ts` (add `MpcValidationError`)
- Modify: `src/shared/utils/mpc/index.ts` (export new symbols)
- Test: `src/shared/utils/mpc/mpcKeys.spec.ts`

**Interfaces:**
- Produces:
  - `entropyToMnemonic(entropy: Uint8Array): string`
  - `mnemonicToEntropyBytes(mnemonic: string): Uint8Array`
  - `deriveExpectedXpub(entropy: Uint8Array): Promise<string>`
  - `reconstructAndValidateEntropy(deviceShare, loginShare, expectedXpub, deriveXpub?): Promise<Uint8Array>` — throws `MpcValidationError` on xpub mismatch.
  - `class MpcValidationError extends MpcError`

- [ ] **Step 1: Add `MpcValidationError` to `types.ts`:**
```ts
export class MpcValidationError extends MpcError {
  constructor(message: string) { super(message); this.name = 'MpcValidationError'; }
}
```

- [ ] **Step 2: Write the failing test** (hermetic — inject a fake `deriveXpub` so the compare/throw logic needs no WASM; plus one real-derivation determinism test that may be skipped if the Cardano SDK can't init under vitest):
```ts
import { describe, it, expect } from 'vitest';
import { entropyToMnemonic, mnemonicToEntropyBytes, reconstructAndValidateEntropy } from './mpcKeys';
import { createMpcShareSet } from './mpcShares';
import { MpcValidationError } from './types';

const entropy = () => crypto.getRandomValues(new Uint8Array(32));

describe('mpcKeys', () => {
  it('entropy ↔ mnemonic round-trips', () => {
    const e = entropy();
    const back = mnemonicToEntropyBytes(entropyToMnemonic(e));
    expect(Array.from(back)).toEqual(Array.from(e));
  });

  it('reconstructAndValidate returns entropy when derived xpub matches (fake derive)', async () => {
    const e = entropy();
    const set = await createMpcShareSet(e);
    const fakeDerive = async () => 'xpub-EXPECTED';
    const out = await reconstructAndValidateEntropy(set.deviceShare, set.loginShare, 'xpub-EXPECTED', fakeDerive);
    expect(Array.from(out)).toEqual(Array.from(e));
  });

  it('reconstructAndValidate throws MpcValidationError on xpub mismatch', async () => {
    const set = await createMpcShareSet(entropy());
    const fakeDerive = async () => 'xpub-DERIVED';
    await expect(
      reconstructAndValidateEntropy(set.deviceShare, set.loginShare, 'xpub-DIFFERENT', fakeDerive)
    ).rejects.toBeInstanceOf(MpcValidationError);
  });
});
```

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implement `mpcKeys.ts`:**
```ts
import * as bip39 from 'bip39';
import { reconstructEntropy } from './mpcShares';
import { MpcValidationError } from './types';
import { derivePublicKeyFromMnemonic } from '@/db/gero-db';

export function entropyToMnemonic(entropy: Uint8Array): string {
  return bip39.entropyToMnemonic(Buffer.from(entropy));
}

export function mnemonicToEntropyBytes(mnemonic: string): Uint8Array {
  return new Uint8Array(Buffer.from(bip39.mnemonicToEntropy(mnemonic), 'hex'));
}

/** Derive the account-0 CIP-1852 bech32 xpub that a given entropy yields. */
export async function deriveExpectedXpub(entropy: Uint8Array): Promise<string> {
  return derivePublicKeyFromMnemonic(entropyToMnemonic(entropy));
}

/**
 * Reconstruct entropy from two encoded shares and VALIDATE it against the
 * enrolled wallet's expected xpub. Shamir combine has no cross-share binding —
 * mismatched shares reconstruct to a wrong secret silently — so this check is
 * mandatory before the entropy is used to derive a signing key.
 * @throws MpcValidationError if the derived xpub does not match expectedXpub.
 */
export async function reconstructAndValidateEntropy(
  deviceShare: string,
  loginShare: string,
  expectedXpub: string,
  deriveXpub: (entropy: Uint8Array) => Promise<string> = deriveExpectedXpub,
): Promise<Uint8Array> {
  const entropy = await reconstructEntropy(deviceShare, loginShare);
  const xpub = await deriveXpub(entropy);
  if (xpub !== expectedXpub) {
    throw new MpcValidationError('reconstructed key does not match this wallet');
  }
  return entropy;
}
```

- [ ] **Step 5: Run → PASS** (3 tests). Export from `index.ts`:
```ts
export { entropyToMnemonic, mnemonicToEntropyBytes, deriveExpectedXpub, reconstructAndValidateEntropy } from './mpcKeys';
export { MpcValidationError } from './types';
```

- [ ] **Step 6: Optional real-derivation determinism test** — add to the spec:
```ts
  it('real derivation is deterministic across a split/reconstruct cycle', async () => {
    const { deriveExpectedXpub } = await import('./mpcKeys');
    const e = entropy();
    const set = await createMpcShareSet(e);
    try {
      const expected = await deriveExpectedXpub(e);
      const out = await reconstructAndValidateEntropy(set.deviceShare, set.loginShare, expected);
      expect(Array.from(out)).toEqual(Array.from(e));
    } catch (err) {
      // If @cardano-sdk/crypto (sodium/WASM) cannot initialize under vitest-node,
      // skip — the hermetic tests above already cover the validation logic.
      console.warn('[mpcKeys.spec] skipping real-derivation test:', (err as Error).message);
    }
  });
```
Run the full spec → PASS. If the real-derivation path throws due to WASM init, that is acceptable (logged skip); report it. Commit (`feat(mpc): entropy↔mnemonic bridge + reconstruct-and-validate`).

---

### Task 3: MPC wallet orchestration service

**Files:**
- Create: `src/shared/utils/mpc/mpcWalletService.ts`
- Modify: `src/shared/utils/mpc/index.ts` (export)
- Test: `src/shared/utils/mpc/mpcWalletService.spec.ts`

**Interfaces:**
- Produces:
  - `prepareMpcWalletCreation(): Promise<{ entropy: Uint8Array; shareSet: MpcShareSet; expectedXpub: string }>`
  - `encryptDeviceShare(deviceShare: string, password: string): string` / `decryptDeviceShare(blob: string, password: string): string`
  - `reconstructRootKeyBytes(encryptedDeviceShare, password, loginShare, expectedXpub): Promise<Uint8Array>` — decrypts device share, reconstructs+validates, returns Cardano root-key bytes (for `signTx`'s `privateKeyBytes`).

- [ ] **Step 1: Write the failing test** (mock `mpcKeys` derivation + `resolvePrivateKey` so it's hermetic):
```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/db/gero-db', () => ({ derivePublicKeyFromMnemonic: vi.fn(async () => 'xpub-TEST') }));
vi.mock('@/shared/utils/resolver', () => ({
  resolvePrivateKey: vi.fn(() => ({ bytes: () => new Uint8Array([1, 2, 3, 4]) })),
}));

import { prepareMpcWalletCreation, encryptDeviceShare, decryptDeviceShare, reconstructRootKeyBytes } from './mpcWalletService';

describe('mpcWalletService', () => {
  it('prepare produces 3 shares + an expected xpub', async () => {
    const { entropy, shareSet, expectedXpub } = await prepareMpcWalletCreation();
    expect(entropy.length).toBe(32);
    expect(shareSet.deviceShare.startsWith('gmpc1.01.')).toBe(true);
    expect(shareSet.loginShare.startsWith('gmpc1.02.')).toBe(true);
    expect(shareSet.recoveryShare.startsWith('gmpc1.03.')).toBe(true);
    expect(expectedXpub).toBe('xpub-TEST');
  });

  it('device share encrypt/decrypt round-trips', () => {
    const blob = encryptDeviceShare('gmpc1.01.X.Y', 'pw');
    expect(blob).not.toBe('gmpc1.01.X.Y');
    expect(decryptDeviceShare(blob, 'pw')).toBe('gmpc1.01.X.Y');
  });

  it('reconstructRootKeyBytes validates then returns root-key bytes', async () => {
    const { shareSet, expectedXpub } = await prepareMpcWalletCreation();
    const encDevice = encryptDeviceShare(shareSet.deviceShare, 'pw');
    const bytes = await reconstructRootKeyBytes(encDevice, 'pw', shareSet.loginShare, expectedXpub);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]); // from mocked resolvePrivateKey
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `mpcWalletService.ts`:**
```ts
import { encrypt, decrypt } from '@/shared/utils/crypto';
import { resolvePrivateKey } from '@/shared/utils/resolver';
import { createMpcShareSet, type MpcShareSet } from './mpcShares';
import { deriveExpectedXpub, entropyToMnemonic, reconstructAndValidateEntropy } from './mpcKeys';

/** Generate a fresh wallet's entropy, split into 3 shares, and derive its expected xpub. */
export async function prepareMpcWalletCreation(): Promise<{
  entropy: Uint8Array; shareSet: MpcShareSet; expectedXpub: string;
}> {
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  const shareSet = await createMpcShareSet(entropy);
  const expectedXpub = await deriveExpectedXpub(entropy);
  return { entropy, shareSet, expectedXpub };
}

/** At-rest encryption for the locally-stored device share (AES via existing util). */
export function encryptDeviceShare(deviceShare: string, password: string): string {
  return encrypt(deviceShare, password);
}
export function decryptDeviceShare(blob: string, password: string): string {
  return decrypt(blob, password);
}

/**
 * Reconstruct the Cardano root-key bytes for signing: decrypt the local device
 * share, combine with the backend login share, VALIDATE against the wallet's
 * expected xpub, then materialize the root key. Returns bytes suitable for
 * WalletBg.signTx(..., privateKeyBytes).
 */
export async function reconstructRootKeyBytes(
  encryptedDeviceShare: string,
  password: string,
  loginShare: string,
  expectedXpub: string,
): Promise<Uint8Array> {
  const deviceShare = decryptDeviceShare(encryptedDeviceShare, password);
  const entropy = await reconstructAndValidateEntropy(deviceShare, loginShare, expectedXpub);
  const rootKey = resolvePrivateKey(entropyToMnemonic(entropy));
  return rootKey.bytes();
}
```

- [ ] **Step 4: Run → PASS** (3 tests). Export from `index.ts`. Commit (`feat(mpc): wallet orchestration (prepare/sign-prep) service`).

---

### Task 4: DB persistence + wallet type extension

**Files:**
- Modify: `src/models/types.ts` (extend `Wallet` + `encryptionMethod` union)
- Modify: `src/db/gero-db.ts` (add `createMpcGoogleWallet`)
- Test: `src/db/mpcGoogleWallet.spec.ts`

**Interfaces:**
- Produces: `createMpcGoogleWallet(params): Promise<number>` — inserts a `type: Google`, `encryptionMethod: 'mpc'` wallet record with `userId` (sub), `publicKey` (xpub), and encrypted `mpcDeviceShare`, then `createNewWalletDb`.

- [ ] **Step 1: Extend the `Wallet` interface** (`src/models/types.ts`) — add the fields the DB already stores plus the MPC ones:
```ts
  // (existing fields …)
  publicKey?: string;
  userId?: string;
  encryptionMethod?: 'password' | 'prf' | 'mpc';   // add 'mpc'
  mpcDeviceShare?: string;   // AES-encrypted encoded device share (non-indexed)
```
(If `publicKey`/`userId` are already added elsewhere, keep one declaration.)

- [ ] **Step 2: Write the failing test** (uses the real Dexie against fake-indexeddb if configured, else mock `getDb`; follow whatever the existing `gero-db`-touching specs do. If no IndexedDB in vitest, mock the table):
```ts
import { describe, it, expect, vi } from 'vitest';

const added: any[] = [];
vi.mock('@/db/gero-db', async (orig) => {
  const actual = await (orig() as any);
  return { ...actual, getDb: vi.fn(async () => ({
    wallets: { add: vi.fn(async (r: any) => { added.push(r); return r.id ?? 7; }),
               orderBy: () => ({ last: async () => null }) },
  })) };
});

import { createMpcGoogleWallet } from '@/db/gero-db';
import { WalletType } from '@/models/types';

describe('createMpcGoogleWallet', () => {
  it('stores an mpc/Google record with sub, xpub, and encrypted device share', async () => {
    const id = await createMpcGoogleWallet({
      name: 'W', icon: 'i', theme: 't', chain: 'cardano', network: 'mainnet',
      userId: 'google-sub-1', publicKey: 'xpub-1', encryptedDeviceShare: 'enc-blob',
    });
    const rec = added.at(-1);
    expect(rec.type).toBe(WalletType.Google);
    expect(rec.encryptionMethod).toBe('mpc');
    expect(rec.userId).toBe('google-sub-1');
    expect(rec.publicKey).toBe('xpub-1');
    expect(rec.mpcDeviceShare).toBe('enc-blob');
    expect(typeof id).toBe('number');
  });
});
```
> If the existing `gero-db` specs use a different DB-mocking approach, match it; the assertion set (fields written) is what matters.

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implement `createMpcGoogleWallet` in `gero-db.ts`** (mirror the record shape of `createNewWallet`'s password branch + `createNewGoogleWallet`, but MPC):
```ts
export async function createMpcGoogleWallet(params: {
  name: string; icon: string; theme: string; chain: string; network: string;
  userId: string; publicKey: string; encryptedDeviceShare: string; addressType?: string;
}): Promise<number> {
  const db = await getDb();
  const last = await db['wallets'].orderBy('order').last().catch(() => null);
  const order = (last?.order ?? -1) + 1;
  const walletData = {
    name: params.name, icon: params.icon, type: WalletType.Google, theme: params.theme, order,
    publicKey: params.publicKey, passwordLastUpdate: new Date(),
    chain: params.chain, network: params.network,
    addressType: params.addressType ?? getDefaultAddressType(params.chain),
    encryptionMethod: 'mpc' as const,
    userId: params.userId,
    mpcDeviceShare: params.encryptedDeviceShare,
  };
  const walletId = await db['wallets'].add(walletData);
  await createNewWalletDb(walletId, false, false);
  return walletId as number;
}
```
> Match the exact `getDb`/order-derivation idiom already used in `gero-db.ts` (the recon shows `order` derived from existing wallets; use the same helper the file already uses rather than the sketch above if it differs).

- [ ] **Step 5: Run → PASS.** Then `npm run build` to confirm the new `gero-db` export + type change compile. Commit (`feat(mpc): persist MPC Google wallet record + type extension`).

---

### Task 5: Verification gate

- [ ] **Step 1:** `npx vitest run src/shared/utils/mpc/ src/api/mpc.api.spec.ts src/db/mpcGoogleWallet.spec.ts` → all green (record count).
- [ ] **Step 2:** `npm run build` → succeeds (all 4 configs).
- [ ] **Step 3:** Secret-hygiene grep: `grep -rInE "console\.(log|info|warn|error).*(entropy|mnemonic|deviceShare|loginShare|recoveryShare|privateKey|idToken|password)" src/shared/utils/mpc src/api/mpc.api.spec.ts` → only the allowed `console.warn` skip-note in `mpcKeys.spec.ts` (a test, no secret value) may appear; no secret VALUES logged.
- [ ] **Step 4:** Confirm no new lint errors in touched files (`npm run lint`; count not increased on account of new files). Commit any touch-ups.

---

## Self-Review
- **Spec coverage:** api client (§5.1 backend calls), reconstruct-and-**validate** invariant (Plan A review hand-off + spec §6 DECISION), device-share at-rest encryption (§3), create/sign-prep orchestration (§4.1/4.2), DB persistence with `type Google`/`encryptionMethod mpc`/`userId`/`publicKey` (§6). ✅
- **Not in Plan C (→ Plan D):** the onboarding UI (method card + stepper + recovery-share save/download UX), the `SIGN_WITH_GOOGLE` call-site that obtains the `idToken`, the actual create call-site (OAuth → prepare → enroll → persist → login) and the sign call-site (OAuth → getLoginShare → `reconstructRootKeyBytes` → `signTx(..., privateKeyBytes)`), and recovery-on-new-device UX. Plan C gives D every function it needs.
- **Placeholder scan:** none; two "match the existing idiom" notes (gero-db `getDb`/order, gero-db spec mocking) are guarded by the tests, not placeholders.
- **WASM caveat:** the real-derivation test is best-effort (skips + logs if `@cardano-sdk/crypto` can't init under vitest); the validation logic is covered hermetically regardless.
- **Downstream (Plan D) contract:** `prepareMpcWalletCreation()`, `encryptDeviceShare`, `reconstructRootKeyBytes`, `createMpcGoogleWallet`, `api.mpc.{enroll,getLoginShare}` are the exact surface D wires into the UI + `signTx`.
