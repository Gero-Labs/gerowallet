<template>
  <v-card-text class="px-0 justify-center text-center" style="z-index: 1">
    <div class="utxo-info text-left pb-4">
      <!-- UTxO Reference -->
      <div style="display: flex; align-items: center">
        {{ $t('transactions.transactionId') }}:
        <a
          class="ml-1"
          style="color: #00c7f3; align-items: center"
          :href="txUrl"
          target="_blank"
        >{{ filters.truncate(utxo.txHash) }}</a>
        <CopyButton x-small :value="utxo.txHash" class="ml-1" />
      </div>

      <div>
        {{ $t('transactions.outputIndex') }}: <span class="value-text">{{ utxo.outputIndex }}</span>
      </div>

      <!-- Address -->
      <div class="mt-2" style="display: flex; align-items: center">
        {{ $t('transactions.address') }}:
        <span class="ml-1 value-text" style="font-family: monospace; font-size: 11px; word-break: break-all">
          {{ utxo.address }}
        </span>
        <CopyButton x-small :value="utxo.address" class="ml-1 flex-shrink-0" />
      </div>

      <!-- ADA Amount -->
      <div class="mt-2">
        {{ $t('transactions.amount') }}:
        <span style="color: #00c7f3; font-size: 14px">
          {{ formatAda(utxo.lovelace) }} ADA
        </span>
        <span class="ml-1 value-text" style="font-size: 11px">
          ({{ utxo.lovelace.toString() }} {{ t('transactions.lovelace').toLowerCase() }})
        </span>
      </div>

      <!-- Collateral badge -->
      <div v-if="utxo.isCollateral" class="mt-1">
        <v-chip small outlined color="warning">
          <v-icon small class="mr-1">mdi-shield-check</v-icon>
          {{ $t('transactions.collateral') }}
        </v-chip>
      </div>

      <!-- Native Tokens -->
      <div v-if="utxo.tokenCount > 0" class="mt-3">
        <div style="font-weight: 500; margin-bottom: 4px">
          {{ $t('transactions.nativeTokens') }} ({{ utxo.tokenCount }})
        </div>
        <div class="token-list">
          <div
            v-for="[assetId, quantity] in tokenEntries"
            :key="assetId"
            class="token-row d-flex align-center py-1"
          >
            <div class="flex-grow-1" style="min-width: 0">
              <div style="font-size: 12px; font-weight: 500">
                {{ getTokenName(assetId) }}
              </div>
              <div style="font-size: 11px; opacity: 0.5; font-family: monospace" class="text-truncate">
                {{ assetId }}
              </div>
            </div>
            <div class="ml-2 flex-shrink-0 text-right" style="font-size: 13px; font-family: monospace">
              {{ formatTokenQuantity(quantity) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Datum -->
      <div v-if="utxo.datumHash || utxo.datum" class="mt-3">
        <div style="font-weight: 500; margin-bottom: 4px">{{ $t('transactions.datum') }}</div>
        <div v-if="utxo.datumHash" style="font-size: 11px">
          <span style="opacity: 0.6">{{ $t('transactions.datumHash') }}:</span>
          <span class="ml-1" style="font-family: monospace; word-break: break-all">{{ utxo.datumHash }}</span>
          <CopyButton x-small :value="utxo.datumHash" class="ml-1" />
        </div>
        <div v-if="utxo.datum" style="font-size: 11px" class="mt-1">
          <span style="opacity: 0.6">{{ $t('transactions.inlineDatum') }}:</span>
          <div style="font-family: monospace; word-break: break-all; max-height: 120px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius: 4px; padding: 4px 6px; margin-top: 2px; font-size: 10px">
            {{ JSON.stringify(utxo.datum, null, 2) }}
          </div>
        </div>
      </div>

      <!-- Script Reference -->
      <div v-if="utxo.scriptReference" class="mt-3">
        <div style="font-weight: 500; margin-bottom: 4px">{{ $t('transactions.scriptReference') }}</div>
        <div style="font-family: monospace; font-size: 10px; word-break: break-all; max-height: 80px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius: 4px; padding: 4px 6px">
          {{ JSON.stringify(utxo.scriptReference) }}
        </div>
      </div>
    </div>
  </v-card-text>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';
import NetworkStore from '@/stores/networkStore';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network } from '@/models/types';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

const props = defineProps<{
  utxo: {
    id: string;
    txHash: string;
    outputIndex: number;
    address: string;
    lovelace: bigint;
    ada: number;
    tokenCount: number;
    assets: Map<string, bigint> | undefined;
    datumHash: string | null;
    datum: any;
    scriptReference: any;
    isCollateral: boolean;
  };
}>();

const txUrl = computed(() => {
  if (loggedWallet.value?.chain === Blockchain.APEX_PRIME) {
    return `https://apexscan.org/en/transaction/${props.utxo.txHash}/summary/`;
  } else if (loggedWallet.value?.network === Network.PREPROD) {
    return `https://preprod.cexplorer.io/tx/${props.utxo.txHash}`;
  }
  return `https://cexplorer.io/tx/${props.utxo.txHash}`;
});

const tokenEntries = computed(() => {
  if (!props.utxo.assets) return [];
  return Array.from(props.utxo.assets.entries());
});

function formatAda(lovelace: bigint): string {
  const ada = Number(lovelace) / 1_000_000;
  return ada.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function getTokenName(assetId: string): string {
  const asset = NetworkStore.getAsset(assetId);
  if (asset) {
    return asset.ticker || asset.name || assetId.slice(0, 20);
  }
  // Fallback: extract asset name hex from policy.assetName and decode
  const dotIndex = assetId.indexOf('.');
  if (dotIndex > 0) {
    const hexName = assetId.slice(dotIndex + 1);
    try {
      const bytes = hexName.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) || [];
      const decoded = String.fromCharCode(...bytes);
      if (/^[\x20-\x7E]+$/.test(decoded)) return decoded;
    } catch { /* fall through */ }
  }
  return assetId.slice(0, 16) + '...';
}

function formatTokenQuantity(quantity: bigint): string {
  return Number(quantity).toLocaleString();
}
</script>

<style scoped>
.utxo-info {
  font-size: 13px;
  line-height: 1.8;
}
.value-text {
  color: #c4c4c4;
}
.token-list {
  max-height: 300px;
  overflow-y: auto;
}
.token-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.token-row:last-child {
  border-bottom: none;
}
</style>
