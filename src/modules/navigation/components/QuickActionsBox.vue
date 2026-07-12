<template>
  <div>
    <div :class="['quick-actions-container', { 'compact': compact }]">
      <div v-if="!isBuyDisabled" class="action-button-wrapper">
        <v-tooltip bottom :disabled="!compact" content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <v-btn
              :class="['expandable-button', 'buy-button', { 'icon-only': compact }]"
              color="warning"
              height="28"
              @click="openDialog(dialogs.BUY)"
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
              :class="['expandable-button', 'send-button', { 'icon-only': compact }]"
              color="primary"
              height="28"
              @click="openDialog(dialogs.SEND)"
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
              :class="['expandable-button', 'receive-button', { 'icon-only': compact }]"
              color="success"
              height="28"
              @click="openDialog(dialogs.RECEIVE)"
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
              :class="['expandable-button', 'swap-button', { 'icon-only': compact }]"
              color="error"
              height="28"
              @click="openDialog(dialogs.SWAP)"
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
              :class="['expandable-button', 'perpetuals-button', { 'icon-only': compact }]"
              color="info"
              height="28"
              @click="openDialog(dialogs.PERPETUALS)"
              :disabled="priceStore.connectionStatus !== 'connected'"
              :loading="priceStore.connectionStatus === 'connecting'"
              v-bind="attrs"
              v-on="on"
            >
              <span
                class="qa-mask-icon"
                :style="{ '--qa-icon': `url(${assets.barChart})` }"
                role="img"
                :aria-label="$t('perpetuals.perpetuals')"
              ></span>
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
import { toRefs, computed } from 'vue';
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

defineProps<{
  compact?: boolean;
}>();

const { loggedWallet } = toRefs(walletStore);

const { state: quickActionState, openDialog, closeDialog } = useQuickActionDialogs();

const dialogs = {
  SEND: 'SEND',
  RECEIVE: 'RECEIVE',
  SWAP: 'SWAP',
  BUY: 'BUY',
  PERPETUALS: 'PERPETUALS',
};

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
  border: 1px solid var(--g-hairline-3);
  /* The whole bar is the liquid-glass surface; the buttons inside are flat
     tints sharing this one frosted panel (was: glass per button). */
  background-color: rgba(10, 12, 16, 0.55) !important;
  backdrop-filter: blur(14px) saturate(1.3);
  -webkit-backdrop-filter: blur(14px) saturate(1.3);
  border-radius: var(--g-r-card);
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
  border-radius: var(--g-r-control) !important;
  display: flex !important;
  justify-content: flex-start !important;
  align-items: center !important;
  position: relative;
  /* Buttons are flat inside the glass bar: a faint color tint + colored label,
     no per-button frost or border (the container carries the glass now). */
  background: transparent !important;
  border: none !important;
  overflow: hidden;
  transition: background var(--g-dur-fast) ease;
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

/* Mask-painted icon: exact token color instead of an approximate CSS filter. */
.qa-mask-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  -webkit-mask: var(--qa-icon) no-repeat center / contain;
  mask: var(--qa-icon) no-repeat center / contain;
}

/* Per-button color: a faint tint over the shared glass bar (rest) that
   intensifies on hover, plus the colored label. Prefixed with the container so
   these reach (0,4,0) in scoped CSS and beat Vuetify's filled
   `.warning`/`.primary`/etc. override-flagged (0,2,0) rules, which are emitted
   twice and otherwise win on source order. See project_vuetify_css_cascade. */
.quick-actions-container .buy-button {
  background: color-mix(in srgb, var(--g-warning) 12%, transparent) !important;
}
.quick-actions-container .buy-button:hover {
  background: color-mix(in srgb, var(--g-warning) 22%, transparent) !important;
}
.buy-button .button-text {
  color: var(--g-warning);
}

.quick-actions-container .send-button {
  background: color-mix(in srgb, var(--g-accent) 12%, transparent) !important;
}
.quick-actions-container .send-button:hover {
  background: color-mix(in srgb, var(--g-accent) 22%, transparent) !important;
}
.send-button .button-text {
  color: var(--g-accent);
}

.quick-actions-container .receive-button {
  background: color-mix(in srgb, var(--g-success) 12%, transparent) !important;
}
.quick-actions-container .receive-button:hover {
  background: color-mix(in srgb, var(--g-success) 22%, transparent) !important;
}
.receive-button .button-text {
  color: var(--g-success);
}

.quick-actions-container .swap-button {
  background: color-mix(in srgb, var(--g-error) 12%, transparent) !important;
}
.quick-actions-container .swap-button:hover {
  background: color-mix(in srgb, var(--g-error) 22%, transparent) !important;
}
.swap-button .button-text {
  color: var(--g-error);
}

.quick-actions-container .perpetuals-button {
  background: color-mix(in srgb, var(--g-info) 12%, transparent) !important;
}
.quick-actions-container .perpetuals-button:hover {
  background: color-mix(in srgb, var(--g-info) 22%, transparent) !important;
}
.perpetuals-button .button-text {
  color: var(--g-info);
}

/* Paint the perps bar-chart glyph with the exact label token so icon and text
   match (the other icons use approximate CSS-filter tints). */
.perpetuals-button .qa-mask-icon {
  background-color: var(--g-info);
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
  background-color: var(--g-error);
  color: var(--g-text-1);
  font-size: 11px;
  font-weight: 700;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
  text-align: center;
  right: -10px;
  top: 3px;
  transform: rotate(45deg);
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
    font-size: 11px;
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
    font-size: 11px;
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
  border-top: 2px solid color-mix(in srgb, var(--g-error) 65%, var(--g-canvas));
}

.ribbon span::before {
  left: 0;
}

.ribbon span::after {
  right: 0;
}
</style>
