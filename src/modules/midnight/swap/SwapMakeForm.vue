<template>
  <form class="swap-make" @submit.prevent="create()">
    <SwapAmountBox
      v-model="giveInput"
      editable
      :label="t('midnight.swap.youGive')"
      :hint="giveBalanceText"
      :token="giveInfo"
      :input-label="t('midnight.swap.amountGive')"
      :invalid="giveTooHigh"
    >
      <template #token>
        <SwapTokenPicker v-model="giveType" side="give" :network="network" :balances="balances" />
      </template>
    </SwapAmountBox>

    <div class="swap-make__switch">
      <GButton compact class="swap-make__switch-btn" :aria-label="t('midnight.swap.switchSides')" @click="switchSides()">
        <v-icon size="16" aria-hidden="true">mdi-swap-vertical</v-icon>
      </GButton>
    </div>

    <SwapAmountBox
      v-model="wantInput"
      editable
      :label="t('midnight.swap.youWant')"
      :hint="rateText"
      :token="wantInfo"
      :input-label="t('midnight.swap.amountWant')"
    >
      <template #token>
        <SwapTokenPicker v-model="wantType" side="want" :network="network" :balances="balances" />
      </template>
      <template v-if="!wantInfo.isNight" #sub>
        {{ t('midnight.swap.kind.public') }} · <span class="g-mono">{{ shortTokenType(wantType) }}</span>
      </template>
    </SwapAmountBox>

    <SwapBanner v-if="wantType && !wantInfo.listed" tone="warning">
      <span>{{ t('midnight.swap.review.unlisted', { token: wantInfo.symbol }) }}</span>
      <span class="g-mono swap-make__type">{{ groupedTokenType(wantType) }}</span>
    </SwapBanner>

    <div v-if="PRIVATE_SWAP_SUPPORTED" class="swap-make__field">
      <span :id="privacyLabelId" class="t-caption">{{ t('midnight.swap.offerType') }}</span>
      <SwapSegmented v-model="privacy" :options="privacyOptions" :labelledby="privacyLabelId" />
      <span class="t-caption">{{ privacyNote }}</span>
    </div>

    <div class="swap-make__field">
      <span :id="ttlLabelId" class="t-caption">{{ t('midnight.swap.expiresIn') }} <SwapHint :text="t('midnight.swap.hint.expiry')" /></span>
      <SwapSegmented v-model="ttlMinutes" :options="ttlOptions" :labelledby="ttlLabelId" />
    </div>

    <SwapRows :eyebrow="compact ? '' : t('midnight.swap.summary')" :panel="!compact" :rows="summaryRows" :aria-label="t('midnight.swap.summary')" />

    <p class="t-caption swap-make__note">{{ t('midnight.swap.spendCancels', { token: giveInfo.symbol }) }}</p>

    <SwapBanner v-if="error" tone="error">{{ error }}</SwapBanner>
    <SwapBanner v-else-if="holdText" tone="warning">{{ holdText }}</SwapBanner>

    <SwapPasswordField v-model="password" :is-prf-wallet="isPrfWallet" :disabled="busy" @submit="create()" />

    <GButton tier="primary" block type="submit" :disabled="!canCreate" :loading="busy" data-test="swap-create">
      {{ t('midnight.swap.create') }}
    </GButton>
  </form>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useMidnightSendHold } from '@/shared/composables/useMidnightSendHold';
import { midnightCatalogTokens } from '@/chains/midnight/midnightTokenCatalog';
import { MIDNIGHT_SWAP_DEFAULT_TTL, MIDNIGHT_SWAP_TTL_MINUTES, type MidnightSwapTtlMinutes } from '@/chains/midnight/midnightSwapConfig';
import { PRIVATE_SWAP_SUPPORTED } from '@/chains/midnight/midnightPrivateSwap9';
import type { MidnightSwapOfferRecord } from '@/chains/midnight/midnightSwapRecords';
import { injectMidnightSwap } from './swapContext';
import { useSwapBalances } from './useSwapBalances';
import {
  groupedTokenType, NIGHT_TOKEN_TYPE, parseSwapAmount, shortTokenType, swapBalanceText, swapLegText, swapRateText, swapTokenInfo,
} from './swapTokens';
import SwapAmountBox from './SwapAmountBox.vue';
import SwapTokenPicker from './SwapTokenPicker.vue';
import SwapSegmented from './SwapSegmented.vue';
import SwapRows, { type SwapRow } from './SwapRows.vue';
import SwapBanner from './SwapBanner.vue';
import SwapPasswordField from './SwapPasswordField.vue';
import SwapHint from './SwapHint.vue';

withDefaults(defineProps<{
  /** The dashboard card: a shorter summary, nested in the card. */
  compact?: boolean;
}>(), { compact: false });
const emit = defineEmits<{ (e: 'created', record: MidnightSwapOfferRecord): void }>();

const { t } = useTranslation();
const swap = injectMidnightSwap();
const { network, isPrfWallet, offers, now } = swap;
const balances = useSwapBalances(offers, now);
const hold = useMidnightSendHold(() => network.value);
const holdText = computed(() => (hold.held.value ? hold.sendTextShort.value : ''));

const giveType = ref(NIGHT_TOKEN_TYPE);
/** The first listed token that is not NIGHT, else the first held one: a sensible first ask. */
function defaultWant(): string {
  const listed = midnightCatalogTokens.value.find(token => token.verified && token.kind === 'UNSHIELDED');
  if (listed) return listed.tokenType;
  for (const type of balances.value.keys()) if (type !== NIGHT_TOKEN_TYPE) return type;
  return '';
}
const wantType = ref(defaultWant());
watch(() => [midnightCatalogTokens.value.length, balances.value.size], () => { if (!wantType.value) wantType.value = defaultWant(); });

const giveInput = ref('');
const wantInput = ref('');
const ttlMinutes = ref<MidnightSwapTtlMinutes>(MIDNIGHT_SWAP_DEFAULT_TTL);
const privacy = ref<'public' | 'private'>('public');
const password = ref('');
const busy = ref(false);
const error = ref('');

const ttlLabelId = useId();
const privacyLabelId = useId();
const ttlOptions = computed(() => MIDNIGHT_SWAP_TTL_MINUTES.map(value => ({ value, label: t('midnight.swap.minutes', { n: value }) })));
const privacyOptions = computed(() => [
  { value: 'public' as const, label: t('midnight.swap.kind.public') },
  { value: 'private' as const, label: t('midnight.swap.kind.private'), icon: 'mdi-lock-outline' },
]);

const giveInfo = computed(() => swapTokenInfo(giveType.value, network.value));
const wantInfo = computed(() => swapTokenInfo(wantType.value || NIGHT_TOKEN_TYPE, network.value));
const giveAmount = computed(() => parseSwapAmount(giveInput.value, giveInfo.value));
const wantAmount = computed(() => (wantType.value ? parseSwapAmount(wantInput.value, wantInfo.value) : 0n));
const giveBalance = computed(() => balances.value.get(giveType.value) ?? 0n);
const giveTooHigh = computed(() => giveAmount.value > giveBalance.value);
const giveBalanceText = computed(() => t('midnight.swap.available', { amount: swapBalanceText(giveBalance.value, giveInfo.value) }));

const giveLeg = computed(() => ({ tokenType: giveType.value, amount: giveAmount.value.toString() }));
const wantLeg = computed(() => ({ tokenType: wantType.value, amount: wantAmount.value.toString() }));
const rateText = computed(() => (giveAmount.value > 0n && wantAmount.value > 0n ? swapRateText(giveLeg.value, wantLeg.value, network.value) : ''));

const privacyNote = computed(() => (privacy.value === 'private'
  ? t('midnight.swap.privateNote', { token: wantInfo.value.symbol, night: swapTokenInfo(NIGHT_TOKEN_TYPE, network.value).symbol })
  : t('midnight.swap.publicNote')));

const summaryRows = computed<SwapRow[]>(() => {
  const rows: SwapRow[] = [];
  if (giveAmount.value > 0n) rows.push({ label: t('midnight.swap.youGive'), value: swapLegText(giveLeg.value, network.value) });
  if (wantAmount.value > 0n) rows.push({ label: t('midnight.swap.youReceive'), value: swapLegText(wantLeg.value, network.value) });
  rows.push({ label: t('midnight.swap.networkFee'), value: t('midnight.swap.paidByTaker'), tone: 'muted', hint: t('midnight.swap.hint.makerFee') });
  rows.push({ label: t('midnight.swap.visible'), value: t('midnight.swap.visibleBoth'), tone: 'muted', hint: t('midnight.swap.hint.visible') });
  rows.push({ rule: true });
  rows.push({ label: t('midnight.swap.offerFee'), value: t('midnight.swap.none'), tone: 'success' });
  return rows;
});

const canCreate = computed(() => !busy.value && !hold.held.value
  && giveAmount.value > 0n && !giveTooHigh.value && wantAmount.value > 0n
  && !!wantType.value && wantType.value !== giveType.value
  && (isPrfWallet.value || !!password.value));

watch([giveType, wantType, giveInput, wantInput, ttlMinutes], () => { error.value = ''; });

function switchSides() {
  const [type, input] = [giveType.value, giveInput.value];
  giveType.value = wantType.value || NIGHT_TOKEN_TYPE;
  giveInput.value = wantInput.value;
  wantType.value = type;
  wantInput.value = input;
}

async function create() {
  if (!canCreate.value) return;
  busy.value = true;
  error.value = '';
  try {
    const credential = await swap.credential(password.value);
    const record = await swap.makeOffer({ give: giveLeg.value, want: wantLeg.value, ttlMinutes: ttlMinutes.value }, credential);
    password.value = '';
    giveInput.value = '';
    wantInput.value = '';
    emit('created', record);
  } catch (e) {
    error.value = e instanceof Error && e.message ? e.message : t('midnight.swap.error.generic');
  } finally {
    busy.value = false;
  }
}

</script>

<style scoped lang="scss">
.swap-make {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.swap-make__switch {
  display: flex;
  justify-content: center;
  margin: -6px 0;
}

.swap-make__switch-btn {
  min-width: var(--g-btn-h-compact);
}

.swap-make__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.swap-make__note {
  margin: 0;
}

.swap-make__type {
  color: var(--g-text-1);
}
</style>
