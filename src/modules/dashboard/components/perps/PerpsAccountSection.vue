<template>
  <div class="col-account">
    <div class="of-deposit-row">
      <v-btn small outlined class="of-deposit-btn" color="#26FAB0" @click="showDepositDialog = true">
        {{ $t('perpetuals.deposit') }}
      </v-btn>
      <v-btn small outlined class="of-deposit-btn" color="#848e9c" @click="showWithdrawDialog = true">
        {{ $t('perpetuals.withdraw') }}
      </v-btn>
    </div>

    <!-- Deposit Sheet (3-step: amount → review/sign → status) -->
    <DepositSheet v-model="showDepositDialog" @deposited="onDeposited" />

    <!-- Withdraw Sheet (2-step: amount → review/sign → status) -->
    <WithdrawSheet v-model="showWithdrawDialog" @withdrawn="onWithdrawn" />

    <div class="of-account-section mt-3">
      <div class="of-account-header">{{ $t('perpetuals.accountOverview') }}</div>
      <div class="of-account-row">
        <span>{{ $t('perpetuals.accountValue') }}</span>
        <span class="form-value">${{ formatBalance(account?.wallet_balance) }}</span>
      </div>
      <div class="of-account-row">
        <span>{{ $t('perpetuals.availableBalance') }}</span>
        <span class="form-value">${{ formatBalance(account?.available_balance) }}</span>
      </div>
      <div class="of-account-row">
        <span>{{ $t('perpetuals.withdrawableBalance') }}</span>
        <span class="form-value">${{ formatBalance(account?.available_balance) }}</span>
      </div>
      <div class="of-account-row">
        <span>{{ $t('perpetuals.positionValue') }}</span>
        <span class="form-value">${{ formatBalance(account?.total_margin) }}</span>
      </div>
      <div class="of-account-row">
        <span>{{ $t('perpetuals.unrealizedPnl') }}</span>
        <span
          class="form-value"
          :class="parseFloat(account?.unrealized_pnl ?? '0') >= 0 ? 'clr-green' : 'clr-red'"
        >
          ${{ formatBalance(account?.unrealized_pnl) }}
        </span>
      </div>
      <div class="of-account-row">
        <span>{{ $t('perpetuals.marginRatio') }}</span>
        <span class="form-value">{{ marginRatioDisplay }}%</span>
      </div>
      <div class="of-account-row">
        <span>{{ $t('perpetuals.maintenanceMargin') }}</span>
        <span class="form-value">${{ formatBalance(account?.maintenance_margin) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { usePerpsFormatters } from '@/modules/market/composables/perps';
import type { AccountResponse } from '@/api/strike-v2.types';
import DepositSheet from '@/sidepanel/components/perps/DepositSheet.vue';
import WithdrawSheet from '@/sidepanel/components/perps/WithdrawSheet.vue';

const { formatBalance } = usePerpsFormatters();

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

defineProps<{
  account: AccountResponse;
  walletAdaBalance: number;
  livePrice: number;
  marginRatioDisplay: string;
}>();

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const showDepositDialog = ref(false);
const showWithdrawDialog = ref(false);

// ── Emits ──
const emit = defineEmits<{
  (e: 'refresh'): void;
}>();

// ---------------------------------------------------------------------------
// Actions — both sheets emit on success; refresh account/positions upstream.
// ---------------------------------------------------------------------------

function onDeposited() {
  emit('refresh');
}

function onWithdrawn() {
  emit('refresh');
}
</script>

<style scoped>
/* Account section — below order form, right of positions */
.col-account {
  grid-column: 3;
  grid-row: 2;
  display: flex;
  flex-direction: column;
  padding: 10px;
  border-top: 1px solid #2b2f36;
  overflow-y: auto;
  max-width: 230px;
}

/* Deposit/Withdraw row */
.of-deposit-row {
  display: flex;
  gap: 8px;
}

.of-deposit-btn {
  flex: 1;
  text-transform: none !important;
  font-size: 11px !important;
}

/* Account overview */
.of-account-section {
  background: rgba(255,255,255,0.02);
  border-radius: 4px;
  padding: 8px;
}

.of-account-header {
  font-size: 11px;
  font-weight: 600;
  color: #848e9c;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.of-account-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #5e6673;
  line-height: 20px;
}

/* Shared utility classes */
.form-value {
  font-size: 11px;
  font-weight: 600;
  color: #eaecef;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.clr-green { color: #26FAB0 !important; }
.clr-red { color: #F6465D !important; }
</style>
