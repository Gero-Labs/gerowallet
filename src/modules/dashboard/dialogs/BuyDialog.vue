<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Buy / Sell" subtitle="Choose your favorite Provider for On-ramp / Off-ramp" :min-height="300">
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
                      <parallax-card style="margin-left: auto; margin-right: auto;" :data-image="assets.buyAda">
                        <h1 slot="header" style="line-height: 1;">Buy ADA</h1>
                        <p slot="content">Use Credit Card or Other Payment Methods to Buy ADA</p>
                      </parallax-card>
                    </v-card>
                  </v-col>
                  <v-col cols="6">
                    <v-card class="pa-4 transparent" flat @click="chooseSell">
                      <parallax-card style="margin-left: auto; margin-right: auto;" :data-image="assets.sellAda">
                        <h1 slot="header" style="line-height: 1;">Sell ADA</h1>
                        <p slot="content">Choose from multiple methods to instantly convert your ADA to cash</p>
                      </parallax-card>
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
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
import { mapState } from 'pinia';
import { useStore } from '@/store';
import ParallaxCard from '@/modules/welcome/components/ParallaxCard.vue';
import moonPayApi from '@/api/moonpay-api';
import assets from '@/utils/assets';

const moonPayApiKey = import.meta.env.VITE_MOONPAY_API_KEY;
const guardarianApiKey = import.meta.env.VITE_GUARDARIAN_API_KEY;

export default {
  name: 'BuyDialog',
  components: { ParallaxCard, BaseDialog},
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  watch: {
    isOpen(newVal, _oldVal) {
      if (!newVal) {
        this.step = 1;
        this.url = ''
        this.provider = undefined
        this.method = undefined
      }
    },
    step(newVal, _oldVal) {
      if (newVal === 2) {
        this.url = ''
        this.provider = undefined
        this.loading = true
      }
    }
  },
  computed: {
    ...mapState(useStore, ['baseAddress'])
  },
  methods: {
    onIframeLoad() {
      this.loading = false;
    },
    chooseBuy() {
      this.method = this.methods.BUY
      this.step++;
    },
    chooseSell() {
      this.method = this.methods.SELL
      this.step++;
    },
    async chooseProvider(name) {
      this.provider = name
      if (this.method === this.methods.BUY) {
        if (name === 'moonpay') {
          try {
            this.url = await moonPayApi.moonPaySign(`https://buy.moonpay.com/?apiKey=${moonPayApiKey}&enabledPaymentMethods=credit_debit_card&theme=dark&currencyCode=ada&walletAddress=${this.baseAddress}&colorCode=%232f9cac&baseCurrencyCode=usd`)
          } catch (error) {
            console.error(error)
          }
        } else if (name === 'guardarian') {
          this.url = `https://guardarian.com/calculator/v1?partner_api_token=${guardarianApiKey}&theme=blue&type=narrow&swap_enabled=true&default_from_amount=100&default_fiat_currency=USD&default_crypto_currency=ADA&crypto_currencies_list=%5B%7B%22ticker%22%3A%22ADA%22%2C%22network%22%3A%22ADA%22%7D%5D&default_side=buy_crypto&side_toggle_disabled=true&body_background=transparent&button_background=hex_2f9cac&calc_background=hex_000000&select_background=rgb(47,156,172)&button_background_disabled=hex_2f9cac&submit_button_color=white&widget_height=390`
        }
      } else if (this.method === this.methods.SELL) {
        if (name === 'moonpay') {
          try {
            this.url = await moonPayApi.moonPaySign(`https://sell.moonpay.com/?apiKey=${moonPayApiKey}&paymentMethod=credit_debit_card&theme=dark&currencyCode=ada&refundWalletAddress=${this.baseAddress}&colorCode=%232f9cac&baseCurrencyCode=eur`)
          } catch (error) {
            console.error(error)
          }
        } else if (name === 'guardarian') {
          this.url = `https://guardarian.com/calculator/v1?partner_api_token=${guardarianApiKey}&theme=blue&type=narrow&swap_enabled=true&default_from_amount=100&default_fiat_currency=USD&default_crypto_currency=ADA&crypto_currencies_list=%5B%7B%22ticker%22%3A%22ADA%22%2C%22network%22%3A%22ADA%22%7D%5D&default_side=sell_crypto&side_toggle_disabled=true&body_background=transparent&button_background=hex_2f9cac&calc_background=hex_000000&select_background=rgb(47,156,172)&button_background_disabled=hex_2f9cac&submit_button_color=white&widget_height=390`
        }
      }
      this.step++;
    }
  },
  data: () => ({
    url: '',
    step: 1,
    methods: {
      BUY: 'BUY',
      SELL: 'SELL'
    },
    providers: [
      {name: 'guardarian', image: assets.guardarian, subtitle: 'Limited Offer - 0% Wallet Fees' },
      {name: 'moonpay', image: assets.moonpay },
    ],
    method: undefined,
    provider: undefined,
    loading: true,
    assets,
  })
}
</script>

<style>
.overflow-visible .v-stepper__wrapper {
  overflow: visible;
  height: 100%;
}
iframe html {
  background-color: transparent;
}
</style>
