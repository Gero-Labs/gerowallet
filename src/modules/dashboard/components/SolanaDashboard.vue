<template>
  <!-- The Solana portfolio: balance, SPL tokens and activity, all from Gero Sync
       (walletStore.solana / solanaTransactions), and native staking (Nexus). Send and
       Receive open the shared quick-action dialogs. -->
  <div class="sol-dash">
    <v-row no-gutters>
      <v-col cols="12" md="5" class="pa-2">
        <section class="glass-panel sol-card sol-balance" data-test="sol-balance">
          <div class="sol-card__header">
            <div class="sol-balance__identity">
              <img :src="solanaLogo" class="sol-balance__logo" alt="" />
              <div class="sol-balance__names">
                <span class="t-heading">{{ $t('assets.solana') }}</span>
                <span class="t-caption">{{ network }}</span>
              </div>
            </div>
          </div>

          <div class="sol-balance__amount">
            <span class="t-label">{{ $t('common.available') }}</span>
            <div v-if="lamports !== null" class="sol-balance__primary">
              <span class="t-display g-num" data-test="sol-balance-value">{{ hideBalances ? '••••••' : formatSol(lamports) }}</span>
              <span class="sol-balance__unit g-mono">{{ ticker }}</span>
            </div>
            <span v-else class="t-caption" role="status">{{ $t('solana.balanceLoading') }}</span>
            <span v-if="!isMainnet" class="t-caption">{{ $t('solana.devnetNotice') }}</span>
          </div>

          <div class="sol-balance__actions">
            <GButton tier="primary" @click="openSendDialog()">
              <v-icon size="small" start>mdi-arrow-top-right</v-icon>
              {{ $t('send.send') }}
            </GButton>
            <GButton tier="secondary" @click="openReceiveDialog()">
              <v-icon size="small" start>mdi-arrow-bottom-left</v-icon>
              {{ $t('wallet.receive') }}
            </GButton>
          </div>

          <div class="sol-balance__address">
            <span class="t-label">{{ $t('common.address') }}</span>
            <span class="sol-balance__address-value g-mono">{{ address }}</span>
            <CopyButton x-small :value="address" />
          </div>
        </section>
      </v-col>

      <v-col cols="12" md="7" class="pa-2">
        <section class="glass-panel sol-card" data-test="sol-tokens">
          <div class="sol-card__header">
            <span class="t-heading">{{ $t('solana.tokens') }}</span>
          </div>
          <p v-if="!tokens.length" class="t-caption sol-empty">{{ $t('solana.noTokens') }}</p>
          <ul v-else class="sol-list">
            <li v-for="token in tokens" :key="token.mint" class="sol-row">
              <a
                :href="solscanUrl('account', token.mint, networkName)"
                target="_blank"
                rel="noopener noreferrer"
                class="sol-row__main g-mono"
                :title="token.mint"
              >{{ shortId(token.mint) }}</a>
              <span class="sol-row__value g-num">{{ hideBalances ? '••••' : formatUnits(token.amount, token.decimals) }}</span>
            </li>
          </ul>
        </section>
      </v-col>
    </v-row>

    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <SolanaStakingCard />
      </v-col>
    </v-row>

    <v-row no-gutters>
      <v-col ref="collectiblesCol" cols="12" class="pa-2">
        <SolanaCollectibles />
      </v-col>
    </v-row>

    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <section class="glass-panel sol-card" data-test="sol-activity">
          <div class="sol-card__header">
            <span class="t-heading">{{ $t('solana.activity') }}</span>
          </div>
          <p v-if="!transactions.length" class="t-caption sol-empty">{{ $t('solana.noActivity') }}</p>
          <ul v-else class="sol-list">
            <li v-for="tx in transactions" :key="tx.signature" class="sol-row">
              <a
                :href="solscanUrl('tx', tx.signature, networkName)"
                target="_blank"
                rel="noopener noreferrer"
                class="sol-row__main g-mono"
                :title="tx.signature"
              >{{ shortId(tx.signature) }}</a>
              <span v-if="!tx.success" class="sol-row__failed t-caption">{{ $t('transactions.failed') }}</span>
              <span class="sol-row__value t-caption g-num">{{ tx.blockTime ? formatTime(tx.blockTime) : $t('solana.pending') }}</span>
            </li>
          </ul>
          <a
            v-if="historyTruncated && accountUrl"
            :href="accountUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="sol-more t-caption"
          >
            {{ $t('solana.olderActivity') }}
            <v-icon size="x-small">mdi-open-in-new</v-icon>
          </a>
        </section>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import SolanaCollectibles from './SolanaCollectibles.vue';
import SolanaStakingCard from './SolanaStakingCard.vue';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import networks from '@/utils/networks';
import GButton from '@/shared/components/GButton/GButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import { useQuickActionDialogs } from '@/shared/composables/useQuickActionDialogs';
import { formatSol, formatUnits, parseRawAmount } from '@/chains/solana/solanaAmount';
import { solscanUrl } from '@/chains/solana/solanaExplorer';
import solanaLogo from '@/assets/svg/solana.svg';

/** Rows shown; the rest is on Solscan. */
const ACTIVITY_LIMIT = 25;

const { openSendDialog, openReceiveDialog } = useQuickActionDialogs();

const networkName = computed(() => walletStore.loggedWallet?.network ?? '');
const isMainnet = computed(() => networkName.value === Network.MAINNET);
const network = computed(() => (isMainnet.value ? Network.MAINNET : Network.DEVNET));
const ticker = computed(() => networks.resolveCurrencyTicker(walletStore.loggedWallet?.chain, networkName.value));
const address = computed(() => walletStore.loggedWallet?.publicKey ?? '');
const hideBalances = computed(() => walletStore.config?.hideBalances || false);

/** null until Gero Sync has reported: never shown as 0. */
const lamports = computed<bigint | null>(() => {
  const raw = walletStore.solana?.lamports;
  return raw == null ? null : parseRawAmount(raw);
});

// NFTs are listed under Collectibles, not as tokens.
const tokens = computed(() => (walletStore.solana?.tokens ?? [])
  .filter((token) => token.amount !== '0' && !walletStore.solanaNfts?.[token.mint]));

// `?view=collectibles` (the side panel's Collectibles row) scrolls to them.
const route = useRoute();
const collectiblesCol = ref<{ $el?: HTMLElement } | null>(null);
onMounted(() => {
  if (route?.query?.['view'] === 'collectibles') void nextTick(() => collectiblesCol.value?.$el?.scrollIntoView({ block: 'start' }));
});
const transactions = computed(() => (walletStore.solanaTransactions ?? []).slice(0, ACTIVITY_LIMIT));
const historyTruncated = computed(() =>
  !!walletStore.solana?.historyTruncated || (walletStore.solanaTransactions?.length ?? 0) > ACTIVITY_LIMIT,
);
const accountUrl = computed(() => solscanUrl('account', address.value, networkName.value));

function shortId(id: string): string {
  return id.length > 20 ? `${id.slice(0, 8)}…${id.slice(-8)}` : id;
}

function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}
</script>

<style scoped>
.sol-card {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  height: 100%;
  padding: var(--g-s-4);
}

.sol-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.sol-balance {
  gap: var(--g-s-4);
}

.sol-balance__identity {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}

.sol-balance__logo {
  width: 32px;
  height: 32px;
}

.sol-balance__names,
.sol-balance__amount {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sol-balance__primary {
  display: flex;
  align-items: baseline;
  gap: var(--g-s-2);
  line-height: 1.1;
}

.sol-balance__unit {
  color: var(--g-text-3);
  font-size: 14px;
}

.sol-balance__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}

/* An address field is a control, not a surface: solid raised fill (glass rule exception). */
.sol-balance__address {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin-top: auto;
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
}

.sol-balance__address-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--g-text-2);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sol-empty {
  margin: 0;
}

.sol-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sol-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-2) 0;
  border-top: 1px solid var(--g-hairline-1);
  font-size: 13px;
}

.sol-row__main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--g-text-1);
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sol-row__main:hover {
  color: var(--g-accent);
}

.sol-row__value {
  color: var(--g-text-2);
  text-align: right;
}

.sol-row__failed {
  color: var(--g-error);
}

.sol-more {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  color: var(--g-accent);
}
</style>
