<template>
  <div class="lock-screen">
    <div class="content">
      <v-icon size="48" color="#00c7f3" class="mb-4">mdi-lock-outline</v-icon>
      <h2 class="white--text text-h6 mb-1">{{ $t('miniGero.walletLocked') }}</h2>
      <p class="grey--text text-body-2 mb-4">{{ walletName }}</p>

      <v-text-field
        v-model="password"
        :type="showPassword ? 'text' : 'password'"
        :placeholder="$t('miniGero.enterPassword')"
        outlined
        dense
        dark
        hide-details
        class="mb-3"
        :append-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
        @click:append="showPassword = !showPassword"
        @keydown.enter="unlock"
        :error="!!error"
      />

      <p v-if="error" class="red--text text-caption mb-2">{{ error }}</p>

      <v-btn
        class="geroButton"
        block
        rounded
        depressed
        :loading="loading"
        :disabled="!password"
        @click="unlock"
      >
        {{ $t('miniGero.unlock') }}
      </v-btn>

      <v-btn text small class="mt-3 grey--text" @click="openDashboard">
        {{ $t('miniGero.forgotPassword') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

const password = ref('');
const showPassword = ref(false);
const loading = ref(false);
const error = ref('');

const walletName = computed(() => walletStore.loggedWallet?.name || 'Wallet');

async function unlock() {
  if (!password.value) return;
  loading.value = true;
  error.value = '';

  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: password.value },
    });

    if (response.data.success) {
      // Wallet unlocked — App.vue reactivity will show main UI
    } else {
      error.value = response.data.error || 'Invalid password';
    }
  } catch (e: any) {
    error.value = e.message || 'Unlock failed';
  } finally {
    loading.value = false;
  }
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html#/welcome') });
}
</script>

<style scoped>
.lock-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: #0a0a0a;
}

.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px;
  width: 100%;
  max-width: 320px;
}
</style>
