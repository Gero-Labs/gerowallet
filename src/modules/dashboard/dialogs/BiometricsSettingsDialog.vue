<template>
  <v-dialog
    :value="value"
    persistent
    max-width="600px"
    @input="$emit('input', $event)"
  >
    <v-card class="biometrics-settings-dialog">
      <v-card-title class="headline text-center">
        <v-icon left color="primary" large>mdi-fingerprint</v-icon>
        {{ $t('security.biometricsSettings') }}
      </v-card-title>

      <v-card-text class="pt-6">
        <!-- Main Settings View -->
        <div v-if="!showPasswordPrompt">
          <div class="text-center mb-6">
            <div class="subtitle-1">{{ $t('security.configureBiometrics') }}</div>
            <div class="caption">{{ $t('security.biometricsDescription') }}</div>
          </div>

          <!-- Use Biometrics for Unlocking -->
          <v-list class="transparent">
            <v-list-item>
              <v-list-item-avatar class="my-0">
                <v-icon>mdi-lock-open-outline</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.useBiometricsForUnlock') }}</v-list-item-title>
                <v-list-item-subtitle>{{ $t('security.useBiometricsForUnlockDescription') }}</v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action>
                <v-switch
                  v-model="biometricsForUnlock"
                  color="primary"
                  :disabled="loading"
                ></v-switch>
              </v-list-item-action>
            </v-list-item>

            <!-- Use Biometrics for Password Autofill (Normal wallets only) -->
            <v-list-item v-if="isNormalWallet">
              <v-list-item-avatar class="my-0">
                <v-icon>mdi-form-textbox-password</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.useBiometricsForPasswordAutofill') }}</v-list-item-title>
                <v-list-item-subtitle>{{ $t('security.useBiometricsForPasswordAutofillDescription') }}</v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action>
                <v-switch
                  v-model="biometricsForPasswordAutofill"
                  color="primary"
                  :disabled="loading"
                ></v-switch>
              </v-list-item-action>
            </v-list-item>
          </v-list>
        </div>

        <!-- Password Prompt for Password Autofill -->
        <div v-else class="password-prompt">
          <div class="text-center mb-4">
            <div class="subtitle-1">{{ $t('security.enterSpendingPassword') }}</div>
            <div class="caption">{{ $t('security.passwordRequiredForAutofill') }}</div>
          </div>
          <v-text-field
            v-model="spendingPassword"
            :label="$t('security.spendingPassword')"
            type="password"
            outlined
            dense
            autofocus
            @keyup.enter="handlePasswordSubmit"
          ></v-text-field>
        </div>

        <!-- Browser Support Notice -->
        <v-alert
          v-if="!isBiometricsSupported"
          type="warning"
          dense
          class="mt-4"
        >
          {{ $t('security.biometricsNotSupported') }}
        </v-alert>

        <!-- Error Message -->
        <v-alert
          v-if="errorMessage"
          type="error"
          dense
          class="mt-4"
        >
          {{ errorMessage }}
        </v-alert>

        <!-- Success Message -->
        <v-alert
          v-if="successMessage"
          type="success"
          dense
          class="mt-4"
        >
          {{ successMessage }}
        </v-alert>
      </v-card-text>

      <v-card-actions class="px-6 pb-6">
        <v-btn
          text
          @click="handleCancel"
          :disabled="loading"
        >
          {{ $t('common.cancel') }}
        </v-btn>
        <v-spacer></v-spacer>
        <v-btn
          color="primary"
          @click="handleSave"
          :loading="loading"
          :disabled="!hasChanges || !isBiometricsSupported"
        >
          {{ $t('common.save') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import Vue from 'vue';
import { walletStore } from '@/stores/walletStore';
import { WalletType } from '@/models/types';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { registerWebAuthnCredential } from '@/shared/utils/security';
import { encrypt } from '@/shared/utils/crypto';

export default Vue.extend({
  name: 'BiometricsSettingsDialog',

  props: {
    value: {
      type: Boolean,
      required: true
    }
  },

  data() {
    return {
      biometricsForUnlock: false,
      biometricsForPasswordAutofill: false,
      originalBiometricsForUnlock: false,
      originalBiometricsForPasswordAutofill: false,
      showPasswordPrompt: false,
      spendingPassword: '',
      loading: false,
      errorMessage: '',
      successMessage: '',
      isBiometricsSupported: false
    };
  },

  computed: {
    isNormalWallet(): boolean {
      const wallet = walletStore.loggedWallet;
      return wallet?.type === WalletType.Normal;
    },

    hasChanges(): boolean {
      return this.biometricsForUnlock !== this.originalBiometricsForUnlock ||
             this.biometricsForPasswordAutofill !== this.originalBiometricsForPasswordAutofill;
    }
  },

  watch: {
    value(newVal) {
      if (newVal) {
        this.loadCurrentBiometricsSettings();
        this.checkBiometricsSupport();
      } else {
        this.resetForm();
      }
    }
  },

  methods: {
    async checkBiometricsSupport() {
      // Check if WebAuthn is supported
      this.isBiometricsSupported = !!window.PublicKeyCredential;
    },

    async loadCurrentBiometricsSettings() {
      try {
        const wallet = walletStore.loggedWallet;
        if (!wallet) return;

        const { getDb } = await import('@/db/wallet-db');
        const db = await getDb(wallet.id);
        const configTable = db.table('config');

        const biometricsUnlockConfig = await configTable.where({ key: 'biometricsForUnlock' }).first();
        const biometricsAutofillConfig = await configTable.where({ key: 'biometricsForPasswordAutofill' }).first();

        this.biometricsForUnlock = biometricsUnlockConfig?.value || false;
        this.biometricsForPasswordAutofill = biometricsAutofillConfig?.value || false;

        this.originalBiometricsForUnlock = this.biometricsForUnlock;
        this.originalBiometricsForPasswordAutofill = this.biometricsForPasswordAutofill;
      } catch (error) {
        console.error('Error loading biometrics settings:', error);
        this.biometricsForUnlock = false;
        this.biometricsForPasswordAutofill = false;
        this.originalBiometricsForUnlock = false;
        this.originalBiometricsForPasswordAutofill = false;
      }
    },

    async handleSave() {
      this.loading = true;
      this.errorMessage = '';

      try {
        const wallet = walletStore.loggedWallet;
        if (!wallet) {
          throw new Error('No wallet logged in');
        }

        const { getDb } = await import('@/db/wallet-db');
        const db = await getDb(wallet.id);
        const configTable = db.table('config');

        // Check if biometric unlock is being enabled
        const isEnablingBiometricUnlock = this.biometricsForUnlock && !this.originalBiometricsForUnlock;
        const isDisablingBiometricUnlock = !this.biometricsForUnlock && this.originalBiometricsForUnlock;

        if (isEnablingBiometricUnlock) {
          // Register WebAuthn credential
          console.log('🔐 Registering WebAuthn credential for biometric unlock');
          const credentialId = await registerWebAuthnCredential(wallet.id, wallet.name || 'Wallet');

          // Store credential ID in database
          await configTable.put({ key: 'webAuthnCredentialId', value: credentialId });
          console.log('✅ WebAuthn credential registered and stored');
        }

        if (isDisablingBiometricUnlock) {
          // Remove credential ID from database
          console.log('🗑️ Removing WebAuthn credential');
          await configTable.where({ key: 'webAuthnCredentialId' }).delete();
        }

        // Save biometric settings
        await configTable.put({ key: 'biometricsForUnlock', value: this.biometricsForUnlock });
        await configTable.put({ key: 'biometricsForPasswordAutofill', value: this.biometricsForPasswordAutofill });

        this.originalBiometricsForUnlock = this.biometricsForUnlock;
        this.originalBiometricsForPasswordAutofill = this.biometricsForPasswordAutofill;

        this.successMessage = this.$t('security.biometricsSettingsUpdated');

        // Close dialog after short delay
        setTimeout(() => {
          this.$emit('input', false);
          this.$emit('updated');
        }, 1000);
      } catch (error: any) {
        console.error('Error saving biometrics settings:', error);
        this.errorMessage = error.message || this.$t('security.biometricsSettingsUpdateFailed');
      } finally {
        this.loading = false;
      }
    },

    handleCancel() {
      this.$emit('input', false);
    },

    resetForm() {
      this.biometricsForUnlock = false;
      this.biometricsForPasswordAutofill = false;
      this.originalBiometricsForUnlock = false;
      this.originalBiometricsForPasswordAutofill = false;
      this.errorMessage = '';
      this.successMessage = '';
    }
  }
});
</script>

<style scoped>
.biometrics-settings-dialog {
  border-radius: 16px;
}
</style>