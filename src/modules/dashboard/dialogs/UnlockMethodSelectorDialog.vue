<template>
  <v-dialog
    :value="value"
    max-width="500px"
    @input="$emit('input', $event)"
  >
    <v-card class="unlock-method-selector-dialog">
      <v-card-title class="headline text-center">
        <v-icon left color="primary" large>mdi-lock-outline</v-icon>
        {{ $t('security.selectUnlockMethod') }}
      </v-card-title>

      <v-card-text class="pt-6">
        <v-list>
          <!-- None -->
          <v-list-item @click="handleSelect(null)">
            <v-list-item-avatar>
              <v-icon>mdi-lock-off-outline</v-icon>
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ $t('security.none') }}</v-list-item-title>
              <v-list-item-subtitle>{{ $t('security.noUnlockMethodRequired') }}</v-list-item-subtitle>
            </v-list-item-content>
            <v-list-item-icon v-if="currentMethod === null">
              <v-icon color="primary">mdi-check-circle</v-icon>
            </v-list-item-icon>
          </v-list-item>

          <v-divider />

          <!-- PIN Code -->
          <v-list-item @click="handleSelect('pin')">
            <v-list-item-avatar>
              <v-icon>mdi-numeric</v-icon>
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ $t('security.pin') }}</v-list-item-title>
              <v-list-item-subtitle>{{ $t('security.4To6DigitCode') }}</v-list-item-subtitle>
            </v-list-item-content>
            <v-list-item-icon v-if="currentMethod === 'pin'">
              <v-icon color="primary">mdi-check-circle</v-icon>
            </v-list-item-icon>
          </v-list-item>

          <v-divider />

          <!-- Pattern -->
          <v-list-item @click="handleSelect('pattern')">
            <v-list-item-avatar>
              <v-icon>mdi-gesture</v-icon>
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ $t('security.pattern') }}</v-list-item-title>
              <v-list-item-subtitle>{{ $t('security.drawPatternToUnlock') }}</v-list-item-subtitle>
            </v-list-item-content>
            <v-list-item-icon v-if="currentMethod === 'pattern'">
              <v-icon color="primary">mdi-check-circle</v-icon>
            </v-list-item-icon>
          </v-list-item>

          <v-divider />

          <!-- Biometrics -->
          <v-list-item @click="handleSelect('biometrics')" disabled>
            <v-list-item-avatar>
              <v-icon>mdi-fingerprint</v-icon>
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ $t('security.biometrics') }}</v-list-item-title>
              <v-list-item-subtitle>{{ $t('security.comingSoon') }}</v-list-item-subtitle>
            </v-list-item-content>
            <v-list-item-icon v-if="currentMethod === 'biometrics'">
              <v-icon color="primary">mdi-check-circle</v-icon>
            </v-list-item-icon>
          </v-list-item>
        </v-list>
      </v-card-text>

      <v-card-actions class="px-6 pb-6">
        <v-btn
          text
          block
          @click="$emit('input', false)"
        >
          {{ $t('common.cancel') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
  name: 'UnlockMethodSelectorDialog',

  props: {
    value: {
      type: Boolean,
      required: true
    },
    currentMethod: {
      type: String as () => string | null,
      default: null
    }
  },

  methods: {
    async handleSelect(method: string | null) {
      if (method === null) {
        // Remove unlock method
        await this.removeUnlockMethod();
        this.$emit('input', false);
        this.$emit('updated');
      } else {
        // Emit selection to parent to open appropriate setup dialog
        this.$emit('select', method);
        this.$emit('input', false);
      }
    },

    async removeUnlockMethod() {
      try {
        const { walletStore } = await import('@/stores/walletStore');
        const wallet = walletStore.loggedWallet;
        if (!wallet) return;

        const { getDb } = await import('@/db/wallet-db');
        const db = await getDb(wallet.id);
        const configTable = db.table('config');

        // Remove unlock method and associated data
        await configTable.put({ key: 'unlockMethod', value: null });
        await configTable.where({ key: 'encryptedPinHash' }).delete();
        await configTable.where({ key: 'encryptedPatternHash' }).delete();
        await configTable.where({ key: 'webAuthnCredentialId' }).delete();
      } catch (error) {
        console.error('Error removing unlock method:', error);
      }
    }
  }
});
</script>

<style scoped>
.unlock-method-selector-dialog {
  border-radius: 16px;
}
</style>
