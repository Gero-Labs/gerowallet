# Plan A — MPC Crypto Core (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure, unit-tested `src/shared/utils/mpc/` module that splits BIP39 entropy into a 2-of-3 Shamir share set, encodes/decodes shares with integrity checks, and password-encrypts the recovery share — with zero UI/backend/wallet coupling.

**Architecture:** Thin, audited-primitive-only crypto layer. Shamir split/combine via the `shamir-secret-sharing` library (each share self-carries its index, so any 2 of 3 reconstruct). Shares are encoded as versioned, checksummed strings. The recovery share is additionally encrypted under a user password with PBKDF2-SHA256 + XChaCha20-Poly1305 (matching the wallet's existing ChaCha20/PBKDF2 stack). No key material is logged; reconstructed entropy is returned to the caller, never persisted here.

**Tech Stack:** TypeScript, Vitest 3.2.4, `shamir-secret-sharing@0.0.4` (pinned), `@noble/hashes@2.0.1`, `@noble/ciphers@2.1.1`.

## Global Constraints
- **Never log** shares, entropy, passwords, or derived keys (repo security rule; use no `console.log` of secrets).
- **Audited primitives only** — do not hand-roll Shamir or AEAD. Verify `shamir-secret-sharing` provenance (Privy; Cure53/Zellic audits) before install; pin exact version.
- **Verified `@noble` v2 import paths** (v2 requires the `.js` suffix — confirmed against installed 2.0.1/2.1.1):
  - `import { pbkdf2 } from '@noble/hashes/pbkdf2.js'`
  - `import { sha256 } from '@noble/hashes/sha2.js'`
  - `import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'`
- Randomness: `crypto.getRandomValues(new Uint8Array(n))` (matches existing `webauthn-prf.ts` idiom; global in Node 22 + browser).
- PBKDF2 iterations: **210_000**, dkLen 32, hash SHA-256. XChaCha20-Poly1305 nonce = 24 bytes, salt = 16 bytes.
- ESLint: fix all lint in every file touched.
- Encoding prefixes (versioned, do not change without bumping): share = `gmpc1.<roleHex2>.<b64url(share)>.<b64url(checksum4)>`; encrypted recovery = `gmpc-recovery1.<b64url(blob)>`.

---

### Task 1: Dependency + Shamir wrapper

**Files:**
- Create: `src/shared/utils/mpc/types.ts`
- Create: `src/shared/utils/mpc/shamir.ts`
- Test: `src/shared/utils/mpc/shamir.spec.ts`
- Modify: `package.json` (add pinned dependency)

**Interfaces:**
- Produces:
  - `enum ShareRole { Device = 1, Login = 2, Recovery = 3 }`
  - `class MpcError extends Error`, `class ShareDecodeError extends MpcError`, `class RecoveryDecryptError extends MpcError`
  - `const TOTAL_SHARES = 3`, `const THRESHOLD = 2`
  - `splitEntropy(entropy: Uint8Array): Promise<Uint8Array[]>` — 3 shares
  - `combineShares(shares: Uint8Array[]): Promise<Uint8Array>` — reconstructed entropy

- [ ] **Step 1: Install the pinned dependency**

Run: `npm install shamir-secret-sharing@0.0.4 --save-exact`
Expected: added to `dependencies` as `"shamir-secret-sharing": "0.0.4"`.

- [ ] **Step 2: Create the shared types**

Create `src/shared/utils/mpc/types.ts`:
```ts
export enum ShareRole {
  Device = 1,
  Login = 2,
  Recovery = 3,
}

export class MpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MpcError';
  }
}

export class ShareDecodeError extends MpcError {
  constructor(message: string) {
    super(message);
    this.name = 'ShareDecodeError';
  }
}

export class RecoveryDecryptError extends MpcError {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryDecryptError';
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `src/shared/utils/mpc/shamir.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { splitEntropy, combineShares, TOTAL_SHARES, THRESHOLD } from './shamir';
import { MpcError } from './types';

const entropy32 = () => crypto.getRandomValues(new Uint8Array(32));

describe('shamir', () => {
  it('splits into TOTAL_SHARES shares', async () => {
    const shares = await splitEntropy(entropy32());
    expect(shares).toHaveLength(TOTAL_SHARES);
  });

  it('reconstructs from any THRESHOLD shares (all 3 pairs)', async () => {
    const secret = entropy32();
    const [a, b, c] = await splitEntropy(secret);
    for (const pair of [[a, b], [a, c], [b, c]]) {
      const out = await combineShares(pair);
      expect(Array.from(out)).toEqual(Array.from(secret));
    }
  });

  it('rejects fewer than THRESHOLD shares', async () => {
    const [a] = await splitEntropy(entropy32());
    await expect(combineShares([a])).rejects.toBeInstanceOf(MpcError);
  });

  it('rejects empty entropy', async () => {
    await expect(splitEntropy(new Uint8Array(0))).rejects.toBeInstanceOf(MpcError);
  });

  it('works for 16-byte entropy', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(16));
    const [a, b] = await splitEntropy(secret);
    expect(Array.from(await combineShares([a, b]))).toEqual(Array.from(secret));
  });

  it('THRESHOLD is 2 and TOTAL_SHARES is 3', () => {
    expect(THRESHOLD).toBe(2);
    expect(TOTAL_SHARES).toBe(3);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/shared/utils/mpc/shamir.spec.ts`
Expected: FAIL — `Cannot find module './shamir'`.

- [ ] **Step 5: Implement the wrapper**

Create `src/shared/utils/mpc/shamir.ts`:
```ts
import { split, combine } from 'shamir-secret-sharing';
import { MpcError } from './types';

export const TOTAL_SHARES = 3;
export const THRESHOLD = 2;

/** Split BIP39 entropy into TOTAL_SHARES shares; any THRESHOLD reconstruct. */
export async function splitEntropy(entropy: Uint8Array): Promise<Uint8Array[]> {
  if (entropy.length === 0) {
    throw new MpcError('entropy must be non-empty');
  }
  // shamir-secret-sharing: split(secret, totalShares, threshold)
  return split(entropy, TOTAL_SHARES, THRESHOLD);
}

/** Reconstruct the secret from THRESHOLD-or-more shares (each carries its index). */
export async function combineShares(shares: Uint8Array[]): Promise<Uint8Array> {
  if (shares.length < THRESHOLD) {
    throw new MpcError(`need at least ${THRESHOLD} shares to reconstruct`);
  }
  return combine(shares);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/shared/utils/mpc/shamir.spec.ts`
Expected: PASS (6 tests). If the library's `split` signature differs (arg order), the round-trip test fails loudly — adjust the wrapper to the real signature and re-run.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/shared/utils/mpc/types.ts src/shared/utils/mpc/shamir.ts src/shared/utils/mpc/shamir.spec.ts
git commit -m "feat(mpc): add Shamir 2-of-3 split/combine wrapper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: base64url + share codec (versioned + checksummed)

**Files:**
- Create: `src/shared/utils/mpc/base64url.ts`
- Create: `src/shared/utils/mpc/shareCodec.ts`
- Test: `src/shared/utils/mpc/shareCodec.spec.ts`

**Interfaces:**
- Consumes: `ShareRole`, `ShareDecodeError` from `./types`.
- Produces:
  - `toB64url(bytes: Uint8Array): string`, `fromB64url(str: string): Uint8Array`
  - `encodeShare(role: ShareRole, share: Uint8Array): string`
  - `decodeShare(encoded: string): { role: ShareRole; share: Uint8Array }`

- [ ] **Step 1: Write the failing test**

Create `src/shared/utils/mpc/shareCodec.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { encodeShare, decodeShare } from './shareCodec';
import { ShareRole, ShareDecodeError } from './types';

const sampleShare = () => crypto.getRandomValues(new Uint8Array(33)); // 32 secret + 1 index byte

describe('shareCodec', () => {
  it('round-trips a share and preserves role + bytes', () => {
    const share = sampleShare();
    const encoded = encodeShare(ShareRole.Recovery, share);
    const decoded = decodeShare(encoded);
    expect(decoded.role).toBe(ShareRole.Recovery);
    expect(Array.from(decoded.share)).toEqual(Array.from(share));
  });

  it('produces the versioned prefix', () => {
    const encoded = encodeShare(ShareRole.Device, sampleShare());
    expect(encoded.startsWith('gmpc1.01.')).toBe(true);
  });

  it('throws on a bad format', () => {
    expect(() => decodeShare('not-a-share')).toThrow(ShareDecodeError);
  });

  it('throws on a tampered checksum', () => {
    const encoded = encodeShare(ShareRole.Login, sampleShare());
    const parts = encoded.split('.');
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('A') ? 'BB' : 'AA'); // corrupt payload
    expect(() => decodeShare(parts.join('.'))).toThrow(ShareDecodeError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/utils/mpc/shareCodec.spec.ts`
Expected: FAIL — `Cannot find module './shareCodec'`.

- [ ] **Step 3: Implement base64url**

Create `src/shared/utils/mpc/base64url.ts`:
```ts
/** URL-safe, unpadded base64 for share/backup encoding. Browser + Node 22 safe. */
export function toB64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
```

- [ ] **Step 4: Implement the codec**

Create `src/shared/utils/mpc/shareCodec.ts`:
```ts
import { sha256 } from '@noble/hashes/sha2.js';
import { toB64url, fromB64url } from './base64url';
import { ShareRole, ShareDecodeError } from './types';

const PREFIX = 'gmpc1';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Encode a raw Shamir share as a versioned, checksummed, role-tagged string. */
export function encodeShare(role: ShareRole, share: Uint8Array): string {
  const checksum = sha256(share).slice(0, 4);
  const roleHex = role.toString(16).padStart(2, '0');
  return `${PREFIX}.${roleHex}.${toB64url(share)}.${toB64url(checksum)}`;
}

/** Decode + integrity-check a share string. Throws ShareDecodeError on any mismatch. */
export function decodeShare(encoded: string): { role: ShareRole; share: Uint8Array } {
  const parts = encoded.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new ShareDecodeError('invalid share format');
  }
  const role = parseInt(parts[1], 16) as ShareRole;
  if (!(role in ShareRole)) {
    throw new ShareDecodeError('invalid share role');
  }
  let share: Uint8Array;
  let checksum: Uint8Array;
  try {
    share = fromB64url(parts[2]);
    checksum = fromB64url(parts[3]);
  } catch {
    throw new ShareDecodeError('invalid share encoding');
  }
  if (!bytesEqual(checksum, sha256(share).slice(0, 4))) {
    throw new ShareDecodeError('share checksum mismatch (corrupted or altered)');
  }
  return { role, share };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/shared/utils/mpc/shareCodec.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/utils/mpc/base64url.ts src/shared/utils/mpc/shareCodec.ts src/shared/utils/mpc/shareCodec.spec.ts
git commit -m "feat(mpc): versioned, checksummed share codec + base64url

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Recovery-share password encryption (PBKDF2 + XChaCha20-Poly1305)

**Files:**
- Create: `src/shared/utils/mpc/recoveryShare.ts`
- Test: `src/shared/utils/mpc/recoveryShare.spec.ts`

**Interfaces:**
- Consumes: `toB64url`/`fromB64url`, `RecoveryDecryptError`.
- Produces:
  - `encryptRecoveryShare(encodedShare: string, password: string): Promise<string>` — returns `gmpc-recovery1.<b64url>` blob
  - `decryptRecoveryShare(blob: string, password: string): Promise<string>` — returns the original encoded share string

- [ ] **Step 1: Write the failing test**

Create `src/shared/utils/mpc/recoveryShare.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { encryptRecoveryShare, decryptRecoveryShare } from './recoveryShare';
import { RecoveryDecryptError } from './types';

const encodedShare = 'gmpc1.03.AAAA.BBBB'; // opaque payload; encryption treats it as a string

describe('recoveryShare', () => {
  it('round-trips with the correct password', async () => {
    const blob = await encryptRecoveryShare(encodedShare, 'correct horse battery staple');
    expect(blob.startsWith('gmpc-recovery1.')).toBe(true);
    const out = await decryptRecoveryShare(blob, 'correct horse battery staple');
    expect(out).toBe(encodedShare);
  });

  it('fails with the wrong password', async () => {
    const blob = await encryptRecoveryShare(encodedShare, 'right-password');
    await expect(decryptRecoveryShare(blob, 'wrong-password')).rejects.toBeInstanceOf(RecoveryDecryptError);
  });

  it('produces different ciphertext each time (random salt+nonce)', async () => {
    const a = await encryptRecoveryShare(encodedShare, 'pw');
    const b = await encryptRecoveryShare(encodedShare, 'pw');
    expect(a).not.toBe(b);
  });

  it('rejects a malformed blob', async () => {
    await expect(decryptRecoveryShare('garbage', 'pw')).rejects.toBeInstanceOf(RecoveryDecryptError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/utils/mpc/recoveryShare.spec.ts`
Expected: FAIL — `Cannot find module './recoveryShare'`.

- [ ] **Step 3: Implement recovery-share encryption**

Create `src/shared/utils/mpc/recoveryShare.ts`:
```ts
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { toB64url, fromB64url } from './base64url';
import { RecoveryDecryptError } from './types';

const BLOB_PREFIX = 'gmpc-recovery1';
const VERSION = 1;
const PBKDF2_ITERATIONS = 210_000;
const SALT_LEN = 16;
const NONCE_LEN = 24;
const HEADER_LEN = 1 + 4 + SALT_LEN + NONCE_LEN; // version | iter(BE32) | salt | nonce

function deriveKey(password: string, salt: Uint8Array, iterations: number): Uint8Array {
  return pbkdf2(sha256, password, salt, { c: iterations, dkLen: 32 });
}

/** Encrypt an encoded recovery share under a user password. Output is safe to download/store. */
export async function encryptRecoveryShare(encodedShare: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const key = deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(encodedShare));

  const blob = new Uint8Array(HEADER_LEN + ciphertext.length);
  const view = new DataView(blob.buffer);
  blob[0] = VERSION;
  view.setUint32(1, PBKDF2_ITERATIONS, false); // big-endian
  blob.set(salt, 5);
  blob.set(nonce, 5 + SALT_LEN);
  blob.set(ciphertext, HEADER_LEN);
  return `${BLOB_PREFIX}.${toB64url(blob)}`;
}

/** Decrypt a recovery-share blob. Throws RecoveryDecryptError on wrong password or corruption. */
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
  if (raw.length < HEADER_LEN || raw[0] !== VERSION) {
    throw new RecoveryDecryptError('unsupported recovery backup version');
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const iterations = view.getUint32(1, false);
  const salt = raw.slice(5, 5 + SALT_LEN);
  const nonce = raw.slice(5 + SALT_LEN, HEADER_LEN);
  const ciphertext = raw.slice(HEADER_LEN);
  const key = deriveKey(password, salt, iterations);
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(key, nonce).decrypt(ciphertext);
  } catch {
    throw new RecoveryDecryptError('wrong password or corrupted recovery backup');
  }
  return new TextDecoder().decode(plaintext);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/utils/mpc/recoveryShare.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/utils/mpc/recoveryShare.ts src/shared/utils/mpc/recoveryShare.spec.ts
git commit -m "feat(mpc): password-encrypt recovery share (PBKDF2 + XChaCha20-Poly1305)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Orchestration + barrel export

**Files:**
- Create: `src/shared/utils/mpc/mpcShares.ts`
- Create: `src/shared/utils/mpc/index.ts`
- Test: `src/shared/utils/mpc/mpcShares.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `interface MpcShareSet { deviceShare: string; loginShare: string; recoveryShare: string }`
  - `createMpcShareSet(entropy: Uint8Array): Promise<MpcShareSet>` — encoded shares, one per role
  - `reconstructEntropy(encodedA: string, encodedB: string): Promise<Uint8Array>` — from any 2 encoded shares
  - `index.ts` re-exports the public API (`splitEntropy`/`combineShares` stay internal-ish but are exported for tests; public consumers use `createMpcShareSet`/`reconstructEntropy`/`encodeShare`/`decodeShare`/`encryptRecoveryShare`/`decryptRecoveryShare` + types)

- [ ] **Step 1: Write the failing test**

Create `src/shared/utils/mpc/mpcShares.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createMpcShareSet, reconstructEntropy } from './mpcShares';

const entropy = () => crypto.getRandomValues(new Uint8Array(32));

describe('mpcShares', () => {
  it('creates three distinct role-tagged encoded shares', async () => {
    const set = await createMpcShareSet(entropy());
    expect(set.deviceShare.startsWith('gmpc1.01.')).toBe(true);
    expect(set.loginShare.startsWith('gmpc1.02.')).toBe(true);
    expect(set.recoveryShare.startsWith('gmpc1.03.')).toBe(true);
    expect(new Set([set.deviceShare, set.loginShare, set.recoveryShare]).size).toBe(3);
  });

  it('reconstructs the original entropy from ANY pair of shares', async () => {
    const secret = entropy();
    const set = await createMpcShareSet(secret);
    const pairs: [string, string][] = [
      [set.deviceShare, set.loginShare],
      [set.deviceShare, set.recoveryShare],
      [set.loginShare, set.recoveryShare],
    ];
    for (const [a, b] of pairs) {
      const out = await reconstructEntropy(a, b);
      expect(Array.from(out)).toEqual(Array.from(secret));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/utils/mpc/mpcShares.spec.ts`
Expected: FAIL — `Cannot find module './mpcShares'`.

- [ ] **Step 3: Implement orchestration**

Create `src/shared/utils/mpc/mpcShares.ts`:
```ts
import { splitEntropy, combineShares } from './shamir';
import { encodeShare, decodeShare } from './shareCodec';
import { ShareRole } from './types';

export interface MpcShareSet {
  /** Stored locally on the enrolled device. */
  deviceShare: string;
  /** Sent to gero-backend, released only after Google JWT verification. */
  loginShare: string;
  /** Presented to the user to back up (later password-encrypted for download). */
  recoveryShare: string;
}

/** Split entropy into a role-tagged, encoded 2-of-3 share set. */
export async function createMpcShareSet(entropy: Uint8Array): Promise<MpcShareSet> {
  const [device, login, recovery] = await splitEntropy(entropy);
  return {
    deviceShare: encodeShare(ShareRole.Device, device),
    loginShare: encodeShare(ShareRole.Login, login),
    recoveryShare: encodeShare(ShareRole.Recovery, recovery),
  };
}

/** Reconstruct entropy from any two encoded shares (role is metadata; index is in the bytes). */
export async function reconstructEntropy(encodedA: string, encodedB: string): Promise<Uint8Array> {
  const a = decodeShare(encodedA).share;
  const b = decodeShare(encodedB).share;
  return combineShares([a, b]);
}
```

- [ ] **Step 4: Create the barrel export**

Create `src/shared/utils/mpc/index.ts`:
```ts
export { ShareRole, MpcError, ShareDecodeError, RecoveryDecryptError } from './types';
export { TOTAL_SHARES, THRESHOLD, splitEntropy, combineShares } from './shamir';
export { encodeShare, decodeShare } from './shareCodec';
export { encryptRecoveryShare, decryptRecoveryShare } from './recoveryShare';
export { createMpcShareSet, reconstructEntropy } from './mpcShares';
export type { MpcShareSet } from './mpcShares';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/shared/utils/mpc/mpcShares.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the whole module suite + typecheck + lint**

Run: `npx vitest run src/shared/utils/mpc/`
Expected: PASS (all 16 tests across 4 spec files).

Run: `npm run typecheck`
Expected: exit 0.

Run: `npm run lint`
Expected: no errors (fix any lint in the new files).

- [ ] **Step 7: Commit**

```bash
git add src/shared/utils/mpc/mpcShares.ts src/shared/utils/mpc/index.ts src/shared/utils/mpc/mpcShares.spec.ts
git commit -m "feat(mpc): share-set orchestration + public barrel export

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review
- **Spec coverage:** implements spec §5.1 "MPC module (`src/shared/utils/mpc/`): splitSecret, combineShares, share serialization, recovery-share encoding" and §8.5 (entropy transient, never persisted here). ✅
- **Placeholder scan:** none — every code step has complete, runnable code; all import paths verified against installed versions.
- **Type consistency:** `ShareRole`, `MpcShareSet`, `encodeShare`/`decodeShare`, `createMpcShareSet`/`reconstructEntropy`, `encryptRecoveryShare`/`decryptRecoveryShare` names are consistent across tasks and the barrel.
- **Downstream contract for Plan B/C:** the encoded-share string format (`gmpc1.*`) and the `MpcShareSet` role mapping (device=01, login=02, recovery=03) are the interface Plan B (backend login-share storage) and Plan C (wallet lifecycle) consume. The backend stores `loginShare` verbatim; the client reconstructs with `reconstructEntropy(deviceShare, loginShare)` on the enrolled device.
- **Security notes:** audited primitives only; no secret logging; wrong-password path returns a typed error without leaking; PBKDF2 iterations pinned at 210k and embedded per-blob so they can be raised later without breaking old backups.
