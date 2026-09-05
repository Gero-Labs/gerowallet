<template>
  <!-- Visual mirror of `RecentTransactionsCard.vue` (Cardano). Same DOM
       hierarchy + class names so the design language is identical; only the
       data source (midnightStore.transactions) and tx-type semantics differ. -->
  <v-card
    outlined
    class="fill-height d-flex flex-column glass-panel recent-tx-card"
  >
    <div class="recent-tx-header flex-grow-0">
      <span class="recent-tx-heading">{{ $t('dashboard.recentTransactions') }}</span>
      <router-link to="/transactions" class="recent-tx-view-all">
        {{ $t('dashboard.viewAll') }}
      </router-link>
    </div>

    <v-card-text class="pa-0 flex-grow-1 d-flex flex-column recent-tx-body">
      <div
        v-if="recent.length === 0"
        class="recent-tx-empty d-flex flex-column align-center justify-center flex-grow-1"
      >
        <v-icon small color="grey">mdi-clipboard-text-outline</v-icon>
        <span class="text-caption text--secondary mt-1">
          {{ $t('transactions.noTransactionsFound') }}
        </span>
      </div>

      <div v-else class="recent-tx-list flex-grow-1">
        <div
          v-for="tx in recent"
          :key="`${tx.hash}-${tx.token}`"
          class="recent-tx-row"
        >
          <div class="recent-tx-meta">
            <div class="recent-tx-status">{{ statusLabel(tx) }}</div>
            <div class="recent-tx-time">
              <span v-if="tx.counterparty">{{ shortAddress(tx.counterparty) }} · </span>{{ formatTime(tx.timestamp) }}
            </div>
          </div>
          <div class="recent-tx-amount-wrap">
            <span class="recent-tx-amount" :style="{ color: amountColor(tx.type) }">
              {{ formatAmountSigned(tx) }}
            </span>
            <v-tooltip v-if="isUnscaled(tx.token)" top content-class="custom-tooltip">
              <template v-slot:activator="{ on, attrs }">
                <v-icon x-small color="warning" v-bind="attrs" v-on="on">mdi-help-circle-outline</v-icon>
              </template>
              {{ $t('midnight.rawBalanceNotice') }}
            </v-tooltip>
          </div>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import type { MidnightTransaction, MidnightTransactionType } from '@/chains/midnight/midnightTypes';
import { midnightTokenMeta } from '@/chains/midnight/midnightTokenRegistry';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

const { transactions } = toRefs(midnightStore);
const { loggedWallet } = toRefs(walletStore);

const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);

// Recent compact view shows the latest five — matches Cardano's RecentTransactionsCard.
const recent = computed<MidnightTransaction[]>(() =>
  [...(transactions.value ?? [])]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 5),
);

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);
const DUST_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.DUST);

function formatBigDecimal(value: bigint, divisor: bigint, fractionDigits: number): string {
  if (value < 0n) value = -value;
  const whole = value / divisor;
  const remainder = value % divisor;
  if (fractionDigits === 0) return whole.toLocaleString('en-US');
  const remainderStr = remainder.toString().padStart(divisor.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, fractionDigits).padEnd(fractionDigits, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

function currencySymbol(token: string): string {
  if (token === 'NIGHT' || token === 'DUST') {
    return isMainnet.value ? token : `t${token}`;
  }
  // A real token color (not NIGHT/DUST). Fall back to a head+tail truncation
  // — not a prefix, so a malicious issuer can't grind a colliding prefix and
  // impersonate a listed token (same reasoning as MidnightHoldingsTable.vue).
  return midnightTokenMeta(token)?.symbol ?? `${token.slice(0, 8)}…${token.slice(-6)}`;
}

/** Base-unit divisor for a token, or null when its decimals aren't known. */
function tokenDivisor(token: string): bigint | null {
  if (token === 'NIGHT') return NIGHT_DIVISOR;
  if (token === 'DUST') return DUST_DIVISOR;
  const meta = midnightTokenMeta(token);
  return meta ? 10n ** BigInt(meta.decimals) : null;
}

/**
 * True when the token's decimals are unknown, so the amount shown is the raw
 * base-unit integer rather than a scaled value. Never guess an exponent —
 * a wrong balance is worse than an obviously-unscaled one (see e0af42bc).
 */
function isUnscaled(token: string): boolean {
  return tokenDivisor(token) === null;
}

function statusLabel(tx: MidnightTransaction): string {
  switch (tx.type) {
    case 'send': return t('transactions.sent');
    case 'receive': return t('transactions.received');
    case 'register_dust': return t('midnight.txRegisterDust');
    case 'deregister_dust': return t('midnight.txDeregisterDust');
    case 'shield': return t('midnight.txShield');
    case 'unshield': return t('midnight.txUnshield');
    case 'contract_call': return t('midnight.txContractCall');
    default: return t('transactions.transaction');
  }
}

function amountColor(type: MidnightTransactionType): string {
  if (type === 'receive') return '#47CD89';
  if (type === 'send') return '#F97066';
  return '#c4c4c4';
}

function formatAmountSigned(tx: MidnightTransaction): string {
  const sign = tx.type === 'receive' ? '+' : tx.type === 'send' ? '−' : '';
  const divisor = tokenDivisor(tx.token);
  if (divisor === null) {
    // Unknown color: raw base units, no guessed exponent (see e0af42bc).
    return `${sign}${tx.amount.toString()} ${currencySymbol(tx.token)}`;
  }
  const fractionDigits = tx.token === 'DUST' ? 4 : 2;
  return `${sign}${formatBigDecimal(tx.amount, divisor, fractionDigits)} ${currencySymbol(tx.token)}`;
}

// Truncate a bech32m Midnight address to "mn_addr…<last4>" for the tx list.
function shortAddress(addr: string): string {
  if (!addr) return '';
  const sepIdx = addr.indexOf('1');
  const prefix = sepIdx > 0 ? addr.slice(0, sepIdx) : addr.slice(0, 7);
  return `${prefix}…${addr.slice(-4)}`;
}

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}
</script>

<!-- Style block copied verbatim from RecentTransactionsCard.vue so the two
     cards are visually indistinguishable. -->
<style scoped lang="scss">
.recent-tx-card {
  /* Surface from the shared .glass-panel material (same as Cardano's
     RecentTransactionsCard) so the hero cards read identically across chains. */
  overflow: hidden;
}

.recent-tx-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 6px 12px;
  line-height: 1;
}

.recent-tx-heading {
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
  line-height: 1;
}

.recent-tx-view-all {
  font-size: 11px;
  color: #c4c4c4;
  text-decoration: none;
  line-height: 1;
}

.recent-tx-view-all:hover {
  color: #ffffff;
}

.recent-tx-body {
  overflow: hidden;
}

.recent-tx-empty {
  opacity: 0.7;
}

.recent-tx-list {
  display: flex;
  flex-direction: column;
  padding: 2px 6px 6px 6px;
  overflow: hidden;
}

.recent-tx-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  min-height: 30px;
}

.recent-tx-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.recent-tx-meta {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
}

.recent-tx-status {
  font-size: 11px;
  font-weight: 500;
  color: #ffffff;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-tx-time {
  font-size: 10px;
  color: #8a8a8a;
  line-height: 1;
}

.recent-tx-amount-wrap {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  max-width: 45%;
}

.recent-tx-amount {
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  text-align: right;
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
