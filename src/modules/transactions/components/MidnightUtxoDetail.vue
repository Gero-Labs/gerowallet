<template>
  <!-- UTxOs tab's detail pane, mirroring UtxoDetail.vue's plain-row layout
       (owner/amount/ref rows, no v-data-table) for the Midnight fields that
       actually exist: owner, token + amount, intentHash, outputIndex, ctime,
       and registeredForDustGeneration — the flag the DUST registration UI
       keys on. -->
  <v-card-text class="px-0 justify-center text-center" style="z-index: 1">
    <div class="mn-utxo-detail text-left pb-4">
      <div class="mn-utxo-detail__row">
        {{ $t('transactions.address') }}:
        <span class="mn-utxo-detail__mono ml-1">{{ utxo.owner }}</span>
        <CopyButton x-small :value="utxo.owner" class="ml-1 flex-shrink-0" />
      </div>

      <div class="mn-utxo-detail__row mt-2">
        {{ $t('transactions.amount') }}:
        <span class="mn-utxo-detail__amount ml-1">
          {{ utxo.amountFormatted }}
          <v-tooltip v-if="utxo.isUnscaledAmount" top content-class="custom-tooltip">
            <template v-slot:activator="{ on, attrs }">
              <v-icon x-small color="warning" v-bind="attrs" v-on="on">mdi-help-circle-outline</v-icon>
            </template>
            {{ $t('midnight.rawBalanceNotice') }}
          </v-tooltip>
        </span>
      </div>

      <div class="mn-utxo-detail__row mt-2">
        {{ $t('midnight.intentHash') }}:
        <span class="mn-utxo-detail__mono ml-1">{{ shortHash(utxo.intentHash) }}</span>
        <CopyButton x-small :value="utxo.intentHash" class="ml-1" />
      </div>

      <div class="mn-utxo-detail__row mt-1">
        {{ $t('transactions.outputIndex') }}:
        <span class="mn-utxo-detail__value ml-1">{{ utxo.outputIndex }}</span>
      </div>

      <div v-if="utxo.ctime" class="mn-utxo-detail__row mt-1">
        {{ $t('common.time') }}:
        <span class="mn-utxo-detail__value ml-1">{{ formatTime(utxo.ctime) }}</span>
      </div>

      <div class="mt-2">
        <v-chip v-if="utxo.registeredForDustGeneration" small outlined color="success">
          <v-icon small class="mr-1">mdi-lightning-bolt</v-icon>
          {{ $t('midnight.registered') }}
        </v-chip>
        <span v-else class="mn-utxo-detail__value">{{ $t('midnight.statusUnregistered') }}</span>
      </div>
    </div>
  </v-card-text>
</template>

<script setup lang="ts">
import CopyButton from '@/shared/components/CopyButton.vue';
import type { MidnightUtxoRow } from './MidnightUtxosTable.vue';

defineProps<{ utxo: MidnightUtxoRow }>();

function shortHash(hash: string): string {
  if (!hash) return '';
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

// ctime follows the same convention as MidnightTransaction.timestamp
// elsewhere in this module (milliseconds since epoch, rendered directly).
function formatTime(ctime: number): string {
  return new Date(ctime).toLocaleString();
}
</script>

<style scoped>
.mn-utxo-detail {
  font-size: 13px;
  line-height: 1.8;
  color: var(--g-text-2);
}

.mn-utxo-detail__row {
  display: flex;
  align-items: center;
}

.mn-utxo-detail__mono {
  font-family: var(--g-font-mono);
  font-size: 11px;
  color: var(--g-text-1);
  word-break: break-all;
}

.mn-utxo-detail__value {
  color: var(--g-text-1);
}

.mn-utxo-detail__amount {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  color: var(--g-accent);
}
</style>
