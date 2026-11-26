<template>
  <!-- A QR code needs contrast: a justified solid (white), not glass. -->
  <div class="vault-qr" role="img" :aria-label="label">
    <canvas ref="canvas" :width="size" :height="size" data-test="vault-qr"></canvas>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import QRCode from 'qrcode';

defineOptions({ name: 'VaultQr' });

const props = withDefaults(defineProps<{ value: string; label: string; size?: number }>(), { size: 196 });
const canvas = ref<HTMLCanvasElement | null>(null);

function draw(): void {
  if (!canvas.value || !props.value) return;
  void QRCode.toCanvas(canvas.value, props.value, { width: props.size, margin: 1, errorCorrectionLevel: 'M' }).catch(() => undefined);
}

onMounted(draw);
watch(() => props.value, draw, { flush: 'post' });
</script>

<style scoped>
.vault-qr {
  display: inline-flex;
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
  background: white;
  line-height: 0;
}
</style>
