<template>
  <div>
    <div
      :class="['quick-actions-container', { 'compact': compact }]"
      @mousemove="handleMouseMove"
      @mouseleave="handleMouseLeave"
    >
      <div v-if="!isBuyDisabled" class="action-button-wrapper">
        <v-tooltip bottom :disabled="!compact" content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <v-btn
              ref="buyButton"
              :class="['expandable-button', 'buy-button', { 'icon-only': compact }]"
              color="#FFF59E1A"
              height="28"
              @click="openDialog(dialogs.BUY)"
              :style="getButtonGlowStyle('buy')"
              v-bind="attrs"
              v-on="on"
            >
              <v-avatar tile size="14">
                <v-img
                  :src="assets.dollarShieldSvg"
                  :alt="$t('common.buy')"
                  contain
                ></v-img>
              </v-avatar>
              <span v-if="!compact" class="button-text">{{ $t('navigation.buySell') }}</span>
            </v-btn>
          </template>
          <span>{{ $t('navigation.buySell') }}</span>
        </v-tooltip>
      </div>

      <div class="action-button-wrapper">
        <v-tooltip bottom :disabled="!compact" content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <v-btn
              ref="sendButton"
              :class="['expandable-button', 'send-button', { 'icon-only': compact }]"
              color="#00DFF31A"
              height="28"
              @click="openDialog(dialogs.SEND)"
              :style="getButtonGlowStyle('send')"
              v-bind="attrs"
              v-on="on"
            >
              <v-avatar tile size="14">
                <v-img
                  :src="assets.sendSvg"
                  :alt="$t('common.send')"
                  contain
                  style="filter: invert(83%) sepia(48%) saturate(3753%) hue-rotate(133deg) brightness(92%) contrast(108%);"
                ></v-img>
              </v-avatar>
              <span v-if="!compact" class="button-text">{{ $t('navigation.send') }}</span>
            </v-btn>
          </template>
          <span>{{ $t('navigation.send') }}</span>
        </v-tooltip>
      </div>

      <div class="action-button-wrapper">
        <v-tooltip bottom :disabled="!compact" content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <v-btn
              ref="receiveButton"
              :class="['expandable-button', 'receive-button', { 'icon-only': compact }]"
              color="#75E0A71A"
              height="28"
              @click="openDialog(dialogs.RECEIVE)"
              :style="getButtonGlowStyle('receive')"
              v-bind="attrs"
              v-on="on"
            >
              <v-avatar tile size="14">
                <v-img
                  :src="assets.qrCodeSvg"
                  :alt="$t('common.receive')"
                  contain
                  style="filter: invert(83%) sepia(16%) saturate(992%) hue-rotate(92deg) brightness(94%) contrast(92%);"
                ></v-img>
              </v-avatar>
              <span v-if="!compact" class="button-text">{{ $t('navigation.receive') }}</span>
            </v-btn>
          </template>
          <span>{{ $t('navigation.receive') }}</span>
        </v-tooltip>
      </div>
      <div v-if="isSwapSupportedByNetwork" class="action-button-wrapper">
        <v-tooltip bottom :disabled="!compact" content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <v-btn
              ref="swapButton"
              :class="['expandable-button', 'swap-button', { 'icon-only': compact }]"
              color="#FDA29B1A"
              height="28"
              @click="openDialog(dialogs.SWAP)"
              :style="getButtonGlowStyle('swap')"
              :disabled="!isSwapEnabledByFeatureFlag"
              :loading="loadingSwap"
              v-bind="attrs"
              v-on="on"
            >
              <v-avatar tile size="14">
                <v-img
                  :src="assets.swapSvg"
                  :alt="$t('swap.swap')"
                  contain
                  style="filter: invert(62%) sepia(76%) saturate(306%) hue-rotate(314deg) brightness(105%) contrast(98%);"
                ></v-img>
              </v-avatar>
              <span v-if="!compact" class="button-text">{{ $t('swap.swap') }}</span>
              <div v-if="!loadingSwap && !isSwapEnabledByFeatureFlag" class="ribbon top-right" aria-hidden="true">
                <span>{{ $t('common.off') }}</span>
              </div>
            </v-btn>
          </template>
          <span>{{ $t('swap.swap') }}</span>
        </v-tooltip>
      </div>
      <div v-if="!isPerpetualsDisabled" class="action-button-wrapper">
        <v-tooltip bottom :disabled="!compact" content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <v-btn
              ref="perpetualsButton"
              :class="['expandable-button', 'perpetuals-button', { 'icon-only': compact }]"
              color="#B794F41A"
              height="28"
              @click="openDialog(dialogs.PERPETUALS)"
              :style="getButtonGlowStyle('perpetuals')"
              :disabled="priceStore.connectionStatus !== 'connected'"
              :loading="priceStore.connectionStatus === 'connecting'"
              v-bind="attrs"
              v-on="on"
            >
              <v-avatar tile size="14">
                <v-img
                  :src="assets.barChart"
                  :alt="$t('perpetuals.perpetuals')"
                  contain
                  style="filter: invert(66%) sepia(41%) saturate(458%) hue-rotate(226deg) brightness(95%) contrast(96%);"
                ></v-img>
              </v-avatar>
              <span v-if="!compact" class="button-text">{{ $t('perpetuals.perpetuals') }}</span>
              <div v-if="priceStore.connectionStatus !== 'connected'" class="ribbon top-right" aria-hidden="true">
                <span>{{ $t('common.down') }}</span>
              </div>
            </v-btn>
          </template>
          <span>{{ $t('perpetuals.perpetuals') }}</span>
        </v-tooltip>
      </div>

    </div>
    <ReceiveDialog :isOpen="quickActionState.activeDialog === dialogs.RECEIVE" @close="closeDialog"></ReceiveDialog>
    <SwapDialog
      v-if="isSwapSupportedByNetwork"
      :isOpen="quickActionState.activeDialog === dialogs.SWAP"
      @close="closeDialog"
    ></SwapDialog>
    <BuyDialog :isOpen="!isBuyDisabled && quickActionState.activeDialog === dialogs.BUY" @close="closeDialog"></BuyDialog>
    <BitcoinSendDialog
      v-if="isBitcoin"
      :value="quickActionState.activeDialog === dialogs.SEND"
      @input="val => !val && closeDialog()"
    />
    <SendDialog v-else :isOpen="quickActionState.activeDialog === dialogs.SEND" @close="closeDialog"></SendDialog>
    <PerpetualsDialog v-if="!isPerpetualsDisabled" :visible="quickActionState.activeDialog === dialogs.PERPETUALS" @update:visible="val => !val && closeDialog()"></PerpetualsDialog>
  </div>
</template>
<script setup lang="ts">
import { toRefs, computed, ref, getCurrentInstance } from 'vue';
import ReceiveDialog from '@/modules/dashboard/dialogs/ReceiveDialog.vue';
import SwapDialog from '@/modules/dashboard/dialogs/SwapDialog.vue';
import SendDialog from '@/modules/dashboard/dialogs/SendDialog.vue';
import BitcoinSendDialog from '@/modules/transactions/dialogs/BitcoinSendDialog.vue';
import BuyDialog from '@/modules/dashboard/dialogs/BuyDialog.vue';
import PerpetualsDialog from '@/modules/dashboard/dialogs/PerpetualsDialog.vue';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import featureFlagsStore from '@/stores/featureFlagsStore';
import { priceStore } from '@/stores/priceStore';
import { Blockchain } from '@/models/types';
import { useQuickActionDialogs } from '@/shared/composables/useQuickActionDialogs';

const props = defineProps<{
  compact?: boolean;
}>();

const { loggedWallet } = toRefs(walletStore);
const vmProxy = getCurrentInstance()!.proxy as any

const { state: quickActionState, openDialog, closeDialog } = useQuickActionDialogs();

const dialogs = {
  SEND: 'SEND',
  RECEIVE: 'RECEIVE',
  SWAP: 'SWAP',
  BUY: 'BUY',
  PERPETUALS: 'PERPETUALS',
};

const mousePosition = ref<{x: number, y: number} | null>(null);
const buttonGlows = ref<Record<string, any>>({});

// Button refs
const buyButton = ref(null);
const sendButton = ref(null);
const receiveButton = ref(null);
const swapButton = ref(null);
const perpetualsButton = ref(null);

const isBitcoin = computed(() => loggedWallet.value?.chain === Blockchain.BITCOIN);

const isBuyDisabled = computed(() => {
  if (loggedWallet.value) {
    return !networks.resolveBuySupported(loggedWallet.value.chain, loggedWallet.value.network);
  }
  return true;
});

// Loading state for swap feature flag
const loadingSwap = computed(() => {
  return featureFlagsStore.state.isLoading || !featureFlagsStore.state.isInitialized;
});

// Check if swap is enabled by feature flag
const isSwapEnabledByFeatureFlag = computed(() => {
  return featureFlagsStore.isSwapEnabled();
});

// Check if swap is supported by network
const isSwapSupportedByNetwork = computed(() => {
  if (loggedWallet.value) {
    return networks.resolveSwapSupport(loggedWallet.value?.chain, loggedWallet.value?.network);
  }
  return false;
});

const isPerpetualsDisabled = computed(() => {
  // Enable for Cardano mainnet and preprod for testing
  if (loggedWallet.value) {
    return !networks.resolvePerpetualsSupport(loggedWallet.value?.chain, loggedWallet.value?.network);
  }
  return true;
})


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

.quick-actions-container.compact {
  padding: 0;
  gap: 4px;
  border: none;
  min-width: unset;
}

.action-button-wrapper {
  display: flex;
  align-content: center;
  text-align: center;
  flex-shrink: 0;
}

.expandable-button.icon-only {
  padding: 0 6px !important;
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

/* Right corner ribbon "Off" badge */
.ribbon {
  position: absolute;
  top: -0.375rem;
  right: -0.75rem;
  width: 1.75rem;
  height: 1.75rem;
  overflow: hidden;
  z-index: 20;
  pointer-events: none;
}

.ribbon span {
  position: absolute;
  display: block;
  width: 40px;
  padding: 2px 0;
  background-color: #BD1550;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  color: #fff;
  font-size: 7px;
  font-weight: 700;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
  text-transform: uppercase;
  text-align: center;
  right: -10px;
  top: 3px;
  transform: rotate(45deg);
  letter-spacing: 0.3px;
  line-height: 1.2;
}

@media (max-width: 768px) {
  .ribbon {
    top: -5px;
    right: -10px;
    width: 24px;
    height: 24px;
  }

  .ribbon span {
    width: 35px;
    font-size: 6.5px;
    right: -8px;
    top: 2.5px;
  }
}

@media (max-width: 480px) {
  .ribbon {
    top: -4px;
    right: -8px;
    width: 20px;
    height: 20px;
  }

  .ribbon span {
    width: 32px;
    font-size: 6px;
    right: -6px;
    top: 2px;
  }
}

.ribbon span::before,
.ribbon span::after {
  content: "";
  position: absolute;
  top: 100%;
  z-index: -1;
  border-left: 2px solid transparent;
  border-right: 2px solid transparent;
  border-top: 2px solid #8B0E3C;
}

.ribbon span::before {
  left: 0;
}

.ribbon span::after {
  right: 0;
}
</style>
