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
    <!-- Empty wallet state -->
    <template v-if="isWalletEmpty">
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
      <v-card-title style="display: block;" class="py-0">
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
                  :recipient="recipient"
                  :index="idx"
                  :is-expanded="expandedRecipientId === recipient.id"
                  :can-delete="recipients.length > 1"
                  :show-header="true"
                  :available-tokens="availableTokensFor(recipient.id)"
                  :excluded-collectible-fingerprints="excludedFingerprintsFor(recipient.id)"
                  @expand="expandRecipient(recipient.id)"
                  @update:recipient="updateRecipient(recipient.id, $event)"
                  @duplicate="duplicateRecipient(recipient.id)"
                  @remove="removeRecipient(recipient.id)"
                  @setMax="setMax(recipient.id, $event.tokenIndex)"
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
            class="continue-button"
            @click="nextStep"
            :disabled="!isValid || txSignLoading"
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
import { WalletType } from '@/models/types';
import { Token, Collectible, SendRecipient } from '@/models/send-flow.types';
import networks from '@/utils/networks';
import filters from '@/shared/utils/filters';
import { isPaymentAddress } from '@/chrome/serialization';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
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

  const totalWithFee = totalAda + feeAda;
  const adaPrice = Number(walletStore.price?.lastPrice || 0);
  totalUsd = totalWithFee * adaPrice;

  return {
    ada: totalAda,
    fee: feeAda,
    totalWithFee,
    usd: totalUsd,
    formattedAda: totalAda > 0
      ? filters.toCurrency(totalAda * 1e6, false, 6, '\u20B3', '', false, 6)
      : '\u20B30',
    formattedTotal: totalWithFee > 0
      ? filters.toCurrency(totalWithFee * 1e6, false, 6, '\u20B3', '', false, 6)
      : '\u20B30',
    formattedFee,
    formattedUsd: totalUsd > 0
      ? `$${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '$0.00',
  };
});

/**
 * Build the transaction via Nexus backend (/v1/tx/build).
 * Server-side building gives us fresh protocol params, canonical fee calculation,
 * and coin selection without needing local tip/epochParams.
 */
async function buildTx() {
  const allValid = recipients.value.every((r: SendRecipient) =>
    isPaymentAddress(r.resolvedAddress ?? r.address)
  );
  if (!allValid) return;

  // Map recipients → Nexus output format
  const nexusOutputs = recipients.value.map((r: SendRecipient) => {
    const address = r.resolvedAddress ?? r.address;
    let lovelace = '0';
    const assets: NexusTxAsset[] = [];

    r.selectedTokens
      .filter((tk: Token) => tk && (tk.unit || tk.unit === '') && tk.decimals != null)
      .forEach((token: Token) => {
        const qty = BigInt(Math.floor(Number(token.quantity) * Math.pow(10, token.decimals)));
        if (token.ticker === nativeTicker.value) {
          lovelace = qty.toString();
        } else if (token.unit) {
          assets.push({
            policyId: token.unit.slice(0, 56),
            assetName: token.unit.slice(56),
            quantity: qty.toString(),
          });
        }
      });

    Object.values(r.selectedCollectibles).forEach((col: Collectible & { unit: string }) => {
      if (col.unit) {
        assets.push({
          policyId: col.unit.slice(0, 56),
          assetName: col.unit.slice(56),
          quantity: String(col.toSendQuantity || 1),
        });
      }
    });

    return { address, lovelace, assets: assets.length > 0 ? assets : undefined };
  });

  const request: BuildTxRequest = {
    outputs: nexusOutputs,
    changeAddress: keys.value.payment[0].address,
    utxos: (utxos.value as Cardano.Utxo[]).map(cardanoUtxoToNexusInput),
    network: loggedWallet.value.network === 'Mainnet' ? 'MAINNET' : 'PREPROD',
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
  const recipientIdx = recipients.value.findIndex((r: SendRecipient) => r.id === recipientId);
  if (recipientIdx === -1) { isCalculatingMax.value = false; return; }

  const recipient = recipients.value[recipientIdx];
  const sendTokensCopy = JSON.parse(JSON.stringify(recipient.selectedTokens));
  const selectedToken = sendTokensCopy[tokenIndex];
  if (!selectedToken) { isCalculatingMax.value = false; return; }

  // For non-ADA tokens: just set to full balance, single build
  if (selectedToken.ticker !== nativeTicker.value) {
    if (selectedToken.decimals) {
      selectedToken.quantity = Number(
        filters.toCurrency(sendTokensCopy[tokenIndex].balance, false, sendTokensCopy[tokenIndex].decimals, '', '', false, sendTokensCopy[tokenIndex].decimals).replaceAll(',', '')
      );
    } else {
      selectedToken.quantity = Number(selectedToken.balance);
    }
    try {
      const updated = { ...recipient, selectedTokens: sendTokensCopy };
      recipients.value.splice(recipientIdx, 1, updated);
      await buildTx();
    } catch { /* ignore */ }
    isCalculatingMax.value = false;
    return;
  }

  // ADA max: ask Nexus to compute precisely via /v1/tx/max-ada.
  // Nexus selects ALL UTxOs, computes fee + change min UTxO for native tokens,
  // and returns the exact maximum sendable amount.
  const otherAdaLovelace = recipients.value
    .filter((r: SendRecipient) => r.id !== recipientId)
    .reduce((sum: bigint, r: SendRecipient) => {
      const ada = r.selectedTokens.find((tk: Token) => tk.ticker === nativeTicker.value);
      return sum + BigInt(Math.floor(Number(ada?.quantity || 0) * 1_000_000));
    }, BigInt(0));

  // Get the recipient address (needed for Nexus to compute output size → fee)
  const recipientAddress = recipient.resolvedAddress ?? recipient.address;

  const maxAdaRequest: MaxAdaRequest = {
    destinationAddress: recipientAddress,
    changeAddress: keys.value.payment[0].address,
    utxos: (utxos.value as Cardano.Utxo[]).map(cardanoUtxoToNexusInput),
    network: loggedWallet.value.network === 'Mainnet' ? 'MAINNET' : 'PREPROD',
  };

  try {
    const maxResult = await nexusTxApi.calculateMaxAda(maxAdaRequest, loggedWallet.value.network);
    const maxLovelace = BigInt(maxResult.max_lovelace) - otherAdaLovelace;
    const changeMinUtxo = BigInt(maxResult.change_min_utxo);

    debugLog('setMax: Nexus max =', Number(maxLovelace) / 1_000_000, 'ADA (fee:', Number(maxResult.estimated_fee) / 1_000_000, ', changeMin:', Number(changeMinUtxo) / 1_000_000, ')');

    if (maxLovelace <= BigInt(0)) { isCalculatingMax.value = false; return; }

    const maxQty = Number(maxLovelace) / 1_000_000;
    const finalTokens = [...recipients.value[recipientIdx].selectedTokens];
    finalTokens[tokenIndex] = { ...finalTokens[tokenIndex], quantity: String(maxQty) };
    const finalRecipient = { ...recipients.value[recipientIdx], selectedTokens: finalTokens };
    if (changeMinUtxo > BigInt(0)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (finalRecipient as any).lockedForTokens = Number(changeMinUtxo) / 1_000_000;
    }
    recipients.value.splice(recipientIdx, 1, finalRecipient);

    // Build the actual tx with the max amount
    try { await buildTx(); } catch { /* keep the amount — Nexus computed it, it should be valid */ }
  } catch (err) {
    debugLog('setMax: /v1/tx/max-ada failed:', err);
  }

  isCalculatingMax.value = false;
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
    await buildTx();
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
    }
    txValid.value = false;
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
          const mockOut: Cardano.TxOut = {
            address: addr as Cardano.PaymentAddress,
            value: { coins: BigInt(0) as Cardano.Lovelace, assets: assetsMap }
          };
          const minAdaLovelace = BrowserTxConstruction.minAdaRequired(mockOut, BigInt(epochParams.value.coinsPerUtxoByte));
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
  padding: 8px 16px 4px;
}

.step-recipients-inner {
  width: 60%;
  min-width: 340px;
  max-width: 480px;
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
  color: rgba(255, 255, 255, 0.5);
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
    width: 120px;

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
    margin-left: -60px;
    margin-right: -60px;
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
</style>
