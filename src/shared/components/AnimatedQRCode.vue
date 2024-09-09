<template>
  <div>
    <h1>Vue Animated QR Code Example</h1>

    <!-- Single Canvas QR Code Display -->
    <div
      :style="{
        width: qrCodeSize,
        height: qrCodeSize,
        backgroundColor: 'white',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative' /* For overlay positioning */
      }"
    >
      <canvas ref="qrCodeCanvas" :width="qrCodeSize" :height="qrCodeSize" style="border-radius: 8px;"></canvas>
    </div>
  </div>
</template>

<script>
import { UR, UREncoder } from '@keystonehq/keystone-sdk';
import QRCode from 'qrcode';

export default {
  name: 'AnimatedQRCodeComponent',
  props: {
    cbor: {
      type: String,
      required: true
    },
    type: {
      type: String,
      required: true
    },
    options: {
      type: Object,
      default: () => ({ size: 200, capacity: 300, interval: 150 })
    }
  },
  data() {
    return {
      currentQRCode: '', // Holds the current QR code fragment
      intervalId: null, // Interval ID for clearing intervals
      urEncoder: null, // Instance of UREncoder
    };
  },
  computed: {
    qrCodeSize() {
      return this.options.size || 200;
    }
  },
  methods: {
    // Method to manage the QR code animation
    generateAnimatedQRCode() {
      const MAX_FRAGMENT_LENGTH = 400;
      const DEFAULT_INTERVAL = 100;

      this.urEncoder = new UREncoder(
        new UR(Buffer.from(this.cbor, 'hex'), this.type),
        this.options.capacity || MAX_FRAGMENT_LENGTH
      );

      // Generate the initial QR code fragment
      this.currentQRCode = this.urEncoder.nextPart().toUpperCase();
      this.drawQRCode(); // Draw the initial QR code

      // Update the QR code fragment periodically
      this.intervalId = setInterval(() => {
        const newQRCode = this.urEncoder.nextPart().toUpperCase();
        if (newQRCode !== this.currentQRCode) { // Only update if different
          this.currentQRCode = newQRCode;
          this.drawQRCode(); // Draw the QR code on canvas
        }
      }, this.options.interval || DEFAULT_INTERVAL);
    },
    // Draw the QR code directly on the canvas with custom styling
    drawQRCode() {
      const canvas = this.$refs.qrCodeCanvas;
      if (!canvas) return;

      // Use the `qrcode` library to draw on the canvas
      QRCode.toCanvas(
        canvas,
        this.currentQRCode,
        {
          width: this.qrCodeSize - 10,
          margin: 0,
          errorCorrectionLevel: 'H', // High error correction
          color: {
            dark: '#000000', // Customize the QR code color
            light: '#ffffff00' // Transparent background
          }
        },
        (error) => {
          if (error) console.error(error);
          this.customizeCanvas(canvas); // Apply custom styles
        }
      );
    },
    // Customize the canvas with additional styles
    customizeCanvas(canvas) {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Add gradient background
      const gradient = ctx.createLinearGradient(0, 0, this.qrCodeSize, this.qrCodeSize);
      gradient.addColorStop(0, '#ff9a9e');
      gradient.addColorStop(1, '#fad0c4');

      // Draw the gradient background
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw the QR code on top of the gradient
      ctx.globalCompositeOperation = 'destination-atop';
      QRCode.toCanvas(canvas, this.currentQRCode, {
        width: this.qrCodeSize - 10,
        margin: 0,
        errorCorrectionLevel: 'H',
        color: {
          dark: '#8defff', // Dark color for the QR code "dots"
          light: '#ffffff00' // Transparent background to let gradient show through
        }
      });
    }
  },
  mounted() {
    // Initialize animated QR code and set up canvas
    this.generateAnimatedQRCode(); // Start QR code animation
  },
  beforeDestroy() {
    // Clear the interval to prevent memory leaks
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
}
</script>
