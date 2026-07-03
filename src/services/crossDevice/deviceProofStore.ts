// Cross-device signing — cached wallet-control proof (background).
//
// The DEVICE_REGISTER proof is signed with the wallet key, which needs the user's
// auth (password / passkey). The bridge re-registers on every reconnect with no
// auth in hand, so the proof is produced ONCE when the user enables remote
// signing and cached here, then re-sent on every register (it is a durable
// pubkey<->wallet fact).
//
// Scoped by (relay-identity deviceId, wallet reward address): rotating the relay
// identity (reinstall) OR switching wallets invalidates the cache and forces
// regeneration, so a stale proof is never sent for the wrong identity/wallet.

import type { DeviceRegisterProof } from './protocol';

export interface ProofStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

const STORAGE_KEY = 'crossDeviceProofs';

interface StoredProofEntry {
  identityDeviceId: string;
  proof: DeviceRegisterProof;
}
type StoredProofs = Record<string, StoredProofEntry>; // keyed by wallet reward address

function chromeStorage(): ProofStorage {
  return {
    get: (key) => new Promise((resolve) => {
      chrome.storage.local.get(key, (r) => resolve(r?.[key]));
    }),
    set: (key, value) => new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    }),
  };
}

function isProof(v: unknown): v is DeviceRegisterProof {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o['coseSign1'] === 'string'
    && typeof o['coseKey'] === 'string'
    && typeof o['stakeAddress'] === 'string';
}

/** The cached proof for this (identity, wallet), or null if none / stale identity. */
export async function loadDeviceRegisterProof(
  identityDeviceId: string,
  stakeAddress: string,
  storage: ProofStorage = chromeStorage(),
): Promise<DeviceRegisterProof | null> {
  if (!identityDeviceId || !stakeAddress) return null;
  try {
    const all = (await storage.get(STORAGE_KEY)) as StoredProofs | undefined;
    const entry = all?.[stakeAddress];
    if (entry && entry.identityDeviceId === identityDeviceId && isProof(entry.proof)) {
      return entry.proof;
    }
  } catch (e) {
    console.warn('loadDeviceRegisterProof failed:', e);
  }
  return null;
}

/** Persist the proof for this (identity, wallet), replacing any prior entry. */
export async function saveDeviceRegisterProof(
  identityDeviceId: string,
  stakeAddress: string,
  proof: DeviceRegisterProof,
  storage: ProofStorage = chromeStorage(),
): Promise<void> {
  let all: StoredProofs = {};
  try {
    all = ((await storage.get(STORAGE_KEY)) as StoredProofs) || {};
  } catch { /* start fresh */ }
  all[stakeAddress] = { identityDeviceId, proof };
  await storage.set(STORAGE_KEY, all);
}
