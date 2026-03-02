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
      <v-card-text class="px-3 pb-0 justify-center text-center send-dialog-content" :style="currentStep === 3 && loggedWallet?.type === WalletType.Normal ? { height: '442px'} : {}">
        <CustomStepper :currentStep="currentStep" :steps="steps">
          <v-stepper-content step="1">
            <SendRecipientDetailsStep
              :sendData="sendData"
              @updateRecipientAddress="updateRecipientAddress"
            ></SendRecipientDetailsStep>
          </v-stepper-content>
          <v-stepper-content step="2">
            <AssetsToSendStep
              v-model="sendData"
              @select="selectCollectible"
              :tokens="tokens"
              @setMax="setMax"
            ></AssetsToSendStep>
          </v-stepper-content>
          <v-stepper-content step="3">
            <SummaryStep ref="summaryRef" :sendData="sendData" :tx-data="tx" @next="handleSign" @prev="prevStep"></SummaryStep>
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
        <!-- Transaction Authentication Section (step 3 only) -->
        <div v-if="currentStep === 3">
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
          <!-- Steps 1-2: Continue button -->
          <v-btn
            v-if="currentStep !== 3"
            class="continue-button"
            @click="nextStep"
            :disabled="!isValid || txSignLoading"
            :loading="txSignLoading"
          >{{ $t('common.continue') + ' ' }}
            <v-icon style="color: black!important;" small class="ml-1">mdi-arrow-right</v-icon>
          </v-btn>
          <!-- Step 3: Sign/Confirm button for non-PRF wallets -->
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
import SendRecipientDetailsStep from '../components/SendRecipientDetailsStep.vue';
import AssetsToSendStep from '../components/AssetsToSendStep.vue';
import SummaryStep from '../components/SummaryStep.vue';
import rules from '@/utils/rules';
import { WalletType, Wallet } from '@/models/types';
import { Token, Collectible } from '@/models/send-flow.types';
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
const sendData = ref<{
  selectedTokens: (Token & { balance?: string | number; name?: string; img?: string })[];
  selectedCollectibles: Record<string, Collectible & { unit: string }>;
  recipientAddress: string;
  selectedWallet: Wallet | Record<string, never>;
  minAda: number;
  adaShortage: number;
}>({
  selectedTokens: [],
  selectedCollectibles: {},
  recipientAddress: '',
  selectedWallet: {},
  minAda: 0,
  adaShortage: 0
});
const txValid = ref<boolean>(false);
const steps = ref([
  {
    name: 'recipientDetails',
    label: t('wallet.recipientDetails'),
  },
  {
    name: 'assetsToSend',
    label: t('wallet.assetsToSend'),
  },
  {
    name: 'summary',
    label: t('wallet.summary'),
  },
]);
const tx = ref<Cardano.Tx | undefined>(undefined);
const isCalculatingMax = ref<boolean>(false);

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
    const tokens = (Object.values(resolvedAssets.value) as (Token & { metadata: { name: string; ticker: string; decimals: number }; img: string })[]).map(token => {
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
    tokens.sort((a,_b) => {
      if (a.ticker === nativeTicker.value) {
        return -1
      }
      return 0;
      // return (this.pinnedTokens.includes(a.unit) ? -1 : 1) || a.ticker.localeCompare(b.ticker) TODO
    })
    return tokens
  }
  return []
})

// walletStore.collections is typed as {} but at runtime each key is a policy ID
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
    const fn = rules.recipientRules(loggedWallet.value?.chain, loggedWallet.value?.network);
    return fn(sendData.value.recipientAddress) !== 'Invalid Payment Address'
  }
  if (currentStep.value === 2) {
    if (!txValid.value) {
      return false;
    }
    const hasZeroQuantity = (items: Token[] | Record<string, Collectible & { unit: string }>) => {
      // Handle both arrays and objects
      const itemsArray = Array.isArray(items) ? items : Object.values(items || {});
      return itemsArray.some((item: { quantity?: string | number; toSendQuantity?: number }) => Number(item.quantity) === 0 || Number(item.toSendQuantity) === 0);
    };
    return !(hasZeroQuantity(sendData.value.selectedTokens) || hasZeroQuantity(sendData.value.selectedCollectibles));
  }
  if (currentStep.value === 3) {
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
  resetState(); // Reset composable state (password, signing, loading, etc.)
  currentStep.value = 1;
  tx.value = undefined
  txValid.value = false
  const foundAsset = tokens.value.find(token => token.ticker === nativeTicker.value)
  if (foundAsset) {
    foundAsset.verified = true
  }
  sendData.value = {
    selectedTokens: foundAsset ? [foundAsset] : [],
    selectedCollectibles: {},
    recipientAddress: '',
    selectedWallet: loggedWallet.value,
    minAda: 0,
    adaShortage: 0
  };
}

async function buildTx(sendTokens: (Token & { balance?: string | number })[]) {
  if (!sendData.value.recipientAddress || !isPaymentAddress(sendData.value.recipientAddress)) {
    return
  }

  // Proactive network data sync: If tip or epochParams are missing, trigger a fast REST sync
  // This prevents race condition when user tries to send immediately after login
  if (!tip.value || !epochParams.value) {
    debugLog('⏳ Network data not available, triggering sync...');
    txValid.value = false;

    try {
      const response = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SYNC_VIA_REST,
        data: {}
      }) as BackgroundResponse<{ success: boolean; error?: string }>;

      if (response.data.success) {
        debugLog('✅ Network data synced successfully');
        // Wait a moment for the store to be updated via messaging
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check again if data is now available
        if (!tip.value || !epochParams.value) {
          console.warn('⚠️ Network data still not available after sync, will retry on next change');
          return;
        }
      } else {
        console.error('❌ Failed to sync network data:', response.data.error);
        return;
      }
    } catch (error) {
      console.error('❌ Error triggering sync:', error);
      return;
    }
  }

  const recipientAddress = sendData.value.recipientAddress;

  // Build asset map for Cardano JS SDK
  const assetsMap = new Map<Cardano.AssetId, bigint>();
  let coinsAmount = BigInt(0);

  if (sendTokens.length > 0) {
    sendTokens.filter(token => token && (token.unit || token.unit === '') && token.decimals != null).forEach(token => {
      const quantity = BigInt(Math.floor(Number(token.quantity) * Math.pow(10, token.decimals)));

      if (token.ticker === nativeTicker.value) {
        coinsAmount = quantity;
      } else {
        assetsMap.set(token.unit as Cardano.AssetId, quantity);
      }
    });
  }

  // selectedCollectibles is an object, convert to array
  const collectiblesArray = Object.values(sendData.value.selectedCollectibles);
  if (collectiblesArray.length > 0) {
    collectiblesArray.forEach(collectible => {
      assetsMap.set(collectible.unit as Cardano.AssetId, BigInt(collectible.toSendQuantity || 0));
    });
  }

  // Create output using Cardano JS SDK format
  const outputs: Cardano.TxOut[] = [{
    address: recipientAddress as Cardano.PaymentAddress,
    value: {
      coins: coinsAmount as Cardano.Lovelace,
      assets: assetsMap
    }
  }];

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

    // Don't reset minAda here - it's set by the watch based on selected NFTs
    sendData.value.adaShortage = 0;
    txValid.value = true;
    debugLog('Built transaction:', tx.value);
  } catch (e) {
    debugLog(e);
    throw e;
  }
}

const summaryRef = ref<InstanceType<typeof SummaryStep>>();

async function nextStep() {
  if (currentStep.value <= steps.value.length) {
    if (currentStep.value === 1) {
      currentStep.value++;
    } else if (currentStep.value === 2) {
      summaryRef.value?.scanTx(tx.value);
      currentStep.value++;
    } else if (currentStep.value === 3) {
      if (!isValid.value) return; // Guard Enter-key path against empty password
      await handleSign();
    }
  }
}

function prevStep() {
  if (currentStep.value > 1) {
    currentStep.value--;
  }
}

function updateRecipientAddress(address: string) {
  sendData.value.recipientAddress = address;
}

function selectCollectible(collectible: Collectible & { unit: string }) {
  debugLog('selectCollectible called:', collectible.name);
  if (collectible.name && sendData.value.selectedCollectibles[collectible.name]) {
    const { [collectible.name]: _, ...rest } = sendData.value.selectedCollectibles;
    sendData.value.selectedCollectibles = rest;
    debugLog('Removed collectible:', collectible.name);
  } else if (collectible.name) {
    sendData.value.selectedCollectibles = {
      ...sendData.value.selectedCollectibles,
      [collectible.name]: collectible
    };
    debugLog('Added collectible:', collectible.name);
  }
  debugLog('Current selectedCollectibles:', sendData.value.selectedCollectibles);
  debugLog('Object.values:', Object.values(sendData.value.selectedCollectibles));
}

async function setMax(index: number) {
  isCalculatingMax.value = true; // Disable watch while calculating max

  const sendTokensCopy = JSON.parse(JSON.stringify(sendData.value.selectedTokens));
  const selectedToken = sendTokensCopy[index];

  // For non-ADA tokens, just use the full balance
  if (selectedToken.ticker !== nativeTicker.value) {
    if (selectedToken.decimals) {
      selectedToken.quantity = Number(filters.toCurrency(sendTokensCopy[index].balance, false, sendTokensCopy[index].decimals, '', '', false, sendTokensCopy[index].decimals).replaceAll(",",""));
    } else {
      selectedToken.quantity = Number(selectedToken.balance);
    }
    await tryBuildMaxTx(sendTokensCopy, index);
    isCalculatingMax.value = false;
    return;
  }

  // For ADA, use two-phase approach: coarse search (1 ADA) then fine-tune (1 lovelace)
  const totalBalance = BigInt(selectedToken.balance);
  const ADA_STEP = BigInt(1_000_000); // 1 ADA steps for coarse search
  const MAX_BUFFER = BigInt(100_000_000); // Stop after 100 ADA buffer

  let buffer = BigInt(0);
  let coarseAmount = BigInt(0);

  // Phase 1: Coarse search with 1 ADA steps
  debugLog('Phase 1: Coarse search with 1 ADA steps...');
  while (buffer <= MAX_BUFFER) {
    const attemptAmount = totalBalance - buffer;

    if (attemptAmount <= BigInt(0)) {
      break;
    }

    if (selectedToken.decimals) {
      selectedToken.quantity = Number(filters.toCurrency(Number(attemptAmount), false, selectedToken.decimals, '', '', false, selectedToken.decimals).replaceAll(",",""));
    } else {
      selectedToken.quantity = Number(attemptAmount);
    }

    try {
      await buildTx(sendTokensCopy);
      // Success! Found a working amount
      coarseAmount = attemptAmount;
      debugLog(`✓ Coarse MAX found: ${Number(attemptAmount) / 1000000} ADA (buffer: ${Number(buffer) / 1000000} ADA)`);
      break;
    } catch (e) {
      // Failed - try 1 ADA less
      buffer += ADA_STEP;
    }
  }

  if (coarseAmount === BigInt(0)) {
    debugLog('Could not find working amount in coarse search');
    isCalculatingMax.value = false;
    return;
  }

  // Phase 2: Binary search fine-tuning (try to add up to 1 ADA back)
  debugLog('Phase 2: Binary search fine-tuning...');
  let low = coarseAmount;
  let high = coarseAmount + ADA_STEP;
  if (high > totalBalance) {
    high = totalBalance;
  }
  let finalAmount = coarseAmount;

  // Binary search with up to 20 iterations (enough for 1 lovelace precision in 1 ADA range)
  for (let iteration = 0; iteration < 20 && high - low > BigInt(1); iteration++) {
    const mid = (low + high) / BigInt(2);

    if (selectedToken.decimals) {
      selectedToken.quantity = Number(filters.toCurrency(Number(mid), false, selectedToken.decimals, '', '', false, selectedToken.decimals).replaceAll(",",""));
    } else {
      selectedToken.quantity = Number(mid);
    }

    try {
      await buildTx(sendTokensCopy);
      // Success! Try higher
      finalAmount = mid;
      low = mid;
      debugLog(`✓ Binary search: ${Number(mid) / 1000000} ADA works (range: ${Number(high - low)} lovelace)`);
    } catch (e) {
      // Failed - try lower
      high = mid;
      debugLog(`✗ Binary search: ${Number(mid) / 1000000} ADA failed (range: ${Number(high - low)} lovelace)`);
    }
  }

  debugLog(`✓ Final MAX found: ${Number(finalAmount) / 1000000} ADA (added ${Number(finalAmount - coarseAmount)} lovelace to coarse result)`);

  // Update the quantity and then immediately re-enable the watch
  // The watch will run once with the final amount
  // Convert to string to match CurrencyTextField prop type
  if (selectedToken.decimals) {
    sendData.value.selectedTokens[index].quantity = filters.toCurrency(Number(finalAmount), false, selectedToken.decimals, '', '', false, selectedToken.decimals).replaceAll(",","");
  } else {
    sendData.value.selectedTokens[index].quantity = String(Number(finalAmount));
  }

  // Re-enable watch AFTER setting the final amount
  // Wait a tick to ensure the update is processed
  await new Promise(resolve => setTimeout(resolve, 0));
  isCalculatingMax.value = false;
}

async function tryBuildMaxTx(tokens: (Token & { balance?: string | number })[], index: number) {
  try {
    await buildTx(tokens)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    debugLog('tryBuildMaxTx error:', errorMessage);

    if (errorMessage.includes('Insufficient input in transaction.')) {
      const match = errorMessage.match(/{ada in inputs: (\d+), ada in outputs: (\d+), fee (\d+)/);
      if (match) {
        const maxBalance = Number(match[2]) - Number(match[3])
        sendData.value.selectedTokens[index].quantity = `${Number(filters.toCurrency(maxBalance, false, 6, '', '', false, 6).replaceAll(",", ""))}`
      }
    } else if (errorMessage.includes('less than the minimum UTXO value')) {
      const match = errorMessage.match(/Value (\d+) less than the minimum UTXO value (\d+)/);
      if (match) {
        const adaMinBalance = match[2]
        const nativeToken = sendData.value.selectedTokens.find(token => token.ticker === nativeTicker.value)
        if (nativeToken) {
          nativeToken.quantity = `${Number(filters.toCurrency(adaMinBalance, false, 6, '', '', false, 6).replaceAll(",", ""))}`
          sendData.value.selectedTokens[index].quantity = `${Number(tokens[index].balance)}`
        }
      }
    } else if (errorMessage.includes('UTxO Fully Depleted')) {
      // When all UTXOs are depleted, we can't send the full balance
      // Reduce the amount by a small margin and try again
      const currentQty = Number(tokens[index].quantity);
      const reducedQty = currentQty * 0.95; // Reduce by 5%
      sendData.value.selectedTokens[index].quantity = `${reducedQty.toFixed(6)}`;
      debugLog('UTxO Fully Depleted - reduced amount to:', reducedQty);
    } else {
      console.error('Unhandled error in tryBuildMaxTx:', e);
    }
  }
}

watch(() => props.isOpen, (val) => {
  if (val) {
    resetData();
  }
})

// Watch only the properties that should trigger recalculation, not minAda itself
watch(() => ({
  selectedTokens: sendData.value.selectedTokens,
  selectedCollectibles: sendData.value.selectedCollectibles,
  recipientAddress: sendData.value.recipientAddress
}), async (val) => {
  // Skip if we're calculating max - the setMax function handles building the tx
  if (isCalculatingMax.value) {
    return;
  }

  try {
    // selectedCollectibles is an object, not an array
    const collectiblesArray = val.selectedCollectibles ? Object.values(val.selectedCollectibles) : [];
    if (!val.recipientAddress) {
      return;
    }

    // Calculate minimum ADA required for any assets (tokens or NFTs) if selected
    // Only count non-native assets (exclude ADA/tADA)
    const hasNonNativeAssets = collectiblesArray.length > 0 ||
      val.selectedTokens.some(token => token?.unit && token.ticker !== nativeTicker.value);

    if (hasNonNativeAssets && epochParams.value && val.recipientAddress) {
      try {
        debugLog('Calculating minAda for assets:', {
          collectibles: collectiblesArray.length,
          tokens: val.selectedTokens.filter(t => t?.unit).length
        });

        // Build the asset map for both collectibles and tokens
        const assetsMap = new Map<Cardano.AssetId, bigint>();

        // Add collectibles to assets map
        collectiblesArray.forEach((collectible) => {
          debugLog('Adding collectible:', collectible.unit, collectible.toSendQuantity);
          assetsMap.set(collectible.unit as Cardano.AssetId, BigInt(collectible.toSendQuantity || 0));
        });

        // Add tokens (non-ADA) to assets map
        // Only add tokens that are NOT the native currency (ADA/tADA)
        val.selectedTokens.forEach(token => {
          if (token?.unit && token.ticker !== nativeTicker.value) { // Skip ADA/native currency
            const quantity = token.quantity ? Math.floor(Number(token.quantity) * Math.pow(10, token.decimals || 0)) : 0;
            if (quantity > 0) {
              debugLog('Adding token:', token.unit, quantity);
              assetsMap.set(token.unit as Cardano.AssetId, BigInt(quantity));
            }
          }
        });

        debugLog('Assets map size:', assetsMap.size);
        debugLog('Recipient address:', val.recipientAddress);
        debugLog('coinsPerUtxoByte:', epochParams.value.coinsPerUtxoByte);

        // Create a mock output with all assets to calculate min ADA
        const mockOutput: Cardano.TxOut = {
          address: val.recipientAddress as Cardano.PaymentAddress,
          value: {
            coins: BigInt(0) as Cardano.Lovelace, // We're calculating the minimum, so start with 0
            assets: assetsMap
          }
        };

        debugLog('Mock output created with assets:', assetsMap.size);

        // Use the actual protocol function to calculate minimum ADA
        const minAdaLovelace = BrowserTxConstruction.minAdaRequired(
          mockOutput,
          BigInt(epochParams.value.coinsPerUtxoByte)
        );

        sendData.value.minAda = Number(minAdaLovelace) / 1000000;
        debugLog('Calculated minAda for all assets (accurate):', sendData.value.minAda, 'ADA');
      } catch (error) {
        console.error('Error calculating minAda:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : error);
        sendData.value.minAda = 0;
      }
    } else {
      sendData.value.minAda = 0;
    }

    await buildTx(val.selectedTokens)
    txValid.value = true
  } catch(e) {
    console.error('Build tx error:', e)
    const errorMessage = e instanceof Error ? e.message : String(e);
    debugLog('Error message:', errorMessage);

    if (errorMessage.includes('less than the minimum UTXO value') || errorMessage.includes('OutputTooSmallUTxO')) {
      const match = errorMessage.match(/minimum UTXO value (\d+)/);
      const number = match ? parseInt(match[1], 10) : null;
      if (number) {
        const errorMinAda = Number(filters.toCurrency(number, false, 6, '', '', false, 6).replaceAll(",", ""));
        debugLog('Transaction builder reported minAda:', errorMinAda, 'but we calculated:', sendData.value.minAda);
        // Only update if the error value is higher (more conservative)
        if (errorMinAda > sendData.value.minAda) {
          sendData.value.minAda = errorMinAda;
          debugLog('Updated minAda from error to:', sendData.value.minAda);
        }
      }
    } else if (errorMessage.includes('Insufficient input in transaction.')) {
      const match = errorMessage.match(/{ada in inputs: (\d+), ada in outputs: (\d+), fee (\d+)/);
      if (match) {
        const number = parseInt(match[2], 10) - parseInt(match[1], 10)
        sendData.value.adaShortage = Number(filters.toCurrency(number, false, 6, '', '', false, 6).replaceAll(",", ""))
        debugLog('Set adaShortage to:', sendData.value.adaShortage);
      }
    } else if (errorMessage.includes('UTxO Fully Depleted')) {
      // This can happen when trying to send all ADA - just mark as invalid, user needs to reduce amount
      debugLog('UTxO Fully Depleted - cannot build transaction with current amount');
    } else if (errorMessage.includes('Maximum Input Count Exceeded')) {
      // Wallet has too many small UTXOs - user needs to reduce the amount
      debugLog('Maximum Input Count Exceeded - wallet has too many small UTXOs, reduce amount');
    }
    txValid.value = false
  }
}, { deep: true })

onMounted(() => {
  if (resolvedAssets.value) {
    const adaAssetFound = (Object.values(resolvedAssets.value) as (Token & { metadata: { ticker: string } })[]).find(asset => asset.metadata.ticker === nativeTicker.value);
    if (adaAssetFound) {
      sendData.value.selectedTokens = [adaAssetFound];
    }
  }
})
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
