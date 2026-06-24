import { ref, computed, watch } from 'vue';
import { generateStrikeKeyPair } from '@/api/strike-v2.auth';
import {
  setStrikeApiKeys,
  clearStrikeApiKeys,
  onStrikeAuthFailure,
} from '@/api/strike-v2.client';
import {
  requestBuilderSignature,
  verifyBuilderSignature,
} from '@/api/strike-v2.builder-connect';
import { encryptWithPassword, decryptWithPassword } from '@/shared/utils/crypto';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { useStrikeTrading } from './useStrikeTrading';

// ---------------------------------------------------------------------------
// Builder-connect configuration
// ---------------------------------------------------------------------------

// @ts-ignore — Vite env
const BUILDER_CODE: string = (import.meta.env.VITE_STRIKE_BUILDER_CODE as string | undefined) || 'gero';
// Default to a sensible 1% cap when unspecified — Strike's builder agreement
// determines the actual ceiling; this is the integrator-side declaration.
// @ts-ignore — Vite env
const MAX_FEE_BPS: number = Number(import.meta.env.VITE_STRIKE_MAX_FEE_BPS) || 100;

/** Discrete progress states the UI can render while connectWithWallet runs. */
export type ConnectStep =
  | 'idle'
  | 'requesting'
  | 'awaitingSignature'
  | 'verifying'
  | 'finalizing';

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

const isConnected = ref(false);
const hasStoredKeys = ref(false);
const isLoading = ref(false);
const publicKey = ref<string | null>(null);
const error = ref<string | null>(null);
const connectStep = ref<ConnectStep>('idle');

/** True when an encrypted key blob exists for this wallet but isn't unlocked. */
const needsUnlock = computed(() => hasStoredKeys.value && !isConnected.value);

// ---------------------------------------------------------------------------
// Storage helpers — private to this module
// ---------------------------------------------------------------------------

interface StrikeStoredKeys {
  publicKey: string;
  /** Hex string from encryptWithPassword() — salt + nonce + tag + ciphertext. */
  privateKeyEncrypted: string;
  /** Strike account id returned by the builder-connect verify endpoint.
   *  Optional for backward-compat with blobs persisted before this field
   *  existed (e.g. the legacy `generateAndConnect` path). */
  accountId?: string;
}

function storageKey(walletId: string): string {
  return `strike_keys_${walletId}`;
}

async function loadKeysForWallet(walletId: string): Promise<StrikeStoredKeys | null> {
  return new Promise((resolve) => {
    const key = storageKey(walletId);
    chrome.storage.local.get(key, (result) => {
      const stored = result[key] as StrikeStoredKeys | undefined;
      // Only accept the new encrypted shape — silently drop legacy plaintext.
      if (stored && typeof stored.publicKey === 'string' && typeof stored.privateKeyEncrypted === 'string') {
        resolve(stored);
      } else {
        resolve(null);
      }
    });
  });
}

async function saveKeysForWallet(walletId: string, keys: StrikeStoredKeys): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [storageKey(walletId)]: keys }, () => resolve());
  });
}

async function removeKeysForWallet(walletId: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(storageKey(walletId), () => resolve());
  });
}

function clearInMemoryState(): void {
  clearStrikeApiKeys();
  publicKey.value = null;
  isConnected.value = false;
  // Trading state is keyed off the active wallet too, so wipe it on
  // disconnect / wallet switch to avoid showing stale balances or orders.
  useStrikeTrading().reset();
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/**
 * Inspect storage for an existing encrypted key blob. Does NOT decrypt — call
 * unlock(password) for that. Sets hasStoredKeys + publicKey from metadata so
 * the UI can render an "Unlock" affordance without requiring decryption first.
 */
async function checkConnection(): Promise<void> {
  if (isLoading.value) return;
  const walletId = walletStore.loggedWallet?.id;
  if (!walletId) {
    hasStoredKeys.value = false;
    clearInMemoryState();
    return;
  }

  try {
    isLoading.value = true;
    error.value = null;

    const stored = await loadKeysForWallet(walletId);
    if (stored) {
      hasStoredKeys.value = true;
      publicKey.value = stored.publicKey;
      // Keys remain encrypted — user must call unlock(password) to authenticate.
    } else {
      hasStoredKeys.value = false;
      clearInMemoryState();
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    hasStoredKeys.value = false;
  } finally {
    isLoading.value = false;
  }
}

/**
 * Decrypt the stored Strike key blob with `password` and load the resulting
 * private key into the API client. Required after every page load / wallet
 * switch when an encrypted blob already exists.
 */
async function unlock(password: string): Promise<boolean> {
  if (isLoading.value) return false;
  const walletId = walletStore.loggedWallet?.id;
  if (!walletId) {
    error.value = 'No wallet logged in';
    return false;
  }
  if (!password) {
    error.value = 'Spending password is required';
    return false;
  }

  try {
    isLoading.value = true;
    error.value = null;

    const stored = await loadKeysForWallet(walletId);
    if (!stored) {
      hasStoredKeys.value = false;
      error.value = 'No Strike keys found for this wallet — generate a new key pair first';
      return false;
    }

    let privateKeyHex: string;
    try {
      const decrypted = decryptWithPassword(password, stored.privateKeyEncrypted);
      // encryptWithPassword stored the raw 32 private-key bytes (input was a
      // hex string, parsed via Buffer.from(..., 'hex')). Round-trip back to hex.
      privateKeyHex = decrypted.toString('hex');
    } catch {
      error.value = 'Incorrect password';
      return false;
    }

    setStrikeApiKeys(privateKeyHex, stored.publicKey);
    publicKey.value = stored.publicKey;
    isConnected.value = true;
    hasStoredKeys.value = true;
    return true;
  } finally {
    isLoading.value = false;
  }
}

/**
 * Generate a fresh Ed25519 key pair, encrypt the private half with the
 * supplied spending password, and persist the encrypted blob. Loads the new
 * keys into the API client immediately.
 */
async function generateAndConnect(password: string): Promise<boolean> {
  if (isLoading.value) return false;
  const walletId = walletStore.loggedWallet?.id;
  if (!walletId) {
    error.value = 'No wallet logged in';
    return false;
  }
  if (!password) {
    error.value = 'Spending password is required';
    return false;
  }

  try {
    isLoading.value = true;
    error.value = null;

    const keyPair = await generateStrikeKeyPair();
    const privateKeyEncrypted = encryptWithPassword(password, keyPair.privateKeyHex);

    await saveKeysForWallet(walletId, {
      publicKey: keyPair.publicKeyHex,
      privateKeyEncrypted,
    });

    setStrikeApiKeys(keyPair.privateKeyHex, keyPair.publicKeyHex);
    publicKey.value = keyPair.publicKeyHex;
    isConnected.value = true;
    hasStoredKeys.value = true;
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    return false;
  } finally {
    isLoading.value = false;
  }
}

/**
 * Convert a UTF-8 string to a hex string. The wallet's internal `signData`
 * path expects the payload as hex (matches the CIP-30 `signData` contract
 * used by the dApp connector — see DappSignData.vue + walletBg.signData).
 */
function utf8ToHex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Strike's full builder-connect flow:
 *   1. Generate a fresh Ed25519 API-wallet key pair.
 *   2. Ask Strike for a `message_to_sign` bound to (address, public_key, code).
 *   3. Sign that message with the wallet's payment key (CIP-8 via the existing
 *      background `signData` path — same code the dApp connector uses).
 *   4. Verify with Strike → receive `account_id` + API-wallet metadata.
 *   5. Persist the encrypted private key + accountId, load keys into the API
 *      client, and flip `isConnected` to true.
 *
 * Failures at any step leave storage untouched and surface a human-readable
 * error message via `error.value`.
 */
async function connectWithWallet(password: string): Promise<boolean> {
  if (isLoading.value) return false;
  const wallet = walletStore.loggedWallet;
  const walletId = wallet?.id;
  if (!walletId) {
    error.value = 'No wallet logged in';
    return false;
  }
  const address: string | undefined = wallet?.baseAddress;
  if (!address) {
    error.value = 'Active wallet has no payment address';
    return false;
  }
  if (!password) {
    error.value = 'Spending password is required';
    return false;
  }

  try {
    isLoading.value = true;
    error.value = null;
    connectStep.value = 'requesting';

    // 1. Generate API-wallet keypair locally
    const keyPair = await generateStrikeKeyPair();

    // 2. Request the message-to-sign from Strike
    const reqResp = await requestBuilderSignature({
      address,
      chain: 'cardano',
      public_key: keyPair.publicKeyHex,
      code: BUILDER_CODE,
      max_fee_bps: MAX_FEE_BPS,
    });

    if (!reqResp?.message_to_sign || !reqResp?.nonce) {
      throw new Error('Strike returned an invalid request-signature response');
    }

    // 3. Sign the message with the wallet's payment key.
    //    Background handler: src/chrome/background.ts -> MessageTypes.SIGN_DATA
    //    -> walletBg.signData() -> signDataCip8() in src/chrome/serialization.ts
    //    Returns CIP-30 DataSignature ({ signature, key }) — both hex-encoded
    //    COSE structures (COSE_Sign1 + COSE_Key). Strike's verify-signature
    //    endpoint accepts this serialised envelope as `wallet_signature`.
    connectStep.value = 'awaitingSignature';
    const signResp = (await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_DATA,
      data: {
        address,
        payload: utf8ToHex(reqResp.message_to_sign),
        password,
        accountIndex: 0,
      },
    })) as { data: { signature?: string; key?: string; error?: string } };

    if (!signResp?.data || signResp.data.error) {
      throw new Error(signResp?.data?.error || 'Wallet signing failed');
    }
    if (!signResp.data.signature || !signResp.data.key) {
      throw new Error('Wallet returned an invalid signature payload');
    }

    // Strike expects the Cardano signature as the CIP-30 COSE pair joined by a
    // colon: `${coseSign1Hex}:${coseKeyHex}` (per the Strike builder reference —
    // strike-builder-reference/src/api/withdraw.ts + strike-finance-skills).
    const walletSignature = `${signResp.data.signature}:${signResp.data.key}`;

    // 4. Verify with Strike — receive account_id + API-wallet metadata
    connectStep.value = 'verifying';
    const verifyResp = await verifyBuilderSignature({
      address,
      chain: 'cardano',
      nonce: reqResp.nonce,
      wallet_signature: walletSignature,
    });

    if (!verifyResp?.account_id) {
      throw new Error('Strike did not return an account id');
    }

    // 5. Persist + load keys
    connectStep.value = 'finalizing';
    const privateKeyEncrypted = encryptWithPassword(password, keyPair.privateKeyHex);
    await saveKeysForWallet(walletId, {
      publicKey: keyPair.publicKeyHex,
      privateKeyEncrypted,
      accountId: verifyResp.account_id,
    });

    setStrikeApiKeys(keyPair.privateKeyHex, keyPair.publicKeyHex);
    publicKey.value = keyPair.publicKeyHex;
    hasStoredKeys.value = true;
    isConnected.value = true;
    connectStep.value = 'idle';
    return true;
  } catch (e) {
    connectStep.value = 'idle';
    // Prefer the API error body over a generic axios message when present.
    const axiosErr = e as { response?: { data?: { message?: string; error?: string } }; message?: string };
    const apiMessage = axiosErr?.response?.data?.message || axiosErr?.response?.data?.error;
    error.value = apiMessage || (e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    isLoading.value = false;
  }
}

async function disconnect(): Promise<void> {
  if (isLoading.value) return;
  const walletId = walletStore.loggedWallet?.id;

  try {
    isLoading.value = true;
    error.value = null;

    if (walletId) {
      await removeKeysForWallet(walletId);
    }
    hasStoredKeys.value = false;
    clearInMemoryState();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    isLoading.value = false;
  }
}

/** Lock the in-memory keys without removing the encrypted blob from storage. */
function lock(): void {
  clearInMemoryState();
}

// ---------------------------------------------------------------------------
// Auth-failure subscription — when Strike rejects our keys (401/403), they're
// permanently dead from Strike's perspective: re-unlocking with the same
// password just reloads the same dead keys and the loop repeats. Nuke the
// encrypted blob too so the user is routed to the "Connect" flow (which goes
// through builder-connect end-to-end) instead of a broken "Unlock" loop.
//
// strike-v2.client.ts already calls clearStrikeApiKeys() on 401/403; we
// extend that here to also remove the persisted blob.
// ---------------------------------------------------------------------------

onStrikeAuthFailure(() => {
  const walletId = walletStore.loggedWallet?.id;
  isConnected.value = false;
  hasStoredKeys.value = false;
  publicKey.value = null;
  error.value = 'Strike rejected the stored API keys — please reconnect.';
  useStrikeTrading().reset();
  if (walletId) {
    void removeKeysForWallet(walletId);
  }
});

// ---------------------------------------------------------------------------
// Wallet watcher — re-check connection when active wallet changes
// ---------------------------------------------------------------------------

watch(
  () => walletStore.loggedWallet?.id,
  (newId, oldId) => {
    if (newId === oldId) return;
    // Always wipe in-memory state on switch so the previous wallet's keys
    // never leak into the new wallet's session. The user must unlock again.
    clearInMemoryState();
    if (newId) {
      checkConnection();
    } else {
      hasStoredKeys.value = false;
    }
  },
);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function useStrikeOnboarding() {
  return {
    isConnected,
    hasStoredKeys,
    needsUnlock,
    isLoading,
    publicKey,
    error,
    connectStep,
    checkConnection,
    unlock,
    /**
     * Full Strike builder-connect flow — generates keys, signs a Strike-issued
     * message with the user's wallet, and binds the API key to a Strike
     * account. Use this for first-time setup.
     */
    connectWithWallet,
    /**
     * Manual override — generates and persists a keypair WITHOUT going through
     * Strike's builder-connect flow. Only useful when the API wallet has
     * already been associated with an account out-of-band; otherwise the
     * resulting headers will be rejected with 401. Prefer `connectWithWallet`.
     */
    generateAndConnect,
    disconnect,
    lock,
  };
}
