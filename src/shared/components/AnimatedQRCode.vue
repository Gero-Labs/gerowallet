<template>
  <div class="text-center">
    <div
      :style="{
        width: `${qrCodeSize}px`,
        height: `${qrCodeSize}px`,
        backgroundColor: 'white',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative'
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
    default: 250
  },
  capacity: {
    type: Number,
    default: 200
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
  console.log(props.type);
  urEncoder.value = new UREncoder(new UR(Buffer.from(props.cbor, 'hex'), props.type), props.capacity);

  currentQRCode.value = urEncoder.value.nextPart().toUpperCase();
  drawQRCode();
  console.log(props.capacity)

  if (!intervalId.value) {
    intervalId.value = setInterval(() => {
      const newQRCode = urEncoder.value!.nextPart().toUpperCase();
      if (newQRCode !== currentQRCode.value) {
        currentQRCode.value = newQRCode;
        drawQRCode();
      }
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
