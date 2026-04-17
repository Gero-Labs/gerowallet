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
                    size="20"
                  >{{ currentStep > index + 1 ? 'mdi-check' : 'mdi-circle-medium' }}
                  </v-icon
                  >
                </div>
                <span class="step-label">{{ item.label }}</span>
              </div>
              <div class="divider" :class="{ 'active-divider': currentStep > index + 1 }" :key="index"
                   v-if="index < steps.length - 1"></div>
            </template>
          </v-stepper-header>
        </v-stepper>
      </v-card-title>
      <v-card-text class="px-3 pb-0 justify-center text-center send-dialog-content" :style="currentStep === 2 && loggedWallet?.type === WalletType.Normal ? { height: '442px'} : {}">
        <CustomStepper :currentStep="currentStep" :steps="steps">
          <v-stepper-content step="1">
            <div class="recipients-container" style="max-height: 440px; overflow-y: auto; padding: 4px 2px;">
              <SendRecipientCard
                v-for="(recipient, idx) in recipients"
                :key="recipient.id"
                :recipient="recipient"
                :index="idx"
                :is-expanded="expandedRecipientId === recipient.id"
                :can-delete="recipients.length > 1"
                :available-tokens="availableTokensFor(recipient.id)"
                :excluded-collectible-fingerprints="excludedFingerprintsFor(recipient.id)"
                @expand="expandRecipient(recipient.id)"
                @update:recipient="updateRecipient(recipient.id, $event)"
                @duplicate="duplicateRecipient(recipient.id)"
                @remove="removeRecipient(recipient.id)"
                @setMax="setMax(recipient.id, $event.tokenIndex)"
              />
              <div v-if="showAddLink" class="text-center mt-2">
                <v-btn text small color="#00DFF3" @click="addRecipient()">
                  <v-icon small class="mr-1">mdi-plus</v-icon>
                  {{ $t('wallet.addAnotherRecipient') }}
                </v-btn>
              </div>
            </div>
          </v-stepper-content>
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
      <v-card-actions class="text-center justify-center" :style="loggedWallet?.btSupported ? { display: 'block', height: '96px', alignContent: 'end'} : { flexFlow: 'column'}">
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
import { buildCardanoTransaction } from '@/shared/utils/builder';
import { BrowserTxConstruction } from '@/chrome/cardanoJsSdkCbor';
import { BackgroundResponse, Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
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
const { tip, epochParams } = toRefs(networkStore)

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

function addRecipient() {
  const r = createEmptyRecipient();
  recipients.value.push(r);
  expandedRecipientId.value = r.id;
}

function duplicateRecipient(id: string) {
  const src = recipients.value.find((r: SendRecipient) => r.id === id);
  if (!src) return;
  const duped: SendRecipient = {
    ...JSON.parse(JSON.stringify(src)),
    id: crypto.randomUUID(),
    resolvedAddress: src.resolvedAddress,
  };
  const idx = recipients.value.findIndex((r: SendRecipient) => r.id === id);
  recipients.value.splice(idx + 1, 0, duped);
  expandedRecipientId.value = duped.id;
}

function removeRecipient(id: string) {
  if (recipients.value.length <= 1) return;
  const idx = recipients.value.findIndex((r: SendRecipient) => r.id === id);
  recipients.value.splice(idx, 1);
  expandedRecipientId.value = recipients.value[Math.max(0, idx - 1)]?.id ?? null;
}

function expandRecipient(id: string) {
  expandedRecipientId.value = id;
}

const showAddLink = computed(() => {
  const last = recipients.value[recipients.value.length - 1];
  if (!last) return false;
  return !!(last.resolvedAddress || isPaymentAddress(last.address));
});

async function buildTx() {
  const allValid = recipients.value.every((r: SendRecipient) =>
    isPaymentAddress(r.resolvedAddress ?? r.address)
  );
  if (!allValid) return;

  // Proactive network data sync: If tip or epochParams are missing, trigger a fast REST sync
  if (!tip.value || !epochParams.value) {
    debugLog('⏳ Network data not available, triggering sync...');
    txValid.value = false;

    try {
      const response = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SYNC_VIA_REST,
        data: {}
      }) as BackgroundResponse<{ success: boolean; error?: string }>;

      if (!response.data.success) return;
      // Wait a moment for the store to be updated via messaging
      await new Promise(resolve => setTimeout(resolve, 100));
      if (!tip.value || !epochParams.value) return;
    } catch { return; }
  }

  const outputs: Cardano.TxOut[] = recipients.value.map((r: SendRecipient) => {
    const address = (r.resolvedAddress ?? r.address) as Cardano.PaymentAddress;
    const assetsMap = new Map<Cardano.AssetId, bigint>();
    let coinsAmount = BigInt(0);

    r.selectedTokens
      .filter((tk: Token) => tk && (tk.unit || tk.unit === '') && tk.decimals != null)
      .forEach((token: Token) => {
        const qty = BigInt(Math.floor(Number(token.quantity) * Math.pow(10, token.decimals)));
        if (token.ticker === nativeTicker.value) {
          coinsAmount = qty;
        } else {
          assetsMap.set(token.unit as Cardano.AssetId, qty);
        }
      });

    Object.values(r.selectedCollectibles).forEach((col: Collectible & { unit: string }) => {
      assetsMap.set(col.unit as Cardano.AssetId, BigInt(col.toSendQuantity || 0));
    });

    return {
      address,
      value: { coins: coinsAmount as Cardano.Lovelace, assets: assetsMap }
    };
  });

  try {
    tx.value = await buildCardanoTransaction({
      outputs,
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: loggedWallet.value.baseAddress,
      tip: tip.value,
      walletContext: {
        keys: keys.value,
        stakeAddress: loggedWallet.value.stakeAddress,
        accountIndex: 0
      }
    });
    txValid.value = true;
    debugLog('Built multi-output tx:', tx.value);
  } catch (e) {
    debugLog('buildTx error:', e);
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

async function setMax(recipientId: string, tokenIndex: number) {
  isCalculatingMax.value = true;
  const recipientIdx = recipients.value.findIndex((r: SendRecipient) => r.id === recipientId);
  if (recipientIdx === -1) { isCalculatingMax.value = false; return; }

  const recipient = recipients.value[recipientIdx];
  const sendTokensCopy = JSON.parse(JSON.stringify(recipient.selectedTokens));
  const selectedToken = sendTokensCopy[tokenIndex];
  if (!selectedToken) { isCalculatingMax.value = false; return; }

  const otherAda = recipients.value
    .filter((r: SendRecipient) => r.id !== recipientId)
    .reduce((sum: bigint, r: SendRecipient) => {
      const ada = r.selectedTokens.find((tk: Token) => tk.ticker === nativeTicker.value);
      return sum + BigInt(Math.floor(Number(ada?.quantity || 0) * 1_000_000));
    }, BigInt(0));

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
    } catch { /* ignore build errors during max search */ }
    isCalculatingMax.value = false;
    return;
  }

  const totalBalance = BigInt(selectedToken.balance) - otherAda;
  if (totalBalance <= BigInt(0)) { isCalculatingMax.value = false; return; }

  const ADA_STEP = BigInt(1_000_000);
  const MAX_BUFFER = BigInt(100_000_000);
  let buffer = BigInt(0);
  let coarseAmount = BigInt(0);

  while (buffer <= MAX_BUFFER) {
    const attempt = totalBalance - buffer;
    if (attempt <= BigInt(0)) break;
    selectedToken.quantity = Number(
      filters.toCurrency(Number(attempt), false, selectedToken.decimals, '', '', false, selectedToken.decimals).replaceAll(',', '')
    );
    try {
      const updated = { ...recipient, selectedTokens: sendTokensCopy };
      recipients.value.splice(recipientIdx, 1, updated);
      await buildTx();
      coarseAmount = attempt;
      break;
    } catch { buffer += ADA_STEP; }
  }

  if (coarseAmount === BigInt(0)) { isCalculatingMax.value = false; return; }

  let low = coarseAmount;
  let high = coarseAmount + ADA_STEP;
  if (high > totalBalance) high = totalBalance;
  let finalAmount = coarseAmount;

  for (let i = 0; i < 20 && high - low > BigInt(1); i++) {
    const mid = (low + high) / BigInt(2);
    selectedToken.quantity = Number(
      filters.toCurrency(Number(mid), false, selectedToken.decimals, '', '', false, selectedToken.decimals).replaceAll(',', '')
    );
    try {
      const updated = { ...recipient, selectedTokens: sendTokensCopy };
      recipients.value.splice(recipientIdx, 1, updated);
      await buildTx();
      finalAmount = mid;
      low = mid;
    } catch { high = mid; }
  }

  const finalQty = filters.toCurrency(Number(finalAmount), false, selectedToken.decimals, '', '', false, selectedToken.decimals).replaceAll(',', '');
  const finalRecipient = recipients.value[recipientIdx];
  const finalTokens = [...finalRecipient.selectedTokens];
  finalTokens[tokenIndex] = { ...finalTokens[tokenIndex], quantity: finalQty };
  recipients.value.splice(recipientIdx, 1, { ...finalRecipient, selectedTokens: finalTokens });

  await new Promise(resolve => setTimeout(resolve, 0));
  isCalculatingMax.value = false;
}

watch(() => props.isOpen, (val) => {
  if (val) {
    resetData();
  }
})

watch(
  () => recipients.value,
  async () => {
    if (isCalculatingMax.value) return;

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
  },
  { deep: true }
);

onMounted(() => {
  recipients.value = [createEmptyRecipient()];
  expandedRecipientId.value = recipients.value[0]?.id ?? null;
});
</script>
<style scoped>
.send-dialog-content {
  z-index: 1;
  min-height: 0;
  height: 490px;
  align-content: center;
}

/* 490px content + ~52px stepper header + ~48px card-actions = ~590px total */
.send-dialog-content--empty {
  height: 590px;
}

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

.titles {
  align-items: center;
  text-align: center;
  display: flex;
  flex-direction: column;
}

.arrow-left {
  cursor: pointer;
  position: absolute;
  top: 10px;
  left: 10px;
}

.continue-button {
  background: linear-gradient(to right, #00c7f3, #00fad5);
  color: black;

  &:disabled {
    opacity: 0.5;
    color: black !important;
  }

}
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
    padding: 5px;
    width: 150px;

    &.active .icon-container {
      box-shadow: 0 0 0 5px #00dff327;
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
      height: 24px;
      width: 24px;
      padding-left: 1px;
    }
  }

  .step-label {
    margin-top: 10px;
    font-size: 14px;
    line-height: 20px;
    text-align: center;
    font-weight: 600;
    color: #CECFD2;
  }

  .divider {
    flex: 1;
    height: 2px;
    width: 100%;
    margin-left: -75px;
    margin-right: -75px;
    margin-top: 16px;
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
