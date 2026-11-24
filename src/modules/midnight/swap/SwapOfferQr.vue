<template>
  <div class="swap-qr">
    <!-- A QR code needs contrast: a justified solid (white), not glass. -->
    <div class="swap-qr__box" role="img" :aria-label="t('midnight.swap.share.qrAria')">
      <canvas v-if="single" ref="canvas" :width="size" :height="size" data-test="swap-qr-single"></canvas>
      <AnimatedQRCode v-else :cbor="urCbor" :type="SWAP_OFFER_UR_TYPE" :size="size" :capacity="400" :interval="200" data-test="swap-qr-animated" />
    </div>
    <span v-if="!single" class="t-caption">{{ t('midnight.swap.share.animated') }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import QRCode from 'qrcode';
import AnimatedQRCode from '@/shared/components/AnimatedQRCode.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { decodeSwapOffer, fitsOneQr, singleQrText, SWAP_OFFER_UR_TYPE, urBytesCbor } from '@/chains/midnight/midnightSwapOffer';

const props = withDefaults(defineProps<{ offer: string; size?: number }>(), { size: 216 });
const { t } = useTranslation();
const canvas = ref<HTMLCanvasElement | null>(null);

const single = computed(() => fitsOneQr(props.offer));
const urCbor = computed(() => (single.value ? '' : urBytesCbor(decodeSwapOffer(props.offer))));

function draw() {
  if (!single.value || !canvas.value) return;
  void QRCode.toCanvas(canvas.value, singleQrText(props.offer), {
    width: props.size,
    margin: 1,
    errorCorrectionLevel: 'L',
  }).catch(() => undefined);
}

onMounted(draw);
watch(() => props.offer, draw, { flush: 'post' });
</script>

<style scoped lang="scss">
.swap-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
}

.swap-qr__box {
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
  background: white;
  line-height: 0;
}
</style>
