<template>
  <div class="btc-glass-card" :class="{ 'is-refreshing': refreshing }">
    <div class="card-body">
      <!-- Header row -->
      <div class="card-header">
        <div class="header-identity">
          <div class="btc-icon-ring">
            <img :src="bitcoinLogo" class="btc-logo-img" alt="BTC" />
          </div>
          <div class="header-labels">
            <span class="chain-name">Bitcoin</span>
            <span class="chain-sub">Mainnet · Wallet</span>
          </div>
        </div>
        <div class="header-actions">
          <div class="live-badge" :class="{ 'live-badge--syncing': refreshing }">
            <span class="live-dot" />
            <span class="live-text">{{ refreshing ? 'Syncing' : 'Live' }}</span>
          </div>
          <button class="icon-btn" @click="refreshBalance" :disabled="refreshing" title="Refresh">
            <svg class="refresh-icon" :class="{ spinning: refreshing }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      <!-- No wallet state -->
      <div v-if="!loggedWallet" class="no-wallet-state">
        <span>No wallet loaded</span>
      </div>

      <!-- Balance block -->
      <template v-else>
        <div class="balance-block">
          <div class="balance-field-label">Available Balance</div>

          <div class="balance-primary">
            <span class="balance-number">{{ formatBtc(availableBalance) }}</span>
            <span class="balance-unit">BTC</span>
          </div>

          <div class="balance-sats">
            <svg class="sat-bolt" viewBox="0 0 10 16" fill="#F7931A" width="7" height="11" style="opacity:0.65;flex-shrink:0">
              <polygon points="6,0 0,9 5,9 4,16 10,7 5,7"/>
            </svg>
            <span class="sats-num">{{ Number(availableBalance).toLocaleString() }}</span>
            <span class="sats-label">sats</span>
          </div>

          <div class="balance-usd" v-if="btcPrice">
            <span class="usd-amount">${{ formatUsdRaw(usdValue) }}</span>
            <span class="usd-label">USD</span>
          </div>
        </div>

        <!-- Pending indicator -->
        <div v-if="unconfirmedBalance > 0" class="pending-row">
          <span class="pending-icon-wrap">
            <span class="pending-pulse" />
          </span>
          <span class="pending-text">+{{ formatBtc(unconfirmedBalance) }} BTC unconfirmed</span>
        </div>

        <!-- Address field -->
        <div class="address-field">
          <span class="addr-tag">Addr</span>
          <span class="addr-value">{{ baseAddress }}</span>
          <button
            class="copy-action"
            @click="copyAddress"
            :class="{ copied }"
            :title="copied ? 'Copied!' : 'Copy address'"
          >
            <svg v-if="!copied" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>
        </div>
      </template>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import bitcoinLogo from '@/assets/bitcoin-logo.svg';

const { loggedWallet, bitcoinBalance } = toRefs(walletStore);

const refreshing = ref(false);
const copied = ref(false);

const baseAddress = computed(() => loggedWallet.value?.baseAddress ?? '');

const availableBalance = computed<bigint>(() =>
  bitcoinBalance.value?.available ?? BigInt(0)
);

const unconfirmedBalance = computed<bigint>(() => {
  if (!bitcoinBalance.value) return BigInt(0);
  return bitcoinBalance.value.total - bitcoinBalance.value.available;
});

const btcPrice = computed(() => priceStore.btcUsd?.lastPrice ?? null);

const usdValue = computed<number>(() => {
  if (!btcPrice.value) return 0;
  return (Number(availableBalance.value) / 1e8) * btcPrice.value;
});

function formatBtc(satoshis: bigint): string {
  return (Number(satoshis) / 1e8).toFixed(8);
}

function formatUsdRaw(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

async function copyAddress(): Promise<void> {
  try {
    await navigator.clipboard.writeText(baseAddress.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    // clipboard not available
  }
}

async function refreshBalance(): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SYNC_BITCOIN,
      data: {},
    });
    if (!response.data.success) {
      console.error('Failed to refresh Bitcoin wallet:', response.data.error);
    }
  } catch (error) {
    console.error('Failed to refresh Bitcoin wallet:', error);
  } finally {
    refreshing.value = false;
  }
}
</script>

<style scoped>
/* ─── Liquid Glass Card ─────────────────────────────────────── */
.btc-glass-card {
  position: relative;
  height: 100%;
  min-height: 220px;
  background: rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 22px;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.2),
    0 16px 48px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -1px 0 rgba(0, 0, 0, 0.06);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif;
  transition: box-shadow 0.3s ease, transform 0.3s ease;
  overflow: hidden;
}

.btc-glass-card:hover {
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.24),
    0 24px 60px rgba(0, 0, 0, 0.36),
    0 0 0 1px rgba(247, 147, 26, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    inset 0 -1px 0 rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.card-body {
  padding: 18px 20px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* ─── Header ────────────────────────────────────────────────── */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.header-identity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btc-icon-ring {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(247, 147, 26, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(247, 147, 26, 0.12);
  box-shadow: 0 0 16px rgba(247, 147, 26, 0.18), inset 0 1px 0 rgba(255,255,255,0.12);
  flex-shrink: 0;
}

.btc-logo-img {
  width: 22px;
  height: 22px;
}

.header-labels {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.chain-name {
  font-size: 16px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  letter-spacing: -0.01em;
  line-height: 1;
}

.chain-sub {
  font-size: 11px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ─── Live Badge (iOS pill) ─────────────────────────────────── */
.live-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  background: rgba(48, 209, 88, 0.14);
  border: 1px solid rgba(48, 209, 88, 0.22);
  border-radius: 20px;
  backdrop-filter: blur(8px);
}

.live-badge--syncing {
  background: rgba(247, 147, 26, 0.14);
  border-color: rgba(247, 147, 26, 0.22);
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #30D158;
  animation: dot-pulse 2s ease-in-out infinite;
  flex-shrink: 0;
}

.live-badge--syncing .live-dot {
  background: #F7931A;
}

@keyframes dot-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(0.82); }
}

.live-text {
  font-size: 12px;
  font-weight: 600;
  color: #30D158;
  letter-spacing: 0.01em;
}

.live-badge--syncing .live-text {
  color: #F7931A;
}

/* ─── Refresh Button ────────────────────────────────────────── */
.icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.45);
  transition: all 0.2s ease;
}

.icon-btn:hover {
  background: rgba(247, 147, 26, 0.15);
  border-color: rgba(247, 147, 26, 0.28);
  color: #F7931A;
}

.icon-btn:disabled { opacity: 0.3; cursor: default; }

.refresh-icon {
  width: 14px;
  height: 14px;
}

.spinning {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* ─── Balance ───────────────────────────────────────────────── */
.no-wallet-state {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.3);
  padding: 20px 0;
}

.balance-block {
  margin-bottom: 16px;
}

.balance-field-label {
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.62);
  letter-spacing: 0.02em;
  margin-bottom: 8px;
}

.balance-primary {
  display: flex;
  align-items: baseline;
  gap: 9px;
  line-height: 1;
  margin-bottom: 6px;
}

.balance-number {
  font-size: 30px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  letter-spacing: -0.025em;
}

.balance-unit {
  font-size: 15px;
  font-weight: 600;
  color: #F7931A;
  letter-spacing: 0.02em;
}

.balance-sats {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 8px;
}

.sats-num {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.58);
  font-variant-numeric: tabular-nums;
}

.sats-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.48);
}

.balance-usd {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.usd-amount {
  font-size: 22px;
  font-weight: 600;
  color: #F7931A;
  letter-spacing: -0.015em;
}

.usd-label {
  font-size: 12px;
  font-weight: 500;
  color: rgba(247, 147, 26, 0.75);
}

/* ─── Pending ───────────────────────────────────────────────── */
.pending-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 13px;
  background: rgba(255, 179, 0, 0.09);
  border: 1px solid rgba(255, 179, 0, 0.18);
  border-radius: 12px;
  margin-bottom: 14px;
}

.pending-icon-wrap {
  position: relative;
  width: 8px;
  height: 8px;
  flex-shrink: 0;
}

.pending-pulse {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: #FFB300;
  animation: pending-ripple 1.6s ease-out infinite;
}

@keyframes pending-ripple {
  0%   { transform: scale(0.5); opacity: 1; }
  100% { transform: scale(2.4); opacity: 0; }
}

.pending-text {
  font-size: 12px;
  font-weight: 500;
  color: #FFB300;
}

/* ─── Address Row ───────────────────────────────────────────── */
.address-field {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 13px;
  padding: 9px 12px;
  margin-top: auto;
}

.addr-tag {
  font-size: 10px;
  font-weight: 600;
  color: rgba(247, 147, 26, 0.75);
  flex-shrink: 0;
  background: rgba(247, 147, 26, 0.12);
  padding: 3px 8px;
  border-radius: 7px;
}

.addr-value {
  font-size: 11px;
  font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
  color: rgba(255, 255, 255, 0.82);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.copy-action {
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.62);
  flex-shrink: 0;
  padding: 5px;
  display: flex;
  align-items: center;
  transition: all 0.2s ease;
}

.copy-action:hover {
  background: rgba(247, 147, 26, 0.14);
  border-color: rgba(247, 147, 26, 0.28);
  color: #F7931A;
}

.copy-action.copied {
  color: #30D158;
  border-color: rgba(48, 209, 88, 0.28);
  background: rgba(48, 209, 88, 0.12);
}
</style>