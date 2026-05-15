<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="emit('close')"
    :title="t('wallet.quickSend')"
    :loading="txSignLoading"
    :min-height="0"
    :subtitle="t('wallet.quickSendSubtitle', { currency: nativeTicker })"
    :persistent="false"
    :img="assets.sendSvg"
    :width="428"
    imgStyle="filter: brightness(0) saturate(100%) invert(100%) sepia(49%) saturate(2%) hue-rotate(47deg) brightness(118%) contrast(101%);"
  >
    <!-- Midnight unshielded send (Phase 1). Build → sign → submit through Nexus.
         Shielded send and the shielded/unshielded toggle land in Phase 3 once
         `wallet-sdk-shielded` is wired and a proof server is configured. -->
    <template v-if="isMidnight">
      <v-card-text class="px-3 pb-3 send-dialog-content midnight-send-content">
        <!-- Available balance reminder -->
        <div class="midnight-balance-snapshot mb-4">
          <div class="midnight-snapshot-label">{{ $t('midnight.unshielded') }}</div>
          <div class="midnight-snapshot-amount">
            {{ formatMidnightUnshielded }} {{ midnightNightCurrency }}
          </div>
        </div>

        <!-- Recipient + amount form. Mirrors Cardano SendRecipientCard's
             field shapes but is single-recipient since Midnight unshielded
             transfers don't aggregate multi-output the same way. -->
        <v-form ref="midnightFormRef" v-model="midnightFormValid">
          <v-text-field
            v-model="midnightRecipient"
            :label="$t('common.recipientAddress')"
            outlined
            dense
            :rules="midnightAddressRules"
            :disabled="midnightSending"
            class="mb-2"
          />
          <v-text-field
            v-model="midnightAmount"
            :label="$t('common.amount') + ' (' + midnightNightCurrency + ')'"
            outlined
            dense
            type="number"
            min="0"
            step="0.000001"
            :rules="midnightAmountRules"
            :disabled="midnightSending"
            :hint="`Available: ${formatMidnightUnshielded} ${midnightNightCurrency}`"
            persistent-hint
            class="mb-3"
          >
            <template v-slot:append>
              <v-btn x-small text @click="setMidnightMax" :disabled="midnightSending">MAX</v-btn>
            </template>
          </v-text-field>

          <!-- PRF wallets: no password field. Password wallets: prompt inline. -->
          <v-text-field
            v-if="!isPrfWallet"
            v-model="midnightPassword"
            :label="$t('common.spendingPassword')"
            type="password"
            outlined
            dense
            :disabled="midnightSending"
            class="mb-2"
          />

          <div v-if="midnightError" class="red--text text--lighten-2 text-caption mb-2">
            {{ midnightError }}
          </div>

          <v-btn
            block
            large
            class="geroButton mt-2"
            :loading="midnightSending"
            :disabled="!canSubmitMidnightSend"
            @click="submitMidnightSend"
          >
            <v-icon left>{{ isPrfWallet ? 'mdi-fingerprint' : 'mdi-send' }}</v-icon>
            {{ isPrfWallet ? $t('midnight.signWithPasskeyAndSend') : $t('midnight.signAndSend') }}
          </v-btn>

          <div class="text-caption text--secondary text-center mt-3">
            {{ $t('midnight.shieldedSendComingNote') }}
          </div>
        </v-form>
      </v-card-text>
    </template>

    <!-- Empty wallet state -->
    <template v-else-if="isWalletEmpty">
      <v-card-text class="px-3 pb-0 justify-center text-center send-dialog-content send-dialog-content--empty">
        <div class="empty-wallet-state">
          <v-icon size="64" color="rgba(255, 255, 255, 0.3)" class="mb-4">mdi-wallet-outline</v-icon>
          <div class="empty-wallet-title text-h6 mb-2">
            {{ $t('wallet.emptyWalletSendTitle') }}
          </div>
          <div class="empty-wallet-description text-body-2 mb-6">
            {{ $t('wallet.emptyWalletSendDescription', { currency: nativeTicker }) }}
          </div>
          <v-btn
            outlined
            color="#00DFF3"
            @click="openReceiveDialog"
          >
            <v-icon small class="mr-1">mdi-qrcode</v-icon>
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
            <template v-for="(item, index) in steps">
              <div
                class="custom-step"
                :key="item.name"
                :class="{ active: currentStep === index + 1, done: currentStep > index + 1, next: currentStep < index + 1 }"
              >
                <div class="icon-container">
                  <v-icon
                    class="step-icon"
                    :color="currentStep < index + 1 ? '#00dff3' : '#0f0f0f'"
                    size="16"
                  >{{ currentStep > index + 1 ? 'mdi-check' : 'mdi-circle-medium' }}
                  </v-icon>
                </div>
                <span class="step-label">{{ item.label }}</span>
              </div>
              <div class="divider" :class="{ 'active-divider': currentStep > index + 1 }" :key="index"
                   v-if="index < steps.length - 1"></div>
            </template>
          </v-stepper-header>
        </v-stepper>
      </v-card-title>

      <!-- Content area -->
      <v-card-text class="send-dialog-content pa-0">
        <CustomStepper :currentStep="currentStep" :steps="steps">
          <!-- Step 1: Recipients -->
          <v-stepper-content step="1">
            <div class="step-recipients-wrapper">
              <div class="step-recipients-inner">
                <SendRecipientCard
                  v-for="(recipient, idx) in recipients"
                  :key="recipient.id"
                  :class="{ shake: shakeError && !isRecipientValid(recipient) }"
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
                  @sendEntireWallet="sendEntireWallet(recipient.id)"
                />

                <!-- Add another recipient link -->
                <div v-if="showAddLink" class="add-recipient-link">
                  <v-btn text x-small color="#00DFF3" @click="addRecipient()">
                    <v-icon x-small class="mr-1">mdi-plus</v-icon>
                    {{ $t('wallet.addAnotherRecipient') }}
                  </v-btn>
                </div>

                <!-- Global total -->
                <div v-if="globalTotal.ada > 0 || globalTotal.usd > 0" class="global-total">
                  <div v-if="globalTotal.formattedFee" class="global-total__row global-total__fee-row">
                    <span class="global-total__fee-label">{{ $t('signTx.networkFee') }}</span>
                    <span class="global-total__fee">- {{ globalTotal.formattedFee }}</span>
                  </div>
                  <div v-if="globalTotal.formattedWithdrawal" class="global-total__row global-total__fee-row">
                    <span class="global-total__fee-label">{{ $t('wallet.rewardsWithdrawn') }}</span>
                    <span class="global-total__withdrawal">+ {{ globalTotal.formattedWithdrawal }}</span>
                  </div>
                  <div class="global-total__row global-total__total-row">
                    <span class="global-total__label">{{ $t('common.total') }}</span>
                    <div>
                      <span class="global-total__ada">{{ globalTotal.formattedTotal }}</span>
                      <span class="global-total__fiat">{{ '\u2248' }} {{ globalTotal.formattedUsd }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </v-stepper-content>

          <!-- Step 2: Summary -->
          <v-stepper-content step="2">
            <SummaryStep
              ref="summaryRef"
              :recipients="recipients"
              :tx-data="tx"
              @next="handleSign"
              @prev="prevStep"
            />
          </v-stepper-content>
        </CustomStepper>

        <!-- Keystone Sign Dialog -->
        <KeystoneSignDialog
          :isOpen="overlay && loggedWallet?.type === WalletType.Keystone"
          :keystoneType="keystoneType"
          :keystoneCbor="keystoneCbor"
          @close="overlay = false"
          @scan="onKeystoneScan"
          @error="onKeystoneError"
          @progress="onKeystoneProgress"
        />
      </v-card-text>

      <!-- Actions -->
      <v-card-actions class="send-dialog-actions" :style="loggedWallet?.btSupported ? { display: 'block', height: '96px', alignContent: 'end'} : { flexFlow: 'column'}">
        <!-- Transaction Authentication Section (step 2 only) -->
        <div v-if="currentStep === 2">
          <TransactionAuthSection
            :wallet-type="loggedWallet?.type"
            :is-prf-wallet="isPrfWallet"
            :is-signed="isSubmit"
            :loading="txSignLoading"
            :password="spendingPassword"
            @update:password="spendingPassword = $event"
            :password-label="t('wallet.spendingPassword')"
            :password-rules="passwordRules"
            :submit-text="t('common.confirm')"
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
            text
            @click="prevStep"
            v-if="currentStep > 1"
            class="mr-2"
            :disabled="txSignLoading"
          >
            <v-icon small class="mr-1">mdi-arrow-left</v-icon>{{ $t('common.back') }}
          </v-btn>
          <!-- Step 1: Continue button -->
          <v-btn
            v-if="currentStep !== 2"
            :class="['continue-button', { shake: shakeError }]"
            @click="nextStep()"
            :loading="txSignLoading"
          >{{ $t('common.continue') + ' ' }}
            <v-icon style="color: black!important;" small class="ml-1">mdi-arrow-right</v-icon>
          </v-btn>
          <!-- Step 2: Sign/Confirm button for non-PRF wallets -->
          <v-btn
            v-else-if="!isPrfWallet"
            class="continue-button"
            @click="nextStep"
            :disabled="!isValid || txSignLoading"
            :loading="txSignLoading"
          >{{ isSubmit ? $t('common.confirm') : $t('wallet.sign') }}
          </v-btn>
        </div>
      </v-card-actions>
    </template>
  </BaseDialog>
</template>
<script setup lang="ts">
import { toRefs, ref, computed, watch, onMounted, nextTick } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import CustomStepper from '@/shared/components/CustomStepper.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import SummaryStep from '../components/SummaryStep.vue';
import SendRecipientCard from '../components/SendRecipientCard.vue';
import rules from '@/utils/rules';
import { WalletType, Blockchain, Network } from '@/models/types';
import { midnightStore } from '@/stores/midnightStore';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { Token, Collectible, SendRecipient } from '@/models/send-flow.types';
import networks from '@/utils/networks';
import filters from '@/shared/utils/filters';
import { isPaymentAddress } from '@/chrome/serialization';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { priceStore } from '@/stores/priceStore';
import { currentRewardWithdrawals } from '@/shared/utils/autoWithdraw';
import debounce from 'lodash/debounce';
import { nexusTxApi, cardanoUtxoToNexusInput, type BuildTxRequest, type NexusTxAsset, type MaxAdaRequest } from '@/api/nexus-tx-api';
import { Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { BrowserTxConstruction } from '@/chrome/cardanoJsSdkCbor';
import { Cardano } from '@cardano-sdk/core';
import assets from '@/utils/assets';
import { debugLog } from '@/utils/debug';
import { useQuickActionDialogs } from '@/shared/composables/useQuickActionDialogs';
import { loadingState } from '@/stores/loading';

interface Props {
  isOpen: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits(['close']);

const { t } = useTranslation();

const { loggedWallet, utxos, tokens: resolvedAssets, keys, collections: resolvedCollections } = toRefs(walletStore)
const { epochParams } = toRefs(networkStore)

const nativeTicker = computed(() => networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network));

// ── Midnight unshielded send (Phase 1) ──────────────────────────────────────
//
// Build → sign → submit via Nexus. Mirrors the Cardano pipeline but:
//   - the wallet only signs intent-hash segments locally (no full tx
//     construction in browser — Nexus runs the SDK)
//   - hardware wallets are not supported (Midnight requires cleartext key
//     for proof generation; SDK has no hardware-signer integration)
//   - the form is single-recipient (multi-recipient unshielded transfers
//     can be revisited if the SDK exposes it cleanly)
const isMidnight = computed(() => loggedWallet.value?.chain === Blockchain.MIDNIGHT);
const midnightNightCurrency = computed(() =>
  loggedWallet.value?.network === Network.MAINNET ? 'NIGHT' : 'tNIGHT'
);

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);

const formatMidnightUnshielded = computed(() => {
  const value = midnightStore.balances?.nightUnshielded ?? 0n;
  const whole = value / NIGHT_DIVISOR;
  const remainder = value % NIGHT_DIVISOR;
  const remainderStr = remainder.toString().padStart(NIGHT_DIVISOR.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, 2).padEnd(2, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
});

const midnightFormRef = ref<{ validate: () => boolean } | null>(null);
const midnightFormValid = ref(false);
const midnightRecipient = ref('');
const midnightAmount = ref('');
const midnightPassword = ref('');
const midnightSending = ref(false);
const midnightError = ref<string | null>(null);

// `isPrfWallet` is destructured from `useTransactionSigning()` below — we
// reference it inside async/computed bodies so the temporal-dead-zone is
// never observed at runtime (those bodies run after module init completes).

// Validation rules. Address shape is intentionally permissive — the indexer
// is the final arbiter; we only catch obvious typos here.
const midnightAddressRules = computed(() => [
  (v: string) => !!v || 'Recipient address required',
  (v: string) => {
    const isMain = loggedWallet.value?.network === Network.MAINNET;
    const prefix = isMain ? 'mn_addr_' : `mn_addr_${(loggedWallet.value?.network || '').toLowerCase()}`;
    return v.startsWith('mn_addr_') || `Address should start with ${prefix}`;
  },
]);

const midnightAmountRules = computed(() => [
  (v: string) => !!v || 'Amount required',
  (v: string) => {
    const n = Number(v);
    return (Number.isFinite(n) && n > 0) || 'Must be positive';
  },
  (v: string) => {
    const baseUnits = parseMidnightAmount(v);
    const balance = midnightStore.balances?.nightUnshielded ?? 0n;
    return baseUnits <= balance || 'Exceeds available balance';
  },
]);

function parseMidnightAmount(input: string): bigint {
  // Accepts decimal strings; converts to NIGHT base units (10^6).
  if (!input) return 0n;
  const [whole = '0', fractionRaw = ''] = input.trim().split('.');
  const fraction = (fractionRaw + '0'.repeat(MIDNIGHT_DECIMALS.NIGHT))
    .slice(0, MIDNIGHT_DECIMALS.NIGHT);
  try {
    return BigInt(whole) * NIGHT_DIVISOR + BigInt(fraction || '0');
  } catch {
    return 0n;
  }
}

function setMidnightMax() {
  const value = midnightStore.balances?.nightUnshielded ?? 0n;
  const whole = value / NIGHT_DIVISOR;
  const remainder = value % NIGHT_DIVISOR;
  const remainderStr = remainder.toString().padStart(NIGHT_DIVISOR.toString().length - 1, '0');
  midnightAmount.value = remainder === 0n ? whole.toString() : `${whole}.${remainderStr.replace(/0+$/, '')}`;
}

const canSubmitMidnightSend = computed(() => {
  if (midnightSending.value) return false;
  if (!midnightRecipient.value || !midnightAmount.value) return false;
  if (!isPrfWallet.value && !midnightPassword.value) return false;
  return midnightFormValid.value;
});

async function submitMidnightSend() {
  if (!canSubmitMidnightSend.value) return;
  midnightError.value = null;
  midnightSending.value = true;
  try {
    const wallet = loggedWallet.value;
    if (!wallet) throw new Error('No wallet logged in');

    // PRF: trigger WebAuthn ceremony to obtain the raw PRF output that BG
    // will use to decrypt the mnemonic. Password: pass the typed password.
    const credentials: { password?: string; prfSecret?: Uint8Array } = {};
    if (isPrfWallet.value) {
      if (!wallet.webAuthnCredentialId) {
        throw new Error('PRF wallet missing credential ID');
      }
      const { evaluatePrfForWallet } = await import('@/shared/utils/webauthn-prf');
      const prfBuffer = await evaluatePrfForWallet(wallet.webAuthnCredentialId, wallet.id.toString());
      credentials.prfSecret = new Uint8Array(prfBuffer);
    } else {
      credentials.password = midnightPassword.value;
    }

    const { sendUnshieldedNight } = await import('@/services/midnight-tx.service');
    const amountBaseUnits = parseMidnightAmount(midnightAmount.value);
    const result = await sendUnshieldedNight(
      wallet.network,
      {
        fromAddress: wallet.baseAddress,
        outputs: [{
          address: midnightRecipient.value.trim(),
          amount: amountBaseUnits.toString(),
          token: 'NIGHT',
        }],
        ttlMs: Date.now() + 5 * 60_000, // 5 minutes
      },
      credentials,
    );

    // Reset state + close — the gero-sync subscription will pick up the
    // confirmed tx and update the transactions card automatically.
    midnightRecipient.value = '';
    midnightAmount.value = '';
    midnightPassword.value = '';
    debugLog('🌙 Midnight tx submitted:', result.txHash, 'status:', result.status);
    emit('close');
  } catch (e) {
    midnightError.value = e instanceof Error ? e.message : String(e);
  } finally {
    midnightSending.value = false;
  }
}

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
const shakeError = ref<boolean>(false);
const maxRecipientIds = ref<Set<string>>(new Set());

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

// Transaction signing composable (handles sign, submit, password, hardware wallets, Keystone)
const {
  loading: txSignLoading,
  spendingPassword,
  isSubmit,
  isBT,
  isPrfWallet,
  isBTSupported,
  passwordRules,
  handleSign,
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
  tx,
  successMessageKey: 'wallet.txSubmittedSuccess',
  onClose: () => emit('close'),
});

const tokens = computed(() => {
  if (resolvedAssets.value) {
    const tokenList = (Object.values(resolvedAssets.value) as (Token & { metadata: { name: string; ticker: string; decimals: number }; img: string })[]).map(token => {
      return {
        ...token,
        name: token.metadata.name,
        ticker: token.metadata.ticker,
        img: token.img,
        quantity: "0",
        balance: token.quantity,
        decimals: token.metadata.decimals,
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
    if (!txValid.value) return false;
    return recipients.value.every((r: SendRecipient) => {
      const addr = r.resolvedAddress ?? r.address;
      const rule = rules.recipientRules(loggedWallet.value?.chain, loggedWallet.value?.network);
      if (rule(addr) !== true) return false;
      const hasAsset = r.selectedTokens.some((tk: Token) => Number(tk.quantity) > 0) ||
        Object.keys(r.selectedCollectibles).length > 0;
      if (!hasAsset) return false;
      if (r.adaShortage > 0) return false;
      return true;
    });
  }
  if (currentStep.value === 2) {
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
  shakeError.value = false;
  maxRecipientIds.value = new Set();
  recipients.value = [createEmptyRecipient()];
  expandedRecipientId.value = recipients.value[0].id;
};

function availableTokensFor(recipientId: string) {
  const others = recipients.value.filter((r: SendRecipient) => r.id !== recipientId);
  return tokens.value.map((token: Token & { balance?: string | number; name?: string; img?: string; decimals: number }) => {
    const committed = others.reduce((sum: number, r: SendRecipient) => {
      const t2 = r.selectedTokens.find((tk: Token) => tk.unit === token.unit);
      if (!t2) return sum;
      return sum + Math.floor(Number(t2.quantity) * Math.pow(10, token.decimals ?? 6));
    }, 0);
    const rawBalance = Number(token.balance ?? 0);
    const newBalance = rawBalance - committed;
    return { ...token, balance: newBalance < 0 ? 0 : newBalance };
  });
}

function excludedFingerprintsFor(recipientId: string): Set<string> {
  const others = recipients.value.filter((r: SendRecipient) => r.id !== recipientId);
  const fingerprints = new Set<string>();
  others.forEach((r: SendRecipient) => {
    Object.values(r.selectedCollectibles).forEach((col: Collectible & { unit: string }) => {
      if (col.fingerprint) fingerprints.add(col.fingerprint);
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

function isRecipientValid(r: SendRecipient): boolean {
  const addr = r.resolvedAddress ?? r.address;
  const rule = rules.recipientRules(loggedWallet.value?.chain, loggedWallet.value?.network);
  if (rule(addr) !== true) return false;
  const hasAsset = r.selectedTokens.some((tk: Token) => Number(tk.quantity) > 0) ||
    Object.keys(r.selectedCollectibles).length > 0;
  if (!hasAsset) return false;
  if (r.adaShortage > 0) return false;
  return true;
}

const showAddLink = computed(() => {
  return recipients.value.length > 0;
});

/** Aggregate total across all recipients for the global total line. */
const globalTotal = computed(() => {
  let totalAda = 0;
  let totalUsd = 0;

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

  // Extract fee from built tx
  let feeAda = 0;
  let formattedFee = '';
  if (tx.value?.body?.fee) {
    const feeLovelace = Number(tx.value.body.fee);
    feeAda = feeLovelace / 1_000_000;
    formattedFee = filters.toCurrency(feeLovelace, false, 6, '\u20B3', '', false, 6);
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
    formattedWithdrawal = filters.toCurrency(Number(wLovelace), false, 6, '\u20B3', '', false, 6);
  }

  const totalWithFee = totalAda + feeAda - withdrawalAda;
  const adaPrice = Number(priceStore.adaUsd?.lastPrice || networkStore.price?.lastPrice || 0);
  totalUsd = totalWithFee * adaPrice;

  return {
    ada: totalAda,
    fee: feeAda,
    withdrawal: withdrawalAda,
    totalWithFee,
    usd: totalUsd,
    formattedAda: totalAda > 0
      ? filters.toCurrency(totalAda * 1e6, false, 6, '\u20B3', '', false, 6)
      : '\u20B30',
    formattedTotal: totalWithFee > 0
      ? filters.toCurrency(totalWithFee * 1e6, false, 6, '\u20B3', '', false, 6)
      : '\u20B30',
    formattedFee,
    formattedWithdrawal,
    formattedUsd: totalUsd > 0
      ? `$${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '$0.00',
  };
});

/** Build Nexus output format from a recipient. Optionally override lovelace (for max-ada). */
function recipientToNexusOutput(r: SendRecipient, overrideLovelace?: string) {
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
      const decimals = token.decimals != null ? token.decimals : 0;
      const qty = BigInt(Math.floor(Number(token.quantity) * Math.pow(10, decimals)));
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
 * Build the transaction via Nexus backend (/v1/tx/build).
 */
async function buildTx(options?: { selectAll?: boolean }) {
  const allValid = recipients.value.every((r: SendRecipient) =>
    isPaymentAddress(r.resolvedAddress ?? r.address)
  );
  if (!allValid) return;

  const nexusOutputs = recipients.value.map((r: SendRecipient) => recipientToNexusOutput(r));

  const request: BuildTxRequest = {
    outputs: nexusOutputs,
    changeAddress: keys.value.payment[0].address,
    utxos: (utxos.value as Cardano.Utxo[]).map(cardanoUtxoToNexusInput),
    network: loggedWallet.value.network === 'Mainnet' ? 'MAINNET' : 'PREPROD',
    selectAll: options?.selectAll,
    withdrawals: currentRewardWithdrawals(),
  };

  try {
    const { tx_cbor: txCborHex, estimated_fee } = await nexusTxApi.buildTransferTx(
      request,
      loggedWallet.value.network
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

const summaryRef = ref<InstanceType<typeof SummaryStep>>();

async function nextStep() {
  if (currentStep.value === 1) {
    if (!isValid.value) {
      shakeError.value = true;
      setTimeout(() => { shakeError.value = false; }, 600);
      return;
    }
    summaryRef.value?.scanTx(tx.value);
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
  isCalculatingMax.value = true;
  // Invalidate any previously built tx so a stale one can't be submitted if
  // the new build fails (e.g. user came back from the summary step and
  // re-clicked MAX). tx.value is repopulated only when build succeeds.
  txValid.value = false;
  tx.value = undefined;
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

  // For non-ADA tokens: just set to full balance, single build.
  // Use plain math for smallest-unit → decimal conversion — filters.toCurrency
  // rounds to max 2 decimals when decimalPlaces isn't 4 or 6, which would
  // over-commit tokens like AGIX (8 decimals, small balances).
  if (selectedToken.ticker !== nativeTicker.value) {
    const decimals = Number(selectedToken.decimals) || 0;
    selectedToken.quantity = decimals > 0
      ? Number(selectedToken.balance) / Math.pow(10, decimals)
      : Number(selectedToken.balance);
    try {
      const updated = { ...recipient, selectedTokens: sendTokensCopy };
      recipients.value.splice(recipientIdx, 1, updated);
      await buildTx();
    } catch { /* ignore */ }
    isCalculatingMax.value = false;
    return;
  }

  // ADA max: ask Nexus to compute precisely via /v1/tx/max-ada.
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

  const maxAdaRequest: MaxAdaRequest = {
    outputs: maxOutputs,
    changeAddress: keys.value.payment[0].address,
    utxos: (utxos.value as Cardano.Utxo[]).map(cardanoUtxoToNexusInput),
    network: loggedWallet.value.network === 'Mainnet' ? 'MAINNET' : 'PREPROD',
    withdrawals: currentRewardWithdrawals(),
  };

  try {
    // Step 1: get the max amount preview from /v1/tx/max-ada (for UI display)
    const maxResult = await nexusTxApi.calculateMaxAda(maxAdaRequest, loggedWallet.value.network);
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
      const buildOutputs = recipients.value
        .filter((r: SendRecipient) => {
          if (r.id === recipientId) return true;
          const addr = r.resolvedAddress ?? r.address;
          return !!addr && isPaymentAddress(addr);
        })
        .map((r: SendRecipient) => {
          if (r.id === recipientId) {
            const out = recipientToNexusOutput(r, loveOverride ?? '0');
            if (!out.address || !isPaymentAddress(out.address)) out.address = changeAddr;
            return out;
          }
          return recipientToNexusOutput(r);
        });

      const buildRequest: BuildTxRequest = {
        outputs: buildOutputs,
        changeAddress: changeAddr,
        utxos: (utxos.value as Cardano.Utxo[]).map(cardanoUtxoToNexusInput),
        network: loggedWallet.value.network === 'Mainnet' ? 'MAINNET' : 'PREPROD',
        selectAll: true,
        withdrawals: currentRewardWithdrawals(),
      };
      const { tx_cbor: txCborHex } = await nexusTxApi.buildTransferTx(buildRequest, loggedWallet.value.network);
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
      // Nexus sometimes disagrees with /v1/tx/max-ada about change min-UTxO
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
    debugLog('setMax: /v1/tx/max-ada failed:', err);
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

/** Send entire wallet: all tokens + NFTs are already added by the child, just trigger MAX ADA */
async function sendEntireWallet(recipientId: string) {
  // Wait for the child's emit to propagate
  await nextTick();

  // Authoritative fix: rebuild the recipient's outbound assets straight from
  // the on-chain UTxO set. Keep only ADA in selectedTokens (so max-ada fills
  // it), and put EVERY other asset in selectedCollectibles at its full UTxO
  // quantity. This sidesteps any drift between walletStore.tokens /
  // resolvedCollections / child state that would otherwise leave stragglers
  // in the change output.
  const idx = recipients.value.findIndex((r: SendRecipient) => r.id === recipientId);
  if (idx !== -1) {
    const recipient = recipients.value[idx];

    const totals = new Map<string, bigint>();
    for (const utxo of (utxos.value as Cardano.Utxo[])) {
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

    const fullCollectibles: Record<string, Collectible & { unit: string }> = {};
    for (const [unit, qty] of totals) {
      if (!unit || unit === 'lovelace') continue;
      const qtyNum = Number(qty);
      fullCollectibles[unit] = {
        unit,
        policy_id: unit.slice(0, 56),
        asset_name: unit.slice(56),
        fingerprint: '',
        quantity: qtyNum,
        toSendQuantity: qtyNum,
      } as Collectible & { unit: string };
    }

    recipients.value.splice(idx, 1, {
      ...recipient,
      selectedTokens: adaOnlyTokens,
      selectedCollectibles: fullCollectibles,
    });
    await nextTick();

    debugLog('sendEntireWallet: scanned', {
      utxoCount: (utxos.value as Cardano.Utxo[]).length,
      uniqueAssets: totals.size,
      tokensKeptInRecipient: adaOnlyTokens.length,
      collectiblesEmitted: Object.keys(fullCollectibles).length,
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

// Debounced build — avoids firing on every keystroke (e.g. typing "10" = "1" then "10")
const debouncedBuild = debounce(async () => {
  if (isCalculatingMax.value) return;

  const hasAnyAmount = recipients.value.some((r: SendRecipient) =>
    r.selectedTokens.some((t: Token) => Number(t.quantity) > 0) ||
    Object.keys(r.selectedCollectibles).length > 0
  );
  if (!hasAnyAmount) {
    txValid.value = false;
    return;
  }

  try {
    // When a MAX recipient is tracked, always force selectAll so Nexus uses
    // the same UTxO set as the auto-adjust path — prevents oscillation where
    // plain build picks a different subset and fails differently.
    const buildOpts = maxRecipientIds.value.size > 0 ? { selectAll: true } : undefined;
    await buildTx(buildOpts);
    txValid.value = true;
    recipients.value.forEach((r: SendRecipient) => { r.adaShortage = 0; });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('less than the minimum UTXO value') || msg.includes('OutputTooSmallUTxO')) {
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
        const shortage = Number(filters.toCurrency(parseInt(match[2], 10) - parseInt(match[1], 10), false, 6, '', '', false, 6).replaceAll(',', ''));
        recipients.value[0].adaShortage = shortage;
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
              utxos: (utxos.value as Cardano.Utxo[]).map(cardanoUtxoToNexusInput),
              network: loggedWallet.value.network === 'Mainnet' ? 'MAINNET' : 'PREPROD',
              withdrawals: currentRewardWithdrawals(),
            }, loggedWallet.value.network);
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
}, 500);

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
          const qty = token.quantity ? Math.floor(Number(token.quantity) * Math.pow(10, token.decimals || 0)) : 0;
          if (qty > 0) assetsMap.set(token.unit as Cardano.AssetId, BigInt(qty));
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

    // Async: debounced network call to build tx
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
/* ─── Content area ─── */
.send-dialog-content {
  z-index: 1;
  max-height: 500px;
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
  max-height: 480px;
  overflow-y: auto;
  overflow-x: hidden;
}

.add-recipient-link {
  text-align: center;
  padding: 4px 0 2px;
}

/* ─── Global total ─── */
.global-total {
  padding: 10px 12px;
  margin-top: 4px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
}

.global-total__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.global-total__label {
  font-size: 12px;
  font-weight: 600;
  color: #CECFD2;
}

.global-total__ada {
  font-size: 14px;
  font-weight: 600;
  color: #00DFF3;
}

.global-total__fiat {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  margin-left: 6px;
}

.global-total__fee-row {
  margin-bottom: 4px;
}

.global-total__total-row {
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.global-total__fee-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}

.global-total__fee {
  font-size: 11px;
  color: #FDA29B !important;
}

.global-total__withdrawal {
  font-size: 11px;
  color: #94CFA8;
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
  color: rgba(255, 255, 255, 0.7);
}

.empty-wallet-description {
  color: rgba(255, 255, 255, 0.4);
  max-width: 300px;
  margin: 0 auto;
}

/* ─── Midnight balance snapshot (in send-dialog Midnight branch) ─── */
.midnight-balance-snapshot {
  background: linear-gradient(135deg, rgba(0, 199, 243, 0.08) 0%, rgba(255, 216, 110, 0.06) 100%);
  border: 1px solid rgba(0, 199, 243, 0.2);
  border-radius: 10px;
  padding: 14px 16px;
  margin: 8px auto 0;
  min-width: 200px;
}

.midnight-snapshot-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 4px;
}

.midnight-snapshot-amount {
  font-family: 'Roboto Mono', monospace;
  font-size: 18px;
  font-weight: 600;
  color: #ffffff;
}

/* ─── Actions ─── */
.send-dialog-actions {
  text-align: center;
  justify-content: center;
}

/* ─── Buttons ─── */
.continue-button {
  background: linear-gradient(to right, #00c7f3, #00fad5);
  color: black;

  &:disabled {
    opacity: 0.5;
    color: black !important;
  }
}

/* ─── Stepper ─── */
.stepper-container {
  background-color: transparent;

  & .v-stepper__header {
    box-shadow: none;
  }

  .custom-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    padding: 2px;
    width: 68px;

    &.active .icon-container {
      box-shadow: 0 0 0 4px #00dff327;
    }

    &.next .icon-container {
      background-color: #292929;
    }

    .icon-container {
      background-color: #00dff3;
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
    color: #CECFD2;
  }

  .divider {
    flex: 1;
    height: 2px;
    width: 100%;
    margin-left: -38px;
    margin-right: -38px;
    margin-top: 11px;
    background-color: #292929;

    &.active-divider {
      background-color: #00dff3;
    }
  }
}

.v-stepper__content {
  padding: 0;
}

/* ─── Shake animation ─── */
.shake {
  animation: shake 0.4s ease-in-out;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-4px); }
  40%, 80% { transform: translateX(4px); }
}
</style>
