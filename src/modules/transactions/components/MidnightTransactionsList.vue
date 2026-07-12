<template>
  <!-- Full-page Midnight tx history — the Midnight branch of /transactions.
       The Cardano page's tabs (history + UTxO set with detail panes) don't
       map onto Midnight's event model, so this renders one clean list. -->
  <v-card flat class="liquid-glass mn-tx-list">
    <div class="mn-tx-list__head">
      <span class="mn-tx-list__title">
        {{ $t('transactions.history') }} ({{ sorted.length }})
      </span>
    </div>

    <div v-if="sorted.length === 0" class="mn-tx-list__empty">
      {{ $t('transactions.noTransactionsFound') }}
    </div>

    <div v-else class="mn-tx-list__rows">
      <div v-for="tx in sorted" :key="tx.hash" class="mn-tx-row">
        <div class="mn-tx-row__main">
          <div class="mn-tx-row__type">{{ typeLabel(tx) }}</div>
          <div class="mn-tx-row__meta">
            <span v-if="tx.counterparty" class="mn-tx-row__counterparty">
              {{ shortAddress(tx.counterparty) }} ·
            </span>
            <span>{{ formatTime(tx.timestamp) }}</span>
            <span v-if="tx.blockHeight"> · #{{ tx.blockHeight }}</span>
          </div>
        </div>
        <div class="mn-tx-row__hash">
          <span class="mn-tx-row__hash-text">{{ shortHash(tx.hash) }}</span>
          <v-btn icon x-small class="ml-1" @click="copyHash(tx.hash)">
            <v-icon x-small>mdi-content-copy</v-icon>
          </v-btn>
        </div>
        <div class="mn-tx-row__amount" :style="{ color: amountColor(tx.type) }">
          {{ formatAmountSigned(tx) }}
        </div>
      </div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import type { MidnightTransaction, MidnightTransactionType } from '@/chains/midnight/midnightTypes';
import { useTranslation } from '@/shared/composables/useTranslation';
import snackbar from '@/plugins/snackbar';

const { t } = useTranslation();
const { transactions } = toRefs(midnightStore);
const { loggedWallet } = toRefs(walletStore);

const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);
const DUST_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.DUST);

const sorted = computed<MidnightTransaction[]>(() =>
  [...transactions.value].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)),
);

function currencySymbol(token: string): string {
  const base = token === 'DUST' ? 'DUST' : 'NIGHT';
  return isMainnet.value ? base : `t${base}`;
}

function formatBigDecimal(value: bigint, divisor: bigint, fractionDigits: number): string {
  if (value < 0n) value = 0n;
  const whole = value / divisor;
  const remainder = value % divisor;
  if (fractionDigits === 0) return whole.toLocaleString('en-US');
  const remainderStr = remainder.toString().padStart(divisor.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, fractionDigits).padEnd(fractionDigits, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

function typeLabel(tx: MidnightTransaction): string {
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
  const divisor = tx.token === 'NIGHT' ? NIGHT_DIVISOR : DUST_DIVISOR;
  const fractionDigits = tx.token === 'NIGHT' ? 2 : 4;
  const sign = tx.type === 'receive' ? '+' : tx.type === 'send' ? '−' : '';
  return `${sign}${formatBigDecimal(tx.amount, divisor, fractionDigits)} ${currencySymbol(tx.token)}`;
}

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString();
}

function shortAddress(addr: string): string {
  if (!addr) return '';
  const sepIdx = addr.indexOf('1');
  const prefix = sepIdx > 0 ? addr.slice(0, sepIdx) : addr.slice(0, 7);
  return `${prefix}…${addr.slice(-4)}`;
}

function shortHash(hash: string): string {
  if (!hash) return '';
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

async function copyHash(hash: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(hash);
    snackbar.fireSuccess(t('common.copied'));
  } catch {
    snackbar.setError(t('common.somethingWentWrong'));
  }
}
</script>

<style scoped>
.mn-tx-list {
  padding: 14px 16px;
  border-radius: 14px;
}

.mn-tx-list__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.mn-tx-list__title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.mn-tx-list__empty {
  padding: 32px 0;
  text-align: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
}

.mn-tx-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.mn-tx-row:last-child {
  border-bottom: none;
}

.mn-tx-row__main {
  flex: 1;
  min-width: 0;
}

.mn-tx-row__type {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
}

.mn-tx-row__meta {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mn-tx-row__counterparty {
  font-family: 'Roboto Mono', monospace;
}

.mn-tx-row__hash {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.mn-tx-row__hash-text {
  font-family: 'Roboto Mono', monospace;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.mn-tx-row__amount {
  flex-shrink: 0;
  font-family: 'Roboto Mono', monospace;
  font-size: 13px;
  font-weight: 600;
  min-width: 140px;
  text-align: right;
}
</style>
