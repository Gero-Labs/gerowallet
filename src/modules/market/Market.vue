<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <!-- Stat Bar -->
        <MarketStatBar :tokens="allTokens" @token-click="openTokenByUnit" />

        <!-- Main content area (positioned parent for the overlay panel) -->
        <div class="market-content">
          <v-card flat class="liquid-glass fill-height">
            <div class="d-flex align-center flex-wrap px-3 pt-2">
              <!-- Tabs -->
              <v-tabs
                v-model="activeTab"
                dense
                show-arrows
                background-color="transparent"
                class="market-tabs flex-grow-0"
                height="36"
              >
                <v-tab>{{ $t('market.allTokens') }}</v-tab>
                <v-tab>{{ $t('market.trending') }}</v-tab>
                <v-tab>{{ $t('market.topGainers') }}</v-tab>
                <v-tab>{{ $t('market.topLosers') }}</v-tab>
                <v-tab>{{ $t('market.newTokens') }}</v-tab>
                <v-tab>{{ $t('market.myHoldings') }}</v-tab>
                <v-tab>
                  {{ $t('market.watchlist') }}
                  <NotificationDot
                    :show="watchlistCount > 0"
                    :dot="false"
                    :content="watchlistCount"
                    color="primary"
                    class="ml-1"
                  />
                </v-tab>
              </v-tabs>

              <v-spacer />

              <!-- Search + Filters -->
              <div class="d-flex align-center" style="gap: 8px">
                <v-text-field
                  v-model="searchQuery"
                  :placeholder="$t('market.searchPlaceholder')"
                  prepend-inner-icon="mdi-magnify"
                  solo-inverted
                  dense
                  flat
                  hide-details
                  clearable
                  class="search-field"
                  style="max-width: 260px"
                />
                <v-chip
                  small
                  filter
                  outlined
                  :input-value="verifiedOnly"
                  @click="verifiedOnly = !verifiedOnly"
                >
                  {{ $t('market.verifiedOnly') }}
                </v-chip>
                <v-chip
                  small
                  filter
                  outlined
                  :input-value="hideScam"
                  @click="hideScam = !hideScam"
                >
                  {{ $t('market.hideScam') }}
                </v-chip>
              </div>
            </div>

            <!-- Token Table -->
            <MarketTokenTable
              :tokens="filteredTokens"
              :show-holdings-columns="activeTab === 5"
              :loading="loading"
              @token-click="openToken"
              @swap-token="openSwap"
            />
          </v-card>

          <!-- Detail panel — overlays on top of the table -->
          <TokenDetailPanel
            v-if="panelOpen && selectedToken"
            :token="selectedToken"
            @close="panelOpen = false"
            @swap="openSwap"
          />
        </div>

        <!-- Swap Dialog -->
        <SwapDialog :isOpen="swapDialogOpen" @close="swapDialogOpen = false" />
      </v-col>
    </v-row>
  </v-layout>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRefs, onMounted, onBeforeUnmount } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useMarketData, type MarketToken } from '@/modules/market/composables/useMarketData';
import { useWatchlist } from '@/modules/market/composables/useWatchlist';
import { useWalletPnl } from '@/modules/market/composables/useWalletPnl';
import { walletStore } from '@/stores/walletStore';
import MarketStatBar from '@/modules/market/components/MarketStatBar.vue';
import MarketTokenTable from '@/modules/market/components/MarketTokenTable.vue';
import TokenDetailPanel from '@/modules/market/components/TokenDetailPanel.vue';
import SwapDialog from '@/modules/dashboard/dialogs/SwapDialog.vue';
import NotificationDot from '@/shared/components/NotificationDot.vue';

const { t } = useTranslation();
const {
  allTokens,
  trendingTokens,
  topGainers,
  topLosers,
  newTokens,
  loading,
  searchTokens,
} = useMarketData();
const { watchlist, isWatched, watchlistCount } = useWatchlist();
const { fetchPnl, getTokenPnl } = useWalletPnl();
const { tokens: userTokens } = toRefs(walletStore);

// UI state
const activeTab = ref(0);
const searchQuery = ref('');
const verifiedOnly = ref(false);
const hideScam = ref(false);
const selectedToken = ref<MarketToken | null>(null);
const panelOpen = ref(false);
const swapDialogOpen = ref(false);

// Debounced search
let searchDebounce: ReturnType<typeof setTimeout> | null = null;
const debouncedSearch = ref('');
watch(searchQuery, (val) => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    debouncedSearch.value = val || '';
  }, 300);
});

// My Holdings: cross-reference allTokens with wallet holdings
const myHoldings = computed(() => {
  const holdings = userTokens.value || {};
  return allTokens.value
    .filter(tok => {
      const unit = tok.unit;
      if (unit === 'lovelace') return true;
      return !!holdings[unit];
    })
    .map(tok => {
      const unit = tok.unit;
      const held = holdings[unit];
      const pnl = getTokenPnl(unit);
      const result: MarketToken = { ...tok };

      if (held) {
        result.balance = held.quantity ? Number(held.quantity) / Math.pow(10, held.decimals || 0) : 0;
        result.value = result.balance ? result.balance * tok.price : 0;
      }

      if (pnl) {
        result.avgCostBasis = pnl.avgCostBasisAda;
        result.totalPnl = pnl.realizedPnlAda + pnl.unrealizedPnlAda;
        result.realizedPnl = pnl.realizedPnlAda;
        result.unrealizedPnl = pnl.unrealizedPnlAda;
      }

      return result;
    });
});

// Watchlisted tokens
const watchlistedTokens = computed(() => {
  return allTokens.value.filter(tok => isWatched(tok.unit));
});

// Token list based on active tab
const tabTokens = computed(() => {
  switch (activeTab.value) {
    case 0: return allTokens.value;
    case 1: return trendingTokens.value;
    case 2: return topGainers.value;
    case 3: return topLosers.value;
    case 4: return newTokens.value;
    case 5: return myHoldings.value;
    case 6: return watchlistedTokens.value;
    default: return allTokens.value;
  }
});

// Apply search and filters
const filteredTokens = computed(() => {
  let result = tabTokens.value;

  if (debouncedSearch.value) {
    const query = debouncedSearch.value.toLowerCase();
    result = result.filter(tok =>
      tok.name.toLowerCase().includes(query) ||
      tok.ticker.toLowerCase().includes(query)
    );
  }

  if (verifiedOnly.value) {
    result = result.filter(tok => tok.verified);
  }

  if (hideScam.value) {
    result = result.filter(tok => {
      if (!tok.verified && tok.riskRating && ['C', 'D'].includes(tok.riskRating)) return false;
      return true;
    });
  }

  return result;
});

// Close panel on outside click
let skipNextOutsideClose = false;

function handleOutsideClick(e: MouseEvent) {
  if (!panelOpen.value) return;
  if (skipNextOutsideClose) {
    skipNextOutsideClose = false;
    return;
  }
  const panel = document.querySelector('.token-detail-panel');
  if (panel && panel.contains(e.target as HTMLElement)) return;
  panelOpen.value = false;
}

onMounted(() => {
  document.addEventListener('click', handleOutsideClick);
  fetchPnl();
});
onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick);
  if (searchDebounce) clearTimeout(searchDebounce);
});

function openToken(token: MarketToken) {
  selectedToken.value = token;
  panelOpen.value = true;
  skipNextOutsideClose = true;
}

function openTokenByUnit(unit: string) {
  const token = allTokens.value.find(t => t.unit === unit);
  if (token) {
    selectedToken.value = token;
    panelOpen.value = true;
    skipNextOutsideClose = true;
  }
}

function openSwap(token: MarketToken) {
  swapDialogOpen.value = true;
}
</script>

<style scoped>
.market-content {
  position: relative;
}

.market-tabs >>> .v-tab {
  text-transform: none !important;
  font-size: 13px;
  min-width: unset;
  padding: 0 12px;
  letter-spacing: 0;
}

.market-tabs >>> .v-tabs-slider {
  height: 2px;
}

.search-field >>> .v-input__slot {
  min-height: 32px !important;
  font-size: 13px;
}

.search-field >>> .v-input__prepend-inner {
  margin-top: 4px !important;
}
</style>
