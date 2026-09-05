<template>
  <!-- History tab's detail pane for a Midnight row — mirrors the top summary
       block of the Cardano TransactionDetails.vue (hash/time/fee/amount) for
       the fields Midnight actually has, then renders the existing
       MidnightTxUtxos.vue (fetch-once-per-hash cache, loading + retryable
       error state from b3e52746) for the Inputs/Outputs breakdown that used
       to live inline in MidnightTransactionsList.vue's expanding rows. -->
  <v-card-text class="px-0 justify-center text-center" style="z-index: 1">
    <div class="mn-tx-details text-left pb-4">
      <div class="mn-tx-details__row">
        {{ $t('transactions.transactionId') }}:
        <span class="mn-tx-details__mono ml-1">{{ shortHash(transactionInfo.hash) }}</span>
        <CopyButton x-small :value="transactionInfo.hash" class="ml-1" />
      </div>

      <div class="mn-tx-details__row">
        {{ $t('common.time') }}:
        <span class="mn-tx-details__value ml-1">{{ formatTime(transactionInfo.timestamp) }}</span>
      </div>

      <div v-if="transactionInfo.blockHeight" class="mn-tx-details__row">
        {{ $t('transactions.blockHeight') }}:
        <span class="mn-tx-details__value ml-1">{{ transactionInfo.blockHeight.toLocaleString('en-US') }}</span>
      </div>

      <div class="mn-tx-details__row">
        {{ $t('transactions.transactionType') }}:
        <span class="mn-tx-details__value ml-1">{{ typeLabel(transactionInfo.type) }}</span>
      </div>

      <div class="mn-tx-details__row">
        {{ $t('common.status') }}:
        <span class="mn-tx-details__value ml-1" :class="statusClass">{{ statusLabel }}</span>
      </div>

      <!-- gero-sync does not forward the DUST fee paid by unshielded txs —
           never fabricate one, always render the placeholder (see the DUST
           fee TODO in midnight-sync.service.ts's parseTx). -->
      <div class="mn-tx-details__row">
        {{ $t('transactions.transactionFee') }}:
        <span class="mn-tx-details__value ml-1">—</span>
      </div>

      <div class="mn-tx-details__row">
        {{ $t('transactions.amount') }}:
        <span class="mn-tx-details__amount ml-1" :class="amountClass">
          {{ formattedAmount }}
          <v-tooltip v-if="isUnscaledAmount" top content-class="custom-tooltip">
            <template v-slot:activator="{ on, attrs }">
              <v-icon x-small color="warning" v-bind="attrs" v-on="on">mdi-help-circle-outline</v-icon>
            </template>
            {{ $t('midnight.rawBalanceNotice') }}
          </v-tooltip>
        </span>
      </div>
    </div>

    <MidnightTxUtxos
      :tx-hash="transactionInfo.hash"
      :tx-type="transactionInfo.type"
      :tx-token="transactionInfo.token"
      :tx-counterparty="transactionInfo.counterparty"
    />
  </v-card-text>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import MidnightTxUtxos from './MidnightTxUtxos.vue';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import type { MidnightTransaction, MidnightTransactionType } from '@/chains/midnight/midnightTypes';
import { midnightTokenMeta } from '@/chains/midnight/midnightTokenRegistry';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

const props = defineProps<{ transactionInfo: MidnightTransaction }>();

const isMainnet = computed(() => walletStore.loggedWallet?.network === Network.MAINNET);

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);
const DUST_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.DUST);

/** Base-unit divisor for a token, or null when its decimals aren't known. */
function tokenDivisor(token: string): bigint | null {
  if (token === 'NIGHT') return NIGHT_DIVISOR;
  if (token === 'DUST') return DUST_DIVISOR;
  const meta = midnightTokenMeta(token);
  return meta ? 10n ** BigInt(meta.decimals) : null;
}

function currencySymbol(token: string): string {
  if (token === 'NIGHT' || token === 'DUST') {
    return isMainnet.value ? token : `t${token}`;
  }
  // Head+tail truncation, not a prefix — see midnightTokenRegistry.ts.
  return midnightTokenMeta(token)?.symbol ?? `${token.slice(0, 8)}…${token.slice(-6)}`;
}

const isUnscaledAmount = computed(() => tokenDivisor(props.transactionInfo.token) === null);

function formatBigDecimal(value: bigint, divisor: bigint, fractionDigits: number): string {
  if (value < 0n) value = 0n;
  const whole = value / divisor;
  const remainder = value % divisor;
  const remainderStr = remainder.toString().padStart(divisor.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, fractionDigits).padEnd(fractionDigits, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

const formattedAmount = computed(() => {
  const tx = props.transactionInfo;
  const sign = tx.type === 'receive' ? '+' : tx.type === 'send' ? '−' : '';
  const divisor = tokenDivisor(tx.token);
  if (divisor === null) {
    return `${sign}${tx.amount.toString()} ${currencySymbol(tx.token)}`;
  }
  const fractionDigits = tx.token === 'DUST' ? 4 : 2;
  return `${sign}${formatBigDecimal(tx.amount, divisor, fractionDigits)} ${currencySymbol(tx.token)}`;
});

const amountClass = computed(() => {
  if (props.transactionInfo.type === 'receive') return 'mn-tx-details__amount--in';
  if (props.transactionInfo.type === 'send') return 'mn-tx-details__amount--out';
  return '';
});

const statusLabel = computed(() => {
  switch (props.transactionInfo.status) {
    case 'confirmed': return t('transactions.confirmed');
    case 'pending': return t('transactions.pending');
    case 'failed': return t('transactions.failed');
    default: return t('common.unknown');
  }
});

const statusClass = computed(() => {
  if (props.transactionInfo.status === 'failed') return 'mn-tx-details__status--error';
  if (props.transactionInfo.status === 'pending') return 'mn-tx-details__status--pending';
  return '';
});

function typeLabel(type: MidnightTransactionType): string {
  switch (type) {
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

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString();
}

function shortHash(hash: string): string {
  if (!hash) return '';
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}
</script>

<style scoped>
.mn-tx-details__row {
  display: flex;
  align-items: center;
  font-size: 13px;
  color: var(--g-text-2);
  padding: 2px 0;
}

.mn-tx-details__mono {
  font-family: var(--g-font-mono);
  font-size: 11px;
  color: var(--g-text-1);
  word-break: break-all;
}

.mn-tx-details__value {
  color: var(--g-text-1);
}

.mn-tx-details__amount {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}

.mn-tx-details__amount--in {
  color: var(--g-success);
}

.mn-tx-details__amount--out {
  color: var(--g-error);
}

.mn-tx-details__status--error {
  color: var(--g-error);
}

.mn-tx-details__status--pending {
  color: var(--g-warning);
}
</style>
