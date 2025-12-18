<template>
  <v-dialog
    :value="value"
    max-width="500px"
    @input="$emit('input', $event)"
  >
    <v-card class="auto-lock-dialog">
      <v-card-title class="headline text-center">
        <v-icon left color="primary" large>mdi-timer-lock-outline</v-icon>
        {{ $t('security.autoLockTimer') }}
      </v-card-title>

      <v-card-text class="pt-6">
        <div class="text-center mb-4">
          <div class="subtitle-1">{{ $t('security.selectAutoLockTime') }}</div>
          <div class="caption">{{ $t('security.walletLocksAfterInactivity') }}</div>
        </div>

        <v-list>
          <!-- Never -->
          <v-list-item @click="handleSelect(0)">
            <v-list-item-avatar>
              <v-icon>mdi-infinity</v-icon>
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ $t('security.never') }}</v-list-item-title>
            </v-list-item-content>
            <v-list-item-icon v-if="currentMinutes === 0">
              <v-icon color="primary">mdi-check-circle</v-icon>
            </v-list-item-icon>
          </v-list-item>

          <v-divider />

          <!-- 1 Minute -->
          <v-list-item @click="handleSelect(1)">
            <v-list-item-avatar>
              <v-icon>mdi-timer-outline</v-icon>
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ $t('security.1Minute') }}</v-list-item-title>
            </v-list-item-content>
            <v-list-item-icon v-if="currentMinutes === 1">
              <v-icon color="primary">mdi-check-circle</v-icon>
            </v-list-item-icon>
          </v-list-item>

          <v-divider />

          <!-- 5 Minutes -->
          <v-list-item @click="handleSelect(5)">
            <v-list-item-avatar>
              <v-icon>mdi-timer-outline</v-icon>
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ $t('security.xMinutes', { minutes: 5 }) }}</v-list-item-title>
            </v-list-item-content>
            <v-list-item-icon v-if="currentMinutes === 5">
              <v-icon color="primary">mdi-check-circle</v-icon>
            </v-list-item-icon>
          </v-list-item>

          <v-divider />

          <!-- 15 Minutes -->
          <v-list-item @click="handleSelect(15)">
            <v-list-item-avatar>
              <v-icon>mdi-timer-outline</v-icon>
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ $t('security.xMinutes', { minutes: 15 }) }}</v-list-item-title>
            </v-list-item-content>
            <v-list-item-icon v-if="currentMinutes === 15">
              <v-icon color="primary">mdi-check-circle</v-icon>
            </v-list-item-icon>
          </v-list-item>

          <v-divider />

          <!-- 30 Minutes -->
          <v-list-item @click="handleSelect(30)">
            <v-list-item-avatar>
              <v-icon>mdi-timer-outline</v-icon>
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ $t('security.xMinutes', { minutes: 30 }) }}</v-list-item-title>
            </v-list-item-content>
            <v-list-item-icon v-if="currentMinutes === 30">
              <v-icon color="primary">mdi-check-circle</v-icon>
            </v-list-item-icon>
          </v-list-item>

          <v-divider />

          <!-- 1 Hour -->
          <v-list-item @click="handleSelect(60)">
            <v-list-item-avatar>
              <v-icon>mdi-clock-outline</v-icon>
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ $t('security.1Hour') }}</v-list-item-title>
            </v-list-item-content>
            <v-list-item-icon v-if="currentMinutes === 60">
              <v-icon color="primary">mdi-check-circle</v-icon>
            </v-list-item-icon>
          </v-list-item>

          <v-divider />

          <!-- 2 Hours -->
          <v-list-item @click="handleSelect(120)">
            <v-list-item-avatar>
              <v-icon>mdi-clock-outline</v-icon>
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ $t('security.xHours', { hours: 2 }) }}</v-list-item-title>
            </v-list-item-content>
            <v-list-item-icon v-if="currentMinutes === 120">
              <v-icon color="primary">mdi-check-circle</v-icon>
            </v-list-item-icon>
          </v-list-item>

          <v-divider />

          <!-- Custom -->
          <v-list-item @click="showCustomInput = true">
            <v-list-item-avatar>
              <v-icon>mdi-pencil-outline</v-icon>
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ $t('security.custom') }}</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
        </v-list>

        <!-- Custom Input -->
        <v-expand-transition>
          <div v-if="showCustomInput" class="mt-4">
            <v-text-field
              v-model="customMinutes"
              :label="$t('security.minutesLabel')"
              type="number"
              outlined
              dense
              min="1"
              max="1440"
              @keyup.enter="handleCustomSave"
            >
              <template v-slot:append-outer>
                <v-btn
                  color="primary"
                  @click="handleCustomSave"
                  :disabled="!customMinutes || customMinutes < 1"
                >
                  {{ $t('common.save') }}
                </v-btn>
              </template>
            </v-text-field>
          </div>
        </v-expand-transition>

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
          block
          @click="$emit('input', false)"
          :disabled="loading"
        >
          {{ $t('common.cancel') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import Vue from 'vue';
import { walletStore } from '@/stores/walletStore';

export default Vue.extend({
  name: 'AutoLockDialog',

  props: {
    value: {
      type: Boolean,
      required: true
    }
  },

  data() {
    return {
      currentMinutes: 0,
      customMinutes: null as number | null,
      showCustomInput: false,
      loading: false,
      errorMessage: '',
      successMessage: ''
    };
  },

  watch: {
    value(newVal) {
      if (newVal) {
        this.loadCurrentAutoLock();
      } else {
        this.resetForm();
      }
    }
  },

  methods: {
    async loadCurrentAutoLock() {
      try {
        const wallet = walletStore.loggedWallet;
        if (!wallet) return;

        const { getDb } = await import('@/db/wallet-db');
        const db = await getDb(wallet.id);
        const configTable = db.table('config');

        const autoLockConfig = await configTable.where({ key: 'autoLockMinutes' }).first();
        this.currentMinutes = autoLockConfig?.value || 0;
      } catch (error) {
        console.error('Error loading auto-lock setting:', error);
        this.currentMinutes = 0;
      }
    },

    async handleSelect(minutes: number) {
      this.loading = true;
      this.errorMessage = '';

      try {
        const wallet = walletStore.loggedWallet;
        if (!wallet) {
          throw new Error('No wallet logged in');
        }

        // Save to database
        const { getDb } = await import('@/db/wallet-db');
        const db = await getDb(wallet.id);
        const configTable = db.table('config');

        await configTable.put({ key: 'autoLockMinutes', value: minutes });

        this.currentMinutes = minutes;

        // Close dialog after short delay
        setTimeout(() => {
          this.$emit('input', false);
          this.$emit('updated');
        }, 1000);
      } catch (error: any) {
        console.error('Error saving auto-lock setting:', error);
        this.errorMessage = error.message || this.$t('security.autoLockUpdateFailed');
      } finally {
        this.loading = false;
      }
    },

    async handleCustomSave() {
      if (!this.customMinutes || this.customMinutes < 1) return;

      await this.handleSelect(this.customMinutes);
      this.showCustomInput = false;
      this.customMinutes = null;
    },

    resetForm() {
      this.currentMinutes = 0;
      this.customMinutes = null;
      this.showCustomInput = false;
      this.errorMessage = '';
      this.successMessage = '';
    }
  }
});
</script>

<style scoped>
.auto-lock-dialog {
  border-radius: 16px;
}
</style>
