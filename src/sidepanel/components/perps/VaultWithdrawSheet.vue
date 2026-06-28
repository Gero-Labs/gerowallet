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
        accent="var(--chain-primary)"
        class="mb-3"
        @max="setMax()"
      />

      <!-- ── Preview ── -->
      <transition name="fade-slide">
        <div v-if="amountNum > 0" class="preview-card">
          <div class="preview-title">{{ $t('vaults.withdrawPreview') }}</div>

          <div class="preview-row">
            <span class="preview-label">{{ $t('vaults.amount') }}</span>
            <span class="preview-value">${{ amountNum.toFixed(2) }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-label">{{ $t('perpetuals.estimatedReceived') }}</span>
            <span class="preview-value highlight">{{ estimatedAda }} <span class="preview-unit">ADA</span></span>
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
          <v-icon size="14" color="#FFA726" class="mr-2">mdi-clock-sand</v-icon>
          {{ $t('vaults.withdrawPending') }}
        </div>
      </transition>

      <transition name="fade-slide">
        <div v-if="withdrawStatus === 'settled'" class="status-banner status-banner--success mt-3">
          <v-icon size="16" color="#26FAB0" class="mr-2">mdi-check-circle</v-icon>
          {{ $t('vaults.withdrawSettled') }}
        </div>
      </transition>

      <transition name="fade-slide">
        <div v-if="withdrawError" class="error-banner mt-3">
          <v-icon size="14" color="#F97066" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
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
  usdToAdaRate,
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

const estimatedAda = computed(() => {
  if (amountNum.value <= 0) return '0.00';
  const rate = usdToAdaRate.value ?? 0;
  return (amountNum.value * rate).toFixed(2);
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
  // Reuse account withdraw flow — pass vault_id as destination/ref context
  await requestQuote(amount.value, 'ADA', '', props.vaultId);
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
  background: rgba(255, 255, 255, 0.04) !important;
  min-height: 40px !important;
}
.perp-input :deep(.v-label) {
  font-size: 12px !important;
  color: rgba(255, 255, 255, 0.4) !important;
}
.perp-input :deep(input) {
  font-size: 13px !important;
  font-family: 'JetBrains Mono', 'Fira Code', monospace !important;
  color: #ffffff !important;
  caret-color: var(--chain-primary) !important;
}
.perp-input :deep(.v-text-field__suffix) {
  font-size: 11px !important;
  color: rgba(255, 255, 255, 0.35) !important;
  font-weight: 600 !important;
}
.perp-input :deep(fieldset) {
  border-color: rgba(255, 255, 255, 0.1) !important;
}
.perp-input :deep(.v-input--is-focused fieldset) {
  border-color: var(--chain-primary) !important;
}

/* ── Preview Card ── */
.preview-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 12px;
}

.preview-title {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 10px;
}

.preview-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.preview-row:last-child { border-bottom: none; }

.preview-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.preview-value {
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 600;
}
.preview-value.highlight { color: var(--chain-primary); }
.preview-value.muted { color: rgba(255, 255, 255, 0.45); font-weight: 400; }

.preview-unit {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.35);
  font-weight: 400;
}

/* ── Status Banners ── */
.status-banner {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}

.status-banner--pending {
  background: rgba(255, 167, 38, 0.08);
  border: 1px solid rgba(255, 167, 38, 0.22);
  color: #FFA726;
}

.status-banner--success {
  background: rgba(38, 250, 176, 0.08);
  border: 1px solid rgba(38, 250, 176, 0.22);
  color: #26FAB0;
}

.error-banner {
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(249, 112, 102, 0.08);
  border: 1px solid rgba(249, 112, 102, 0.22);
  font-size: 11px;
  color: #F97066;
  line-height: 1.5;
}

/* ── Action Button ── */
.action-btn {
  height: 44px !important;
  border-radius: 10px !important;
  background: color-mix(in srgb, var(--chain-primary) 12%, transparent) !important;
  color: var(--chain-primary) !important;
  border: 1px solid color-mix(in srgb, var(--chain-primary) 30%, transparent) !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  text-transform: none !important;
  letter-spacing: 0.02em !important;
}
.action-btn:hover:not(.v-btn--disabled) { background: color-mix(in srgb, var(--chain-primary) 20%, transparent) !important; }
.action-btn.v-btn--disabled { opacity: 0.35 !important; }

/* ── Transitions ── */
.fade-slide-enter-active, .fade-slide-leave-active { transition: all 0.25s ease; }
.fade-slide-enter, .fade-slide-leave-to { opacity: 0; transform: translateY(-6px); }

.mt-3 { margin-top: 12px; }
.mt-4 { margin-top: 16px; }
.mr-2 { margin-right: 8px; }
</style>
