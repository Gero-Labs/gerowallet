<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="t('midnight.dustSourcesTitle')"
    :subtitle="t('midnight.dustSourcesSubtitle')"
    icon="mdi-source-branch"
    :width="620"
    :min-height="420"
  >
    <v-card-text class="px-0" style="z-index: 1">
      <!-- Destination: this wallet's own DUST address. -->
      <div class="dest-card">
        <div class="t-label">{{ t('midnight.cnightDustDestination') }}</div>
        <div class="dest-row">
          <v-avatar size="28" color="teal darken-3" class="mr-3">
            <v-icon small color="teal lighten-3">mdi-star-four-points</v-icon>
          </v-avatar>
          <span class="dest-address">{{ middleTruncate(ownDustAddress, 20, 10) }}</span>
        </div>
      </div>

      <!-- Source rows: every Cardano identity the user controls on this network. -->
      <div v-if="loading && sources.length === 0" class="empty-note">
        <v-progress-circular indeterminate size="16" width="2" class="mr-2" color="var(--g-accent)" />
        {{ t('common.loading') }}
      </div>
      <div v-else-if="sources.length === 0" class="empty-note">
        {{ t('midnight.dustSourcesEmpty') }}
      </div>

      <div v-for="source in sources" :key="source.key" class="source-row">
        <div class="source-main">
          <div class="source-info">
            <div class="source-label">
              {{ source.label }}
              <span v-if="source.sameSeed" class="source-tag">{{ t('midnight.dustSourcesSameSeed') }}</span>
            </div>
            <div class="source-address g-mono">{{ middleTruncate(source.stakeAddress, 14, 6) }}</div>
          </div>
          <div class="source-balance g-num">
            <template v-if="source.nightBalance !== null">
              {{ formatNight(source.nightBalance) }} {{ nightTicker }}
            </template>
            <template v-else>—</template>
          </div>
          <!-- One switch on `dustSourceRowState`, shared with the composable's
               own pre-flight guard, so the button and the action can never
               disagree about what this stake's chain state allows. -->
          <div class="source-action">
            <!-- Generating to this wallet already -->
            <span v-if="rowState(source) === 'generatingHere'" class="state-chip state-chip--active">
              <v-icon x-small color="var(--g-success)" class="mr-1">mdi-check-circle</v-icon>
              {{ t('midnight.dustSourcesGeneratingHere') }}
            </span>
            <!-- More than one live registration UTxO: the whole set is
                 protocol-invalid. Neither action is meaningful until it's back
                 down to one, and consolidation lives on the Cardano wallet. -->
            <span v-else-if="rowState(source) === 'duplicated'" class="state-chip state-chip--warn">
              <v-icon x-small color="var(--g-error)" class="mr-1">mdi-alert-outline</v-icon>
              {{ t('midnight.dustSourcesDuplicate') }}
            </span>
            <!-- Relay in flight -->
            <span v-else-if="rowState(source) === 'pending'" class="state-chip">
              <v-icon x-small class="mr-1">mdi-clock-outline</v-icon>
              {{ t('midnight.statusPending') }}
            </span>
            <!-- No local keys -->
            <span v-else-if="rowState(source) === 'readOnly'" class="state-chip">
              {{ t('midnight.dustSourcesReadOnly') }}
            </span>
            <!-- Neither chain read answered. Fail closed: no CTA, because
                 "unregistered" and "the query failed" look identical here and
                 registering over a live registration invalidates both. -->
            <span v-else-if="rowState(source) === 'unknown'" class="state-chip">
              <v-icon x-small class="mr-1">mdi-help-circle-outline</v-icon>
              {{ t('midnight.dustSourcesUnknownState') }}
            </span>
            <!-- Exactly one live registration, pointed elsewhere (or not yet
                 relayed, so we can't see where): redirect, never register. -->
            <v-btn
              v-else-if="rowState(source) === 'registeredElsewhere'"
              small outlined :disabled="working"
              @click="openAuth(source, 'redirect')"
            >
              <v-icon small left>mdi-swap-horizontal</v-icon>
              {{ t('midnight.dustSourcesRedirectHere') }}
            </v-btn>
            <!-- Confirmed clear, with NIGHT: register -->
            <v-btn
              v-else
              small class="geroButton"
              :disabled="working || !source.nightBalance"
              @click="openAuth(source, 'register')"
            >
              {{ t('midnight.dustSourcesGenerateHere') }}
            </v-btn>
          </div>
        </div>

        <!-- Why this row can't just be registered. Without this the states
             above read as arbitrary — the user's only feedback used to be a
             button that silently wasn't there. -->
        <div v-if="rowNote(source)" class="source-note">
          <span>{{ rowNote(source) }}</span>
          <button
            v-if="rowState(source) === 'unknown'"
            type="button"
            class="source-note-retry"
            :disabled="loading"
            @click="refresh()"
          >
            {{ t('common.retry') }}
          </button>
        </div>

        <!-- Relay progress for a pending registration: on-chain tx + elapsed. -->
        <div
          v-if="rowState(source) === 'pending' && pendingTxHash(source)"
          class="source-relay"
        >
          <a
            class="relay-tx g-mono"
            :href="pendingTxUrl(source)"
            target="_blank"
            rel="noopener noreferrer"
            :title="pendingTxHash(source)"
          >
            {{ middleTruncate(pendingTxHash(source), 10, 6) }}
            <v-icon x-small>mdi-open-in-new</v-icon>
          </a>
          <span class="relay-time">{{ pendingElapsed(source) }}</span>
        </div>

        <!-- Inline auth gate for the selected row. -->
        <div v-if="authFor === source.key" class="source-auth">
          <v-text-field
            v-if="authEncryption === 'password'"
            v-model="authPassword"
            :label="t('wallet.spendingPassword')"
            type="password"
            outlined dense hide-details
            :disabled="working"
            class="mb-2"
            @keydown.enter="confirmAction(source)"
          />
          <div v-if="working && stageLabel" class="stage-line">
            <v-progress-circular indeterminate size="14" width="2" class="mr-2" color="var(--g-accent)" />
            <span>{{ stageLabel }}</span>
          </div>
          <div v-if="authError" class="error--text text-caption mb-2">{{ authError }}</div>
          <div class="source-auth-actions">
            <v-btn small text :disabled="working" @click="closeAuth">{{ t('common.cancel') }}</v-btn>
            <v-btn
              small class="geroButton"
              :loading="working"
              :disabled="authEncryption === 'password' && !authPassword"
              @click="confirmAction(source)"
            >
              <v-icon small left>{{ authEncryption === 'prf' ? 'mdi-fingerprint' : 'mdi-shield-check' }}</v-icon>
              {{ authAction === 'redirect' ? t('midnight.dustSourcesRedirectHere') : t('midnight.dustSourcesGenerateHere') }}
            </v-btn>
          </div>
        </div>
      </div>

      <div class="timing-note">{{ t('midnight.cnightTimingNote') }}</div>
    </v-card-text>

    <v-card-actions class="px-0 pt-2" style="display: block">
      <v-btn block large outlined @click="$emit('close')">{{ t('common.close') }}</v-btn>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { geroStore } from '@/stores/geroStore';
import { Blockchain, Network } from '@/models/types';
import { useTranslation } from '@/shared/composables/useTranslation';
import {
  useDustSources,
  dustSourceRowState,
  DustSource,
  DustSourceRowState,
  DustSourceStage,
} from '@/shared/composables/useDustSources';
import { getDustPending } from '@/shared/composables/useDustPending';
import { getExplorerUrl } from '@/shared/utils/explorer';
import timeAgo from '@/plugins/time';
import snackbar from '@/plugins/snackbar';

const props = defineProps<{ isOpen: boolean }>();
defineEmits<{ (e: 'close'): void }>();

const { t } = useTranslation();
const {
  sources,
  loading,
  working,
  ownDustAddress,
  ownDustAddressHex,
  refresh,
  registerSource,
  redirectSource,
} = useDustSources();

const authFor = ref<string | null>(null);
const authAction = ref<'register' | 'redirect'>('register');
const authPassword = ref('');
const authError = ref<string | null>(null);
const stage = ref<DustSourceStage | null>(null);

const stageLabel = computed(() => {
  switch (stage.value) {
    case 'isolating': return t('midnight.dustSourcesStageIsolating');
    case 'waitingIsolation': return t('midnight.dustSourcesStageWaiting');
    case 'registering': return t('midnight.dustSourcesStageRegistering');
    default: return '';
  }
});

const isMainnet = computed(() => walletStore.loggedWallet?.network === Network.MAINNET);
const nightTicker = computed(() => (isMainnet.value ? 'NIGHT' : 'tNIGHT'));

const authEncryption = computed<'password' | 'prf'>(() => {
  const source = sources.value.find(s => s.key === authFor.value);
  return source?.encryptionMethod ?? 'password';
});

/** Single source of truth for what this row shows and may do. */
function rowState(source: DustSource): DustSourceRowState {
  return dustSourceRowState(source, ownDustAddress.value, ownDustAddressHex.value);
}

/**
 * The one-line explanation under a row that isn't offering a plain Register.
 * `registeredElsewhere` names the current destination when the indexer has
 * relayed it; during the relay window it hasn't, so we say that instead of
 * showing a blank address.
 */
function rowNote(source: DustSource): string {
  switch (rowState(source)) {
    case 'duplicated':
      return t('midnight.dustSourcesDuplicateHint');
    case 'unknown':
      return t('midnight.dustSourcesUnknownHint');
    case 'registeredElsewhere': {
      const dest = source.status?.registered ? source.status.dustAddress : '';
      return dest
        ? t('midnight.dustSourcesElsewhere', { address: middleTruncate(dest, 14, 6) })
        : t('midnight.dustSourcesElsewhereUnknown');
    }
    default:
      return '';
  }
}

// The submitted registration tx for a pending source (indexer field first,
// falling back to the local guard before the relay confirms).
function pendingTxHash(source: DustSource): string {
  return source.status?.registrationUtxoTxHash || getDustPending(source.stakeAddress)?.txHash || '';
}
function pendingTxUrl(source: DustSource): string {
  return getExplorerUrl(Blockchain.CARDANO, pendingTxHash(source), 'tx', walletStore.loggedWallet?.network);
}
function pendingElapsed(source: DustSource): string {
  const rec = getDustPending(source.stakeAddress);
  const relay = t('midnight.dustRelayEstimate');
  return rec ? `${timeAgo.format(new Date(rec.submittedAt))} · ${relay}` : relay;
}

function formatNight(value: bigint): string {
  const divisor = 1_000_000n;
  const whole = value / divisor;
  const fraction = ((value % divisor) * 100n / divisor).toString().padStart(2, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

function middleTruncate(s: string, head = 16, tail = 8): string {
  if (!s || s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function openAuth(source: DustSource, action: 'register' | 'redirect') {
  authFor.value = source.key;
  authAction.value = action;
  authPassword.value = '';
  authError.value = null;
  // PassKey sources need no input field — go straight to the gesture.
  if (source.encryptionMethod === 'prf') {
    confirmAction(source);
  }
}

function closeAuth() {
  authFor.value = null;
  authPassword.value = '';
  authError.value = null;
  stage.value = null;
}

async function confirmAction(source: DustSource) {
  authError.value = null;
  stage.value = null;
  const onStage = (s: DustSourceStage) => { stage.value = s; };
  try {
    let prfOutput: ArrayBuffer | undefined;
    if (source.encryptionMethod === 'prf') {
      // Evaluate PRF against the SOURCE wallet's own credential (the logged
      // wallet's for the same-seed twin, the imported record's otherwise).
      const record = source.sameSeed
        ? walletStore.loggedWallet
        : (geroStore.wallets ?? {})[source.walletId as number];
      if (!record?.webAuthnCredentialId) {
        throw new Error('PassKey wallet missing credential ID');
      }
      const { evaluateWalletPrf } = await import('@/shared/utils/passkeyPrf');
      prfOutput = await evaluateWalletPrf(record);
    }
    const credentials = {
      password: source.encryptionMethod === 'prf' ? undefined : authPassword.value,
      prfOutput,
    };

    const result = authAction.value === 'redirect'
      ? await redirectSource(source, credentials, onStage)
      : await registerSource(source, credentials, onStage);

    if (result.status === 'submitted') {
      snackbar.fireSuccess(t('midnight.dustRegistrationSubmitted'));
      closeAuth();
    } else if (result.message === 'WRONG_PASSWORD') {
      authError.value = t('errors.wrongPassword');
    } else if (result.message === 'ISOLATION_TIMEOUT') {
      authError.value = t('midnight.dustSourcesIsolationTimeout');
    } else if (result.message === 'TOKEN_BAG_TOO_LARGE') {
      authError.value = t('midnight.dustSourcesBagTooLarge');
    } else if (result.message === 'NO_COLLATERAL') {
      authError.value = t('midnight.dustNoCollateral');
    } else if (result.message === 'ALREADY_REGISTERED') {
      // The pre-flight guard in `registerSource` fired — chain state moved
      // between render and click. Re-read so the row redraws as Redirect.
      authError.value = t('midnight.dustSourcesAlreadyRegistered');
      void refresh();
    } else if (result.message === 'DUPLICATE_REGISTRATIONS') {
      authError.value = t('midnight.dustSourcesDuplicateHint');
      void refresh();
    } else {
      authError.value = result.message || t('midnight.dustRegistrationFailed');
    }
  } catch (e) {
    authError.value = e instanceof Error ? e.message : String(e);
  } finally {
    stage.value = null;
  }
}

watch(() => props.isOpen, (open) => {
  if (open) {
    closeAuth();
    refresh();
  }
});
</script>

<style scoped>
.dest-card {
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
  padding: 12px 14px;
  margin-bottom: 14px;
}

.dest-row {
  display: flex;
  align-items: center;
  margin-top: 6px;
}

.dest-address {
  font-family: var(--g-font-mono);
  font-size: 13px;
  color: var(--g-text-1);
}

.empty-note {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 0;
  font-size: 12px;
  color: var(--g-text-3);
}

.source-row {
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 10px 12px;
  margin-bottom: 8px;
}

.source-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.source-info {
  flex: 1 1 auto;
  min-width: 0;
}

.source-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-1);
  display: flex;
  align-items: center;
  gap: 6px;
}

.source-tag {
  font-size: 10px;
  font-weight: 500;
  color: var(--g-text-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-chip);
  padding: 0 6px;
}

.source-address {
  font-size: 11px;
  color: var(--g-text-3);
  margin-top: 2px;
}

.source-balance {
  font-family: var(--g-font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--g-text-2);
  flex-shrink: 0;
}

.source-action {
  flex-shrink: 0;
  min-width: 0;
}

.state-chip {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  color: var(--g-text-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-chip);
  padding: 2px 8px;
}

.state-chip--active {
  color: var(--g-success);
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}

.source-note {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--g-hairline-1);
  font-size: 11px;
  line-height: 1.5;
  color: var(--g-text-3);
}

.source-note-retry {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--g-accent);
  background: none;
  border: none;
  padding: 0;
  font-size: 11px;
  cursor: pointer;
}

.source-note-retry:disabled {
  color: var(--g-text-3);
  cursor: default;
}

.state-chip--warn {
  color: var(--g-error);
  background: var(--g-error-fill);
  border-color: var(--g-error-line);
}

.source-relay {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--g-hairline-1);
  font-size: 11px;
}

.relay-tx {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--g-text-3);
  text-decoration: none;
}

.relay-tx:hover {
  color: var(--g-accent);
}

.relay-time {
  margin-left: auto;
  color: var(--g-text-3);
}

.source-auth {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--g-hairline-1);
}

.source-auth-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.stage-line {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: var(--g-text-2);
  margin-bottom: 8px;
}

.timing-note {
  font-size: 12px;
  color: var(--g-text-3);
  line-height: 1.5;
  margin-top: 8px;
}
</style>
