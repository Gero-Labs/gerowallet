<template>
  <BottomSheet :value="value" @input="$emit('input', $event)" :title="$t('miniGero.receiveAda')" height="75%">
    <div class="receive-sheet">
      <!-- Midnight: Public / Private / DUST address tabs -->
      <div v-if="isMidnight" class="midnight-tab-strip">
        <v-tabs
          v-model="midnightTab"
          background-color="transparent"
          :color="primaryColor"
          :slider-color="primaryColor"
          centered
          dense
        >
          <v-tab>{{ $t('midnight.common.public') }}</v-tab>
          <v-tab>{{ $t('midnight.common.private') }}</v-tab>
          <v-tab>{{ $t('midnight.receive.tabDust') }}</v-tab>
        </v-tabs>
      </div>

      <!-- QR Code -->
      <div class="qr-container">
        <div class="qr-wrapper">
          <canvas v-show="receiveAddress" ref="qrCanvas" />
          <div v-if="!receiveAddress" class="qr-empty">
            <v-icon size="28" color="var(--g-text-3)">mdi-qrcode-remove</v-icon>
          </div>
        </div>
      </div>

      <!-- Address display -->
      <div class="address-section">
        <div class="text-caption grey--text mb-2">{{ addressLabel }}</div>
        <div v-if="receiveAddress" class="address-box" @click="copyAddress">
          <span class="address-text">{{ receiveAddress }}</span>
          <v-icon small :color="primaryColor" class="ml-2">mdi-content-copy</v-icon>
        </div>
        <div v-else class="address-box address-box--empty">
          <span class="address-text address-text--muted">{{ $t('midnight.receive.pendingSdk') }}</span>
        </div>
      </div>

      <!-- Copy button -->
      <v-btn
        v-if="receiveAddress"
        block
        :color="primaryColor"
        class="mt-4 black--text font-weight-bold"
        @click="copyAddress"
      >
        <v-icon left small>mdi-content-copy</v-icon>
        {{ copied ? $t('miniGero.copied') : $t('miniGero.copyAddress') }}
      </v-btn>

      <div class="text-caption grey--text text-center mt-3">
        {{ addressInfo }}
      </div>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import BottomSheet from '../BottomSheet.vue';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { useChainContext } from '../../composables/useChainContext';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();
const { themeColors, isMidnight } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const props = defineProps<{
  value: boolean;
}>();

defineEmits<{
  (e: 'input', value: boolean): void;
}>();

const qrCanvas = ref<HTMLCanvasElement | null>(null);
const copied = ref(false);
const midnightTab = ref(0);

// Mirror rule: read straight from midnightStore.addresses (same fields the
// dashboard ReceiveDialog uses) - never an alternate source. Reuses WP5's
// i18n keys for labels/info verbatim.
const midnightAddressTabs = computed(() => {
  const addrs = midnightStore.addresses;
  return [
    { label: t('midnight.receive.publicLabel'), value: addrs.unshielded ?? '', info: t('midnight.receive.publicInfo') },
    { label: t('midnight.receive.privateLabel'), value: addrs.shielded ?? '', info: t('midnight.receive.privateInfo') },
    { label: t('midnight.receive.dustLabel'), value: addrs.dust ?? '', info: t('midnight.receive.dustInfo') },
  ];
});

const activeMidnightTab = computed(() => midnightAddressTabs.value[midnightTab.value] ?? midnightAddressTabs.value[0]);

const receiveAddress = computed(() => {
  if (isMidnight.value) {
    return activeMidnightTab.value.value;
  }
  // Use the first payment address (matches dashboard ReceiveDialog behavior)
  const keys = walletStore.keys;
  if (keys?.payment?.length > 0) {
    return keys.payment[0]?.address || '';
  }
  return '';
});

const addressLabel = computed(() => isMidnight.value ? activeMidnightTab.value.label : t('miniGero.yourAddress'));
const addressInfo = computed(() => isMidnight.value ? activeMidnightTab.value.info : t('miniGero.shareAddress'));

// Generate QR code when sheet opens and address is available
watch([() => props.value, receiveAddress], async ([isOpen, addr]) => {
  if (isOpen && addr) {
    await nextTick();
    generateQrCode(addr);
  }
}, { immediate: true });

// Reset to the Public tab each time the sheet is dismissed.
watch(() => props.value, (open) => {
  if (!open) midnightTab.value = 0;
});

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
  background: var(--g-raised);
  border-radius: var(--g-r-sheet);
  padding: 16px;
  border: 1px solid var(--g-hairline-1);
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 220px;
  min-height: 220px;
  box-sizing: border-box;
}

.qr-wrapper canvas {
  display: block;
  border-radius: var(--g-r-control);
}

.qr-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.midnight-tab-strip {
  width: 100%;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--g-hairline-1);
}

.address-section {
  width: 100%;
  text-align: center;
}

.address-box {
  background: var(--g-raised);
  border-radius: var(--g-r-card);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1px solid var(--g-hairline-1);
  transition: border-color 0.2s;
}

.address-box:hover {
  border-color: var(--g-accent);
}

.address-box--empty {
  cursor: default;
  border-style: dashed;
  border-color: var(--g-hairline-2);
}

.address-box--empty:hover {
  border-color: var(--g-hairline-2);
}

.address-text {
  color: var(--g-text-2);
  font-size: 12px;
  word-break: break-all;
  line-height: 1.5;
}

.address-text--muted {
  color: var(--g-text-3);
}
</style>
