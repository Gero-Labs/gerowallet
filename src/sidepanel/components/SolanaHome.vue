<template>
  <!-- The panel's Solana home, from Gero Sync (walletStore.solana), as the dashboard's
       SolanaDashboard shows it: SOL balance, Send and Receive, then SPL tokens. -->
  <div class="sol-home">
    <section class="sol-home__balance" data-test="sol-home-balance">
      <span class="t-label">{{ $t('common.available') }}</span>
      <div v-if="lamports !== null" class="sol-home__primary">
        <span class="sol-home__amount g-num" data-test="sol-home-balance-value">{{ hideBalances ? '••••••' : formatSol(lamports) }}</span>
        <span class="sol-home__unit g-mono">{{ ticker }}</span>
      </div>
      <!-- null until Gero Sync has reported: never shown as 0 -->
      <span v-else class="t-caption" role="status">{{ $t('solana.balanceLoading') }}</span>
      <span v-if="!isMainnet" class="t-caption sol-home__notice">{{ $t('solana.devnetNotice') }}</span>
    </section>

    <QuickActions @action="emit('action', $event)" />

    <div class="sol-home__header">
      <span class="t-heading">{{ $t('solana.tokens') }}</span>
      <span v-if="tokens.length" class="t-caption g-num">{{ tokens.length }}</span>
    </div>

    <ul class="sol-home__list" data-test="sol-home-tokens">
      <!-- SOL is pinned first, as ADA is on Cardano -->
      <li class="sol-home__row sol-home__row--native">
        <img :src="solanaLogo" class="sol-home__logo" alt="" />
        <span class="sol-home__name">{{ $t('assets.solana') }}</span>
        <span class="sol-home__value g-num">{{ lamports === null ? '—' : hideBalances ? '••••' : formatSol(lamports) }} {{ ticker }}</span>
      </li>
      <li v-for="token in tokens" :key="token.mint" class="sol-home__row">
        <span class="sol-home__logo sol-home__logo--token" aria-hidden="true">
          <v-icon size="16">mdi-circle-outline</v-icon>
        </span>
        <a
          :href="solscanUrl('account', token.mint, networkName) || undefined"
          target="_blank"
          rel="noopener noreferrer"
          class="sol-home__name sol-home__link g-mono"
          :title="token.mint"
        >{{ shortId(token.mint) }}</a>
        <span class="sol-home__value g-num">{{ hideBalances ? '••••' : formatUnits(token.amount, token.decimals) }}</span>
      </li>
    </ul>
    <p v-if="tokens.length === 0" class="t-caption sol-home__empty">{{ $t('solana.noTokens') }}</p>

    <!-- NFTs open on the dashboard, as Cardano's do -->
    <button v-if="nftCount" type="button" class="sol-home__nfts" data-test="sol-home-nfts" @click="openCollectibles()">
      <v-icon size="18">mdi-image-multiple-outline</v-icon>
      <span class="sol-home__name">{{ $t('assets.collectibles') }}</span>
      <span class="sol-home__value g-num">{{ nftCount }}</span>
      <v-icon size="16">mdi-open-in-new</v-icon>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import networks from '@/utils/networks';
import QuickActions from './QuickActions.vue';
import { formatSol, formatUnits, parseRawAmount } from '@/chains/solana/solanaAmount';
import { solscanUrl } from '@/chains/solana/solanaExplorer';
import { solanaNftCandidates } from '@/chains/solana/solanaNfts';
import { openFullDashboard } from '@/shared/utils/openFullDashboard';
import solanaLogo from '@/assets/svg/solana.svg';

const emit = defineEmits<{ (e: 'action', id: string): void }>();

const networkName = computed(() => walletStore.loggedWallet?.network ?? '');
const isMainnet = computed(() => networkName.value === Network.MAINNET);
const ticker = computed(() => networks.resolveCurrencyTicker(walletStore.loggedWallet?.chain, networkName.value));
const hideBalances = computed(() => walletStore.config?.hideBalances || false);

const lamports = computed<bigint | null>(() => {
  const raw = walletStore.solana?.lamports;
  return raw == null ? null : parseRawAmount(raw);
});

// NFTs are counted apart and shown on the dashboard.
const tokens = computed(() => (walletStore.solana?.tokens ?? [])
  .filter((token) => token.amount !== '0' && !walletStore.solanaNfts?.[token.mint]));
const nftCount = computed(() => solanaNftCandidates(walletStore.solana?.tokens).filter((mint) => !!walletStore.solanaNfts?.[mint]).length
  + (walletStore.solanaAssets?.length ?? 0));

function openCollectibles(): void {
  void openFullDashboard('#/?view=collectibles', true);
}

function shortId(id: string): string {
  return id.length > 20 ? `${id.slice(0, 6)}…${id.slice(-6)}` : id;
}
</script>

<style scoped>
.sol-home__nfts {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  width: 100%;
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  background: none;
  color: var(--g-text-2);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.sol-home {
  display: flex;
  flex-direction: column;
}

.sol-home__balance {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-1);
  padding: 20px var(--g-s-4) var(--g-s-3);
  text-align: center;
}

.sol-home__primary {
  display: flex;
  align-items: baseline;
  gap: var(--g-s-2);
}

.sol-home__amount {
  color: var(--g-text-1);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.sol-home__unit {
  color: var(--g-text-3);
  font-size: 14px;
}

.sol-home__notice {
  color: var(--g-text-3);
}

.sol-home__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--g-s-4) var(--g-s-4) var(--g-s-2);
}

.sol-home__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sol-home__row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 2px var(--g-s-2);
  padding: 10px var(--g-s-4);
  border: 1px solid transparent;
  border-radius: var(--g-r-control);
  font-size: 13px;
}

.sol-home__row--native {
  border-color: color-mix(in srgb, var(--g-accent) 10%, transparent);
  background: color-mix(in srgb, var(--g-accent) 4%, transparent);
}

.sol-home__logo {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
}

/* An avatar is a control: solid hairline fill (glass rule exception). */
.sol-home__logo--token {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
  color: var(--g-text-3);
}

.sol-home__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--g-text-1);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sol-home__link {
  text-decoration: none;
}

.sol-home__link:hover {
  color: var(--g-accent);
}

.sol-home__value {
  color: var(--g-text-2);
  text-align: right;
}

.sol-home__empty {
  margin: var(--g-s-2) var(--g-s-4) 0;
  color: var(--g-text-3);
}
</style>
