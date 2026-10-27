<template>
  <BaseDialog
    size="sm"
    :isOpen="modelValue"
    :title="t('gomining.withdrawEarnings')"
    :img="assts.withdrawalSvg"
    img-color="var(--g-accent)"
    :min-height="0"
    :loading="submitting"
    :persistent="submitting"
    @close="close()"
  >
    <v-card-text class="px-5 pt-1 pb-5 gm-withdraw">
      <div class="t-caption gm-withdraw__balance">
        <span>{{ $t('gomining.availableBalance') }}</span>
        <span class="g-num gm-withdraw__balance-value">{{ formatBtc(availableSats) }} BTC</span>
      </div>

      <!-- Destination: the linked payout address, whole, so it can be checked. gero-backend sends nowhere else. -->
      <div class="gm-field">
        <span id="gm-withdraw-destination" class="t-label">{{ $t('gomining.destinationAddress') }}</span>
        <div class="gm-input gm-input--static" aria-labelledby="gm-withdraw-destination">
          <v-icon size="small" class="gm-input__check">mdi-check-circle</v-icon>
          <span class="g-mono gm-input__static">{{ payoutAddress }}</span>
        </div>
      </div>

      <!-- Amount -->
      <label class="gm-field">
        <span class="t-label">{{ $t('gomining.withdrawAmount') }}</span>
        <span :class="['gm-input', { 'gm-input--error': !!amountError }]">
          <span class="gm-input__unit g-mono">BTC</span>
          <input
            :value="amount"
            class="t-body-lg g-num gm-input__control gm-input__control--amount"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0.00000000"
            @input="onAmountInput"
          />
          <GButton tier="tertiary" compact @click="setMax()">{{ $t('common.max') }}</GButton>
        </span>
        <span v-if="amountError" class="t-caption gm-field__error">{{ amountError }}</span>
      </label>

      <!-- Withdrawal type -->
      <div class="gm-field">
        <span id="gm-withdraw-type" class="t-label">{{ $t('gomining.withdrawalType') }}</span>
        <div class="gm-types" role="radiogroup" aria-labelledby="gm-withdraw-type">
          <button
            v-for="type in withdrawTypes"
            :key="type.key"
            type="button"
            role="radio"
            :aria-checked="speed === type.key ? 'true' : 'false'"
            :class="['glass-tier', 'gm-type', { 'gm-type--selected': speed === type.key }]"
            @click="speed = type.key"
          >
            <span class="gm-type__top">
              <v-icon size="small">{{ type.icon }}</v-icon>
              <span class="t-body-sm gm-type__name">{{ type.label }}</span>
            </span>
            <span class="t-caption">{{ type.note }}</span>
          </button>
        </div>
      </div>

      <!-- GoMining's fast-withdrawal fee -->
      <dl v-if="speed === 'fast' && amountSats && fastFeeSats !== null" class="gm-summary">
        <div class="t-body-sm gm-summary__row">
          <dt>{{ $t('gomining.goMiningFee') }}</dt>
          <dd class="g-num">{{ formatBtc(fastFeeSats) }} BTC</dd>
        </div>
        <div class="t-body-sm gm-summary__row gm-summary__row--total">
          <dt>{{ $t('gomining.youWillReceive') }}</dt>
          <dd class="g-num gm-summary__in">{{ formatBtc(Math.max(0, amountSats - fastFeeSats)) }} BTC</dd>
        </div>
      </dl>

      <div v-if="errorMessage" class="t-body-sm gm-notice gm-notice--error" role="alert">
        <v-icon size="small">mdi-alert-circle-outline</v-icon>
        <span class="gm-notice__text">{{ errorMessage }}</span>
      </div>

      <div class="gm-withdraw__nav">
        <GButton tier="secondary" :disabled="submitting" @click="close()">{{ $t('common.cancel') }}</GButton>
        <GButton tier="primary" :loading="submitting" :disabled="!isValid || submitting" @click="submit()">
          <v-icon size="small" start>mdi-arrow-up-circle-outline</v-icon>
          {{ $t('gomining.confirmWithdraw') }}
        </GButton>
      </div>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import goMiningApi, { type GoMiningWithdrawalSpeed, type GoMiningWithdrawalTerms } from '@/api/gomining-api';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatBtc } from '@/shared/utils/format';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import assts from '@/utils/assets';
import { parseBtcInput, satsToBtcInput } from '../goMiningPayment';
import { goMiningErrorMessage } from '../useGoMiningAccount';

const props = defineProps<{
  modelValue: boolean;
  payoutAddress: string;
  availableSats: number;
  withSession: <T>(call: (token: string) => Promise<T>) => Promise<T>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  success: [];
}>();

const { t } = useTranslation();

const amount = ref('');
const speed = ref<GoMiningWithdrawalSpeed>('fast');
const terms = ref<GoMiningWithdrawalTerms | null>(null);
const submitting = ref(false);
const errorMessage = ref('');
/** One id per withdrawal, so a retry after a lost reply is not paid out twice. */
let requestId = crypto.randomUUID();

const withdrawTypes = computed(() => [
  { key: 'fast' as const, icon: 'mdi-lightning-bolt', label: t('gomining.fastWithdrawal'), note: t('gomining.fastWithdrawalNote') },
  { key: 'standard' as const, icon: 'mdi-clock-outline', label: t('gomining.standardWithdrawal'), note: t('gomining.standardWithdrawalNote') },
]);

const amountSats = computed(() => parseBtcInput(amount.value));

const fastFeeSats = computed(() => {
  const value = amountSats.value;
  const current = terms.value;
  if (!value || !current) return null;
  if (current.fastFeeSats !== null) return current.fastFeeSats;
  if (current.fastFeePercent !== null) return Math.ceil((value * current.fastFeePercent) / 100);
  return null;
});

// Shown once something has been typed.
const amountError = computed(() => {
  if (!amount.value) return '';
  const value = amountSats.value;
  if (!value) return t('gomining.enterValidAmount');
  if (value > props.availableSats) return t('gomining.exceedsBalance');
  if (speed.value === 'fast' && terms.value && value < terms.value.fastMinSats) {
    return t('gomining.belowFastMinimum', { amount: `${formatBtc(terms.value.fastMinSats)} BTC` });
  }
  return '';
});

const isValid = computed(() => !!amountSats.value && !amountError.value && !!props.payoutAddress);

function onAmountInput(event: Event) {
  amount.value = (event.target as HTMLInputElement).value;
}

function setMax() {
  amount.value = satsToBtcInput(props.availableSats);
}

async function loadTerms() {
  try {
    terms.value = await props.withSession((token) => goMiningApi.getWithdrawalTerms(token));
  } catch {
    // Without terms the backend still refuses an amount under the minimum.
    terms.value = null;
  }
}

async function submit() {
  const value = amountSats.value;
  if (!isValid.value || !value || submitting.value) return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    await props.withSession((token) => goMiningApi.withdraw(token, { amountSats: value, speed: speed.value, requestId }));
    requestId = crypto.randomUUID();
    submitting.value = false;
    emit('success');
    close();
  } catch (error) {
    errorMessage.value = goMiningErrorMessage(error, t);
  } finally {
    submitting.value = false;
  }
}

function close() {
  if (submitting.value) return;
  emit('update:modelValue', false);
}

watch(() => props.modelValue, (open) => {
  if (!open) return;
  amount.value = '';
  speed.value = 'fast';
  errorMessage.value = '';
  requestId = crypto.randomUUID();
  void loadTerms();
}, { immediate: true });
</script>

<style scoped lang="scss">
/* Sits above BaseDialog's decorative rings, which are positioned. */
.gm-withdraw {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.gm-withdraw__balance {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}

.gm-withdraw__balance-value {
  color: var(--g-text-1);
  font-weight: 600;
}

/* ── Fields ─────────────────────────────────────────────── */
.gm-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gm-field__error {
  color: var(--g-error);
}

/* Inputs are controls, not surfaces: solid raised fill. The focus ring lives on the
   wrapper, so the bare input inside needs none of its own. */
.gm-input {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  min-height: var(--g-btn-h);
  padding: 0 var(--g-s-1) 0 var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  transition: border-color var(--g-dur-fast) var(--g-ease);
}

.gm-input:focus-within {
  border-color: var(--g-accent);
}

.gm-input--error,
.gm-input--error:focus-within {
  border-color: var(--g-error);
}

.gm-input--static {
  align-items: flex-start;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
}

.gm-input--static .gm-input__check {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--g-success);
}

.gm-input__static {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--g-text-1);
  overflow-wrap: anywhere;
}

.gm-input__unit {
  color: var(--g-text-3);
}

.gm-input__control {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--g-btn-h);
  border: 0;
  background: transparent;
  color: var(--g-text-1);
}

/* The wrapper paints focus (focus-within). The bare control keeps its own ring but
   transparent, so forced-colors mode can still paint one. */
.gm-input__control:focus-visible {
  outline-color: transparent;
}

.gm-input__control::placeholder {
  color: var(--g-text-3);
}

.gm-input__control--amount {
  font-weight: 600;
}

/* A number field without the browser's spin buttons */
.gm-input__control--amount::-webkit-outer-spin-button,
.gm-input__control--amount::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.gm-input__control--amount[type='number'] {
  -moz-appearance: textfield;
}

/* ── Withdrawal type ────────────────────────────────────── */
.gm-types {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--g-s-2);
}

.gm-type {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-1);
  min-width: 0;
  padding: var(--g-s-3);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}

.gm-type:hover {
  @include g-glass-tier-hover;
}

.gm-type--selected,
.gm-type--selected:hover {
  @include g-glass-tier-active;
}

.gm-type__top {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.gm-type__top .v-icon {
  color: var(--g-text-2);
}

.gm-type--selected .gm-type__top .v-icon {
  color: var(--g-accent);
}

.gm-type__name {
  color: var(--g-text-1);
  font-weight: 600;
}

/* ── Summary ────────────────────────────────────────────── */
.gm-summary {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.gm-summary__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) 0;
  border-top: 1px solid var(--g-hairline-1);
}

.gm-summary__row dt {
  color: var(--g-text-3);
}

.gm-summary__row dd {
  margin: 0;
  color: var(--g-text-1);
  text-align: right;
}

.gm-summary__row--total dt {
  color: var(--g-text-1);
}

.gm-summary__row--total dd {
  font-weight: 600;
}

.gm-summary__row dd.gm-summary__in {
  color: var(--g-success);
}

.gm-notice {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
}

.gm-notice--error {
  color: var(--g-error);
}

.gm-notice__text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.gm-withdraw__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
</style>
