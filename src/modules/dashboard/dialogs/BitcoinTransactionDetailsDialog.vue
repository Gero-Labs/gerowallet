<template>
  <BaseDialog
    :isOpen="!!transactionInfo"
    :title="$t('transactions.transactionDetails')"
    :img="bitcoinLogo"
    :img-size="44"
    :persistent="false"
    :scrollable="true"
    :height="700"
    :min-height="400"
    :width="600"
    @close="$emit('close')"
  >
    <v-card-text v-if="tx" class="px-4 pb-6 pt-2" style="z-index: 1;">

      <!-- Type badge + confirmation row -->
      <div class="tx-meta-row">
        <div class="tx-type-badge" :class="typeBadgeClass">
          <v-icon size="13" color="currentColor">{{ typeIcon }}</v-icon>
          <span>{{ typeLabel }}</span>
        </div>
        <span class="tx-time">{{ formatDate(tx.tx_timestamp) }}</span>
        <div class="conf-pill" :class="tx.pending ? 'conf-pill--pending' : 'conf-pill--confirmed'">
          <span class="conf-dot" />
          {{ tx.pending ? 'Unconfirmed' : confirmationsLabel }}
        </div>
      </div>

      <!-- Amount hero -->
      <div class="amount-hero">
        <div class="amount-btc" :class="tx.ada >= 0 ? 'amount--receive' : 'amount--send'">
          {{ tx.ada >= 0 ? '+' : '' }}{{ formatBtc(tx.ada) }}
          <span class="amount-unit">BTC</span>
        </div>
        <div class="amount-sats">{{ Math.abs(tx.ada).toLocaleString() }} sats</div>
        <div class="amount-usd" v-if="btcPrice > 0">≈ {{ formatUsd(tx.ada) }}</div>
      </div>

      <!-- Details grid -->
      <div class="details-grid">

        <!-- TX ID -->
        <div class="detail-card detail-card--full">
          <div class="detail-label">Transaction ID</div>
          <div class="detail-value detail-value--mono detail-value--copyable">
            <span class="mono-text">{{ tx.id }}</span>
            <button class="icon-btn" @click="copy(tx.id, 'txid')" :class="{ copied: copiedKey === 'txid' }">
              <v-icon size="11">{{ copiedKey === 'txid' ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
            </button>
            <a v-if="explorerUrl" :href="explorerUrl" target="_blank" class="icon-btn">
              <v-icon size="11">mdi-open-in-new</v-icon>
            </a>
          </div>
        </div>

        <!-- Block Height -->
        <div class="detail-card" v-if="tx.block_height">
          <div class="detail-label">Block Height</div>
          <div class="detail-value">{{ tx.block_height.toLocaleString() }}</div>
        </div>

        <!-- Confirmations -->
        <div class="detail-card" v-if="tx.confirmations !== undefined">
          <div class="detail-label">Confirmations</div>
          <div class="detail-value"
            :class="tx.pending ? '' : tx.confirmations >= 6 ? 'detail-value--green' : 'detail-value--orange'"
          >
            {{ tx.pending ? '0' : tx.confirmations }}
          </div>
        </div>

        <!-- Fee -->
        <div class="detail-card" v-if="tx.fee !== undefined">
          <div class="detail-label">Network Fee</div>
          <div class="detail-value detail-value--red">
            {{ tx.fee.toLocaleString() }} sats
            <span class="detail-sub">/ {{ formatBtc(tx.fee) }} BTC</span>
          </div>
        </div>

        <!-- Fee Rate -->
        <div class="detail-card" v-if="tx.fee && tx.vsize">
          <div class="detail-label">Fee Rate</div>
          <div class="detail-value">{{ feeRate }} sat/vB</div>
        </div>

        <!-- Virtual size -->
        <div class="detail-card" v-if="tx.vsize">
          <div class="detail-label">Virtual Size</div>
          <div class="detail-value">{{ tx.vsize }} vBytes</div>
        </div>

        <!-- Raw size -->
        <div class="detail-card" v-if="tx.size">
          <div class="detail-label">Size</div>
          <div class="detail-value">{{ tx.size }} bytes</div>
        </div>

        <!-- Weight -->
        <div class="detail-card" v-if="tx.weight">
          <div class="detail-label">Weight</div>
          <div class="detail-value">{{ tx.weight.toLocaleString() }} WU</div>
        </div>

        <!-- Block Hash -->
        <div class="detail-card detail-card--full" v-if="tx.block_hash">
          <div class="detail-label">Block Hash</div>
          <div class="detail-value detail-value--mono detail-value--copyable">
            <span class="mono-text">{{ tx.block_hash }}</span>
            <button class="icon-btn" @click="copy(tx.block_hash, 'blockhash')" :class="{ copied: copiedKey === 'blockhash' }">
              <v-icon size="11">{{ copiedKey === 'blockhash' ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
            </button>
          </div>
        </div>
      </div>

      <!-- Inputs -->
      <div class="io-section" v-if="tx.inputs && tx.inputs.length">
        <div class="io-header">
          <div class="io-icon io-icon--in">
            <v-icon size="12" color="#FF453A">mdi-arrow-top-right</v-icon>
          </div>
          <span class="io-title">Inputs</span>
          <span class="io-badge">{{ tx.inputs.length }}</span>
        </div>
        <div class="io-list">
          <div class="io-row" v-for="(inp, i) in tx.inputs" :key="`in-${i}`">
            <div class="io-addr-wrap">
              <span class="io-addr" :class="{ 'io-addr--own': isOwnAddress(inp.address) }">
                {{ inp.address || 'Coinbase' }}
              </span>
              <button v-if="inp.address" class="icon-btn-xs" @click="copy(inp.address, `in-${i}`)">
                <v-icon size="10">{{ copiedKey === `in-${i}` ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
              </button>
            </div>
            <span class="io-amount io-amount--send">{{ inp.value.toLocaleString() }} <span class="io-unit">sats</span></span>
          </div>
        </div>
      </div>

      <!-- Outputs -->
      <div class="io-section" v-if="tx.outputs && tx.outputs.length">
        <div class="io-header">
          <div class="io-icon io-icon--out">
            <v-icon size="12" color="#30D158">mdi-arrow-bottom-left</v-icon>
          </div>
          <span class="io-title">Outputs</span>
          <span class="io-badge">{{ tx.outputs.length }}</span>
        </div>
        <div class="io-list">
          <div class="io-row" v-for="(out, i) in tx.outputs" :key="`out-${i}`">
            <div class="io-addr-wrap">
              <span class="io-addr" :class="{ 'io-addr--own': isOwnAddress(out.address) }">
                {{ out.address || 'OP_RETURN' }}
              </span>
              <button v-if="out.address" class="icon-btn-xs" @click="copy(out.address, `out-${i}`)">
                <v-icon size="10">{{ copiedKey === `out-${i}` ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
              </button>
            </div>
            <span class="io-amount io-amount--receive">{{ out.value.toLocaleString() }} <span class="io-unit">sats</span></span>
          </div>
        </div>
      </div>

    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import bitcoinLogo from '@/assets/bitcoin-logo.svg';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { Network } from '@/models/types';
import type { UnifiedTransaction } from '@/chains/bitcoin/bitcoinTransactionParser';

const props = defineProps<{
  transactionInfo: UnifiedTransaction | null;
}>();

defineEmits(['close']);

const { loggedWallet } = toRefs(walletStore);

const tx = computed(() => props.transactionInfo);
const btcPrice = computed(() => priceStore.btcUsd?.lastPrice || 0);
const copiedKey = ref('');

// ── Type helpers ──────────────────────────────────────────────
const typeBadgeClass = computed(() => {
  if (!tx.value) return '';
  if (tx.value.ada > 0) return 'badge--receive';
  if (tx.value.ada < 0) return 'badge--send';
  return 'badge--self';
});

const typeIcon = computed(() => {
  if (!tx.value) return 'mdi-swap-horizontal';
  if (tx.value.ada > 0) return 'mdi-arrow-down';
  if (tx.value.ada < 0) return 'mdi-arrow-up';
  return 'mdi-swap-horizontal';
});

const typeLabel = computed(() => {
  if (!tx.value) return '';
  if (tx.value.ada > 0) return 'Received';
  if (tx.value.ada < 0) return 'Sent';
  return 'Self';
});

const confirmationsLabel = computed(() => {
  if (!tx.value) return '';
  const c = tx.value.confirmations ?? 0;
  if (c >= 6) return 'Confirmed';
  return `${c} confirmation${c !== 1 ? 's' : ''}`;
});

const feeRate = computed(() => {
  if (!tx.value?.fee || !tx.value?.vsize) return '—';
  return (tx.value.fee / tx.value.vsize).toFixed(1);
});

const explorerUrl = computed(() => {
  if (!tx.value?.id) return null;
  const isTestnet = loggedWallet.value?.network === Network.TESTNET;
  return isTestnet
    ? `https://mempool.space/testnet/tx/${tx.value.id}`
    : `https://mempool.space/tx/${tx.value.id}`;
});

// ── Formatters ────────────────────────────────────────────────
function formatBtc(sats: number): string {
  return (Math.abs(sats) / 1e8).toFixed(8);
}

function formatUsd(sats: number): string {
  const usd = (Math.abs(sats) / 1e8) * btcPrice.value;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(usd);
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function isOwnAddress(addr: string): boolean {
  if (!addr) return false;
  const addrs: string[] = (walletStore.keys as any)?.bitcoinAddresses ?? [];
  return addrs.includes(addr);
}

async function copy(text: string, key: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    copiedKey.value = key;
    setTimeout(() => { copiedKey.value = ''; }, 1500);
  } catch {}
}
</script>

<style scoped>
/* ─── Meta row ───────────────────────────────────────────────── */
.tx-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.tx-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
}

.badge--receive { background: rgba(48, 209, 88, 0.16); color: #30D158; border: 1px solid rgba(48, 209, 88, 0.25); }
.badge--send    { background: rgba(255, 69, 58, 0.16);  color: #FF453A; border: 1px solid rgba(255, 69, 58, 0.25); }
.badge--self    { background: rgba(247, 147, 26, 0.16); color: #F7931A; border: 1px solid rgba(247, 147, 26, 0.25); }

.tx-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.48);
}

.conf-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 500;
  padding: 3px 9px;
  border-radius: 20px;
}

.conf-pill--confirmed { background: rgba(48, 209, 88, 0.1);  color: #30D158; }
.conf-pill--pending   { background: rgba(247, 147, 26, 0.12); color: #F7931A; }

.conf-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: dot-blink 2s ease-in-out infinite;
}

@keyframes dot-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.25; }
}

/* ─── Amount hero ────────────────────────────────────────────── */
.amount-hero {
  text-align: center;
  padding: 20px 0 18px;
}

.amount-btc {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
}

.amount-unit {
  font-size: 17px;
  font-weight: 500;
  opacity: 0.65;
  margin-left: 4px;
}

.amount--receive { color: #30D158; }
.amount--send    { color: #FF453A; }

.amount-sats {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.52);
  margin-top: 6px;
  font-variant-numeric: tabular-nums;
}

.amount-usd {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 3px;
}

/* ─── Details grid ───────────────────────────────────────────── */
.details-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
  margin-bottom: 14px;
}

.detail-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 13px;
  padding: 10px 13px;
}

.detail-card--full { grid-column: 1 / -1; }

.detail-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.42);
  margin-bottom: 5px;
  text-transform: uppercase;
}

.detail-value {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.detail-value--mono { font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace; font-size: 11px; font-weight: 400; }
.detail-value--copyable { flex-wrap: nowrap; }
.detail-value--green  { color: #30D158; }
.detail-value--orange { color: #F7931A; }
.detail-value--red    { color: #FF453A; }

.mono-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.72);
}

.detail-sub {
  font-size: 11px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.38);
}

/* ─── Icon buttons ───────────────────────────────────────────── */
.icon-btn {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.5);
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}

.icon-btn:hover { background: rgba(255, 255, 255, 0.12); color: rgba(255, 255, 255, 0.9); }
.icon-btn.copied { background: rgba(48, 209, 88, 0.15); color: #30D158; border-color: rgba(48, 209, 88, 0.3); }

.icon-btn-xs {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.06);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.38);
  transition: color 0.15s;
}

.icon-btn-xs:hover { color: rgba(255, 255, 255, 0.75); }

/* ─── Inputs / Outputs ───────────────────────────────────────── */
.io-section {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 10px;
}

.io-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 13px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.io-icon {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.io-icon--in  { background: rgba(255, 69, 58, 0.12); }
.io-icon--out { background: rgba(48, 209, 88, 0.12); }

.io-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  flex: 1;
}

.io-badge {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.38);
  background: rgba(255, 255, 255, 0.07);
  padding: 2px 7px;
  border-radius: 10px;
}

.io-list { padding: 4px 0; }

.io-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 13px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 0.12s;
}

.io-row:last-child { border-bottom: none; }
.io-row:hover { background: rgba(255, 255, 255, 0.03); }

.io-addr-wrap {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  flex: 1;
}

.io-addr {
  font-size: 10.5px;
  font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
  color: rgba(255, 255, 255, 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.io-addr--own { color: #F7931A; }

.io-amount {
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.io-amount--send    { color: #FF453A; }
.io-amount--receive { color: #30D158; }

.io-unit { font-size: 9px; font-weight: 400; opacity: 0.55; }
</style>
