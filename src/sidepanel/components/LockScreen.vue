<template>
  <div class="lock-screen">
    <div class="content">
      <v-icon size="48" :color="primaryColor" class="mb-4">mdi-lock-outline</v-icon>
      <h2 class="white--text text-h6 mb-1">{{ $t('miniGero.walletLocked') }}</h2>
      <p class="grey--text text-body-2 mb-4">{{ walletName }}</p>

      <!-- Loading config -->
      <div v-if="!configLoaded" class="text-center py-4">
        <v-progress-circular indeterminate size="24" :color="primaryColor" />
      </div>

      <template v-else>
        <!-- PIN unlock -->
        <template v-if="unlockMethod === 'pin'">
          <p class="text-caption grey--text mb-3 text-center">{{ $t('security.enterPinToUnlock') }}</p>
          <NumericOtpInput
            ref="pinInputRef"
            v-model="pinCode"
            :length="pinLength"
            :error="pinError"
            @finish="handlePinFinish"
          />
        </template>

        <!-- Pattern unlock — redirect to dashboard -->
        <template v-else-if="unlockMethod === 'pattern'">
          <p class="text-caption grey--text mb-3 text-center">{{ $t('security.drawPatternToUnlock') }}</p>
          <v-btn
            block
            outlined
            class="mb-3 dashboard-btn"
            @click="openDashboard"
          >
            <v-icon small class="mr-2">mdi-open-in-new</v-icon>
            {{ $t('miniGero.unlockInDashboard') }}
          </v-btn>
        </template>

        <!-- Password unlock (default / fallback) -->
        <template v-else>
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
            @keydown.enter="handlePasswordUnlock"
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
            @click="handlePasswordUnlock"
          >
            {{ $t('miniGero.unlock') }}
          </v-btn>
        </template>

        <!-- Logout option (always available) -->
        <v-btn text small class="mt-4 logout-btn" @click="handleLogout" :loading="loggingOut">
          {{ $t('security.logoutInstead') }}
        </v-btn>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import NumericOtpInput from '@/shared/components/NumericOtpInput.vue';
import { useChainContext } from '../composables/useChainContext';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const password = ref('');
const showPassword = ref(false);
const loading = ref(false);
const loggingOut = ref(false);
const error = ref('');

const pinCode = ref('');
const pinLength = ref(6);
const pinError = ref('');
const pinInputRef = ref<any>(null);

const unlockMethod = ref<string | null>(null);
const configLoaded = ref(false);

const walletName = computed(() => walletStore.loggedWallet?.name || 'Wallet');

onMounted(async () => {
  await loadSecurityConfig();
});

async function loadSecurityConfig() {
  try {
    const walletId = walletStore.loggedWallet?.id;
    if (!walletId) {
      configLoaded.value = true;
      return;
    }

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(walletId);
    const configTable = db.table('config');

    const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();
    const pinLengthConfig = await configTable.where({ key: 'pinLength' }).first();

    unlockMethod.value = unlockMethodConfig?.value || null;
    pinLength.value = pinLengthConfig?.value || 6;

    configLoaded.value = true;
  } catch (e) {
    console.error('Failed to load security config:', e);
    configLoaded.value = true;
  }
}

async function handlePinFinish(pin: string) {
  pinCode.value = pin;
  loading.value = true;
  pinError.value = '';

  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.UNLOCK,
      data: { unlockCredential: pin, unlockMethod: 'pin' },
    });

    if (!response.data.success) {
      pinError.value = response.data.error || 'Incorrect PIN';
      pinCode.value = '';
    }
  } catch (e: any) {
    pinError.value = e.message || 'Unlock failed';
    pinCode.value = '';
  } finally {
    loading.value = false;
  }
}

async function handlePasswordUnlock() {
  if (!password.value) return;
  loading.value = true;
  error.value = '';

  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.UNLOCK,
      data: {
        unlockCredential: password.value,
        unlockMethod: unlockMethod.value || 'password',
        password: password.value,
      },
    });

    if (!response.data.success) {
      error.value = response.data.error || 'Invalid password';
    }
  } catch (e: any) {
    error.value = e.message || 'Unlock failed';
  } finally {
    password.value = '';
    loading.value = false;
  }
}

async function handleLogout() {
  try {
    loggingOut.value = true;
    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGOUT,
      data: {},
    });
  } catch (e) {
    console.error('Logout error:', e);
  } finally {
    loggingOut.value = false;
  }
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
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

.dashboard-btn {
  border-color: #333 !important;
  color: var(--chain-primary) !important;
  text-transform: none !important;
  font-weight: 600 !important;
  font-size: 13px !important;
  letter-spacing: 0 !important;
  border-radius: 10px !important;
  height: 40px !important;
}

.logout-btn {
  color: #F97066 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
}
</style>
