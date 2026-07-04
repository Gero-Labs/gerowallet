// Cross-device signing — single-use QR pairing nonces (background, MV3-durable).
//
// The desktop mints a nonce per QR render; the phone echoes it in PAIR_CONFIRM.
// `consume` is single-use + TTL-bounded, so a photographed / screenshotted QR
// cannot be replayed to pin an attacker: the nonce is burned on first use and
// expires shortly after.
//
// Persisted in chrome.storage.local (NOT in-memory): the QR can sit on screen
// across a ~40s MV3 service-worker recycle before the phone scans it, and an
// in-memory nonce would evaporate on that recycle and drop a legitimate pair.
//
// A module mutex serialises read-modify-write so the compare-and-set
// (used:false -> true) is atomic within the worker: two frames echoing the same
// nonce cannot both observe used:false and both pin.
//
// Pure-ish: all IO (storage), time (`now`), and randomness (`randomBytes`) are
// injected, so this is fully unit-testable with an in-memory fake.

import { Mutex } from 'async-mutex';

export interface NonceStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

const STORAGE_KEY = 'crossDevicePairingNonces';
// > the ~42s MV3 worker recycle (so a mid-pair recycle doesn't drop the nonce),
// < a human's patience holding a phone up to a screen.
const DEFAULT_TTL_SECONDS = 180;
const NONCE_BYTES = 16;

interface StoredNonce {
  exp: number; // unix seconds; invalid once now >= exp
  used: boolean; // burned on first successful consume
  stake: string; // the wallet reward address the nonce was minted under
}
type StoredNonces = Record<string, StoredNonce>; // keyed by nonce (lowercase hex)

const mutex = new Mutex();

function chromeStorage(): NonceStorage {
  return {
    get: (key) => new Promise((resolve) => {
      chrome.storage.local.get(key, (r) => resolve(r?.[key]));
    }),
    set: (key, value) => new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    }),
  };
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function isStoredNonce(v: unknown): v is StoredNonce {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o['exp'] === 'number' && typeof o['used'] === 'boolean' && typeof o['stake'] === 'string';
}

/** Drop expired entries (used or not). Bounds storage growth. */
function prune(all: StoredNonces, now: number): StoredNonces {
  const next: StoredNonces = {};
  for (const [nonce, e] of Object.entries(all)) {
    if (isStoredNonce(e) && e.exp > now) next[nonce] = e;
  }
  return next;
}

async function readAll(storage: NonceStorage): Promise<StoredNonces> {
  try {
    const all = (await storage.get(STORAGE_KEY)) as StoredNonces | undefined;
    return all && typeof all === 'object' ? all : {};
  } catch {
    return {};
  }
}

export interface MintedNonce {
  nonce: string; // lowercase hex
  exp: number; // unix seconds
}

/**
 * Mint a fresh single-use nonce for `ownStake`, pruning expired entries first.
 * The returned nonce goes into the QR the desktop renders; the phone must echo it
 * back (inside the signed PAIR_CONFIRM subject) for the pair to be accepted.
 */
export async function mintPairingNonce(
  ownStake: string,
  now: number,
  randomBytes: (n: number) => Uint8Array,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  storage: NonceStorage = chromeStorage(),
): Promise<MintedNonce> {
  return mutex.runExclusive(async () => {
    const all = prune(await readAll(storage), now);
    const nonce = bytesToHex(randomBytes(NONCE_BYTES));
    const exp = now + ttlSeconds;
    all[nonce] = { exp, used: false, stake: ownStake };
    await storage.set(STORAGE_KEY, all);
    return { nonce, exp };
  });
}

/**
 * Cheap, NON-CONSUMING check: is there a matching unused, unexpired nonce for this
 * wallet? A single storage read — no crypto, no write, no burn. Used as an early
 * reject at the top of the pairing handler so an untrusted relay flooding
 * PAIR_CONFIRM frames (when no QR / no live nonce is outstanding) is dropped BEFORE
 * the expensive wallet-control-proof verify — without touching the nonce, so the
 * proof-first anti-nonce-burn property is preserved. This is a DoS gate only, NOT a
 * security gate: {@link consumePairingNonce} remains the authoritative single-use
 * check (this peek can race a concurrent consume; the consume settles it).
 */
export async function peekPairingNonce(
  nonce: string,
  ownStake: string,
  now: number,
  storage: NonceStorage = chromeStorage(),
): Promise<boolean> {
  const entry = (await readAll(storage))[nonce];
  return isStoredNonce(entry) && !entry.used && entry.exp > now && entry.stake === ownStake;
}

/**
 * Atomically consume a nonce. Succeeds iff it is present, not yet used, not
 * expired, and was minted under `ownStake`; on success it is marked used and
 * persisted BEFORE returning, so a replay within the TTL sees used:true. Returns
 * false on any failure (unknown / used / expired / wrong wallet) — fail closed.
 *
 * The wallet check (`stake === ownStake`) defends against consuming a nonce minted
 * under a different wallet after a wallet switch; the caller additionally verifies
 * the wallet-control proof, so this is defense-in-depth, not the sole binding.
 */
export async function consumePairingNonce(
  nonce: string,
  ownStake: string,
  now: number,
  storage: NonceStorage = chromeStorage(),
): Promise<boolean> {
  return mutex.runExclusive(async () => {
    const all = await readAll(storage);
    const entry = all[nonce];
    const ok = isStoredNonce(entry) && !entry.used && entry.exp > now && entry.stake === ownStake;
    if (!ok) {
      // Opportunistic prune on a miss so misses/expiries don't grow storage.
      const pruned = prune(all, now);
      if (Object.keys(pruned).length !== Object.keys(all).length) {
        await storage.set(STORAGE_KEY, pruned);
      }
      return false;
    }
    const next = prune(all, now); // keeps the just-matched entry (exp > now)
    next[nonce] = { ...entry, used: true };
    await storage.set(STORAGE_KEY, next);
    return true;
  });
}
