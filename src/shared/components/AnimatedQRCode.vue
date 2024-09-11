<template>
  <div class="text-center">
    <!-- Single Canvas QR Code Display -->
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

<script>
import { UR, UREncoder } from '@keystonehq/keystone-sdk';
import QRCode from 'qrcode';

export default {
  name: 'AnimatedQRCode',
  props: {
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
  },
  data() {
    return {
      currentQRCode: '', // Holds the current QR code fragment
      urEncoder: null, // Instance of UREncoder
      intervalId: null, // Interval ID for managing timing
    };
  },
  computed: {
    qrCodeSize() {
      return this.size;
    }
  },
  methods: {
    generateAnimatedQRCode() {
      console.log(this.type);
      // Initialize UREncoder with the given CBOR data
      this.urEncoder = new UREncoder(new UR(Buffer.from(this.cbor, 'hex'), this.type), this.capacity);

      // Draw the first QR code fragment
      this.currentQRCode = this.urEncoder.nextPart().toUpperCase();
      this.drawQRCode();
      console.log(this.capacity)
      // Update QR code based on the interval
      if (!this.intervalId) {
        this.intervalId = setInterval(() => {
          const newQRCode = this.urEncoder.nextPart().toUpperCase();
          if (newQRCode !== this.currentQRCode) { // Only update if the QR code part changes
            this.currentQRCode = newQRCode;
            this.drawQRCode(); // Redraw the QR code
          }
        }, this.interval);
      }
    },

    drawQRCode() {
      const canvas = this.$refs.qrCodeCanvas;
      if (!canvas) return;

      // Use the `qrcode` library to draw the QR code on the canvas
      QRCode.toCanvas(
        canvas,
        this.currentQRCode,
        {
          width: this.qrCodeSize,
          margin: 5,
          errorCorrectionLevel: 'L', // Low error correction level
          color: {
            dark: '#000000', // Black QR code
            light: '#ffffff00' // Transparent background
          }
        },
        (error) => {
          if (error) console.error('Error drawing QR code on canvas:', error);
        }
      );
    },
  },
  mounted() {
    this.generateAnimatedQRCode(); // Start QR code animation on mount
  },
  beforeDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId); // Clear the interval when component is destroyed
    }
  }
}
</script>
