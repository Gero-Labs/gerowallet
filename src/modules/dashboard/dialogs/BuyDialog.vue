<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="t('wallet.buySell')"
    :subtitle="t('wallet.buySellSubtitle')"
    :min-height="300"
    :persistent="false"
    :img="assets.dollarShieldSvg"
    imgStyle="filter: brightness(0) saturate(100%) invert(100%) sepia(49%) saturate(2%) hue-rotate(47deg) brightness(118%) contrast(101%);"
  >
    <v-card class="transparent" flat>
      <v-card-text>
        <v-alert
          v-if="signingError"
          type="warning"
          dense
          dismissible
          class="mb-2"
          style="font-size: 12px;"
          @input="signingError = ''"
        >
          {{ signingError }}
        </v-alert>
        <v-stepper v-model="step" flat style="background-color: transparent">
          <v-stepper-header style="box-shadow: unset">
            <v-stepper-step
              :complete="step > 1"
              step="1"
            >
              {{ $t('wallet.buySell') }}
            </v-stepper-step>
            <v-divider></v-divider>
            <v-stepper-step
              step="2"
            >
              {{ $t('wallet.finalize') }}
            </v-stepper-step>
          </v-stepper-header>
          <v-stepper-items>
            <v-stepper-content step="1" class="overflow-visible pa-0" style="height: 400px">
              <v-card class="transparent fill-height" flat style="align-content: center;">
                <v-row class="px-6" style="gap: 0;">
                  <v-col cols="12" class="pa-2">
                    <button type="button" class="bs-choice" @click="chooseBuy">
                      <div class="bs-choice__text">
                        <div class="bs-choice__title">{{ buyLabel }}</div>
                        <div class="bs-choice__desc">{{ buyDescription }}</div>
                      </div>
                    </button>
                  </v-col>
                  <v-col cols="12" class="pa-2">
                    <button type="button" class="bs-choice" @click="chooseSell">
                      <div class="bs-choice__text">
                        <div class="bs-choice__title">{{ sellLabel }}</div>
                        <div class="bs-choice__desc">{{ sellDescription }}</div>
                      </div>
                    </button>
                  </v-col>
                </v-row>
              </v-card>
            </v-stepper-content>
            <v-stepper-content class="overflow-visible pa-0" step="2" style="height: 400px">
              <v-card
                class="transparent fill-height"
                flat
              >
                <v-card-text
                  class="text-center justify-center py-0" style="align-content: center; margin: auto; overflow-y: clip; width: 400px; height: 391px"
                >
                  <v-progress-circular size="60" color="primary" indeterminate v-show="loading" />
                  <iframe v-if="url && method" v-show="!loading"
                    style="border-radius: 24px; border: 1px solid #454545"
                    allow="accelerometer; autoplay; camera; gyroscope; payment"
                    height="100%"
                    :src="url"
                    width="100%"
                    @load="onIframeLoad"
                  >
                    <p>{{ $t('common.browserNotSupportIframes') }}</p>
                  </iframe>
                </v-card-text>
              </v-card>
            </v-stepper-content>
          </v-stepper-items>
        </v-stepper>
      </v-card-text>
      <v-card-actions class="justify-center pt-0">
        <v-btn
          v-if="step > 1"
          color="primary"
          @click="step--"
        >
          {{ $t('common.back') }}
        </v-btn>
        <div v-else style="height: 36px" />
      </v-card-actions>
    </v-card>
  </BaseDialog>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, watch, toRefs, computed } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import moonPayApi from '@/api/moonpay-api';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';

//@ts-ignore
const moonPayApiKey = import.meta.env.VITE_MOONPAY_API_KEY;

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['close']);
const { loggedWallet } = toRefs(walletStore);

const url = ref('');
const step = ref(1);
const methods = {
  BUY: 'BUY',
  SELL: 'SELL'
};
const { t } = useTranslation();

const isBitcoin = computed(() => loggedWallet.value?.chain === Blockchain.BITCOIN);

const buyLabel = computed(() => isBitcoin.value ? t('wallet.buyBTC') : t('wallet.buyADA'));
const buyDescription = computed(() => isBitcoin.value ? t('wallet.buyBTCDescription') : t('wallet.buyADADescription'));
const sellLabel = computed(() => isBitcoin.value ? t('wallet.sellBTC') : t('wallet.sellADA'));
const sellDescription = computed(() => isBitcoin.value ? t('wallet.sellBTCDescription') : t('wallet.sellADADescription'));

// MoonPay is the only fiat on/off-ramp (Guardarian was removed 2026-09), so
// choosing Buy or Sell loads the widget directly — no provider step.
const method = ref<string | undefined>(undefined);
const loading = ref(true);
const signingError = ref('');

const onIframeLoad = () => {
  loading.value = false;
};

const chooseBuy = () => loadMoonPay(methods.BUY);
const chooseSell = () => loadMoonPay(methods.SELL);

const loadMoonPay = async (chosen: string) => {
  method.value = chosen;
  url.value = '';
  loading.value = true;
  signingError.value = '';

  const btc = isBitcoin.value;
  const currencyCode = btc ? 'btc' : 'ada';
  const moonpayColor = btc ? '%23F7931A' : '%232f9cac';
  const walletAddress = btc
    ? loggedWallet.value?.baseAddress
    : loggedWallet.value?.baseAddress?.value ?? loggedWallet.value?.baseAddress;

  if (method.value === methods.BUY) {
    try {
      const paymentMethodsParam = btc ? '' : '&enabledPaymentMethods=credit_debit_card';
      const unsigned = `https://buy.moonpay.com/?apiKey=${moonPayApiKey}${paymentMethodsParam}&theme=dark&currencyCode=${currencyCode}&walletAddress=${walletAddress}&colorCode=${moonpayColor}&baseCurrencyCode=usd`;
      const signed = await moonPayApi.moonPaySign(unsigned);
      console.log('🌙 MoonPay signed URL:', signed);
      if (typeof signed === 'string' && signed.includes('signature=')) {
        url.value = signed;
        signingError.value = '';
      } else {
        console.warn('🌙 MoonPay signing failed — loading unsigned URL. Response:', signed);
        url.value = unsigned;
        signingError.value = t('wallet.moonpaySigningWarning');
      }
    } catch (error) {
      console.error(error);
    }
  } else if (method.value === methods.SELL) {
    try {
      const unsigned = `https://sell.moonpay.com/?apiKey=${moonPayApiKey}&paymentMethod=credit_debit_card&theme=dark&currencyCode=${currencyCode}&refundWalletAddress=${walletAddress}&colorCode=${moonpayColor}&baseCurrencyCode=eur`;
      const signed = await moonPayApi.moonPaySign(unsigned);
      console.log('🌙 MoonPay sell signed URL:', signed);
      if (typeof signed === 'string' && signed.includes('signature=')) {
        url.value = signed;
        signingError.value = '';
      } else {
        console.warn('🌙 MoonPay sell signing failed — loading unsigned URL. Response:', signed);
        url.value = unsigned;
        signingError.value = t('wallet.moonpaySigningWarning');
      }
    } catch (error) {
      console.error(error);
    }
  }
  step.value = 2;
};

watch(() => props.isOpen, (newVal) => {
  if (!newVal) {
    step.value = 1;
    url.value = '';
    method.value = undefined;
    signingError.value = '';
  }
});

// Back from the widget: drop the iframe so the next choice starts clean.
watch(step, (newVal) => {
  if (newVal === 1) {
    url.value = '';
    method.value = undefined;
    loading.value = true;
    signingError.value = '';
  }
});
</script>

<style>
.overflow-visible .v-stepper__wrapper {
  overflow: visible;
  height: 100%;
}
iframe html {
  background-color: transparent;
}

/* Buy / Sell choice cards: clean raised tiles, accent lift on hover.
   Real <button> elements (keyboard-operable money path). */
.bs-choice {
  @include g-glass-tier;
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  font: inherit;
  cursor: pointer;
  padding: 16px 18px;
  text-align: center;
  transition: border-color var(--g-dur-fast) ease, transform var(--g-dur-fast) ease,
    box-shadow var(--g-dur-fast) ease;
}

.bs-choice:hover {
  border-color: var(--g-accent);
  transform: translateY(-2px);
  box-shadow: var(--g-shadow-menu);
}

.bs-choice__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--g-text-1);
  margin-bottom: 2px;
}

.bs-choice__desc {
  font-size: 13px;
  line-height: 1.4;
  color: var(--g-text-3);
}
</style>
