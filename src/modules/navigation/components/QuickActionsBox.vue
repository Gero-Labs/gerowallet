<template>
  <div>
    <div
      class="quick-actions-container"
      @mousemove="handleMouseMove"
      @mouseleave="handleMouseLeave"
    >
      <div v-if="!isBuyDisabled" class="action-button-wrapper">
        <v-btn
          ref="buyButton"
          class="expandable-button buy-button"
          color="#FFF59E1A"
          height="28"
          @click="currentDialog = dialogs.BUY"
          :style="getButtonGlowStyle('buy')"
        >
          <v-avatar tile size="14">
            <v-img
              :src="assets.dollarShieldSvg"
              alt="Buy"
              contain
            ></v-img>
          </v-avatar>
          <span class="button-text">Buy / Sell</span>
        </v-btn>
      </div>

      <div class="action-button-wrapper">
        <v-btn
          ref="sendButton"
          class="expandable-button send-button"
          color="#00DFF31A"
          height="28"
          @click="currentDialog = dialogs.SEND"
          :style="getButtonGlowStyle('send')"
        >
          <v-avatar tile size="14">
            <v-img
              :src="assets.sendSvg"
              alt="Send"
              contain
              style="filter: invert(83%) sepia(48%) saturate(3753%) hue-rotate(133deg) brightness(92%) contrast(108%);"
            ></v-img>
          </v-avatar>
          <span class="button-text">Send</span>
        </v-btn>
      </div>

      <div class="action-button-wrapper">
        <v-btn
          ref="receiveButton"
          class="expandable-button receive-button"
          color="#75E0A71A"
          height="28"
          @click="currentDialog = dialogs.RECEIVE"
          :style="getButtonGlowStyle('receive')"
        >
          <v-avatar tile size="14">
            <v-img
              :src="assets.qrCodeSvg"
              alt="Receive"
              contain
              style="filter: invert(83%) sepia(16%) saturate(992%) hue-rotate(92deg) brightness(94%) contrast(92%);"
            ></v-img>
          </v-avatar>
          <span class="button-text">Receive</span>
        </v-btn>
      </div>

      <div v-if="!isSwapDisabled" class="action-button-wrapper">
        <v-btn
          ref="swapButton"
          class="expandable-button swap-button"
          color="#FDA29B1A"
          height="28"
          @click="currentDialog = dialogs.SWAP"
          :style="getButtonGlowStyle('swap')"
        >
          <v-avatar tile size="14">
            <v-img
              :src="assets.swapSvg"
              alt="Swap"
              contain
              style="filter: invert(62%) sepia(76%) saturate(306%) hue-rotate(314deg) brightness(105%) contrast(98%);"
            ></v-img>
          </v-avatar>
          <span class="button-text">Swap</span>
        </v-btn>
      </div>

      <div v-if="!isPerpetualsDisabled" class="action-button-wrapper">
        <v-btn
          ref="perpetualsButton"
          class="expandable-button perpetuals-button"
          color="#B794F41A"
          height="28"
          @click="currentDialog = dialogs.PERPETUALS"
          :style="getButtonGlowStyle('perpetuals')"
        >
          <v-avatar tile size="14">
            <v-img
              :src="assets.barChart"
              alt="Perpetuals"
              contain
              style="filter: invert(66%) sepia(41%) saturate(458%) hue-rotate(226deg) brightness(95%) contrast(96%);"
            ></v-img>
          </v-avatar>
          <span class="button-text">Perpetuals</span>
        </v-btn>
      </div>
    </div>
    <ReceiveDialog :isOpen="currentDialog === dialogs.RECEIVE" @close="closeDialog"></ReceiveDialog>
    <SwapDialog v-if="!isSwapDisabled" :isOpen="currentDialog === dialogs.SWAP" @close="closeDialog"></SwapDialog>
    <BuyDialog v-if="!isBuyDisabled" :isOpen="currentDialog === dialogs.BUY" @close="closeDialog"></BuyDialog>
    <SendDialog :isOpen="currentDialog === dialogs.SEND" @close="closeDialog"></SendDialog>
    <PerpetualsDialog v-if="!isPerpetualsDisabled" :isOpen="currentDialog === dialogs.PERPETUALS" @close="closeDialog"></PerpetualsDialog>
  </div>
</template>
<script setup lang="ts">
import { toRefs, computed, ref, getCurrentInstance } from 'vue';
import ReceiveDialog from '@/modules/dashboard/dialogs/ReceiveDialog.vue';
import SwapDialog from '@/modules/dashboard/dialogs/SwapDialog.vue';
import SendDialog from '@/modules/dashboard/dialogs/SendDialog.vue';
import BuyDialog from '@/modules/dashboard/dialogs/BuyDialog.vue';
import PerpetualsDialog from '@/modules/dashboard/dialogs/PerpetualsDialog.vue';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';

const { loggedWallet } = toRefs(walletStore);
const vmProxy = getCurrentInstance()!.proxy as any

const currentDialog = ref(null);
const dialogs = ref<any>({
  SEND: 'SEND',
  RECEIVE: 'RECEIVE',
  SWAP: 'SWAP',
  BUY: 'BUY',
  PERPETUALS: 'PERPETUALS',
});

const mousePosition = ref<{x: number, y: number} | null>(null);
const buttonGlows = ref<Record<string, any>>({});

// Button refs
const buyButton = ref(null);
const sendButton = ref(null);
const receiveButton = ref(null);
const swapButton = ref(null);
const perpetualsButton = ref(null);

const isBuyDisabled = computed(() => {
  if (loggedWallet.value) {
    return !networks.resolveBuySupported(loggedWallet.value.chain, loggedWallet.value.network);
  }
  return true;
});

const isSwapDisabled = computed(() => {
  if (loggedWallet.value) {
    return !networks.resolveSwapSupport(loggedWallet.value?.chain, loggedWallet.value?.network);
  }
  return true;
})

const isPerpetualsDisabled = computed(() => {
  // Enable for Cardano mainnet and preprod for testing
  if (loggedWallet.value) {
    return !networks.resolvePerpetualsSupport(loggedWallet.value?.chain, loggedWallet.value?.network);
  }
  return true;
})

const closeDialog = () => {
  currentDialog.value = null;
}

const handleMouseMove = (event: MouseEvent) => {
  const container = event.currentTarget as HTMLElement;
  const containerRect = container.getBoundingClientRect();

  mousePosition.value = {
    x: event.clientX - containerRect.left,
    y: event.clientY - containerRect.top
  };

  updateButtonGlows();
}

const handleMouseLeave = () => {
  mousePosition.value = null;
  buttonGlows.value = {};
}

const updateButtonGlows = () => {
  if (!mousePosition.value) return;

  const buttons = ['buy', 'send', 'receive', 'swap', 'perpetuals'];
  const newGlows: Record<string, any> = {};

  buttons.forEach(buttonType => {
    const buttonRef = (vmProxy?.$refs as any)?.[`${buttonType}Button`];
    if (buttonRef && buttonRef.$el) {
      const buttonRect = buttonRef.$el.getBoundingClientRect();
      const containerRect = buttonRef.$el.closest('.quick-actions-container').getBoundingClientRect();

      // Check if mouse is directly over this button
      const mouseX = mousePosition.value!.x + containerRect.left;
      const mouseY = mousePosition.value!.y + containerRect.top;

      const isMouseOverButton = (
        mouseX >= buttonRect.left &&
        mouseX <= buttonRect.right &&
        mouseY >= buttonRect.top &&
        mouseY <= buttonRect.bottom
      );

      if (isMouseOverButton) {
        const buttonCenter = {
          x: buttonRect.left - containerRect.left + buttonRect.width / 2,
          y: buttonRect.top - containerRect.top + buttonRect.height / 2
        };

        const distance = Math.sqrt(
          Math.pow(mousePosition.value!.x - buttonCenter.x, 2) +
          Math.pow(mousePosition.value!.y - buttonCenter.y, 2)
        );

        const angleRad = Math.atan2(
          mousePosition.value!.y - buttonCenter.y,
          mousePosition.value!.x - buttonCenter.x
        );

        newGlows[buttonType] = {
          intensity: 0.8,
          angle: angleRad,
          distance: distance
        };
      }
    }
  });

  buttonGlows.value = newGlows;
}

const getButtonGlowStyle = (buttonType: string) => {
  const glow = buttonGlows.value[buttonType];
  if (!glow) return {};

  const colors: Record<string, string> = {
    buy: '#FFF59E',
    send: '#00DFF3',
    receive: '#75E0A7',
    swap: '#FDA29B',
    perpetuals: '#B794F4'
  };

  const color = colors[buttonType];
  const glowIntensity = glow.intensity;

  const offsetX = Math.cos(glow.angle) * 4 * glowIntensity;
  const offsetY = Math.sin(glow.angle) * 4 * glowIntensity;

  const shadowBlur = 8 + (glowIntensity * 12);
  const shadowSpread = glowIntensity * 2;

  return {
    boxShadow: `inset ${offsetX}px ${offsetY}px ${shadowBlur}px ${shadowSpread}px ${color}${Math.round(glowIntensity * 60).toString(16).padStart(2, '0')}`,
    transition: 'box-shadow 0.1s ease-out'
  };
}
</script>
<style scoped>
.quick-actions-container {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  height: 44px;
  min-width: 240px;
  width: max-content;
  border: 1px solid rgba(128,128,128,0.15);
  background-color: transparent!important;
  border-radius: 12px;
  padding: 8px;
  gap: 6px;
  align-items: center;
  justify-content: center;
  z-index: 5;
}

.action-button-wrapper {
  display: flex;
  align-content: center;
  text-align: center;
  flex-shrink: 0;
}

.expandable-button {
  min-width: auto !important;
  width: auto !important;
  padding: 0 12px 0 6px !important;
  border-radius: 6px !important;
  display: flex !important;
  justify-content: flex-start !important;
  align-items: center !important;
  position: relative;
  background: rgba(255, 255, 255, 0.08) !important;
  backdrop-filter: blur(20px) brightness(1.2) contrast(1.1);
  border: 0.5px solid rgba(255, 255, 255, 0.25) !important;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.12),
    0 1px 2px rgba(0, 0, 0, 0.08),
    inset 0 0 1px rgba(255, 255, 255, 0.3);
  overflow: hidden;
}


.expandable-button .v-btn__content {
  display: flex !important;
  align-items: center !important;
  justify-content: flex-start !important;
  width: 100% !important;
  position: relative;
  z-index: 10;
  backdrop-filter: none !important;
  filter: none !important;
}

.button-text {
  font-size: 12px;
  font-weight: 400;
  margin-left: 8px;
  white-space: nowrap;
  opacity: 1;
  backdrop-filter: none !important;
  filter: none !important;
  position: relative;
  z-index: 10;
}

.expandable-button .v-avatar {
  backdrop-filter: none !important;
  filter: none !important;
  position: relative;
  z-index: 10;
}

.expandable-button .v-img {
  backdrop-filter: none !important;
  filter: none !important;
}

/* Individual button color adjustments for text and liquid glass effects */
.buy-button {
  background: rgba(255, 245, 158, 0.12) !important;
  border: 0.5px solid rgba(255, 245, 158, 0.4) !important;
}


.buy-button .button-text {
  color: #FFF59E;
}

.send-button {
  background: rgba(0, 223, 243, 0.12) !important;
  border: 0.5px solid rgba(0, 223, 243, 0.4) !important;
}


.send-button .button-text {
  color: #00DFF3;
}

.receive-button {
  background: rgba(117, 224, 167, 0.12) !important;
  border: 0.5px solid rgba(117, 224, 167, 0.4) !important;
}


.receive-button .button-text {
  color: #75E0A7;
}

.swap-button {
  background: rgba(253, 162, 155, 0.12) !important;
  border: 0.5px solid rgba(253, 162, 155, 0.4) !important;
}


.swap-button .button-text {
  color: #FDA29B;
}

.perpetuals-button {
  background: rgba(183, 148, 244, 0.12) !important;
  border: 0.5px solid rgba(183, 148, 244, 0.4) !important;
}


.perpetuals-button .button-text {
  color: #B794F4;
}
</style>
