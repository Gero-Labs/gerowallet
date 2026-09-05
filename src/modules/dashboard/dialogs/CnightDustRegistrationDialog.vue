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
        <!-- Source wallet: which Cardano wallet's NIGHT is doing the generating. With
             several wallets holding cNIGHT it is otherwise ambiguous which one this
             dialog is acting on. -->
        <div v-if="sourceWalletName" class="holdings-row">
          <div class="holdings-label t-label">{{ t('midnight.cnightSourceWallet') }}</div>
          <div class="holdings-value holdings-value--stacked">
            <span>{{ sourceWalletName }}</span>
            <span v-if="sourceWalletAddress" class="holdings-subvalue g-mono">
              {{ middleTruncate(sourceWalletAddress, 12, 8) }}
            </span>
          </div>
        </div>

        <!-- Capacity: what this much NIGHT is worth in DUST at full charge. Comes from
             Nexus (`max_capacity`), NOT a local 5x guess, so it stays correct if the
             protocol's capacity ratio ever changes. -->
        <div v-if="estimatedDustCapacity" class="holdings-row">
          <div class="holdings-label t-label">{{ t('midnight.cnightEstimatedDust') }}</div>
          <div class="holdings-value g-num">{{ estimatedDustCapacity }} DUST</div>
        </div>

        <!-- Cardano block the registration landed in. NOTE: this is the Cardano
             registration block, not a Midnight block — generation itself only starts
             after the relay, so the label says "registered at", not "generating since". -->
        <div v-if="registrationBlock" class="holdings-row">
          <div class="holdings-label t-label">{{ t('midnight.cnightRegisteredAtBlock') }}</div>
          <div class="holdings-value g-num">#{{ registrationBlock }}</div>
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
          <!-- `registeredDustAddress` is the Midnight INDEXER's value, which
               lags Cardano by the relay — so right after a redirect it still
               shows the OLD destination. Show the in-flight one alongside it
               rather than letting the card read as settled. -->
          <div v-else class="holdings-dest">
            <span :class="{ 'holdings-dest--superseded': !!pendingDestination }">
              {{ registeredDustAddress
                ? middleTruncate(registeredDustAddress, 18, 8)
                : t('midnight.cnightDustDestinationOwn') }}
            </span>
            <span v-if="pendingDestination" class="holdings-dest-next">
              <v-icon x-small class="mr-1">mdi-arrow-down</v-icon>
              <span class="g-mono">{{ middleTruncate(pendingDestination, 18, 8) }}</span>
              <span class="holdings-dest-note">{{ t('midnight.cnightDestinationChanging') }}</span>
            </span>
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
          <span class="flow-arrow-label t-label">{{ t('midnight.relayFewHours') }}</span>
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

      <!-- Duplicated: consolidation panel. Midnight allows exactly one live
           registration UTxO per stake credential — DUST generation is paused
           for the whole set until it's back down to one. Register CTA never
           renders here. -->
      <template v-else-if="showConsolidationPanel">
        <div class="duplicate-banner">
          <v-icon small color="var(--g-error)" class="mr-2">mdi-alert-outline</v-icon>
          <span>{{ t('midnight.cnightDuplicateBanner') }}</span>
        </div>

        <div class="replicate-list">
          <div
            v-for="reg in registrations"
            :key="`${reg.txHash}-${reg.outputIndex}`"
            class="replicate-row"
            :class="{ 'replicate-row--primary': isPrimary(reg) }"
          >
            <div class="replicate-info">
              <div class="replicate-tx">
                {{ middleTruncate(reg.txHash, 8, 6) }}#{{ reg.outputIndex }}
                <span v-if="isPrimary(reg)" class="replicate-badge">{{ t('midnight.cnightPrimaryBadge') }}</span>
              </div>
              <div class="replicate-dust">{{ middleTruncate(reg.dustAddressHex, 10, 6) }}</div>
            </div>
            <v-btn
              v-if="!isPrimary(reg)"
              small
              outlined
              color="error"
              :loading="isRemoving(reg)"
              :disabled="registering"
              @click="startRemove(reg)"
            >
              {{ t('common.remove') }}
            </v-btn>
          </div>
        </div>

        <template v-if="activeRemove">
          <v-text-field
            v-if="!isPrfWallet"
            v-model="localPassword"
            :label="t('wallet.spendingPassword')"
            type="password"
            outlined
            dense
            :disabled="registering"
            @keydown.enter="confirmRemove"
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
            outlined
            color="error"
            :loading="registering"
            :disabled="!canConfirm"
            @click="confirmRemove"
          >
            <v-icon left>{{ isPrfWallet ? 'mdi-fingerprint' : 'mdi-trash-can-outline' }}</v-icon>
            {{ isPrfWallet ? t('midnight.authorizeWithPasskey') : t('common.remove') }}
          </v-btn>
          <div class="text-center mt-2">
            <v-btn small text :disabled="registering" @click="cancelRemove">
              {{ t('common.cancel') }}
            </v-btn>
          </div>
        </template>

        <div v-else class="text-center mt-3">
          <v-btn small text color="var(--g-text-2)" @click="$emit('close')">
            {{ t('common.close') }}
          </v-btn>
        </div>
      </template>

      <!-- Invalid with no live registrations found (residual/legacy state,
           since >=1 live registration now resolves to Pending/Duplicated
           above): offer a refresh instead of a dead-end Register loop. -->
      <template v-else-if="registrationStatus === 'Invalid'">
        <div class="invalid-hint">{{ t('midnight.cnightInvalidHint') }}</div>
        <v-btn block outlined class="mt-3" :loading="statusLoading" @click="refreshStatus">
          <v-icon left small>mdi-refresh</v-icon>
          {{ t('common.refresh') }}
        </v-btn>
      </template>

      <template v-else-if="registrationStatus === 'Unregistered' || registrationStatus === 'Unknown'">
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
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { Network } from '@/models/types';
import { DustRegistrationUtxoDto } from '@/api/midnight-api';
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
  statusLoading,
  registrationStatus,
  localPending,
  registrations,
  primaryRegistration,
  registering,
  stage,
  portalUrl,
  destinationOptions,
  selectedDestinationKey,
  refreshStatus,
  register,
  deregister,
  deregisterOutpoint,
  migrateDustAddressToOwn,
} = useCnightDustRegistration();

/** Show the destination picker only when there's a real choice (an imported
 *  Midnight wallet beyond this wallet's own same-seed address) and we're in a
 *  registerable state. */
const canPickDestination = computed(() =>
  destinationOptions.value.length > 1
  && (registrationStatus.value === 'Unregistered' || registrationStatus.value === 'Unknown'));

/** Only Duplicated shows the panel. `registrationStatus`'s derivation checks
 *  registrations.length > 1 (Duplicated) and === 1 (Pending) before it ever
 *  considers the server's 'Invalid' field, so 'Invalid' can only reach here
 *  with an empty registrations list — there is no "Invalid with registrations
 *  to consolidate" case today (see the Invalid branch below instead). */
const showConsolidationPanel = computed(() => registrationStatus.value === 'Duplicated');

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
/** Duplicated-state consolidation: the non-primary registration currently
 *  targeted for removal (drives the inline password gate + per-row spinner). */
const activeRemove = ref<{ txHash: string; outputIndex: number } | null>(null);

/** Name + address of the Cardano wallet whose NIGHT generates the DUST. */
const sourceWalletName = computed(() => walletStore.loggedWallet?.name || '');
const sourceWalletAddress = computed(() => walletStore.loggedWallet?.baseAddress || '');

/**
 * Full-charge DUST capacity for this wallet's NIGHT, from Nexus's `max_capacity`
 * (base units, 15 decimals). Server-sourced rather than a local `night * 5` so it
 * tracks the protocol if the capacity ratio changes. Empty string hides the row.
 */
const estimatedDustCapacity = computed(() => {
  const raw = status.value?.maxCapacity;
  if (!raw) return '';
  try {
    const divisor = 10n ** BigInt(MIDNIGHT_DECIMALS.DUST);
    const units = BigInt(raw);
    if (units <= 0n) return '';
    const whole = units / divisor;
    const frac = ((units % divisor) * 100n) / divisor; // 2dp
    return `${whole.toLocaleString()}.${frac.toString().padStart(2, '0')}`;
  } catch {
    return '';
  }
});

/**
 * Cardano block height of the registration transaction, read from the wallet's own
 * history — no extra lookup, and Nexus exposes no Cardano tx-detail route today
 * (`/api/transactions/{hash}` is 404; only `/utxos` exists). Empty when the tx isn't
 * in the loaded history yet, which just hides the row.
 */
const registrationBlock = computed(() => {
  const txHash = status.value?.registrationUtxoTxHash
    || primaryRegistration.value?.txHash;
  if (!txHash) return '';
  const tx = (walletStore.transactions || []).find(
    (t: { hash?: string; tx_hash?: string; block_height?: number }) =>
      t.hash === txHash || t.tx_hash === txHash,
  );
  const height = tx?.block_height;
  return height ? height.toLocaleString() : '';
});

const isPrfWallet = computed(() => walletStore.loggedWallet?.encryptionMethod === 'prf');
const isMainnet = computed(() => walletStore.loggedWallet?.network === Network.MAINNET);
const nightTicker = computed(() => (isMainnet.value ? 'NIGHT' : 'tNIGHT'));
const hasNight = computed(() => cnightBalance.value > 0n);
const registeredDustAddress = computed(() => status.value?.dustAddress || '');

/**
 * A submitted-but-not-yet-relayed destination change for this stake. Only
 * surfaced when it actually differs from what the indexer reports, so a plain
 * first registration (where the indexer simply hasn't caught up) doesn't
 * render a pointless "X → X" row.
 */
const pendingDestination = computed(() => {
  const next = localPending.value?.dustAddress;
  if (!next) return '';
  const current = registeredDustAddress.value;
  return current && current.toLowerCase() === next.toLowerCase() ? '' : next;
});

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
    case 'Duplicated': return 'duplicated';
    default: return 'unregistered';
  }
});

const statusLabel = computed(() => {
  switch (registrationStatus.value) {
    case 'Registered': return t('midnight.statusRegistered');
    case 'Pending': return t('midnight.statusPending');
    case 'Invalid': return t('midnight.statusInvalid');
    case 'Duplicated': return t('midnight.statusDuplicated');
    default: return t('midnight.statusUnregistered');
  }
});

const statusHelp = computed(() => {
  if (registrationStatus.value === 'Pending') return t('midnight.relayFewHours');
  if (registrationStatus.value === 'Duplicated') return t('midnight.cnightDuplicateCount', { count: registrations.value.length });
  return '';
});

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
  activeRemove.value = null;
}

function enterManage(mode: 'migrate' | 'deregister') {
  submitError.value = null;
  manageMode.value = mode;
}

function isPrimary(reg: DustRegistrationUtxoDto): boolean {
  const primary = primaryRegistration.value;
  return !!primary && primary.txHash === reg.txHash && primary.outputIndex === reg.outputIndex;
}

function isRemoving(reg: DustRegistrationUtxoDto): boolean {
  return registering.value
    && !!activeRemove.value
    && activeRemove.value.txHash === reg.txHash
    && activeRemove.value.outputIndex === reg.outputIndex;
}

function startRemove(reg: DustRegistrationUtxoDto) {
  submitError.value = null;
  activeRemove.value = { txHash: reg.txHash, outputIndex: reg.outputIndex };
  if (isPrfWallet.value) {
    confirmRemove();
  }
}

function cancelRemove() {
  activeRemove.value = null;
  submitError.value = null;
  localPassword.value = '';
}

async function confirmRemove() {
  if (!activeRemove.value) return;
  submitError.value = null;
  const wallet = walletStore.loggedWallet;
  if (!wallet) return;
  const { txHash, outputIndex } = activeRemove.value;

  try {
    let prfOutput: ArrayBuffer | undefined;
    if (isPrfWallet.value) {
      if (!wallet.webAuthnCredentialId) {
        throw new Error('PRF wallet missing credential ID');
      }
      const { evaluateWalletPrf } = await import('@/shared/utils/passkeyPrf');
      prfOutput = await evaluateWalletPrf(wallet);
    }
    const credentials = {
      password: isPrfWallet.value ? undefined : localPassword.value,
      prfOutput,
    };

    const result = await deregisterOutpoint(credentials, txHash, outputIndex);
    if (result.status === 'submitted') {
      snackbar.fireSuccess(t('midnight.cnightReplicateRemoved'));
      cancelRemove();
      await refreshStatus();
    } else if (result.status === 'already_registered') {
      // Not expected from a deregistration call, but the result type is
      // shared with register() — treat like a submitted removal (refresh
      // and let the derived status re-render) rather than erroring.
      cancelRemove();
      await refreshStatus();
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
      const { evaluateWalletPrf } = await import('@/shared/utils/passkeyPrf');
      prfOutput = await evaluateWalletPrf(wallet);
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
    } else if (result.status === 'already_registered') {
      // Not expected from deregister/migrate, but the result type is shared
      // with register() — refresh and let the derived status re-render.
      resetState();
      await refreshStatus();
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
      const { evaluateWalletPrf } = await import('@/shared/utils/passkeyPrf');
      prfOutput = await evaluateWalletPrf(wallet);
    }

    const result = await register({
      password: isPrfWallet.value ? undefined : localPassword.value,
      prfOutput,
    });

    if (result.status === 'submitted') {
      snackbar.fireSuccess(t('midnight.dustRegistrationSubmitted'));
      resetState();
    } else if (result.status === 'already_registered') {
      // Nexus refused: a live registration already exists. The composable
      // already adopted the server's list, so `registrationStatus` re-derives
      // as Pending/Duplicated on its own — no error toast, just settle.
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
.status-dot--duplicated { background: var(--g-error); }

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
.status-pill--duplicated {
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

/* Wallet row stacks name over a quieter truncated address. */
.holdings-value--stacked {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-family: var(--g-font-ui);
}

.holdings-subvalue {
  font-size: 11px;
  font-weight: 400;
  color: var(--g-text-3);
}

.holdings-dest {
  font-size: 12px;
  color: var(--g-text-2);
  text-align: right;
  min-width: 0;
}

/* The indexer's destination while a redirect is in flight: still true today,
   but on its way out — quieted, not struck through (it is not wrong yet). */
.holdings-dest--superseded {
  color: var(--g-text-3);
}

.holdings-dest-next {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--g-text-1);
}

.holdings-dest-note {
  color: var(--g-text-3);
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

/* ── Duplicate-registration consolidation panel ──────────────────────────────
   Midnight allows exactly one live registration UTxO per stake credential;
   more than one pauses DUST generation for the whole set. Reuses the error/
   success tokens already established above (invalid pill / registered pill)
   rather than introducing new colors. */

.duplicate-banner {
  display: flex;
  align-items: flex-start;
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-1);
  line-height: 1.5;
  padding: 10px 12px;
  border-radius: var(--g-r-control);
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  margin-bottom: 12px;
}

.replicate-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.replicate-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--g-r-control);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-2);
}

.replicate-row--primary {
  border-color: var(--g-success-line);
  background: var(--g-success-fill);
}

.replicate-info {
  min-width: 0;
  flex: 1 1 auto;
}

.replicate-tx {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--g-font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--g-text-1);
}

.replicate-badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--g-success);
  padding: 1px 6px;
  border-radius: var(--g-r-chip);
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
}

.replicate-dust {
  font-family: var(--g-font-mono);
  font-size: 11px;
  color: var(--g-text-3);
  margin-top: 2px;
}

.invalid-hint {
  font-size: 12px;
  color: var(--g-text-2);
  line-height: 1.5;
  text-align: center;
  padding: 8px 0;
}
</style>
