<template>
  <v-row no-gutters class="owned-tokens-market-cards">
    <!-- Top by Volume (from owned tokens) -->
    <v-col cols="12" lg="4" md="4" sm="4" class="pr-2">
      <v-card flat outlined class="compact-card volume-card liquid-glass-compact" style="position: relative;">
        <!-- Coming Soon Overlay -->
        <div class="coming-soon-overlay">
          <div class="coming-soon-content">
            <div class="market-data-label">Market Data</div>
            <div class="coming-soon-text">COMING SOON</div>
          </div>
        </div>

        <!-- Blurred Content Container -->
        <div class="card-content-blur">
        <!-- Last refresh timestamp badge -->
        <div v-if="lastRefreshTime" class="refresh-badge">
          <v-tooltip bottom content-class="refresh-tooltip">
            <template v-slot:activator="{ on, attrs }">
              <v-icon
                small
                :color="primaryColor"
                v-bind="attrs"
                v-on="on"
                class="refresh-icon"
              >
                mdi-clock-outline
              </v-icon>
            </template>
            <div class="refresh-tooltip-content">
              <div><strong>Last Updated:</strong> {{ formatFullRefreshTime() }}</div>
              <div><strong>Next Update:</strong> {{ formatNextRefreshTime() }}</div>
            </div>
          </v-tooltip>
        </div>

        <v-card-title class="px-2 py-1">
          <v-icon left size="16" class="volume-icon">mdi-trending-up</v-icon>
          <span class="text-subtitle-1">Top Volume</span>
        </v-card-title>
        <v-card-text class="px-2 pt-0 pb-1">
          <div v-if="loading" class="text-center py-4">
            <v-progress-circular indeterminate small></v-progress-circular>
          </div>
          <div v-else-if="error" class="text-center py-4">
            <div class="caption grey--text">{{ error }}</div>
          </div>
          <div v-else-if="marketData.topVolume.length === 0" class="text-center py-4">
            <div class="caption grey--text">No volume data available</div>
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
                  <div v-else class="token-placeholder">{{ (token.ticker || token.symbol || '?').charAt(0).toUpperCase() }}</div>
                </v-avatar>
                <div class="token-info">
                  <div class="font-weight-medium token-ticker">{{ token.ticker || token.symbol }}</div>
                  <div class="caption grey--text token-name">{{ token.name || 'Token' }}</div>
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
      <v-card flat outlined class="compact-card gainers-card liquid-glass-compact" style="position: relative;">
        <!-- Coming Soon Overlay -->
        <div class="coming-soon-overlay">
          <div class="coming-soon-content">
            <div class="market-data-label">Market Data</div>
            <div class="coming-soon-text">COMING SOON</div>
          </div>
        </div>

        <!-- Blurred Content Container -->
        <div class="card-content-blur">
        <!-- Last refresh timestamp badge -->
        <div v-if="lastRefreshTime" class="refresh-badge">
          <v-tooltip bottom content-class="refresh-tooltip">
            <template v-slot:activator="{ on, attrs }">
              <v-icon
                small
                :color="primaryColor"
                v-bind="attrs"
                v-on="on"
                class="refresh-icon"
              >
                mdi-clock-outline
              </v-icon>
            </template>
            <div class="refresh-tooltip-content">
              <div><strong>Last Updated:</strong> {{ formatFullRefreshTime() }}</div>
              <div><strong>Next Update:</strong> {{ formatNextRefreshTime() }}</div>
            </div>
          </v-tooltip>
        </div>

        <v-card-title class="px-2 py-1">
          <v-icon left size="16" class="gainers-icon">mdi-chart-line</v-icon>
          <span class="text-subtitle-1">Top Gainers</span>
        </v-card-title>
        <v-card-text class="px-2 pt-0 pb-1">
          <div v-if="loading" class="text-center py-4">
            <v-progress-circular indeterminate small></v-progress-circular>
          </div>
          <div v-else-if="error" class="text-center py-4">
            <div class="caption grey--text">{{ error }}</div>
          </div>
          <div v-else-if="marketData.topGainers.length === 0" class="text-center py-4">
            <div class="caption grey--text">No gainers available</div>
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
                  <div v-else class="token-placeholder">{{ (token.ticker || token.symbol || '?').charAt(0).toUpperCase() }}</div>
                </v-avatar>
                <div class="token-info">
                  <div class="font-weight-medium token-ticker">{{ token.ticker || token.symbol }}</div>
                  <div class="caption grey--text token-name">{{ token.name || 'Token' }}</div>
                </div>
              </div>
              <div class="text-right">
                <div class="d-flex align-center">
                  <v-avatar tile size="12" class="mr-1">
                    <v-img :src="getChangeIcon(token.dailyPriceChange)" alt="trend" />
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
      <v-card flat outlined class="compact-card mcap-card liquid-glass-compact" style="position: relative;">
        <!-- Coming Soon Overlay -->
        <div class="coming-soon-overlay">
          <div class="coming-soon-content">
            <div class="market-data-label">Market Data</div>
            <div class="coming-soon-text">COMING SOON</div>
          </div>
        </div>

        <!-- Blurred Content Container -->
        <div class="card-content-blur">
        <!-- Last refresh timestamp badge -->
        <div v-if="lastRefreshTime" class="refresh-badge">
          <v-tooltip bottom content-class="refresh-tooltip">
            <template v-slot:activator="{ on, attrs }">
              <v-icon
                small
                :color="primaryColor"
                v-bind="attrs"
                v-on="on"
                class="refresh-icon"
              >
                mdi-clock-outline
              </v-icon>
            </template>
            <div class="refresh-tooltip-content">
              <div><strong>Last Updated:</strong> {{ formatFullRefreshTime() }}</div>
              <div><strong>Next Update:</strong> {{ formatNextRefreshTime() }}</div>
            </div>
          </v-tooltip>
        </div>

        <v-card-title class="py-1">
          <v-icon left size="16" class="mcap-icon">mdi-finance</v-icon>
          <span class="text-subtitle-1">Top TVL</span>
        </v-card-title>
        <v-card-text class="pt-0 pb-1">
          <div v-if="loading" class="text-center py-4">
            <v-progress-circular indeterminate small></v-progress-circular>
          </div>
          <div v-else-if="error" class="text-center py-4">
            <div class="caption grey--text">{{ error }}</div>
          </div>
          <div v-else-if="marketData.topTvl.length === 0" class="text-center py-4">
            <div class="caption grey--text">No TVL data available</div>
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
                  <div v-else class="token-placeholder">{{ (token.ticker || token.symbol || '?').charAt(0).toUpperCase() }}</div>
                </v-avatar>
                <div class="token-info">
                  <div class="font-weight-medium token-ticker">{{ token.ticker || token.symbol }}</div>
                  <div class="caption grey--text token-name">{{ token.name || 'Token' }}</div>
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
import { computed, onMounted, onUnmounted, ref } from 'vue';
import charli3Store from '@/stores/charli3Store';
// import Charli3API from '@/api/charli3-api'  // Commented out - using mock data
import assts from '@/utils/assets';

// Reactive state
const marketDataInterval = ref<ReturnType<typeof setInterval> | null>(null)
const countdownInterval = ref<ReturnType<typeof setInterval> | null>(null)
const logoLoadingActive = ref(false)

// Computed properties
const marketData = computed(() => charli3Store.state.marketData)
const loading = computed(() => charli3Store.state.loading)
const error = computed(() => charli3Store.state.error)
const lastRefreshTime = computed(() => charli3Store.state.lastRefreshTime)
const primaryColor = computed(() => '#00c7f3')

// Methods
const loadMarketData = async (isBackgroundRefresh = false) => {
  // Only show loading state on initial load, not during background refresh
  if (!isBackgroundRefresh) {
    charli3Store.setLoading(true)
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
          logoUrl: null
        },
        {
          ticker: 'MIN',
          name: 'Minswap',
          symbol: 'MIN',
          dailyVolume: 8500000,
          currentPrice: 0.042,
          logoUrl: null
        },
        {
          ticker: 'SUNDAE',
          name: 'SundaeSwap',
          symbol: 'SUNDAE',
          dailyVolume: 3200000,
          currentPrice: 0.0089,
          logoUrl: null
        }
      ],
      topGainers: [
        {
          ticker: 'SNEK',
          name: 'Snek',
          symbol: 'SNEK',
          dailyPriceChange: 24.5,
          currentPrice: 0.00032,
          logoUrl: null
        },
        {
          ticker: 'HOSKY',
          name: 'Hosky Token',
          symbol: 'HOSKY',
          dailyPriceChange: 18.2,
          currentPrice: 0.0000012,
          logoUrl: null
        },
        {
          ticker: 'WMT',
          name: 'World Mobile Token',
          symbol: 'WMT',
          dailyPriceChange: 12.8,
          currentPrice: 0.21,
          logoUrl: null
        }
      ],
      topTvl: [
        {
          ticker: 'INDY',
          name: 'Indigo Protocol',
          symbol: 'INDY',
          currentTvl: 48500000,
          currentPrice: 1.82,
          logoUrl: null
        },
        {
          ticker: 'LQ',
          name: 'Liqwid Finance',
          symbol: 'LQ',
          currentTvl: 35200000,
          currentPrice: 2.45,
          logoUrl: null
        },
        {
          ticker: 'DJED',
          name: 'Djed Stablecoin',
          symbol: 'DJED',
          currentTvl: 28900000,
          currentPrice: 1.01,
          logoUrl: null
        }
      ]
    }

    console.debug('Using mock market data:', mockData)

    charli3Store.setMarketData(mockData)

    // Skip logo loading for mock data
    // loadLogosInBackground()

  } catch (error) {
    console.error('Failed to load market data:', error)
    charli3Store.setError(error instanceof Error ? error.message : 'Failed to load market data')
  } finally {
    if (!isBackgroundRefresh) {
      charli3Store.setLoading(false)
    }
  }
}

const processTokenData = async (tokens: any[], category = 'unknown') => {
  if (!tokens || !Array.isArray(tokens)) return []

  const processedTokens = []

  for (const token of tokens) {
    // Extract readable ticker from description field
    let ticker = 'Unknown'
    let name = 'Unknown Token'

    if (token.description) {
      const parts = token.description.split(' / ')
      if (parts.length >= 2) {
        const tokenName = parts[1].trim()
        if (tokenName.includes('Token')) {
          ticker = tokenName.replace(' Token', '').toUpperCase()
        } else if (tokenName.includes('DAO')) {
          ticker = tokenName.split(' ')[0].toUpperCase()
        } else {
          ticker = tokenName.split(' ')[0].toUpperCase()
        }
        name = tokenName
      } else if (parts.length === 1) {
        const tokenName = parts[0].trim()
        if (tokenName && tokenName !== '') {
          ticker = tokenName.split(' ')[0].toUpperCase()
          name = tokenName
        }
      }
    }

    // Handle special cases for known tokens
    if (token.description && token.description.includes('HOSKY')) {
      ticker = 'HOSKY'
      name = 'HOSKY Token'
    } else if (token.description && token.description.includes('Minswap')) {
      ticker = 'MIN'
      name = 'Minswap'
    } else if (token.description && token.description.includes('Liqwid')) {
      ticker = 'LQ'
      name = 'Liqwid DAO Token'
    } else if (token.description && token.description.includes('SUNDAE')) {
      ticker = 'SUNDAE'
      name = 'SUNDAE'
    }

    // Skip invalid tokens
    if (!token.description ||
        token.description === '' ||
        ticker === 'Unknown' ||
        ticker === '' ||
        name === 'Unknown Token') {
      continue
    }

    // Validate numeric values
    const dailyVolume = Number(token.dailyVolume) || 0
    const currentTvl = Number(token.currentTvl) || 0
    const currentPrice = Number(token.currentPrice) || 0
    const dailyPriceChange = Number(token.dailyPriceChange) || 0

    // Skip tokens with unrealistic values
    if (currentTvl > 1000000000000 || currentTvl < 0 || currentPrice < 0) {
      continue
    }

    processedTokens.push({
      ...token,
      ticker,
      name,
      symbol: ticker,
      logoUrl: null, // Will be loaded separately
      dailyVolume,
      dailyPriceChange,
      currentPrice,
      currentTvl
    })
  }

  return processedTokens
}

const loadLogosInBackground = async () => {
  if (logoLoadingActive.value) return
  logoLoadingActive.value = true

  try {
    // Get top 3 tokens from each category that need logos
    const tokensToProcess = [
      ...marketData.value.topVolume.slice(0, 3),
      ...marketData.value.topGainers.slice(0, 3),
      ...marketData.value.topTvl.slice(0, 3)
    ].filter(token => token && !token.logoUrl) // Only process valid tokens without logos

    // Remove duplicates based on ticker
    const uniqueTokens = tokensToProcess.filter((token, index, arr) =>
      token && token.ticker && arr.findIndex(t => t.ticker === token.ticker) === index
    )

    // Process tokens one at a time to avoid rate limiting
    for (let i = 0; i < uniqueTokens.length; i++) {
      const token = uniqueTokens[i]

      try {
        const logoUrl = await getTokenLogoFromAPI(token)
        if (logoUrl && logoUrl.startsWith('data:')) {
          // Only update if we got a valid data URL
          charli3Store.updateTokenLogo(token.ticker, logoUrl)
        }
      } catch (error) {
        console.warn(`Failed to load logo for ${token.ticker}:`, error)
      }

      // Add delay between requests to avoid rate limiting
      if (i < uniqueTokens.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  } catch (error) {
    console.error('Error in loadLogosInBackground:', error)
  } finally {
    logoLoadingActive.value = false
  }
}

const getTokenLogoFromAPI = async (token: any) => {
  const cacheKey = token.ticker || token.symbol

  if (!cacheKey) return null

  // Try Charli3 API for logo
  if (token.currency) {
    const fullAssetId = token.currency
    return await Charli3API.getTokenLogo(fullAssetId)
  }

  return null
}

const onImageError = (token: any) => {
  // If image fails to load, clear the logoUrl to show placeholder
  token.logoUrl = null
}

const formatCurrency = (value: number) => {
  if (!value) return '0'
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`
  return value.toFixed(2)
}

const formatPercentage = (change: number) => {
  if (!change) return '0.00%'
  return `${Math.abs(change).toFixed(2)}%`
}

const getChangeIcon = (change: number) => {
  if (!change || change === 0) return assts.arrowRightSvg
  return change > 0 ? assts.trendUpSvg : assts.trendDownSvg
}

const getChangeColor = (change: number) => {
  if (!change || change === 0) return 'neutral-change'
  return change > 0 ? 'positive-change' : 'negative-change'
}

const formatFullRefreshTime = () => {
  if (!lastRefreshTime.value) return ''
  // Handle both Date objects and ISO strings from storage
  const date = lastRefreshTime.value instanceof Date
    ? lastRefreshTime.value
    : new Date(lastRefreshTime.value)
  return date.toLocaleTimeString()
}

const formatNextRefreshTime = () => {
  const nextRefreshTime = charli3Store.getNextRefreshTime()
  if (!nextRefreshTime) return ''

  const now = new Date()
  const diffMs = nextRefreshTime - now
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffMs / 60000)

  if (diffMs <= 0) return 'Now'
  if (diffSeconds < 60) return `In ${diffSeconds} seconds`
  if (diffMinutes === 1) return 'In 1 minute'
  return `In ${diffMinutes} minutes`
}

// Lifecycle hooks
onMounted(async () => {
  // Clear any invalid blob URLs from cache immediately on mount
  charli3Store.clearInvalidBlobUrls()

  // Load market data if it's stale or missing
  if (charli3Store.isDataStale() || marketData.value.topVolume.length === 0) {
    await loadMarketData()
  } else {
    // Load logos for cached data
    loadLogosInBackground()
  }

  // Refresh market data every 5 minutes (background refresh)
  marketDataInterval.value = setInterval(async () => {
    await loadMarketData(true) // true indicates background refresh
  }, 5 * 60 * 1000)

  // Update countdown every 10 seconds for real-time display
  countdownInterval.value = setInterval(() => {
    // Force re-render to update countdown - in Composition API we don't need $forceUpdate
    // The reactive refs will automatically trigger updates
  }, 10000)

  // Clean expired logos every hour
  setInterval(() => {
    charli3Store.clearExpiredLogos()
  }, 60 * 60 * 1000)
})

onUnmounted(() => {
  if (marketDataInterval.value) {
    clearInterval(marketDataInterval.value)
  }
  if (countdownInterval.value) {
    clearInterval(countdownInterval.value)
  }
})
</script>

<style scoped>
.owned-tokens-market-cards {
  margin: 0;
}

.compact-card {
  height: 160px;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.refresh-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
}

.refresh-icon {
  background-color: rgba(20, 20, 20, 0.7);
  border-radius: 50%;
  padding: 4px;
  backdrop-filter: blur(4px);
  transition: all 0.2s ease;
}

.refresh-icon:hover {
  background-color: rgba(20, 20, 20, 0.9);
  transform: scale(1.1);
}

.refresh-tooltip {
  padding: 8px 12px !important;
  border-radius: 8px !important;
  background-color: rgba(20, 20, 20, 0.95) !important;
  border: 1px solid rgba(0, 199, 243, 0.3) !important;
  backdrop-filter: blur(8px) !important;
}

.refresh-tooltip-content {
  line-height: 1.3;
}

.refresh-tooltip-content div {
  margin-bottom: 2px;
  color: #ffffff;
}

.refresh-tooltip-content div:last-child {
  margin-bottom: 0;
}

.refresh-tooltip-content strong {
  color: #00c7f3;
}

.compact-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.volume-card {
  border-left: 4px solid #2196F3!important;
  animation: volumeColorShift 8s ease-in-out infinite;
}

.gainers-card {
  border-left: 4px solid #3F51B5!important;
  animation: gainersColorShift 10s ease-in-out infinite;
}

.mcap-card {
  border-left: 4px solid #607D8B!important;
  animation: mcapColorShift 12s ease-in-out infinite;
}

@keyframes volumeColorShift {
  0%, 100% { border-left-color: #2196F3; }
  25% { border-left-color: #1976D2; }
  50% { border-left-color: #0D47A1; }
  75% { border-left-color: #1565C0; }
}

@keyframes gainersColorShift {
  0%, 100% { border-left-color: #3F51B5; }
  25% { border-left-color: #303F9F; }
  50% { border-left-color: #1A237E; }
  75% { border-left-color: #283593; }
}

@keyframes mcapColorShift {
  0%, 100% { border-left-color: #607D8B; }
  25% { border-left-color: #455A64; }
  50% { border-left-color: #263238; }
  75% { border-left-color: #37474F; }
}

.volume-icon {
  color: #2196F3 !important;
  animation: volumeIconShift 8s ease-in-out infinite;
}

.gainers-icon {
  color: #3F51B5 !important;
  animation: gainersIconShift 10s ease-in-out infinite;
}

.mcap-icon {
  color: #607D8B !important;
  animation: mcapIconShift 12s ease-in-out infinite;
}

@keyframes volumeIconShift {
  0%, 100% { color: #2196F3 !important; }
  25% { color: #1976D2 !important; }
  50% { color: #0D47A1 !important; }
  75% { color: #1565C0 !important; }
}

@keyframes gainersIconShift {
  0%, 100% { color: #3F51B5 !important; }
  25% { color: #303F9F !important; }
  50% { color: #1A237E !important; }
  75% { color: #283593 !important; }
}

@keyframes mcapIconShift {
  0%, 100% { color: #607D8B !important; }
  25% { color: #455A64 !important; }
  50% { color: #263238 !important; }
  75% { color: #37474F !important; }
}

.compact-item {
  padding: 4px 6px;
  border-radius: 6px;
  transition: all 0.2s ease;
  margin-bottom: 1px;
}

.positive-change {
  color: #4CAF50;
  font-weight: 600;
}

.negative-change {
  color: #F44336;
  font-weight: 600;
}

.neutral-change {
  color: #757575;
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
  background: linear-gradient(135deg, #00c7f3, #00ffd1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #000;
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
  border-radius: 8px;
}

.coming-soon-content {
  text-align: center;
}

.market-data-label {
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
  opacity: 0.9;
}

.coming-soon-text {
  color: #888888;
  font-size: 0.9rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  opacity: 0.7;
}
</style>
