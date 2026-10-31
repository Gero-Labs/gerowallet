// Cross-device signing bridge — persistent device identity (background).
//
// The relay-auth identity used to be generated fresh on every login, so this
// device's deviceId changed each session and any pin the phone made was void by
// the next unlock (and require_remote could lock the user out). This persists a
// STABLE identity for the browser install, so pins survive logins.
//
// The stored value is an Ed25519 relay-auth keypair — SEPARATE from the wallet
// key, used only to authenticate relay messages. It is NOT a spending key, but it
// is what lets this browser speak for the wallet to the user's paired phone. It is
// kept in the extension's private IndexedDB (privateStore.ts), which content
// scripts cannot open; older releases kept it in chrome.storage.local, from where
// the first read moves it. FOLLOW-UP (tracked): encrypt it at rest / derive it
// from the unlocked wallet.

import { generateDeviceKeypair, deviceIdFromPubKey, isKeypairConsistent } from './deviceIdentity';
import { moveFromChromeLocal, setPrivate } from '@/utils/privateStore';

export interface StoredDeviceIdentity {
  deviceId: string;
  privKeyHex: string;
  pubKeyHex: string;
}

/** Minimal async KV surface (the private store in prod; in-memory in tests). */
export interface IdentityStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

const STORAGE_KEY = 'crossDeviceIdentity';

function isValid(v: unknown): v is StoredDeviceIdentity {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o['deviceId'] === 'string'
    && typeof o['privKeyHex'] === 'string'
    && typeof o['pubKeyHex'] === 'string'
    // fail closed on a tampered/corrupt store: the id must derive from the key,
    // and the key from the private key.
    && deviceIdFromPubKey(o['pubKeyHex']) === o['deviceId']
    && isKeypairConsistent(o['privKeyHex'], o['pubKeyHex']);
}

function privateStorage(): IdentityStorage {
  return {
    get: (key) => moveFromChromeLocal(key),
    set: (key, value) => setPrivate(key, value),
  };
}

/**
 * Load the persisted device identity, or create + persist one on first use.
 * Deterministic across logins for a given install. Injectable storage for tests.
 */
export async function loadOrCreateDeviceIdentity(
  storage: IdentityStorage = privateStorage(),
): Promise<StoredDeviceIdentity> {
  try {
    const existing = await storage.get(STORAGE_KEY);
    if (isValid(existing)) return existing;
  } catch (e) {
    console.warn('loadOrCreateDeviceIdentity: read failed, regenerating:', e);
  }

  const kp = generateDeviceKeypair();
  const identity: StoredDeviceIdentity = {
    deviceId: deviceIdFromPubKey(kp.pubKeyHex),
    privKeyHex: kp.privKeyHex,
    pubKeyHex: kp.pubKeyHex,
  };
  try {
    await storage.set(STORAGE_KEY, identity);
  } catch (e) {
    // Non-fatal: a fresh (unpersisted) identity still works for this session.
    console.warn('loadOrCreateDeviceIdentity: persist failed:', e);
  }
  return identity;
}
