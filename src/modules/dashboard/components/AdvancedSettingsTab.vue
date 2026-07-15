<template>
  <v-tab-item>
    <v-layout class="py-2" column>
      <v-row no-gutters class="py-2" v-if="networks.resolveCashbackSupport(loggedWallet?.chain, loggedWallet?.network)">
        <v-col cols="9" class="text-left">
          <h3 style="color: white">{{ $t('settings.shopEarnPopups') }}</h3>
          <span class="helper my-0">{{ $t('settings.shopEarnPopupsHelper') }}</span>
        </v-col>
        <v-col cols="3" style="display: flex;">
          <ToggleSwitch text-left="OFF" text-right="ON" font-size="10px" v-model="cashbackPopups" style="margin: auto" />
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="9" class="text-left">
          <h3 style="color: white">{{ $t('settings.txAutoSubmit') }}</h3>
          <span class="helper my-0">{{ $t('settings.txAutoSubmitHelper') }}</span>
        </v-col>
        <v-col cols="3" style="display: flex;">
          <ToggleSwitch text-left="OFF" text-right="ON" font-size="10px" v-model="txAutoSubmit" style="margin: auto" />
        </v-col>
      </v-row>
      <v-row
        no-gutters
        class="py-2"
        v-if="networks.resolveStakingSupport(loggedWallet?.chain, loggedWallet?.network)"
      >
        <v-col cols="9" class="text-left">
          <h3 style="color: white">
            {{ $t('settings.autoWithdrawRewards') }}
            <v-icon color="error" x-small class="ml-1" v-if="isAutoWithdrawRewardsNew">
              mdi-circle
            </v-icon>
          </h3>
          <span class="helper my-0">{{ $t('settings.autoWithdrawRewardsHelper') }}</span>
        </v-col>
        <v-col cols="3" style="display: flex;">
          <ToggleSwitch text-left="OFF" text-right="ON" font-size="10px" v-model="autoWithdrawRewards" style="margin: auto" />
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="9" class="text-left">
          <h3 style="color: white">
            {{ $t('settings.extensionClickAction') }}
            <v-icon color="error" x-small class="ml-1" v-if="isDefaultExtensionModeNew">
              mdi-circle
            </v-icon>
          </h3>
          <span class="helper my-0">{{ $t('settings.extensionClickActionHelper') }}</span>
        </v-col>
        <v-col cols="3" style="display: flex;">
          <ToggleSwitch text-left="FULL" text-right="MINI" font-size="10px" v-model="openMiniGeroOnClick" style="margin: auto" />
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="9" class="text-left">
          <h3 style="color: white">{{ $t('settings.reSyncWallet') }}</h3>
          <span class="helper my-0">{{ $t('settings.reSyncWalletHelper') }}</span>
        </v-col>
        <v-col cols="3" style="align-content: center;">
          <v-btn
            block
            outlined
            color="white"
            @click="reSync"
            :disabled="reSyncLoading"
            :loading="reSyncLoading"
          >
            <v-icon
              left
              dark
              class="mr-1"
            >
              mdi-sync
            </v-icon>
            <span class="capitalize">{{ $t('settings.reSync') }}</span>
            <template v-slot:loader>
              <span class="custom-loader">
                <v-icon light>mdi-cached</v-icon>
              </span>
            </template>
          </v-btn>
        </v-col>
      </v-row>

      <!-- Midnight proof server. Full setup/details live on their own page
           (src/modules/midnight/ProofServerPage.vue, left-nav entry) - this
           is just an at-a-glance summary + link, chain-gated like the rest
           of the Midnight-only surfaces (grep pattern: loggedWallet?.chain
           === Blockchain.MIDNIGHT, see MidnightSendDialog.vue). -->
      <template v-if="loggedWallet?.chain === Blockchain.MIDNIGHT">
        <h2 class="text-left pt-2 pb-2 t-heading">{{ t('midnight.proofServer.title') }}</h2>
        <div class="proof-server-summary">
          <div class="proof-server-summary-icon">
            <v-icon size="18" color="var(--g-accent)">mdi-server-security</v-icon>
          </div>
          <div class="proof-server-summary-body">
            <div class="t-body-lg">{{ t('midnight.proofServerPage.settingsSummary') }}</div>
            <p class="t-caption proof-server-summary-hint mb-0">
              {{ proofServerModeDisplay }}
            </p>
          </div>
          <v-btn small outlined color="white" @click="router.push('/proof-server')">
            {{ t('midnight.proofServerPage.openPage') }}
          </v-btn>
        </div>
      </template>

      <h2 class="text-left pb-2" style="color: #ff6464">{{ $t('settings.dangerZone') }}</h2>
      <v-card outlined style="border-color: #ff6464; background-color: transparent!important;">
        <v-card-text>
          <v-row no-gutters class="py-2">
            <v-col cols="9" class="text-left pr-1">
              <h3 class="white--text">{{ $t('settings.deleteWallet') }}</h3>
              <span class="helper my-0">{{ $t('settings.deleteWalletHelper') }}</span>
            </v-col>
            <v-col cols="3" style="align-content: center;">
              <v-btn
                text
                class="px-1"
                color="error"
                @click="deleteWalletDialog = true"
                :disabled="deleteWalletLoading"
                :loading="deleteWalletLoading"
              >
                <v-icon right class="mr-1 ml-0">
                  mdi-delete
                </v-icon>
                {{ $t('settings.deleteWallet') }}
              </v-btn>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
      <v-dialog v-model="deleteWalletDialog" max-width="500px">
        <v-card>
          <v-card-title>{{ $t('settings.deleteWalletConfirmTitle') }}</v-card-title>
          <v-card-text>
            {{ $t('settings.deleteWalletConfirmMessage') }}
          </v-card-text>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn color="error" text @click="deleteWalletDialog = false" :disabled="deleteWalletLoading">{{ $t('common.cancel') }}</v-btn>
            <v-btn color="error" @click="deleteWalletConfirm" :disabled="deleteWalletLoading" :loading="deleteWalletLoading">{{ $t('common.yes') }}</v-btn>
            <v-spacer></v-spacer>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-layout>
  </v-tab-item>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
const { t } = useTranslation();
import { ref, computed, watch, onMounted, toRefs, getCurrentInstance } from 'vue';
import snackbar from '@/plugins/snackbar';
import { getTurnOff, setTurnOff } from '@bringweb3/chrome-extension-kit';
import networks from '@/utils/networks';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { Blockchain } from '@/models/types';
import { isFeatureNew, markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';
import GeroStore from '@/stores/geroStore';
import { setWalletConfiguration } from '@/db/wallet-db';
import cardStore from '@/stores/modules/card';

// Define emits
const emit = defineEmits(['loading']);

// Get reactive store properties
const { loggedWallet, config } = toRefs(walletStore);

// Access Vue instance for router
const vmProxy = getCurrentInstance()!.proxy as {
  $router: { push: (path: string) => void };
  $nextTick: (callback: () => void) => void;
};
const router = vmProxy.$router

// Reactive data
const reSyncLoading = ref<boolean>(false);
const deleteWalletDialog = ref<boolean>(false);
const deleteWalletLoading = ref<boolean>(false);
const cashbackPopupsDisabled = ref<boolean>(false);

// Computed properties
const txAutoSubmit = computed({
  get() {
    return config.value?.txAutoSubmit || false;
  },
  set(val: boolean) {
    if (config.value) {
      config.value.txAutoSubmit = val;
      setWalletConfiguration(loggedWallet.value.id, 'txAutoSubmit', val);
    }
  }
});

const autoWithdrawRewards = computed({
  get() {
    return config.value?.autoWithdrawRewards || false;
  },
  set(val: boolean) {
    if (config.value) {
      config.value.autoWithdrawRewards = val;
      setWalletConfiguration(loggedWallet.value.id, 'autoWithdrawRewards', val);
      markFeatureAsSeen('settings.advanced.autoWithdrawRewards');
    }
  }
});

const isAutoWithdrawRewardsNew = computed(() => isFeatureNew('settings.advanced.autoWithdrawRewards'));

const isDefaultExtensionModeNew = computed(() => isFeatureNew('settings.advanced.defaultExtensionMode'));

const openMiniGeroOnClick = ref(false);
const openMiniGeroInitialized = ref(false);

watch(openMiniGeroOnClick, (val) => {
  if (!openMiniGeroInitialized.value) return;
  // Write directly to chrome.storage from here — no intermediaries
  chrome.storage.local.set({ openMiniGeroOnClick: val });
  // Message background only for setPanelBehavior
  Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SET_OPEN_MINI_GERO_ON_CLICK,
    data: { value: val },
  });
});

const cashbackPopups = computed({
  get() {
    return !cashbackPopupsDisabled.value;
  },
  set(val: boolean) {
    cashbackPopupsDisabled.value = !val;
  }
});

// Watchers
watch(cashbackPopupsDisabled, (newVal) => {
  updateCashbackPopups(newVal);
});

// Methods
const loadCashbackPopups = async () => {
  const val = await getTurnOff();
  cashbackPopupsDisabled.value = val.isTurnedOff;
};

const updateCashbackPopups = async (val: boolean) => {
  await setTurnOff(val);
};

const reSync = async () => {
  reSyncLoading.value = true;
  emit('loading', true);
  await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.RESYNC,
    data: {},
  });
  reSyncLoading.value = false;
  emit('loading', false);
};

async function submitLogout() {
  await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.LOGOUT,
    data: { },
  }).then(() => {
    // // Wait for next tick to ensure wallet store is cleared before navigation
    vmProxy.$nextTick(() => {
      router.push('/welcome')
    })
  });
}

/**
 * Handle logout action
 */
async function handleCardLogout(): Promise<void> {
  try {
    await cardStore.logout();
  } catch (error) {
    console.error('Logout failed:', error);
  }
}

const deleteWalletConfirm = async () => {
  deleteWalletLoading.value = true;
  const walletId = loggedWallet.value.id;
  const name = loggedWallet.value.name;

  // Remove wallet from geroStore (this will also delete from database)
  await handleCardLogout().then(() => GeroStore.removeWallet(walletId));

  // Then logout
  await submitLogout();
  deleteWalletDialog.value = false;
  deleteWalletLoading.value = false;
  snackbar.fireSuccess(t('settings.walletDeletedSuccess', { name }));
};

// ─── Midnight proof server ─────────────────────────────────────────────────
//
// Read-only summary of midnightStore.proofServer - the full mode switcher,
// setup guides (local docker + Arkhia zkPaaS), and live health check live
// on their own page (src/modules/midnight/ProofServerPage.vue via
// useMidnightProofServer, the shared composable). Deliberately NOT
// invoking that composable here: it starts a health-poll loop whenever a
// wallet-side mode is selected, which this glance-and-link summary has no
// use for.

const { proofServer } = toRefs(midnightStore);

const proofServerModeDisplay = computed(() => {
  switch (proofServer.value.mode) {
    case 'local': return t('midnight.proofServer.localLabel');
    case 'zkpaas': return t('midnight.proofServer.zkpaasLabel');
    default: return t('midnight.proofServer.remoteLabel');
  }
});

// Lifecycle
onMounted(() => {
  loadCashbackPopups();
  // Read from its own chrome.storage key (independent of geroStore)
  chrome.storage.local.get('openMiniGeroOnClick', (result) => {
    openMiniGeroOnClick.value = !!result['openMiniGeroOnClick'];
    openMiniGeroInitialized.value = true;
  });
});
</script>
<style scoped>
.custom-loader {
  animation: loader 1s infinite;
  display: flex;
}
@-moz-keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(-360deg);
  }
}
@-webkit-keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(-360deg);
  }
}
@-o-keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(-360deg);
  }
}
@keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(-360deg);
  }
}

/* ── Midnight proof server (at-a-glance summary; full UI on its own page) ── */

.proof-server-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 12px 14px;
  margin-top: 4px;
  margin-bottom: 8px;
}

.proof-server-summary-icon {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  display: flex;
  align-items: center;
  justify-content: center;
}

.proof-server-summary-body {
  flex: 1;
  min-width: 0;
}

.proof-server-summary-hint {
  margin-top: 2px;
}
</style>
