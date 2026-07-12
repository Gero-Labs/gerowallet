<template>
  <v-row no-gutters class="owned-tokens-market-cards">
    <!-- Top by Volume (from owned tokens) -->
    <v-col cols="12" lg="4" md="4" sm="4" class="pr-2">
      <v-card flat outlined class="compact-card volume-card liquid-glass-compact" style="position: relative">
        <!-- Coming Soon Overlay -->
        <div class="coming-soon-overlay">
          <div class="coming-soon-content">
            <div class="market-data-label">{{ t('dashboard.marketData') }}</div>
            <div class="coming-soon-text">{{ t('common.comingSoon') }}</div>
          </div>
        </div>

        <!-- Blurred Content Container -->
        <div class="card-content-blur">
          <!-- Last refresh timestamp badge -->
          <div v-if="lastRefreshTime" class="refresh-badge">
            <v-tooltip bottom content-class="refresh-tooltip">
              <template v-slot:activator="{ on, attrs }">
                <v-icon small :color="primaryColor" v-bind="attrs" v-on="on" class="refresh-icon">
                  mdi-clock-outline
                </v-icon>
              </template>
              <div class="refresh-tooltip-content">
                <div><strong>{{ t('dashboard.lastUpdated') }}:</strong> {{ formatFullRefreshTime() }}</div>
                <div><strong>{{ t('dashboard.nextUpdate') }}:</strong> {{ formatNextRefreshTime() }}</div>
              </div>
            </v-tooltip>
          </div>

          <v-card-title class="px-2 py-1">
            <v-icon left size="16" class="volume-icon">mdi-trending-up</v-icon>
            <span class="text-subtitle-1">{{ t('dashboard.topVolume') }}</span>
          </v-card-title>
          <v-card-text class="px-2 pt-0 pb-1">
            <div v-if="loading" class="text-center py-4">
              <v-progress-circular indeterminate small></v-progress-circular>
            </div>
            <div v-else-if="error" class="text-center py-4">
              <div class="caption grey--text">{{ error }}</div>
            </div>
            <div v-else-if="marketData.topVolume.length === 0" class="text-center py-4">
              <div class="caption grey--text">{{ t('dashboard.noVolumeData') }}</div>
            </div>
            <template v-else>
              <div
                v-for="(token, index) in marketData.topVolume.slice(0, 3)"
                :key="token.symbol || token.ticker"
                class="compact-item d-flex align-center justify-space-between py-0"
              >
                <div class="d-flex align-center">
                  <span class="caption grey--text mr-2">{{ index + 1 }}.</span>
                  <v-avatar size="20" class="mr-2">
                    <img
                      v-if="token.logoUrl"
                      :src="token.logoUrl"
                      :alt="`${token.ticker || token.symbol} Logo`"
                      @error="onImageError(token)"
                    />
                    <div v-else class="token-placeholder">
                      {{ (token.ticker || token.symbol || '?').charAt(0).toUpperCase() }}
                    </div>
                  </v-avatar>
                  <div class="token-info">
                    <div class="font-weight-medium token-ticker">{{ token.ticker || token.symbol }}</div>
                    <div class="caption grey--text token-name">{{ token.name || t('dashboard.token') }}</div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="caption">${{ formatCurrency(token.dailyVolume || 0) }}</div>
                  <div class="caption grey--text">${{ formatCurrency(token.currentPrice || 0) }}</div>
                </div>
              </div>
            </template>
          </v-card-text>
        </div>
      </v-card>
    </v-col>

    <!-- Top by Price Change (from owned tokens) -->
    <v-col cols="12" lg="4" md="4" sm="4" class="px-2">
      <v-card flat outlined class="compact-card gainers-card liquid-glass-compact" style="position: relative">
        <!-- Coming Soon Overlay -->
        <div class="coming-soon-overlay">
          <div class="coming-soon-content">
            <div class="market-data-label">{{ t('dashboard.marketData') }}</div>
            <div class="coming-soon-text">{{ t('common.comingSoon') }}</div>
          </div>
        </div>

        <!-- Blurred Content Container -->
        <div class="card-content-blur">
          <!-- Last refresh timestamp badge -->
          <div v-if="lastRefreshTime" class="refresh-badge">
            <v-tooltip bottom content-class="refresh-tooltip">
              <template v-slot:activator="{ on, attrs }">
                <v-icon small :color="primaryColor" v-bind="attrs" v-on="on" class="refresh-icon">
                  mdi-clock-outline
                </v-icon>
              </template>
              <div class="refresh-tooltip-content">
                <div><strong>{{ t('dashboard.lastUpdated') }}:</strong> {{ formatFullRefreshTime() }}</div>
                <div><strong>{{ t('dashboard.nextUpdate') }}:</strong> {{ formatNextRefreshTime() }}</div>
              </div>
            </v-tooltip>
          </div>

          <v-card-title class="px-2 py-1">
            <v-icon left size="16" class="gainers-icon">mdi-chart-line</v-icon>
            <span class="text-subtitle-1">{{ t('dashboard.topGainers') }}</span>
          </v-card-title>
          <v-card-text class="px-2 pt-0 pb-1">
            <div v-if="loading" class="text-center py-4">
              <v-progress-circular indeterminate small></v-progress-circular>
            </div>
            <div v-else-if="error" class="text-center py-4">
              <div class="caption grey--text">{{ error }}</div>
            </div>
            <div v-else-if="marketData.topGainers.length === 0" class="text-center py-4">
              <div class="caption grey--text">{{ t('dashboard.noGainersData') }}</div>
            </div>
            <template v-else>
              <div
                v-for="(token, index) in marketData.topGainers.slice(0, 3)"
                :key="token.symbol || token.ticker"
                class="compact-item d-flex align-center justify-space-between py-0"
              >
                <div class="d-flex align-center">
                  <span class="caption grey--text mr-2">{{ index + 1 }}.</span>
                  <v-avatar size="20" class="mr-2">
                    <img
                      v-if="token.logoUrl"
                      :src="token.logoUrl"
                      :alt="`${token.ticker || token.symbol} Logo`"
                      @error="onImageError(token)"
                    />
                    <div v-else class="token-placeholder">
                      {{ (token.ticker || token.symbol || '?').charAt(0).toUpperCase() }}
                    </div>
                  </v-avatar>
                  <div class="token-info">
                    <div class="font-weight-medium token-ticker">{{ token.ticker || token.symbol }}</div>
                    <div class="caption grey--text token-name">{{ token.name || t('dashboard.token') }}</div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="d-flex align-center">
                    <v-avatar tile size="12" class="mr-1">
                      <v-img :src="getChangeIcon(token.dailyPriceChange)" :alt="t('dashboard.trend')" />
                    </v-avatar>
                    <span :class="getChangeColor(token.dailyPriceChange)">
                      {{ formatPercentage(token.dailyPriceChange) }}
                    </span>
                  </div>
                  <div class="caption grey--text">${{ formatCurrency(token.currentPrice || 0) }}</div>
                </div>
              </div>
            </template>
          </v-card-text>
        </div>
      </v-card>
    </v-col>

    <!-- Top by Market Cap (from owned tokens) -->
    <v-col cols="12" lg="4" md="4" sm="4" class="pl-2">
      <v-card flat outlined class="compact-card mcap-card liquid-glass-compact" style="position: relative">
        <!-- Coming Soon Overlay -->
        <div class="coming-soon-overlay">
          <div class="coming-soon-content">
            <div class="market-data-label">{{ t('dashboard.marketData') }}</div>
            <div class="coming-soon-text">{{ t('common.comingSoon') }}</div>
          </div>
        </div>

        <!-- Blurred Content Container -->
        <div class="card-content-blur">
          <!-- Last refresh timestamp badge -->
          <div v-if="lastRefreshTime" class="refresh-badge">
            <v-tooltip bottom content-class="refresh-tooltip">
              <template v-slot:activator="{ on, attrs }">
                <v-icon small :color="primaryColor" v-bind="attrs" v-on="on" class="refresh-icon">
                  mdi-clock-outline
                </v-icon>
              </template>
              <div class="refresh-tooltip-content">
                <div><strong>{{ t('dashboard.lastUpdated') }}:</strong> {{ formatFullRefreshTime() }}</div>
                <div><strong>{{ t('dashboard.nextUpdate') }}:</strong> {{ formatNextRefreshTime() }}</div>
              </div>
            </v-tooltip>
          </div>

          <v-card-title class="py-1">
            <v-icon left size="16" class="mcap-icon">mdi-finance</v-icon>
            <span class="text-subtitle-1">{{ t('dashboard.topTVL') }}</span>
          </v-card-title>
          <v-card-text class="pt-0 pb-1">
            <div v-if="loading" class="text-center py-4">
              <v-progress-circular indeterminate small></v-progress-circular>
            </div>
            <div v-else-if="error" class="text-center py-4">
              <div class="caption grey--text">{{ error }}</div>
            </div>
            <div v-else-if="marketData.topTvl.length === 0" class="text-center py-4">
              <div class="caption grey--text">{{ t('dashboard.noTVLData') }}</div>
            </div>
            <template v-else>
              <div
                v-for="(token, index) in marketData.topTvl.slice(0, 3)"
                :key="token.symbol || token.ticker"
                class="compact-item d-flex align-center justify-space-between py-0"
              >
                <div class="d-flex align-center">
                  <span class="caption grey--text mr-2">{{ index + 1 }}.</span>
                  <v-avatar size="20" class="mr-2">
                    <img
                      v-if="token.logoUrl"
                      :src="token.logoUrl"
                      :alt="`${token.ticker || token.symbol} Logo`"
                      @error="onImageError(token)"
                    />
                    <div v-else class="token-placeholder">
                      {{ (token.ticker || token.symbol || '?').charAt(0).toUpperCase() }}
                    </div>
                  </v-avatar>
                  <div class="token-info">
                    <div class="font-weight-medium token-ticker">{{ token.ticker || token.symbol }}</div>
                    <div class="caption grey--text token-name">{{ token.name || t('dashboard.token') }}</div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="caption">${{ formatCurrency(token.currentTvl || 0) }}</div>
                  <div class="caption grey--text">${{ formatCurrency(token.currentPrice || 0) }}</div>
                </div>
              </div>
            </template>
          </v-card-text>
        </div>
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, onMounted } from 'vue';
import { useIntervalFn } from '@vueuse/core';
import charli3Store from '@/stores/charli3Store';
import assts from '@/utils/assets';
import { debugLog } from '@/utils/debug';

const { t } = useTranslation();

// Computed properties
const marketData = computed(() => charli3Store.state.marketData);
const loading = computed(() => charli3Store.state.loading);
const error = computed(() => charli3Store.state.error);
const lastRefreshTime = computed(() => charli3Store.state.lastRefreshTime);
const primaryColor = computed(() => 'var(--g-accent)');

// Methods
const loadMarketData = async (isBackgroundRefresh = false) => {
  // Only show loading state on initial load, not during background refresh
  if (!isBackgroundRefresh) {
    charli3Store.setLoading(true);
  }

  try {
    // Use mock data instead of API calls
    const mockData = {
      topVolume: [
        {
          ticker: 'ADA',
          name: 'Cardano',
          symbol: 'ADA',
          dailyVolume: 125000000,
          currentPrice: 0.58,
          logoUrl: null,
        },
        {
          ticker: 'MIN',
          name: 'Minswap',
          symbol: 'MIN',
          dailyVolume: 8500000,
          currentPrice: 0.042,
          logoUrl: null,
        },
        {
          ticker: 'SUNDAE',
          name: 'SundaeSwap',
          symbol: 'SUNDAE',
          dailyVolume: 3200000,
          currentPrice: 0.0089,
          logoUrl: null,
        },
      ],
      topGainers: [
        {
          ticker: 'SNEK',
          name: 'Snek',
          symbol: 'SNEK',
          dailyPriceChange: 24.5,
          currentPrice: 0.00032,
          logoUrl: null,
        },
        {
          ticker: 'HOSKY',
          name: 'Hosky Token',
          symbol: 'HOSKY',
          dailyPriceChange: 18.2,
          currentPrice: 0.0000012,
          logoUrl: null,
        },
        {
          ticker: 'WMT',
          name: 'World Mobile Token',
          symbol: 'WMT',
          dailyPriceChange: 12.8,
          currentPrice: 0.21,
          logoUrl: null,
        },
      ],
      topTvl: [
        {
          ticker: 'INDY',
          name: 'Indigo Protocol',
          symbol: 'INDY',
          currentTvl: 48500000,
          currentPrice: 1.82,
          logoUrl: null,
        },
        {
          ticker: 'LQ',
          name: 'Liqwid Finance',
          symbol: 'LQ',
          currentTvl: 35200000,
          currentPrice: 2.45,
          logoUrl: null,
        },
        {
          ticker: 'DJED',
          name: 'Djed Stablecoin',
          symbol: 'DJED',
          currentTvl: 28900000,
          currentPrice: 1.01,
          logoUrl: null,
        },
      ],
    };

    debugLog('Using mock market data:', mockData);

    charli3Store.setMarketData(mockData as any);
  } catch (error) {
    console.error('Failed to load market data:', error);
    charli3Store.setError(error instanceof Error ? error.message : 'Failed to load market data');
  } finally {
    if (!isBackgroundRefresh) {
      charli3Store.setLoading(false);
    }
  }
};

const onImageError = (token: any) => {
  // If image fails to load, clear the logoUrl to show placeholder
  token.logoUrl = null;
};

const formatCurrency = (value: number) => {
  if (!value) return '0';
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(2);
};

const formatPercentage = (change: number) => {
  if (!change) return '0.00%';
  return `${Math.abs(change).toFixed(2)}%`;
};

const getChangeIcon = (change: number) => {
  if (!change || change === 0) return assts.arrowRightSvg;
  return change > 0 ? assts.trendUpSvg : assts.trendDownSvg;
};

const getChangeColor = (change: number) => {
  if (!change || change === 0) return 'neutral-change';
  return change > 0 ? 'positive-change' : 'negative-change';
};

const formatFullRefreshTime = () => {
  if (!lastRefreshTime.value) return '';
  // Handle both Date objects and ISO strings from storage
  const date = lastRefreshTime.value instanceof Date ? lastRefreshTime.value : new Date(lastRefreshTime.value);
  return date.toLocaleTimeString();
};

const formatNextRefreshTime = () => {
  const nextRefreshTime = charli3Store.getNextRefreshTime();
  if (!nextRefreshTime) return '';

  const now = new Date();
  const diffMs = nextRefreshTime.getTime() - now.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMs <= 0) return t('dashboard.now');
  if (diffSeconds < 60) return t('dashboard.inSeconds', { seconds: diffSeconds });
  if (diffMinutes === 1) return t('dashboard.inOneMinute');
  return t('dashboard.inMinutes', { minutes: diffMinutes });
};

// Lifecycle hooks
onMounted(async () => {
  // Clear any invalid blob URLs from cache immediately on mount
  charli3Store.clearInvalidBlobUrls();

  // Load market data if it's stale or missing
  if (charli3Store.isDataStale() || marketData.value.topVolume.length === 0) {
    await loadMarketData();
  }

  // Refresh market data every 5 minutes (background refresh)
  useIntervalFn(
    async () => {
      await loadMarketData(true); // true indicates background refresh
    },
    5 * 60 * 1000,
    { immediate: true }
  );

  // Clean expired logos every hour
  useIntervalFn(
    () => {
      charli3Store.clearExpiredLogos();
    },
    60 * 60 * 1000,
    { immediate: true }
  );
});
</script>

<style scoped>
.owned-tokens-market-cards {
  margin: 0;
}

.compact-card {
  height: 160px;
  border-radius: var(--g-r-control);
  transition: color var(--g-dur-base) ease, background-color var(--g-dur-base) ease, border-color var(--g-dur-base) ease, opacity var(--g-dur-base) ease, transform var(--g-dur-base) ease, box-shadow var(--g-dur-base) ease;
}

.refresh-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
}

.refresh-icon {
  background-color: var(--g-raised);
  border-radius: 50%;
  padding: 4px;
  transition: background-color var(--g-dur-base) ease, transform var(--g-dur-base) ease;
}

.refresh-icon:hover {
  background-color: var(--g-raised);
  transform: scale(1.1);
}

.refresh-tooltip {
  padding: 8px 12px !important;
  border-radius: var(--g-r-control) !important;
  background-color: var(--g-overlay) !important;
  border: 1px solid var(--g-hairline-2) !important;
}

.refresh-tooltip-content {
  line-height: 1.3;
}

.refresh-tooltip-content div {
  margin-bottom: 2px;
  color: var(--g-text-1);
}

.refresh-tooltip-content div:last-child {
  margin-bottom: 0;
}

.refresh-tooltip-content strong {
  color: var(--g-accent);
}

.volume-card {
  border-left: 4px solid var(--g-info) !important;
}

.gainers-card {
  border-left: 4px solid var(--g-info) !important;
}

.mcap-card {
  border-left: 4px solid var(--g-info) !important;
}

.volume-icon {
  color: var(--g-info) !important;
}

.gainers-icon {
  color: var(--g-info) !important;
}

.mcap-icon {
  color: var(--g-info) !important;
}

.compact-item {
  padding: 4px 6px;
  border-radius: var(--g-r-control);
  transition: color var(--g-dur-base) ease, background-color var(--g-dur-base) ease, border-color var(--g-dur-base) ease, opacity var(--g-dur-base) ease, transform var(--g-dur-base) ease, box-shadow var(--g-dur-base) ease;
  margin-bottom: 1px;
}

.positive-change {
  color: var(--g-success);
  font-weight: 600;
}

.negative-change {
  color: var(--g-error);
  font-weight: 600;
}

.neutral-change {
  color: var(--g-text-3);
}

.text-subtitle-1 {
  font-size: 0.875rem !important;
  font-weight: 600;
}

.caption {
  font-size: 0.75rem;
  line-height: 1.2;
}

.font-weight-medium {
  font-weight: 500;
  font-size: 0.875rem;
}

/* Token placeholder for when no logo is available */
.token-placeholder {
  width: 20px;
  height: 20px;
  background: linear-gradient(135deg, var(--g-grad-1), var(--g-grad-2));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--g-on-grad);
  border-radius: 50%;
}

/* Token info text truncation */
.token-info {
  flex: 1;
  min-width: 0; /* Allow flex item to shrink below content width */
  overflow: hidden;
}

.token-ticker {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.token-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* Ensure compact items don't overflow */
.compact-item {
  min-width: 0; /* Allow flex item to shrink */
}

.compact-item .d-flex:first-child {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

/* Card content blur container */
.card-content-blur {
  filter: blur(8px);
  -webkit-filter: blur(8px);
}

/* Coming Soon Overlay */
.coming-soon-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  border-radius: var(--g-r-control);
}

.coming-soon-content {
  text-align: center;
}

.market-data-label {
  color: var(--g-text-1);
  font-size: 0.75rem;
  font-weight: 500;
  margin-bottom: 8px;
  opacity: 0.9;
}

.coming-soon-text {
  color: var(--g-text-3);
  font-size: 0.9rem;
  font-weight: 500;
  opacity: 0.7;
}
</style>
