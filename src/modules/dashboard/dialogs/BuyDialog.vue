<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    title="Buy / Sell"
    subtitle="Choose your favorite Provider for On-ramp / Off-ramp"
    :min-height="300"
    :persistent="false"
  >
    <v-card class="transparent" flat>
      <v-card-text>
        <v-stepper v-model="step" outlined style="background-color: transparent" >
          <v-stepper-header style="box-shadow: unset">
            <v-stepper-step
              :complete="step > 1"
              step="1"
            >
              Buy / Sell
            </v-stepper-step>
            <v-divider></v-divider>
            <v-stepper-step
              :complete="step > 2"
              step="2"
            >
              Provider
            </v-stepper-step>
            <v-divider></v-divider>
            <v-stepper-step
              step="3"
            >
              Finalize
            </v-stepper-step>
          </v-stepper-header>
          <v-stepper-items>
            <v-stepper-content step="1" class="overflow-visible pa-0" style="height: 400px">
              <v-card class="transparent fill-height" flat style="align-content: center;">
                <v-row>
                  <v-col cols="6">
                    <v-card class="pa-4 transparent" flat @click="chooseBuy">
                      <div
                        class="card-3d-wrapper"
                        :style="buyCardStyle"
                        @mousemove="handleBuyCardMouseMove"
                        @mouseleave="handleBuyCardMouseLeave"
                      >
                        <parallax-card
                          style="margin-left: auto; margin-right: auto;"
                          :data-image="assets.buyAda"
                        >
                          <h1 slot="header" style="line-height: 1;">Buy ADA</h1>
                          <p slot="content">Use Credit Card or Other Payment Methods to Buy ADA</p>
                        </parallax-card>
                      </div>
                    </v-card>
                  </v-col>
                  <v-col cols="6">
                    <v-card class="pa-4 transparent" flat @click="chooseSell">
                      <div
                        class="card-3d-wrapper"
                        :style="sellCardStyle"
                        @mousemove="handleSellCardMouseMove"
                        @mouseleave="handleSellCardMouseLeave"
                      >
                        <parallax-card
                          style="margin-left: auto; margin-right: auto;"
                          :data-image="assets.sellAda"
                        >
                          <h1 slot="header" style="line-height: 1;">Sell ADA</h1>
                          <p slot="content">Choose from multiple methods to instantly convert your ADA to cash</p>
                        </parallax-card>
                      </div>
                    </v-card>
                  </v-col>
                </v-row>
              </v-card>
            </v-stepper-content>
            <v-stepper-content class="overflow-visible pa-0" step="2" style="height: 400px">
              <v-card
                flat
                class="transparent text-center justify-center"
                style="height: 100%;align-content: center;"
              >
                <v-list class="transparent" outlined rounded style="max-width: 400px; margin: auto">
                  <v-list-item
                    v-for="(provider, index) in providers"
                    :key="index"
                    style="border: 1px solid #454545"
                    @click="chooseProvider(provider.name)"
                  >
                    <v-list-item-content>
                      <v-list-item-title style="height: 42px; align-content: center;" class="justify-center text-center">
                        <v-img :src="provider.image" max-height="32" contain style="margin: auto"></v-img>
                      </v-list-item-title>
                      <v-list-item-subtitle v-if="provider.subtitle">
                        {{ provider.subtitle }}
                      </v-list-item-subtitle>
                    </v-list-item-content>
                  </v-list-item>
                </v-list>
              </v-card>
            </v-stepper-content>
            <v-stepper-content class="overflow-visible pa-0" step="3" style="height: 400px">
              <v-card
                class="transparent fill-height"
                flat
              >
                <v-card-text
                  class="text-center justify-center py-0" style="align-content: center; margin: auto; overflow-y: clip; width: 400px; height: 391px"
                >
                  <v-progress-circular size="60" color="primary" indeterminate v-show="loading" />
                  <iframe v-if="provider && method" v-show="!loading"
                    style="border-radius: 24px; border: 1px solid #454545"
                    allow="accelerometer; autoplay; camera; gyroscope; payment"
                    height="100%"
                    :src="url"
                    width="100%"
                    @load="onIframeLoad"
                  >
                    <p>Your browser does not support iframes.</p>
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
          Back
        </v-btn>
        <div v-else style="height: 36px" />
      </v-card-actions>
    </v-card>

  </BaseDialog>
</template>
<script setup lang="ts">
import { ref, watch, toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import ParallaxCard from '@/modules/welcome/components/ParallaxCard.vue';
import moonPayApi from '@/api/moonpay-api';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';

const moonPayApiKey = import.meta.env.VITE_MOONPAY_API_KEY;
const guardarianApiKey = import.meta.env.VITE_GUARDARIAN_API_KEY;

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close']);
const { loggedWallet } = toRefs(walletStore);

const url = ref('');
const step = ref(1);
const methods = {
  BUY: 'BUY',
  SELL: 'SELL'
};
const providers = [
  {name: 'guardarian', image: assets.guardarian, subtitle: 'Limited Offer - 0% Wallet Fees' },
  {name: 'moonpay', image: assets.moonpay },
];
const method = ref<string | undefined>(undefined);
const provider = ref<string | undefined>(undefined);
const loading = ref(true);

// 3D effect reactive refs
const buyCardStyle = ref<any>({});
const sellCardStyle = ref<any>({});

const onIframeLoad = () => {
  loading.value = false;
};

const chooseBuy = () => {
  method.value = methods.BUY;
  step.value++;
};

const chooseSell = () => {
  method.value = methods.SELL;
  step.value++;
};

// 3D Card tilt effect handlers for Buy card
const handleBuyCardMouseMove = (event: MouseEvent) => {
  const card = event.currentTarget as HTMLElement;
  const rect = card.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  const rotateX = (y - centerY) / 10;
  const rotateY = (centerX - x) / 10;

  buyCardStyle.value = {
    transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px)`,
    transition: 'transform 0.1s ease-out'
  };
};

const handleBuyCardMouseLeave = () => {
  buyCardStyle.value = {
    transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)',
    transition: 'transform 0.3s ease-out'
  };
};

// 3D Card tilt effect handlers for Sell card
const handleSellCardMouseMove = (event: MouseEvent) => {
  const card = event.currentTarget as HTMLElement;
  const rect = card.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  const rotateX = (y - centerY) / 10;
  const rotateY = (centerX - x) / 10;

  sellCardStyle.value = {
    transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px)`,
    transition: 'transform 0.1s ease-out'
  };
};

const handleSellCardMouseLeave = () => {
  sellCardStyle.value = {
    transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)',
    transition: 'transform 0.3s ease-out'
  };
};

const chooseProvider = async (name: string) => {
  provider.value = name;
  if (method.value === methods.BUY) {
    if (name === 'moonpay') {
      try {
        url.value = await moonPayApi.moonPaySign(`https://buy.moonpay.com/?apiKey=${moonPayApiKey}&enabledPaymentMethods=credit_debit_card&theme=dark&currencyCode=ada&walletAddress=${loggedWallet.value?.baseAddress.value}&colorCode=%232f9cac&baseCurrencyCode=usd`);
      } catch (error) {
        console.error(error);
      }
    } else if (name === 'guardarian') {
      url.value = `https://guardarian.com/calculator/v1?partner_api_token=${guardarianApiKey}&theme=blue&type=narrow&swap_enabled=true&default_from_amount=100&default_fiat_currency=USD&default_crypto_currency=ADA&crypto_currencies_list=%5B%7B%22ticker%22%3A%22ADA%22%2C%22network%22%3A%22ADA%22%7D%5D&default_side=buy_crypto&side_toggle_disabled=true&body_background=transparent&button_background=hex_2f9cac&calc_background=hex_000000&select_background=rgb(47,156,172)&button_background_disabled=hex_2f9cac&submit_button_color=white&widget_height=390`;
    }
  } else if (method.value === methods.SELL) {
    if (name === 'moonpay') {
      try {
        url.value = await moonPayApi.moonPaySign(`https://sell.moonpay.com/?apiKey=${moonPayApiKey}&paymentMethod=credit_debit_card&theme=dark&currencyCode=ada&refundWalletAddress=${loggedWallet.value?.baseAddress.value}&colorCode=%232f9cac&baseCurrencyCode=eur`);
      } catch (error) {
        console.error(error);
      }
    } else if (name === 'guardarian') {
      url.value = `https://guardarian.com/calculator/v1?partner_api_token=${guardarianApiKey}&theme=blue&type=narrow&swap_enabled=true&default_from_amount=100&default_fiat_currency=USD&default_crypto_currency=ADA&crypto_currencies_list=%5B%7B%22ticker%22%3A%22ADA%22%2C%22network%22%3A%22ADA%22%7D%5D&default_side=sell_crypto&side_toggle_disabled=true&body_background=transparent&button_background=hex_2f9cac&calc_background=hex_000000&select_background=rgb(47,156,172)&button_background_disabled=hex_2f9cac&submit_button_color=white&widget_height=390`;
    }
  }
  step.value++;
};

watch(() => props.isOpen, (newVal) => {
  if (!newVal) {
    step.value = 1;
    url.value = '';
    provider.value = undefined;
    method.value = undefined;
  }
});

watch(step, (newVal) => {
  if (newVal === 2) {
    url.value = '';
    provider.value = undefined;
    loading.value = true;
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

/* 3D Card Effect */
.card-3d-wrapper {
  perspective: 1000px;
  transform-style: preserve-3d;
  transition: transform 0.3s ease-out;
}

.card-3d-wrapper:hover {
  transform-style: preserve-3d;
}
</style>
