<template>
  <v-card flat class="summary-step transparent">
    <TransactionDetailsCard
      v-if="tx"
      :outputs="outputRows"
      :withdrawal="withdrawalRow"
      :totals="totals"
      :risk-badge="txRiskBadge"
      :risk-loading="loading"
      :cbor-hex="getCborHex()"
      class="mb-3"
    />
  </v-card>
</template>
<script setup lang="ts">
import { toRefs, computed, ref } from 'vue';
import { DappScore } from '@/models/cardano-shield-types';
import { walletStore } from '@/stores/walletStore';
import cardanoShieldApi from '@/api/cardano-shield-api';
import { Cardano } from '@cardano-sdk/core';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import filters from '@/shared/utils/filters';
import TransactionDetailsCard, {
  type TxDetailsOutput,
  type TxDetailsWithdrawal,
  type TxDetailsTotals,
  type TxDetailsRiskBadge,
} from '@/shared/components/TransactionDetailsCard.vue';

import type { SendRecipient } from '@/models/send-flow.types';

interface Props {
  recipients: SendRecipient[];
  txData?: Cardano.Tx;
}

const props = defineProps<Props>();
defineExpose({ scanTx });

const loading = ref<boolean>(false);
const tx = ref<Cardano.Tx | undefined>(undefined);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const risks = ref<any>({ score: undefined });

const { loggedWallet } = toRefs(walletStore);

const recipientAddresses = computed(() => {
  const set = new Set<string>();
  for (const r of props.recipients) {
    const a = r.resolvedAddress || r.address;
    if (a) set.add(a);
  }
  return set;
});

function truncateAddr(addr: string): string {
  if (!addr) return '';
  if (addr.length <= 20) return addr;
  return addr.slice(0, 8) + '...' + addr.slice(-6);
}

function formatAda(lovelace: bigint | number): string {
  return filters.toCurrency(Number(lovelace), false, 6, '', '', false, 6);
}

const outputRows = computed<TxDetailsOutput[]>(() => {
  if (!tx.value?.body?.outputs) return [];
  return tx.value.body.outputs.map((o) => {
    const addr = String(o.address);
    const isExternal = recipientAddresses.value.has(addr);
    const coins = BigInt(o.value.coins);
    const assets = o.value.assets;
    const assetCount = assets
      ? (assets instanceof Map ? assets.size : Object.keys(assets).length)
      : 0;
    return {
      kind: isExternal ? 'external' : 'change',
      truncatedAddress: truncateAddr(addr),
      ada: formatAda(coins),
      assetCount,
    };
  });
});

const feeAda = computed(() => {
  if (!tx.value?.body?.fee) return '0';
  return formatAda(Number(tx.value.body.fee));
});

const totalSendingLovelace = computed<bigint>(() => {
  if (!tx.value?.body?.outputs) return 0n;
  let sum = 0n;
  for (const o of tx.value.body.outputs) {
    if (recipientAddresses.value.has(String(o.address))) {
      sum += BigInt(o.value.coins);
    }
  }
  return sum;
});

const withdrawnRewardsLovelace = computed<bigint>(() => {
  const ws = tx.value?.body?.withdrawals;
  if (!ws || ws.length === 0) return 0n;
  return ws.reduce<bigint>((acc, w) => acc + BigInt(w.quantity), 0n);
});

const withdrawalRow = computed<TxDetailsWithdrawal | null>(() => {
  const v = withdrawnRewardsLovelace.value;
  if (v <= 0n) return null;
  const ws = tx.value?.body?.withdrawals;
  const stake = ws?.[0]?.stakeAddress ? String(ws[0].stakeAddress) : '';
  return { truncatedStakeAddress: truncateAddr(stake), ada: formatAda(v) };
});

const totals = computed<TxDetailsTotals>(() => {
  const fee = tx.value?.body?.fee ? BigInt(tx.value.body.fee) : 0n;
  const net = totalSendingLovelace.value + fee - withdrawnRewardsLovelace.value;
  return {
    totalSendingAda: formatAda(totalSendingLovelace.value),
    feeAda: feeAda.value,
    withdrawalAda: withdrawnRewardsLovelace.value > 0n ? formatAda(withdrawnRewardsLovelace.value) : undefined,
    youPayAda: formatAda(net < 0n ? 0n : net),
    isInternal: false,
  };
});

const txRiskBadge = computed<TxDetailsRiskBadge | null>(() => {
  if (!risks.value || risks.value.score === undefined) return null;
  const score = risks.value.score as unknown;
  const scoreStr = String(score ?? '').toLowerCase();
  const isHigh = score === DappScore.high || scoreStr === 'high' || score === 2;
  const isMedium = score === DappScore.medium || scoreStr === 'medium' || score === 1;
  const isLow = score === DappScore.low || scoreStr === 'low' || score === 0;
  if (isHigh) return { color: '#FDA29B', icon: 'mdi-shield-alert', label: 'high' };
  if (isMedium) return { color: '#FFD54F', icon: 'mdi-shield-half-full', label: 'medium' };
  if (isLow) return { color: '#94CFA8', icon: 'mdi-shield-check', label: 'low' };
  return { color: '#94969c', icon: 'mdi-shield-outline', label: 'unverified' };
});

const primaryRecipientAddress = computed(() =>
  props.recipients[0]?.resolvedAddress ?? props.recipients[0]?.address ?? ''
);
const changeAddress = computed(() => loggedWallet.value?.baseAddress);

const getCborHex = (): string => {
  if (!tx.value) return '';
  try {
    return serializeCardanoJsSdkTx(tx.value);
  } catch (error) {
    console.error('Error serializing transaction to CBOR:', error);
    return '';
  }
};

async function scanTx(txData: Cardano.Tx) {
  risks.value.score = undefined;
  loading.value = true;
  tx.value = txData;

  const cborHex = getCborHex();
  const toAddress = primaryRecipientAddress.value;
  const scanWithTimeout = Promise.race([
    cardanoShieldApi.scanTx({
      cborHex,
      toAddress,
      fromAddress: changeAddress.value,
      url: 'https://gerowallet.io',
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Cardano Shield scan timeout')), 5000)
    ),
  ]);

  try {
    risks.value = await scanWithTimeout;
  } catch (e) {
    console.warn('Cardano Shield scan failed or timed out:', e);
    risks.value = { addressRisk: 'unknown' };
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.summary-step {
  padding: 8px 0;
}
</style>
