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
        <SwapTokenPicker v-model="giveType" side="give" :network="network" :balances="pickerBalances" :private="isPrivate" />
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
        <SwapTokenPicker v-model="wantType" side="want" :network="network" :balances="pickerBalances" :private="isPrivate" />
      </template>
      <template v-if="!wantInfo.isNight" #sub>
        {{ wantShielded ? t('midnight.swap.kind.private') : t('midnight.swap.kind.public') }} · <span class="g-mono">{{ shortTokenType(wantType) }}</span>
      </template>
    </SwapAmountBox>

    <SwapBanner v-if="wantType && !wantInfo.listed" tone="warning">
      <span>{{ t('midnight.swap.review.unlisted', { token: wantInfo.symbol }) }}</span>
      <span class="g-mono swap-make__type">{{ groupedTokenType(wantType) }}</span>
    </SwapBanner>

    <div v-if="MIDNIGHT_SWAP_PRIVATE_LEGS" class="swap-make__field">
      <span :id="privacyLabelId" class="t-caption">{{ t('midnight.swap.offerType') }}</span>
      <SwapSegmented v-model="privacy" :options="privacyOptions" :labelledby="privacyLabelId" />
      <span class="t-caption">{{ privacyNote }}</span>
    </div>

    <!-- A fully private offer has no TTL to choose: its expiry is the chain's root window, an estimate. -->
    <div v-if="!fullyPrivate" class="swap-make__field">
      <span :id="ttlLabelId" class="t-caption">{{ t('midnight.swap.expiresIn') }} <SwapHint :text="t('midnight.swap.hint.expiry')" /></span>
      <SwapSegmented v-model="ttlMinutes" :options="ttlOptions" :labelledby="ttlLabelId" />
    </div>

    <SwapRows :eyebrow="compact ? '' : t('midnight.swap.summary')" :panel="!compact" :rows="summaryRows" :aria-label="t('midnight.swap.summary')" />

    <p class="t-caption swap-make__note">{{ t('midnight.swap.spendCancels', { token: giveInfo.symbol }) }}</p>

    <SwapBanner v-if="error" tone="error">{{ error }}</SwapBanner>
    <SwapBanner v-else-if="proverMissing" tone="warning" data-test="swap-private-prover">{{ t('midnight.swap.error.privateProver') }}</SwapBanner>
    <SwapBanner v-else-if="holdText" tone="warning">{{ holdText }}</SwapBanner>

    <SwapPasswordField v-model="password" :is-prf-wallet="isPrfWallet" :disabled="busy" @submit="create()" />

    <GButton tier="primary" block type="submit" :disabled="!canCreate" :loading="busy" data-test="swap-create">
      {{ t('midnight.swap.create') }}
    </GButton>
    <p v-if="busy && isPrivate" class="t-caption swap-make__note" role="status">{{ t('midnight.swap.makingPrivate') }}</p>
  </form>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useMidnightSendHold } from '@/shared/composables/useMidnightSendHold';
import { midnightCatalogTokens } from '@/chains/midnight/midnightTokenCatalog';
import { isNativeNight } from '@/chains/midnight/midnightTokenBalances';
import {
  MIDNIGHT_SWAP_DEFAULT_TTL, MIDNIGHT_SWAP_PRIVATE_ESTIMATE_MINUTES, MIDNIGHT_SWAP_PRIVATE_LEGS, MIDNIGHT_SWAP_TTL_MINUTES,
  type MidnightSwapTtlMinutes,
} from '@/chains/midnight/midnightSwapConfig';
import type { MidnightSwapLeg, MidnightSwapOfferRecord } from '@/chains/midnight/midnightSwapRecords';
import { injectMidnightSwap } from './swapContext';
import { useSwapBalances } from './useSwapBalances';
import { privateSwapProverReady, swapPrivacyNote, swapVisibleText, usePrivateSwapBalances } from './swapPrivacy';
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
const privateBalances = usePrivateSwapBalances(offers, now);
const hold = useMidnightSendHold(() => network.value);
const holdText = computed(() => (hold.held.value ? hold.sendTextShort.value : ''));

const giveType = ref(NIGHT_TOKEN_TYPE);
/** The first listed token that is not NIGHT, else the first held one (privately held too, for a private offer): a sensible first ask. */
function defaultWant(includePrivate = false): string {
  // Never NIGHT itself (the catalog lists it too) nor the token given.
  const other = (type: string) => !isNativeNight(type) && type !== giveType.value;
  const kinds = includePrivate ? ['UNSHIELDED', 'SHIELDED'] : ['UNSHIELDED'];
  const listed = midnightCatalogTokens.value.find(token => token.verified && kinds.includes(token.kind) && other(token.tokenType));
  if (listed) return listed.tokenType;
  for (const type of balances.value.keys()) if (other(type)) return type;
  if (includePrivate) for (const type of privateBalances.value?.keys() ?? []) if (other(type)) return type;
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

// Private: every token but NIGHT (always public) is a private leg.
const isPrivate = computed(() => MIDNIGHT_SWAP_PRIVATE_LEGS && privacy.value === 'private');
const giveShielded = computed(() => isPrivate.value && !giveInfo.value.isNight);
const wantShielded = computed(() => isPrivate.value && !!wantType.value && !wantInfo.value.isNight);
const fullyPrivate = computed(() => giveShielded.value && wantShielded.value);
/** Private legs need a prover that can prove them (a proof server today): said before the password is asked for. */
const proverMissing = computed(() => isPrivate.value && !privateSwapProverReady.value);
/** What the pickers list: public balances, or NIGHT's public one beside the private ones. */
const pickerBalances = computed<ReadonlyMap<string, bigint>>(() => {
  if (!isPrivate.value) return balances.value;
  const merged = new Map(privateBalances.value ?? []);
  const night = balances.value.get(NIGHT_TOKEN_TYPE);
  if (night !== undefined) merged.set(NIGHT_TOKEN_TYPE, night);
  return merged;
});
watch([isPrivate, pickerBalances], () => { if (isPrivate.value && !wantType.value) wantType.value = defaultWant(true); });
const giveBalance = computed(() => pickerBalances.value.get(giveType.value) ?? 0n);
const privateUnknown = computed(() => giveShielded.value && privateBalances.value === null);
const giveTooHigh = computed(() => !privateUnknown.value && giveAmount.value > giveBalance.value);
const giveBalanceText = computed(() => (privateUnknown.value
  ? t('midnight.swap.privateSyncing')
  : t('midnight.swap.available', { amount: swapBalanceText(giveBalance.value, giveInfo.value) })));

const leg = (tokenType: string, amount: bigint, shielded: boolean): MidnightSwapLeg =>
  (shielded ? { tokenType, amount: amount.toString(), shielded: true } : { tokenType, amount: amount.toString() });
const giveLeg = computed(() => leg(giveType.value, giveAmount.value, giveShielded.value));
const wantLeg = computed(() => leg(wantType.value, wantAmount.value, wantShielded.value));
const rateText = computed(() => (giveAmount.value > 0n && wantAmount.value > 0n ? swapRateText(giveLeg.value, wantLeg.value, network.value) : ''));

const privacyNote = computed(() => {
  const note = swapPrivacyNote([giveLeg.value, ...(wantType.value ? [wantLeg.value] : [])], network.value, t);
  return isPrivate.value ? `${note} ${t('midnight.swap.provingMinute')}` : note;
});

const summaryRows = computed<SwapRow[]>(() => {
  const rows: SwapRow[] = [];
  if (giveAmount.value > 0n) rows.push({ label: t('midnight.swap.youGive'), value: swapLegText(giveLeg.value, network.value) });
  if (wantAmount.value > 0n) rows.push({ label: t('midnight.swap.youReceive'), value: swapLegText(wantLeg.value, network.value) });
  rows.push({ label: t('midnight.swap.networkFee'), value: t('midnight.swap.paidByTaker'), tone: 'muted', hint: t('midnight.swap.hint.makerFee') });
  if (fullyPrivate.value) {
    rows.push({ label: t('midnight.swap.expiresInRow'), value: t('midnight.swap.expiresAbout', { n: MIDNIGHT_SWAP_PRIVATE_ESTIMATE_MINUTES }), tone: 'muted', hint: t('midnight.swap.hint.estimate') });
  }
  rows.push({
    label: t('midnight.swap.visible'),
    value: swapVisibleText([giveLeg.value, wantLeg.value], network.value, t),
    tone: 'muted',
    hint: t(isPrivate.value ? 'midnight.swap.hint.visiblePrivate' : 'midnight.swap.hint.visible'),
  });
  rows.push({ rule: true });
  rows.push({ label: t('midnight.swap.offerFee'), value: t('midnight.swap.none'), tone: 'success' });
  return rows;
});

const canCreate = computed(() => !busy.value && !hold.held.value && !proverMissing.value
  && giveAmount.value > 0n && !giveTooHigh.value && wantAmount.value > 0n
  && !!wantType.value && wantType.value !== giveType.value
  && (isPrfWallet.value || !!password.value));

watch([giveType, wantType, giveInput, wantInput, ttlMinutes, privacy], () => { error.value = ''; });

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
