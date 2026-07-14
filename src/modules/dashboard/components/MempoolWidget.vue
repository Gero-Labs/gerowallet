<template>
  <div class="mempool-widget">
    <div class="widget-body">
      <!-- Header -->
      <div class="widget-header">
        <div class="header-left">
          <div class="widget-icon">
            <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
              <rect x="2" y="10" width="3" height="8" rx="1" fill="#F7931A" opacity="0.9"/>
              <rect x="7" y="6"  width="3" height="12" rx="1" fill="#F7931A" opacity="0.7"/>
              <rect x="12" y="3" width="3" height="15" rx="1" fill="#F7931A" opacity="0.5"/>
              <rect x="17" y="8" width="1" height="10" rx="0.5" fill="#F7931A" opacity="0.3"/>
            </svg>
          </div>
          <div class="header-text">
            <span class="widget-title">MEMPOOL</span>
            <span class="widget-sub">NETWORK FEES</span>
          </div>
        </div>
        <div class="header-right">
          <div class="loading-dots" v-if="loading">
            <span /><span /><span />
          </div>
          <router-link to="/mempool" class="view-link">
            ALL <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" width="8" height="8"><path d="M2 5h6M5 2l3 3-3 3"/></svg>
          </router-link>
        </div>
      </div>

      <!-- Fee Meter Rows -->
      <div class="fee-rows">
        <div
          v-for="rate in feeRates"
          :key="rate.key"
          class="fee-row"
        >
          <div class="fee-row-label">{{ rate.label }}</div>
          <div class="fee-bar-track">
            <div
              class="fee-bar-fill"
              :style="{
                width: fees ? barWidth(fees[rate.key]) + '%' : '0%',
                background: rate.color,
              }"
            />
          </div>
          <div class="fee-value-col">
            <span class="fee-num" :style="{ color: fees ? rate.color : 'var(--g-text-3)' }">
              {{ fees ? fees[rate.key] : '—' }}
            </span>
            <span class="fee-unit">s/vB</span>
          </div>
          <div class="fee-time">{{ rate.time }}</div>
        </div>
      </div>

      <!-- Footer stats -->
      <div class="widget-footer">
        <div class="footer-stat">
          <span class="footer-dot footer-dot--pending" />
          <span class="footer-val">{{ mempoolStats ? mempoolStats.count.toLocaleString() : '—' }}</span>
          <span class="footer-lbl">PENDING</span>
        </div>
        <div class="footer-divider" />
        <div class="footer-stat">
          <span class="footer-val">{{ mempoolStats ? formatVsize(mempoolStats.vsize) : '—' }}</span>
          <span class="footer-lbl">SIZE</span>
        </div>
        <div class="footer-divider" />
        <div class="footer-stat">
          <span class="footer-val btc-color">{{ mempoolStats ? formatBtc(mempoolStats.total_fee) : '—' }}</span>
          <span class="footer-lbl">FEES BTC</span>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, toRefs, computed } from 'vue';
import mempoolApi, { type MempoolFeeEstimates } from '@/api/mempool-api';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';

const { loggedWallet } = toRefs(walletStore);
const isTestnet = computed(() => loggedWallet.value?.network === Network.TESTNET);

const loading = ref(false);
const fees = ref<MempoolFeeEstimates | null>(null);
const mempoolStats = ref<{ count: number; vsize: number; total_fee: number } | null>(null);

const feeRates = [
  { key: 'fastestFee' as const, label: 'NEXT BLOCK', time: '~10m', color: 'var(--g-error)' },
  { key: 'halfHourFee' as const, label: '30 MIN',     time: '~30m', color: 'var(--g-warning)' },
  { key: 'hourFee' as const,    label: '1 HOUR',      time: '~60m', color: 'var(--g-success)' },
  { key: 'economyFee' as const, label: 'ECONOMY',     time: '1h+',  color: 'var(--g-info)' },
];

// Max fee for proportional bar widths
const maxFee = computed(() => {
  if (!fees.value) return 100;
  return Math.max(fees.value.fastestFee, 1);
});

function barWidth(fee: number): number {
  return Math.min(100, Math.max(8, (fee / maxFee.value) * 100));
}

function formatVsize(vsize: number): string {
  if (vsize > 1_000_000) return `${(vsize / 1_000_000).toFixed(1)}MB`;
  if (vsize > 1_000) return `${(vsize / 1_000).toFixed(1)}KB`;
  return `${vsize}B`;
}

function formatBtc(sats: number): string {
  return (sats / 1e8).toFixed(4);
}

async function load() {
  loading.value = true;
  try {
    const [feesResult, statsResult] = await Promise.allSettled([
      mempoolApi.getFeeEstimates(isTestnet.value),
      mempoolApi.getMempoolStats(isTestnet.value),
    ]);
    if (feesResult.status === 'fulfilled') fees.value = feesResult.value;
    if (statsResult.status === 'fulfilled') mempoolStats.value = statsResult.value;
  } finally {
    loading.value = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  load();
  timer = setInterval(load, 60_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
/* ─── Liquid Glass Shell ────────────────────────────────────── */
.mempool-widget {
  position: relative;
  height: 100%;
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-sheet);
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif;
}

.widget-body {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* ─── Header ────────────────────────────────────────────────── */
.widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.widget-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--g-r-control);
  background: rgba(247, 147, 26, 0.12);
  border: 1px solid rgba(247, 147, 26, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.widget-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-1);
  letter-spacing: -0.01em;
  line-height: 1;
}

.widget-sub {
  font-size: 11px;
  font-weight: 400;
  color: var(--g-text-2);
  line-height: 1;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Loading dots */
.loading-dots {
  display: flex;
  gap: 3px;
  align-items: center;
}

.loading-dots span {
  display: block;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(247, 147, 26, 0.7);
  animation: dot-bounce 1.2s ease-in-out infinite;
}

.loading-dots span:nth-child(2) { animation-delay: 0.2s; }
.loading-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes dot-bounce {
  0%, 100% { opacity: 0.2; transform: translateY(0); }
  50%       { opacity: 1;   transform: translateY(-2px); }
}

.view-link {
  font-size: 12px;
  font-weight: 500;
  color: rgba(247, 147, 26, 0.6);
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 3px;
  transition: color 0.15s;
  padding: 4px 10px;
  background: rgba(247, 147, 26, 0.08);
  border: 1px solid rgba(247, 147, 26, 0.15);
  border-radius: var(--g-r-pill);
}

.view-link:hover { color: #F7931A; background: rgba(247, 147, 26, 0.14); }

/* ─── Fee Rows ──────────────────────────────────────────────── */
.fee-rows {
  display: flex;
  flex-direction: column;
  gap: 9px;
  flex: 1;
}

.fee-row {
  display: flex;
  align-items: center;
  gap: 9px;
}

.fee-row-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--g-text-2);
  width: 72px;
  flex-shrink: 0;
}

.fee-bar-track {
  flex: 1;
  height: 5px;
  background: var(--g-hairline-1);
  border-radius: 4px;
  overflow: hidden;
}

.fee-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}

.fee-value-col {
  display: flex;
  align-items: baseline;
  gap: 2px;
  width: 42px;
  justify-content: flex-end;
  flex-shrink: 0;
}

.fee-num {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  transition: color 0.3s;
  font-variant-numeric: tabular-nums;
}

.fee-unit {
  font-size: 11px;
  color: var(--g-text-3);
}

.fee-time {
  font-size: 11px;
  color: var(--g-text-3);
  width: 30px;
  flex-shrink: 0;
  text-align: right;
}

/* ─── Footer ────────────────────────────────────────────────── */
.widget-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--g-hairline-1);
}

.footer-stat {
  display: flex;
  align-items: center;
  gap: 5px;
}

.footer-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}

.footer-dot--pending {
  background: var(--g-warning);
  animation: dot-blink 2s ease-in-out infinite;
}

@keyframes dot-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.2; }
}

.footer-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-1);
  font-variant-numeric: tabular-nums;
}

.footer-val.btc-color { color: #F7931A; }

.footer-lbl {
  font-size: 11px;
  font-weight: 400;
  color: var(--g-text-3);
}

.footer-divider {
  width: 1px;
  height: 16px;
  background: var(--g-hairline-1);
  flex-shrink: 0;
  margin: 0 2px;
}
</style>