<template>
  <v-dialog v-model="dialog" max-width="600px" persistent>
    <v-card>
      <v-card-title class="text-h5">
        {{ $t('receive.receiveTitle') }}
        <v-spacer></v-spacer>
        <v-btn icon @click="closeDialog">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-card-text>
        <!-- Address Type Selector -->
        <v-select
          v-model="selectedAddressType"
          :items="addressTypeOptions"
          :label="$t('receive.addressType')"
          outlined
          dense
          class="mb-4"
          attach
          @change="updateAddress"
        >
          <template v-slot:selection="{ item }">
            <v-chip small>{{ item.text }}</v-chip>
          </template>
        </v-select>

        <!-- Address Display -->
        <v-card outlined class="mb-4">
          <v-card-text>
            <div class="text-caption mb-2">{{ $t('receive.yourAddress') }}</div>
            <div class="d-flex align-center">
              <div class="text-body-2 monospace flex-grow-1" style="word-break: break-all;">
                {{ currentAddress }}
              </div>
              <v-btn icon @click="copyAddress" class="ml-2">
                <v-icon>{{ copiedAddress ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
              </v-btn>
            </div>
          </v-card-text>
        </v-card>

        <!-- QR Code Display -->
        <v-card outlined class="mb-4">
          <v-card-text class="text-center">
            <div ref="qrCodeContainer" class="qr-code-container"></div>
            <div v-if="amountInSats > 0" class="text-caption mt-2">
              {{ $t('receive.amountIncluded') }}: {{ formatBtc(amountInSats) }} BTC
            </div>
          </v-card-text>
        </v-card>

        <!-- Optional Amount -->
        <v-expansion-panels v-model="showAmountPanel" flat>
          <v-expansion-panel>
            <v-expansion-panel-header>
              {{ $t('receive.specifyAmount') }} ({{ $t('common.optional') }})
            </v-expansion-panel-header>
            <v-expansion-panel-content>
              <v-text-field
                v-model="amountBtc"
                :label="$t('receive.amount') + ' (BTC)'"
                type="number"
                step="0.00000001"
                outlined
                dense
                @input="updateQrCode"
              >
                <template v-slot:append>
                  <span class="text-caption">BTC</span>
                </template>
              </v-text-field>

              <div v-if="amountInSats > 0" class="text-caption">
                ≈ {{ amountInSats.toLocaleString() }} satoshis
              </div>
            </v-expansion-panel-content>
          </v-expansion-panel>
        </v-expansion-panels>

        <!-- Optional Label/Message -->
        <v-expansion-panels v-model="showLabelPanel" flat class="mt-2">
          <v-expansion-panel>
            <v-expansion-panel-header>
              {{ $t('receive.addLabel') }} ({{ $t('common.optional') }})
            </v-expansion-panel-header>
            <v-expansion-panel-content>
              <v-text-field
                v-model="label"
                :label="$t('receive.label')"
                outlined
                dense
                counter="50"
                maxlength="50"
                @input="updateQrCode"
              ></v-text-field>

              <v-text-field
                v-model="message"
                :label="$t('receive.message')"
                outlined
                dense
                counter="100"
                maxlength="100"
                @input="updateQrCode"
              ></v-text-field>
            </v-expansion-panel-content>
          </v-expansion-panel>
        </v-expansion-panels>

        <!-- Address Index Navigation -->
        <v-card outlined class="mt-4">
          <v-card-text>
            <div class="d-flex align-center justify-space-between">
              <div class="text-caption">
                {{ $t('receive.addressIndex') }}: {{ currentAddressIndex }}
              </div>
              <div>
                <v-btn
                  icon
                  small
                  @click="previousAddress"
                  :disabled="currentAddressIndex === 0"
                >
                  <v-icon>mdi-chevron-left</v-icon>
                </v-btn>
                <v-btn icon small @click="nextAddress">
                  <v-icon>mdi-chevron-right</v-icon>
                </v-btn>
              </div>
            </div>
          </v-card-text>
        </v-card>

        <!-- Info -->
        <v-alert type="info" outlined dense class="mt-4">
          <div class="text-caption">
            {{ getAddressTypeDescription(selectedAddressType) }}
          </div>
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-btn text @click="shareAddress" v-if="canShare">
          <v-icon left>mdi-share-variant</v-icon>
          {{ $t('receive.share') }}
        </v-btn>
        <v-spacer></v-spacer>
        <v-btn color="primary" @click="closeDialog">
          {{ $t('common.close') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import QRCodeStyling from 'qr-code-styling';
import { deriveBitcoinAddress } from '@/chains/bitcoin/bitcoinKeyManager';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

// Props
const props = defineProps<{
  value: boolean;
}>();

const emit = defineEmits<{
  (e: 'input', value: boolean): void;
}>();

// Dialog state
const dialog = computed({
  get: () => props.value,
  set: (val) => emit('input', val),
});

// Address state
const selectedAddressType = ref('segwit');
const currentAddressIndex = ref(0);
const currentAddress = ref('');

// QR code
const qrCodeContainer = ref<HTMLElement | null>(null);
let qrCode: QRCodeStyling | null = null;

// Amount and label
const showAmountPanel = ref<number | undefined>(undefined);
const showLabelPanel = ref<number | undefined>(undefined);
const amountBtc = ref('');
const label = ref('');
const message = ref('');

// UI state
const copiedAddress = ref(false);

// Address type options
const addressTypeOptions = computed(() => [
  {
    text: `${t('receive.segwit')} (bc1q...) - ${t('receive.recommended')}`,
    value: 'segwit',
  },
  {
    text: `${t('receive.legacy')} (1...)`,
    value: 'legacy',
  },
  {
    text: `${t('receive.taproot')} (bc1p...)`,
    value: 'taproot',
  },
]);

// Computed amount in satoshis
const amountInSats = computed(() => {
  const amount = parseFloat(amountBtc.value);
  if (isNaN(amount) || amount <= 0) return 0;
  return Math.round(amount * 100000000);
});

// Check if Web Share API is available
const canShare = computed(() => {
  return typeof navigator !== 'undefined' && 'share' in navigator;
});

/**
 * Derive Bitcoin address for current index and type
 */
function deriveAddress(): void {
  if (!loggedWallet.value || !loggedWallet.value.publicKey) {
    console.error('No logged wallet or public key');
    return;
  }

  try {
    const address = deriveBitcoinAddress(
      loggedWallet.value.publicKey, // xpub
      loggedWallet.value.network,
      selectedAddressType.value,
      0, // External chain (receive addresses)
      currentAddressIndex.value
    );

    currentAddress.value = address;
    console.log(`Derived ${selectedAddressType.value} address:`, address);
  } catch (error) {
    console.error('Failed to derive Bitcoin address:', error);
    currentAddress.value = 'Error deriving address';
  }
}

/**
 * Update address when type or index changes
 */
function updateAddress(): void {
  deriveAddress();
  nextTick(() => {
    updateQrCode();
  });
}

/**
 * Generate Bitcoin URI for QR code
 * Format: bitcoin:ADDRESS?amount=AMOUNT&label=LABEL&message=MESSAGE
 */
function generateBitcoinUri(): string {
  let uri = `bitcoin:${currentAddress.value}`;
  const params: string[] = [];

  if (amountInSats.value > 0) {
    const btcAmount = (amountInSats.value / 100000000).toFixed(8);
    params.push(`amount=${btcAmount}`);
  }

  if (label.value) {
    params.push(`label=${encodeURIComponent(label.value)}`);
  }

  if (message.value) {
    params.push(`message=${encodeURIComponent(message.value)}`);
  }

  if (params.length > 0) {
    uri += '?' + params.join('&');
  }

  return uri;
}

/**
 * Update QR code
 */
function updateQrCode(): void {
  if (!qrCodeContainer.value) return;

  const uri = generateBitcoinUri();

  if (qrCode) {
    qrCode.update({ data: uri });
  } else {
    qrCode = new QRCodeStyling({
      width: 300,
      height: 300,
      data: uri,
      dotsOptions: {
        color: '#000000',
        type: 'rounded',
      },
      backgroundOptions: {
        color: '#ffffff',
      },
      cornersSquareOptions: {
        type: 'extra-rounded',
      },
      imageOptions: {
        crossOrigin: 'anonymous',
        margin: 10,
      },
    });

    // Clear container and append QR code
    qrCodeContainer.value.innerHTML = '';
    qrCode.append(qrCodeContainer.value);
  }
}

/**
 * Copy address to clipboard
 */
async function copyAddress(): Promise<void> {
  try {
    await navigator.clipboard.writeText(currentAddress.value);
    copiedAddress.value = true;
    setTimeout(() => {
      copiedAddress.value = false;
    }, 2000);
  } catch (error) {
    console.error('Failed to copy address:', error);
  }
}

/**
 * Share address using Web Share API
 */
async function shareAddress(): Promise<void> {
  if (!canShare.value) return;

  try {
    const uri = generateBitcoinUri();
    await navigator.share({
      title: t('receive.shareTitle'),
      text: `${t('receive.myBitcoinAddress')}: ${currentAddress.value}`,
      url: uri,
    });
  } catch (error) {
    // User cancelled or error occurred
    console.log('Share cancelled or failed:', error);
  }
}

/**
 * Navigate to previous address
 */
function previousAddress(): void {
  if (currentAddressIndex.value > 0) {
    currentAddressIndex.value--;
    updateAddress();
  }
}

/**
 * Navigate to next address
 */
function nextAddress(): void {
  currentAddressIndex.value++;
  updateAddress();
}

/**
 * Get address type description
 */
function getAddressTypeDescription(type: string): string {
  switch (type) {
    case 'segwit':
      return t('receive.segwitDescription');
    case 'legacy':
      return t('receive.legacyDescription');
    case 'taproot':
      return t('receive.taprootDescription');
    default:
      return '';
  }
}

/**
 * Format satoshis to BTC
 */
function formatBtc(satoshis: number): string {
  return (satoshis / 100000000).toFixed(8);
}

/**
 * Close dialog
 */
function closeDialog(): void {
  dialog.value = false;
}

// Watch for dialog open
watch(dialog, (newVal) => {
  if (newVal) {
    // Reset state
    selectedAddressType.value = loggedWallet.value?.addressType || 'segwit';
    currentAddressIndex.value = 0;
    amountBtc.value = '';
    label.value = '';
    message.value = '';
    showAmountPanel.value = undefined;
    showLabelPanel.value = undefined;

    // Derive initial address
    deriveAddress();

    // Generate QR code after DOM updates
    nextTick(() => {
      updateQrCode();
    });
  }
});

// Initialize on mount
onMounted(() => {
  if (dialog.value) {
    deriveAddress();
    nextTick(() => {
      updateQrCode();
    });
  }
});
</script>

<style scoped>
.monospace {
  font-family: 'Courier New', monospace;
}

.qr-code-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 300px;
}

.qr-code-container >>> canvas {
  max-width: 100%;
  height: auto;
}
</style>
