import { ref, watch } from 'vue';
import { generateStrikeKeyPair } from '@/api/strike-v2.auth';
import { setStrikeApiKeys, clearStrikeApiKeys } from '@/api/strike-v2.client';
import { walletStore } from '@/stores/walletStore';

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

const isConnected = ref(false);
const isLoading = ref(false);
const publicKey = ref<string | null>(null);
const error = ref<string | null>(null);

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

interface StrikeStoredKeys {
  publicKey: string;
  privateKey: string;
}

function storageKey(walletId: string): string {
  return `strike_keys_${walletId}`;
}

async function loadKeysForWallet(walletId: string): Promise<StrikeStoredKeys | null> {
  return new Promise((resolve) => {
    const key = storageKey(walletId);
    chrome.storage.local.get(key, (result) => {
      const stored = result[key] as StrikeStoredKeys | undefined;
      resolve(stored ?? null);
    });
  });
}

async function saveKeysForWallet(walletId: string, keys: StrikeStoredKeys): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [storageKey(walletId)]: keys }, resolve);
  });
}

async function removeKeysForWallet(walletId: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(storageKey(walletId), resolve);
  });
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

async function checkConnection(): Promise<void> {
  const walletId = walletStore.loggedWallet?.id;
  if (!walletId) {
    isConnected.value = false;
    publicKey.value = null;
    return;
  }

  try {
    isLoading.value = true;
    error.value = null;

    const stored = await loadKeysForWallet(walletId);
    if (stored) {
      setStrikeApiKeys(stored.privateKey, stored.publicKey);
      publicKey.value = stored.publicKey;
      isConnected.value = true;
    } else {
      clearStrikeApiKeys();
      publicKey.value = null;
      isConnected.value = false;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    isConnected.value = false;
  } finally {
    isLoading.value = false;
  }
}

async function generateAndConnect(): Promise<void> {
  const walletId = walletStore.loggedWallet?.id;
  if (!walletId) {
    error.value = 'No wallet logged in';
    return;
  }

  try {
    isLoading.value = true;
    error.value = null;

    const keyPair = await generateStrikeKeyPair();
    await saveKeysForWallet(walletId, {
      publicKey: keyPair.publicKeyHex,
      privateKey: keyPair.privateKeyHex,
    });

    setStrikeApiKeys(keyPair.privateKeyHex, keyPair.publicKeyHex);
    publicKey.value = keyPair.publicKeyHex;
    isConnected.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    isLoading.value = false;
  }
}

async function disconnect(): Promise<void> {
  const walletId = walletStore.loggedWallet?.id;

  try {
    isLoading.value = true;
    error.value = null;

    if (walletId) {
      await removeKeysForWallet(walletId);
    }
    clearStrikeApiKeys();
    publicKey.value = null;
    isConnected.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    isLoading.value = false;
  }
}

// ---------------------------------------------------------------------------
// Wallet watcher — re-check connection when active wallet changes
// ---------------------------------------------------------------------------

watch(
  () => walletStore.loggedWallet?.id,
  (newId) => {
    if (newId) {
      checkConnection();
    } else {
      clearStrikeApiKeys();
      publicKey.value = null;
      isConnected.value = false;
    }
  },
);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function useStrikeOnboarding() {
  return {
    isConnected,
    isLoading,
    publicKey,
    error,
    checkConnection,
    generateAndConnect,
    disconnect,
    loadKeysForWallet,
  };
}
