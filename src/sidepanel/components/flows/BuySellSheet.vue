<template>
  <BottomSheet :value="value" @input="onClose" :title="title" height="92%">
    <div class="buy-sell-sheet">

      <!-- ═══════ STEP 1: BUY or SELL ═══════ -->
      <div v-if="step === 1" class="step-content">
        <div class="choice-grid">
          <div class="choice-card" @click="chooseMethod('BUY')">
            <v-icon size="36" color="success">mdi-arrow-bottom-left</v-icon>
            <div class="choice-label white--text font-weight-bold mt-2">
              {{ $t('wallet.buyADA') }}
            </div>
            <div class="choice-desc text-caption grey--text mt-1">
              {{ $t('wallet.buyADADescription') }}
            </div>
          </div>
          <div class="choice-card" @click="chooseMethod('SELL')">
            <v-icon size="36" color="error">mdi-arrow-top-right</v-icon>
            <div class="choice-label white--text font-weight-bold mt-2">
              {{ $t('wallet.sellADA') }}
            </div>
            <div class="choice-desc text-caption grey--text mt-1">
              {{ $t('wallet.sellADADescription') }}
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════ STEP 2: PROVIDER ═══════ -->
      <div v-else-if="step === 2" class="step-content">
        <div class="provider-list">
          <div
            v-for="p in providers"
            :key="p.name"
            class="provider-item"
            @click="chooseProvider(p.name)"
          >
            <img :src="p.image" class="provider-logo" />
            <div v-if="p.subtitle" class="text-caption grey--text mt-1">
              {{ p.subtitle }}
            </div>
          </div>
        </div>
        <v-btn
          text
          small
          :color="primaryColor"
          class="mt-4"
          @click="step = 1"
        >
          <v-icon small left>mdi-arrow-left</v-icon>
          {{ $t('common.back') }}
        </v-btn>
      </div>

      <!-- ═══════ STEP 3: IFRAME WIDGET ═══════ -->
      <div v-else-if="step === 3" class="step-content iframe-step">
        <v-progress-circular
          v-if="iframeLoading"
          size="48"
          :color="primaryColor"
          indeterminate
          class="iframe-loader"
        />
        <iframe
          v-if="iframeUrl"
          v-show="!iframeLoading"
          class="widget-iframe"
          allow="accelerometer; autoplay; camera; gyroscope; payment"
          :src="iframeUrl"
          @load="iframeLoading = false"
        />
        <v-btn
          text
          small
          :color="primaryColor"
          class="back-btn"
          @click="goBackToProviders"
        >
          <v-icon small left>mdi-arrow-left</v-icon>
          {{ $t('common.back') }}
        </v-btn>
      </div>

    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRefs } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import moonPayApi from '@/api/moonpay-api';
import assets from '@/utils/assets';
import BottomSheet from '../BottomSheet.vue';
import { useChainContext } from '../../composables/useChainContext';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const moonPayApiKey = import.meta.env.VITE_MOONPAY_API_KEY;
const guardarianApiKey = import.meta.env.VITE_GUARDARIAN_API_KEY;

const props = defineProps<{ value: boolean }>();
const emit = defineEmits<{ (e: 'input', v: boolean): void }>();

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

const step = ref(1);
const method = ref<'BUY' | 'SELL' | null>(null);
const iframeUrl = ref('');
const iframeLoading = ref(true);

const providers = [
  { name: 'guardarian', image: assets.guardarian, subtitle: t('wallet.guardarianOffer') },
  { name: 'moonpay', image: assets.moonpay, subtitle: '' },
];

const title = computed(() => {
  if (step.value === 1) return t('wallet.buySell');
  if (step.value === 2) return t('wallet.provider');
  return t('wallet.finalize');
});

function chooseMethod(m: 'BUY' | 'SELL') {
  method.value = m;
  step.value = 2;
}

async function chooseProvider(name: string) {
  iframeLoading.value = true;
  iframeUrl.value = '';
  const address = loggedWallet.value?.baseAddress?.value || '';

  if (method.value === 'BUY') {
    if (name === 'moonpay') {
      try {
        iframeUrl.value = await moonPayApi.moonPaySign(
          `https://buy.moonpay.com/?apiKey=${moonPayApiKey}&enabledPaymentMethods=credit_debit_card&theme=dark&currencyCode=ada&walletAddress=${address}&colorCode=%232f9cac&baseCurrencyCode=usd`
        );
      } catch (e) {
        console.error('[BuySell] Moonpay sign error:', e);
      }
    } else if (name === 'guardarian') {
      iframeUrl.value = `https://guardarian.com/calculator/v1?partner_api_token=${guardarianApiKey}&theme=blue&type=narrow&swap_enabled=true&default_from_amount=100&default_fiat_currency=USD&default_crypto_currency=ADA&crypto_currencies_list=%5B%7B%22ticker%22%3A%22ADA%22%2C%22network%22%3A%22ADA%22%7D%5D&default_side=buy_crypto&side_toggle_disabled=true&body_background=transparent&button_background=hex_2f9cac&calc_background=hex_000000&select_background=rgb(47,156,172)&button_background_disabled=hex_2f9cac&submit_button_color=white&widget_height=390`;
    }
  } else if (method.value === 'SELL') {
    if (name === 'moonpay') {
      try {
        iframeUrl.value = await moonPayApi.moonPaySign(
          `https://sell.moonpay.com/?apiKey=${moonPayApiKey}&paymentMethod=credit_debit_card&theme=dark&currencyCode=ada&refundWalletAddress=${address}&colorCode=%232f9cac&baseCurrencyCode=eur`
        );
      } catch (e) {
        console.error('[BuySell] Moonpay sign error:', e);
      }
    } else if (name === 'guardarian') {
      iframeUrl.value = `https://guardarian.com/calculator/v1?partner_api_token=${guardarianApiKey}&theme=blue&type=narrow&swap_enabled=true&default_from_amount=100&default_fiat_currency=USD&default_crypto_currency=ADA&crypto_currencies_list=%5B%7B%22ticker%22%3A%22ADA%22%2C%22network%22%3A%22ADA%22%7D%5D&default_side=sell_crypto&side_toggle_disabled=true&body_background=transparent&button_background=hex_2f9cac&calc_background=hex_000000&select_background=rgb(47,156,172)&button_background_disabled=hex_2f9cac&submit_button_color=white&widget_height=390`;
    }
  }

  step.value = 3;
}

function goBackToProviders() {
  iframeUrl.value = '';
  iframeLoading.value = true;
  step.value = 2;
}

function onClose(v: boolean) {
  emit('input', v);
}

// Reset state when sheet closes
watch(() => props.value, (open) => {
  if (!open) {
    step.value = 1;
    method.value = null;
    iframeUrl.value = '';
    iframeLoading.value = true;
  }
});
</script>

<style scoped>
.buy-sell-sheet {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding-bottom: 72px;
}

.step-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

/* ── Step 1: Buy / Sell choice ── */
.choice-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
  margin-top: 24px;
}

.choice-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  border-radius: var(--g-r-card);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--g-hairline-1);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  text-align: center;
}

.choice-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: color-mix(in srgb, var(--g-accent) 30%, transparent);
}

.choice-card:active {
  transform: scale(0.97);
}

.choice-label {
  font-size: 14px;
}

.choice-desc {
  font-size: 11px !important;
  line-height: 1.3;
}

/* ── Step 2: Provider list ── */
.provider-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  margin-top: 16px;
}

.provider-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
  border-radius: var(--g-r-card);
  border: 1px solid var(--g-hairline-2);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.provider-item:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: color-mix(in srgb, var(--g-accent) 30%, transparent);
}

.provider-logo {
  height: 28px;
  object-fit: contain;
}

/* ── Step 3: iframe ── */
.iframe-step {
  position: relative;
  flex: 1;
  width: 100%;
}

.iframe-loader {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.widget-iframe {
  width: 100%;
  height: calc(100% - 40px);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  margin-top: 4px;
}

.back-btn {
  text-transform: none;
  margin-top: 8px;
}
</style>
