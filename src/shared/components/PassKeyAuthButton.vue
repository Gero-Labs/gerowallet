<template>
  <v-btn
    :color="color"
    :large="large"
    :block="block"
    :loading="loading"
    :disabled="disabled"
    @click="authenticate"
    class="passkey-auth-button"
  >
    <v-icon :left="!iconOnly">{{ icon }}</v-icon>
    <span v-if="!iconOnly">{{ buttonText }}</span>
  </v-btn>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';

interface Props {
  color?: string;
  large?: boolean;
  block?: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
  icon?: string;
  text?: string;
}

const props = withDefaults(defineProps<Props>(), {
  color: 'primary',
  large: false,
  block: true,
  disabled: false,
  iconOnly: false,
  icon: 'mdi-fingerprint',
  text: '',
});

const emit = defineEmits<{
  (e: 'success', privateKeyBytes: Uint8Array): void;
  (e: 'error', error: Error): void;
}>();

const { t } = useTranslation();
const loading = ref(false);

const buttonText = computed(() => {
  return props.text || t('security.authenticateWithPassKey');
});

async function authenticate() {
  loading.value = true;

  try {
    // Dynamic imports to reduce bundle size
    const { walletStore } = await import('@/stores/walletStore');
    const { decryptPrivateKeyWithPrf } = await import('@/shared/utils/webauthn-prf');

    const loggedWallet = walletStore.loggedWallet;
    if (!loggedWallet) {
      throw new Error(t('errors.noWalletLogged'));
    }

    // Validate PRF wallet
    if (!loggedWallet.webAuthnCredentialId || !loggedWallet.prfEncryptedPrivateKey) {
      throw new Error(t('security.passKeyNotConfigured'));
    }

    // Check if in side panel (WebAuthn doesn't work in side panels)
    const isSidePanel = window.location.href.includes('tabId=');

    let privateKeyBytes: Uint8Array;

    if (isSidePanel) {
      // Open PassKeyAuth popup for authentication
      privateKeyBytes = await authenticateInPopup(loggedWallet);
    } else {
      // Direct WebAuthn authentication
      privateKeyBytes = await decryptPrivateKeyWithPrf(
        loggedWallet.prfEncryptedPrivateKey,
        loggedWallet.webAuthnCredentialId,
        loggedWallet.id.toString()
      );
    }

    // Emit success with private key bytes
    emit('success', privateKeyBytes);
  } catch (error) {
    console.error('PassKey authentication failed:', error);
    emit('error', error as Error);
  } finally {
    loading.value = false;
  }
}

async function authenticateInPopup(wallet: any): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // Open small popup for PassKey authentication
    const popupUrl = chrome.runtime.getURL('index.html?mode=privateKey#/passkey-auth');
    const popup = window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');

    if (!popup) {
      reject(new Error(t('errors.popupBlocked')));
      return;
    }

    // Listen for result via postMessage
    const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;

    const messageHandler = (event: MessageEvent) => {
      if (event.origin !== extensionOrigin) return;

      if (event.data.type === 'PASSKEY_AUTH_RESULT') {
        window.removeEventListener('message', messageHandler);

        const { success, privateKeyBytes, error } = event.data.payload;

        if (success && privateKeyBytes) {
          // Convert array back to Uint8Array
          resolve(new Uint8Array(privateKeyBytes));
        } else {
          reject(new Error(error || t('security.passKeyAuthFailed')));
        }

        // Close popup
        try {
          popup.close();
        } catch (e) {
          // Popup may already be closed
        }
      }
    };

    window.addEventListener('message', messageHandler);

    // Timeout after 2 minutes
    setTimeout(() => {
      window.removeEventListener('message', messageHandler);
      reject(new Error(t('errors.authenticationTimeout')));
      try {
        popup.close();
      } catch (e) {
        // Popup may already be closed
      }
    }, 120000);
  });
}
</script>

<style scoped>
.passkey-auth-button {
  text-transform: none;
  font-weight: 500;
}
</style>
