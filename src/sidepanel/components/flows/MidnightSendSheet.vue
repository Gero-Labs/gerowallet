<template>
  <BottomSheet :model-value="modelValue" @update:model-value="onSheetInput" :title="sheetTitle" height="92%" :persistent="sendDispatched">
    <div class="midnight-send-sheet" ref="stepperEl">
      <!-- One polite live region for the whole sheet, mounted before any send so
           its first message is read: proving steps and their hints. -->
      <div class="g-sr-only" aria-live="polite" aria-atomic="true" data-test="midnight-send-live">{{ liveMessage }}</div>

      <!-- ═══════ SUCCESS OVERLAY ═══════ -->
      <div v-if="txSuccess" class="success-overlay">
        <v-icon size="56" color="success">mdi-check-circle</v-icon>
        <div class="text-h6 white--text mt-3">{{ $t('miniGero.txSubmitted') }}</div>
        <div v-if="sponsorWallet" class="success-sponsor">
          <span class="success-sponsor__av">{{ sponsorInitials }}</span>
          {{ $t('midnight.sponsor.feePaidByLabel') }}: {{ sponsorWallet.name }}
        </div>
        <div class="text-caption grey--text mt-1 text-center">{{ $t('miniGero.txSubmittedDesc') }}</div>
        <button v-if="txId" type="button" class="tx-id-box mt-4" @click="copyTxId">
          <span class="text-caption grey--text">{{ truncate(txId) }}</span>
          <v-icon size="x-small" :color="primaryColor" class="ml-1">mdi-content-copy</v-icon>
        </button>
        <v-btn block :color="primaryColor" class="black--text font-weight-bold mt-6" @click="finish">
          {{ $t('miniGero.done') }}
        </v-btn>
      </div>

      <template v-else>
        <v-btn size="small" variant="text" @click="openFullDashboard()">{{ t('midnight.privateBalances.openFullWallet') }}</v-btn>
        <!-- ═══════ STEP 1: RECIPIENT ═══════ -->
        <div class="stepper-step" :class="{ active: step === 1, done: step > 1 }">
          <button type="button" class="step-header" @click="editStep(1)">
            <div class="step-circle" :class="step > 1 ? 'done' : step === 1 ? 'active' : ''">
              <v-icon v-if="step > 1" size="x-small" color="var(--g-on-grad)">mdi-check</v-icon>
              <span v-else>1</span>
            </div>
            <div class="step-info">
              <span class="step-label">{{ $t('miniGero.recipientAddress') }}</span>
              <span v-if="step > 1" class="step-summary">{{ truncate(recipient.trim()) }}</span>
            </div>
          </button>

          <v-expand-transition>
            <div v-show="step === 1" class="step-body">
              <!-- Sends on this network are held (midnightWriteGate.ts: network upgrade, or update required): said up front,
                   before the user fills in anything. Review and Confirm stay held. -->
              <GNote v-if="writesPaused" :icon="sendHold.icon.value" role="status" class="mb-3" data-test="midnight-send-paused-start">
                {{ writesHeldText }}
              </GNote>
              <div class="quick-row">
                <v-btn size="x-small" variant="outlined" :color="primaryColor" @click="showQR = true">
                  <v-icon size="x-small" class="mr-1">mdi-qrcode</v-icon>{{ $t('wallet.qrScan') }}
                </v-btn>
                <v-btn size="x-small" variant="outlined" :color="primaryColor" class="ml-2" @click="pasteFromClipboard">
                  <v-icon size="x-small" class="mr-1">mdi-content-paste</v-icon>{{ $t('common.paste') }}
                </v-btn>
              </div>

              <v-text-field
                v-model="recipient"
                :placeholder="$t('common.recipientAddress')"
                variant="outlined"
                density="compact"
                theme="dark"
                hide-details="auto"
                class="mt-2"
                :error-messages="recipientError"
                :disabled="submitting"
              />

              <QRAddressScannerDialog
                :isOpen="showQR"
                :chain="loggedWallet && loggedWallet.chain"
                :network="loggedWallet && loggedWallet.network"
                @close="showQR = false"
                @scan="onQRScan"
              />

              <v-btn
                block
                :color="primaryColor"
                class="black--text font-weight-bold mt-4"
                :disabled="!isAddressValid"
                @click="goToStep(2)"
              >
                {{ $t('common.continue') }}
              </v-btn>
            </div>
          </v-expand-transition>
        </div>

        <!-- ═══════ STEP 2: AMOUNT ═══════ -->
        <div class="stepper-step" :class="{ active: step === 2, done: step > 2, locked: step < 2 }">
          <button type="button" class="step-header" @click="editStep(2)">
            <div class="step-circle" :class="step > 2 ? 'done' : step === 2 ? 'active' : ''">
              <v-icon v-if="step > 2" size="x-small" color="var(--g-on-grad)">mdi-check</v-icon>
              <span v-else>2</span>
            </div>
            <div class="step-info">
              <span class="step-label">{{ $t('common.amount') }}</span>
              <span v-if="step > 2" class="step-summary">
              {{ amount || '0' }} {{ selectedTicker }}<template v-if="sponsorWallet">
                · {{ $t('midnight.sponsor.feeFrom', { name: sponsorWallet.name }) }}</template>
            </span>
            </div>
          </button>

          <v-expand-transition>
            <div v-show="step === 2" class="step-body">
              <div class="asset-input-section">
                <div class="asset-input-header">
                  <!-- Only a picker once there is a genuine choice. -->
                  <v-select
                    v-if="assetOptions.length > 1"
                    v-model="selectedToken"
                    :items="assetOptions"
                    item-value="value"
                    item-title="ticker"
                    density="compact"
                    variant="outlined"
                    theme="dark"
                    hide-details
                    attach
                    class="asset-select"
                    :disabled="submitting"
                    :aria-label="$t('common.asset')"
                  />
                  <template v-else>
                    <v-avatar size="24" class="mr-2">
                      <img :src="midnightLogo" :alt="nightCurrency" />
                    </v-avatar>
                    <span class="white--text text-body-2 font-weight-bold">{{ selectedTicker }}</span>
                  </template>
                  <v-spacer />
                  <span class="grey--text text-caption">{{ $t('miniGero.available') }}: {{ formattedAvailable }}</span>
                </div>
                <div v-if="rawUnits" class="grey--text text-caption mb-2">
                  {{ $t('midnight.send.rawUnitsNote') }}
                </div>
                <div class="amount-row">
                  <v-text-field
                    v-model="amount"
                    type="number"
                    min="0"
                    :step="amountStep"
                    variant="outlined"
                    density="compact"
                    theme="dark"
                    hide-details="auto"
                    placeholder="0"
                    class="flex-grow-1"
                    :error-messages="amountError"
                    :disabled="submitting"
                  />
                  <v-btn size="x-small" variant="text" :color="primaryColor" class="ml-2" @click="setMax">
                    {{ $t('miniGero.max') }}
                  </v-btn>
                </div>

                <!-- An unverified zero warns and offers a sponsor; it does not disable Review. -->
                <GNote v-if="mayLackDust" icon="mdi-alert-outline" class="mt-3">
                  {{ $t('midnight.send.noDustFee') }}
                </GNote>
                <MidnightSponsorPicker
                  v-if="mayLackDust && loggedWallet"
                  :model-value="sponsorWalletId"
                  :sender-wallet-id="loggedWallet.id"
                  :network="loggedWallet.network"
                  @update:model-value="sponsorWalletId = $event"
                />
                <div v-if="sponsorWallet" class="sponsor-unlock">
                  <template v-if="sponsorNeedsPassword">
                    <v-text-field
                      v-model="sponsorPassword"
                      type="password"
                      autocomplete="off"
                      density="compact"
                      variant="outlined"
                      theme="dark"
                      hide-details="auto"
                      :label="$t('midnight.sponsor.passwordLabel', { name: sponsorWallet.name })"
                    />
                    <div class="sponsor-unlock__warn">
                      {{ $t('midnight.sponsor.notSenderPassword', {
                        sender: loggedWallet ? loggedWallet.name : '',
                      }) }}
                    </div>
                  </template>
                  <!-- The panel cannot host WebAuthn, so a sponsor PassKey opens
                       a popup. Say so before it happens. -->
                  <div v-else class="sponsor-unlock__passkey">
                    <v-icon size="small" class="mr-2">mdi-fingerprint</v-icon>
                    <span>
                      {{ $t('midnight.sponsor.passkeyNotice', {
                        name: sponsorWallet.name,
                        sender: loggedWallet ? loggedWallet.name : '',
                      }) }}
                      {{ $t('midnight.sponsor.passkeyPopupNote') }}
                    </span>
                  </div>

                </div>
              </div>

              <div class="step-actions-row mt-4">
                <v-btn variant="text" size="small" color="var(--g-text-3)" @click="editStep(1)">{{ $t('miniGero.back') }}</v-btn>
                <v-btn
                  :color="primaryColor"
                  class="black--text font-weight-bold flex-grow-1 ml-2"
                  :disabled="!isAmountValid"
                  @click="goToStep(3)"
                >
                  {{ $t('miniGero.review') }}
                </v-btn>
              </div>
            </div>
          </v-expand-transition>
        </div>

        <!-- ═══════ STEP 3: REVIEW ═══════ -->
        <div class="stepper-step" :class="{ active: step === 3, done: step > 3, locked: step < 3 }">
          <button type="button" class="step-header" @click="editStep(3)">
            <div class="step-circle" :class="step > 3 ? 'done' : step === 3 ? 'active' : ''">
              <v-icon v-if="step > 3" size="x-small" color="var(--g-on-grad)">mdi-check</v-icon>
              <span v-else>3</span>
            </div>
            <div class="step-info">
              <span class="step-label">{{ $t('wallet.summary') }}</span>
            </div>
          </button>

          <v-expand-transition>
            <div v-show="step === 3" class="step-body">
              <TransactionDetailsCard
                :outputs="reviewOutputs"
                :totals="reviewTotals"
                :unit="selectedTicker"
                :fee-unit="dustCurrency"
                :fee-label="String($t('midnight.send.estimatedNetworkFee'))"
              />

              <!-- Public-chain disclosure: unshielded transfers are indexer-visible. -->
              <div class="midnight-info-note mt-3">
                <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-eye-outline</v-icon>
                <span>{{ $t('midnight.send.publicTxNote') }}</span>
              </div>

              <!-- DUST fee note (under 1 DUST; sending does NOT reset DUST —
                   verified on preprod, the old "reset" was an estimator bug).
                   None while sends are paused: nothing is sent, so no fee. -->
              <template v-if="!writesPaused">
                <GNote v-if="!isDustLow" icon="mdi-information-outline" class="mt-3">
                  {{ $t('midnight.send.dustResetWarning') }}
                </GNote>
                <!-- Low-DUST hint: informational while there is more DUST than a
                     fee needs; red below 1 DUST, where a send may not clear. -->
                <GNote v-else-if="isDustShort" tone="error" icon="mdi-battery-alert-variant-outline" class="mt-3">
                  {{ $t('midnight.send.dustLowHint', { percent: dustBattery.percent }) }}
                </GNote>
                <div v-else class="midnight-info-note mt-3">
                  <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-battery-alert-variant-outline</v-icon>
                  <span>{{ $t('midnight.send.dustLowHint', { percent: dustBattery.percent }) }}</span>
                </div>
              </template>

              <!-- Sends on this network are held (midnightWriteGate.ts: network upgrade, or update required): the button
                   stays, held but focusable (aria-disabled), with the reason linked
                   to it, and the password step can't open. -->
              <GNote
                v-if="writesPaused"
                id="midnight-sheet-send-paused"
                :icon="sendHold.icon.value"
                role="status"
                class="mt-3"
                data-test="midnight-send-paused"
              >
                {{ writesHeldText }}
              </GNote>

              <div class="step-actions-row mt-4">
                <v-btn variant="text" size="small" color="var(--g-text-3)" @click="editStep(2)">{{ $t('miniGero.back') }}</v-btn>
                <GButton
                  tier="primary"
                  class="flex-grow-1 ml-2"
                  :aria-disabled="writesPaused ? 'true' : undefined"
                  :aria-describedby="writesPaused ? 'midnight-sheet-send-paused' : undefined"
                  :ripple="!writesPaused"
                  data-test="midnight-send-confirm"
                  @click="goToStep(4)"
                >
                  {{ $t('miniGero.confirmSend') }}
                </GButton>
              </div>
            </div>
          </v-expand-transition>
        </div>

        <!-- ═══════ STEP 4: CONFIRM ═══════ -->
        <div class="stepper-step" :class="{ active: step === 4, locked: step < 4 }">
          <div class="step-header step-header--static">
            <div class="step-circle" :class="step === 4 ? 'active' : ''">
              <span>4</span>
            </div>
            <div class="step-info">
              <span class="step-label">{{ $t('miniGero.confirmSend') }}</span>
            </div>
          </div>

          <v-expand-transition>
            <div v-show="step === 4" class="step-body">
              <!-- While the send runs the timeline takes this space: no password field, no CTA. -->
              <template v-if="!submitting">
                <!-- ── Normal wallet (password) ── -->
                <template v-if="isNormalWallet && !isPrfWallet">
                  <div class="text-caption grey--text mb-2">{{ $t('miniGero.spendingPassword') }}</div>
                  <v-text-field
                    v-model="spendingPassword"
                    :type="showPassword ? 'text' : 'password'"
                    variant="outlined"
                    density="compact"
                    theme="dark"
                    hide-details="auto"
                    :placeholder="$t('miniGero.enterPassword')"
                    :append-inner-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
                    :disabled="submitting"
                    @click:append-inner="showPassword = !showPassword"
                    @keydown.enter="signAndSubmit()"
                  />
                  <GButton
                    tier="primary"
                    block
                    class="mt-4"
                    :disabled="!spendingPassword || submitting || !!sendBlock"
                    :loading="submitting"
                    data-test="midnight-send-submit"
                    @click="signAndSubmit()"
                  >
                    <v-icon start size="small">mdi-send</v-icon>
                    {{ sendCtaText }}
                  </GButton>
                </template>

                <!-- ── PRF wallet (PassKey) ── -->
                <template v-else-if="isNormalWallet && isPrfWallet">
                  <div class="hw-notice">
                    <v-icon size="40" :color="primaryColor" class="mb-2">mdi-fingerprint</v-icon>
                    <div class="text-body-2 white--text text-center mb-3">{{ $t('miniGero.prfAuthPrompt') }}</div>
                  </div>
                  <GButton
                    tier="primary"
                    block
                    :disabled="submitting || !!sendBlock"
                    :loading="submitting"
                    data-test="midnight-send-submit-prf"
                    @click="signAndSubmitPrf()"
                  >
                    <v-icon start size="small">mdi-fingerprint</v-icon>
                    {{ sendCtaText }}
                  </GButton>
                </template>

                <!-- ── Any other wallet type: Midnight has no hardware-wallet
                     signing support. ── -->
                <template v-else>
                  <div class="hw-notice">
                    <v-icon size="40" color="var(--g-text-3)" class="mb-2">mdi-alert-circle-outline</v-icon>
                    <div class="text-body-2 grey--text text-center">{{ $t('midnight.connector.walletTypeUnsupported') }}</div>
                  </div>
                </template>
              </template>

              <!-- The same five-node timeline the options page shows. This
                   used to be one line of text, hiding a first-time DUST ledger
                   replay that can run for minutes. -->
              <div v-if="submitting" class="mini-tl mt-3">
                <div v-if="sponsorWallet" class="mini-tl__who">
                  <span class="success-sponsor__av">{{ sponsorInitials }}</span>
                  {{ $t('midnight.sponsor.feePaidByLabel') }}: {{ sponsorWallet.name }}
                </div>
                <MidnightSendTimeline compact :nodes="timelineNodes" />
                <!-- Gero Cloud stayed busy after the automatic resubmits: the transaction is
                     signed and kept in memory; Try again resends the same bytes, no password. -->
                <template v-if="busyPrompt">
                  <GNote icon="mdi-clock-outline" role="status" class="mt-2" data-test="midnight-send-still-busy">
                    {{ $t('midnight.busy.stillBusy') }}
                  </GNote>
                  <div ref="busyActionsEl" class="mini-tl__busy-actions mt-2">
                    <GButton tier="secondary" compact data-test="midnight-send-busy-cancel" @click="answerBusy('cancel')">{{ $t('common.cancel') }}</GButton>
                    <GButton tier="primary" compact data-test="midnight-send-busy-retry" @click="answerBusy('retry')">{{ $t('common.tryAgain') }}</GButton>
                  </div>
                </template>
                <!-- The send runs in this panel: closing it stops the send. -->
                <div v-else class="mini-tl__keep">{{ $t('midnight.send.keepPanelOpen') }}</div>
              </div>

              <!-- Not an error: sends are paused on this network, or this build can't sign
                   for the network's ledger. The amber note, and the CTA is disabled. -->
              <GNote v-if="sendBlock" icon="mdi-pause-circle-outline" role="status" class="mt-2" data-test="midnight-send-blocked">
                {{ sendBlockText }}
              </GNote>

              <p v-if="busyCancelled && !submitting" role="status" class="mini-tl__cancelled t-caption mt-2 mb-0 text-center" data-test="midnight-send-cancelled">
                {{ $t('midnight.busy.nothingSent') }}
              </p>
              <p v-if="passwordError" role="alert" class="t-caption mt-2 mb-0 text-center" style="color: var(--g-error)">
                {{ passwordError }}
              </p>

              <div class="step-actions-row mt-3">
                <v-btn variant="text" size="small" color="var(--g-text-3)" block :disabled="sendDispatched" @click="editStep(3)">
                  {{ $t('miniGero.back') }}
                </v-btn>
              </div>
            </div>
          </v-expand-transition>
        </div>
      </template>
    </div>
    <ShieldedProvingConsentDialog
      :is-open="consentOpen"
      :provider="consentProvider"
      @close="cancelConsent"
      @accepted="acceptConsent"
    />
  </BottomSheet>
</template>

<script setup lang="ts">
import { MIDNIGHT_DUST_FEE_ESTIMATE_DISPLAY, dustShortForFee } from '@/chains/midnight/midnightFeeEstimate';
import { ref, computed, watch, nextTick, toRefs, onBeforeUnmount } from 'vue';
import { geroStore } from '@/stores/geroStore';
import { useMidnightSendTimeline } from '@/shared/composables/useMidnightSendTimeline';
import { provingDetail } from '@/shared/composables/useProvingElapsed';
import { usePoliteAnnouncer } from '@/shared/composables/usePoliteAnnouncer';
import MidnightSendTimeline from '@/shared/components/MidnightSendTimeline.vue';
import MidnightSponsorPicker from '@/modules/dashboard/dialogs/MidnightSponsorPicker.vue';
import BottomSheet from '../BottomSheet.vue';
import QRAddressScannerDialog from '@/modules/dashboard/dialogs/QRAddressScannerDialog.vue';
import TransactionDetailsCard, {
  type TxDetailsOutput,
  type TxDetailsTotals,
} from '@/shared/components/TransactionDetailsCard.vue';
import midnightLogo from '@/assets/svg/midnight.svg';
import { walletStore } from '@/stores/walletStore';
import { hasMidnightProvingConsent } from '@/chains/midnight/midnightProvingConsent';
import { walletProverFor } from '@/chains/midnight/midnightProvingTarget';
import { midnightStore } from '@/stores/midnightStore';
import ShieldedProvingConsentDialog from '@/modules/dashboard/dialogs/ShieldedProvingConsentDialog.vue';
import { openFullDashboard } from '@/shared/utils/openFullDashboard';
import { Network, WalletType } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { midnightTokenBalances } from '@/chains/midnight/midnightTokenBalances';
import { midnightTokenMeta } from '@/chains/midnight/midnightTokenRegistry';
import { blocksMidnightSendLive, mayLackDustLive } from '@/chains/midnight/midnightFeeCapacity';
import { dustBatteryPercent } from '@/chains/midnight/midnightDustBalance';
import { historyHashForSubmittedTx } from '@/chains/midnight/midnightTxHash';
import { useMidnightDustLive } from '@/shared/composables/useMidnightDustLive';
import {
  formatTokenAmount,
  parseTokenAmount,
  toAmountInput,
} from '@/chains/midnight/midnightAmount';
import type { MidnightSendStage } from '@/services/midnight-tx.service';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useChainContext } from '../../composables/useChainContext';
import snackbar from '@/plugins/snackbar';
import { takeMidnightSendPrefill } from '@/chains/midnight/midnightSendPrefill';
import { debugLog } from '@/utils/debug';
import { useApprovalFreshness, awaitFreshApproval, StaleApprovalError } from '@/shared/composables/useApprovalFreshness';
import { midnightApiErrorKind, midnightSendBlockOf, type MidnightSendBlock } from '@/api/midnightApiError';
import { isMidnightBusyCancelled, type MidnightBusyHandlers } from '@/services/midnightBusyRetry';
import { useMidnightSendHold } from '@/shared/composables/useMidnightSendHold';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';

const { t } = useTranslation();
const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const { loggedWallet } = toRefs(walletStore);

// ── State ──
const step = ref(1);
/**
 * Why sends on this wallet's network are held, if they are, as one reason:
 * update required, the network upgrade, or a rebuild in progress
 * (useMidnightSendHold.ts). `writesPaused` is "held for any of them".
 */
const sendHold = useMidnightSendHold(() => loggedWallet.value?.network);
const writesPaused = sendHold.held;
const writesHeldText = sendHold.sendText;
const stepperEl = ref<HTMLElement | null>(null);

const recipient = ref('');
const amount = ref('');
const showQR = ref(false);

const spendingPassword = ref('');
const showPassword = ref(false);
const passwordError = ref('');
/** The last send failed with LEDGER_MISMATCH: the CTA reads "Try again" and sends from a new build. */
const ledgerMismatch = ref(false);
const sendCtaText = computed(() => (ledgerMismatch.value ? t('common.tryAgain') : t('miniGero.confirmSend')));
/** Refused for a state the user can't fix here (midnightApiError.ts): a note, and the CTA is disabled. */
const sendBlock = ref<MidnightSendBlock | null>(null);
const sendBlockText = ref('');

/** Seconds until the automatic resubmit while Gero Cloud is busy (midnightBusyRetry.ts). */
const busySeconds = ref<number | null>(null);
/** Set while the send waits for Try again or Cancel after the automatic resubmits. */
const busyPrompt = ref<((choice: 'retry' | 'cancel') => void) | null>(null);
/** Shown after Cancel on the still-busy prompt: nothing went out, and nothing went wrong. */
const busyCancelled = ref(false);
const busyActionsEl = ref<HTMLElement | null>(null);
/** Ends the current send's busy countdown at once (Cancel, the sheet going away), timer included. */
let busyAbort: AbortController | null = null;

/** The busy countdown and the still-busy prompt for one send. */
function busyHandlers(current: () => boolean): MidnightBusyHandlers {
  busyAbort?.abort();
  busyAbort = new AbortController();
  return {
    signal: busyAbort.signal,
    onCountdown: (seconds) => { if (current()) busySeconds.value = seconds; },
    onStillBusy: () => new Promise<'retry' | 'cancel'>((resolve) => {
      if (!current()) { resolve('cancel'); return; }
      busyPrompt.value = (choice) => { busyPrompt.value = null; resolve(choice); };
    }),
  };
}

function answerBusy(choice: 'retry' | 'cancel') {
  if (choice === 'cancel') busyAbort?.abort();
  busyPrompt.value?.(choice);
}
onBeforeUnmount(() => answerBusy('cancel'));
// The prompt is the next thing to act on: focus Try again when it appears.
watch(busyPrompt, (prompt) => {
  if (!prompt) return;
  void nextTick(() => busyActionsEl.value?.querySelector<HTMLElement>('[data-test="midnight-send-busy-retry"]')?.focus());
});

/** Show a failed send: a note for a state the user can't fix here, else the error's readable message. */
function showSendError(e: unknown) {
  // Cancel while Gero Cloud was busy: nothing was sent and nothing went wrong.
  if (isMidnightBusyCancelled(e)) {
    busyCancelled.value = true;
    return;
  }
  const message = e instanceof Error ? e.message : String(e);
  const block = midnightSendBlockOf(e);
  ledgerMismatch.value = !block && midnightApiErrorKind(e) === 'ledgerMismatch';
  if (block) {
    sendBlock.value = block;
    sendBlockText.value = message;
    passwordError.value = '';
    return;
  }
  passwordError.value = message;
}
const submitting = ref(false);
// Turned on while the password step is open: back to the review, so no password or PassKey is asked for.
watch(writesPaused, (paused) => {
  if (paused && step.value === 4 && !submitting.value) {
    approval.invalidate();
    step.value = 3;
  }
});
const txSuccess = ref(false);
const txId = ref('');

type SendStageOrIdle = MidnightSendStage | 'idle';
const sendStage = ref<SendStageOrIdle>('idle');
const sendDispatched = computed(() => submitting.value && sendStage.value !== 'idle' && sendStage.value !== 'authorizing');

// ── Wallet / network ──
const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);
const nightCurrency = computed(() => (isMainnet.value ? 'NIGHT' : 'tNIGHT'));
const dustCurrency = computed(() => (isMainnet.value ? 'DUST' : 'tDUST'));

const isNormalWallet = computed(() => loggedWallet.value?.type === WalletType.Normal);
const isPrfWallet = computed(() =>
  loggedWallet.value?.type === WalletType.Normal && !!loggedWallet.value?.webAuthnCredentialId,
);

const sheetTitle = computed(() => (txSuccess.value ? '' : t('wallet.quickSend')));

// ── Balance / amount (unshielded only — WP7 scope decision) ──
/** `NIGHT` for the native token, otherwise a 32-byte colour as hex. */
const selectedToken = ref<string>('NIGHT');

/** Per-colour unshielded balances derived from the wallet's own UTxO set. */
const tokenBalances = computed(() => midnightTokenBalances(midnightStore.utxos ?? []));

interface AssetOption {
  value: string;
  ticker: string;
  /** null = exponent genuinely unknown; amounts are then raw base units. */
  decimals: number | null;
}

const assetOptions = computed<AssetOption[]>(() => {
  const night: AssetOption = {
    value: 'NIGHT',
    ticker: nightCurrency.value,
    decimals: MIDNIGHT_DECIMALS.NIGHT,
  };
  const tokens = Object.keys(tokenBalances.value).map((color) => {
    const meta = midnightTokenMeta(color);
    return {
      value: color,
      ticker: meta?.symbol ?? `${color.slice(0, 8)}\u2026${color.slice(-6)}`,
      decimals: meta?.decimals ?? null,
    } as AssetOption;
  });
  return [night, ...tokens];
});

const selectedAsset = computed<AssetOption>(
  () => assetOptions.value.find((o) => o.value === selectedToken.value) ?? assetOptions.value[0],
);
const selectedDecimals = computed(() => selectedAsset.value.decimals);
const selectedTicker = computed(() => selectedAsset.value.ticker);
const rawUnits = computed(() => selectedDecimals.value === null);
const amountStep = computed(() =>
  rawUnits.value ? '1' : `0.${'0'.repeat((selectedDecimals.value ?? 1) - 1)}1`,
);

const available = computed(() =>
  selectedToken.value === 'NIGHT'
    ? (midnightStore.balances?.nightUnshielded ?? 0n)
    : (tokenBalances.value[selectedToken.value] ?? 0n));

const formattedAvailable = computed(() =>
  formatTokenAmount(available.value, selectedDecimals.value));

/** Scales against the SELECTED token's decimals — see midnightAmount.ts. */
function parseAmount(input: string): bigint {
  return parseTokenAmount(input, selectedDecimals.value);
}

function setMax() {
  amount.value = toAmountInput(available.value, selectedDecimals.value);
}

// ── Validation ──
// Midnight bech32m HRP is mn_<type>[_<network>]1<data>; MAINNET omits the
// network segment. Mirrors MidnightSendDialog.vue's expectedAddressPrefix.
function expectedAddressPrefix(): string {
  return isMainnet.value ? 'mn_addr1' : `mn_addr_${(loggedWallet.value?.network || '').toLowerCase()}1`;
}

const isAddressValid = computed(() => {
  const v = recipient.value.trim();
  return !!v && v.startsWith(expectedAddressPrefix());
});

const recipientError = computed(() => {
  const v = recipient.value.trim();
  if (!v) return '';
  if (!v.startsWith(expectedAddressPrefix())) {
    return t('midnight.send.addressPrefix', { prefix: expectedAddressPrefix() });
  }
  return '';
});

/**
  * Whether this wallet may be unable to pay the DUST fee. Surfaced on the amount step so
  * the user learns it before authorizing, not after the SDK stalls.
  *
  * Judged on the MERGED live balance (Path A + Path B) — the figure the
  * battery shows — not the store's Path-A `dustState`, which reads zero for a
  * wallet whose DUST comes entirely from a Cardano cNIGHT registration.
  * `unknown` (either path not yet reported) never warns.
  *
  * A zero is only ever a WARNING here, not a refusal. The indexer reports live
  * generation, not spendable DUST, so a zero can hide DUST that was generated earlier and is
  * still decaying (see `midnightFeeCapacity.ts`). The user gets the notice and the sponsor
  * picker, and Review stays enabled so they can try with their own DUST.
  */
const dustLive = useMidnightDustLive();
const dustFeeInputs = computed(() => ({
  dustBalance: dustLive.dustBalance.value,
  settled: dustLive.settled.value,
}));
const mayLackDust = computed(() => mayLackDustLive(dustFeeInputs.value));
/** A VERIFIED zero: the only reading that blocks. Nothing verifies one today, so this is never true. */
const noFeeCapacity = computed(() => blocksMidnightSendLive(dustFeeInputs.value));

/**
 * Wallet chosen to pay this send's DUST fee, mirroring the options-page dialog.
 * The picker is the only writer.
 */
const sponsorWalletId = ref<number | null>(null);
const sponsorWallet = computed(() => (
  sponsorWalletId.value == null ? null : (geroStore.wallets?.[sponsorWalletId.value] ?? null)
));
const sponsorNeedsPassword = computed(() => (
  !!sponsorWallet.value && sponsorWallet.value.encryptionMethod !== 'prf'
));
const sponsorPassword = ref('');

/** Monogram for the success pill. */
const sponsorInitials = computed(() => {
  const name = sponsorWallet.value?.name ?? '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
});

/**
 * A verified missing DUST balance only blocks the send while nothing else will pay for
 * it — with a sponsor chosen the fee comes from that wallet. An unverified zero never
 * reaches this: it warns but does not block.
 */
const blockedByFee = computed(() => noFeeCapacity.value && sponsorWalletId.value == null);

const amountError = computed(() => {
  if (blockedByFee.value) return t('midnight.send.noDustFee');
  if (!amount.value) return '';
  // Judged by the parser that builds the tx, not Number(): the two disagree on
  // exponential notation ('1e2' passes Number, parses to 0n) and on amounts
  // below one base unit, and the balance check below is an upper bound only.
  if (parseAmount(amount.value) <= 0n) return t('send.amountMustBePositive');
  if (parseAmount(amount.value) > available.value) return t('errors.insufficientBalance');
  return '';
});

const isAmountValid = computed(() =>
  !!amount.value && parseAmount(amount.value) > 0n && !amountError.value);

// ── DUST battery (same merged live source as MidnightSendDialog.vue; the
//    store's Path-A `dustState` hid it for a cNIGHT-backed wallet, issue 1118) ──
const dustBattery = computed<{ percent: number } | null>(() =>
  dustBatteryPercent(dustLive.dustBalance.value, dustLive.dustCap.value));
// Too little DUST for a send's fee (under 1 DUST: ledger 9 fees are around
// 0.6 DUST), so the hint escalates to the error tone. More than that stays
// informational.
const isDustShort = computed(() => dustLive.settled.value && dustShortForFee(dustLive.dustBalance.value));
// The hint names the battery level, so it needs a battery to show.
const isDustLow = computed(() => !!dustBattery.value && (dustBattery.value.percent < 20 || isDustShort.value));

// ── Review model (fed to the shared TransactionDetailsCard, same as the
//    dashboard dialog) ──
// Ledger 9's fee floor: see midnightFeeEstimate.ts (#1452 M14).
const feeEstimateDisplay = MIDNIGHT_DUST_FEE_ESTIMATE_DISPLAY;

function truncate(addr: string): string {
  if (!addr) return '';
  return addr.length <= 20 ? addr : `${addr.slice(0, 12)}…${addr.slice(-6)}`;
}

const ownAddresses = computed(() => {
  const a = midnightStore.addresses;
  return [a?.unshielded, a?.shielded, loggedWallet.value?.baseAddress]
    .filter((x): x is string => typeof x === 'string' && x.length > 0);
});
const isSelfSend = computed(() => ownAddresses.value.includes(recipient.value.trim()));

const reviewOutputs = computed<TxDetailsOutput[]>(() => [{
  kind: isSelfSend.value ? 'own' : 'external',
  truncatedAddress: truncate(recipient.value.trim()),
  fullAddress: recipient.value.trim(),
  ada: amount.value || '0',
}]);

const reviewTotals = computed<TxDetailsTotals>(() => ({
  totalSendingAda: amount.value || '0',
  feeAda: feeEstimateDisplay,
  youPayAda: amount.value || '0',
  isInternal: isSelfSend.value,
}));

// ── Progress label (mirrors MidnightSendDialog.vue's timeline stage split,
//    condensed to a single caption line for the sidepanel). ──

// ── Step navigation ──
function editStep(target: number) {
  if (target < step.value && !sendDispatched.value) {
    approval.invalidate();
    sendBlock.value = null;
    ledgerMismatch.value = false;
    step.value = target;
  }
}

function goToStep(target: number) {
  if (submitting.value) return;
  if (target === 4 && writesPaused.value) return;
  if (target === 2 && !isAddressValid.value) return;
  if (target === 3 && !isAmountValid.value) return;
  step.value = target;
  nextTick(() => scrollToActiveStep());
}

function scrollToActiveStep() {
  if (!stepperEl.value) return;
  const active = stepperEl.value.querySelector('.stepper-step.active');
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Recipient helpers ──
function onQRScan(scanned: string) {
  showQR.value = false;
  if (typeof scanned === 'string' && scanned.trim()) {
    recipient.value = scanned.trim();
  }
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    recipient.value = text.trim();
  } catch (e) {
    console.warn('Could not paste:', e);
  }
}

function copyTxId() {
  if (txId.value) navigator.clipboard.writeText(txId.value).catch(() => {});
}

// ── Sign & submit (mirrors MidnightSendDialog.vue's sendUnshielded exactly:
//    same service call, same credentials shape, same onStage callback, same
//    addPendingMidnightTx follow-up call after a successful submit). ──
/** The wallet that sent is still the one logged in (the sheet may be gone, the wallet not switched). */
function isSameWallet(sent: { id: number; network: string }): boolean {
  return walletStore.loggedWallet?.id === sent.id && walletStore.loggedWallet?.network === sent.network;
}

// From the values the send started with (the token too: without it a token
// send shows as NIGHT in history until gero-sync backfills the confirmed row).
// Not tied to the view: an accepted transaction gets its pending row even if
// the sheet is gone.
async function addOptimisticPendingTx(
  hash: string,
  draft: { amount: bigint; to: string; token: string },
  sent: { ledgerHash: boolean; fromAddress: string },
) {
  try {
    const { addPendingMidnightTx } = await import('@/services/midnight-tx.service');
    // `ledgerHash`: whether `hash` is the ledger hash the indexer knows (midnightPendingSends.ts);
    // `fromAddress`: the background records the row only into the sending wallet's history.
    await addPendingMidnightTx(hash, draft.amount, draft.to, false, draft.token, sent.fromAddress, sent.ledgerHash);
  } catch {
    /* non-fatal — gero-sync backfills the confirmed entry */
  }
}

const consentOpen = ref(false);
const consentProvider = ref<'cloud' | 'zkpaas'>('cloud');
const pendingCredentials = ref<{ password?: string; prfSecret?: Uint8Array } | null>(null);
let pendingAuthorization: (() => boolean) | null = null;
const pendingPopups = new Set<() => void>();
const approval = useApprovalFreshness(() => [
  loggedWallet.value?.id, loggedWallet.value?.chain, loggedWallet.value?.network,
  loggedWallet.value?.webAuthnCredentialId, walletStore.isLocked,
  recipient.value, amount.value, selectedToken.value, sponsorWalletId.value,
  sponsorWallet.value?.webAuthnCredentialId, sponsorPassword.value, step.value,
  midnightStore.proofServer,
], () => props.modelValue, () => {
  pendingPopups.forEach(cancel => cancel());
  pendingPopups.clear();
  pendingCredentials.value?.prfSecret?.fill(0);
  pendingCredentials.value = null;
  pendingAuthorization = null;
  consentOpen.value = false;
  spendingPassword.value = '';
});
function cancelConsent() {
  approval.invalidate();
  consentOpen.value = false;
  pendingCredentials.value?.prfSecret?.fill(0);
  pendingCredentials.value = null;
  spendingPassword.value = '';
  submitting.value = false;
}
async function acceptConsent() {
  consentOpen.value = false;
  const credentials = pendingCredentials.value;
  const current = pendingAuthorization;
  pendingCredentials.value = null;
  pendingAuthorization = null;
  if (!credentials || !current?.()) { credentials?.prfSecret?.fill(0); return; }
  // The prover may have changed while the notice was open: decide again.
  if (sendProver() !== consentProvider.value) {
    await approval.run(() => routeSend(credentials, current));
    return;
  }
  await approval.run(() => submitSend(credentials, current));
}
/**
 * Who proves this public send (midnight-tx.service's rule): in Gero Cloud
 * mode its DUST fee is proven on this device, so only zkPaaS (and Stagenet,
 * which this device cannot prove) still needs a consent notice.
 */
function sendProver() {
  return walletProverFor(loggedWallet.value?.network ?? '', midnightStore.proofServer, 'unshielded');
}
async function routeSend(credentials: { password?: string; prfSecret?: Uint8Array }, current: () => boolean) {
  if (!current()) { credentials.prfSecret?.fill(0); return; }
  const prover = sendProver();
  if ((prover === 'cloud' || prover === 'zkpaas') && !hasMidnightProvingConsent(midnightStore.shieldedProvingConsent, prover)) {
    pendingCredentials.value = credentials;
    pendingAuthorization = current;
    consentProvider.value = prover;
    consentOpen.value = true;
    submitting.value = false;
    return;
  }
  await submitSend(credentials, current);
}

async function submitSend(credentials: { password?: string; prfSecret?: Uint8Array }, current: () => boolean) {
  if (!current()) { credentials.prfSecret?.fill(0); return; }
  const wallet = loggedWallet.value;
  if (!wallet) {
    passwordError.value = t('errors.noWalletLogged');
    submitting.value = false; // PRF path pre-sets submitting=true before this guard runs
    return;
  }
  passwordError.value = '';
  ledgerMismatch.value = false;
  busyCancelled.value = false;
  submitting.value = true;
  sendStage.value = 'authorizing';
  // Captured now: the pending row and the sponsor link are recorded once the
  // submit is accepted, even if the sheet has been reset or closed by then.
  const draft = {
    amount: parseAmount(amount.value),
    to: recipient.value.trim(),
    token: selectedToken.value,
    amountLabel: `${amount.value} ${selectedToken.value === 'NIGHT' ? 'NIGHT' : shortToken(selectedToken.value)}`,
  };
  const paying = sponsorWallet.value;
  let sponsor: Awaited<ReturnType<typeof buildSponsorArg>>;
  try {
    const { sendUnshieldedNight } = await awaitFreshApproval(() => import('@/services/midnight-tx.service'), current);
    sponsor = await buildSponsorArg(current);
    if (!current()) { sponsor?.prfSecret?.fill(0); return; }
    const result = await sendUnshieldedNight(
      wallet.network,
      {
        fromAddress: wallet.baseAddress,
        outputs: [{
          address: draft.to,
          amount: draft.amount.toString(),
          token: draft.token,
        }],
        ttlMs: Date.now() + 5 * 60_000,
      },
      credentials,
      (stage) => {
        // Signed: the PassKey secrets are not needed again, even if Gero Cloud keeps the send waiting.
        if (stage === 'submitting' || stage === 'provingCloud') {
          credentials.prfSecret?.fill(0);
          sponsor?.prfSecret?.fill(0);
        }
        if (current()) sendStage.value = stage;
      },
      sponsor,
      false,
      current,
      busyHandlers(current),
    );
    debugLog('🌙 mini-Gero Midnight unshielded tx submitted:', result.txHash, 'ledger:', result.ledgerTxHash ?? 'n/a',
      'status:', result.status, 'sponsor:', paying?.id ?? 'none');
    // The hash history will know this tx by — the ledger hash, not the
    // extrinsic hash in txHash (see midnightTxHash.ts). Everything that must
    // match the row later keys on it.
    const historyHash = historyHashForSubmittedTx(result);

    // The transaction is accepted: record it whether or not this view is
    // still the current one. Only the screen updates below wait on that.
    // Remember who paid, for the battery indicator on both wallets and the
    // transaction details screen. Best effort — never fail a submitted tx.
    if (paying) {
      try {
        const { recordSponsoredTx, saveSponsorLink } = await import('@/chains/midnight/midnightSponsorLinks');
        const at = Date.now();
        await saveSponsorLink({
          walletId: wallet.id,
          sponsorWalletId: paying.id,
          sponsorName: paying.name,
          network: wallet.network,
          at,
        });
        await recordSponsoredTx({
          txHash: historyHash,
          sponsorWalletId: paying.id,
          sponsorName: paying.name,
          at,
          sponsoredWalletId: wallet.id,
          sponsoredWalletName: wallet.name,
          amountLabel: draft.amountLabel,
          recipient: draft.to,
        });
      } catch (e) {
        debugLog('🌙 could not record sponsorship for this tx', e);
      }
    }
    // Show it in history right away — gero-sync backfills the confirmed entry.
    // Into this wallet's history only: after a wallet switch it would land in another's.
    if (isSameWallet(wallet)) void addOptimisticPendingTx(historyHash, draft, { ledgerHash: !!result.ledgerTxHash, fromAddress: wallet.baseAddress });
    if (!current()) return;
    txId.value = historyHash;
    txSuccess.value = true;
    snackbar.fireSuccess(t('miniGero.txSubmitted'));
  } catch (e) {
    if (!current()) return;
    showSendError(e);
  } finally {
    sponsor?.prfSecret?.fill(0);
    credentials.prfSecret?.fill(0);
    spendingPassword.value = '';
    busySeconds.value = null;
    answerBusy('cancel');
    submitting.value = false;
    sendStage.value = 'idle';
  }
}

async function signAndSubmit() {
  if (!spendingPassword.value || submitting.value || !isAddressValid.value || !isAmountValid.value || writesPaused.value) return;
  const current = approval.capture();
  const password = spendingPassword.value;
  await approval.run(() => routeSend({ password }, current));
}

// PRF (PassKey) — side panels cannot host WebAuthn directly, so this reuses
// the exact cross-window popup workaround DAppOverlay.vue's
// signMidnightTransferPrf() implements (mode=rawPrf), since Midnight decrypts
// its mnemonic from the raw PRF output rather than a Cardano private key.
function requestRawPrf(current: () => boolean, walletId?: number): Promise<Uint8Array> {
  if (!current()) return Promise.reject(new StaleApprovalError());
  // `walletId` unlocks a wallet OTHER than the logged-in one — a DUST sponsor.
  // Omitted, the popup evaluates the active wallet exactly as before.
  const target = walletId == null ? '' : `&walletId=${encodeURIComponent(String(walletId))}`;
  const popupUrl = chrome.runtime.getURL(`index.html?mode=rawPrf${target}#/passkey-auth`);
  const popup = window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');
  if (!popup) return Promise.reject(new Error(t('errors.popupBlocked')));

  return new Promise((resolve, reject) => {
    const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
    const cleanup = () => {
      window.removeEventListener('message', handler);
      clearTimeout(timeout);
      pendingPopups.delete(cancel);
      popup.close();
    };
    const cancel = () => { cleanup(); reject(new StaleApprovalError()); };
    const handler = (event: MessageEvent) => {
      if (event.origin !== extensionOrigin || event.source !== popup) return;
      if (event.data?.type === 'PASSKEY_AUTH_RESULT') {
        cleanup();
        const { success, prfOutput, error } = event.data.payload;
        if (success && prfOutput) {
          const bytes = new Uint8Array(prfOutput);
          if (!current()) { bytes.fill(0); reject(new StaleApprovalError()); }
          else resolve(bytes);
        }
        else reject(new Error(error || t('security.passKeyAuthFailed')));
      }
    };
    window.addEventListener('message', handler);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(t('errors.authenticationTimeout')));
    }, 60000);
    pendingPopups.add(cancel);
  });
}

/**
 * The sponsor argument for `sendUnshieldedNight`, using the sponsor wallet's
 * OWN credential.
 *
 * The PassKey path goes through the same popup as the sender's, but with an
 * explicit `walletId`: the side panel cannot host WebAuthn, and the sponsor is
 * by definition not the logged-in wallet, so the popup has to be told which
 * credential to evaluate.
 */
async function buildSponsorArg(current: () => boolean) {
  const sponsor = sponsorWallet.value;
  if (!sponsor) return undefined;

  if (sponsor.encryptionMethod === 'prf') {
    const prfBytes = await requestRawPrf(current, sponsor.id);
    return { walletId: sponsor.id, prfSecret: prfBytes };
  }

  if (!sponsorPassword.value) throw new Error(t('midnight.sponsor.passwordRequired'));
  return { walletId: sponsor.id, password: sponsorPassword.value };
}

/**
 * Restore the stored sponsor preference. The picker still re-resolves whether
 * that wallet can actually pay.
 */
async function restoreSponsorPreference() {
  const wallet = loggedWallet.value;
  if (!wallet) return;
  const current = approval.capture();
  const { linkFor, loadSponsorLinks } = await import('@/chains/midnight/midnightSponsorLinks');
  const link = linkFor(await loadSponsorLinks(), wallet.id, wallet.network);
  if (!current()) return;
  // Re-check: the capacity may have flipped while the links were loading.
  sponsorWalletId.value = mayLackDust.value ? (link?.sponsorWalletId ?? null) : null;
}
// A saved sponsor is restored only while this wallet actually needs one, and
// dropped the moment it does not. `sponsorWalletId` is otherwise only written
// by the picker, which is hidden whenever `mayLackDust` is false — so
// without this, a wallet that saved a sponsor back when the guard wrongly
// refused it (a Path-B wallet, before the merged-balance fix) would send
// sponsored with no in-dialog way to opt out.
watch(mayLackDust, (needsSponsor) => {
  if (needsSponsor) void restoreSponsorPreference();
  else sponsorWalletId.value = null;
}, { immediate: true });

async function signAndSubmitPrf() {
  if (submitting.value || !isAddressValid.value || !isAmountValid.value || writesPaused.value) return;
  const current = approval.capture();
  await approval.run(async () => {
  passwordError.value = '';
  submitting.value = true;
  sendStage.value = 'authorizing';
  try {
    const prfBytes = await requestRawPrf(current);
    await routeSend({ prfSecret: prfBytes }, current);
  } catch (e) {
    if (current()) showSendError(e);
  } finally {
    submitting.value = false;
    sendStage.value = 'idle';
  }
  });
}

// ── Close / reset ──
function finish() {
  approval.invalidate();
  emit('update:modelValue', false);
}

// Block dismissal while a send is running (the BG work continues even if the
// sheet closes, so keep the confirm step visible until it resolves).
function onSheetInput(val: boolean) {
  if (!val && sendDispatched.value) return;
  if (!val) approval.invalidate();
  emit('update:modelValue', val);
}

function resetAll() {
  cancelConsent();
  step.value = 1;
  recipient.value = '';
  amount.value = '';
  // The sheet resets everything else on every open; the asset was the one
  // field that persisted, which risks sending the wrong colour by inertia.
  selectedToken.value = 'NIGHT';
  showQR.value = false;
  spendingPassword.value = '';
  showPassword.value = false;
  passwordError.value = '';
  ledgerMismatch.value = false;
  sendBlock.value = null;
  submitting.value = false;
  sendStage.value = 'idle';
  txSuccess.value = false;
  txId.value = '';
}

watch(() => props.modelValue, (val) => {
  if (!val) return;
  resetAll();
  applySendAgain();
});

/**
 * "Send again" for a send that never went through (midnightPendingSends.ts):
 * recipient, token and amount filled in, at the first step; the user reviews
 * and confirms as for any send.
 */
function applySendAgain() {
  const prefill = takeMidnightSendPrefill();
  if (!prefill) return;
  selectedToken.value = prefill.token || 'NIGHT';
  recipient.value = prefill.recipient;
  amount.value = toAmountInput(prefill.amount, selectedDecimals.value);
}

/** Token colours are 64-char hex; show the head so a label stays readable. */
function shortToken(colour: string): string {
  return colour.length > 12 ? `${colour.slice(0, 6)}…` : colour;
}

/**
 * Same five-node timeline the options-page dialog shows, driven by the same
 * stage rank and the same `midnightStore.sendProgress`, so the two surfaces
 * can never disagree about where a send has got to.
 */
const timelineLabels = computed(() => ({
  authorize: t('midnight.send.stageAuthorize') as string,
  build: t('midnight.send.stageBuild') as string,
  sync: (sponsorWallet.value
    ? t('midnight.send.stageSyncNamed', { name: sponsorWallet.value.name })
    : t('midnight.send.stageSync')) as string,
  sign: t('midnight.send.stageSign') as string,
  submit: t('midnight.send.stageSubmit') as string,
  provingDevice: t('midnight.send.stageProvingDevice') as string,
  provingLocal: t('midnight.send.stageProvingLocal') as string,
  provingZkpaas: t('midnight.send.stageProvingZkpaas') as string,
  provingCloud: t('midnight.send.stageProvingCloud') as string,
}));
const { message: liveMessage, announce } = usePoliteAnnouncer();
const timelineNodes = useMidnightSendTimeline(
  computed(() => sendStage.value),
  timelineLabels,
  {
    // "Keep this panel open" is always shown under the timeline, so the slow hint need not repeat it.
    provingDetailFor: (step, seconds) => provingDetail(step, seconds, (key, params) => String(t(key, params)), { keepOpenShown: true }),
    announce,
    // Gero Cloud is busy: counting down to the automatic resubmit.
    submitDetail: computed(() => (busySeconds.value != null ? String(t('midnight.busy.retrying', { n: busySeconds.value })) : undefined)),
  },
);
</script>

<style scoped lang="scss">
.midnight-send-sheet {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 16px;
}

/* ── Success ── */
.success-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
}
.tx-id-box {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  font: inherit;
  color: inherit;
}

/* ── Stepper step ── */
.stepper-step {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  overflow: hidden;
  transition: border-color var(--g-dur-base), background var(--g-dur-base);
}
.stepper-step.active {
  background: var(--g-hairline-1);
  border-color: color-mix(in srgb, var(--g-accent) 20%, transparent);
}
.stepper-step.done {
  border-color: var(--g-success-line);
}
.stepper-step.locked {
  opacity: 0.5;
  pointer-events: none;
}

.step-header {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 12px 14px;
  cursor: pointer;
  gap: 10px;
  background: none;
  border: none;
  text-align: left;
}
.step-header--static {
  cursor: default;
}

.step-circle {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  background: var(--g-hairline-1);
  color: var(--g-text-3);
  transition: background-color var(--g-dur-base), color var(--g-dur-base);
}
.step-circle.active {
  background: var(--g-accent);
  color: var(--g-on-grad);
}
.step-circle.done {
  background: var(--g-success);
  color: var(--g-on-grad);
}

.step-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.step-label {
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
}
.step-summary {
  color: var(--g-text-3);
  font-size: 11px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.step-body {
  padding: 0 14px 14px;
}

/* ── Quick actions row ── */
.quick-row {
  display: flex;
}

/* ── Amount section ── */
.asset-input-section {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 10px;
}
.asset-input-header {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
/* Vuetify `dense` already sets the compact height; only the width needs
   constraining so the available-balance label keeps its place in the row. */
.asset-select {
  max-width: 132px;
  flex: 0 0 auto;
}
.amount-row {
  display: flex;
  align-items: center;
}

/* ── Step actions ── */
.step-actions-row {
  display: flex;
  align-items: center;
}

/* ── HW / PRF notice ── */
.hw-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px;
}

/* ── Misc ── */
.flex-grow-1 { flex: 1; }

/* ─── Public-tx / DUST notes — same tokens and structure as
   MidnightSendDialog.vue so the disclosure reads identically. ─── */
.midnight-info-note {
  @include g-glass-tier(false);
  display: flex;
  align-items: flex-start;
  gap: 2px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--g-text-2);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  padding: 8px 10px;
}

/* Chrome number input spinners off */
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type='number'] {
  -moz-appearance: textfield;
}

.sponsor-unlock {
  margin-top: 8px;
}

.sponsor-unlock__warn {
  margin-top: 4px;
  font-size: 11px;
  color: var(--g-warning);
}

.sponsor-unlock__passkey {
  display: flex;
  align-items: flex-start;
  padding: 8px;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  font-size: 11px;
  line-height: 1.45;
  color: var(--g-text-2);
}

.sponsor-unlock__note {
  margin-top: 4px;
  font-size: 11px;
  color: var(--g-text-3);
}

.success-sponsor {
  @include g-glass-tier(false);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 3px 10px;
  border-radius: var(--g-r-pill);
  border: 1px solid var(--g-hairline-2);
  font-size: 11px;
  color: var(--g-text-2);
}

.success-sponsor__av {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-1);
  font-size: 8px;
  font-weight: 600;
}

.mini-tl__who {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 11px;
  color: var(--g-text-2);
}

.mini-tl__cancelled {
  color: var(--g-text-2);
}

.mini-tl__keep {
  margin-top: 4px;
  font-size: 11px;
  color: var(--g-text-3);
}
/* The still-busy prompt under the timeline. */
.mini-tl__busy-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
  justify-content: flex-end;
}
</style>
