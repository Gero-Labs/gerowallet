# MPC passkey unlock + Argon2id recovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the MPC wallet's typed spending password with a WebAuthn passkey (PRF) for device-share encryption — keeping a spending-password fallback for devices without a platform authenticator — and upgrade the recovery-file KDF from PBKDF2 to Argon2id.

**Architecture:** The device share is encrypted at rest under a key derived from the passkey's PRF output (AES-GCM), or under the spending password (fallback). Both are stored in one tagged envelope (`prf.v1:` / `pw.v1:`). WebAuthn only runs in the DOM, so the frontend does the passkey prompt and passes the raw PRF output (hex) to the background service worker, which does the crypto — mirroring the existing PRF-wallet split (`webauthn-prf.ts` `decryptMnemonicWithPrfOutput`). The non-custodial 2-of-3 topology, the backend, and the `reconstructAndValidateEntropy` guard are unchanged.

**Tech Stack:** TypeScript, Vue 2.7, Vitest, `@noble/hashes` (argon2id, pbkdf2, sha2), `@noble/ciphers` (xchacha20poly1305), WebCrypto (`crypto.subtle` HKDF + AES-GCM), Dexie, Chrome MV3 messaging.

## Global Constraints

- **Non-custodial invariant:** backend holds exactly 1 of 3 shares; never change the topology, the backend, or Google OAuth.
- **Secret hygiene:** never log `idToken`, `spendingPassword`, `prfOutput`, recovery passphrase, device/login/recovery shares, entropy, or key bytes.
- **`reconstructAndValidateEntropy` (`mpcKeys.ts:34`) stays** on every unlock/recover; the cross-share negative tests (`mpcKeys.spec.ts`) stay green.
- **No DB migration:** MPC is testnet-only, flag-dark, unreleased. New wallet-record properties are **non-indexed** (Dexie stores extra props without a schema bump).
- **WebAuthn is DOM-only:** never call `navigator.credentials` from `src/chrome/` (background). PRF output crosses the wire as a **hex string**.
- **i18n:** all user-facing text via `$t()`; add keys to `us.ts` AND `de.ts` in sync.
- **ESLint:** resolve all lint in every file touched.
- **PRF salt identifier:** a client-generated UUID `mpcPrfSaltId`, stored on the wallet record, is the stable `walletId`-arg passed to `registerWebAuthnCredentialWithPrf`/`evaluatePrfForWallet` (unique WebAuthn `user.id` + stable PRF salt across create/unlock).

---

## File Structure

- Create `src/shared/utils/mpc/deviceShareCipher.ts` — tagged device-share envelope; password + PRF-output crypto paths. **One responsibility: encrypt/decrypt the device share.**
- Create `src/shared/utils/mpc/deviceShareCipher.spec.ts` — codec + both paths (PRF output injected, no WebAuthn).
- Create `src/shared/utils/mpc/mpcPasskey.ts` — thin frontend wrapper over `webauthn-prf.ts` for MPC (generate saltId, register, evaluate → hex). DOM-only.
- Modify `src/shared/utils/mpc/recoveryShare.ts` — Argon2id v2 blob, v1 decrypt kept.
- Modify `src/shared/utils/mpc/mpcWalletService.ts` — `encrypt/decryptDeviceShare` + `reconstructRootKeyBytes` take a `DeviceShareSecret`.
- Modify `src/shared/utils/mpc/index.ts` — export the new module + types.
- Modify `src/chrome/mpcWalletHandlers.ts` — flows accept `DeviceShareSecret`, persist `webAuthnCredentialId` + `mpcPrfSaltId`.
- Modify `src/db/gero-db.ts` — `createMpcGoogleWallet` params + record shape gain the two optional fields; `getWallet` returns them.
- Modify `src/chrome/background.ts` — CREATE/UNLOCK/RECOVER handlers parse prf-vs-password, hex-decode `prfOutput`, build the secret.
- Modify `src/models/types.ts` — `mpcPrfSaltId?: string` on the wallet type.
- Modify `src/modules/welcome/components/WalletOnboarding/steps/StepGoogleSecure.vue` — passkey-first, password fallback.
- Modify `.../steps/StepGoogleConfirm.vue` — send prf-or-password payload.
- Modify `.../steps/StepGoogleRestore.vue` — re-enroll passkey on restore.
- Modify `src/modules/dashboard/dialogs/UnlockWalletDialog.vue` + `src/sidepanel/components/LockScreen.vue` — MPC unlock: passkey vs password.
- Modify `src/plugins/i18n/us.ts`, `src/plugins/i18n/de.ts` — new strings.

---

## Task 1: Argon2id recovery KDF (v2 blob, v1 back-compat)

**Files:**
- Modify: `src/shared/utils/mpc/recoveryShare.ts`
- Test: `src/shared/utils/mpc/recoveryShare.spec.ts`

**Interfaces:**
- Consumes: `@noble/hashes/argon2.js` (`argon2id`), `@noble/hashes/pbkdf2.js`, `@noble/ciphers/chacha.js`.
- Produces: unchanged public signatures `encryptRecoveryShare(share, password): Promise<string>`, `decryptRecoveryShare(blob, password): Promise<string>` — now writing v2 (Argon2id) and reading v1+v2.

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/utils/mpc/recoveryShare.spec.ts` (create the file if absent, importing the two functions and `RecoveryDecryptError` from `./types`):

```ts
import { describe, it, expect } from 'vitest';
import { encryptRecoveryShare, decryptRecoveryShare } from './recoveryShare';
import { RecoveryDecryptError } from './types';

describe('recoveryShare — Argon2id v2', () => {
  it('round-trips an encrypted share', async () => {
    const blob = await encryptRecoveryShare('device-share-abc', 'correct horse battery');
    expect(blob.startsWith('gmpc-recovery1.')).toBe(true);
    const out = await decryptRecoveryShare(blob, 'correct horse battery');
    expect(out).toBe('device-share-abc');
  });

  it('rejects a wrong passphrase', async () => {
    const blob = await encryptRecoveryShare('device-share-abc', 'right-pass');
    await expect(decryptRecoveryShare(blob, 'wrong-pass')).rejects.toBeInstanceOf(RecoveryDecryptError);
  });

  it('writes a v2 (Argon2id) header', async () => {
    const blob = await encryptRecoveryShare('x', 'p');
    // decode base64url body, first byte is version
    const { fromB64url } = await import('./base64url');
    const raw = fromB64url(blob.split('.')[1]);
    expect(raw[0]).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/shared/utils/mpc/recoveryShare.spec.ts`
Expected: FAIL — current blob writes version byte `1`, so the "writes a v2 header" test fails (and round-trip still passes on v1).

- [ ] **Step 3: Implement Argon2id v2 + v1-compat decrypt**

Replace the body of `src/shared/utils/mpc/recoveryShare.ts` with:

```ts
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { argon2id } from '@noble/hashes/argon2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { toB64url, fromB64url } from './base64url';
import { RecoveryDecryptError } from './types';

const BLOB_PREFIX = 'gmpc-recovery1';
const SALT_LEN = 16;
const NONCE_LEN = 24;

// v1 (legacy, decrypt-only): version | iter(BE32) | salt(16) | nonce(24)
const V1 = 1;
const V1_PBKDF2_ITERATIONS = 210_000;
const V1_HEADER_LEN = 1 + 4 + SALT_LEN + NONCE_LEN; // 45

// v2 (current): version | t(BE32) | m(BE32) | p(BE32) | salt(16) | nonce(24)
const V2 = 2;
// OWASP-recommended Argon2id baseline, extension-friendly. Pinned in the header
// so future tuning stays decryptable.
const V2_ARGON = { t: 2, m: 19_456 /* KiB = 19 MiB */, p: 1 };
const V2_HEADER_LEN = 1 + 4 + 4 + 4 + SALT_LEN + NONCE_LEN; // 53

function v1Key(password: string, salt: Uint8Array, iterations: number): Uint8Array {
  return pbkdf2(sha256, password, salt, { c: iterations, dkLen: 32 });
}
function v2Key(password: string, salt: Uint8Array, t: number, m: number, p: number): Uint8Array {
  return argon2id(password, salt, { t, m, p, dkLen: 32 });
}

/** Encrypt an encoded recovery share under a user passphrase (Argon2id v2). Safe to download. */
export async function encryptRecoveryShare(encodedShare: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const { t, m, p } = V2_ARGON;
  const key = v2Key(password, salt, t, m, p);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(encodedShare));

  const blob = new Uint8Array(V2_HEADER_LEN + ciphertext.length);
  const view = new DataView(blob.buffer);
  blob[0] = V2;
  view.setUint32(1, t, false);
  view.setUint32(5, m, false);
  view.setUint32(9, p, false);
  blob.set(salt, 13);
  blob.set(nonce, 13 + SALT_LEN);
  blob.set(ciphertext, V2_HEADER_LEN);
  return `${BLOB_PREFIX}.${toB64url(blob)}`;
}

/** Decrypt a recovery-share blob (v2 Argon2id or v1 PBKDF2). Throws RecoveryDecryptError. */
export async function decryptRecoveryShare(blob: string, password: string): Promise<string> {
  const parts = blob.split('.');
  if (parts.length !== 2 || parts[0] !== BLOB_PREFIX) {
    throw new RecoveryDecryptError('invalid recovery backup format');
  }
  let raw: Uint8Array;
  try {
    raw = fromB64url(parts[1]);
  } catch {
    throw new RecoveryDecryptError('invalid recovery backup encoding');
  }
  const version = raw[0];
  let key: Uint8Array;
  let nonce: Uint8Array;
  let ciphertext: Uint8Array;

  if (version === V2) {
    if (raw.length < V2_HEADER_LEN) throw new RecoveryDecryptError('unsupported recovery backup version');
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const t = view.getUint32(1, false);
    const m = view.getUint32(5, false);
    const p = view.getUint32(9, false);
    const salt = raw.slice(13, 13 + SALT_LEN);
    nonce = raw.slice(13 + SALT_LEN, V2_HEADER_LEN);
    ciphertext = raw.slice(V2_HEADER_LEN);
    key = v2Key(password, salt, t, m, p);
  } else if (version === V1) {
    if (raw.length < V1_HEADER_LEN) throw new RecoveryDecryptError('unsupported recovery backup version');
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const iterations = view.getUint32(1, false);
    const salt = raw.slice(5, 5 + SALT_LEN);
    nonce = raw.slice(5 + SALT_LEN, V1_HEADER_LEN);
    ciphertext = raw.slice(V1_HEADER_LEN);
    key = v1Key(password, salt, iterations);
  } else {
    throw new RecoveryDecryptError('unsupported recovery backup version');
  }

  try {
    const plaintext = xchacha20poly1305(key, nonce).decrypt(ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new RecoveryDecryptError('wrong password or corrupted recovery backup');
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/shared/utils/mpc/recoveryShare.spec.ts`
Expected: PASS (round-trip, wrong-passphrase reject, v2 header).

- [ ] **Step 5: Commit**

```bash
git add src/shared/utils/mpc/recoveryShare.ts src/shared/utils/mpc/recoveryShare.spec.ts
git commit -m "feat(mpc): Argon2id recovery-file KDF (v2 blob, v1 decrypt kept)"
```

---

## Task 2: Device-share cipher module (envelope + password + PRF-output paths)

**Files:**
- Create: `src/shared/utils/mpc/deviceShareCipher.ts`
- Test: `src/shared/utils/mpc/deviceShareCipher.spec.ts`
- Modify: `src/shared/utils/mpc/index.ts` (export)

**Interfaces:**
- Consumes: `encrypt`/`decrypt` from `@/shared/utils/crypto` (`(text|ciphertext, password) => string`).
- Produces:
  - `type DeviceShareSecret = { kind: 'password'; password: string } | { kind: 'prf'; prfOutput: Uint8Array; credentialId: string; saltId: string }`
  - `encryptDeviceShare(deviceShare: string, secret: DeviceShareSecret): Promise<string>` → tagged envelope
  - `decryptDeviceShare(envelope: string, secret: DeviceShareSecret): Promise<string>`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/utils/mpc/deviceShareCipher.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encryptDeviceShare, decryptDeviceShare, type DeviceShareSecret } from './deviceShareCipher';

const prf = (bytes = 7): DeviceShareSecret => ({
  kind: 'prf',
  prfOutput: new Uint8Array(32).fill(bytes),
  credentialId: 'cred-AAAA',
  saltId: 'salt-1234',
});

describe('deviceShareCipher', () => {
  it('password path round-trips under a pw.v1 tag', async () => {
    const secret: DeviceShareSecret = { kind: 'password', password: 'pw' };
    const env = await encryptDeviceShare('share-xyz', secret);
    expect(env.startsWith('pw.v1:')).toBe(true);
    expect(await decryptDeviceShare(env, secret)).toBe('share-xyz');
  });

  it('prf path round-trips under a prf.v1 tag (injected output, no WebAuthn)', async () => {
    const secret = prf();
    const env = await encryptDeviceShare('share-xyz', secret);
    expect(env.startsWith('prf.v1:')).toBe(true);
    expect(await decryptDeviceShare(env, secret)).toBe('share-xyz');
  });

  it('prf path rejects a different PRF output', async () => {
    const env = await encryptDeviceShare('share-xyz', prf(7));
    await expect(decryptDeviceShare(env, prf(9))).rejects.toBeTruthy();
  });

  it('prf path rejects a different credentialId (AAD binding)', async () => {
    const env = await encryptDeviceShare('share-xyz', prf(7));
    const wrongCred: DeviceShareSecret = { ...prf(7), credentialId: 'cred-BBBB' };
    await expect(decryptDeviceShare(env, wrongCred)).rejects.toBeTruthy();
  });

  it('decrypts a legacy untagged blob as password', async () => {
    const { encrypt } = await import('@/shared/utils/crypto');
    const legacy = encrypt('share-legacy', 'pw');
    expect(await decryptDeviceShare(legacy, { kind: 'password', password: 'pw' })).toBe('share-legacy');
  });

  it('rejects an unknown tag', async () => {
    await expect(decryptDeviceShare('bogus.v9:zzz', { kind: 'password', password: 'pw' })).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/shared/utils/mpc/deviceShareCipher.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the cipher**

Create `src/shared/utils/mpc/deviceShareCipher.ts`:

```ts
import { Buffer } from 'buffer';
import { encrypt as pwEncrypt, decrypt as pwDecrypt } from '@/shared/utils/crypto';

const PW_TAG = 'pw.v1';
const PRF_TAG = 'prf.v1';

export type DeviceShareSecret =
  | { kind: 'password'; password: string }
  | { kind: 'prf'; prfOutput: Uint8Array; credentialId: string; saltId: string };

/** HKDF(prfOutput) -> non-extractable AES-GCM-256, domain-separated for MPC device shares. */
async function prfAesKey(prfOutput: Uint8Array, saltId: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    prfOutput as Uint8Array<ArrayBuffer>,
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new Uint8Array(),
      hash: 'SHA-512',
      info: new TextEncoder().encode(`gero-mpc-deviceshare-encryption-v1:${saltId}`),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptDeviceShare(deviceShare: string, secret: DeviceShareSecret): Promise<string> {
  if (secret.kind === 'password') {
    return `${PW_TAG}:${pwEncrypt(deviceShare, secret.password)}`;
  }
  const key = await prfAesKey(secret.prfOutput, secret.saltId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(secret.credentialId) },
    key,
    new TextEncoder().encode(deviceShare),
  );
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), iv.length);
  return `${PRF_TAG}:${Buffer.from(out).toString('hex')}`;
}

export async function decryptDeviceShare(envelope: string, secret: DeviceShareSecret): Promise<string> {
  const sep = envelope.indexOf(':');
  const tag = sep > 0 ? envelope.slice(0, sep) : '';
  const body = sep > 0 ? envelope.slice(sep + 1) : envelope;

  if (tag === PRF_TAG) {
    if (secret.kind !== 'prf') throw new Error('PRF device share requires a passkey');
    const raw = Buffer.from(body, 'hex');
    const iv = raw.subarray(0, 12);
    const ct = raw.subarray(12);
    const key = await prfAesKey(secret.prfOutput, secret.saltId);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(secret.credentialId) },
      key,
      ct,
    );
    return new TextDecoder().decode(pt);
  }

  // pw.v1 tag, or a legacy untagged blob — both are password AEAD from crypto.decrypt.
  if (tag === PW_TAG || sep < 0) {
    if (secret.kind !== 'password') throw new Error('Password device share requires a spending password');
    return pwDecrypt(body, secret.password);
  }

  throw new Error(`Unknown device-share envelope tag: ${tag}`);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/shared/utils/mpc/deviceShareCipher.spec.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Export from the barrel**

In `src/shared/utils/mpc/index.ts` add:

```ts
export { encryptDeviceShare, decryptDeviceShare } from './deviceShareCipher';
export type { DeviceShareSecret } from './deviceShareCipher';
```

Remove any prior `export ... encryptDeviceShare/decryptDeviceShare from './mpcWalletService'` line (they move here — Task 3 stops exporting them from the service).

- [ ] **Step 6: Commit**

```bash
git add src/shared/utils/mpc/deviceShareCipher.ts src/shared/utils/mpc/deviceShareCipher.spec.ts src/shared/utils/mpc/index.ts
git commit -m "feat(mpc): tagged device-share cipher (passkey PRF + password paths)"
```

---

## Task 3: mpcWalletService uses DeviceShareSecret

**Files:**
- Modify: `src/shared/utils/mpc/mpcWalletService.ts`
- Test: `src/shared/utils/mpc/mpcWalletService.spec.ts`

**Interfaces:**
- Consumes: `DeviceShareSecret`, `encryptDeviceShare`, `decryptDeviceShare` from `./deviceShareCipher`.
- Produces: `reconstructRootKeyBytes(encryptedDeviceShare: string, secret: DeviceShareSecret, loginShare: string, expectedXpub: string): Promise<Uint8Array>`. (`encryptDeviceShare`/`decryptDeviceShare` are no longer defined here — they live in `deviceShareCipher`.)

- [ ] **Step 1: Update the existing spec**

In `src/shared/utils/mpc/mpcWalletService.spec.ts`, change any call that passes a password string to `reconstructRootKeyBytes(...)` or the removed `encrypt/decryptDeviceShare` so it uses the secret union. Add/adjust:

```ts
import { reconstructRootKeyBytes } from './mpcWalletService';
import { encryptDeviceShare, type DeviceShareSecret } from './deviceShareCipher';
import { createMpcShareSet } from './mpcShares';
import { deriveExpectedXpub } from './mpcKeys';

it('reconstructs+validates root key from a password-encrypted device share', async () => {
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  const set = await createMpcShareSet(entropy);
  const expectedXpub = await deriveExpectedXpub(entropy);
  const secret: DeviceShareSecret = { kind: 'password', password: 'pw' };
  const enc = await encryptDeviceShare(set.deviceShare, secret);
  const bytes = await reconstructRootKeyBytes(enc, secret, set.loginShare, expectedXpub);
  expect(bytes.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/shared/utils/mpc/mpcWalletService.spec.ts`
Expected: FAIL — `reconstructRootKeyBytes` still takes a `password: string` and calls the removed local `decryptDeviceShare`.

- [ ] **Step 3: Rewrite the service**

Replace `src/shared/utils/mpc/mpcWalletService.ts` with:

```ts
import { resolvePrivateKey } from '@/shared/utils/resolver';
import { createMpcShareSet, type MpcShareSet } from './mpcShares';
import { deriveExpectedXpub, entropyToMnemonic, reconstructAndValidateEntropy } from './mpcKeys';
import { decryptDeviceShare, type DeviceShareSecret } from './deviceShareCipher';

/** Generate a fresh wallet's entropy, split into 3 shares, and derive its expected xpub. */
export async function prepareMpcWalletCreation(): Promise<{
  entropy: Uint8Array; shareSet: MpcShareSet; expectedXpub: string;
}> {
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  const shareSet = await createMpcShareSet(entropy);
  const expectedXpub = await deriveExpectedXpub(entropy);
  return { entropy, shareSet, expectedXpub };
}

/**
 * Reconstruct the Cardano root-key bytes for signing: decrypt the local device
 * share (passkey PRF or password), combine with the backend login share,
 * VALIDATE against the wallet's expected xpub, then materialize the root key.
 */
export async function reconstructRootKeyBytes(
  encryptedDeviceShare: string,
  secret: DeviceShareSecret,
  loginShare: string,
  expectedXpub: string,
): Promise<Uint8Array> {
  const deviceShare = await decryptDeviceShare(encryptedDeviceShare, secret);
  const entropy = await reconstructAndValidateEntropy(deviceShare, loginShare, expectedXpub);
  const rootKey = resolvePrivateKey(entropyToMnemonic(entropy));
  return rootKey.bytes();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/shared/utils/mpc/mpcWalletService.spec.ts src/shared/utils/mpc/mpcKeys.spec.ts`
Expected: PASS (service + invariant tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/utils/mpc/mpcWalletService.ts src/shared/utils/mpc/mpcWalletService.spec.ts
git commit -m "refactor(mpc): reconstructRootKeyBytes takes a DeviceShareSecret"
```

---

## Task 4: Handler flows accept DeviceShareSecret + persist credential/salt

**Files:**
- Modify: `src/chrome/mpcWalletHandlers.ts`
- Test: `src/chrome/mpcWalletHandlers.spec.ts`

**Interfaces:**
- Consumes: `DeviceShareSecret` from `@/shared/utils/mpc`.
- Produces (changed):
  - `CreateMpcGoogleWalletInput` replaces `spendingPassword: string` with `secret: DeviceShareSecret` and adds `webAuthnCredentialId?: string; mpcPrfSaltId?: string`.
  - `CreateMpcGoogleWalletDeps.encryptDeviceShare: (share: string, secret: DeviceShareSecret) => Promise<string>`; `createMpcGoogleWallet` params gain `webAuthnCredentialId?: string; mpcPrfSaltId?: string`.
  - `UnlockMpcWalletInput` replaces `spendingPassword` with `secret: DeviceShareSecret`; `MpcWalletRecord` gains `webAuthnCredentialId?: string; mpcPrfSaltId?: string`; `UnlockMpcWalletDeps.reconstructRootKeyBytes(enc, secret, loginShare, expectedXpub)`.
  - `RecoverMpcGoogleWalletInput` replaces `newSpendingPassword` with `newSecret: DeviceShareSecret` and adds `webAuthnCredentialId?: string; mpcPrfSaltId?: string`.

- [ ] **Step 1: Update handler specs**

In `src/chrome/mpcWalletHandlers.spec.ts`, replace `spendingPassword`/`newSpendingPassword` inputs with a secret, and make `encryptDeviceShare` stubs async. Example edits (apply the same shape to create/unlock/recover blocks):

```ts
const secret = { kind: 'password', password: 'pw' } as const;

// create
const deps = {
  prepareMpcWalletCreation: async () => ({ entropy: new Uint8Array(32), shareSet, expectedXpub: 'xpubA' }),
  encryptDeviceShare: async (s: string) => `pw.v1:${s}`,        // async now
  enrollLoginShare: async () => ({ stored: true }),
  createMpcGoogleWallet: async (p: any) => { captured = p; return 1; },
  subFromIdToken: () => 'sub-1',
};
await createMpcGoogleWalletFlow(
  { name:'n', icon:'i', theme:'t', chain:'cardano', network:'testnet', idToken:'a.b.c', secret,
    webAuthnCredentialId: 'cred-1', mpcPrfSaltId: 'salt-1' },
  deps,
);
expect(captured.webAuthnCredentialId).toBe('cred-1');
expect(captured.mpcPrfSaltId).toBe('salt-1');

// unlock
const unlockDeps = {
  getWallet: async () => ({ chain:'cardano', network:'testnet', publicKey:'xpubA', mpcDeviceShare:'pw.v1:enc',
                            webAuthnCredentialId:'cred-1', mpcPrfSaltId:'salt-1' }),
  getLoginShare: async () => 'login',
  reconstructRootKeyBytes: async (_enc:string, sec:any) => { seenSecret = sec; return new Uint8Array([1]); },
  sessionCache: { set: (_id:number,_b:Uint8Array)=>{ cached = true; } },
};
await unlockMpcWalletFlow({ walletId: 1, idToken:'a.b.c', secret }, unlockDeps);
expect(seenSecret).toEqual(secret);
```

Keep the existing MpcValidationError-mapping test; only the input field name changes.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/chrome/mpcWalletHandlers.spec.ts`
Expected: FAIL — inputs/deps signatures don't match.

- [ ] **Step 3: Implement the handler changes**

In `src/chrome/mpcWalletHandlers.ts`:

1. Add the import: `import type { DeviceShareSecret } from '@/shared/utils/mpc';`
2. `CreateMpcGoogleWalletInput`: replace `spendingPassword: string;` with:
```ts
  secret: DeviceShareSecret;
  /** Present when secret.kind === 'prf'; persisted so unlock can re-derive. */
  webAuthnCredentialId?: string;
  mpcPrfSaltId?: string;
```
3. `CreateMpcGoogleWalletDeps.encryptDeviceShare`: change to `(deviceShare: string, secret: DeviceShareSecret) => Promise<string>;` and extend `createMpcGoogleWallet` params with `webAuthnCredentialId?: string; mpcPrfSaltId?: string;`.
4. `createMpcGoogleWalletFlow` body:
```ts
  const { name, icon, theme, chain, network, idToken, secret, webAuthnCredentialId, mpcPrfSaltId } = input;
  const { prepareMpcWalletCreation, encryptDeviceShare, enrollLoginShare, createMpcGoogleWallet, subFromIdToken: getSub } = deps;

  const { shareSet, expectedXpub } = await prepareMpcWalletCreation();
  const encryptedDeviceShare = await encryptDeviceShare(shareSet.deviceShare, secret);
  await enrollLoginShare(idToken, chain, network, shareSet.loginShare);
  const userId = getSub(idToken);

  const walletId = await createMpcGoogleWallet({
    name, icon, theme, chain, network, userId,
    publicKey: expectedXpub, encryptedDeviceShare, webAuthnCredentialId, mpcPrfSaltId,
  });
  return { walletId, recoveryShare: shareSet.recoveryShare, publicKey: expectedXpub };
```
5. `MpcWalletRecord`: add `webAuthnCredentialId?: string; mpcPrfSaltId?: string;`.
6. `UnlockMpcWalletInput`: replace `spendingPassword: string;` with `secret: DeviceShareSecret;`.
7. `UnlockMpcWalletDeps.reconstructRootKeyBytes`: change signature to `(encryptedDeviceShare: string, secret: DeviceShareSecret, loginShare: string, expectedXpub: string) => Promise<Uint8Array>`.
8. `unlockMpcWalletFlow` body: destructure `secret` instead of `spendingPassword`; call `reconstructRootKeyBytes(wallet.mpcDeviceShare, secret, loginShare, wallet.publicKey)`.
9. `RecoverMpcGoogleWalletInput`: replace `newSpendingPassword: string;` with `newSecret: DeviceShareSecret;` and add `webAuthnCredentialId?: string; mpcPrfSaltId?: string;`.
10. `RecoverMpcGoogleWalletDeps.encryptDeviceShare`: `(deviceShare: string, secret: DeviceShareSecret) => Promise<string>;`; extend its `createMpcGoogleWallet` params with the two optional fields.
11. `recoverMpcGoogleWalletFlow` body: destructure `newSecret, webAuthnCredentialId, mpcPrfSaltId`; `const encryptedDeviceShare = await encryptDeviceShare(recoveryShare, newSecret);` and pass `webAuthnCredentialId, mpcPrfSaltId` into `createMpcGoogleWallet({...})`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/chrome/mpcWalletHandlers.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chrome/mpcWalletHandlers.ts src/chrome/mpcWalletHandlers.spec.ts
git commit -m "feat(mpc): flows accept DeviceShareSecret; persist credential + salt id"
```

---

## Task 5: DB layer — persist + return credential/salt fields

**Files:**
- Modify: `src/db/gero-db.ts` (`createMpcGoogleWallet` around :540-576; add fields to the persisted object + the read path used by `getAllWallets`)
- Modify: `src/models/types.ts` (add `mpcPrfSaltId?: string;` near `webAuthnCredentialId` at :26-29)
- Test: `src/db/mpcGoogleWallet.spec.ts`

**Interfaces:**
- Consumes: the extended `createMpcGoogleWallet` params from Task 4.
- Produces: persisted wallet record carrying `webAuthnCredentialId?`, `mpcPrfSaltId?` (non-indexed); `getAllWallets()[id]` exposes them (already returns `mpcDeviceShare`, `publicKey`, `chain`, `network`).

- [ ] **Step 1: Extend the DB spec**

In `src/db/mpcGoogleWallet.spec.ts`, extend the create call + assertion:

```ts
const id = await createMpcGoogleWallet({
  name:'n', icon:'i', theme:'t', chain:'cardano', network:'testnet',
  userId:'sub-1', publicKey:'xpubA', encryptedDeviceShare:'prf.v1:aa',
  webAuthnCredentialId:'cred-1', mpcPrfSaltId:'salt-1',
});
const wallets = await getAllWallets();
expect(wallets[id].webAuthnCredentialId).toBe('cred-1');
expect(wallets[id].mpcPrfSaltId).toBe('salt-1');
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/db/mpcGoogleWallet.spec.ts`
Expected: FAIL — `createMpcGoogleWallet` type rejects the new params / record lacks the fields.

- [ ] **Step 3: Implement**

- In `src/models/types.ts` after line 29 (`webAuthnCredentialId?`) add: `  mpcPrfSaltId?: string; // MPC passkey PRF salt id (stable, non-secret)`.
- In `src/db/gero-db.ts`, extend the `createMpcGoogleWallet` params interface (near :552) with `webAuthnCredentialId?: string; mpcPrfSaltId?: string;`, and in the persisted object (near :574-576) add:
```ts
    encryptionMethod: 'mpc' as const,
    mpcDeviceShare: params.encryptedDeviceShare,
    webAuthnCredentialId: params.webAuthnCredentialId,
    mpcPrfSaltId: params.mpcPrfSaltId,
```
(Non-indexed; no `schema.ts` change needed. Leave both `undefined` for the password path.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/db/mpcGoogleWallet.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/gero-db.ts src/models/types.ts src/db/mpcGoogleWallet.spec.ts
git commit -m "feat(mpc): persist webAuthnCredentialId + mpcPrfSaltId on MPC wallets"
```

---

## Task 6: Background handlers — parse prf-vs-password, build the secret

**Files:**
- Modify: `src/chrome/background.ts` (CREATE :1593, UNLOCK :1641, RECOVER :1685 handlers)

**Interfaces:**
- Consumes: request payloads that carry EITHER `spendingPassword: string` OR `{ prfOutputHex: string; webAuthnCredentialId: string; mpcPrfSaltId: string }`.
- Produces: builds `DeviceShareSecret` and calls the Task-4 flows.

- [ ] **Step 1: Add a helper + rewrite CREATE**

At the top of the MPC handler region (after `isMpcConflictError`), add:

```ts
import type { DeviceShareSecret } from '@/shared/utils/mpc';

/** Build a DeviceShareSecret from a request payload (passkey PRF or password). Never logged. */
function buildDeviceShareSecret(data: any): { secret: DeviceShareSecret; webAuthnCredentialId?: string; mpcPrfSaltId?: string } {
  if (data?.prfOutputHex && data?.webAuthnCredentialId && data?.mpcPrfSaltId) {
    const prfOutput = Uint8Array.from(Buffer.from(data.prfOutputHex, 'hex'));
    return {
      secret: { kind: 'prf', prfOutput, credentialId: data.webAuthnCredentialId, saltId: data.mpcPrfSaltId },
      webAuthnCredentialId: data.webAuthnCredentialId,
      mpcPrfSaltId: data.mpcPrfSaltId,
    };
  }
  if (data?.spendingPassword) {
    return { secret: { kind: 'password', password: data.spendingPassword } };
  }
  throw new Error('A passkey or spending password is required');
}
```
(Ensure `Buffer` is imported in background.ts; it already uses `getErrorMessage` etc. — add `import { Buffer } from 'buffer';` if not present.)

Rewrite CREATE (`MessageTypes.CREATE_MPC_GOOGLE_WALLET`) body:
```ts
    const { name, icon, theme, chain, network, idToken } = request.data || {};
    if (!idToken) throw new Error('idToken is required');
    const { secret, webAuthnCredentialId, mpcPrfSaltId } = buildDeviceShareSecret(request.data);

    const { prepareMpcWalletCreation, encryptDeviceShare } = await import('@/shared/utils/mpc');
    const { createMpcGoogleWallet } = await import('@/db/gero-db');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    const { walletId, recoveryShare, publicKey } = await createMpcGoogleWalletFlow(
      { name, icon, theme, chain, network, idToken, secret, webAuthnCredentialId, mpcPrfSaltId },
      { prepareMpcWalletCreation, encryptDeviceShare,
        enrollLoginShare: (idTok, ch, net, ls) => api.mpc.enroll(idTok, ch, net, ls),
        createMpcGoogleWallet, subFromIdToken },
    );
```

- [ ] **Step 2: Rewrite UNLOCK**

`MessageTypes.UNLOCK_MPC_WALLET` body:
```ts
    const { walletId, idToken } = request.data || {};
    if (!walletId || !idToken) throw new Error('walletId and idToken are required');
    const { secret } = buildDeviceShareSecret(request.data);

    const { reconstructRootKeyBytes } = await import('@/shared/utils/mpc');
    const { getAllWallets } = await import('@/db/gero-db');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    await unlockMpcWalletFlow(
      { walletId, idToken, secret },
      { getWallet: async (id) => (await getAllWallets())[id],
        getLoginShare: (idTok, ch, net) => api.mpc.getLoginShare(idTok, ch, net),
        reconstructRootKeyBytes, sessionCache: mpcSessionCache },
    );
```

- [ ] **Step 3: Rewrite RECOVER**

`MessageTypes.RECOVER_MPC_GOOGLE_WALLET` body — replace `newSpendingPassword` handling with `buildDeviceShareSecret` (the passkey is a NEW one registered on this device):
```ts
    const { name, icon, theme, chain, network, idToken, recoveryBlob, recoveryPassword, publicKey: expectedXpub } = request.data || {};
    if (!idToken || !recoveryBlob || !recoveryPassword || !expectedXpub) {
      throw new Error('idToken, recoveryBlob, recoveryPassword and publicKey are required');
    }
    const { secret: newSecret, webAuthnCredentialId, mpcPrfSaltId } = buildDeviceShareSecret(request.data);

    const { decryptRecoveryShare, reconstructAndValidateEntropy, encryptDeviceShare } = await import('@/shared/utils/mpc');
    const { createMpcGoogleWallet } = await import('@/db/gero-db');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    const { walletId, publicKey } = await recoverMpcGoogleWalletFlow(
      { name, icon, theme, chain, network, idToken, recoveryBlob, recoveryPassword, newSecret,
        expectedXpub, webAuthnCredentialId, mpcPrfSaltId },
      { decryptRecoveryShare,
        getLoginShare: (idTok, ch, net) => api.mpc.getLoginShare(idTok, ch, net),
        reconstructAndValidateEntropy, encryptDeviceShare, createMpcGoogleWallet, subFromIdToken },
    );
```
Keep each handler's existing try/catch, `sendResponse`, `return true`, and the "never log request.data" comments.

- [ ] **Step 4: Verify the background bundle builds**

Run: `npx vitest run src/chrome/mpcWalletHandlers.spec.ts && NODE_OPTIONS='--max-old-space-size=6144' npx vite build --config vite.config.background.mts --mode production`
Expected: tests PASS; background bundle exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/chrome/background.ts
git commit -m "feat(mpc): background handlers accept passkey PRF or password secret"
```

---

## Task 7: Frontend MPC passkey helper

**Files:**
- Create: `src/shared/utils/mpc/mpcPasskey.ts` (DOM-only; NOT imported by background)

**Interfaces:**
- Consumes: `isPrfSupported`, `registerWebAuthnCredentialWithPrf`, `evaluatePrfForWallet` from `@/shared/utils/webauthn-prf`.
- Produces:
  - `mpcPasskeyAvailable(): Promise<boolean>` → `isPrfSupported()`
  - `enrollMpcPasskey(walletName: string): Promise<{ credentialId: string; mpcPrfSaltId: string; prfOutputHex: string }>` — generates `mpcPrfSaltId = crypto.randomUUID()`, registers a passkey with that id as the salt/user id, hex-encodes the PRF output.
  - `evaluateMpcPasskey(credentialId: string, mpcPrfSaltId: string): Promise<string>` — returns `prfOutputHex`.

- [ ] **Step 1: Implement (no unit test — WebAuthn is un-mockable headless; covered by manual e2e in Task 12)**

Create `src/shared/utils/mpc/mpcPasskey.ts`:

```ts
import { Buffer } from 'buffer';
import {
  isPrfSupported,
  registerWebAuthnCredentialWithPrf,
  evaluatePrfForWallet,
} from '@/shared/utils/webauthn-prf';

export function mpcPasskeyAvailable(): Promise<boolean> {
  return isPrfSupported();
}

/** Register a NEW platform passkey for an MPC wallet and return the material needed
 *  to encrypt the device share in the background. `mpcPrfSaltId` is a fresh UUID used
 *  as both the WebAuthn user id and the stable PRF salt for this wallet. */
export async function enrollMpcPasskey(
  walletName: string,
): Promise<{ credentialId: string; mpcPrfSaltId: string; prfOutputHex: string }> {
  const mpcPrfSaltId = crypto.randomUUID();
  const { credentialId, prfEnabled, prfOutput } = await registerWebAuthnCredentialWithPrf(mpcPrfSaltId, walletName);
  if (!prfEnabled || !prfOutput) {
    throw new Error('This device could not create a passkey with PRF. Use a spending password instead.');
  }
  return { credentialId, mpcPrfSaltId, prfOutputHex: Buffer.from(new Uint8Array(prfOutput)).toString('hex') };
}

/** Re-evaluate the PRF for an existing MPC passkey (unlock). Returns hex PRF output. */
export async function evaluateMpcPasskey(credentialId: string, mpcPrfSaltId: string): Promise<string> {
  const prfOutput = await evaluatePrfForWallet(credentialId, mpcPrfSaltId);
  return Buffer.from(new Uint8Array(prfOutput)).toString('hex');
}
```

- [ ] **Step 2: Typecheck the file**

Run: `NODE_OPTIONS='--max-old-space-size=6144' npx vite build --config vite.config.mts --mode production` (or rely on the Task 8 build). Expected: no type errors referencing `mpcPasskey.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/shared/utils/mpc/mpcPasskey.ts
git commit -m "feat(mpc): frontend passkey helper (enroll/evaluate -> hex PRF)"
```

---

## Task 8: StepGoogleSecure — passkey-first with password fallback

**Files:**
- Modify: `src/modules/welcome/components/WalletOnboarding/steps/StepGoogleSecure.vue`
- Modify: `.../steps/StepGoogleConfirm.vue` (sends the create payload)

**Interfaces:**
- Consumes: `mpcPasskeyAvailable`, `enrollMpcPasskey` from `@/shared/utils/mpc/mpcPasskey`.
- Produces: the step now yields EITHER `{ authMethod:'passkey', credentialId, mpcPrfSaltId, prfOutputHex }` OR `{ authMethod:'password', spendingPassword }`, plus the existing `recoveryPassword`, to its parent (via the same prop/emit mechanism currently used for `spendingPassword`).

- [ ] **Step 1: Script changes in StepGoogleSecure.vue**

In `<script setup>`:
- On mount: `const passkeyCapable = ref(false); onMounted(async () => { passkeyCapable.value = await mpcPasskeyAvailable(); });`
- Add state: `const passkey = ref<{ credentialId:string; mpcPrfSaltId:string; prfOutputHex:string } | null>(null); const enrolling = ref(false); const passkeyError = ref('');`
- Add action:
```ts
async function secureWithPasskey() {
  enrolling.value = true; passkeyError.value = '';
  try {
    passkey.value = await enrollMpcPasskey(props.walletName ?? 'Gero Google Wallet');
  } catch (e) {
    passkeyError.value = (e as Error).message;
  } finally { enrolling.value = false; }
}
```
- Compute the emitted secret payload and validity:
```ts
const authPayload = computed(() =>
  passkey.value
    ? { authMethod: 'passkey' as const, ...passkey.value }
    : { authMethod: 'password' as const, spendingPassword: spendingPassword.value });
const secretReady = computed(() => passkeyCapable.value ? !!passkey.value : (spendingPassword.value.length >= 8 && spendingPassword.value === confirmPassword.value));
```
- Replace the existing "spendingPassword"-based `emit`/validity wiring so the parent receives `authPayload` (rename the emitted prop to `authPayload` and keep `recoveryPassword` as-is). Keep the recovery-passphrase section unchanged (it must still differ from the spending password ONLY on the password path — drop that cross-check when `authMethod==='passkey'`).

- [ ] **Step 2: Template changes in StepGoogleSecure.vue**

- Wrap the spending-password block (`v-if="!passkeyCapable"`).
- Add a passkey block (`v-else`): a "Secure with passkey" button calling `secureWithPasskey()`, a success line when `passkey` is set (`$t('welcome.passkeySecured')`), and `passkeyError` display. Reuse `PassKeyAuthButton.vue` styling if convenient.
- Keep the Recovery Password section for both paths.

- [ ] **Step 3: StepGoogleConfirm.vue — send the payload**

Where it currently builds the CREATE message with `spendingPassword: props.spendingPassword` (:109), change the prop to `authPayload` and spread the method fields:
```ts
const p = props.authPayload;
const base = { name, icon, theme, chain, network, idToken: props.idToken };
const data = p.authMethod === 'passkey'
  ? { ...base, prfOutputHex: p.prfOutputHex, webAuthnCredentialId: p.credentialId, mpcPrfSaltId: p.mpcPrfSaltId }
  : { ...base, spendingPassword: p.spendingPassword };
// ...Messaging.sendToBackgroundFromOptions(MessageTypes.CREATE_MPC_GOOGLE_WALLET, data)
```
Update the parent onboarding container that threads step props so `authPayload` flows Secure → Confirm (replace the `spendingPassword` prop passthrough).

- [ ] **Step 4: Verify the web bundle builds + manual smoke**

Run: `NODE_OPTIONS='--max-old-space-size=6144' npx vite build --config vite.config.mts --mode production`
Expected: exit 0, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/welcome/components/WalletOnboarding/steps/StepGoogleSecure.vue src/modules/welcome/components/WalletOnboarding/steps/StepGoogleConfirm.vue src/modules/welcome/components/WalletOnboarding/WalletOnboarding.vue
git commit -m "feat(mpc): passkey-first Secure step with password fallback"
```

---

## Task 9: Unlock — passkey vs password (dialog + LockScreen)

**Files:**
- Modify: `src/modules/dashboard/dialogs/UnlockWalletDialog.vue`
- Modify: `src/sidepanel/components/LockScreen.vue`

**Interfaces:**
- Consumes: `evaluateMpcPasskey` from `@/shared/utils/mpc/mpcPasskey`; the unlocking wallet record (`webAuthnCredentialId`, `mpcPrfSaltId`).
- Produces: sends `UNLOCK_MPC_WALLET` with EITHER `{ prfOutputHex, webAuthnCredentialId, mpcPrfSaltId }` OR `{ spendingPassword }` alongside `walletId`, `idToken`.

- [ ] **Step 1: Branch the MPC unlock path (both files, same logic)**

In the MPC unlock branch (added in `c4eff00f`), after Google sign-in yields `idToken`:
```ts
const usesPasskey = !!wallet.webAuthnCredentialId && !!wallet.mpcPrfSaltId;
const extra = usesPasskey
  ? { prfOutputHex: await evaluateMpcPasskey(wallet.webAuthnCredentialId!, wallet.mpcPrfSaltId!),
      webAuthnCredentialId: wallet.webAuthnCredentialId, mpcPrfSaltId: wallet.mpcPrfSaltId }
  : { spendingPassword: enteredSpendingPassword.value };
await Messaging.sendToBackgroundFromOptions(MessageTypes.UNLOCK_MPC_WALLET, { walletId: wallet.id, idToken, ...extra });
```
Render the spending-password input only when `!usesPasskey`; when `usesPasskey`, show a "Sign in with Google, then approve with your passkey" affordance.

- [ ] **Step 2: Build both entry bundles**

Run: `NODE_OPTIONS='--max-old-space-size=6144' npx vite build --config vite.config.mts --mode production`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/modules/dashboard/dialogs/UnlockWalletDialog.vue src/sidepanel/components/LockScreen.vue
git commit -m "feat(mpc): passkey unlock branch (dialog + side-panel LockScreen)"
```

---

## Task 10: Restore — re-enroll a passkey on the new device

**Files:**
- Modify: `src/modules/welcome/components/WalletOnboarding/steps/StepGoogleRestore.vue`

**Interfaces:**
- Consumes: `mpcPasskeyAvailable`, `enrollMpcPasskey`.
- Produces: sends `RECOVER_MPC_GOOGLE_WALLET` with `recoveryBlob`, `recoveryPassword`, `publicKey`, `idToken` PLUS either the new passkey fields or a new `spendingPassword`.

- [ ] **Step 1: Add passkey re-enrollment after the recovery inputs**

```ts
const capable = await mpcPasskeyAvailable();
const secretFields = capable
  ? (() => { const pk = enrolledPasskey.value!; return { prfOutputHex: pk.prfOutputHex, webAuthnCredentialId: pk.credentialId, mpcPrfSaltId: pk.mpcPrfSaltId }; })()
  : { spendingPassword: newSpendingPassword.value };
await Messaging.sendToBackgroundFromOptions(MessageTypes.RECOVER_MPC_GOOGLE_WALLET, {
  name, icon, theme, chain, network, idToken,
  recoveryBlob, recoveryPassword, publicKey: expectedXpubFromFile, ...secretFields,
});
```
Add a "Set up passkey on this device" button (calls `enrollMpcPasskey`) shown when `capable`; otherwise a new-spending-password field. `publicKey` comes from the recovery-file envelope (already parsed here as the anchor).

- [ ] **Step 2: Build + commit**

Run: `NODE_OPTIONS='--max-old-space-size=6144' npx vite build --config vite.config.mts --mode production`
```bash
git add src/modules/welcome/components/WalletOnboarding/steps/StepGoogleRestore.vue
git commit -m "feat(mpc): re-enroll passkey during restore on a fresh device"
```

---

## Task 11: i18n strings (us + de)

**Files:**
- Modify: `src/plugins/i18n/us.ts`, `src/plugins/i18n/de.ts`

- [ ] **Step 1: Add keys (both files, in the MPC/welcome block near the existing `welcome.spendingPassword*` keys)**

`us.ts`:
```ts
  'welcome.secureWithPasskey': 'Secure with a passkey',
  'welcome.secureWithPasskeyHint': 'Unlock with Touch ID, Windows Hello, or a security key. No password to remember.',
  'welcome.passkeySecured': 'Passkey ready. This device will unlock with your passkey.',
  'welcome.passkeyUnavailableFallback': 'No passkey on this device — set a spending password instead.',
  'welcome.unlockApprovePasskey': 'Sign in with Google, then approve with your passkey.',
  'welcome.setUpPasskeyThisDevice': 'Set up a passkey on this device',
```
`de.ts` (kept in sync):
```ts
  'welcome.secureWithPasskey': 'Mit Passkey sichern',
  'welcome.secureWithPasskeyHint': 'Entsperren mit Touch ID, Windows Hello oder Sicherheitsschlüssel. Kein Passwort nötig.',
  'welcome.passkeySecured': 'Passkey bereit. Dieses Gerät entsperrt mit deinem Passkey.',
  'welcome.passkeyUnavailableFallback': 'Kein Passkey auf diesem Gerät — stattdessen ein Ausgabepasswort festlegen.',
  'welcome.unlockApprovePasskey': 'Mit Google anmelden, dann mit deinem Passkey bestätigen.',
  'welcome.setUpPasskeyThisDevice': 'Passkey auf diesem Gerät einrichten',
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/i18n/us.ts src/plugins/i18n/de.ts
git commit -m "feat(mpc): i18n for passkey secure/unlock/restore (us + de)"
```

---

## Task 12: Full-suite gate + manual e2e checklist

**Files:** none (verification only)

- [ ] **Step 1: Run the whole MPC suite + all bundles**

Run:
```bash
npx vitest run src/shared/utils/mpc src/chrome/mpcWalletHandlers.spec.ts src/chrome/mpcSessionCache.spec.ts src/db/mpcGoogleWallet.spec.ts src/api/mpc.api.spec.ts
NODE_OPTIONS='--max-old-space-size=6144' npx vite build --config vite.config.mts --mode production
NODE_OPTIONS='--max-old-space-size=6144' npx vite build --config vite.config.background.mts --mode production
```
Expected: all tests PASS; both bundles exit 0.

- [ ] **Step 2: Manual e2e on a real device (human-gated — WebAuthn)**

Load the built extension. Verify:
1. Create on a passkey-capable device → "Secure with passkey" → Touch ID → recovery passphrase → backup file saved → wallet created.
2. Lock → Unlock → Google + passkey (Touch ID) → address matches.
3. Create on a device with NO platform authenticator → falls back to spending password.
4. Restore on a fresh profile → Google + recovery passphrase + file → new passkey enrolled → same address.
5. Negative: wrong Google account on unlock → "Recovery data mismatch" (invariant guard).
6. Confirm no `prfOutput`/passphrase/share strings appear in the service-worker console.

- [ ] **Step 3: Commit any doc/checklist updates (if made); otherwise no-op.**

---

## Self-Review

- **Spec coverage:** auth model (Tasks 4/6/8/9/10), device-share envelope (Task 2), frontend↔background split (Tasks 6/7), Argon2id (Task 1), UI (Tasks 8-11), testing (each task + Task 12), non-goals respected (no backend/topology change). ✓
- **Type consistency:** `DeviceShareSecret` defined in Task 2, consumed identically in Tasks 3/4/6/7; `encryptDeviceShare` is async everywhere after Task 2; `reconstructRootKeyBytes(enc, secret, loginShare, expectedXpub)` matches between Tasks 3 and 4; `mpcPrfSaltId`/`webAuthnCredentialId` names identical across Tasks 4/5/6/7/9/10. ✓
- **Placeholder scan:** deterministic tasks carry full code; UI tasks carry the substantive script logic + exact files (templates follow existing step patterns). ✓
- **Ordering:** Tasks 1-2 independent; 3←2; 4←3; 5←4; 6←4,5; 7 independent(DOM); 8←7; 9←7; 10←7; 11 anytime; 12 last.
