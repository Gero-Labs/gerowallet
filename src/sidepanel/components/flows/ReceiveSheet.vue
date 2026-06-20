<template>
  <BottomSheet :value="value" @input="$emit('input', $event)" :title="$t('miniGero.receiveAda')" height="75%">
    <div class="receive-sheet">
      <!-- QR Code -->
      <div class="qr-container">
        <div class="qr-wrapper">
          <canvas ref="qrCanvas" />
        </div>
      </div>

      <!-- Address display -->
      <div class="address-section">
        <div class="text-caption grey--text mb-2">{{ $t('miniGero.yourAddress') }}</div>
        <div class="address-box" @click="copyAddress">
          <span class="address-text">{{ receiveAddress }}</span>
          <v-icon small :color="primaryColor" class="ml-2">mdi-content-copy</v-icon>
        </div>
      </div>

      <!-- Copy button -->
      <v-btn
        block
        :color="primaryColor"
        class="mt-4 black--text font-weight-bold"
        @click="copyAddress"
      >
        <v-icon left small>mdi-content-copy</v-icon>
        {{ copied ? $t('miniGero.copied') : $t('miniGero.copyAddress') }}
      </v-btn>

      <div class="text-caption grey--text text-center mt-3">
        {{ $t('miniGero.shareAddress') }}
      </div>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import BottomSheet from '../BottomSheet.vue';
import { walletStore } from '@/stores/walletStore';
import { useChainContext } from '../../composables/useChainContext';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const props = defineProps<{
  value: boolean;
}>();

defineEmits<{
  (e: 'input', value: boolean): void;
}>();

const qrCanvas = ref<HTMLCanvasElement | null>(null);
const copied = ref(false);

const receiveAddress = computed(() => {
  // Use the first payment address (matches dashboard ReceiveDialog behavior)
  const keys = walletStore.keys;
  if (keys?.payment?.length > 0) {
    return keys.payment[0]?.address || '';
  }
  return '';
});

// Generate QR code when sheet opens and address is available
watch([() => props.value, receiveAddress], async ([isOpen, addr]) => {
  if (isOpen && addr) {
    await nextTick();
    generateQrCode(addr);
  }
}, { immediate: true });

async function generateQrCode(address: string) {
  if (!qrCanvas.value) return;
  try {
    const QRCode = await import('qrcode');
    await QRCode.toCanvas(qrCanvas.value, address, {
      width: 220,
      margin: 2,
      color: {
        dark: '#ffffff',
        light: '#141414',
      },
    });
  } catch (e) {
    console.error('Failed to generate QR code:', e);
  }
}

function copyAddress() {
  if (!receiveAddress.value) return;
  navigator.clipboard.writeText(receiveAddress.value).then(() => {
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  }).catch(() => {});
}
</script>

<style scoped>
.receive-sheet {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: 16px;
}

.qr-container {
  display: flex;
  justify-content: center;
  padding: 24px 0 16px;
}

.qr-wrapper {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 16px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.qr-wrapper canvas {
  display: block;
  border-radius: 8px;
}

.address-section {
  width: 100%;
  text-align: center;
}

.address-box {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: border-color 0.2s;
}

.address-box:hover {
  border-color: var(--chain-primary);
}

.address-text {
  color: #e0e0e0;
  font-size: 12px;
  word-break: break-all;
  line-height: 1.5;
}
</style>
