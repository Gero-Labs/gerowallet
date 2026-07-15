<template>
  <BottomSheet
    :value="value"
    :title="$t('vaults.withdrawFrom', { name: vaultName })"
    height="85%"
    @input="$emit('input', $event)"
  >
    <div class="vwithdraw-content">

      <!-- ── Amount Input ── -->
      <PerpsAmountField
        ref="amountFieldRef"
        v-model="amount"
        currency="USD"
        accent="var(--g-accent)"
        class="mb-3"
        @max="setMax()"
      />

      <!-- ── Preview ── -->
      <transition name="fade-slide">
        <div v-if="amountNum > 0" class="preview-card">
          <div class="preview-title t-label">{{ $t('vaults.withdrawPreview') }}</div>

          <div class="preview-row">
            <span class="preview-label">{{ $t('vaults.amount') }}</span>
            <span class="preview-value">${{ amountNum.toFixed(2) }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-label">{{ $t('perpetuals.estimatedReceived') }}</span>
            <span class="preview-value highlight">~{{ estimatedUsdm }} <span class="preview-unit">USDM</span></span>
          </div>
          <div class="preview-row">
            <span class="preview-label">{{ $t('perpetuals.estimatedDelivery') }}</span>
            <span class="preview-value muted">~{{ deliveryMinutes }} {{ $t('perpetuals.minutes') }}</span>
          </div>
        </div>
      </transition>

      <!-- ── Spending Password ── -->
      <v-text-field
        v-model="password"
        :label="$t('perpetuals.spendingPassword')"
        outlined
        dense
        dark
        hide-details
        class="perp-input mt-3"
        :type="showPassword ? 'text' : 'password'"
        :append-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
        @click:append="showPassword = !showPassword"
      />

      <!-- ── Status Banners ── -->
      <transition name="fade-slide">
        <div v-if="withdrawStatus === 'pending'" class="status-banner status-banner--pending mt-3">
          <v-icon size="14" color="warning" class="mr-2">mdi-clock-sand</v-icon>
          {{ $t('vaults.withdrawPending') }}
        </div>
      </transition>

      <transition name="fade-slide">
        <div v-if="withdrawStatus === 'settled'" class="status-banner status-banner--success mt-3">
          <v-icon size="16" color="success" class="mr-2">mdi-check-circle</v-icon>
          {{ $t('vaults.withdrawSettled') }}
        </div>
      </transition>

      <transition name="fade-slide">
        <div v-if="withdrawError" class="error-banner mt-3">
          <v-icon size="14" color="error" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
          <span>{{ withdrawError }}</span>
        </div>
      </transition>

      <!-- ── Withdraw Button ── -->
      <v-btn
        block
        depressed
        :loading="isWithdrawing"
        :disabled="!canWithdraw"
        class="action-btn mt-4"
        @click="handleWithdraw()"
      >
        <template v-if="isWithdrawing">
          <v-icon size="14" class="mr-2">mdi-loading mdi-spin</v-icon>
          {{ $t('perpetuals.withdrawInProgress') }}
        </template>
        <template v-else>
          <v-icon size="14" class="mr-2">mdi-bank-transfer-out</v-icon>
          {{ $t('vaults.withdraw') }}
        </template>
      </v-btn>

    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import BottomSheet from '@/sidepanel/components/BottomSheet.vue';
import PerpsAmountField from './PerpsAmountField.vue';
import { useStrikeWithdraw } from '@/modules/market/composables/useStrikeWithdraw';

// ── Props & Emits ─────────────────────────────────────────────────────────────
const props = defineProps<{
  value: boolean;
  vaultId: string;
  vaultName: string;
  currentValue: string;
}>();

const emit = defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'withdrawn'): void;
}>();

// ── Composable ────────────────────────────────────────────────────────────────
const {
  isWithdrawing,
  withdrawStatus,
  withdrawError,
  deliveryMinutes,
  requestQuote,
  signAndSubmit,
  resetWithdraw,
} = useStrikeWithdraw();

// ── State ─────────────────────────────────────────────────────────────────────
const amount = ref<string>('');
const amountFieldRef = ref<{ focus: () => void } | null>(null);
const password = ref<string>('');
const showPassword = ref(false);

// ── Computed ──────────────────────────────────────────────────────────────────
const amountNum = computed(() => {
  const n = parseFloat(amount.value);
  return isNaN(n) || n < 0 ? 0 : n;
});

// Withdrawals settle 1:1 in USDM (minus the quote fee, known only after quoting).
const estimatedUsdm = computed(() => {
  if (amountNum.value <= 0) return '0.00';
  return amountNum.value.toFixed(2);
});

const canWithdraw = computed(() =>
  amountNum.value > 0 && password.value.length > 0 && !isWithdrawing.value,
);

// ── Methods ───────────────────────────────────────────────────────────────────
function setMax() {
  const n = parseFloat(props.currentValue);
  if (!isNaN(n) && n > 0) {
    amount.value = n.toFixed(2);
  }
}

async function handleWithdraw() {
  if (!canWithdraw.value) return;
  // Reuse the account withdraw flow. USDM is the only asset Strike accepts on
  // Cardano withdrawals. NOTE (latent, pre-existing): the builder withdraw API
  // has no vault_id — vault withdrawals are a separate /v2/vault/* endpoint
  // family, so this quote is NOT scoped to props.vaultId.
  await requestQuote(amount.value, 'USDM');
  const result = await signAndSubmit(password.value);
  if (result) {
    emit('withdrawn');
  }
}

// Reset on close
watch(() => props.value, (val) => {
  if (!val) {
    amount.value = '';
    password.value = '';
    showPassword.value = false;
    resetWithdraw();
  } else {
    nextTick(() => { amountFieldRef.value?.focus(); });
  }
});
</script>

<style scoped>
.vwithdraw-content {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-bottom: 8px;
}

/* ── Inputs ── */
.perp-input :deep(.v-input__slot) {
  background: var(--g-hairline-1) !important;
  min-height: 40px !important;
}
.perp-input :deep(.v-label) {
  font-size: 12px !important;
  color: var(--g-text-3) !important;
}
.perp-input :deep(input) {
  font-size: 13px !important;
  font-family: var(--g-font-mono) !important;
  color: var(--g-text-1) !important;
  caret-color: var(--g-accent) !important;
}
.perp-input :deep(.v-text-field__suffix) {
  font-size: 11px !important;
  color: var(--g-text-3) !important;
  font-weight: 600 !important;
}
.perp-input :deep(fieldset) {
  border-color: var(--g-hairline-2) !important;
}
.perp-input :deep(.v-input--is-focused fieldset) {
  border-color: var(--g-accent) !important;
}

/* ── Preview Card ── */
.preview-card {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 12px 14px;
  margin-bottom: 12px;
}

.preview-title {
  margin-bottom: 10px;
}

.preview-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid var(--g-hairline-1);
}
.preview-row:last-child { border-bottom: none; }

.preview-label {
  font-size: 11px;
  color: var(--g-text-3);
}

.preview-value {
  font-size: 12px;
  font-family: var(--g-font-mono);
  color: var(--g-text-1);
  font-weight: 600;
}
.preview-value.highlight { color: var(--g-accent); }
.preview-value.muted { color: var(--g-text-3); font-weight: 400; }

.preview-unit {
  font-size: 11px;
  color: var(--g-text-3);
  font-weight: 400;
}

/* ── Status Banners ── */
.status-banner {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-radius: var(--g-r-control);
  font-size: 12px;
  font-weight: 600;
}

.status-banner--pending {
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  color: var(--g-warning);
}

.status-banner--success {
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
  color: var(--g-success);
}

.error-banner {
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: var(--g-r-control);
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  font-size: 11px;
  color: var(--g-error);
  line-height: 1.5;
}

/* ── Action Button ── */
.action-btn {
  height: 44px !important;
  border-radius: var(--g-r-control) !important;
  background: color-mix(in srgb, var(--g-accent) 12%, transparent) !important;
  color: var(--g-accent) !important;
  border: 1px solid color-mix(in srgb, var(--g-accent) 30%, transparent) !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  text-transform: none !important;
  letter-spacing: 0 !important;
}
.action-btn:hover:not(.v-btn--disabled) { background: color-mix(in srgb, var(--g-accent) 20%, transparent) !important; }
.action-btn.v-btn--disabled { opacity: 0.35 !important; }

/* ── Transitions ── */
.fade-slide-enter-active, .fade-slide-leave-active { transition: opacity var(--g-dur-base) ease, transform var(--g-dur-base) ease; }
.fade-slide-enter, .fade-slide-leave-to { opacity: 0; transform: translateY(-6px); }

.mt-3 { margin-top: 12px; }
.mt-4 { margin-top: 16px; }
.mr-2 { margin-right: 8px; }
</style>
