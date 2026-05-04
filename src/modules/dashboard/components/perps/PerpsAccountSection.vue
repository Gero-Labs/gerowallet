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

    <!-- Deposit Dialog -->
    <v-dialog v-model="showDepositDialog" max-width="425" dark>
      <v-card class="perps-modal">
        <div class="perps-modal__header">
          <span class="perps-modal__title">{{ $t('perpetuals.deposit') }}</span>
          <v-icon size="20" @click="showDepositDialog = false" class="perps-modal__close">mdi-close</v-icon>
        </div>
        <div class="perps-modal__body">
          <!-- Deposit Token selector -->
          <div class="deposit-section-label">{{ $t('perpetuals.depositToken') }}</div>
          <div class="mb-3">
            <v-menu offset-y :attach="true">
              <template #activator="{ on, attrs }">
                <div class="deposit-token-trigger" v-bind="attrs" v-on="on">
                  <span>{{ depositToken }}</span>
                  <v-icon size="14" class="ml-auto">mdi-chevron-down</v-icon>
                </div>
              </template>
              <v-list dense dark class="of-asset-list">
                <v-list-item
                  v-for="t in depositTokenOptions"
                  :key="t"
                  @click="depositToken = t"
                  :class="{ 'of-asset-list__current-item': depositToken === t }"
                >
                  <v-list-item-title>{{ t }}</v-list-item-title>
                </v-list-item>
              </v-list>
            </v-menu>
          </div>

          <!-- Amount -->
          <div class="deposit-section-label">
            <span>{{ $t('common.amount') }}</span>
            <span class="deposit-balance">Balance: {{ depositToken === 'ADA' ? walletAdaBalance.toFixed(2) : '—' }} {{ depositToken }}</span>
          </div>
          <div class="of-field mb-1">
            <input v-model="depositAmount" type="text" inputmode="decimal" class="of-field__input" placeholder="0.00" />
            <span class="of-field__suffix">{{ depositToken }}</span>
          </div>
          <div class="deposit-max-link" @click="depositAmount = depositToken === 'ADA' ? String(Math.max(0, walletAdaBalance - 5).toFixed(2)) : ''">
            {{ $t('perpetuals.addMaxAmount') }}
          </div>

          <!-- Info rows -->
          <div class="deposit-info mt-3">
            <div class="of-est-row">
              <span class="price-info-label--dashed">{{ $t('perpetuals.currentAdaPrice') }}</span>
              <span class="form-value">${{ (livePrice ?? 0).toFixed(5) }}</span>
            </div>
            <div class="of-est-row">
              <span class="price-info-label--dashed">{{ $t('perpetuals.batcherFee') }}</span>
              <span class="form-value">2 ADA</span>
            </div>
            <div class="of-est-row">
              <span class="price-info-label--dashed">{{ $t('perpetuals.estBalanceAdded') }}</span>
              <span class="form-value">{{ depositEstBalance }}</span>
            </div>
          </div>
        </div>

        <v-btn
          block
          color="#26FAB0"
          class="perps-modal__confirm"
          :loading="depositLoading"
          :disabled="!depositAmount || parseFloat(depositAmount) <= 0"
          @click="executeDeposit()"
        >
          {{ $t('perpetuals.deposit') }}
        </v-btn>

        <div class="deposit-disclaimer mt-3">
          {{ $t('perpetuals.depositDisclaimer') }}
        </div>
      </v-card>
    </v-dialog>

    <!-- Withdraw Dialog -->
    <v-dialog v-model="showWithdrawDialog" max-width="380" dark>
      <v-card class="perps-modal">
        <div class="perps-modal__header">
          <span class="perps-modal__title">{{ $t('perpetuals.withdraw') }}</span>
          <v-icon size="20" @click="showWithdrawDialog = false" class="perps-modal__close">mdi-close</v-icon>
        </div>
        <div class="perps-modal__body">
          <div class="of-field mb-3">
            <span class="of-field__label">{{ $t('common.amount') }}</span>
            <input v-model="withdrawAmount" type="text" inputmode="decimal" class="of-field__input" />
            <span class="of-field__suffix">USD</span>
          </div>
          <div class="of-est-row mb-1">
            <span>{{ $t('perpetuals.withdrawableBalance') }}</span>
            <span class="form-value">${{ formatBalance(account?.available_balance) }}</span>
          </div>
        </div>
        <v-btn
          block
          color="#26FAB0"
          class="perps-modal__confirm"
          :loading="withdrawLoading"
          :disabled="!withdrawAmount || parseFloat(withdrawAmount) <= 0"
          @click="executeWithdraw()"
        >
          {{ $t('perpetuals.withdraw') }}
        </v-btn>
      </v-card>
    </v-dialog>

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
import { computed, ref } from 'vue';
import { usePerpsFormatters } from '@/modules/market/composables/perps';
import { walletStore } from '@/stores/walletStore';
import { strikeUserApi } from '@/api/strike-v2.user';
import type { AccountResponse } from '@/api/strike-v2.types';
import snackbar from '@/plugins/snackbar';

const { formatBalance } = usePerpsFormatters();

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const props = defineProps<{
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
const depositAmount = ref('');
const depositTokenOptions: ('ADA' | 'USDM')[] = ['ADA', 'USDM'];
const depositToken = ref<'ADA' | 'USDM'>('ADA');
const withdrawAmount = ref('');
const depositLoading = ref(false);
const withdrawLoading = ref(false);

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const depositEstBalance = computed(() => {
  const amt = parseFloat(depositAmount.value) || 0;
  if (amt <= 0) return '—';
  const batcherFee = 2;
  if (depositToken.value === 'ADA') {
    const price = props.livePrice ?? 0;
    if (!price) return '—';
    const usdValue = (amt - batcherFee) * price;
    return usdValue > 0 ? `$${usdValue.toFixed(2)}` : '—';
  }
  // USDM is 1:1 USD
  return `$${amt.toFixed(2)}`;
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

// Deposit — per Integrator Guide Section 16.1
// Cardano: quote -> build TX via backend -> sign -> confirm
async function executeDeposit() {
  depositLoading.value = true;
  try {
    const amountLovelace = String(Math.floor(parseFloat(depositAmount.value) * 1_000_000));
    const quote = await strikeUserApi.getDepositQuote({
      blockchain: 'cardano',
      asset_symbol: 'ADA',
      asset_amount: amountLovelace,
    });
    // TODO: Build and sign the on-chain deposit TX via POST /api/perpetuals/deposit
    // For now, show the quote info
    snackbar.fireSuccess(`Deposit quote: $${quote.quote.usd_value} — on-chain TX signing coming soon`);
    showDepositDialog.value = false;
    depositAmount.value = '';
  } catch (e) {
    snackbar.setError(e instanceof Error ? e.message : String(e));
  } finally {
    depositLoading.value = false;
  }
}

// Withdraw — per Integrator Guide Section 16.2
// Quote -> sign message -> execute (+ Cardano batcher fee TX)
async function executeWithdraw() {
  withdrawLoading.value = true;
  try {
    const address = walletStore.loggedWallet?.stakeAddress ?? '';
    const quote = await strikeUserApi.getWithdrawQuote({
      usd_value: withdrawAmount.value,
      blockchain: 'cardano',
      recipient_address: address,
      asset: 'ADA',
    });
    // TODO: Sign quote.message_to_sign with wallet, then call executeWithdraw
    snackbar.fireSuccess(`Withdraw quote received (${quote.withdraw_id}) — wallet signing coming soon`);
    showWithdrawDialog.value = false;
    withdrawAmount.value = '';
  } catch (e) {
    snackbar.setError(e instanceof Error ? e.message : String(e));
  } finally {
    withdrawLoading.value = false;
  }
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

/* Deposit dialog */
.deposit-section-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 13px;
  font-weight: 600;
  color: #eaecef;
  margin-bottom: 6px;
}

.deposit-balance {
  font-size: 11px;
  font-weight: 400;
  color: #848e9c;
}

.deposit-token-trigger {
  display: flex;
  align-items: center;
  width: 100%;
  height: 40px;
  font-size: 13px;
  font-weight: 500;
  color: #eaecef;
  cursor: pointer;
  background: #1e2026;
  border-radius: 6px;
  padding: 0 12px;
}

.deposit-token-trigger .v-icon {
  color: #848e9c !important;
}

.deposit-max-link {
  font-size: 12px;
  font-weight: 600;
  color: #26FAB0;
  cursor: pointer;
  margin-top: 4px;
}

.deposit-max-link:hover {
  text-decoration: underline;
}

.deposit-info {
  border-top: 1px solid #2b2f36;
  padding-top: 12px;
}

.deposit-disclaimer {
  font-size: 11px;
  color: #848e9c;
  line-height: 1.5;
}

/* Perps modal dialogs */
.perps-modal {
  background: #0b0e11 !important;
  border-radius: 12px !important;
  padding: 24px !important;
  border: 1px solid #2b2f36;
  overflow: hidden !important;
  max-width: 425px;
}

.perps-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.perps-modal__title {
  font-size: 18px;
  font-weight: 700;
  color: #eaecef;
}

.perps-modal__close {
  color: #848e9c !important;
  cursor: pointer;
}

.perps-modal__body {
  margin-bottom: 16px;
}

.perps-modal__confirm {
  color: #0b0e11 !important;
  font-weight: 700 !important;
  text-transform: none !important;
  border-radius: 8px !important;
  height: 44px !important;
}

/* Custom field */
.of-field {
  display: flex;
  align-items: center;
  border: 1px solid #2b2f36;
  border-radius: 4px;
  padding: 0 6px 0 10px;
  height: 36px;
  background: transparent;
  transition: border-color 0.15s ease-out;
}

.of-field:focus-within {
  border-color: #26FAB0;
}

.of-field__label {
  font-size: 11px;
  color: #848e9c;
  white-space: nowrap;
  margin-right: 8px;
}

.of-field__input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 12px;
  color: #eaecef;
  min-width: 0;
  text-align: left;
}

/* Hide number input spinners */
.of-field__input::-webkit-outer-spin-button,
.of-field__input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.of-field__suffix {
  font-size: 12px;
  color: #848e9c;
  margin-left: 8px;
  white-space: nowrap;
}

/* Estimates */
.of-est-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #5e6673;
  line-height: 20px;
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

.price-info-label--dashed {
  text-decoration: underline dotted #848e9c;
  text-underline-offset: 2px;
  cursor: pointer;
}

.clr-green { color: #26FAB0 !important; }
.clr-red { color: #F6465D !important; }

/* Asset list (for deposit token menu) */
.of-asset-list {
  background: #1b1d23 !important;
  padding: 2px 0 !important;
}

.of-asset-list .v-list-item {
  min-height: 28px !important;
  padding: 0 12px !important;
}

.of-asset-list .v-list-item__title {
  font-size: 12px !important;
  font-weight: 500;
  color: #848e9c;
  text-align: right;
}

.of-asset-list .v-list-item:hover .v-list-item__title {
  color: #eaecef;
}

.of-asset-list__current-item {
  opacity: 1 !important;
}

.of-asset-list__current-item .v-list-item__title {
  color: #eaecef !important;
  font-weight: 600 !important;
}
</style>
