import { ref, computed, watch } from 'vue';
import { generateStrikeKeyPair } from '@/api/strike-v2.auth';
import {
  setStrikeApiKeys,
  clearStrikeApiKeys,
  onStrikeAuthFailure,
} from '@/api/strike-v2.client';
import { encryptWithPassword, decryptWithPassword } from '@/shared/utils/crypto';
import { walletStore } from '@/stores/walletStore';
import { useStrikeTrading } from './useStrikeTrading';

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

const isConnected = ref(false);
const hasStoredKeys = ref(false);
const isLoading = ref(false);
const publicKey = ref<string | null>(null);
const error = ref<string | null>(null);

/** True when an encrypted key blob exists for this wallet but isn't unlocked. */
const needsUnlock = computed(() => hasStoredKeys.value && !isConnected.value);

// ---------------------------------------------------------------------------
// Storage helpers — private to this module
// ---------------------------------------------------------------------------

interface StrikeStoredKeys {
  publicKey: string;
  /** Hex string from encryptWithPassword() — salt + nonce + tag + ciphertext. */
  privateKeyEncrypted: string;
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
// Auth-failure subscription — flip isConnected when the API rejects our keys.
// strike-v2.client.ts already calls clearStrikeApiKeys() on 401/403; we just
// need to mirror that into the composable's reactive state.
// ---------------------------------------------------------------------------

onStrikeAuthFailure(() => {
  isConnected.value = false;
  // hasStoredKeys may still be true — user can re-unlock or regenerate.
  useStrikeTrading().reset();
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
    checkConnection,
    unlock,
    generateAndConnect,
    disconnect,
    lock,
  };
}
