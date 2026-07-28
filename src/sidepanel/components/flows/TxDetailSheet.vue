<template>
  <BottomSheet :value="value" @input="$emit('input', $event)" :title="$t('miniGero.txDetail')" height="85%">
    <div v-if="tx" class="tx-detail">
      <!-- Amount -->
      <div class="tx-amount-section">
        <v-icon :color="isReceive ? primaryColor : 'error'" size="36">
          {{ isReceive ? 'mdi-arrow-bottom-left' : 'mdi-arrow-top-right' }}
        </v-icon>
        <div class="tx-amount" :class="isReceive ? 'accent--text' : 'error--text'">
          {{ isReceive ? '+' : '' }}{{ formatAda(tx.ada) }}
        </div>
        <div class="tx-status grey--text text-caption">
          {{ txStatusLabel }}
        </div>
      </div>

      <!-- Details -->
      <div class="tx-details-list">
        <div class="detail-row">
          <span class="detail-label">{{ $t('miniGero.txId') }}</span>
          <span class="detail-value clickable" @click="copyToClipboard(tx.id)">
            {{ truncate(tx.id) }}
            <v-icon x-small color="var(--g-text-3)" class="ml-1">mdi-content-copy</v-icon>
          </span>
        </div>

        <div class="detail-row">
          <span class="detail-label">{{ $t('miniGero.time') }}</span>
          <span class="detail-value">{{ formatTime(tx.tx_timestamp) }}</span>
        </div>

        <div v-if="tx.block_height" class="detail-row">
          <span class="detail-label">{{ $t('miniGero.block') }}</span>
          <span class="detail-value">{{ tx.block_height?.toLocaleString('en-US') }}</span>
        </div>

        <div v-if="tx.body?.fee" class="detail-row">
          <span class="detail-label">{{ $t('miniGero.fee') }}</span>
          <span class="detail-value fee-text">{{ formatAda(tx.body.fee) }}</span>
        </div>

        <div v-if="tx.epoch_no" class="detail-row">
          <span class="detail-label">{{ $t('transactions.epoch') }}</span>
          <span class="detail-value">{{ tx.epoch_no }}</span>
        </div>
      </div>

      <!-- Assets -->
      <div v-if="txAssets.length > 0" class="tx-assets-section">
        <div class="detail-label mb-2">{{ $t('miniGero.tokens') }}</div>
        <div v-for="(asset, i) in txAssets" :key="i" class="asset-chip">
          <v-avatar v-if="asset.img" size="20" class="mr-2">
            <v-img :src="asset.img" contain />
          </v-avatar>
          <span :class="Number(asset.quantity) > 0 ? 'accent--text' : 'error--text'">
            {{ formatAssetQty(asset) }}
          </span>
          <span class="grey--text ml-1 text-caption">{{ asset.name || truncate(asset.unit) }}</span>
        </div>
      </div>

      <!-- Explorer link -->
      <v-btn
        block
        outlined
        small
        :color="primaryColor"
        class="mt-4"
        @click="openExplorer"
      >
        <v-icon small left>mdi-open-in-new</v-icon>
        {{ $t('miniGero.viewOnExplorer') }}
      </v-btn>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BottomSheet from '../BottomSheet.vue';
import filters from '@/shared/utils/filters';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import { getExplorerUrl } from '@/shared/utils/explorer';
import { useChainContext } from '../../composables/useChainContext';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

type TxAsset = {
  unit: string;
  quantity: number | string;
  decimals?: number;
  name?: string;
  img?: string;
};

type TxDetail = {
  id: string;
  ada: number | string;
  pending?: boolean;
  tx_timestamp: number;
  block_height?: number;
  epoch_no?: number;
  body?: { fee?: number | string; certificates?: unknown[] };
  assets?: TxAsset[];
};

const props = defineProps<{
  value: boolean;
  tx: TxDetail | null;
}>();

defineEmits<{
  (e: 'input', value: boolean): void;
}>();

const isReceive = computed(() => props.tx && Number(props.tx.ada) > 0);

const txStatusLabel = computed(() => {
  if (!props.tx) return '';
  if (props.tx.pending) return 'Pending';

  const item = props.tx;
  if (item.body?.certificates?.length > 0) {
    return 'Staking Operation';
  }

  const hasSentTokens = item.assets?.some((a: TxAsset) => a.unit !== 'lovelace' && Number(a.quantity) < 0);
  const hasReceivedTokens = item.assets?.some((a: TxAsset) => a.unit !== 'lovelace' && Number(a.quantity) > 0);
  const adaAmount = Number(item.ada);

  if (adaAmount > 0 && hasReceivedTokens) return 'Received Funds & Tokens';
  if (adaAmount < 0 && hasSentTokens) return 'Sent Funds & Tokens';
  if (adaAmount > 0) return 'Received';
  if (adaAmount < 0) return 'Sent';
  if (hasReceivedTokens) return 'Received Tokens';
  if (hasSentTokens) return 'Sent Tokens';
  return 'Transaction';
});

const txAssets = computed(() => {
  if (!props.tx?.assets) return [];
  return props.tx.assets.filter((a: TxAsset) => a.unit !== 'lovelace');
});

function formatAda(lovelace: number | string): string {
  return filters.toCurrency(Number(lovelace));
}

function formatAssetQty(asset: TxAsset): string {
  const qty = Number(asset.quantity);
  const decimals = asset.decimals || 0;
  const val = qty / Math.pow(10, decimals);
  return (qty > 0 ? '+' : '') + val.toLocaleString('en-US', { maximumFractionDigits: decimals || 2 });
}

function truncate(value: string): string {
  return filters.truncate(value);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

function openExplorer() {
  if (!props.tx?.id) return;
  const chain = walletStore.loggedWallet?.chain || Blockchain.CARDANO;
  const network = geroStore.network?.network;
  const url = getExplorerUrl(chain, props.tx.id, 'tx', network);
  if (url) window.open(url, '_blank');
}
</script>

<style scoped>
.tx-detail {
  padding-bottom: 16px;
}

.tx-amount-section {
  text-align: center;
  padding: 16px 0 24px;
}

.tx-amount {
  font-size: 32px;
  font-weight: 700;
  margin-top: 8px;
}

.accent--text {
  color: var(--g-accent) !important;
}

.error--text {
  color: var(--g-error) !important;
}

.tx-status {
  margin-top: 4px;
}

.tx-details-list {
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 12px 16px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--g-hairline-1);
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-label {
  color: var(--g-text-3);
  font-size: 13px;
}

.detail-value {
  color: var(--g-text-1);
  font-size: 13px;
  text-align: right;
}

.detail-value.clickable {
  cursor: pointer;
}

.detail-value.clickable:hover {
  color: var(--g-accent);
}

.fee-text {
  color: var(--g-error);
}

.tx-assets-section {
  margin-top: 16px;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 12px 16px;
}

.asset-chip {
  display: flex;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--g-hairline-1);
}

.asset-chip:last-child {
  border-bottom: none;
}
</style>
