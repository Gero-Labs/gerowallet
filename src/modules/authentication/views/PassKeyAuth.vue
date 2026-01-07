<template>
  <v-app>
    <v-container fluid fill-height class="pa-0">
      <v-row align="center" justify="center" class="fill-height">
        <v-col cols="12" class="text-center">
          <v-card flat class="transparent">
            <v-card-text>
              <div class="mb-4">
                <v-avatar size="80" color="primary">
                  <v-img :src="assets.passKeySvg" contain width="50" height="50" />
                </v-avatar>
              </div>

              <h2 class="mb-2">{{ $t('security.authenticateWithPassKey') }}</h2>
              <p class="text--secondary">{{ $t('security.passkeyAuthInProgress') }}</p>

              <v-progress-circular
                v-if="loading"
                indeterminate
                color="primary"
                size="50"
                class="mt-4"
              />

              <v-alert
                v-if="error"
                type="error"
                text
                class="mt-4"
              >
                {{ error }}
              </v-alert>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </v-app>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { walletStore } from '@/stores/walletStore';
import assets from '@/utils/assets';
import { getDb } from '@/db/wallet-db';
import { authenticateWebAuthn, decryptSpendingPasswordForPassKey } from '@/shared/utils/security';

const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    // Get database config
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    // Get WebAuthn credential ID
    const credentialConfig = await configTable.where({ key: 'webAuthnCredentialId' }).first();
    if (!credentialConfig || !credentialConfig.value) {
      throw new Error('PassKey credential not found');
    }

    // Get encrypted password
    const encryptedPasswordConfig = await configTable.where({ key: 'passKeyEncryptedSpendingPassword' }).first();
    if (!encryptedPasswordConfig || !encryptedPasswordConfig.value) {
      throw new Error('Encrypted password not found');
    }

    // Authenticate with WebAuthn
    const authenticated = await authenticateWebAuthn(credentialConfig.value);

    if (!authenticated) {
      throw new Error('PassKey authentication failed');
    }

    // Decrypt spending password
    const decryptedPassword = await decryptSpendingPasswordForPassKey(
      encryptedPasswordConfig.value,
      credentialConfig.value,
      wallet.id
    );

    // Send result to parent window (with secure origin restriction)
    if (window.opener) {
      const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
      window.opener.postMessage(
        {
          type: 'PASSKEY_AUTH_RESULT',
          payload: {
            success: true,
            password: decryptedPassword
          }
        },
        extensionOrigin
      );
    } else {
      console.error('[PassKeyAuth] window.opener is null! Cannot send result to parent.');
    }

    // Close this window
    setTimeout(() => {
      window.close();
    }, 500);
  } catch (err: any) {
    console.error('[PassKeyAuth] Error:', err);

    // Check if this is a user cancellation
    // WebAuthn throws NotAllowedError when user cancels or denies
    const isUserCancellation =
      err.name === 'NotAllowedError' ||
      err.name === 'AbortError' ||
      err.message?.toLowerCase().includes('not allowed');

    if (isUserCancellation) {
      // Send cancellation result (with special flag)
      if (window.opener) {
        const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
        window.opener.postMessage(
          {
            type: 'PASSKEY_AUTH_RESULT',
            payload: {
              success: false,
              cancelled: true, // Special flag for cancellation
              error: 'User cancelled'
            }
          },
          extensionOrigin
        );
      }
      // Close immediately for cancellation
      window.close();
    } else {
      // Actual error - show it
      error.value = err.message || 'Authentication failed';
      loading.value = false;

      // Send error to parent window
      if (window.opener) {
        const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
        window.opener.postMessage(
          {
            type: 'PASSKEY_AUTH_RESULT',
            payload: {
              success: false,
              error: err.message || 'Authentication failed'
            }
          },
          extensionOrigin
        );
      }

      // Close window after showing error briefly
      setTimeout(() => {
        window.close();
      }, 3000);
    }
  }
});
</script>

<style scoped>
.fill-height {
  min-height: 100vh;
}
</style>