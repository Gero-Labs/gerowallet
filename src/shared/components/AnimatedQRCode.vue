<template>
  <div class="text-center" style="justify-self: center;">
    <div
      :style="{
        width: `${qrCodeSize}px`,
        height: `${qrCodeSize}px`,
        backgroundColor: 'white',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
        borderRadius: '12px'
      }"
    >
      <canvas ref="qrCodeCanvas" :width="qrCodeSize" :height="qrCodeSize"></canvas>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { UR, UREncoder } from '@keystonehq/keystone-sdk';
import QRCode from 'qrcode';

const props = defineProps({
  cbor: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true
  },
  interval: {
    type: Number,
    default: 100
  },
  capacity: {
    type: Number,
    default: 400
  },
  size: {
    type: Number,
    default: 350
  },
});

const currentQRCode = ref('');
const urEncoder = ref<UREncoder | null>(null);
const intervalId = ref<NodeJS.Timeout | null>(null);
const qrCodeCanvas = ref<HTMLCanvasElement | null>(null);

const qrCodeSize = computed(() => {
  return props.size;
});

const generateAnimatedQRCode = () => {
  console.log('[AnimatedQRCode] Generating QR with config:', {
    type: props.type,
    cborLength: props.cbor.length,
    capacity: props.capacity,
    interval: props.interval
  });

  try {
    // Create UR from raw cbor hex (not from reactive Vue object!)
    // This ensures we're working with a clean UR object, not wrapped by Vue's Observer
    const cborBuffer = Buffer.from(props.cbor, 'hex');
    console.log('[AnimatedQRCode] Creating fresh UR from cbor hex, buffer length:', cborBuffer.length);

    const ur = new UR(cborBuffer, props.type);
    console.log('[AnimatedQRCode] Fresh UR created:', ur);

    urEncoder.value = new UREncoder(ur, props.capacity);
    console.log('[AnimatedQRCode] UREncoder created, total parts:', urEncoder.value.fragmentsLength);

    currentQRCode.value = urEncoder.value.nextPart().toUpperCase();
    console.log('[AnimatedQRCode] First QR part:', currentQRCode.value.substring(0, 50) + '...');
    drawQRCode();
  } catch (error) {
    console.error('[AnimatedQRCode] Error generating QR:', error);
  }

  if (!intervalId.value) {
    intervalId.value = setInterval(() => {
      // Always update - UREncoder cycles through all parts
      currentQRCode.value = urEncoder.value!.nextPart().toUpperCase();
      drawQRCode();
    }, props.interval);
  }
};

const drawQRCode = () => {
  const canvas = qrCodeCanvas.value;
  if (!canvas) return;

  QRCode.toCanvas(
    canvas,
    currentQRCode.value,
    {
      width: qrCodeSize.value,
      margin: 5,
      errorCorrectionLevel: 'L',
      color: {
        dark: '#000000',
        light: '#ffffff00'
      }
    },
    (error) => {
      if (error) console.error('Error drawing QR code on canvas:', error);
    }
  );
};

onMounted(() => {
  generateAnimatedQRCode();
});

onUnmounted(() => {
  if (intervalId.value) {
    clearInterval(intervalId.value);
  }
});
</script>
