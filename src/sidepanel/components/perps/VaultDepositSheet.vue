<template>
  <BottomSheet
    :value="value"
    :title="$t('vaults.depositTo', { name: vaultName })"
    height="85%"
    @input="$emit('input', $event)"
  >
    <div class="vdeposit-content">

      <!-- ── Amount Input ── -->
      <div class="input-row">
        <v-text-field
          v-model="amount"
          :label="$t('vaults.amountAda')"
          outlined
          dense
          dark
          hide-details
          class="perp-input"
          suffix="ADA"
          type="number"
          min="0"
        />
        <v-btn small depressed class="max-btn" @click="setMax()">
          MAX
        </v-btn>
      </div>

      <!-- ── Preview ── -->
      <transition name="fade-slide">
        <div v-if="amountNum > 0" class="preview-card">
          <div class="preview-title">{{ $t('vaults.depositPreview') }}</div>

          <div class="preview-row">
            <span class="preview-label">{{ $t('vaults.amount') }}</span>
            <span class="preview-value">{{ amountNum.toFixed(2) }} <span class="preview-unit">ADA</span></span>
          </div>
          <div class="preview-row">
            <span class="preview-label">{{ $t('vaults.estimatedShares') }}</span>
            <span class="preview-value highlight">{{ estimatedShares }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-label">{{ $t('vaults.estimatedCredit') }}</span>
            <span class="preview-value highlight">{{ estimatedUsd }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-label">{{ $t('vaults.networkFee') }}</span>
            <span class="preview-value muted">~{{ networkFee }} ADA</span>
          </div>
        </div>
      </transition>

      <!-- ── Stablecoin Warning ── -->
      <div class="warning-banner">
        <v-icon size="14" color="#FFA726" class="mr-2" style="flex-shrink:0">mdi-alert-outline</v-icon>
        <span>{{ $t('perpetuals.stablecoinWarning') }}</span>
      </div>

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
        <div v-if="depositStatus === 'confirmed'" class="success-banner mt-3">
          <v-icon size="16" color="#26FAB0" class="mr-2">mdi-check-circle</v-icon>
          {{ $t('vaults.depositConfirmed') }}
        </div>
      </transition>

      <transition name="fade-slide">
        <div v-if="depositError" class="error-banner mt-3">
          <v-icon size="14" color="#F97066" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
          <span>{{ depositError }}</span>
        </div>
      </transition>

      <!-- ── Deposit Button ── -->
      <v-btn
        block
        depressed
        :loading="isDepositing"
        :disabled="!canDeposit"
        class="action-btn mt-4"
        @click="handleDeposit()"
      >
        <template v-if="isDepositing">
          <v-icon size="14" class="mr-2">mdi-loading mdi-spin</v-icon>
          {{ $t('perpetuals.depositInProgress') }}
        </template>
        <template v-else>
          <v-icon size="14" class="mr-2">mdi-bank-transfer-in</v-icon>
          {{ $t('vaults.deposit') }}
        </template>
      </v-btn>

    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BottomSheet from '@/sidepanel/components/BottomSheet.vue';
import { useStrikeDeposit } from '@/modules/market/composables/useStrikeDeposit';
import { walletStore } from '@/stores/walletStore';

// ── Props & Emits ─────────────────────────────────────────────────────────────
const props = defineProps<{
  value: boolean;
  vaultId: string;
  vaultName: string;
}>();

const emit = defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'deposited'): void;
}>();

// ── Composable ────────────────────────────────────────────────────────────────
const {
  isDepositing,
  depositStatus,
  depositError,
  adaToUsdRate,
  networkFee,
  requestQuote,
  buildAndSign,
  resetDeposit,
} = useStrikeDeposit();

// ── State ─────────────────────────────────────────────────────────────────────
const amount = ref<string>('');
const password = ref<string>('');
const showPassword = ref(false);

// ── Computed ──────────────────────────────────────────────────────────────────
const amountNum = computed(() => {
  const n = parseFloat(amount.value);
  return isNaN(n) || n < 0 ? 0 : n;
});

const maxAda = computed(() => {
  const balances = walletStore.state.balances;
  if (!balances) return 0;
  const lovelace = balances.lovelace ?? balances.ada ?? 0;
  const ada = Number(lovelace) / 1_000_000;
  return Math.max(0, ada - 2);
});

const estimatedUsd = computed(() => {
  if (amountNum.value <= 0) return '$0.00';
  const rate = adaToUsdRate.value ?? 0;
  return `$${(amountNum.value * rate).toFixed(2)}`;
});

/** Very rough share estimate: treat 1 share = 1 USD of vault equity.
 * The actual ratio comes from the vault contract; this is display-only. */
const estimatedShares = computed(() => {
  if (amountNum.value <= 0) return '0.0000';
  const usd = amountNum.value * (adaToUsdRate.value ?? 0);
  return usd.toFixed(4);
});

const canDeposit = computed(() =>
  amountNum.value > 0 && password.value.length > 0 && !isDepositing.value,
);

// ── Methods ───────────────────────────────────────────────────────────────────
function setMax() {
  amount.value = maxAda.value.toFixed(2);
}

async function handleDeposit() {
  if (!canDeposit.value) return;
  await requestQuote(amount.value);
  const result = await buildAndSign(password.value, props.vaultId);
  if (result) {
    emit('deposited');
  }
}

// Reset on close
watch(() => props.value, (val) => {
  if (!val) {
    amount.value = '';
    password.value = '';
    showPassword.value = false;
    resetDeposit();
  }
});
</script>

<style scoped>
.vdeposit-content {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-bottom: 8px;
}

/* ── Amount Row ── */
.input-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
}

.input-row .perp-input { flex: 1; }

.max-btn {
  height: 40px !important;
  padding: 0 12px !important;
  border-radius: 8px !important;
  background: color-mix(in srgb, var(--chain-primary) 10%, transparent) !important;
  color: var(--chain-primary) !important;
  border: 1px solid color-mix(in srgb, var(--chain-primary) 25%, transparent) !important;
  font-size: 10px !important;
  font-weight: 800 !important;
  letter-spacing: 0.06em !important;
  text-transform: none !important;
  flex-shrink: 0;
  margin-top: 0 !important;
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
.preview-value.highlight { color: #26FAB0; }
.preview-value.muted { color: rgba(255, 255, 255, 0.45); font-weight: 400; }

.preview-unit {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.35);
  font-weight: 400;
}

/* ── Warning Banner ── */
.warning-banner {
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 167, 38, 0.08);
  border: 1px solid rgba(255, 167, 38, 0.22);
  font-size: 11px;
  color: rgba(255, 167, 38, 0.9);
  line-height: 1.5;
}

/* ── Banners ── */
.success-banner {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(38, 250, 176, 0.08);
  border: 1px solid rgba(38, 250, 176, 0.22);
  font-size: 12px;
  font-weight: 600;
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
