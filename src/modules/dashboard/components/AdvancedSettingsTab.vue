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

      <!-- Midnight proof server (WP-P4). Chain-gated like the rest of the
           Midnight-only surfaces (grep pattern: loggedWallet?.chain ===
           Blockchain.MIDNIGHT, see MidnightSendDialog.vue). -->
      <template v-if="loggedWallet?.chain === Blockchain.MIDNIGHT">
        <h2 class="text-left pt-2 pb-2 t-heading">{{ t('midnight.proofServer.title') }}</h2>
        <v-radio-group
          v-model="proofServerMode"
          hide-details
          class="proof-server-modes mt-0 mb-2"
          :disabled="proofServerSaving"
        >
          <v-radio value="remote" color="var(--g-accent)" class="mb-2">
            <template v-slot:label>
              <div>
                <div class="t-body-lg">{{ t('midnight.proofServer.remoteLabel') }}</div>
                <div class="t-caption proof-server-radio-hint">{{ t('midnight.proofServer.remoteHint') }}</div>
              </div>
            </template>
          </v-radio>
          <v-radio value="local" color="var(--g-accent)">
            <template v-slot:label>
              <div>
                <div class="t-body-lg">{{ t('midnight.proofServer.localLabel') }}</div>
                <div class="t-caption proof-server-radio-hint">{{ t('midnight.proofServer.localHint') }}</div>
              </div>
            </template>
          </v-radio>
        </v-radio-group>

        <div v-if="proofServerMode === 'local'" class="proof-server-panel">
          <div class="t-caption mb-1">{{ t('midnight.proofServer.runCommand') }}</div>
          <div class="proof-server-command-row">
            <code class="proof-server-command g-mono">{{ dockerRunCommand }}</code>
            <CopyButton :value="dockerRunCommand" small />
          </div>
          <p class="t-caption proof-server-note mb-0">{{ t('midnight.proofServer.firstRunNote') }}</p>

          <v-text-field
            v-model="localUrlDraft"
            :label="t('midnight.proofServer.urlLabel')"
            outlined
            dense
            hide-details="auto"
            class="mt-3 proof-server-url-field"
            :error-messages="localUrlError ? [localUrlError] : []"
            :disabled="proofServerSaving"
            @blur="onLocalUrlBlur"
          />

          <div class="proof-server-status-row">
            <div class="status-pill t-caption" :class="`status-pill--${healthStatus}`">
              <v-progress-circular
                v-if="healthStatus === 'checking'"
                indeterminate
                size="12"
                width="2"
                color="var(--g-text-3)"
              />
              <span v-else class="status-dot" :class="`status-dot--${healthStatus}`"></span>
              <span class="status-pill-label">{{ healthStatusLabel }}</span>
            </div>
            <v-btn small outlined color="white" :loading="testingConnection" @click="testConnection">
              {{ t('midnight.proofServer.testConnection') }}
            </v-btn>
          </div>
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
import { ref, computed, watch, onMounted, onUnmounted, toRefs, getCurrentInstance } from 'vue';
import snackbar from '@/plugins/snackbar';
import { getTurnOff, setTurnOff } from '@bringweb3/chrome-extension-kit';
import networks from '@/utils/networks';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
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

// ─── Midnight proof server (WP-P4) ────────────────────────────────────────
//
// Mode (remote/local) + local URL live in midnightStore.proofServer (WP-P1).
// Browser contexts can't write the store directly — midnightStore's own
// broadcastFromBackground guard is a no-op outside the background context —
// so both the mode radio and the URL field round-trip through BG via
// SET_MIDNIGHT_PROOF_SERVER, mirroring how the shielded-proving consent
// dialog persists its own setting. See src/stores/midnightStore.ts header
// comment for the store's broadcast/hydrate contract.

const { proofServer } = toRefs(midnightStore);

/**
 * Pinned to the 8.x proof-server release that matches the installed
 * @midnight-ntwrk/ledger-v8 (^8.1.0) — verified against Docker Hub
 * (midnightntwrk/proof-server tags) on 2026-07-13. Deliberately not
 * `latest`, which currently tracks the 9.0.0-rc stream (a newer, mismatched
 * ledger generation) — see
 * docs/plans/2026-07-13-midnight-proof-server-setting.md section 0.
 */
const PROOF_SERVER_DOCKER_TAG = '8.1.0';
const dockerRunCommand = `docker run -p 6300:6300 midnightntwrk/proof-server:${PROOF_SERVER_DOCKER_TAG} midnight-proof-server -v`;

const proofServerSaving = ref(false);

async function saveProofServer(next: { mode: 'remote' | 'local'; localUrl: string }) {
  proofServerSaving.value = true;
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SET_MIDNIGHT_PROOF_SERVER,
      data: next,
    }) as { data: { success: boolean; error?: string } };
    if (!response?.data?.success) {
      throw new Error(response?.data?.error || 'Failed to save proof server preference');
    }
  } catch (e) {
    snackbar.setError(e instanceof Error ? e.message : String(e));
  } finally {
    proofServerSaving.value = false;
  }
}

const proofServerMode = computed<'remote' | 'local'>({
  get: () => proofServer.value.mode,
  set: (mode) => {
    if (mode === proofServer.value.mode) return;
    void saveProofServer({ mode, localUrl: proofServer.value.localUrl });
  },
});

const localUrlDraft = ref(proofServer.value.localUrl);
const localUrlError = ref('');

// Keep the draft in sync with externally-applied changes (another open tab,
// or our own save above round-tripping back through the store broadcast).
watch(() => proofServer.value.localUrl, (next) => {
  localUrlDraft.value = next;
});

function validateProofServerUrl(value: string): string {
  if (!value) return t('midnight.proofServer.urlInvalid');
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return t('midnight.proofServer.urlInvalid');
    }
  } catch {
    return t('midnight.proofServer.urlInvalid');
  }
  return '';
}

async function onLocalUrlBlur() {
  const value = localUrlDraft.value.trim();
  const error = validateProofServerUrl(value);
  localUrlError.value = error;
  if (error) return;
  if (value === proofServer.value.localUrl) return;
  await saveProofServer({ mode: proofServer.value.mode, localUrl: value });
  if (isLocalSectionVisible.value) startHealthPolling();
}

// Live status chip: GET {localUrl}/health every 4s while the local panel is
// visible. Runs in this extension-page context directly (not via BG) —
// that's what the prod CSP localhost entries (WP-P6) exist for. Reuses
// checkProofServerHealth from midnightLocalProver.ts (WP-P2) rather than
// re-implementing the fetch/timeout — dynamic import keeps the ledger-v8
// dependency out of this component's own chunk until the section is
// actually visited.
type ProofServerHealthStatus = 'checking' | 'detected' | 'notDetected';
const healthStatus = ref<ProofServerHealthStatus>('checking');
const testingConnection = ref(false);
let healthPollTimer: ReturnType<typeof setInterval> | null = null;
let healthCheckInFlight = false;

async function runHealthCheck(url: string) {
  if (healthCheckInFlight) return;
  healthCheckInFlight = true;
  try {
    const { checkProofServerHealth } = await import('@/chains/midnight/midnightLocalProver');
    const healthy = await checkProofServerHealth(url);
    healthStatus.value = healthy ? 'detected' : 'notDetected';
  } finally {
    healthCheckInFlight = false;
  }
}

function stopHealthPolling() {
  if (healthPollTimer !== null) {
    clearInterval(healthPollTimer);
    healthPollTimer = null;
  }
}

function startHealthPolling() {
  stopHealthPolling();
  healthStatus.value = 'checking';
  void runHealthCheck(proofServer.value.localUrl);
  healthPollTimer = setInterval(() => {
    void runHealthCheck(proofServer.value.localUrl);
  }, 4000);
}

async function testConnection() {
  testingConnection.value = true;
  try {
    await runHealthCheck(proofServer.value.localUrl);
  } finally {
    testingConnection.value = false;
  }
}

const healthStatusLabel = computed(() => {
  switch (healthStatus.value) {
    case 'detected': return t('midnight.proofServer.statusDetected');
    case 'notDetected': return t('midnight.proofServer.statusNotDetected');
    default: return t('midnight.proofServer.statusChecking');
  }
});

// Gate: only poll while the section is actually on screen (Midnight wallet +
// local mode selected). No background polling when remote, non-Midnight, or
// unmounted (Settings dialog closed).
const isLocalSectionVisible = computed(
  () => loggedWallet.value?.chain === Blockchain.MIDNIGHT && proofServerMode.value === 'local',
);

watch(
  isLocalSectionVisible,
  (visible) => {
    if (visible) startHealthPolling();
    else stopHealthPolling();
  },
  { immediate: true },
);

onUnmounted(() => {
  stopHealthPolling();
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

/* ── Midnight proof server (WP-P4) ──────────────────────────────────────── */

.proof-server-radio-hint {
  margin-top: 2px;
}

.proof-server-panel {
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 14px 16px;
  margin-top: 4px;
  margin-bottom: 8px;
}

.proof-server-command-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  padding: 8px 10px;
}

.proof-server-command {
  flex: 1 1 auto;
  min-width: 0;
  background: transparent;
  padding: 0;
}

.proof-server-note {
  margin-top: 8px;
}

.proof-server-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
}

.status-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
}

.status-pill-label {
  color: var(--g-text-1);
  font-weight: 600;
}

.status-pill--detected {
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot--detected { background: var(--g-success); }
.status-dot--notDetected { background: var(--g-text-3); }
</style>
