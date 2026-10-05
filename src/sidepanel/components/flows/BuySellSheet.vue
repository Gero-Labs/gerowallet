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
            <div class="choice-desc text-caption mt-1">
              {{ $t('wallet.buyADADescription') }}
            </div>
          </div>
          <div class="choice-card" @click="chooseMethod('SELL')">
            <v-icon size="36" color="error">mdi-arrow-top-right</v-icon>
            <div class="choice-label white--text font-weight-bold mt-2">
              {{ $t('wallet.sellADA') }}
            </div>
            <div class="choice-desc text-caption mt-1">
              {{ $t('wallet.sellADADescription') }}
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════ STEP 2: MOONPAY WIDGET ═══════ -->
      <div v-else class="step-content iframe-step">
        <div v-if="signingError" class="sign-warning t-caption">{{ signingError }}</div>
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
          @click="goBack"
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
import BottomSheet from '../BottomSheet.vue';
import { useChainContext } from '../../composables/useChainContext';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const moonPayApiKey = import.meta.env.VITE_MOONPAY_API_KEY;

const props = defineProps<{ value: boolean }>();
const emit = defineEmits<{ (e: 'input', v: boolean): void }>();

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

const step = ref(1);
const method = ref<'BUY' | 'SELL' | null>(null);
const iframeUrl = ref('');
const iframeLoading = ref(true);
const signingError = ref('');

// MoonPay is the only fiat on/off-ramp (Guardarian was removed 2026-09), so
// choosing Buy or Sell loads the widget directly — no provider step.
const title = computed(() => (step.value === 1 ? t('wallet.buySell') : t('wallet.finalize')));

// A slow signing request must not be overwritten by a later pick: each call
// takes a ticket, and only the newest one is allowed to commit its URL.
let signTicket = 0;

async function chooseMethod(m: 'BUY' | 'SELL') {
  const ticket = ++signTicket;
  method.value = m;
  iframeLoading.value = true;
  iframeUrl.value = '';
  signingError.value = '';
  // Leave the choice screen at once so a second tap cannot start a rival
  // request while the first is still signing.
  step.value = 2;

  const address = loggedWallet.value?.baseAddress?.value || '';
  const unsigned = m === 'BUY'
    ? `https://buy.moonpay.com/?apiKey=${moonPayApiKey}&enabledPaymentMethods=credit_debit_card&theme=dark&currencyCode=ada&walletAddress=${address}&colorCode=%232f9cac&baseCurrencyCode=usd`
    : `https://sell.moonpay.com/?apiKey=${moonPayApiKey}&paymentMethod=credit_debit_card&theme=dark&currencyCode=ada&refundWalletAddress=${address}&colorCode=%232f9cac&baseCurrencyCode=eur`;

  try {
    const signed = await moonPayApi.moonPaySign(unsigned);
    if (ticket !== signTicket) return;
    const ok = typeof signed === 'string' && signed.includes('signature=');
    iframeUrl.value = ok ? signed : unsigned;
    if (!ok) signingError.value = t('wallet.moonpaySigningWarning');
  } catch (e) {
    if (ticket !== signTicket) return;
    console.error('[BuySell] Moonpay sign error:', e);
    // Without a URL the iframe never renders and the spinner never clears.
    iframeUrl.value = unsigned;
    signingError.value = t('wallet.moonpaySigningWarning');
  }
}

function goBack() {
  iframeUrl.value = '';
  iframeLoading.value = true;
  signingError.value = '';
  method.value = null;
  step.value = 1;
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
    signingError.value = '';
  }
});
</script>

<style scoped lang="scss">
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

/* Justified solid (readability): the white label + description sit over the
   side panel's chain backdrop, which is bright on Bitcoin/Apex. A translucent
   tint here previously washed the text out, so this card stays opaque while
   the rest of the sheet is glass. */
.choice-card {
  background: var(--g-raised);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  border-radius: var(--g-r-card);
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
  color: var(--g-text-2);
}

/* ── Step 2: iframe ── */
.sign-warning {
  width: 100%;
  margin-bottom: 8px;
  padding: 8px 10px;
  border-radius: var(--g-r-chip);
  background: var(--g-warning-fill);
  color: var(--g-warning);
}

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
