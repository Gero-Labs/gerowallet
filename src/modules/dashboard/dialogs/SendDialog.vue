<template>
  <!-- Vue 2 requires a single root in template; the wrapping <div> is harmless
       because both branches mount Vuetify v-dialogs that portal themselves to
       document.body. Midnight wallets get a self-contained MidnightSendDialog
       that reuses TransactionAuthSection (the chain-agnostic password / PRF /
       submit UI), so no auth state machine is duplicated per chain. -->
  <div class="send-dialog-root">
  <MidnightSendDialog v-if="isMidnight" :is-open="isOpen" @close="resetState(); emit('close')" />
  <BaseDialog
    v-else
    :isOpen="isOpen"
    @close="resetState(); emit('close')"
    :title="t('wallet.quickSend')"
    :loading="txSignLoading"
    :min-height="0"
    :subtitle="t('wallet.quickSendSubtitle', { currency: nativeTicker })"
    :persistent="false"
    :img="assets.sendSvg"
    :width="428"
    img-color="var(--g-accent)"
  >
    <!-- A sweep's payment is out: what went where, instead of closing like a single send.
         Before the empty-wallet state, since a Max may well have emptied the wallet. -->
    <template v-if="sweepDone">
      <v-card-text class="send-dialog-content pa-0">
        <SweepDone v-bind="sweepDone" @done="resetState(); emit('close')" />
      </v-card-text>
    </template>

    <!-- Empty wallet state -->
    <template v-else-if="isWalletEmpty">
      <v-card-text class="px-3 pb-0 justify-center text-center send-dialog-content send-dialog-content--empty">
        <div class="empty-wallet-state">
          <v-icon size="64" color="var(--g-text-3)" class="mb-4">mdi-wallet-outline</v-icon>
          <div class="empty-wallet-title text-h6 mb-2">
            {{ $t('wallet.emptyWalletSendTitle') }}
          </div>
          <div class="empty-wallet-description text-body-2 mb-6">
            {{ $t('wallet.emptyWalletSendDescription', { currency: nativeTicker }) }}
          </div>
          <v-btn
            variant="outlined"
            color="var(--g-accent)"
            @click="openReceiveDialog"
          >
            <v-icon size="small" class="mr-1">mdi-qrcode</v-icon>
            {{ $t('wallet.emptyWalletReceive', { currency: nativeTicker }) }}
          </v-btn>
        </div>
      </v-card-text>
    </template>

    <!-- Normal send flow -->
    <template v-else>
      <!-- Stepper indicator -->
      <v-card-title style="display: block;" class="pa-0">
        <v-stepper v-model="currentStep" flat class="stepper-container" non-linear alt-labels>
          <v-stepper-header>
            <template :key="item.name" v-for="(item, index) in steps">
              <div
                class="custom-step"

                :class="{ active: currentStep === index + 1, done: currentStep > index + 1, next: currentStep < index + 1 }"
              >
                <div class="icon-container">
                  <v-icon
                    class="step-icon"
                    :color="currentStep < index + 1 ? 'var(--g-accent)' : 'var(--g-canvas)'"
                    size="16"
                  >{{ currentStep > index + 1 ? 'mdi-check' : 'mdi-circle-medium' }}
                  </v-icon>
                </div>
                <span class="step-label">{{ item.label }}</span>
              </div>
              <div class="divider" :class="{ 'active-divider': currentStep > index + 1 }"
                   v-if="index < steps.length - 1"></div>
            </template>
          </v-stepper-header>
        </v-stepper>
      </v-card-title>

      <!-- Content area -->
      <v-card-text class="send-dialog-content pa-0">
        <CustomStepper :currentStep="currentStep" :steps="steps">
          <!-- Step 1: Recipients -->
          <v-stepper-window-item :value="1">
            <div class="step-recipients-wrapper">
              <div class="step-recipients-inner">
                <!-- An unstake started from the entire-wallet prompt is out: its deposit and
                     rewards reach the wallet only once it confirms. -->
                <v-alert
                  v-if="unstakeSubmitted"
                  type="info"
                  variant="tonal"
                  density="compact"
                  class="mb-3 text-left"
                  data-testid="entire-wallet-unstake-submitted"
                >
                  {{ $t('send.entireWalletUnstake.submitted') }}
                </v-alert>
                <SendRecipientCard
                  v-for="(recipient, idx) in recipients"
                  :key="recipient.id"
                  :recipient="recipient"
                  :index="idx"
                  :is-expanded="expandedRecipientId === recipient.id"
                  :can-delete="recipients.length > 1"
                  :show-header="true"
                  :available-tokens="availableTokensFor(recipient.id)"
                  :excluded-collectible-fingerprints="excludedFingerprintsFor(recipient.id)"
                  :duplicate-of-index="getDuplicateOfIndex(recipient.id, recipient.address)"
                  @expand="expandRecipient(recipient.id)"
                  @update:recipient="updateRecipient(recipient.id, $event)"
                  @duplicate="duplicateRecipient(recipient.id)"
                  @remove="removeRecipient(recipient.id)"
                  @setMax="setMax(recipient.id, $event.tokenIndex)"
                  @sendEntireWallet="requestSendEntireWallet(recipient.id)"
                />

                <!-- Add another recipient link -->
                <div v-if="showAddLink" class="add-recipient-link">
                  <v-btn variant="text" size="x-small" color="var(--g-accent)" @click="addRecipient()">
                    <v-icon size="x-small" class="mr-1">mdi-plus</v-icon>
                    {{ $t('wallet.addAnotherRecipient') }}
                  </v-btn>
                </div>

                <!-- Max over the request limit: the merges being built, then the plan; or,
                     when this wallet cannot sweep, what Max sends and what stays behind. In a
                     drawer beside the dialog, so the recipients never scroll for it. -->
                <DialogDrawer :open="currentStep === 1 && !!(sweepPreparing || sweep || maxLimit)" :label="t('send.sweepHowItGoesOut')">
                  <SweepPlanCard
                    v-if="sweepPreparing || sweep"
                    :utxo-count="sweepPreparing?.utxoCount ?? sweep?.utxoCount ?? 0"
                    :merges="sweepPreparing?.total ?? sweep?.merges.length ?? 0"
                    :preparing="sweepPreparing ? { built: sweepPreparing.built, total: sweepPreparing.total, waiting: sweepPreparing.waiting } : null"
                  />
                  <MaxLimitNote v-else-if="maxLimit" v-bind="maxLimit" />
                </DialogDrawer>

                <!-- Global total: always in the layout so the dialog keeps its height. Empty
                     (dashes) until there is something to build, a shimmer while the fee is
                     being computed, the figures once the transaction is built. -->
                <div class="global-total" :aria-busy="feePending ? 'true' : 'false'">
                  <div class="global-total__row global-total__fee-row">
                    <span class="global-total__fee-label">{{ $t('signTx.networkFee') }}</span>
                    <span v-if="feePending" class="g-skeleton global-total__skeleton global-total__skeleton--fee" aria-hidden="true"></span>
                    <span v-else-if="globalTotal.formattedFee && txValid" class="global-total__fee">- {{ globalTotal.formattedFee }}</span>
                    <span v-else class="global-total__fee-label g-num">—</span>
                  </div>
                  <!-- A sweep's fee split. It keeps its row while that fee is worked out, as a
                       shimmer on a caption line, so the box does not grow when the figures land. -->
                  <div v-if="(sweepPreparing || sweep) && (feePending || sweepFeeBreakdownText)" class="global-total__row global-total__breakdown">
                    <span class="t-caption g-num">
                      <span v-if="feePending" class="g-skeleton global-total__skeleton global-total__skeleton--breakdown" aria-hidden="true"></span>
                      <template v-else>{{ sweepFeeBreakdownText }}</template>
                    </span>
                  </div>
                  <div v-if="globalTotal.formattedWithdrawal && !feePending" class="global-total__row global-total__fee-row">
                    <span class="global-total__fee-label">{{ $t('wallet.rewardsWithdrawn') }}</span>
                    <span class="global-total__withdrawal">+ {{ globalTotal.formattedWithdrawal }}</span>
                  </div>
                  <div class="global-total__row global-total__total-row">
                    <span class="global-total__label">{{ $t('common.total') }}</span>
                    <span v-if="feePending" class="g-skeleton global-total__skeleton global-total__skeleton--total" aria-hidden="true"></span>
                    <div v-else-if="globalTotal.ada > 0 || globalTotal.usd > 0">
                      <span class="global-total__ada">{{ globalTotal.formattedTotal }}</span>
                      <span class="global-total__fiat">{{ '≈' }} {{ hideBalances ? '$•••' : globalTotal.formattedUsd }}</span>
                    </div>
                    <span v-else class="global-total__ada g-num">—</span>
                  </div>
                  <div v-if="buildError" class="global-total__row global-total__error" role="alert">{{ buildError }}</div>
                </div>
              </div>
            </div>
          </v-stepper-window-item>

          <!-- Step 2: Summary -->
          <v-stepper-window-item :value="2">
            <SummaryStep
              ref="summaryRef"
              :recipients="recipients"
              :tx-data="tx"
              :active="isOpen && currentStep === 2"
              :additional-fee-lovelace="sweepFeeLovelace"
              :steps="sweepSteps"
              :utxo-count="sweep?.utxoCount ?? 0"
              @next="handleSign"
              @prev="prevStep"
            />
          </v-stepper-window-item>
        </CustomStepper>

        <!-- Keystone Sign Dialog -->
        <KeystoneSignDialog
          :isOpen="overlay && loggedWallet?.type === WalletType.Keystone"
          :keystoneType="keystoneType"
          :keystoneCbor="keystoneCbor"
          @close="resetState()"
          @scan="onKeystoneScan"
          @error="onKeystoneError"
          @progress="onKeystoneProgress"
        />
      </v-card-text>

      <!-- Actions -->
      <v-card-actions class="send-dialog-actions" :style="loggedWallet?.btSupported ? { display: 'block', height: '96px', alignContent: 'end'} : { flexFlow: 'column'}">
        <!-- A sweep in flight, or where it stopped. The auth section below stays mounted
             (its field holds the password for a retry) but out of sight while it runs. -->
        <SweepProgressPanel v-if="currentStep === 2 && (sweepProgress || sweepStop)" :progress="sweepProgress" :stop="sweepStop" />
        <!-- Under a "require remote" policy, local signing (password AND passkey)
             is disabled; only "Sign on another device" remains. -->
        <div v-if="currentStep === 2 && requiresRemoteForSend" class="text-caption grey--text text-center mb-2">
          {{ $t('crossDevice.settings.policyRequireHint') }}
        </div>
        <!-- Transaction Authentication Section (step 2 only) -->
        <div v-else-if="currentStep === 2" v-show="!sweepProgress" class="send-dialog__auth">
          <TransactionAuthSection
            :wallet-type="loggedWallet?.type"
            :is-prf-wallet="isPrfWallet"
            :is-signed="isSubmit"
            :loading="txSignLoading || !summaryReady"
            :password="spendingPassword"
            @update:password="spendingPassword = $event"
            :password-label="t('wallet.spendingPassword')"
            :password-rules="passwordRules"
            :submit-text="t('common.confirm')"
            :passkey-text="sweepStop ? t('common.tryAgain') : undefined"
            :show-bt-toggle="isBTSupported"
            :is-b-t="isBT"
            @update:isBT="isBT = $event"
            :usb-text="t('dashboard.usb')"
            :bluetooth-text="t('dashboard.bluetooth')"
            @passkey-success="handlePassKeyAuthSuccess"
            @passkey-error="handlePassKeyAuthError"
            @autofill-success="handlePassKeySuccess"
            @autofill-error="handlePassKeyError"
            @submit="nextStep"
            @password-field-ref="setPasswordFieldRef"
            button-style="width: 295px; margin-bottom: 1px;"
            button-class="mb-2"
          />
        </div>
        <div>
          <v-btn
            variant="text"
            @click="prevStep"
            v-if="currentStep > 1"
            class="mr-2"
            :disabled="txSignLoading"
          >
            <v-icon size="small" class="mr-1">mdi-arrow-left</v-icon>{{ $t('common.back') }}
          </v-btn>
          <!-- Step 1: Continue button -->
          <v-btn
            v-if="currentStep !== 2"
            class="continue-button"
            @click="nextStep()"
            :disabled="!isValid || txSignLoading"
            :loading="txSignLoading"
          >{{ $t('common.continue') + ' ' }}
            <v-icon style="color: var(--g-canvas)!important;" size="small" class="ml-1">mdi-arrow-right</v-icon>
          </v-btn>
          <!-- Step 2: Sign/Confirm button for non-PRF wallets. Local signing is
               disabled while a "require remote" policy is active (unless already
               at the submit step with a remote witness in hand). -->
          <v-btn
            v-else-if="!isPrfWallet"
            class="continue-button"
            @click="nextStep"
            :disabled="!isValid || txSignLoading || (requiresRemoteForSend && !isSubmit)"
            :loading="txSignLoading"
          >{{ isSubmit ? $t('common.confirm') : sweepStop ? $t('common.tryAgain') : $t('wallet.sign') }}
          </v-btn>
          <!-- Step 2: Sign on another device (flag-gated, dark by default) -->
          <v-btn
            v-if="currentStep === 2 && canSignOnAnotherDevice && !sweep"
            variant="text"
            class="ml-2"
            @click="signOnAnotherDevice()"
            :disabled="txSignLoading || !summaryReady"
            :loading="txSignLoading"
          >
            <v-icon size="small" class="mr-1">mdi-cellphone-link</v-icon>
            {{ $t('crossDevice.signOnAnotherDevice') }}
          </v-btn>
        </div>
      </v-card-actions>
    </template>
  </BaseDialog>
  <EntireWalletUnstakePrompt
    v-if="!isMidnight"
    :is-open="!!entireWalletPrompt"
    :deposit-lovelace="stakeDepositLovelace"
    :rewards-left-lovelace="entireWalletRewards.left"
    :rewards-included-lovelace="entireWalletRewards.included"
    @unstake="unstakeBeforeEntireWallet()"
    @continue="continueEntireWallet()"
    @close="cancelEntireWallet()"
  />
  <UnstakeDialog
    v-if="!isMidnight"
    :is-open="unstakeDialog"
    :tx="unstakeTxData ?? undefined"
    @submitted="unstakeSubmitted = true"
    @close="closeUnstakeDialog"
  />
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, toRefs, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useTransactionSigning, type SweepProgress, type SweepStop } from '@/shared/composables/useTransactionSigning';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import CustomStepper from '@/shared/components/CustomStepper.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import SummaryStep from '../components/SummaryStep.vue';
import SendRecipientCard from '../components/SendRecipientCard.vue';
import SweepPlanCard from '../components/sweep/SweepPlanCard.vue';
import DialogDrawer from '@/shared/dialogs/DialogDrawer.vue';
import MaxLimitNote from '../components/sweep/MaxLimitNote.vue';
import SweepProgressPanel from '../components/sweep/SweepProgressPanel.vue';
import SweepDone from '../components/sweep/SweepDone.vue';
import { maxLimitFigures, sweepDoneSummary, sweepFeeBreakdown, type SweepDoneSummary } from '../components/sweep/sweepDialogState';
import MidnightSendDialog from './MidnightSendDialog.vue';
import EntireWalletUnstakePrompt from '../components/EntireWalletUnstakePrompt.vue';
import UnstakeDialog from '@/modules/staking/dialogs/UnstakeDialog.vue';
import { useUnstake } from '@/shared/composables/useUnstake';
import { isStakeKeyRegistered } from '@/shared/utils/stakeRegistration';
import rules from '@/utils/rules';
import { Blockchain, WalletType } from '@/models/types';
import { Collectible, SendRecipient, Token } from '@/models/send-flow.types';
import networks from '@/utils/networks';
import filters from '@/shared/utils/filters';
import { baseUnitsToDecimalString, decimalToBaseUnits } from '@/shared/utils/amount';
import { confirmTokenDecimals } from '@/shared/utils/verifiedDecimals';
import { isPaymentAddress } from '@/chrome/serialization';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { priceStore } from '@/stores/priceStore';
import { clearWithdrawableAmount, currentRewardWithdrawals } from '@/shared/utils/autoWithdraw';
import debounce from 'lodash/debounce';
import {
  type BuildTxRequest,
  cardanoUtxoToNexusInput,
  InputLimitError,
  type InputSelection,
  type MaxAdaRequest,
  type NexusCallOptions,
  nexusTxApi,
  type NexusTxAsset,
  type NexusTxInput,
  selectInputCandidates,
} from '@/api/nexus-tx-api';
import { shortOnlyByLimit, type SweepPrerequisites } from '@/api/sweepPlan';
import { buildSweep, type BuiltSweep, type SweepBuildContext } from '@/api/sweepBuild';
import { combineSweeps, createSweepCache } from '@/api/sweepCache';
import { refOf } from '@/api/nexusInputSelection';
import { friendlyTxError, shortfallLovelaceFromMessage } from '@/shared/utils/txErrors';
import { withoutPendingSpends } from '@/shared/utils/pendingSpends';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { BrowserTxConstruction } from '@/chrome/cardanoJsSdkCbor';
import assets from '@/utils/assets';
import { debugLog } from '@/utils/debug';
import { useQuickActionDialogs } from '@/shared/composables/useQuickActionDialogs';
import { loadingState } from '@/stores/loading';

const props = defineProps({
  isOpen: { type: Boolean, required: true },
});
const emit = defineEmits(['close']);

const { t, tc } = useTranslation();

const { loggedWallet, utxos, tokens: resolvedAssets, keys, collections: resolvedCollections } = toRefs(walletStore)
const { epochParams } = toRefs(networkStore)

const nativeTicker = computed(() => networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network));

// Honor the top-bar Hide Balances privacy toggle. The ADA total is transaction
// state the user just chose, so it stays readable — but its fiat conversion is
// masked everywhere else in the app (see TransactionsCard), so mask it here too.
const hideBalances = computed(() => walletStore.config?.hideBalances || false);

// Midnight wallets render `MidnightSendDialog` instead of the Cardano stepper
// (see template's v-if at the top of the file). That dialog owns its own
// form + auth flow via the shared `TransactionAuthSection` component, so
// nothing Midnight-specific lives in this file anymore.
const isMidnight = computed(() => loggedWallet.value?.chain === Blockchain.MIDNIGHT);

const { openReceiveDialog: switchToReceive } = useQuickActionDialogs();

async function openReceiveDialog() {
  // Close send dialog first so receive dialog opens into a clean state without overlap
  emit('close');
  await nextTick();
  switchToReceive();
}

const currentStep = ref<number>(1);
const expandedRecipientId = ref<string | null>(null);
const txValid = ref<boolean>(false);
const isCalculatingMax = ref<boolean>(false);
/** A build is scheduled or in flight: the summary shows a shimmer instead of stale or missing figures. */
const isBuilding = ref<boolean>(false);
const feePending = computed(() => isBuilding.value || isCalculatingMax.value);

/** Something to build at all: an amount on a token, or a collectible, on any recipient. */
function hasAnyAmount(): boolean {
  return recipients.value.some((r: SendRecipient) =>
    r.selectedTokens.some((t: Token) => Number(t.quantity) > 0) ||
    Object.keys(r.selectedCollectibles).length > 0
  );
}
const maxRecipientIds = ref<Set<string>>(new Set());

/** The last candidate selection sent to Nexus: tells the error copy whether a shortfall is real or the wallet is too fragmented. */
const inputSelection = ref<InputSelection | null>(null);
/** A build failure the user has to act on, shown under the total. Null while nothing is wrong or a build is in flight. */
const buildError = ref<string | null>(null);
/**
 * A sweep: when Max, or a typed amount, needs more UTxOs than one Nexus request carries,
 * the merges (self-transfers) that bring them under the limit, and the UTxO set they came from.
 */
const sweep = shallowRef<(BuiltSweep & { key: string; builtAt: number }) | null>(null);
/**
 * The ADA, in lovelace over all recipients, that a typed send asked for when the UTxOs
 * one request carries first fell short of it while the whole wallet did not. At or above
 * it the payment goes out as a sweep, as Max does; below it, as one transaction again.
 */
const amountSweepFrom = ref<bigint | null>(null);

/** The ADA every recipient is sent, in lovelace. */
function requestedLovelace(): bigint {
  return recipients.value.reduce((sum: bigint, r: SendRecipient) => {
    const ada = r.selectedTokens.find((tk: Token) => tk.ticker === nativeTicker.value);
    return sum + decimalToBaseUnits(ada?.quantity, ada?.decimals ?? 6);
  }, BigInt(0));
}
const sweepPrerequisites = computed<SweepPrerequisites | null>(() =>
  sweep.value ? { cbors: sweep.value.mergeCbors, outputs: sweep.value.mergeOutputs } : null);
/** The merges' fees, which the user pays on top of the payment's. */
const sweepFeeLovelace = computed(() => Number(sweep.value?.mergeFee ?? BigInt(0)));
/** Transactions the send goes out as. */
const sweepSteps = computed(() => (sweep.value ? sweep.value.merges.length + 1 : 1));
const sweepProgress = ref<SweepProgress | null>(null);
/**
 * The merges being built: how many are done, how many the plan has, the UTxOs it spends,
 * and whether a build is waiting out the server's request limit. Null when none is building.
 */
const sweepPreparing = ref<{ built: number; total: number; utxoCount: number; waiting: boolean } | null>(null);
/** Where the last sweep stopped, until the next attempt starts or the dialog resets. */
const sweepStop = ref<SweepStop | null>(null);
/** A sweep whose payment went out: the dialog shows this instead of closing. */
const sweepDone = ref<SweepDoneSummary | null>(null);
/**
 * The merge build in flight: the UTxO set it was planned for, the UTxOs its merges spend (it
 * still serves a later set that holds all of them, so a second caller awaits it instead of
 * building merges of its own, whose ids would differ), and when its oldest merge was built.
 * Its controller stops the build, and any rate-limit wait it is in, when the dialog resets or
 * its merges stop applying. `superseded` marks the second case: its callers go on with the
 * sweep that replaced it instead of giving up.
 */
interface SweepBuildSlot { key: string; promise: Promise<BuiltSweep>; abort: AbortController; spends: Set<string>; builtAt: number; superseded: boolean }
let sweepBuild: SweepBuildSlot | null = null;
/**
 * The last sweep built, kept for the life of the dialog (not its reset): pressing Max again,
 * typing an amount or a payment arriving reuses its merges instead of rebuilding them, each
 * build counting against the server's request limit.
 */
const sweepCache = createSweepCache();
const sweepWalletKey = () => `${loggedWallet.value?.id ?? ''}:${loggedWallet.value?.network ?? ''}`;
const spentByMerges = (merges: Cardano.Tx[]) => merges.flatMap((tx) => tx.body.inputs.map((input) => `${input.txId}#${input.index}`));
/**
 * Merges built longer ago than this are rebuilt the next time Max or a rebuild runs
 * (nothing rebuilds on a timer). Nexus gives them two hours to land; the node refuses
 * one signed after that, which the sweep reports as interrupted, and pressing Max
 * again rebuilds them.
 */
const SWEEP_REBUILD_AFTER_MS = 60 * 60 * 1000;
/** Max without a sweep only reaches the candidates one request may carry: what it sends and what stays behind. */
const maxLimit = computed(() => maxLimitFigures(inputSelection.value, recipients.value, maxRecipientIds.value, nativeTicker.value));

/** Under the fee row: how a sweep's fee splits between the merges and the payment. */
const sweepFeeBreakdownText = computed(() => {
  const split = sweepFeeBreakdown(sweep.value, txValid.value ? tx.value?.body?.fee : undefined);
  return split ? tc('send.sweepFeeBreakdown', split.merges, { ...split }) : null;
});

function createEmptyRecipient(): SendRecipient {
  const nativeAsset = tokens.value.find((t: Token & { balance?: string | number; name?: string; img?: string; ticker: string }) => t.ticker === nativeTicker.value);
  const adaToken = nativeAsset ? { ...nativeAsset, quantity: '0', verified: true } : null;
  return {
    id: crypto.randomUUID(),
    address: '',
    resolvedAddress: null,
    selectedTokens: adaToken ? [adaToken] : [],
    selectedCollectibles: {},
    minAda: 0,
    adaShortage: 0,
  };
}

const recipients = ref<SendRecipient[]>([]);

const steps = ref([
  { name: 'recipients', label: t('wallet.recipients') },
  { name: 'summary', label: t('wallet.summary') },
]);

const tx = ref<Cardano.Tx | undefined>(undefined);
const summaryRef = ref<InstanceType<typeof SummaryStep>>();

function isSummaryReady(): boolean {
  return props.isOpen && currentStep.value === 2 && txValid.value &&
    !feePending.value && !walletStore.isLocked &&
    !!summaryRef.value?.isReadyFor(tx.value);
}
const summaryReady = computed(isSummaryReady);

// Transaction signing composable (handles sign, submit, password, hardware wallets, Keystone)
const {
  loading: txSignLoading,
  spendingPassword,
  isSubmit,
  isBT,
  isPrfWallet,
  isBTSupported,
  canSignOnAnotherDevice,
  requiresRemoteForSend,
  passwordRules,
  handleSign,
  signOnAnotherDevice,
  resetState,
  handlePassKeySuccess,
  handlePassKeyError,
  handlePassKeyAuthSuccess,
  handlePassKeyAuthError,
  setPasswordFieldRef,
  overlay,
  keystoneType,
  keystoneCbor,
  onKeystoneScan,
  onKeystoneError,
  onKeystoneProgress,
} = useTransactionSigning({
  active: isSummaryReady,
  tx,
  prerequisites: sweepPrerequisites,
  onProgress: (progress) => {
    sweepProgress.value = progress;
    // A new attempt: the stop it is retrying no longer applies.
    if (progress) sweepStop.value = null;
  },
  onInterrupted: (stop) => { sweepStop.value = stop; },
  // The signer asks this right after onSuccess: the dialog stays open exactly when it
  // has a done panel to show, so the two can never disagree.
  closeOnSuccess: () => !sweepDone.value,
  successMessageKey: 'wallet.txSubmittedSuccess',
  onSuccess: (txId) => {
    // Read off the sweep and payment now: the dialog's state resets behind this.
    if (sweep.value && tx.value) sweepDone.value = sweepDoneSummary(txId, tx.value, sweep.value, ownAddresses());
    // If this send swept rewards (auto-withdraw), zero the local balance so a
    // second send before the next account sync doesn't re-attach the
    // already-claimed withdrawal (issue 941)
    if (tx.value?.body?.withdrawals?.length) clearWithdrawableAmount();
  },
  onClose: () => emit('close'),
});

/** The wallet's own payment and change addresses: a payment output there is change, not a recipient. */
function ownAddresses(): string[] {
  return [...(keys.value?.payment ?? []), ...(keys.value?.change ?? [])]
    .map((key: { address?: string }) => key.address)
    .filter((address): address is string => !!address);
}

// Leaving the summary (Back, or a rebuilt payment) resets the signer, which forgets the
// merges it already sent: a stop still on screen would promise to skip them.
watch([tx, currentStep], () => { sweepStop.value = null; });

/** A sweep is signed under one approval: only signers that give one (password, PassKey, Google), never under a remote-only policy. */
const canSweep = computed(() =>
  (loggedWallet.value?.type === WalletType.Normal || loggedWallet.value?.type === WalletType.Google) &&
  !requiresRemoteForSend.value);

const tokens = computed(() => {
  if (resolvedAssets.value) {
    const tokenList = (Object.values(resolvedAssets.value) as (Token & { metadata?: { name: string; ticker: string; decimals: number } | null; name?: string; img: string })[]).map(token => {
      // metadata is null for fungible tokens without registered off-chain
      // registry metadata (common for new/community tokens). Fall back to the
      // resolver's top-level name and 0 decimals rather than dereferencing null.
      return {
        ...token,
        name: token.metadata?.name ?? token.name,
        ticker: token.metadata?.ticker ?? token.name,
        img: token.img,
        quantity: "0",
        balance: token.quantity,
        decimals: token.metadata?.decimals ?? 0,
        unit: token.unit,
        verified: token.verified
      }
    })
    tokenList.sort((a, _b) => {
      if (a.ticker === nativeTicker.value) {
        return -1
      }
      return 0;
    })
    return tokenList
  }
  return []
})

// walletStore.collections is typed as {}, but at runtime each key is a policy ID
// with value { items: Array, name: string, ... }
const hasCollectibles = computed(() => Object.keys(resolvedCollections.value).length > 0);

const isWalletEmpty = computed(() => {
  // Don't show empty state until wallet is fully initialised and data has loaded
  if (!loggedWallet.value) return false;
  if (loadingState.loading || loadingState.isSyncing || loadingState.loadingTxs) return false;
  return tokens.value.length === 0 && !hasCollectibles.value;
});

const isValid = computed(() => {
  if (currentStep.value === 1) {
    if (!txValid.value || !tx.value || feePending.value) return false;
    return recipients.value.every((r: SendRecipient) => {
      const addr = r.resolvedAddress ?? r.address;
      const rule = rules.recipientRules(loggedWallet.value?.chain, loggedWallet.value?.network);
      if (rule(addr) !== true) return false;
      const hasAsset = r.selectedTokens.some((tk: Token) => Number(tk.quantity) > 0) ||
        Object.keys(r.selectedCollectibles).length > 0;
      if (!hasAsset) return false;
      return r.adaShortage <= 0;

    });
  }
  if (currentStep.value === 2) {
    if (!isSummaryReady()) return false;
    if (isSubmit.value) return true; // Already signed, just need confirm click
    if (loggedWallet.value?.type === WalletType.Normal) {
      if (isPrfWallet.value) return true; // PRF handled by TransactionAuthSection
      return !!spendingPassword.value;
    }
    return true; // Hardware wallets always valid
  }
  return false;
});

const resetData = () => {
  resetState();
  currentStep.value = 1;
  tx.value = undefined;
  txValid.value = false;
  buildError.value = null;
  inputSelection.value = null;
  sweep.value = null;
  // Merges still being built are for a dialog that is gone: stop them, waits included.
  sweepBuild?.abort.abort();
  sweepBuild = null;
  sweepProgress.value = null;
  sweepPreparing.value = null;
  sweepStop.value = null;
  sweepDone.value = null;
  maxRecipientIds.value = new Set();
  amountSweepFrom.value = null;
  entireWalletPrompt.value = null;
  entireWalletUnstakeDeclined.value = false;
  unstakeSubmitted.value = false;
  recipients.value = [createEmptyRecipient()];
  expandedRecipientId.value = recipients.value[0].id;
};

function availableTokensFor(recipientId: string) {
  const others = recipients.value.filter((r: SendRecipient) => r.id !== recipientId);
  return tokens.value.map((token: Token & { balance?: string | number; name?: string; img?: string; decimals: number }) => {
    // BigInt-safe: float multiply can drop a smallest unit (issue 933) and Number
    // loses integer precision above 2^53
    const committed = others.reduce((sum: bigint, r: SendRecipient) => {
      const t2 = r.selectedTokens.find((tk: Token) => tk.unit === token.unit);
      if (!t2) return sum;
      return sum + decimalToBaseUnits(t2.quantity, token.decimals ?? 6);
    }, BigInt(0));
    const rawBalance = decimalToBaseUnits(token.balance ?? 0, 0);
    const newBalance = rawBalance - committed;
    // Keep the exact bigint as a string — Number() would round above 2^53 and
    // setMax re-parses this via decimalToBaseUnits, so precision must survive
    return { ...token, balance: newBalance < BigInt(0) ? '0' : newBalance.toString() };
  });
}

/**
 * Base units of every non-ADA asset already committed to recipients OTHER than
 * `recipientId`. Mirrors recipientToNexusOutput's per-recipient dedupe — a unit
 * present in selectedTokens wins and the matching collectible is skipped — so
 * these totals match what actually goes on the wire.
 *
 * Collectible quantities are already base units (they come straight off the
 * UTxO scan / picker), unlike token quantities which are human decimals.
 */
function committedBaseUnitsExcluding(recipientId: string): Map<string, bigint> {
  const committed = new Map<string, bigint>();
  const add = (unit: string, qty: bigint) => {
    if (!unit || qty <= BigInt(0)) return;
    committed.set(unit, (committed.get(unit) ?? BigInt(0)) + qty);
  };

  recipients.value
    .filter((r: SendRecipient) => r.id !== recipientId)
    .forEach((r: SendRecipient) => {
      const seen = new Set<string>();
      r.selectedTokens.forEach((token: Token) => {
        if (!token?.unit || token.ticker === nativeTicker.value) return;
        add(token.unit, decimalToBaseUnits(token.quantity, token.decimals != null ? token.decimals : 0));
        seen.add(token.unit);
      });
      Object.values(r.selectedCollectibles).forEach((col: Collectible & { unit?: string }) => {
        const unit = col.unit || ((col.policy_id || '') + (col.asset_name || ''));
        if (!unit || seen.has(unit)) return;
        add(unit, decimalToBaseUnits(col.toSendQuantity ?? col.quantity ?? 1, 0));
        seen.add(unit);
      });
    });

  return committed;
}

function excludedFingerprintsFor(recipientId: string): Set<string> {
  const others = recipients.value.filter((r: SendRecipient) => r.id !== recipientId);
  const fingerprints = new Set<string>();
  others.forEach((r: SendRecipient) => {
    Object.values(r.selectedCollectibles).forEach((col: Collectible & { unit: string }) => {
      if (col.fingerprint) fingerprints.add(col.fingerprint);
      // Send-entire-wallet reconstructs collectibles with fingerprint: '' —
      // also exclude by unit so those still vanish from other pickers (issue 938)
      const unit = col.unit || ((col.policy_id || '') + (col.asset_name || ''));
      if (unit) fingerprints.add(unit);
    });
  });
  return fingerprints;
}

function updateRecipient(id: string, updated: SendRecipient) {
  const idx = recipients.value.findIndex((r: SendRecipient) => r.id === id);
  if (idx !== -1) {
    // If ADA amount was manually changed, remove from MAX tracking
    const old = recipients.value[idx];
    const oldAda = old.selectedTokens.find((tk: Token) => tk.ticker === nativeTicker.value);
    const newAda = updated.selectedTokens.find((tk: Token) => tk.ticker === nativeTicker.value);
    if (oldAda && newAda && oldAda.quantity !== newAda.quantity && maxRecipientIds.value.has(id)) {
      maxRecipientIds.value.delete(id);
    }
    recipients.value.splice(idx, 1, updated);
  }
}

async function addRecipient() {
  const r = createEmptyRecipient();
  recipients.value.push(r);
  await nextTick();
  expandedRecipientId.value = r.id;
}

async function duplicateRecipient(id: string) {
  const src = recipients.value.find((r: SendRecipient) => r.id === id);
  if (!src) return;
  const duped: SendRecipient = {
    ...JSON.parse(JSON.stringify(src)),
    id: crypto.randomUUID(),
    resolvedAddress: src.resolvedAddress,
  };
  const idx = recipients.value.findIndex((r: SendRecipient) => r.id === id);
  recipients.value.splice(idx + 1, 0, duped);
  await nextTick();
  expandedRecipientId.value = duped.id;
}

async function removeRecipient(id: string) {
  if (recipients.value.length <= 1) return;
  const targetId = recipients.value[Math.max(0, recipients.value.findIndex((r: SendRecipient) => r.id === id) - 1)]?.id ?? null;
  const idx = recipients.value.findIndex((r: SendRecipient) => r.id === id);
  recipients.value.splice(idx, 1);
  await nextTick();
  expandedRecipientId.value = targetId;
}

function expandRecipient(id: string) {
  expandedRecipientId.value = id;
}

function getDuplicateOfIndex(recipientId: string, address: string): number | undefined {
  if (!address) return undefined;
  const current = recipients.value.find((r: SendRecipient) => r.id === recipientId);
  const checkAddr = current?.resolvedAddress || address;
  if (!checkAddr) return undefined;
  const idx = recipients.value.findIndex((r: SendRecipient) =>
    r.id !== recipientId && ((r.resolvedAddress || r.address) === checkAddr)
  );
  return idx >= 0 ? idx : undefined;
}

const showAddLink = computed(() => {
  return recipients.value.length > 0;
});

/** Aggregate total across all recipients for the global total line. */
const globalTotal = computed(() => {
  let totalAda = 0;
  let totalUsd: number;

  recipients.value.forEach((r: SendRecipient) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.selectedTokens.forEach((token: any) => {
      const qty = parseFloat(String(token.quantity || '0').replace(/,/g, ''));
      if (!qty || isNaN(qty)) return;
      if (token.ticker === nativeTicker.value) {
        totalAda += qty;
      }
    });
  });

  // Extract fee from built tx, plus a sweep's merge fees: the user pays all of them.
  let feeAda = 0;
  let formattedFee = '';
  if (tx.value?.body?.fee) {
    const feeLovelace = Number(tx.value.body.fee) + sweepFeeLovelace.value;
    feeAda = feeLovelace / 1_000_000;
    formattedFee = filters.toCurrency(feeLovelace, false, 6, '₳', '', false, 6);
  }

  // Rewards being auto-withdrawn as part of this tx (if any). They subtract
  // from what the wallet actually pays, since they enter the tx as fresh input
  // coin from the stake account.
  let withdrawalAda = 0;
  let formattedWithdrawal = '';
  if (tx.value?.body?.withdrawals && tx.value.body.withdrawals.length > 0) {
    const wLovelace = tx.value.body.withdrawals.reduce<bigint>(
      (acc: bigint, w: { quantity: bigint }) => acc + BigInt(w.quantity),
      BigInt(0)
    );
    withdrawalAda = Number(wLovelace) / 1_000_000;
    formattedWithdrawal = filters.toCurrency(Number(wLovelace), false, 6, '₳', '', false, 6);
  }

  const totalWithFee = totalAda + feeAda - withdrawalAda;
  const adaPrice = Number(priceStore.adaUsd?.lastPrice || 0);
  totalUsd = totalWithFee * adaPrice;

  return {
    ada: totalAda,
    fee: feeAda,
    withdrawal: withdrawalAda,
    totalWithFee,
    usd: totalUsd,
    formattedAda: totalAda > 0
      ? filters.toCurrency(totalAda * 1e6, false, 6, '₳', '', false, 6)
      : '₳0',
    formattedTotal: totalWithFee > 0
      ? filters.toCurrency(totalWithFee * 1e6, false, 6, '₳', '', false, 6)
      : '₳0',
    formattedFee,
    formattedWithdrawal,
    formattedUsd: totalUsd > 0
      ? `$${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '$0.00',
  };
});

/**
 * Build Nexus output format from a recipient. Optionally override lovelace (for max-ada).
 * `confirmed` (from confirmedRecipientDecimals) holds the decimals gero-backend confirmed
 * per token unit; a transaction that may be signed converts typed token amounts with them.
 */
function recipientToNexusOutput(r: SendRecipient, overrideLovelace?: string, confirmed?: ReadonlyMap<string, number>) {
  const address = r.resolvedAddress ?? r.address;
  let lovelace = overrideLovelace ?? '0';
  const assets: NexusTxAsset[] = [];

  // Track units added via the token list so a collectible under the same
  // policy+assetName can't duplicate it in the output.
  const addedUnits = new Set<string>();

  r.selectedTokens
    .filter((tk: Token) => tk && (tk.unit !== undefined && tk.unit !== null))
    .forEach((token: Token) => {
      // Treat missing decimals as 0 — otherwise a no-metadata fungible would
      // be silently dropped from the output and end up in change.
      const confirmedDecimals = token.ticker === nativeTicker.value ? undefined : confirmed?.get(String(token.unit));
      const decimals = confirmedDecimals ?? (token.decimals != null ? token.decimals : 0);
      // String-shift, not float multiply: 0.29 * 100 floors to 28 (issue 933)
      const qty = decimalToBaseUnits(token.quantity, decimals);
      if (token.ticker === nativeTicker.value) {
        if (!overrideLovelace) lovelace = qty.toString();
      } else if (token.unit) {
        assets.push({
          policyId: token.unit.slice(0, 56),
          assetName: token.unit.slice(56),
          quantity: qty.toString(),
        });
        addedUnits.add(token.unit);
      }
    });

  Object.values(r.selectedCollectibles).forEach((col: Collectible & { unit?: string }) => {
    const unit = col.unit || ((col.policy_id || '') + (col.asset_name || ''));
    if (!unit || addedUnits.has(unit)) return;
    assets.push({
      policyId: unit.slice(0, 56),
      assetName: unit.slice(56),
      quantity: String(col.toSendQuantity || col.quantity || 1),
    });
    addedUnits.add(unit);
  });

  return { address, lovelace, assets: assets.length > 0 ? assets : undefined };
}

/**
 * The decimals gero-backend confirms for every token amount typed for a recipient
 * (verifiedDecimals.ts), before any transaction that may be signed is built from them.
 * Throws TokenDecimalsError, so nothing is built, when they differ from the ones the wallet
 * holds or cannot be confirmed.
 */
function confirmedRecipientDecimals(): Promise<Map<string, number>> {
  return confirmTokenDecimals(
    recipients.value.flatMap((r: SendRecipient) => r.selectedTokens
      .filter((tk: Token) => tk?.unit && tk.ticker !== nativeTicker.value && /[1-9]/.test(String(tk.quantity ?? '')))
      .map((tk: Token) => ({ unit: String(tk.unit), decimals: tk.decimals != null ? tk.decimals : 0 }))),
    loggedWallet.value,
  );
}

/** The wallet's UTxOs less those a transaction it already submitted spends (see withoutPendingSpends). */
function spendableUtxos(): Cardano.Utxo[] {
  return withoutPendingSpends(utxos.value as Cardano.Utxo[], walletStore.transactions);
}

/**
 * Candidate inputs for a Nexus request. With a sweep, the payment spends the merges'
 * outputs and everything the merges leave. Otherwise the whole wallet when it fits
 * the request limit, else the holders of everything the recipients send plus the
 * largest lovelace (see selectInputCandidates). Deterministic, so the max-ada and
 * build calls of one attempt see the same candidates.
 */
function nexusInputs(): NexusTxInput[] {
  if (sweep.value) {
    inputSelection.value = null;
    return [...sweep.value.direct, ...sweep.value.mergeOutputs].map(cardanoUtxoToNexusInput);
  }
  const selection = selectInputCandidates(spendableUtxos(), {
    requiredAssets: committedBaseUnitsExcluding(''),
  });
  inputSelection.value = selection;
  return selection.utxos.map(cardanoUtxoToNexusInput);
}

/** The UTxO set as one string: a sweep is rebuilt when it changes. */
function utxoSetKey(list: Cardano.Utxo[]): string {
  return list.map(([txIn]) => `${txIn.txId}#${txIn.index}`).sort().join(',');
}

/**
 * Max, or a typed amount at or above `amountSweepFrom`, on a wallet holding more UTxOs
 * than one Nexus request carries: the merges that bring them under the limit. Merges built
 * before are kept while every UTxO they spend is still spendable (see createSweepCache):
 * pressing Max again, typing an amount, reopening the dialog or a payment arriving costs no
 * rebuild, and arrivals that push the payment past the limit cost one more merge. Merges
 * built more than SWEEP_REBUILD_AFTER_MS ago are rebuilt the next time Max or a rebuild
 * runs, never on a timer: a merge signed after its two-hour window is refused by the node,
 * which the sweep reports as interrupted, and pressing Max again rebuilds it. Clears the
 * sweep when none is needed or this wallet cannot sign one. Resolves false when the attempt
 * was abandoned: the dialog reset while the merges were being built, so the caller has
 * nothing to go on with.
 */
async function ensureSweep(): Promise<boolean> {
  if (!canSweep.value || (maxRecipientIds.value.size === 0 && amountSweepFrom.value === null)) {
    sweep.value = null;
    return true;
  }
  const available = spendableUtxos();
  const key = utxoSetKey(available);
  if (sweep.value?.key === key && Date.now() - sweep.value.builtAt < SWEEP_REBUILD_AFTER_MS) return true;
  const spendable = new Set(available.map(refOf));
  // One build at a time: a build in flight whose merges all still apply serves this UTxO set
  // too, so a concurrent caller waits for it (and picks up what arrived since afterwards)
  // instead of building merges of its own, whose ids would differ.
  if (!sweepBuild || ![...sweepBuild.spends].every((ref) => spendable.has(ref))) {
    // A build whose merges no longer apply is stale whatever this call settles on, a new build
    // or merges kept from before: stop it now, rather than let it wait out a rate limit for
    // merges nothing will use, then publish them over the sweep that replaced it.
    if (sweepBuild) {
      sweepBuild.superseded = true;
      sweepBuild.abort.abort();
      sweepBuild = null;
      sweepPreparing.value = null;
    }
    const step = sweepCache.nextStep(sweepWalletKey(), available, Date.now(), SWEEP_REBUILD_AFTER_MS);
    if (!step) {
      sweep.value = null;
      return true;
    }
    if (!step.plan) {
      sweep.value = { ...step.kept!.built, key, builtAt: step.kept!.builtAt };
      return true;
    }
    const { kept, plan } = step;
    const keptCount = kept?.built.merges.length ?? 0;
    const utxoCount = available.length;
    // The card counts this build's merges only while it owns the slot: a build for a
    // newer UTxO set takes the slot, and this one's late reports must not move its bar.
    let slot: SweepBuildSlot | null = null;
    const abort = new AbortController();
    const context: SweepBuildContext = {
      ownAddress: keys.value.payment[0].address,
      network: loggedWallet.value.network === 'Mainnet' ? 'MAINNET' : 'PREPROD',
      walletNetwork: loggedWallet.value.network,
      signal: abort.signal,
      onMergeBuilt: (built, total) => {
        if (slot && sweepBuild === slot) sweepPreparing.value = { built: keptCount + built, total: keptCount + total, utxoCount, waiting: false };
      },
      // The server asked for a pause: the card keeps its count and says so until the next merge lands.
      onRateLimited: () => {
        if (slot && sweepBuild === slot && sweepPreparing.value) sweepPreparing.value = { ...sweepPreparing.value, waiting: true };
      },
    };
    sweepPreparing.value = { built: keptCount, total: keptCount + plan.batches.length, utxoCount, waiting: false };
    slot = {
      key,
      promise: buildSweep(plan, context).then((added) => (kept ? combineSweeps(kept.built, added, utxoCount) : added)),
      abort,
      spends: new Set([...spentByMerges(kept?.built.merges ?? []), ...plan.batches.flat().map(refOf)]),
      builtAt: kept?.builtAt ?? Date.now(),
      superseded: false,
    };
    sweepBuild = slot;
  }
  sweep.value = null;
  const pending = sweepBuild;
  try {
    const built = await pending.promise;
    // The first awaiter publishes the result and clears the slot; a later awaiter of the
    // same promise finds the slot empty and leaves that result in place.
    if (sweepBuild === pending) {
      sweep.value = { ...built, key: pending.key, builtAt: pending.builtAt };
      sweepCache.remember(sweepWalletKey(), built, pending.builtAt);
    }
  } catch (error) {
    // An aborted build is not a failure: it was superseded (its replacement is taken up
    // below) or the dialog reset. Only a build that gave up on its own counts.
    if (!pending.abort.signal.aborted) throw error;
  } finally {
    // Whichever way it ended, the build that owns the slot takes its card down with it.
    if (sweepBuild === pending) {
      sweepBuild = null;
      sweepPreparing.value = null;
    }
  }
  // The slot never holds `pending` past the finally, so a build still in it is a newer
  // one for another UTxO set, started while this one ran; a superseded build was replaced
  // by that one or by merges kept from before. Go on with that sweep rather than without
  // one. This recurses only while such a build is pending, so it ends with the first build
  // to complete unsuperseded.
  if (pending.superseded || (sweepBuild !== null && sweepBuild !== pending)) return ensureSweep();
  if (pending.abort.signal.aborted) return false;
  // Built for an earlier UTxO set that its merges still serve: bring it up to date with what
  // arrived since. The merges are kept by now, so this builds one more at most.
  return pending.key === key ? true : ensureSweep();
}

/**
 * The max-ada and payment calls that follow a sweep's merges can land in the same
 * request-limit window the merges filled: they wait it out as the merges did. A
 * single send passes nothing, as before.
 */
function sweepCallOptions(): NexusCallOptions | undefined {
  return sweep.value ? { rateLimitRetry: true } : undefined;
}

/**
 * Build the transaction via Nexus backend (/api/tx/build).
 */
async function buildTx(options?: { selectAll?: boolean }) {
  const allValid = recipients.value.every((r: SendRecipient) =>
    isPaymentAddress(r.resolvedAddress ?? r.address)
  );
  if (!allValid) return;

  const confirmed = await confirmedRecipientDecimals();
  const nexusOutputs = recipients.value.map((r: SendRecipient) => recipientToNexusOutput(r, undefined, confirmed));

  const request: BuildTxRequest = {
    outputs: nexusOutputs,
    changeAddress: keys.value.payment[0].address,
    utxos: nexusInputs(),
    network: loggedWallet.value.network === 'Mainnet' ? 'MAINNET' : 'PREPROD',
    selectAll: options?.selectAll,
    withdrawals: currentRewardWithdrawals(),
  };

  try {
    const { tx_cbor: txCborHex, estimated_fee } = await nexusTxApi.buildTransferTx(
      request,
      loggedWallet.value.network,
      sweepCallOptions(),
    );

    // Reconstruct the Cardano.Tx from CBOR for the signing composable
    const transaction = Serialization.Transaction.fromCbor(HexBlob(txCborHex));
    tx.value = transaction.toCore();
    txValid.value = true;
    debugLog('Built multi-output tx via Nexus:', { txHash: txCborHex.slice(0, 20) + '...', estimated_fee });
  } catch (e) {
    if (!isCalculatingMax.value) debugLog('buildTx error:', e);
    txValid.value = false;
    throw e;
  }
}

async function nextStep() {
  if (currentStep.value === 1) {
    if (!isValid.value) return;
    currentStep.value++;
  } else if (currentStep.value === 2) {
    if (!isValid.value) return;
    await handleSign();
  }
}

function prevStep() {
  if (currentStep.value > 1) currentStep.value--;
}

/**
 * Set max amount for a token. For ADA: uses a 2-call approach instead of
 * binary search to avoid dozens of network round-trips to Nexus.
 *
 * 1. Build tx with a generous estimate (balance - 2 ADA fee buffer)
 * 2. Read the actual fee from the response, adjust, rebuild once
 */
async function setMax(recipientId: string, tokenIndex: number) {
  // A Max already running owns the build (and any sweep it starts): a second click would race it.
  if (isCalculatingMax.value) return;
  isCalculatingMax.value = true;
  // Invalidate any previously built tx so a stale one can't be submitted if
  // the new build fails (e.g. user came back from the summary step and
  // re-clicked MAX). tx.value is repopulated only when build succeeds.
  txValid.value = false;
  tx.value = undefined;
  // A fresh attempt, like runBuild: whatever the last build said no longer applies.
  buildError.value = null;
  // Track ADA MAX recipients for auto-adjust on build failure
  const recipientForMax = recipients.value.find((r: SendRecipient) => r.id === recipientId);
  if (recipientForMax && recipientForMax.selectedTokens[tokenIndex]?.ticker === nativeTicker.value) {
    maxRecipientIds.value.add(recipientId);
  }
  const recipientIdx = recipients.value.findIndex((r: SendRecipient) => r.id === recipientId);
  if (recipientIdx === -1) { isCalculatingMax.value = false; return; }

  const recipient = recipients.value[recipientIdx];
  const sendTokensCopy = JSON.parse(JSON.stringify(recipient.selectedTokens));
  const selectedToken = sendTokensCopy[tokenIndex];
  if (!selectedToken) { isCalculatingMax.value = false; return; }

  // For non-ADA tokens: set to the LIVE available balance (total minus what
  // other recipients committed — the same figure the card displays), not the
  // snapshot stored when the token was added (issue 938). Exact string-shift
  // conversion — filters.toCurrency rounds and float divide drifts (issue 933).
  if (selectedToken.ticker !== nativeTicker.value) {
    const decimals = Number(selectedToken.decimals) || 0;
    const liveToken = availableTokensFor(recipientId)
      .find((tk: Token & { balance?: string | number }) => tk.unit === selectedToken.unit);
    const liveBalance = liveToken?.balance ?? selectedToken.balance;
    selectedToken.quantity = baseUnitsToDecimalString(decimalToBaseUnits(liveBalance, 0), decimals);
    try {
      const updated = { ...recipient, selectedTokens: sendTokensCopy };
      recipients.value.splice(recipientIdx, 1, updated);
      await buildTx();
    } catch (e) {
      // The watcher is muted while Max runs and nothing else rebuilds, so say
      // what failed now; the fallback build below then classifies it the way an
      // ordinary build would (shortage hint, fragmentation, or the raw reason).
      buildError.value = friendlyTxError(e);
    }
    isCalculatingMax.value = false;
    if (!txValid.value) debouncedBuild();
    return;
  }

  // ADA max: ask Nexus to compute precisely via /api/tx/max-ada.
  // All outputs are sent — the MAX recipient has lovelace="0", Nexus maximizes it.
  // Other recipients' ADA + tokens are subtracted automatically by Nexus.

  // Build all outputs — the MAX recipient gets lovelace="0", others keep their amounts.
  // If the MAX recipient has no address yet, use the change address as placeholder
  // (the address only affects fee by a few bytes — close enough for MAX calculation).
  const changeAddr = keys.value.payment[0].address;
  const maxOutputs = recipients.value
    .filter((r: SendRecipient) => {
      // Skip other recipients that have no address and no amounts (empty cards)
      if (r.id === recipientId) return true;
      const addr = r.resolvedAddress ?? r.address;
      return !!addr && isPaymentAddress(addr);
    })
    .map((r: SendRecipient) => {
      if (r.id === recipientId) {
        const out = recipientToNexusOutput(r, '0');
        // Use change address as placeholder if recipient has no address
        if (!out.address || !isPaymentAddress(out.address)) {
          out.address = changeAddr;
        }
        return out;
      }
      return recipientToNexusOutput(r);
    });

  try {
    if (!(await ensureSweep())) {
      // The dialog reset while the merges were being built: this Max is over.
      isCalculatingMax.value = false;
      return;
    }
  } catch (e) {
    // The merges could not be built: nothing to compute the max from.
    buildError.value = friendlyTxError(e);
    isCalculatingMax.value = false;
    return;
  }
  let maxInputs: NexusTxInput[];
  try {
    maxInputs = nexusInputs();
  } catch (e) {
    // The sweep needs more inputs than one transaction can spend: nothing to compute.
    buildError.value = friendlyTxError(e);
    isCalculatingMax.value = false;
    return;
  }
  const maxAdaRequest: MaxAdaRequest = {
    outputs: maxOutputs,
    changeAddress: keys.value.payment[0].address,
    utxos: maxInputs,
    network: loggedWallet.value.network === 'Mainnet' ? 'MAINNET' : 'PREPROD',
    withdrawals: currentRewardWithdrawals(),
  };

  try {
    // Step 1: get the max amount preview from /api/tx/max-ada (for UI display)
    const maxResult = await nexusTxApi.calculateMaxAda(maxAdaRequest, loggedWallet.value.network, sweepCallOptions());
    const maxLovelace = BigInt(maxResult.max_lovelace);
    const changeMinUtxo = BigInt(maxResult.change_min_utxo);

    debugLog('setMax: Nexus max =', Number(maxLovelace) / 1_000_000, 'ADA (fee:', Number(maxResult.estimated_fee) / 1_000_000, ', changeMin:', Number(changeMinUtxo) / 1_000_000, ')');

    if (maxLovelace <= BigInt(0)) {
      // Max-ada couldn't fit an output (heavy NFTs etc.). Let the fallback
      // debouncedBuild at the bottom of setMax surface the failure to the UI.
      isCalculatingMax.value = false;
      if (!txValid.value) debouncedBuild();
      return;
    }

    // Step 2: set the amount in the UI
    const maxQty = Number(maxLovelace) / 1_000_000;
    const finalTokens = [...recipients.value[recipientIdx].selectedTokens];
    finalTokens[tokenIndex] = { ...finalTokens[tokenIndex], quantity: String(maxQty) };
    const finalRecipient = { ...recipients.value[recipientIdx], selectedTokens: finalTokens };
    if (changeMinUtxo > BigInt(0)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (finalRecipient as any).lockedForTokens = Number(changeMinUtxo) / 1_000_000;
    }
    recipients.value.splice(recipientIdx, 1, finalRecipient);

    // Step 3: build the tx — send lovelace="0" so Nexus auto-maximizes using
    // the same calculation as max-ada (no mismatch between two separate computations)
    let adjustedLovelace: bigint = maxLovelace;
    const tryBuild = async (loveOverride?: string): Promise<void> => {
      // This transaction may be signed: its token amounts convert with confirmed decimals.
      // A refusal ends Max here, and the plain rebuild below then says why.
      const confirmed = await confirmedRecipientDecimals();
      const buildOutputs = recipients.value
        .filter((r: SendRecipient) => {
          if (r.id === recipientId) return true;
          const addr = r.resolvedAddress ?? r.address;
          return !!addr && isPaymentAddress(addr);
        })
        .map((r: SendRecipient) => {
          if (r.id === recipientId) {
            const out = recipientToNexusOutput(r, loveOverride ?? '0', confirmed);
            if (!out.address || !isPaymentAddress(out.address)) out.address = changeAddr;
            return out;
          }
          return recipientToNexusOutput(r, undefined, confirmed);
        });

      const buildRequest: BuildTxRequest = {
        outputs: buildOutputs,
        changeAddress: changeAddr,
        utxos: nexusInputs(),
        network: loggedWallet.value.network === 'Mainnet' ? 'MAINNET' : 'PREPROD',
        selectAll: true,
        withdrawals: currentRewardWithdrawals(),
      };
      const { tx_cbor: txCborHex } = await nexusTxApi.buildTransferTx(buildRequest, loggedWallet.value.network, sweepCallOptions());
      const transaction = Serialization.Transaction.fromCbor(HexBlob(txCborHex));
      tx.value = transaction.toCore();
      txValid.value = true;
      const outs = tx.value.body.outputs;
      debugLog('setMax: built tx', {
        outputCount: outs.length,
        outputs: outs.map((o) => ({
          addr: String(o.address).slice(0, 10) + '…' + String(o.address).slice(-6),
          coins: o.value.coins.toString(),
          assetCount: o.value.assets
            ? (o.value.assets instanceof Map ? o.value.assets.size : Object.keys(o.value.assets).length)
            : 0,
        })),
        fee: tx.value.body.fee.toString(),
      });
    };

    try {
      await tryBuild();
    } catch (buildErr) {
      // Nexus sometimes disagrees with /api/tx/max-ada about change min-UTxO
      // when native tokens remain in change — parse the shortage and retry with
      // an explicit reduced lovelace so build accepts it.
      const msg = buildErr instanceof Error ? buildErr.message : String(buildErr);
      const match = msg.match(/Available:\s*(\d+)\s*lovelace,\s*required:\s*(\d+)\s*lovelace/);
      if (match) {
        const shortage = BigInt(match[2]) - BigInt(match[1]);
        adjustedLovelace = maxLovelace - shortage;
        if (adjustedLovelace > BigInt(0)) {
          const adjQty = Number(adjustedLovelace) / 1_000_000;
          const adjTokens = [...recipients.value[recipientIdx].selectedTokens];
          adjTokens[tokenIndex] = { ...adjTokens[tokenIndex], quantity: String(adjQty) };
          recipients.value.splice(recipientIdx, 1, { ...recipients.value[recipientIdx], selectedTokens: adjTokens });
          try {
            await tryBuild(adjustedLovelace.toString());
          } catch (retryErr) {
            debugLog('setMax: retry after shortage adjustment also failed:', retryErr);
          }
        }
      } else {
        debugLog('setMax: build after max-ada failed:', msg);
      }
    }
  } catch (err) {
    debugLog('setMax: /api/tx/max-ada failed:', err);
  }

  isCalculatingMax.value = false;

  // If neither the initial build nor the backoff retry produced a tx (e.g.
  // max-ada returned 0, threw, or the output is too heavy with NFTs),
  // schedule a plain debouncedBuild so the continue button eventually
  // becomes actionable. Otherwise the user is stuck — no reactive change
  // will fire the watcher, nothing else triggers a rebuild.
  if (!txValid.value) {
    debouncedBuild();
  }
}

/**
 * "Send Entire Wallet" while the stake key is registered: its deposit sits in no
 * UTxO, so the send cannot carry it and it would stay behind on a wallet that
 * looks empty. Ask first, once per dialog session, whether to unstake instead.
 */
const { txData: unstakeTxData, unstakeDialog, unstake, closeUnstakeDialog } = useUnstake();
const entireWalletPrompt = ref<{ recipientId: string } | null>(null);
/** The user chose to send without unstaking: don't ask again until the dialog resets. */
const entireWalletUnstakeDeclined = ref(false);
/** An unstake started from the prompt went out. */
const unstakeSubmitted = ref(false);
const stakeDepositLovelace = computed(() => Number(epochParams.value?.stakeKeyDeposit ?? 0));
/** Pending rewards: withdrawn by the send only when auto-withdraw attaches them, otherwise left behind. */
const entireWalletRewards = computed(() => {
  const pending = Number(walletStore.account?.withdrawable_amount ?? 0);
  if (!(pending > 0)) return { left: 0, included: 0 };
  return currentRewardWithdrawals() ? { left: 0, included: pending } : { left: pending, included: 0 };
});

function shouldOfferUnstake(): boolean {
  return loggedWallet.value?.chain === Blockchain.CARDANO
    && !!loggedWallet.value?.stakeAddress
    && loggedWallet.value?.type !== WalletType.Watch
    && !entireWalletUnstakeDeclined.value
    && isStakeKeyRegistered(walletStore.account)
    && stakeDepositLovelace.value > 0;
}

/** Entry from the recipient card: ask about the deposit first when it would stay behind. */
async function requestSendEntireWallet(recipientId: string) {
  if (isCalculatingMax.value) return;
  if (shouldOfferUnstake()) {
    entireWalletPrompt.value = { recipientId };
    return;
  }
  await sendEntireWallet(recipientId);
}

async function continueEntireWallet() {
  const pending = entireWalletPrompt.value;
  entireWalletPrompt.value = null;
  entireWalletUnstakeDeclined.value = true;
  if (pending) await sendEntireWallet(pending.recipientId);
}

/** The card already filled every token and NFT before asking: take them off again. */
function clearRecipientAssets(recipientId: string) {
  const idx = recipients.value.findIndex((r: SendRecipient) => r.id === recipientId);
  if (idx === -1) return;
  const empty = createEmptyRecipient();
  recipients.value.splice(idx, 1, {
    ...recipients.value[idx],
    selectedTokens: empty.selectedTokens,
    selectedCollectibles: {},
    minAda: 0,
    adaShortage: 0,
  });
}

function cancelEntireWallet() {
  const pending = entireWalletPrompt.value;
  entireWalletPrompt.value = null;
  if (pending) clearRecipientAssets(pending.recipientId);
}

async function unstakeBeforeEntireWallet() {
  const pending = entireWalletPrompt.value;
  entireWalletPrompt.value = null;
  if (pending) clearRecipientAssets(pending.recipientId);
  // Builds the deregistration (with any rewards) and opens UnstakeDialog over this one.
  await unstake();
}

/** Send entire wallet: all tokens + NFTs are already added by the child, just trigger MAX ADA */
async function sendEntireWallet(recipientId: string) {
  // A Max already running owns the recipient and the build: rewriting the recipient now would leave the form ahead of the transaction.
  if (isCalculatingMax.value) return;
  // Wait for the child's emit to propagate
  await nextTick();

  // Authoritative fix: rebuild the recipient's outbound assets straight from
  // the on-chain UTxO set. Keep only ADA in selectedTokens (so max-ada fills
  // it), and put every other asset in selectedCollectibles at whatever the
  // other recipients have left unclaimed. This sidesteps any drift between
  // walletStore.tokens / resolvedCollections / child state that would
  // otherwise leave stragglers in the change output.
  const idx = recipients.value.findIndex((r: SendRecipient) => r.id === recipientId);
  if (idx !== -1) {
    const recipient = recipients.value[idx];

    const available = spendableUtxos();
    const totals = new Map<string, bigint>();
    for (const utxo of available) {
      const raw = utxo[1].value.assets as unknown;
      if (!raw) continue;
      const add = (unit: string, qty: unknown) => {
        totals.set(unit, (totals.get(unit) ?? BigInt(0)) + BigInt(String(qty)));
      };
      if (raw instanceof Map) {
        raw.forEach((qty, unit) => add(String(unit), qty));
      } else if (Array.isArray(raw)) {
        for (const a of raw as { unit: string; quantity: unknown }[]) add(String(a.unit), a.quantity);
      } else if (typeof raw === 'object') {
        for (const [unit, qty] of Object.entries(raw as Record<string, unknown>)) add(unit, qty);
      }
    }

    // Keep the ADA token entry (max-ada will set its amount) and drop every
    // other token — those are re-emitted through the collectibles map with
    // known-good quantities derived from the UTxOs.
    const adaOnlyTokens = recipient.selectedTokens.filter((tk: Token) => tk?.ticker === nativeTicker.value);

    // Sweep only the REMAINDER — whatever other recipients haven't already
    // claimed. Without this, running "send entire wallet" on a second card
    // hands out the same assets twice and the build is rejected downstream
    // (issue 938). ADA needs no such netting: max-ada accounts for other outputs.
    const committed = committedBaseUnitsExcluding(recipientId);
    let assetsClaimedElsewhere = 0;

    const fullCollectibles: Record<string, Collectible & { unit: string }> = {};
    for (const [unit, qty] of totals) {
      if (!unit || unit === 'lovelace') continue;
      const remaining = qty - (committed.get(unit) ?? BigInt(0));
      if (remaining <= BigInt(0)) {
        assetsClaimedElsewhere++;
        continue;
      }
      fullCollectibles[unit] = {
        unit,
        policy_id: unit.slice(0, 56),
        asset_name: unit.slice(56),
        fingerprint: '',
        // quantity stays the full on-chain holding (what the UI calls the max);
        // toSendQuantity is the remainder, and that's what the output emitter reads
        quantity: Number(qty),
        toSendQuantity: Number(remaining),
      } as Collectible & { unit: string };
    }

    recipients.value.splice(idx, 1, {
      ...recipient,
      selectedTokens: adaOnlyTokens,
      selectedCollectibles: fullCollectibles,
    });
    await nextTick();

    debugLog('sendEntireWallet: scanned', {
      utxoCount: available.length,
      uniqueAssets: totals.size,
      tokensKeptInRecipient: adaOnlyTokens.length,
      collectiblesEmitted: Object.keys(fullCollectibles).length,
      assetsClaimedElsewhere,
    });
  }

  // Trigger MAX on ADA (index 0) — since every non-ADA asset is now on the
  // recipient output, no change output should be needed.
  await setMax(recipientId, 0);
}

watch(() => props.isOpen, (val) => {
  if (val) {
    resetData();
  }
})

// Debounced build — avoids firing on every keystroke (e.g. typing "10" = "1" then "10").
// `isBuilding` is raised by the recipients watcher when it schedules this and dropped when
// the run ends, whichever way, so the summary's shimmer covers the debounce and the call.
const debouncedBuild = debounce(async () => {
  try {
    await runBuild();
  } finally {
    isBuilding.value = false;
  }
}, 500);

async function runBuild(): Promise<void> {
  if (isCalculatingMax.value) return;

  if (!hasAnyAmount()) {
    txValid.value = false;
    buildError.value = null;
    return;
  }

  // A typed amount that needed a sweep, now lowered under the amount that did: try it as
  // one transaction again. Raised, it still needs one, so the merges are kept.
  if (amountSweepFrom.value !== null && requestedLovelace() < amountSweepFrom.value) amountSweepFrom.value = null;

  // A payment built from the previous sweep must not stay signable while the sweep is replaced.
  txValid.value = false;
  try {
    // A reset while the merges were being built leaves nothing to build for.
    if (!(await ensureSweep())) return;
  } catch (e) {
    buildError.value = friendlyTxError(e);
    txValid.value = false;
    tx.value = undefined;
    return;
  }

  try {
    buildError.value = null;
    // When a MAX recipient is tracked, always force selectAll so Nexus uses
    // the same UTxO set as the auto-adjust path — prevents oscillation where
    // plain build picks a different subset and fails differently. A sweep's payment
    // takes every candidate too: the signer refuses one that leaves a merge unspent.
    const buildOpts = maxRecipientIds.value.size > 0 || sweep.value ? { selectAll: true } : undefined;
    await buildTx(buildOpts);
    txValid.value = true;
    recipients.value.forEach((r: SendRecipient) => { r.adaShortage = 0; });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Nexus only saw the candidates one request may carry. When the lovelace the
    // rest of the wallet still holds would have closed the gap it reports, the
    // problem is fragmentation, and a "need X more ADA" hint would contradict the
    // balance on screen. A wallet short even as a whole gets the real shortfall.
    const selection = inputSelection.value;
    const fragmented = shortOnlyByLimit(shortfallLovelaceFromMessage(msg), selection, spendableUtxos());
    // The wallet holds the amount, only spread over more UTxOs than one request carries:
    // send it as Max does, merges first, then one payment. Once per amount: when the retry
    // still finds no sweep (its token holders leave too few ADA-only UTxOs to merge), asking
    // again would only repeat it, so it falls through to the message below.
    if (fragmented && canSweep.value && !sweep.value && amountSweepFrom.value === null) {
      amountSweepFrom.value = requestedLovelace();
      return runBuild();
    }
    if (e instanceof InputLimitError) {
      buildError.value = friendlyTxError(e);
    } else if (fragmented && selection) {
      buildError.value = t('send.inputLimitFragmented', { count: selection.total, max: selection.limit });
    } else if (msg.includes('less than the minimum UTXO value') || msg.includes('OutputTooSmallUTxO')) {
      const match = msg.match(/minimum UTXO value (\d+)/);
      if (match) {
        const errMin = Number(filters.toCurrency(parseInt(match[1], 10), false, 6, '', '', false, 6).replaceAll(',', ''));
        if (recipients.value[0]) recipients.value[0].minAda = Math.max(recipients.value[0].minAda, errMin);
      }
    } else if (msg.includes('Insufficient input in transaction.')) {
      const match = msg.match(/\{ada in inputs: (\d+), ada in outputs: (\d+), fee (\d+)/);
      if (match) {
        const shortage = Number(filters.toCurrency(parseInt(match[2], 10) - parseInt(match[1], 10), false, 6, '', '', false, 6).replaceAll(',', ''));
        if (recipients.value[0]) recipients.value[0].adaShortage = shortage;
      }
    } else if (msg.includes('Insufficient ADA to cover minimum UTXO for change')) {
      // Nexus 400 — change output can't cover min-UTxO with native tokens.
      // Show shortage in the first recipient (same UX as other shortage errors).
      const match = msg.match(/Available:\s*(\d+)\s*lovelace,\s*required:\s*(\d+)\s*lovelace/);
      if (match && recipients.value[0]) {
        recipients.value[0].adaShortage = Number(filters.toCurrency(parseInt(match[2], 10) - parseInt(match[1], 10), false, 6, '', '', false, 6).replaceAll(',', ''));
      }
    } else if (msg.includes('Insufficient token balance')) {
      // Nexus 400 — the output asked for more of a token than the wallet holds.
      // Parse the asset identifier (policyId prefix + assetName hex, joined by
      // "...") and the available amount, then cap the corresponding token in
      // each recipient and rebuild once. If the cap fails, fall through and
      // surface adaShortage so the recipient card shows the error.
      const match = msg.match(/asset\s+([0-9a-f]+)\.\.\.([0-9a-f]+).*?Required:\s*(\d+),\s*available:\s*(\d+)/i);
      if (match) {
        const [, policyPrefix, assetNameSuffix, , availableStr] = match;
        const available = BigInt(availableStr);
        let capped = false;
        for (const r of recipients.value) {
          for (let i = 0; i < r.selectedTokens.length; i++) {
            const tk = r.selectedTokens[i] as Token & { unit?: string };
            if (!tk.unit) continue;
            if (!tk.unit.startsWith(policyPrefix) || !tk.unit.endsWith(assetNameSuffix)) continue;
            const decimals = tk.decimals ?? 0;
            const newQty = Number(available) / Math.pow(10, decimals);
            if (Number(tk.quantity) !== newQty) {
              const updatedTokens = [...r.selectedTokens];
              updatedTokens[i] = { ...tk, quantity: String(newQty) };
              const idx = recipients.value.indexOf(r);
              recipients.value.splice(idx, 1, { ...r, selectedTokens: updatedTokens });
              capped = true;
            }
          }
        }
        if (capped) {
          // Retry build immediately with the capped amount — avoid waiting for
          // the watcher → debounce cycle, which would also re-run auto-adjust
          // and loop.
          isCalculatingMax.value = true;
          try {
            await buildTx({ selectAll: maxRecipientIds.value.size > 0 });
            txValid.value = true;
            recipients.value.forEach((rr: SendRecipient) => { rr.adaShortage = 0; });
          } catch {
            if (recipients.value[0]) recipients.value[0].adaShortage = 1;
          } finally {
            isCalculatingMax.value = false;
            debouncedBuild.cancel();
          }
          return;
        }
      }
      if (recipients.value[0]) recipients.value[0].adaShortage = 1;
    } else {
      // Anything Nexus or the client refused for a reason the hints above do not
      // cover: say what it was instead of only greying out Continue.
      buildError.value = friendlyTxError(e);
    }
    txValid.value = false;
    // Clear any stale tx so the summary step can't display / the user can't
    // submit a previous build when the current inputs don't produce a valid
    // one (e.g. returned from summary, tweaked amounts, new build failed).
    tx.value = undefined;

    // Auto-adjust MAX recipients on build failure (one attempt only)
    if (maxRecipientIds.value.size > 0) {
      isCalculatingMax.value = true; // Prevent watch from re-triggering during adjustment
      try {
        for (const maxId of maxRecipientIds.value) {
          const maxIdx = recipients.value.findIndex((r: SendRecipient) => r.id === maxId);
          if (maxIdx === -1) { maxRecipientIds.value.delete(maxId); continue; }
          const maxRecipient = recipients.value[maxIdx];
          const recipientAddress = maxRecipient.resolvedAddress ?? maxRecipient.address;
          if (!isPaymentAddress(recipientAddress)) continue;
          try {
            const adjustOutputs = recipients.value.map((r: SendRecipient) =>
              r.id === maxId
                ? recipientToNexusOutput(r, '0')
                : recipientToNexusOutput(r)
            );
            const maxResult = await nexusTxApi.calculateMaxAda({
              outputs: adjustOutputs,
              changeAddress: keys.value.payment[0].address,
              utxos: nexusInputs(),
              network: loggedWallet.value.network === 'Mainnet' ? 'MAINNET' : 'PREPROD',
              withdrawals: currentRewardWithdrawals(),
            }, loggedWallet.value.network, sweepCallOptions());
            const maxLovelace = BigInt(maxResult.max_lovelace);
            if (maxLovelace > BigInt(0)) {
              const maxQty = Number(maxLovelace) / 1_000_000;
              const adaIdx = maxRecipient.selectedTokens.findIndex((tk: Token) => tk.ticker === nativeTicker.value);
              if (adaIdx >= 0) {
                const finalTokens = [...maxRecipient.selectedTokens];
                finalTokens[adaIdx] = { ...finalTokens[adaIdx], quantity: String(maxQty) };
                recipients.value.splice(maxIdx, 1, { ...maxRecipient, selectedTokens: finalTokens });
              }
            }
          } catch { /* ignore auto-adjust failure */ }
        }
        // Retry build after adjusting; if Nexus's max-ada disagrees with build
        // about change min-UTxO, parse the shortage and back off the MAX
        // recipient's ADA by that amount, then try once more.
        try {
          await buildTx({ selectAll: true });
          txValid.value = true;
          buildError.value = null;
          recipients.value.forEach((r: SendRecipient) => { r.adaShortage = 0; });
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          const mm = retryMsg.match(/Available:\s*(\d+)\s*lovelace,\s*required:\s*(\d+)\s*lovelace/);
          if (mm) {
            const shortageLovelace = BigInt(mm[2]) - BigInt(mm[1]);
            // Apply backoff to every MAX recipient in case multiple are tracked
            for (const maxId of maxRecipientIds.value) {
              const idx = recipients.value.findIndex((r: SendRecipient) => r.id === maxId);
              if (idx === -1) continue;
              const mr = recipients.value[idx];
              const adaIdx = mr.selectedTokens.findIndex((tk: Token) => tk.ticker === nativeTicker.value);
              if (adaIdx < 0) continue;
              const currentLovelace = BigInt(Math.floor(Number(mr.selectedTokens[adaIdx].quantity) * 1_000_000));
              const adjusted = currentLovelace - shortageLovelace;
              if (adjusted <= BigInt(0)) continue;
              const finalTokens = [...mr.selectedTokens];
              finalTokens[adaIdx] = { ...finalTokens[adaIdx], quantity: String(Number(adjusted) / 1_000_000) };
              recipients.value.splice(idx, 1, { ...mr, selectedTokens: finalTokens });
            }
            try {
              await buildTx({ selectAll: true });
              txValid.value = true;
              buildError.value = null;
              recipients.value.forEach((r: SendRecipient) => { r.adaShortage = 0; });
            } catch { /* still invalid — leave adaShortage set */ }
          }
        }
      } finally {
        // Drop any debouncedBuild calls queued by our own splices — without
        // this the watcher re-fires with identical state and loops forever.
        debouncedBuild.cancel();
        isCalculatingMax.value = false;
      }
    }
  }
}

watch(
  () => recipients.value,
  () => {
    if (isCalculatingMax.value) return;

    // Synchronous: update minAda per recipient (local, no network call)
    for (const r of recipients.value) {
      if (!epochParams.value) continue;
      const addr = r.resolvedAddress ?? r.address;
      if (!addr) continue;
      const assetsMap = new Map<Cardano.AssetId, bigint>();
      Object.values(r.selectedCollectibles).forEach((col: Collectible & { unit: string }) => {
        assetsMap.set(col.unit as Cardano.AssetId, BigInt(col.toSendQuantity || 0));
      });
      r.selectedTokens.forEach((token: Token) => {
        if (token?.unit && token.ticker !== nativeTicker.value) {
          const qty = token.quantity ? decimalToBaseUnits(token.quantity, token.decimals || 0) : BigInt(0);
          if (qty > BigInt(0)) assetsMap.set(token.unit as Cardano.AssetId, qty);
        }
      });
      if (assetsMap.size > 0) {
        try {
          // Iterate: the serialized size of the coin field grows with its
          // varint length (1 byte for 0, up to 9 bytes for large amounts),
          // so a one-shot calc with coins=0 under-reports min-UTxO for outputs
          // that actually carry meaningful ADA. Feed the result back until
          // stable so Nexus's calc (which sees the final coin value) agrees.
          const coinsPerByte = BigInt(epochParams.value.coinsPerUtxoByte);
          let coins = BigInt(0) as Cardano.Lovelace;
          let minAdaLovelace = BigInt(0);
          for (let i = 0; i < 5; i++) {
            const mockOut: Cardano.TxOut = {
              address: addr as Cardano.PaymentAddress,
              value: { coins, assets: assetsMap }
            };
            const next = BrowserTxConstruction.minAdaRequired(mockOut, coinsPerByte);
            if (next === minAdaLovelace) break;
            minAdaLovelace = next;
            coins = next as Cardano.Lovelace;
          }
          r.minAda = Number(minAdaLovelace) / 1_000_000;
        } catch { r.minAda = 0; }
      } else {
        r.minAda = 0;
      }
    }

    // Async: debounced network call to build tx. The shimmer starts now, not when the
    // debounce fires, so the summary never flashes stale figures in between.
    isBuilding.value = hasAnyAmount();
    debouncedBuild();
  },
  { deep: true }
);

onMounted(() => {
  recipients.value = [createEmptyRecipient()];
  expandedRecipientId.value = recipients.value[0]?.id ?? null;
});
</script>
<style scoped>
/* ─── Content area ───
   No height of its own: the dialog grows with its content up to the window, and only a
   window too short for it makes this area scroll. What only some sends need (a sweep's plan,
   the note on what Max leaves behind) sits in a drawer beside the dialog instead. */
.send-dialog-content {
  z-index: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.send-dialog-content--empty {
  min-height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ─── Step 1: Recipients ─── */
.step-recipients-wrapper {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
}

.step-recipients-inner {
  width: 100%;
  min-width: 340px;
}

.add-recipient-link {
  text-align: center;
  padding: 4px 0 2px;
}

/* ─── Global total ─── */
.global-total {
  padding: 10px 12px;
  margin-top: 4px;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}

.global-total__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.global-total__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-2);
}

.global-total__ada {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-1);
}

.global-total__fiat {
  font-size: 11px;
  color: var(--g-text-3);
  margin-left: 6px;
}

.global-total__fee-row {
  margin-bottom: 4px;
}

/* A sweep's fee split, right under the fee it adds up to. */
.global-total__breakdown {
  justify-content: flex-end;
  margin-bottom: var(--g-s-1);
}

/* Shimmer stand-ins sized like the figures they replace, so the rows keep their height. */
.global-total__skeleton {
  display: inline-block;
  height: 12px;
  width: 72px;
}
.global-total__skeleton--total {
  height: 16px;
  width: 128px;
}
.global-total__skeleton--breakdown {
  width: 176px;
  vertical-align: middle;
}

/* Separator + its breathing room only when there ARE rows above Total (fee /
   withdrawal are v-if). On the Recipients step those are hidden, so both the
   border and the top padding would otherwise be orphaned above Total. */
.global-total__total-row:not(:first-child) {
  padding-top: 6px;
  border-top: 1px solid var(--g-hairline-1);
}

.global-total__fee-label {
  font-size: 11px;
  color: var(--g-text-3);
}

.global-total__error,
.global-total__note {
  font-size: 11px;
  line-height: 1.35;
  margin-top: 6px;
  text-align: left;
}

.global-total__error {
  color: var(--g-error);
}

.global-total__note {
  color: var(--g-text-3);
}

/* A figure, not a warning: the fee reads in the primary tone like the total it feeds. */
.global-total__fee {
  font-size: 11px;
  color: var(--g-text-1);
}

.global-total__withdrawal {
  font-size: 11px;
  color: var(--g-success);
}

/* ─── Empty wallet ─── */
.empty-wallet-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
}

.empty-wallet-title {
  color: var(--g-text-2);
}

.empty-wallet-description {
  color: var(--g-text-3);
  max-width: 300px;
  margin: 0 auto;
}

/* ─── Actions ─── */
.send-dialog-actions {
  text-align: center;
  justify-content: center;
}

/* ─── Buttons ─── */
.continue-button {
  background: var(--g-grad);
  color: var(--g-canvas);

  &:disabled {
    opacity: 0.5;
    color: var(--g-canvas) !important;
  }
}

/* ─── Stepper ─── */
.stepper-container {
  background-color: transparent !important;

  & :deep(.v-stepper-header) {
    box-shadow: none;
    align-items: stretch;
    margin-bottom: 8px;
  }

  .custom-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    padding: 2px;
    width: 68px;

    &.active .icon-container {
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--g-accent) 15%, transparent);
    }

    &.next .icon-container {
      background-color: var(--g-raised);
    }

    .icon-container {
      background-color: var(--g-accent);
      border-radius: 50%;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 20px;
      width: 20px;
      padding-left: 1px;
    }
  }

  .step-label {
    margin-top: 4px;
    font-size: 12px;
    line-height: 16px;
    text-align: center;
    font-weight: 600;
    color: var(--g-text-2);
  }

  .divider {
    flex: 1;
    height: 2px;
    width: 100%;
    margin-left: -38px;
    margin-right: -38px;
    margin-top: 11px;
    background-color: var(--g-raised);

    &.active-divider {
      background-color: var(--g-accent);
    }
  }
}

:deep(.v-stepper-window-item) {
  padding: 0;
}
</style>
