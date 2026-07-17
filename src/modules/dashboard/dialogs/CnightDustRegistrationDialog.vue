<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="t('midnight.cnightRegisterTitle')"
    :subtitle="t('midnight.cnightRegisterSubtitle')"
    icon="mdi-star-four-points-outline"
    :width="560"
    :min-height="440"
  >
    <v-card-text class="px-0" style="z-index: 1">
      <!-- Status pill: same shape as DustRegistrationDialog so the two DUST
           surfaces read as one feature across chains. -->
      <div class="status-pill" :class="`status-pill--${statusKey}`">
        <span class="status-dot" :class="`status-dot--${statusKey}`"></span>
        <span class="status-pill-label">{{ statusLabel }}</span>
        <v-spacer />
        <span class="status-pill-help">{{ statusHelp }}</span>
      </div>

      <!-- Holdings card: what generates, and where it goes. -->
      <div class="holdings-card">
        <div class="holdings-row">
          <div class="holdings-label t-label">{{ t('midnight.cnightBalanceLabel') }}</div>
          <div class="holdings-value g-num">{{ formattedBalance }} {{ nightTicker }}</div>
        </div>
        <div class="holdings-row">
          <div class="holdings-label t-label">{{ t('midnight.cnightDustDestination') }}</div>
          <!-- Picker when the user has other Midnight wallets imported and can
               still choose; otherwise the fixed same-seed / registered address. -->
          <v-select
            v-if="canPickDestination"
            v-model="selectedDestinationKey"
            :items="destinationSelectItems"
            dense
            hide-details
            outlined
            attach
            class="holdings-dest-select"
          />
          <div v-else class="holdings-dest">
            {{ registeredDustAddress
              ? middleTruncate(registeredDustAddress, 18, 8)
              : t('midnight.cnightDustDestinationOwn') }}
          </div>
        </div>
      </div>

      <!-- Flow diagram: reuses the house 3-stop map from the Midnight dialog. -->
      <div class="flow-diagram">
        <div class="flow-stop">
          <div class="flow-stop-icon flow-stop-icon--cardano">
            <v-icon small color="white">mdi-link-variant</v-icon>
          </div>
          <div class="flow-stop-label">Cardano {{ nightTicker }}</div>
        </div>
        <div class="flow-arrow">
          <v-icon small color="var(--g-text-3)">mdi-arrow-right</v-icon>
          <span class="flow-arrow-label t-label">{{ t('midnight.flowSign') }}</span>
        </div>
        <div class="flow-stop">
          <div class="flow-stop-icon flow-stop-icon--validator">
            <v-icon small color="white">mdi-shield-key</v-icon>
          </div>
          <div class="flow-stop-label">{{ t('midnight.flowValidator') }}</div>
        </div>
        <div class="flow-arrow">
          <v-icon small color="var(--g-text-3)">mdi-arrow-right</v-icon>
          <span class="flow-arrow-label t-label">~2.5h</span>
        </div>
        <div class="flow-stop">
          <div class="flow-stop-icon flow-stop-icon--midnight">
            <v-icon small color="white">mdi-star-four-points</v-icon>
          </div>
          <div class="flow-stop-label">{{ t('midnight.flowDust') }}</div>
        </div>
      </div>

      <div class="timing-note">{{ t('midnight.cnightTimingNote') }}</div>
    </v-card-text>

    <v-card-actions class="px-0 pt-0" style="display: block">
      <!-- Hardware wallets can't sign locally: hand off to the official portal
           (mainnet/preview only — no preprod portal exists). -->
      <template v-if="!canSignLocally">
        <div class="hardware-notice">
          <v-icon small color="var(--g-text-3)" class="mr-2">mdi-usb-flash-drive-outline</v-icon>
          <span>{{ t('midnight.cnightHardwareNotice') }}</span>
        </div>
        <v-btn v-if="portalUrl" block large outlined class="mt-3" @click="openPortal">
          <v-icon left small>mdi-open-in-new</v-icon>
          {{ t('midnight.cnightOpenPortal') }}
        </v-btn>
      </template>

      <template v-else-if="registrationStatus === 'Unregistered' || registrationStatus === 'Invalid' || registrationStatus === 'Unknown'">
        <!-- Stage 1: primary CTA. PRF wallets jump straight to the PassKey gesture. -->
        <template v-if="!inSigningPhase">
          <v-btn
            block
            large
            class="geroButton"
            :disabled="!hasNight"
            @click="startRegistration"
          >
            <v-icon left>mdi-shield-plus</v-icon>
            {{ t('midnight.registerForDust') }}
          </v-btn>
          <div v-if="!hasNight" class="no-night-hint">
            {{ t('midnight.cnightNoNight') }}
          </div>
        </template>

        <!-- Stage 2: password gate (PassKey wallets skip the input). -->
        <template v-else>
          <v-text-field
            v-if="!isPrfWallet"
            v-model="localPassword"
            :label="t('wallet.spendingPassword')"
            type="password"
            outlined
            dense
            :disabled="registering"
            @keydown.enter="confirmRegistration"
            class="mb-2"
          />

          <div v-if="registering" class="stage-line">
            <v-progress-circular indeterminate size="14" width="2" class="mr-2" color="var(--g-accent)" />
            <span>{{ stageLabel }}</span>
          </div>
          <div v-if="submitError" class="error--text text-caption mb-2">
            {{ submitError }}
          </div>

          <v-btn
            block
            large
            class="geroButton"
            :loading="registering"
            :disabled="!canConfirm"
            @click="confirmRegistration"
          >
            <v-icon left>{{ isPrfWallet ? 'mdi-fingerprint' : 'mdi-shield-check' }}</v-icon>
            {{ isPrfWallet ? t('midnight.authorizeWithPasskey') : t('midnight.signAndRegister') }}
          </v-btn>

          <div class="text-center mt-2">
            <v-btn small text :disabled="registering" @click="resetState">
              {{ t('common.cancel') }}
            </v-btn>
          </div>
        </template>

        <div v-if="portalUrl" class="text-center mt-3">
          <v-btn small text color="var(--g-text-2)" @click="openPortal">
            <v-icon small left>mdi-open-in-new</v-icon>
            {{ t('midnight.cnightOpenPortal') }}
          </v-btn>
        </div>
      </template>

      <!-- Registered: manage actions (migrate destination / stop generating). -->
      <template v-else-if="registrationStatus === 'Registered' && manageMode">
        <div class="manage-note" :class="{ 'manage-note--warning': manageMode === 'deregister' }">
          {{ manageMode === 'deregister' ? t('midnight.cnightStopWarning') : t('midnight.cnightMigrateInfo') }}
        </div>

        <v-text-field
          v-if="!isPrfWallet"
          v-model="localPassword"
          :label="t('wallet.spendingPassword')"
          type="password"
          outlined
          dense
          :disabled="registering"
          @keydown.enter="confirmManage"
          class="mb-2 mt-3"
        />

        <div v-if="registering" class="stage-line">
          <v-progress-circular indeterminate size="14" width="2" class="mr-2" color="var(--g-accent)" />
          <span>{{ stageLabel }}</span>
        </div>
        <div v-if="submitError" class="error--text text-caption mb-2">
          {{ submitError }}
        </div>

        <v-btn
          block
          large
          :outlined="manageMode === 'deregister'"
          :class="manageMode === 'migrate' ? 'geroButton' : undefined"
          :color="manageMode === 'deregister' ? 'error' : undefined"
          :loading="registering"
          :disabled="!canConfirm"
          class="mt-1"
          @click="confirmManage"
        >
          <v-icon left>{{ isPrfWallet ? 'mdi-fingerprint' : (manageMode === 'deregister' ? 'mdi-stop-circle-outline' : 'mdi-swap-horizontal') }}</v-icon>
          {{ manageMode === 'deregister' ? t('midnight.cnightStopCta') : t('midnight.cnightMigrateCta') }}
        </v-btn>
        <div class="text-center mt-2">
          <v-btn small text :disabled="registering" @click="resetState">
            {{ t('common.cancel') }}
          </v-btn>
        </div>
      </template>

      <template v-else>
        <v-btn block large outlined @click="$emit('close')">
          <v-icon v-if="registrationStatus === 'Pending'" left>mdi-clock-outline</v-icon>
          {{ registrationStatus === 'Pending' ? t('common.close') : t('common.done') }}
        </v-btn>
        <div v-if="registrationStatus === 'Registered' && canSignLocally" class="manage-actions">
          <v-btn small text color="var(--g-text-2)" :disabled="registering" @click="enterManage('migrate')">
            <v-icon small left>mdi-swap-horizontal</v-icon>
            {{ t('midnight.cnightMigrateCta') }}
          </v-btn>
          <v-btn small text color="var(--g-text-3)" :disabled="registering" @click="enterManage('deregister')">
            <v-icon small left>mdi-stop-circle-outline</v-icon>
            {{ t('midnight.cnightStopCta') }}
          </v-btn>
        </div>
      </template>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useCnightDustRegistration } from '@/shared/composables/useCnightDustRegistration';
import snackbar from '@/plugins/snackbar';

const props = defineProps<{ isOpen: boolean }>();
defineEmits<{ (e: 'close'): void }>();

const { t } = useTranslation();

const {
  canSignLocally,
  cnightBalance,
  cnightDecimals,
  status,
  registrationStatus,
  registering,
  stage,
  portalUrl,
  destinationOptions,
  selectedDestinationKey,
  refreshStatus,
  register,
  deregister,
  migrateDustAddressToOwn,
} = useCnightDustRegistration();

/** Show the destination picker only when there's a real choice (an imported
 *  Midnight wallet beyond this wallet's own same-seed address) and we're in a
 *  registerable state. */
const canPickDestination = computed(() =>
  destinationOptions.value.length > 1
  && (registrationStatus.value === 'Unregistered'
    || registrationStatus.value === 'Invalid'
    || registrationStatus.value === 'Unknown'));

const destinationSelectItems = computed(() => destinationOptions.value.map((d) => ({
  value: d.key,
  text: d.key === 'self'
    ? t('midnight.cnightDestSelf', { name: d.label })
    : `${d.label} · ${middleTruncate(d.dustAddress, 12, 6)}`,
})));

const localPassword = ref('');
const inSigningPhase = ref(false);
const submitError = ref<string | null>(null);
/** Registered-state manage flows: re-point the DUST destination or stop generating. */
const manageMode = ref<'migrate' | 'deregister' | null>(null);

const isPrfWallet = computed(() => walletStore.loggedWallet?.encryptionMethod === 'prf');
const isMainnet = computed(() => walletStore.loggedWallet?.network === Network.MAINNET);
const nightTicker = computed(() => (isMainnet.value ? 'NIGHT' : 'tNIGHT'));
const hasNight = computed(() => cnightBalance.value > 0n);
const registeredDustAddress = computed(() => status.value?.dustAddress || '');

const formattedBalance = computed(() => {
  const divisor = 10n ** BigInt(cnightDecimals.value);
  const whole = cnightBalance.value / divisor;
  const remainder = cnightBalance.value % divisor;
  if (cnightDecimals.value === 0) return whole.toLocaleString('en-US');
  const fraction = remainder.toString().padStart(cnightDecimals.value, '0').slice(0, 2);
  return `${whole.toLocaleString('en-US')}.${fraction}`;
});

const statusKey = computed(() => {
  switch (registrationStatus.value) {
    case 'Registered': return 'registered';
    case 'Pending': return 'pending';
    case 'Invalid': return 'invalid';
    default: return 'unregistered';
  }
});

const statusLabel = computed(() => {
  switch (registrationStatus.value) {
    case 'Registered': return t('midnight.statusRegistered');
    case 'Pending': return t('midnight.statusPending');
    case 'Invalid': return t('midnight.statusInvalid');
    default: return t('midnight.statusUnregistered');
  }
});

const statusHelp = computed(() => (registrationStatus.value === 'Pending' ? '~2.5h' : ''));

const stageLabel = computed(() => {
  switch (stage.value) {
    case 'deriving': return t('midnight.cnightStageDeriving');
    case 'building': return t('midnight.cnightStageBuilding');
    case 'signing': return t('midnight.cnightStageSigning');
    case 'submitting': return t('midnight.cnightStageSubmitting');
    default: return '';
  }
});

const canConfirm = computed(() => {
  if (registering.value) return false;
  if (isPrfWallet.value) return true;
  return !!localPassword.value;
});

function middleTruncate(s: string, head = 16, tail = 8): string {
  if (!s || s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function resetState() {
  inSigningPhase.value = false;
  submitError.value = null;
  localPassword.value = '';
  manageMode.value = null;
}

function enterManage(mode: 'migrate' | 'deregister') {
  submitError.value = null;
  manageMode.value = mode;
}

async function confirmManage() {
  if (!manageMode.value) return;
  submitError.value = null;
  const wallet = walletStore.loggedWallet;
  if (!wallet) return;

  try {
    let prfOutput: ArrayBuffer | undefined;
    if (isPrfWallet.value) {
      if (!wallet.webAuthnCredentialId) {
        throw new Error('PRF wallet missing credential ID');
      }
      const { evaluatePrfForWallet } = await import('@/shared/utils/webauthn-prf');
      prfOutput = await evaluatePrfForWallet(wallet.webAuthnCredentialId, wallet.id.toString());
    }
    const credentials = {
      password: isPrfWallet.value ? undefined : localPassword.value,
      prfOutput,
    };

    const result = manageMode.value === 'deregister'
      ? await deregister(credentials)
      : await migrateDustAddressToOwn(credentials);

    if (result.status === 'submitted') {
      snackbar.fireSuccess(manageMode.value === 'deregister'
        ? t('midnight.cnightDeregistered')
        : t('midnight.cnightUpdated'));
      resetState();
    } else if (result.message === 'WRONG_PASSWORD') {
      submitError.value = t('errors.wrongPassword');
    } else if (result.message === 'NO_COLLATERAL') {
      submitError.value = t('midnight.dustNoCollateral');
      snackbar.setError(submitError.value);
    } else {
      submitError.value = result.message || t('midnight.dustRegistrationFailed');
      snackbar.setError(submitError.value);
    }
  } catch (e) {
    submitError.value = e instanceof Error ? e.message : String(e);
    snackbar.setError(submitError.value);
  }
}

function startRegistration() {
  if (!hasNight.value) return;
  inSigningPhase.value = true;
  if (isPrfWallet.value) {
    confirmRegistration();
  }
}

async function confirmRegistration() {
  submitError.value = null;
  const wallet = walletStore.loggedWallet;
  if (!wallet) return;

  try {
    let prfOutput: ArrayBuffer | undefined;
    if (isPrfWallet.value) {
      if (!wallet.webAuthnCredentialId) {
        throw new Error('PRF wallet missing credential ID');
      }
      const { evaluatePrfForWallet } = await import('@/shared/utils/webauthn-prf');
      prfOutput = await evaluatePrfForWallet(wallet.webAuthnCredentialId, wallet.id.toString());
    }

    const result = await register({
      password: isPrfWallet.value ? undefined : localPassword.value,
      prfOutput,
    });

    if (result.status === 'submitted') {
      snackbar.fireSuccess(t('midnight.dustRegistrationSubmitted'));
      resetState();
    } else if (result.message === 'WRONG_PASSWORD') {
      submitError.value = t('errors.wrongPassword');
    } else if (result.message === 'NO_COLLATERAL') {
      submitError.value = t('midnight.dustNoCollateral');
      snackbar.setError(submitError.value);
    } else {
      submitError.value = result.message || t('midnight.dustRegistrationFailed');
      snackbar.setError(submitError.value);
    }
  } catch (e) {
    submitError.value = e instanceof Error ? e.message : String(e);
    snackbar.setError(submitError.value);
  }
}

async function openPortal() {
  window.open(portalUrl.value, '_blank', 'noopener,noreferrer');
}

watch(() => props.isOpen, (open) => {
  if (open) {
    resetState();
    refreshStatus();
  }
});
</script>

<style scoped>
/* Status pill + flow diagram mirror DustRegistrationDialog so the DUST
   feature reads identically from the Midnight and Cardano sides. */

.status-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  margin-bottom: 16px;
  font-size: 12px;
}

.status-pill-label {
  font-weight: 600;
  color: var(--g-text-1);
}

.status-pill-help {
  color: var(--g-text-3);
  font-size: 11px;
  font-family: var(--g-font-mono);
}

/* Static dot (no pulse) — keeps the ratchet's infinite-animation budget flat;
   the Midnight-side dialog already carries the animated variant. */
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot--unregistered { background: var(--g-text-3); }
.status-dot--pending { background: var(--g-warning); }
.status-dot--registered { background: var(--g-success); }
.status-dot--invalid { background: var(--g-error); }

.status-pill--pending {
  background: var(--g-warning-fill);
  border-color: var(--g-warning-line);
}
.status-pill--registered {
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}
.status-pill--invalid {
  background: var(--g-error-fill);
  border-color: var(--g-error-line);
}

/* ── Holdings card ─────────────────────────────────────────────────────────── */

.holdings-card {
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
  padding: 14px 16px;
  margin-bottom: 16px;
}

.holdings-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 4px 0;
}

.holdings-label {
  flex-shrink: 0;
}

.holdings-value {
  font-family: var(--g-font-mono);
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-1);
}

.holdings-dest {
  font-size: 12px;
  color: var(--g-text-2);
  text-align: right;
  min-width: 0;
}

/* ── Flow diagram ──────────────────────────────────────────────────────────── */

.flow-diagram {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 12px 0 16px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--g-hairline-1);
}

.flow-stop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  min-width: 0;
}

/* Tokenized stops (no raw chain hexes — keeps the hex ratchet flat; the
   Midnight-side dialog carries the colored variant). */
.flow-stop-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--g-hairline-2);
  background: var(--g-overlay);
}

.flow-stop-label {
  font-size: 11px;
  color: var(--g-text-2);
  text-align: center;
  white-space: nowrap;
  font-weight: 500;
}

.flow-arrow {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

/* ── Notes ─────────────────────────────────────────────────────────────────── */

.timing-note {
  font-size: 12px;
  color: var(--g-text-3);
  line-height: 1.5;
}

.hardware-notice {
  display: flex;
  align-items: flex-start;
  font-size: 12px;
  color: var(--g-text-2);
  line-height: 1.5;
}

.no-night-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--g-text-3);
  text-align: center;
}

.stage-line {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: var(--g-text-2);
  margin-bottom: 8px;
}

.manage-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.manage-note {
  font-size: 12px;
  color: var(--g-text-2);
  line-height: 1.5;
  padding: 10px 12px;
  border-radius: var(--g-r-control);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-2);
}

.manage-note--warning {
  background: var(--g-warning-fill);
  border-color: var(--g-warning-line);
}
</style>
