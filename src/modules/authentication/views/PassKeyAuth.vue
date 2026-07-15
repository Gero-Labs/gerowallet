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
import { decryptSpendingPasswordWithPrf, decryptPrivateKeyWithPrf, evaluatePrfForWallet } from '@/shared/utils/webauthn-prf';

const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    // Get mode from query parameter ('password' | 'privateKey' | 'rawPrf' | 'mpcPrf')
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode') || 'password'; // Default to password for backwards compatibility

    const wallet = walletStore.loggedWallet;
    // mpcPrf resolves its target from the `walletId` query param (a pre-switch
    // unlock runs while a DIFFERENT wallet — or none — is logged in), so it does
    // not require a logged-in wallet here. Every other mode does.
    if (!wallet && mode !== 'mpcPrf') {
      throw new Error('No wallet logged in');
    }

    let resultPayload: any;

    if (mode === 'rawPrf') {
      // Raw PRF output — for chains (Midnight) whose signing key material is
      // NOT derived through the Cardano-specific decryptPrivateKeyWithPrf
      // path. Callers (e.g. the mini-gero side panel's Midnight signData
      // branch) decrypt the mnemonic themselves in the background using this
      // raw output, same as the direct-in-page TransactionAuthSection PRF
      // flow (MidnightSendDialog.vue) — this popup exists only because
      // WebAuthn doesn't reliably work from inside the side panel's own
      // window, so the ceremony has to happen in a real top-level popup.
      if (!wallet.webAuthnCredentialId) {
        throw new Error('PRF wallet not properly configured');
      }
      const prfOutput = await evaluatePrfForWallet(wallet.webAuthnCredentialId, wallet.id.toString());
      resultPayload = {
        success: true,
        prfOutput: Array.from(new Uint8Array(prfOutput)),
      };
    } else if (mode === 'privateKey') {
      // Decrypt private key using PRF (for data signing)
      if (!wallet.prfEncryptedPrivateKey || !wallet.webAuthnCredentialId) {
        throw new Error('PRF wallet not properly configured');
      }

      const privateKeyBytes = await decryptPrivateKeyWithPrf(
        wallet.prfEncryptedPrivateKey,
        wallet.webAuthnCredentialId,
        wallet.id.toString()
      );

      resultPayload = {
        success: true,
        privateKeyBytes: Array.from(privateKeyBytes) // Convert Uint8Array to regular array for postMessage
      };
    } else if (mode === 'mpcPrf') {
      // MPC "Sign in with Google" wallet: evaluate the passkey PRF for the
      // wallet's MPC salt and return the RAW PRF output. WebAuthn can't run in a
      // Chrome side panel, so the side-panel unlock delegates the ceremony to this
      // popup; the caller combines the output with the Google login share to
      // reconstruct the key (never logged).
      // During a PRE-SWITCH unlock the currently logged-in wallet is the OLD one,
      // so the target wallet's credential/salt are looked up by an explicit
      // `walletId` query param; without it, fall back to the logged-in wallet.
      let credentialId = wallet?.webAuthnCredentialId;
      let saltId = wallet?.mpcPrfSaltId;
      const targetWalletId = urlParams.get('walletId');
      if (targetWalletId) {
        const { getAllWallets } = await import('@/db/gero-db');
        const target = (await getAllWallets())[Number(targetWalletId)];
        credentialId = target?.webAuthnCredentialId;
        saltId = target?.mpcPrfSaltId;
      }
      if (!credentialId || !saltId) {
        throw new Error('MPC passkey not configured');
      }
      const { evaluateMpcPasskey } = await import('@/shared/utils/mpc/mpcPasskey');
      const prfOutputHex = await evaluateMpcPasskey(credentialId, saltId);
      resultPayload = {
        success: true,
        prfOutputHex,
        webAuthnCredentialId: credentialId,
        mpcPrfSaltId: saltId,
      };
    } else {
      // Default: Decrypt spending password using PRF
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

      // Decrypt spending password using PRF (includes authentication)
      const decryptedPassword = await decryptSpendingPasswordWithPrf(
        encryptedPasswordConfig.value,
        credentialConfig.value,
        wallet.id
      );

      resultPayload = {
        success: true,
        password: decryptedPassword
      };
    }

    // Send result to parent window (with secure origin restriction)
    if (window.opener) {
      const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
      window.opener.postMessage(
        {
          type: 'PASSKEY_AUTH_RESULT',
          payload: resultPayload
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