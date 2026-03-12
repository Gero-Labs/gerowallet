<template>
  <div class="card-approved-view">
    <!-- Card visual -->
    <div class="card-visual">
      <div class="card-face">
        <div class="card-logo">GERO</div>
        <div class="card-number">
          <span v-if="maskedPan">{{ maskedPan }}</span>
          <span v-else>**** **** **** ****</span>
        </div>
        <div class="card-footer">
          <div class="card-holder">
            <span class="card-label">{{ $t('card.cardHolder') }}</span>
            <span class="card-value">{{ holderName }}</span>
          </div>
          <div class="card-type-badge">{{ cardType }}</div>
        </div>
      </div>
    </div>

    <!-- Balance -->
    <div class="balance-section">
      <span class="balance-label">{{ $t('card.balance') }}</span>
      <div class="balance-row">
        <span class="balance-amount" v-if="!loadingBalance">
          {{ formattedBalance }}
        </span>
        <v-progress-circular
          v-else
          indeterminate
          size="20"
          width="2"
          color="#00c7f3"
        />
        <span class="balance-currency">EUR</span>
      </div>
    </div>

    <!-- Quick actions -->
    <div class="quick-actions">
      <v-btn class="action-btn" @click="showTopUp = true">
        <v-icon small class="mr-1">mdi-arrow-up-bold</v-icon>
        {{ $t('card.topUp') }}
      </v-btn>
      <v-btn class="action-btn" @click="showManage = true">
        <v-icon small class="mr-1">mdi-cog-outline</v-icon>
        {{ $t('card.manage') }}
      </v-btn>
    </div>

    <!-- Recent transactions -->
    <div class="tx-section">
      <div class="tx-header">
        <span class="tx-title">{{ $t('card.recentTransactions') }}</span>
      </div>

      <div v-if="loadingHistory" class="tx-loading">
        <v-progress-circular indeterminate size="24" width="2" color="#00c7f3" />
      </div>

      <div v-else-if="recentTransactions.length === 0" class="tx-empty">
        <v-icon color="#555">mdi-receipt-text-outline</v-icon>
        <span>{{ $t('card.noTransactionsYet') }}</span>
      </div>

      <div v-else class="tx-list">
        <div
          v-for="tx in recentTransactions"
          :key="tx.reference"
          class="tx-item"
        >
          <div class="tx-icon-wrap">
            <v-icon small :color="tx.debit ? '#ff6b6b' : '#4caf50'">
              {{ tx.debit ? 'mdi-arrow-up' : 'mdi-arrow-down' }}
            </v-icon>
          </div>
          <div class="tx-info">
            <span class="tx-name">{{ tx.narrative || tx.processingName }}</span>
            <span class="tx-date">{{ formatDate(tx.createTime) }}</span>
          </div>
          <div class="tx-amount" :class="{ debit: tx.debit, credit: !tx.debit }">
            {{ tx.debit ? '-' : '+' }}{{ formatAmount(tx.amount.amount) }} {{ tx.amount.currencyCode }}
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom sheet: Top Up -->
    <BottomSheet v-model="showTopUp" :title="$t('card.topUp')">
      <div class="sheet-content">
        <p class="sheet-message">{{ $t('card.topUpFromFullDashboard') }}</p>
        <v-btn block class="full-dashboard-btn" @click="openFullDashboard">
          <v-icon small class="mr-1">mdi-arrow-expand</v-icon>
          {{ $t('miniGero.openFullDashboard') }}
        </v-btn>
      </div>
    </BottomSheet>

    <!-- Bottom sheet: Manage -->
    <BottomSheet v-model="showManage" :title="$t('card.manage')">
      <div class="sheet-content">
        <p class="sheet-message">{{ $t('card.manageFromFullDashboard') }}</p>
        <v-btn block class="full-dashboard-btn" @click="openFullDashboard">
          <v-icon small class="mr-1">mdi-arrow-expand</v-icon>
          {{ $t('miniGero.openFullDashboard') }}
        </v-btn>

        <v-btn
          block
          text
          class="logout-btn mt-3"
          @click="handleLogout"
        >
          <v-icon small class="mr-1">mdi-logout</v-icon>
          {{ $t('wallet.logout') }}
        </v-btn>
      </div>
    </BottomSheet>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import cardHelpers from '@/stores/modules/card';
import { cardStore } from '@/stores/modules/card';
import BottomSheet from '@/sidepanel/components/BottomSheet.vue';
import type { CardTransactionHistory } from '@/models/card';

const showTopUp = ref(false);
const showManage = ref(false);
const loadingBalance = ref(false);
const loadingHistory = ref(false);

const selectedCard = computed(() => cardHelpers.getSelectedCard());

const maskedPan = computed(() => {
  const pan = selectedCard.value?.cardData?.pan;
  if (!pan) return '';
  const last4 = pan.slice(-4);
  return `**** **** **** ${last4}`;
});

const holderName = computed(() => {
  return selectedCard.value?.cardData?.card_holder_name || cardStore.userInfo?.email || '---';
});

const cardType = computed(() => {
  return (selectedCard.value?.cardData?.own_type || 'virtual').toUpperCase();
});

const formattedBalance = computed(() => {
  const balance = selectedCard.value?.cardBalance?.currentBalance?.amount;
  if (balance === undefined || balance === null) return '0.00';
  return Number(balance).toFixed(2);
});

const recentTransactions = computed((): CardTransactionHistory[] => {
  const records = selectedCard.value?.cardHistory?.records || [];
  return records.slice(0, 5);
});

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatAmount(amount: number): string {
  return Math.abs(amount).toFixed(2);
}

function openFullDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html#/card') });
}

async function handleLogout() {
  try {
    await cardHelpers.logout();
  } catch (error) {
    console.error('Logout failed:', error);
  }
}

onMounted(async () => {
  try {
    loadingBalance.value = true;
    loadingHistory.value = true;
    await Promise.all([
      cardHelpers.fetchCardBalance(),
      cardHelpers.fetchCardHistory(),
    ]);
  } catch (error) {
    console.error('Failed to load card data:', error);
  } finally {
    loadingBalance.value = false;
    loadingHistory.value = false;
  }
});
</script>

<style scoped>
.card-approved-view {
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 16px;
  height: 100%;
  overflow-y: auto;
}

/* Card visual */
.card-visual {
  width: 100%;
}

.card-face {
  width: 100%;
  aspect-ratio: 1.586;
  max-height: 180px;
  background: linear-gradient(145deg, #1a2332 0%, #0d1520 50%, #162030 100%);
  border-radius: 14px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  border: 1px solid rgba(0, 199, 243, 0.15);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  position: relative;
  overflow: hidden;
}

.card-face::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -30%;
  width: 200px;
  height: 200px;
  background: radial-gradient(circle, rgba(0, 199, 243, 0.08) 0%, transparent 70%);
  pointer-events: none;
}

.card-logo {
  font-size: 18px;
  font-weight: 800;
  color: #00c7f3;
  letter-spacing: 2px;
}

.card-number {
  font-size: 15px;
  font-weight: 500;
  color: #ccc;
  letter-spacing: 2px;
  font-family: 'Courier New', monospace;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
}

.card-holder {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-label {
  font-size: 9px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.card-value {
  font-size: 12px;
  color: #bbb;
  text-transform: uppercase;
}

.card-type-badge {
  font-size: 10px;
  font-weight: 600;
  color: #00c7f3;
  background: rgba(0, 199, 243, 0.12);
  padding: 3px 8px;
  border-radius: 4px;
  letter-spacing: 1px;
}

/* Balance */
.balance-section {
  text-align: center;
  padding: 12px 0;
}

.balance-label {
  font-size: 12px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.balance-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  margin-top: 4px;
}

.balance-amount {
  font-size: 28px;
  font-weight: 700;
  color: #fff;
}

.balance-currency {
  font-size: 14px;
  color: #888;
  font-weight: 500;
}

/* Quick actions */
.quick-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.action-btn {
  height: 40px !important;
  border-radius: 10px !important;
  background: #1a1a1a !important;
  border: 1px solid #2a2a2a !important;
  text-transform: none !important;
  font-weight: 600 !important;
  font-size: 13px !important;
  letter-spacing: 0 !important;
  color: #ccc !important;
}

.action-btn:hover {
  background: #222 !important;
  border-color: #00c7f3 !important;
  color: #00c7f3 !important;
}

/* Transactions */
.tx-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
}

.tx-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.tx-title {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.tx-loading {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}

.tx-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 0;
  font-size: 13px;
  color: #555;
}

.tx-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #1a1a1a;
  border-radius: 10px;
}

.tx-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #222;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tx-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tx-name {
  font-size: 13px;
  color: #ccc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-date {
  font-size: 11px;
  color: #666;
}

.tx-amount {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.tx-amount.debit {
  color: #ff6b6b;
}

.tx-amount.credit {
  color: #4caf50;
}

/* Sheet content */
.sheet-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sheet-message {
  font-size: 14px;
  color: #888;
  text-align: center;
  margin: 0;
}

.full-dashboard-btn {
  height: 44px !important;
  border-radius: 10px !important;
  background: linear-gradient(135deg, #00c7f3 0%, #00ffd1 100%) !important;
  text-transform: none !important;
  font-weight: 600 !important;
  font-size: 14px !important;
  letter-spacing: 0 !important;
  color: #0a0a0a !important;
}

.logout-btn {
  height: 36px !important;
  text-transform: none !important;
  font-size: 13px !important;
  letter-spacing: 0 !important;
  color: #888 !important;
}

.logout-btn:hover {
  color: #ff4d4d !important;
}
</style>
