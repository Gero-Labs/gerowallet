<template>
  <v-window-item>
    <div class="d-flex flex-column py-2">
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
            <v-icon color="error" size="x-small" class="ml-1" v-if="isAutoWithdrawRewardsNew">
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
            <v-icon color="error" size="x-small" class="ml-1" v-if="isDefaultExtensionModeNew">
              mdi-circle
            </v-icon>
          </h3>
          <span class="helper my-0">{{ $t('settings.extensionClickActionHelper') }}</span>
        </v-col>
        <v-col cols="3" style="display: flex;">
          <ToggleSwitch text-left="FULL" text-right="MINI" font-size="10px" v-model="openMiniGeroOnClick" style="margin: auto" />
        </v-col>
      </v-row>
      <!-- Only rendered when the dock could exist at all: with both flags off
           there is nothing for this switch to show or hide. -->
      <v-row no-gutters class="py-2" v-if="isSupportChatAvailable">
        <v-col cols="9" class="text-left">
          <h3 style="color: white">{{ $t('settings.supportChatButton') }}</h3>
          <span class="helper my-0">{{ $t('settings.supportChatButtonHelper') }}</span>
        </v-col>
        <v-col cols="3" style="display: flex;">
          <ToggleSwitch text-left="OFF" text-right="ON" font-size="10px" v-model="supportChatButton" style="margin: auto" />
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
            variant="outlined"
            color="white"
            @click="reSync"
            :disabled="reSyncLoading"
            :loading="reSyncLoading"
          >
            <v-icon
              start
              theme="dark"
              class="mr-1"
            >
              mdi-sync
            </v-icon>
            <span class="capitalize">{{ $t('settings.reSync') }}</span>
            <template v-slot:loader>
              <span class="custom-loader">
                <v-icon theme="light">mdi-cached</v-icon>
              </span>
            </template>
          </v-btn>
        </v-col>
      </v-row>
      <SubmitApiSettingsRow v-if="loggedWallet?.chain === Blockchain.CARDANO" />

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
          <v-btn size="small" variant="outlined" color="white" @click="router.push('/proof-server')">
            {{ t('midnight.proofServerPage.openPage') }}
          </v-btn>
        </div>
      </template>

      <h2 class="text-left pb-2" style="color: #ff6464">{{ $t('settings.dangerZone') }}</h2>
      <v-card variant="outlined" style="border-color: #ff6464; background-color: transparent!important;">
        <v-card-text>
          <v-row no-gutters class="py-2">
            <v-col cols="9" class="text-left pr-1">
              <h3 class="white--text">{{ $t(isAddedAccount ? 'accounts.removeAccount' : 'settings.deleteWallet') }}</h3>
              <span class="helper my-0">{{ $t(isAddedAccount ? removeAccountCopy.helper : 'settings.deleteWalletHelper') }}</span>
            </v-col>
            <v-col cols="3" style="align-content: center;">
              <v-btn
                variant="text"
                class="px-1"
                color="error"
                @click="deleteWalletDialog = true"
                :disabled="deleteWalletLoading"
                :loading="deleteWalletLoading"
              >
                <v-icon end class="mr-1 ml-0">
                  mdi-delete
                </v-icon>
                {{ $t(isAddedAccount ? 'accounts.removeAccount' : 'settings.deleteWallet') }}
              </v-btn>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
      <v-dialog v-model="deleteWalletDialog" max-width="500px">
        <v-card>
          <v-card-title>{{ $t('settings.deleteWalletConfirmTitle') }}</v-card-title>
          <v-card-text>
            <template v-if="isAddedAccount">{{ $t(removeAccountCopy.explanation) }}</template>
            <template v-else>{{ $t('settings.deleteWalletConfirmMessage') }}</template>
            <p v-if="addedAccounts.length" class="mt-2 mb-0">
              {{ $t('accounts.deleteGroupExplanation', { names: addedAccounts.map((account) => account.name).join(', ') }) }}
            </p>
          </v-card-text>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn color="error" variant="text" @click="deleteWalletDialog = false" :disabled="deleteWalletLoading">{{ $t('common.cancel') }}</v-btn>
            <v-btn color="error" @click="deleteWalletConfirm" :disabled="deleteWalletLoading" :loading="deleteWalletLoading">{{ $t('common.yes') }}</v-btn>
            <v-spacer></v-spacer>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </div>
  </v-window-item>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
const { t } = useTranslation();
import { ref, computed, watch, onMounted, toRefs, getCurrentInstance } from 'vue';
import snackbar from '@/plugins/snackbar';
import { getTurnOff, setTurnOff } from '@bringweb3/chrome-extension-kit';
import { forgetBringWalletAddress } from '@/chrome/bringAddressSharing';
import networks from '@/utils/networks';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import SubmitApiSettingsRow from '@/modules/dashboard/components/SubmitApiSettingsRow.vue';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { Blockchain, type Wallet } from '@/models/types';
import { isFeatureNew, markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';
import GeroStore, { geroStore } from '@/stores/geroStore';
import { childAccounts, isHardwareWallet, parentWallet, walletDisplayName } from '@/shared/utils/walletAccount';
import { agentDockPrefsStore } from '@/stores/agentDockPrefsStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
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

// The one way back after hiding the dock from its own header (AgentDock.vue's
// hide confirmation names this switch by the label below, so the two must stay
// in sync). Stored inverted: the store persists "hidden", the switch shows
// "shown", because an ON/OFF switch reading "on = gone" is a trap.
const isSupportChatAvailable = computed(
  () => featureFlagsStore.isCopilotEnabled() || featureFlagsStore.isLiveChatEnabled(),
);

const supportChatButton = computed({
  get() {
    return !agentDockPrefsStore.hidden;
  },
  set(val: boolean) {
    agentDockPrefsStore.setHidden(!val);
  },
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
  // Off also stops sharing the wallet address with Bring (the background checks
  // the same opt-out): drop the copy Bring's worker already stored.
  if (val) await forgetBringWalletAddress();
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

// Multi-account: an added account is removed on its own; deleting the wallet that
// heads a group removes its added accounts with it, since they are listed under it.
const loggedRecord = computed(() => (loggedWallet.value ? geroStore.wallets[loggedWallet.value.id] ?? loggedWallet.value : null));
const isAddedAccount = computed(() => !!loggedRecord.value && !!parentWallet(loggedRecord.value, geroStore.wallets));
// Where the removed account's funds stay: on the device, or with the recovery phrase.
const removeAccountCopy = computed(() => (loggedRecord.value && isHardwareWallet(loggedRecord.value)
  ? { helper: 'accounts.removeAccountHelper', explanation: 'accounts.removeAccountExplanation' }
  : { helper: 'accounts.removeAccountHelperSeed', explanation: 'accounts.removeAccountExplanationSeed' }));
const addedAccounts = computed(() => (loggedRecord.value && !isAddedAccount.value ? childAccounts(loggedRecord.value, geroStore.wallets) : []));

// Logs in to `wallet`, as the drawer's account switcher does: within an unlocked
// wallet, switching accounts asks for nothing.
async function switchToWallet(wallet: Wallet): Promise<boolean> {
  try {
    const response = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.LOGIN, data: { wallet } });
    return !!(response as { data?: { success?: boolean } } | undefined)?.data?.success;
  } catch {
    return false;
  }
}

const deleteWalletConfirm = async () => {
  deleteWalletLoading.value = true;
  const name = isAddedAccount.value ? walletDisplayName(loggedRecord.value!, geroStore.wallets) : loggedWallet.value.name;
  const walletIds = [loggedWallet.value.id, ...addedAccounts.value.map((account) => account.id)];
  // Removing an added account keeps the user in its wallet: switch to account #0 first,
  // so the record being removed is never the logged one. Deleting account #0 logs out.
  const head = isAddedAccount.value ? parentWallet(loggedRecord.value!, geroStore.wallets) : undefined;

  await handleCardLogout();
  const switched = head ? await switchToWallet(head) : false;
  for (const walletId of walletIds) {
    // Push notifications: queue the server-side unlink durably BEFORE the wallet record
    // and its keys are deleted (the worker retries it on later starts if it fails now).
    await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.NOTIFY_WALLET_REMOVED, data: { walletId } });
    // Midnight: drop this wallet's coin state, history and balances (PRIV-01).
    // Also BEFORE removeWallet: the background reads the address from the record.
    await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.FORGET_MIDNIGHT_WALLET_DATA, data: { walletId } });
    // Remove wallet from geroStore (this will also delete from database)
    GeroStore.removeWallet(walletId);
  }

  // Then logout, unless the user is now on account #0
  if (!switched) await submitLogout();
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
<style scoped lang="scss">
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
  @include g-glass-tier(false);
  display: flex;
  align-items: center;
  gap: 12px;
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
