<template>
  <div class="swap-take" :class="{ 'swap-take--wide': wide }">
    <!-- Reading the offer -->
    <div v-if="stage === 'loading'" class="swap-take__loading">
      <v-progress-circular indeterminate size="28" width="3" color="var(--g-accent)" />
    </div>

    <!-- The offer could not be read at all -->
    <template v-else-if="stage === 'unreadable'">
      <SwapBanner tone="error">{{ error }}</SwapBanner>
      <div class="swap-take__foot">
        <GButton block @click="emit('back')">{{ t('common.back') }}</GButton>
      </div>
    </template>

    <template v-else-if="inspection">
      <div class="swap-take__body">
        <div class="swap-take__col">
          <SwapAmountBox
            v-for="leg in inspection.pay"
            :key="`pay-${leg.tokenType}`"
            :label="t('midnight.swap.youPay')"
            :hint="t('midnight.swap.balance', { amount: swapBalanceText(balances.get(leg.tokenType) ?? 0n, info(leg.tokenType)) })"
            :model-value="swapAmountText(BigInt(leg.amount), info(leg.tokenType).decimals)"
            :token="info(leg.tokenType)"
          />
          <SwapAmountBox
            v-for="leg in inspection.get"
            :key="`get-${leg.tokenType}`"
            :label="t('midnight.swap.youGet')"
            :hint="rateText"
            :model-value="swapAmountText(BigInt(leg.amount), info(leg.tokenType).decimals)"
            :token="info(leg.tokenType)"
          />
          <SwapBanner v-for="type in unlistedTypes" :key="`unlisted-${type}`" tone="warning">
            <span>{{ t('midnight.swap.review.unlisted', { token: info(type).symbol }) }}</span>
            <span class="g-mono swap-take__type">{{ groupedTokenType(type) }}</span>
          </SwapBanner>
        </div>

        <div class="swap-take__col">
          <!-- Review -->
          <template v-if="stage === 'review'">
            <SwapRows :panel="!wide" :rows="detailRows" :aria-label="t('midnight.swap.review.details')" />
            <SwapBanner v-if="inspection.refusal" tone="error">{{ refusalText }}</SwapBanner>
            <SwapBanner v-else-if="dustShort" tone="error">{{ t('midnight.swap.review.dustShort', { fee: feeText }) }}</SwapBanner>
            <SwapBanner v-else-if="holdText" tone="warning">{{ holdText }}</SwapBanner>
            <SwapBanner v-if="error" tone="error">{{ error }}</SwapBanner>
            <p class="t-caption swap-take__note">{{ t('midnight.swap.publicNote') }}</p>
            <SwapPasswordField v-if="takeable" v-model="password" :is-prf-wallet="isPrfWallet" @submit="take()" />
          </template>

          <!-- Progress -->
          <ol v-else-if="stage === 'progress'" class="swap-steps" aria-live="polite">
            <li v-for="step in steps" :key="step.key" class="swap-step" :class="`swap-step--${step.state}`">
              <span class="swap-step__dot" aria-hidden="true">
                <v-progress-circular v-if="step.state === 'active'" indeterminate size="18" width="2" color="var(--g-accent)" />
                <v-icon v-else-if="step.state === 'done'" size="14">mdi-check</v-icon>
              </span>
              <span class="t-body">
                {{ step.label }}
                <span v-if="step.meta" class="t-caption swap-step__meta">{{ step.meta }}</span>
              </span>
            </li>
          </ol>

          <!-- Result -->
          <template v-else-if="stage === 'done'">
            <SwapBanner tone="success">{{ t('midnight.swap.done', { get: getText, pay: payText }) }}</SwapBanner>
            <div class="swap-take__field">
              <span class="t-caption">{{ t('midnight.swap.transaction') }}</span>
              <span class="g-mono swap-take__hash" data-test="swap-tx-hash">{{ groupedTokenType(txHash) }}</span>
            </div>
          </template>
          <SwapBanner v-else-if="stage === 'gone'" tone="error">{{ t('midnight.swap.error.gone') }}</SwapBanner>
          <SwapBanner v-else-if="stage === 'expired'" tone="error">{{ t('midnight.swap.error.expired') }}</SwapBanner>
          <SwapBanner v-else-if="stage === 'failed'" tone="warning">{{ error }}</SwapBanner>
        </div>
      </div>

      <div class="swap-take__foot">
        <template v-if="stage === 'review'">
          <GButton tier="primary" :block="!wide" :disabled="!canTake" :loading="busy" class="swap-take__cta" data-test="swap-take" @click="take()">
            {{ t('midnight.swap.review.swap') }}
          </GButton>
          <GButton tier="tertiary" :block="!wide" @click="emit('back')">{{ t('common.cancel') }}</GButton>
        </template>
        <span v-else-if="stage === 'progress'" class="t-caption">{{ t('midnight.swap.keepOpen') }}</span>
        <template v-else-if="stage === 'done'">
          <GButton :block="!wide" @click="emit('history')">{{ t('midnight.swap.viewHistory') }}</GButton>
          <GButton tier="primary" :block="!wide" class="swap-take__cta" data-test="swap-done" @click="emit('done')">{{ t('common.done') }}</GButton>
        </template>
        <GButton v-else-if="stage === 'failed'" tier="primary" :block="!wide" @click="stage = 'review'">{{ t('midnight.swap.tryAgain') }}</GButton>
        <GButton v-else :block="!wide" @click="emit('done')">{{ t('midnight.swap.backToSwap') }}</GButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useMidnightSendHold } from '@/shared/composables/useMidnightSendHold';
import { midnightStore } from '@/stores/midnightStore';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { formatTokenAmount } from '@/chains/midnight/midnightAmount';
import { dustShortForFee, MIDNIGHT_DUST_FEE_ESTIMATE_DISPLAY } from '@/chains/midnight/midnightFeeEstimate';
import type { SwapOfferInspection } from '@/chrome/midnightSwapHandlers';
import { injectMidnightSwap } from './swapContext';
import { MidnightSwapCallError, swapErrorText } from './useMidnightSwap';
import { useSwapBalances } from './useSwapBalances';
import {
  countdownText, groupedTokenType, swapAmountText, swapBalanceText, swapLegText, swapRateText, swapTokenInfo,
} from './swapTokens';
import SwapAmountBox from './SwapAmountBox.vue';
import SwapRows, { type SwapRow } from './SwapRows.vue';
import SwapBanner from './SwapBanner.vue';
import SwapPasswordField from './SwapPasswordField.vue';

type Stage = 'loading' | 'unreadable' | 'review' | 'progress' | 'done' | 'gone' | 'expired' | 'failed';

const props = withDefaults(defineProps<{ offer: string; wide?: boolean }>(), { wide: false });
const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'done'): void;
  (e: 'history'): void;
  /** The screen's title and, while reviewing, the time left. */
  (e: 'heading', value: { title: string; left: string }): void;
}>();

const { t } = useTranslation();
const swap = injectMidnightSwap();
const { network, isPrfWallet, offers, now } = swap;
const balances = useSwapBalances(offers, now);
const hold = useMidnightSendHold(() => network.value);
const holdText = computed(() => (hold.held.value ? hold.sendTextShort.value : ''));

const stage = ref<Stage>('loading');
const inspection = ref<SwapOfferInspection | null>(null);
const error = ref('');
const password = ref('');
const busy = ref(false);
const txHash = ref('');
const lastTrade = ref('');
const sawProving = ref(false);

const info = (tokenType: string) => swapTokenInfo(tokenType, network.value);
const feeText = computed(() => t('midnight.swap.feeAbout', { fee: MIDNIGHT_DUST_FEE_ESTIMATE_DISPLAY }));
const dustShort = computed(() => dustShortForFee(midnightStore.balances.dust));
const payText = computed(() => inspection.value?.pay.map(leg => swapLegText(leg, network.value)).join(', ') ?? '');
const getText = computed(() => inspection.value?.get.map(leg => swapLegText(leg, network.value)).join(', ') ?? '');
const rateText = computed(() => {
  const get = inspection.value?.get[0];
  const pay = inspection.value?.pay[0];
  return get && pay && inspection.value?.get.length === 1 && inspection.value.pay.length === 1 ? swapRateText(get, pay, network.value) : '';
});
const unlistedTypes = computed(() => [...new Set([...(inspection.value?.pay ?? []), ...(inspection.value?.get ?? [])]
  .map(leg => leg.tokenType).filter(type => !info(type).listed))]);
const refusalText = computed(() => (inspection.value?.refusal ? swapErrorText(inspection.value.refusal, t) : ''));
const takeable = computed(() => !!inspection.value && !inspection.value.refusal);
const canTake = computed(() => takeable.value && !busy.value && !dustShort.value && !hold.held.value && (isPrfWallet.value || !!password.value));

const shortAddress = (address: string) => (address.length > 24 ? `${address.slice(0, 14)}…${address.slice(-4)}` : address);
const detailRows = computed<SwapRow[]>(() => {
  const rows: SwapRow[] = [
    { label: t('midnight.swap.networkFee'), value: feeText.value },
    {
      label: t('midnight.swap.review.yourDust'),
      value: `${formatTokenAmount(midnightStore.balances.dust, MIDNIGHT_DECIMALS.DUST)} DUST`,
      tone: dustShort.value ? 'warning' : undefined,
    },
  ];
  if (inspection.value?.maker) rows.push({ label: t('midnight.swap.review.otherWallet'), value: shortAddress(inspection.value.maker), mono: true });
  rows.push({ label: t('midnight.swap.offerType'), value: t('midnight.swap.kind.public') });
  rows.push({ label: t('midnight.swap.visible'), value: t('midnight.swap.visibleBoth'), tone: 'muted' });
  if (lastTrade.value) rows.push({ label: t('midnight.swap.review.lastTrade'), value: lastTrade.value, tone: 'muted' });
  return rows;
});

const steps = computed(() => {
  const phase = midnightStore.sendProgress?.phase;
  const proving = phase === 'proving' || sawProving.value;
  const submitting = sawProving.value && !midnightStore.sendProgress;
  const fee = midnightStore.sendProgress?.phase === 'syncingDust' ? midnightStore.sendProgress : null;
  const state = (done: boolean, active: boolean) => (done ? 'done' : active ? 'active' : 'todo');
  return [
    { key: 'checked', label: t('midnight.swap.step.checked'), state: 'done', meta: '' },
    {
      key: 'fee', label: t('midnight.swap.step.fee'), state: state(proving, !proving),
      meta: !proving && fee && fee.percent >= 0 ? `${fee.percent}%` : '',
    },
    { key: 'proving', label: t('midnight.swap.step.proving'), state: state(submitting, proving && !submitting), meta: proving && !submitting ? t('midnight.swap.step.aboutSeconds') : '' },
    { key: 'submitting', label: t('midnight.swap.step.submitting'), state: state(false, submitting), meta: '' },
  ];
});
watch(() => midnightStore.sendProgress?.phase, (phase) => { if (stage.value === 'progress' && phase === 'proving') sawProving.value = true; });

const heading = computed(() => {
  switch (stage.value) {
    case 'progress': return t('midnight.swap.progress.swapping');
    case 'done': return t('midnight.swap.progress.swapped');
    case 'gone': return t('midnight.swap.progress.gone');
    case 'expired': return t('midnight.swap.progress.expired');
    case 'failed': return t('midnight.swap.progress.failed');
    default: return t('midnight.swap.review.title');
  }
});
const leftText = computed(() => (stage.value === 'review' && inspection.value?.expiresAt
  ? t('midnight.swap.review.left', { time: countdownText(inspection.value.expiresAt, now.value) }) : ''));
watch([heading, leftText], () => emit('heading', { title: heading.value, left: leftText.value }), { immediate: true });

async function loadLastTrade(value: SwapOfferInspection) {
  const get = value.get[0];
  const pay = value.pay[0];
  if (!get || !pay || !network.value) return;
  try {
    const { getMidnightApi } = await import('@/api/midnight-api');
    const trade = (await getMidnightApi(network.value).getSwapTrades(get.tokenType, pay.tokenType, 1))?.[0];
    if (!trade) return;
    const legs = { [trade.tokenA]: trade.amountA, [trade.tokenB]: trade.amountB };
    lastTrade.value = swapRateText({ tokenType: get.tokenType, amount: legs[get.tokenType] }, { tokenType: pay.tokenType, amount: legs[pay.tokenType] }, network.value);
  } catch {
    lastTrade.value = '';
  }
}

async function load() {
  stage.value = 'loading';
  error.value = '';
  try {
    const value = await swap.inspectOffer(props.offer);
    inspection.value = value;
    stage.value = 'review';
    void loadLastTrade(value);
  } catch (e) {
    error.value = e instanceof Error && e.message ? e.message : t('midnight.swap.error.invalid');
    stage.value = 'unreadable';
  }
}
onMounted(load);
watch(() => props.offer, load);

async function take() {
  if (!canTake.value || !inspection.value) return;
  busy.value = true;
  error.value = '';
  try {
    const credential = await swap.credential(password.value);
    password.value = '';
    sawProving.value = false;
    stage.value = 'progress';
    txHash.value = await swap.takeOffer(props.offer, { pay: inspection.value.pay, get: inspection.value.get }, credential);
    stage.value = 'done';
  } catch (e) {
    const code = e instanceof MidnightSwapCallError ? e.code : '';
    if (code === 'SWAP_OFFER_GONE') stage.value = 'gone';
    else if (code === 'SWAP_OFFER_EXPIRED') stage.value = 'expired';
    else {
      error.value = e instanceof Error && e.message ? e.message : t('midnight.swap.error.generic');
      // Nothing was asked for yet (a PassKey cancelled, a changed offer): stay on the review.
      stage.value = stage.value === 'progress' ? 'failed' : 'review';
    }
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped lang="scss">
.swap-take {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  min-height: 0;
}

.swap-take__loading {
  display: flex;
  justify-content: center;
  padding: var(--g-s-6) 0;
}

.swap-take__body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.swap-take--wide .swap-take__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--g-s-5);
  align-items: start;
}

.swap-take__col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.swap-take__foot {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.swap-take--wide .swap-take__foot {
  flex-direction: row-reverse;
  justify-content: flex-start;
  align-items: center;
  padding-top: var(--g-s-3);
  border-top: 1px solid var(--g-hairline-1);
}

.swap-take--wide .swap-take__cta {
  min-width: 120px;
}

.swap-take__note {
  margin: 0;
}

.swap-take__type,
.swap-take__hash {
  color: var(--g-text-1);
  overflow-wrap: anywhere;
}

.swap-take__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.swap-steps {
  list-style: none;
  margin: 0;
  padding: var(--g-s-1) 0 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.swap-step {
  display: flex;
  gap: var(--g-s-3);
  align-items: flex-start;
  color: var(--g-text-3);
}

.swap-step__dot {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  border-radius: var(--g-r-pill);
  border: 1px solid var(--g-hairline-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.swap-step--done .swap-step__dot {
  border-color: var(--g-success-line);
  background: var(--g-success-fill);
  color: var(--g-success);
}

.swap-step--active .swap-step__dot {
  border-color: transparent;
}

.swap-step--active .t-body {
  color: var(--g-text-1);
}

.swap-step__meta {
  display: block;
  margin-top: 2px;
}
</style>
