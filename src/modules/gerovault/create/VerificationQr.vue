<template>
  <figure class="verification-qr">
    <canvas ref="canvas" class="verification-qr__code" role="img" :aria-label="label" data-test="create-verify-qr" />
    <figcaption class="t-caption gvc-faint">{{ label }}</figcaption>
  </figure>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { drawVerificationQr } from './verificationQr';

const props = defineProps<{ payload: string; label: string }>();

const canvas = ref<HTMLCanvasElement | null>(null);

async function draw(): Promise<void> {
  if (!canvas.value || !props.payload) return;
  try {
    await drawVerificationQr(canvas.value, props.payload);
  } catch {
    // The number stays on screen; the code is the in-person shortcut only.
  }
}

onMounted(draw);
watch(() => props.payload, draw);
</script>

<style scoped>
.verification-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
  margin: 0;
}
.verification-qr__code {
  width: 200px;
  height: 200px;
  border-radius: var(--g-r-control);
}
</style>
