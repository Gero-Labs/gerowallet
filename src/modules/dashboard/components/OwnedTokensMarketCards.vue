<template>
  <v-row no-gutters class="owned-tokens-market-cards">
    <!-- Top by Volume (from owned tokens) -->
    <v-col cols="12" lg="4" class="pr-2">
      <v-card flat outlined class="compact-card volume-card" style="position: relative;">
        <!-- Coming Soon Overlay - COMMENTED OUT FOR FUTURE USE -->
        <!-- 
        <div class="market-cards-overlay">
          <div class="market-cards-message">
            <v-icon color="primary" class="mb-2">mdi-trending-up</v-icon>
            <div class="text-body-2" style="color: white; font-weight: 600;">Volume Analytics</div>
            <div class="caption" style="color: #888888;">Coming Soon</div>
          </div>
        </div>
        -->
        
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
          <v-icon left size="16" class="volume-icon">mdi-trending-up</v-icon>
          <span class="text-subtitle-1">Top Volume</span>
        </v-card-title>
        <v-card-text class="pt-0 pb-1">
          <div v-if="loadingMarketData" class="text-center py-4">
            <v-progress-circular indeterminate small></v-progress-circular>
          </div>
          <div v-else-if="marketDataError" class="text-center py-4">
            <div class="caption grey--text">{{ marketDataError }}</div>
          </div>
          <div v-else-if="marketData.topVolume.length === 0" class="text-center py-4">
            <div class="caption grey--text">No volume data available</div>
          </div>
          <div
            v-else
            v-for="(token, index) in marketData.topVolume.slice(0, 3)"
            :key="token.symbol || token.ticker"
            class="compact-item d-flex align-center justify-space-between py-0"
          >
            <div class="d-flex align-center">
              <span class="caption grey--text mr-2">{{ index + 1 }}.</span>
              <v-avatar size="20" class="mr-2">
                <img 
                  v-if="getTokenLogo(token)" 
                  :src="getTokenLogo(token)" 
                  :alt="`${token.ticker || token.symbol} Logo`"
                  @error="onImageError(token)"
                />
                <div v-else class="token-placeholder">{{ (token.ticker || token.symbol || '?').charAt(0).toUpperCase() }}</div>
              </v-avatar>
              <!-- Debug: Show what logo URL is being used -->
              <div v-if="false" class="debug-logo" style="font-size: 10px; color: red;">{{ token.ticker }}: {{ getTokenLogo(token) || 'NO LOGO' }}</div>
              <div>
                <div class="font-weight-medium">{{ token.ticker || token.symbol }}</div>
                <div class="caption grey--text">{{ token.name || 'Token' }}</div>
              </div>
            </div>
            <div class="text-right">
              <div class="caption">${{ formatCurrency(token.dailyVolume || 0) }}</div>
              <div class="caption grey--text">${{ formatCurrency(token.currentPrice || 0) }}</div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <!-- Top by Price Change (from owned tokens) -->
    <v-col cols="12" lg="4" class="px-2">
      <v-card flat outlined class="compact-card gainers-card" style="position: relative;">
        <!-- Coming Soon Overlay - COMMENTED OUT FOR FUTURE USE -->
        <!-- 
        <div class="market-cards-overlay">
          <div class="market-cards-message">
            <v-icon color="primary" class="mb-2">mdi-chart-line</v-icon>
            <div class="text-body-2" style="color: white; font-weight: 600;">Price Analytics</div>
            <div class="caption" style="color: #888888;">Coming Soon</div>
          </div>
        </div>
        -->
        
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
          <v-icon left size="16" class="gainers-icon">mdi-chart-line</v-icon>
          <span class="text-subtitle-1">Top Gainers</span>
        </v-card-title>
        <v-card-text class="pt-0 pb-1">
          <div v-if="loadingMarketData" class="text-center py-4">
            <v-progress-circular indeterminate small></v-progress-circular>
          </div>
          <div v-else-if="marketDataError" class="text-center py-4">
            <div class="caption grey--text">{{ marketDataError }}</div>
          </div>
          <div v-else-if="marketData.topGainers.length === 0" class="text-center py-4">
            <div class="caption grey--text">No gainers available</div>
          </div>
          <div
            v-else
            v-for="(token, index) in marketData.topGainers.slice(0, 3)"
            :key="token.symbol || token.ticker"
            class="compact-item d-flex align-center justify-space-between py-0"
          >
            <div class="d-flex align-center">
              <span class="caption grey--text mr-2">{{ index + 1 }}.</span>
              <v-avatar size="20" class="mr-2">
                <img 
                  v-if="getTokenLogo(token)" 
                  :src="getTokenLogo(token)" 
                  :alt="`${token.ticker || token.symbol} Logo`"
                  @error="onImageError(token)"
                />
                <div v-else class="token-placeholder">{{ (token.ticker || token.symbol || '?').charAt(0).toUpperCase() }}</div>
              </v-avatar>
              <!-- Debug: Show what logo URL is being used -->
              <div v-if="false" class="debug-logo" style="font-size: 10px; color: red;">{{ token.ticker }}: {{ getTokenLogo(token) || 'NO LOGO' }}</div>
              <div>
                <div class="font-weight-medium">{{ token.ticker || token.symbol }}</div>
                <div class="caption grey--text">{{ token.name || 'Token' }}</div>
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
        </v-card-text>
      </v-card>
    </v-col>

    <!-- Top by Market Cap (from owned tokens) -->
    <v-col cols="12" lg="4" class="pl-2">
      <v-card flat outlined class="compact-card mcap-card" style="position: relative;">
        <!-- Coming Soon Overlay - COMMENTED OUT FOR FUTURE USE -->
        <!-- 
        <div class="market-cards-overlay">
          <div class="market-cards-message">
            <v-icon color="primary" class="mb-2">mdi-finance</v-icon>
            <div class="text-body-2" style="color: white; font-weight: 600;">Market Analytics</div>
            <div class="caption" style="color: #888888;">Coming Soon</div>
          </div>
        </div>
        -->
        
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
          <div v-if="loadingMarketData" class="text-center py-4">
            <v-progress-circular indeterminate small></v-progress-circular>
          </div>
          <div v-else-if="marketDataError" class="text-center py-4">
            <div class="caption grey--text">{{ marketDataError }}</div>
          </div>
          <div v-else-if="marketData.topTvl.length === 0" class="text-center py-4">
            <div class="caption grey--text">No TVL data available</div>
          </div>
          <div
            v-else
            v-for="(token, index) in marketData.topTvl.slice(0, 3)"
            :key="token.symbol || token.ticker"
            class="compact-item d-flex align-center justify-space-between py-0"
          >
            <div class="d-flex align-center">
              <span class="caption grey--text mr-2">{{ index + 1 }}.</span>
              <v-avatar size="20" class="mr-2">
                <img 
                  v-if="getTokenLogo(token)" 
                  :src="getTokenLogo(token)" 
                  :alt="`${token.ticker || token.symbol} Logo`"
                  @error="onImageError(token)"
                />
                <div v-else class="token-placeholder">{{ (token.ticker || token.symbol || '?').charAt(0).toUpperCase() }}</div>
              </v-avatar>
              <!-- Debug: Show what logo URL is being used -->
              <div v-if="false" class="debug-logo" style="font-size: 10px; color: red;">{{ token.ticker }}: {{ getTokenLogo(token) || 'NO LOGO' }}</div>
              <div>
                <div class="font-weight-medium">{{ token.ticker || token.symbol }}</div>
                <div class="caption grey--text">{{ token.name || 'Token' }}</div>
              </div>
            </div>
            <div class="text-right">
              <div class="caption">${{ formatCurrency(token.currentTvl || 0) }}</div>
              <div class="caption grey--text">${{ formatCurrency(token.currentPrice || 0) }}</div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>
    
    <!-- Technical Analysis Modal -->
    <v-dialog v-model="showTechnicalAnalysis" :max-width="swapPanelOpen ? 1600 : 1200" scrollable>
      <v-card style="background-color: #141414; font-family: 'Inter', sans-serif;">
        <v-card-title class="pa-4" style="background-color: #141414; color: white; font-family: 'Inter', sans-serif;">
          <v-badge
            overlap
            avatar
            color="transparent"
            :offset-y="36"
            :offset-x="24"
            v-if="selectedToken?.verified"
          >
            <template v-slot:badge>
              <v-avatar color="transparent" tile size="20">
                <v-icon small color="primary">
                  mdi-check-decagram
                </v-icon>
              </v-avatar>
            </template>
            <v-avatar size="32" class="mr-3">
              <img v-if="selectedToken?.img"
                :src="selectedToken?.img"
                :alt="`${selectedToken?.ticker} Logo`"
              />
            </v-avatar>
          </v-badge>
          <v-avatar size="32" class="mr-3" v-else>
            <img v-if="selectedToken?.img"
              :src="selectedToken?.img"
              :alt="`${selectedToken?.ticker} Logo`"
            />
          </v-avatar>
          {{ selectedToken?.name || selectedToken?.ticker }}
          <v-spacer></v-spacer>
          <v-btn 
            outlined 
            small 
            color="green" 
            class="mr-3"
            @click="toggleSwapPanel"
            :disabled="isSwapDisabled"
          >
            <v-icon left small>mdi-swap-horizontal</v-icon>
            {{ swapPanelOpen ? 'Close' : 'Buy' }}
          </v-btn>
          <v-btn icon @click="showTechnicalAnalysis = false">
            <v-icon color="white">mdi-close</v-icon>
          </v-btn>
        </v-card-title>

        <v-card-text class="pa-0" style="height: 600px; background-color: #141414; font-family: 'Inter', sans-serif;">
          <div v-if="analysisLoading" class="text-center py-8 d-flex align-center justify-center" style="height: 600px;">
            <div>
              <v-progress-circular indeterminate color="primary" size="64"></v-progress-circular>
              <div class="text-h6 mt-4">Analyzing {{ selectedToken?.name || selectedToken?.ticker }}...</div>
            </div>
          </div>
          
          <div v-else-if="analysisData" style="height: 100%; position: relative;">
            <div class="pa-4" style="height: 100%; background-color: #141414 !important;">
              <!-- Chart and Analysis Row -->
              <v-row no-gutters style="height: 100%;">
                <!-- Chart Column with Token Overview -->
                <v-col :cols="swapPanelOpen ? 6 : 8" class="pr-2" style="height: 100%; transition: all 0.3s ease;">
                  <!-- Token Overview Row -->
                  <v-card outlined class="mb-3 token-overview-card-compact" style="background-color: #0F0F0F !important; border-color: #404040; font-family: 'Inter', sans-serif;">
                    <v-card-text class="pa-2">
                      <!-- Table-like Headers -->
                      <div class="overview-headers mb-1">
                        <div class="overview-header">Risk</div>
                        <div class="overview-header">Quantity</div>
                        <div class="overview-header">Last Price</div>
                        <div class="overview-header">Change</div>
                        <div class="overview-header">Value</div>
                        <div class="overview-header">Market Cap</div>
                        <div class="overview-header">Allocation</div>
                      </div>
                      
                      <!-- Table-like Values -->
                      <div class="overview-values">
                        <div class="overview-value-item">
                          <div class="d-flex align-center justify-center" style="gap: 4px;">
                            <v-img 
                              v-if="selectedToken?.risk && selectedToken?.risk !== 'N/A'" 
                              width="16" 
                              height="16" 
                              :src="assts.resolveRisk(selectedToken.risk)" 
                              :alt="selectedToken.risk"
                            />
                            <span class="overview-value-text">{{ selectedToken?.risk || 'N/A' }}</span>
                          </div>
                        </div>
                        <div class="overview-value-item">
                          <span class="overview-value-text">{{ selectedToken?.quantity?.toLocaleString() || 'N/A' }}</span>
                        </div>
                        <div class="overview-value-item">
                          <span class="overview-value-text">${{ formatNumber(selectedToken?.last_price, 6) }}</span>
                        </div>
                        <div class="overview-value-item">
                          <div class="d-flex align-center justify-center" style="gap: 4px;">
                            <v-avatar tile size="12">
                              <v-img
                                :src="
                                  selectedToken?.change === 0
                                    ? assts.arrowRightSvg
                                    : selectedToken?.change > 0
                                    ? assts.trendUpSvg
                                    : assts.trendDownSvg
                                "
                                alt="trend"
                              ></v-img>
                            </v-avatar>
                            <span class="overview-value-text" :style="selectedToken?.change === 0 ? {color: '#A3A3A3' } : selectedToken?.change > 0 ? { color: '#47CD89' } : { color: '#F97066' }">
                              {{ selectedToken?.change ? formatNumber(Math.abs(selectedToken.change), 2) + '%' : 'N/A' }}
                            </span>
                          </div>
                        </div>
                        <div class="overview-value-item">
                          <span class="overview-value-text">${{ selectedToken?.value?.toLocaleString() || 'N/A' }}</span>
                        </div>
                        <div class="overview-value-item">
                          <span class="overview-value-text">${{ selectedToken?.mcap ? (Number(selectedToken.mcap)).toLocaleString() : 'N/A' }}</span>
                        </div>
                        <div class="overview-value-item">
                          <div class="d-flex align-center justify-center" style="gap: 4px;">
                            <v-progress-linear
                              :value="selectedToken?.total_allocation || 0"
                              color="#00dff3"
                              height="4"
                              rounded
                              style="width: 40px;"
                            ></v-progress-linear>
                            <span class="overview-value-text">{{ formatNumber(selectedToken?.total_allocation, 1) }}%</span>
                          </div>
                        </div>
                      </div>
                    </v-card-text>
                  </v-card>
                  
                  <!-- Chart Container -->
                  <div class="chart-container" style="height: 70%;">
                    <div ref="technicalChart" style="width: 100%; height: 100%;"></div>
                  </div>
                </v-col>
                
                <!-- Analysis Column -->
                <v-col :cols="swapPanelOpen ? 3 : 4" class="pl-2 pr-2" style="height: 100%; overflow-y: auto; transition: all 0.3s ease;">
                  <!-- Technical Analysis Overview -->
                  <v-card outlined class="mb-3" style="background-color: #0F0F0F !important; border-color: #404040; font-family: 'Inter', sans-serif;">
                    <v-card-title class="pb-2 text-subtitle-1" style="color: white; font-family: 'Inter', sans-serif;">
                      <v-icon left small color="white">mdi-chart-line</v-icon>
                      Technical Analysis
                    </v-card-title>
                    <v-card-text class="pt-0 pb-1">
                      <div class="mb-2">
                        <div class="text-caption mb-1" style="color: #888888;">Trend</div>
                        <div class="d-flex align-center" style="gap: 8px;">
                          <v-chip 
                            small 
                            :color="getTrendColor(analysisData.trend.direction)" 
                            outlined
                          >
                            <v-icon left x-small>{{ getTrendIcon(analysisData.trend.direction) }}</v-icon>
                            {{ analysisData.trend.direction.toUpperCase() }}
                          </v-chip>
                          <v-chip 
                            small 
                            :color="getStrengthColor(analysisData.trend.strength)" 
                            outlined
                          >
                            {{ analysisData.trend.strength.toUpperCase() }}
                          </v-chip>
                        </div>
                      </div>
                      <div>
                        <div class="text-caption" style="color: #888888;">Confidence</div>
                        <v-progress-linear
                          :value="analysisData.trend.confidence * 100"
                          :color="analysisData.trend.confidence > 0.7 ? 'green' : analysisData.trend.confidence > 0.4 ? 'orange' : 'red'"
                          height="8"
                          rounded
                          class="mt-1"
                        ></v-progress-linear>
                        <div class="text-caption text-center mt-1">
                          {{ Math.round(analysisData.trend.confidence * 100) }}%
                        </div>
                      </div>
                    </v-card-text>
                  </v-card>

                  <!-- Key Levels -->
                  <v-card outlined class="mb-3" style="background-color: #0F0F0F !important; border-color: #404040; font-family: 'Inter', sans-serif;">
                    <v-card-title class="pb-2 text-subtitle-1" style="color: white; font-family: 'Inter', sans-serif;">
                      <v-icon left small color="white">mdi-target</v-icon>
                      Key Levels
                    </v-card-title>
                    <v-card-text class="pt-0">
                      <v-row>
                        <v-col cols="6" class="pr-1">
                          <div class="text-caption grey--text mb-1">
                            <v-icon x-small color="green">mdi-arrow-up-bold</v-icon>
                            Support
                          </div>
                          <div 
                            v-for="(level, index) in analysisData.indicators.support.slice(0, 2)" 
                            :key="`support-${index}`"
                            class="d-flex justify-space-between align-center mb-1"
                          >
                            <span class="text-body-2">${{ level.toFixed(4) }}</span>
                            <v-chip x-small color="green" outlined>S{{ index + 1 }}</v-chip>
                          </div>
                        </v-col>
                        <v-col cols="6" class="pl-1">
                          <div class="text-caption grey--text mb-1">
                            <v-icon x-small color="red">mdi-arrow-down-bold</v-icon>
                            Resistance
                          </div>
                          <div 
                            v-for="(level, index) in analysisData.indicators.resistance.slice(0, 2)" 
                            :key="`resistance-${index}`"
                            class="d-flex justify-space-between align-center mb-1"
                          >
                            <span class="text-body-2">${{ level.toFixed(4) }}</span>
                            <v-chip x-small color="red" outlined>R{{ index + 1 }}</v-chip>
                          </div>
                        </v-col>
                      </v-row>
                    </v-card-text>
                  </v-card>

                  <!-- Quick Indicators -->
                  <v-card outlined style="background-color: #0F0F0F !important; border-color: #404040; font-family: 'Inter', sans-serif;">
                    <v-card-title class="pb-2 text-subtitle-1" style="color: white; font-family: 'Inter', sans-serif;">
                      <v-icon left small color="white">mdi-speedometer</v-icon>
                      Quick Indicators
                    </v-card-title>
                    <v-card-text class="pt-0">
                      <div class="mb-2">
                        <div class="d-flex justify-space-between align-center">
                          <span class="text-caption grey--text">RSI (14)</span>
                          <v-chip 
                            x-small 
                            :color="getRSISignalColor(analysisData.indicators.rsi.signal)" 
                            outlined
                          >
                            {{ formatNumber(analysisData.indicators.rsi.current, 1) }}
                          </v-chip>
                        </div>
                      </div>
                      <div class="mb-2">
                        <div class="d-flex justify-space-between align-center">
                          <span class="text-caption grey--text">MACD</span>
                          <v-chip 
                            x-small 
                            :color="getSignalColor(analysisData.indicators.macd.signal)" 
                            outlined
                          >
                            {{ analysisData.indicators.macd.signal.toUpperCase() }}
                          </v-chip>
                        </div>
                      </div>
                      <div>
                        <div class="d-flex justify-space-between align-center">
                          <span class="text-caption grey--text">Bollinger</span>
                          <v-chip 
                            x-small 
                            :color="getBollingerColor(analysisData.indicators.bollinger.signal)" 
                            outlined
                          >
                            {{ analysisData.indicators.bollinger.signal.toUpperCase() }}
                          </v-chip>
                        </div>
                      </div>
                    </v-card-text>
                  </v-card>
                </v-col>

                <!-- Swap Panel -->
                <v-col 
                  v-if="swapPanelOpen" 
                  cols="3" 
                  class="swap-panel pl-2" 
                  style="height: 100%; background-color: #141414;"
                >
                  <div class="pa-3" style="height: 100%; overflow-y: auto;">
                    <div class="d-flex align-center mb-3">
                      <v-icon color="white" class="mr-2" small>mdi-swap-horizontal</v-icon>
                      <span class="text-subtitle-1 font-weight-medium" style="color: white; font-family: 'Inter', sans-serif;">Swap</span>
                      <v-spacer></v-spacer>
                    </div>
                    <SwapWidget @onSwap="handleSwapComplete" :compact="true"></SwapWidget>
                  </div>
                </v-col>
              </v-row>
            </div>
          </div>
          
          <div v-else class="text-center py-8 d-flex align-center justify-center" style="height: 600px;">
            <div>
              <v-icon large color="grey">mdi-chart-bell-curve</v-icon>
              <div class="text-h6 grey--text mt-2">No Analysis Available</div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
    
  </v-row>
</template>

<script>
import { mapState } from 'pinia'
import { useStore } from '@/stores'
import { walletConfigStore } from '@/stores/modules/walletConfig'
import { dexHunterStore } from '@/stores/modules/dexhunter'
import assts from '@/utils/assets'
import filters from '@/shared/utils/filters'
import networks from '@/utils/networks'
import SwapWidget from '@/modules/swap/components/SwapWidget.vue'
import * as Highcharts from 'highcharts'
import Charli3API from '@/api/charli3-api'

export default {
  name: 'OwnedTokensMarketCards',
  components: {
    SwapWidget
  },
  data() {
    return {
      showTechnicalAnalysis: false,
      selectedToken: null,
      analysisData: null,
      analysisLoading: false,
      swapPanelOpen: false,
      assts,
      // Market data state
      marketData: {
        topVolume: [],
        topGainers: [],
        topTvl: []
      },
      loadingMarketData: false,
      marketDataError: null,
      marketDataInterval: null,
      lastRefreshTime: null,
      nextRefreshTime: null,
      isBackgroundRefresh: false,
      countdownInterval: null,
      // Logo caching
      logoCache: new Map(),
      logoCacheExpiry: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
      logoCacheCleanupInterval: null,
      // Rate limiting for API calls
      lastCharli3Request: 0,
      charli3RequestInterval: 2000, // 2 seconds between requests
    }
  },
  computed: {
    ...mapState(() => useStore(), ['loggedWallet', 'resolvedAssets', 'price', 'loadingTxs']),
    
    primaryColor() {
      return this.loggedWallet?.chain === 'Apex Fusion Prime' || this.loggedWallet?.chain === 'Apex Fusion Vector' 
        ? '#dc753e' 
        : '#00c7f3'
    },
    
    loadingOwnedTokens() {
      return this.loadingTxs || !this.resolvedAssets
    },
    
    isSwapDisabled() {
      return !this.selectedToken || this.selectedToken.name === networks.resolveCurrencyName(this.loggedWallet?.chain, this.loggedWallet?.network)
    }
  },
  
  methods: {
    async loadMarketData(isBackgroundRefresh = false) {
      // Only show loading state on initial load, not during background refresh
      if (!isBackgroundRefresh) {
        this.loadingMarketData = true
      }
      this.marketDataError = null
      
      try {
        // Use real-time data for better performance
        const data = await Charli3API.getTopPerformersRealTime(10)
        
        this.marketData = {
          topVolume: await this.processTokenData(data.topVolume, 'topVolume'),
          topGainers: await this.processTokenData(data.topGainers, 'topGainers'),
          topTvl: await this.processTokenData(data.topTvl, 'topTvl')
        }
        
        // Update last refresh time and calculate next refresh
        this.lastRefreshTime = new Date()
        this.nextRefreshTime = new Date(this.lastRefreshTime.getTime() + 5 * 60 * 1000)
      } catch (error) {
        console.error('Failed to load market data:', error)
        this.marketDataError = 'Failed to load market data'
        // Fallback to empty data
        this.marketData = {
          topVolume: [],
          topGainers: [],
          topTvl: []
        }
      } finally {
        this.loadingMarketData = false
      }
    },
    
    async processTokenData(tokens, category = 'unknown') {
      if (!tokens || !Array.isArray(tokens)) return []
      
      // First, process all tokens to extract basic information
      const basicProcessedTokens = []
      
      for (const token of tokens) {
        
        // Extract readable ticker from description field
        let ticker = 'Unknown'
        let name = 'Unknown Token'
        
        if (token.description) {
          // Parse description like "Cardano / HOSKY Token"
          const parts = token.description.split(' / ')
          if (parts.length >= 2) {
            const tokenName = parts[1].trim()
            // Extract ticker from token name (usually the first word or abbreviated form)
            if (tokenName.includes('Token')) {
              ticker = tokenName.replace(' Token', '').toUpperCase()
            } else if (tokenName.includes('DAO')) {
              ticker = tokenName.split(' ')[0].toUpperCase()
            } else {
              // For tokens like "Minswap", "SUNDAE", etc.
              ticker = tokenName.split(' ')[0].toUpperCase()
            }
            name = tokenName
          } else if (parts.length === 1) {
            // Handle cases where there's no " / " separator
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
        
        // More aggressive filtering for invalid tokens
        if (!token.description || 
            token.description === '' || 
            token.description.trim() === '' ||
            ticker === 'Unknown' ||
            ticker === '' ||
            ticker === '?' ||
            name === 'Unknown Token' ||
            name === 'Token' ||
            name === '') {
          continue
        }
        
        // Validate numeric values and set reasonable limits
        const dailyVolume = Number(token.dailyVolume) || 0
        const currentTvl = Number(token.currentTvl) || 0
        const currentPrice = Number(token.currentPrice) || 0
        const dailyPriceChange = Number(token.dailyPriceChange) || 0
        
        // Skip tokens with unrealistic values
        if (currentTvl > 1000000000000 || // Over $1T TVL
            currentTvl < 0 || // Negative TVL
            currentPrice < 0 || // Negative price
            isNaN(currentTvl) || // Invalid numbers
            isNaN(currentPrice)) {
          continue
        }
        
        // Skip tokens that only have a single character or symbol
        if (ticker.length <= 1 && ticker !== 'Q') { // Allow single letter tokens like Q but filter out ?
          continue
        }
        
        basicProcessedTokens.push({
          ...token,
          ticker,
          name,
          symbol: ticker,
          logoUrl: null, // Will be filled in parallel
          // Ensure we have the necessary fields for display
          dailyVolume,
          dailyPriceChange,
          currentPrice,
          currentTvl
        })
      }
      
      // Fetch logos in background without blocking UI
      this.loadLogosInBackground(basicProcessedTokens)
      
      return basicProcessedTokens
    },
    
    async loadLogosInBackground(tokens) {
      // Get the first 3 tokens from the current batch as these are the ones that will be displayed
      const tokensToProcess = tokens.slice(0, 3)
      
      // Process tokens ONE AT A TIME to avoid rate limiting
      for (let i = 0; i < tokensToProcess.length; i++) {
        const token = tokensToProcess[i]
        
        try {
          const logoUrl = await this.getTokenLogoFromAPI(token, token.ticker)
          if (logoUrl) {
            // Update the token object directly
            this.$set(token, 'logoUrl', logoUrl)
            // Also update in all market data arrays as backup
            this.updateTokenLogo(token.ticker, logoUrl)
          }
        } catch (error) {
          console.warn(`Failed to load logo for ${token.ticker}:`, error)
        }
        
        // Add delay between each logo request to avoid rate limiting
        if (i < tokensToProcess.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
    },
    
    updateTokenLogo(ticker, logoUrl) {
      // Update logo in all market data arrays
      const updateTokenInArray = (tokens) => {
        const token = tokens.find(t => t.ticker === ticker)
        if (token) {
          this.$set(token, 'logoUrl', logoUrl)
          return true
        }
        return false
      }
      
      updateTokenInArray(this.marketData.topVolume)
      updateTokenInArray(this.marketData.topGainers)
      updateTokenInArray(this.marketData.topTvl)
    },
    
    async getTokenLogoFromAPI(token, ticker) {
      // Create cache key - use ticker primarily, fallback to symbol
      const cacheKey = ticker || token.symbol || token.ticker
      
      if (!cacheKey) {
        return null
      }
      
      // Check if logo is cached and not expired
      const cachedEntry = this.logoCache.get(cacheKey)
      if (cachedEntry) {
        const now = Date.now()
        if (now - cachedEntry.timestamp < this.logoCacheExpiry) {
          return cachedEntry.logoUrl
        } else {
          // Remove expired entry
          this.logoCache.delete(cacheKey)
        }
      }
      
      // TIER 1: Check if user owns this token (fastest, most reliable)
      const ownedTokenLogo = this.getLogoFromOwnedTokens(token, ticker)
      if (ownedTokenLogo) {
        this.logoCache.set(cacheKey, {
          logoUrl: ownedTokenLogo,
          timestamp: Date.now()
        })
        return ownedTokenLogo
      }
      
      // TIER 2: Try DexHunter database (comprehensive token logo database) - only for known tokens
      if (this.shouldTryDexHunter(ticker)) {
        const dexHunterLogo = await this.getLogoFromDexHunter(token, ticker, cacheKey)
        if (dexHunterLogo) {
          this.logoCache.set(cacheKey, {
            logoUrl: dexHunterLogo,
            timestamp: Date.now()
          })
          return dexHunterLogo
        }
      }
      
      // TIER 3: Try Charli3 API (base64 conversion) - with rate limiting protection
      const charli3Logo = await this.getLogoFromCharli3(token, ticker, cacheKey)
      if (charli3Logo) {
        this.logoCache.set(cacheKey, {
          logoUrl: charli3Logo,
          timestamp: Date.now()
        })
        return charli3Logo
      }
      
      // TIER 4: No logo found, return null (will show placeholder)
      this.logoCache.set(cacheKey, {
        logoUrl: null,
        timestamp: Date.now()
      })
      return null
    },
    
    getLogoFromOwnedTokens(token, ticker) {
      if (!this.resolvedAssets) {
        return null
      }
      
      // Try to match by ticker, symbol, or name with strict matching to avoid false positives
      const ownedToken = this.resolvedAssets.find(owned => {
        const metadata = owned.metadata || {}
        
        // Primary exact matches (case-sensitive first, then case-insensitive)
        if (metadata.ticker === ticker || metadata.ticker?.toUpperCase() === ticker?.toUpperCase()) {
          return true
        }
        
        // Secondary name matches (only if ticker is not common like ADA)
        if (ticker !== 'ADA' && ticker !== 'CARDANO') {
          if (metadata.name === token.name || metadata.name?.toUpperCase() === ticker?.toUpperCase()) {
            return true
          }
        }
        
        // Description includes (very strict to avoid false positives)
        if (token.description && metadata.ticker && ticker !== 'ADA') {
          const descriptionParts = token.description.split(' / ')
          const tokenPart = descriptionParts.length > 1 ? descriptionParts[1].trim() : ''
          if (tokenPart && (tokenPart.includes(metadata.ticker) || tokenPart.includes(metadata.name))) {
            return true
          }
        }
        
        return false
      })
      
      if (ownedToken && ownedToken.img) {
        return ownedToken.img
      }
      
      return null
    },
    
    async getLogoFromDexHunter(token, ticker, cacheKey) {
      try {
        // For DexHunter, we need the full token ID (policy ID + asset name hex)
        // The 'currency' field actually contains the full asset ID (policy + asset name hex)
        const fullAssetId = token.currency
        if (!fullAssetId) {
          return null
        }
        
        // Try multiple formats for the token ID
        let tokenIdsToTry = []
        
        // Method 1: Use the exact currency value from the API (most reliable)
        tokenIdsToTry.push({
          id: fullAssetId,
          method: `Exact API currency value`
        })
        
        // Method 2: Known working asset IDs for specific tokens (fallback)
        const knownAssetIds = {
          'MIN': '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e74',
          'HOSKY': 'a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59484f534b59',
          'SUNDAE': '9a9693a9a37912a5097918f97918d15240c92ab729a0b7c4aa144d7753554e44414553554e444145',
          'LQ': 'da8c30857834c6ae7203935b89278c532b3995245295456f993e1d244c514c51',
          'VYFI': '804f5544c1962a40546827cab750a88404dc7108c0f588b72964754f56594649',
          'DRIP': 'af2e27f580f7f08e93190a81f72462f153026d06450924726645891b4452495044524950',
          // Add more known working asset IDs here as we discover them
        }
        
        if (knownAssetIds[ticker] && knownAssetIds[ticker] !== fullAssetId) {
          tokenIdsToTry.push({
            id: knownAssetIds[ticker],
            method: `Known ${ticker} asset ID`
          })
        }
        
        
        // Try each token ID format until one works
        for (let i = 0; i < tokenIdsToTry.length; i++) {
          const attempt = tokenIdsToTry[i]
          const dexHunterLogoUrl = `https://storage.googleapis.com/dexhunter-images/tokens/${attempt.id}.webp`
          
          
          try {
            // Test if the image loads by creating an Image object
            const logoUrl = await new Promise((resolve) => {
              const img = new Image()
              
              const timeout = setTimeout(() => {
                resolve(null)
              }, 1500)
              
              img.onload = () => {
                clearTimeout(timeout)
                resolve(dexHunterLogoUrl)
              }
              
              img.onerror = () => {
                clearTimeout(timeout)
                resolve(null)
              }
              
              // Set CORS for external images
              img.crossOrigin = 'anonymous'
              img.src = dexHunterLogoUrl
            })
            
            if (logoUrl) {
              return logoUrl
            }
          } catch (imageError) {
            // Silent error handling
          }
        }
        
        return null
        
      } catch (error) {
        console.warn(`[LOGO] Error in DexHunter logo fetch for ${cacheKey}:`, error.message)
        return null
      }
    },
    
    async getLogoFromCharli3(token, ticker, cacheKey) {
      try {
        // Rate limiting protection
        const now = Date.now()
        const timeSinceLastRequest = now - this.lastCharli3Request
        if (timeSinceLastRequest < this.charli3RequestInterval) {
          const waitTime = this.charli3RequestInterval - timeSinceLastRequest
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
        
        // For Cardano native tokens, use the exact currency value from the API
        // The 'currency' field contains the full asset ID (policy ID + asset name hex)
        const fullAssetId = token.currency
        if (!fullAssetId) {
          return null
        }
        
        // Update last request time before making the request
        this.lastCharli3Request = Date.now()
        
        const logoResponse = await Charli3API.getTokenLogo(fullAssetId)
        
        if (logoResponse && logoResponse !== null && logoResponse !== '') {
          // Backend now returns PNG directly, no conversion needed
          return logoResponse
        }
        
        return null
        
      } catch (error) {
        // If we get a 429 (rate limit), wait longer before next request
        if (error.response?.status === 429) {
          this.charli3RequestInterval = Math.min(this.charli3RequestInterval * 1.5, 10000) // Max 10 seconds
        }
        return null
      }
    },
    
    utf8ToHex(str) {
      // Convert UTF-8 string to hex
      return Array.from(str)
        .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    },
    
    shouldTryDexHunter(ticker) {
      // Only try DexHunter for known tokens to avoid unnecessary 404s
      const knownTokens = [
        'MIN', 'HOSKY', 'LQ', 'SUNDAE', 'VYFI', 'WMT', 'WORLD MOBILE', 
        'MILK', 'DRIP', 'PAVIA', 'ADA', 'DJED', 'SHEN', 'COPI', 'NEWM',
        'SOCIETY', 'CLAY', 'BOOK', 'HUNT', 'IAG', 'MELD', 'AGIX'
      ]
      return knownTokens.includes(ticker?.toUpperCase())
    },
    
    getTokenLogo(token) {
      // Use the logoUrl that was set during processing
      return token.logoUrl
    },
    
    onImageError(token) {
      // If image fails to load, clear the logoUrl to show placeholder
      this.$set(token, 'logoUrl', null)
    },
    
    
    
    clearExpiredLogos() {
      const now = Date.now()
      for (const [key, entry] of this.logoCache.entries()) {
        if (now - entry.timestamp >= this.logoCacheExpiry) {
          this.logoCache.delete(key)
        }
      }
    },
    
    generateMockAnalysis(token) {
      const basePrice = token.last_price || 0.5
      const volatility = Math.random() * 0.1 + 0.02
      
      return {
        trend: {
          direction: Math.random() > 0.5 ? 'bullish' : 'bearish',
          strength: Math.random() > 0.33 ? (Math.random() > 0.5 ? 'strong' : 'moderate') : 'weak',
          confidence: Math.random() * 0.6 + 0.4
        },
        indicators: {
          rsi: {
            current: Math.random() * 100,
            signal: Math.random() > 0.5 ? 'buy' : 'sell'
          },
          macd: {
            signal: Math.random() > 0.5 ? 'bullish' : 'bearish'
          },
          bollinger: {
            signal: Math.random() > 0.5 ? 'oversold' : 'overbought'
          },
          support: [
            basePrice * (1 - volatility),
            basePrice * (1 - volatility * 2)
          ],
          resistance: [
            basePrice * (1 + volatility),
            basePrice * (1 + volatility * 2)
          ]
        }
      }
    },
    
    createTechnicalChart() {
      if (!this.$refs.technicalChart || !this.selectedToken) return

      const basePrice = this.selectedToken.last_price || 0.5
      const volatility = Math.random() * 0.1 + 0.02
      
      const priceData = []
      const volumeData = []
      const now = new Date()
      
      for (let i = 29; i >= 0; i--) {
        const timestamp = now.getTime() - i * 24 * 60 * 60 * 1000
        const price = basePrice * (1 + (Math.random() - 0.5) * volatility)
        const volume = Math.random() * 10000000 + 1000000
        
        priceData.push([timestamp, price])
        volumeData.push([timestamp, volume])
      }

      Highcharts.chart(this.$refs.technicalChart, {
        chart: {
          backgroundColor: '#141414',
          style: { fontFamily: 'Inter, sans-serif' }
        },
        title: {
          text: `${this.selectedToken.name || this.selectedToken.ticker} Technical Analysis`,
          style: { color: '#FFFFFF', fontSize: '16px', fontWeight: 'bold' }
        },
        xAxis: {
          type: 'datetime',
          labels: { style: { color: '#CCCCCC' } },
          gridLineColor: '#404040'
        },
        yAxis: [{
          title: { text: 'Price (USD)', style: { color: '#CCCCCC' } },
          labels: { style: { color: '#CCCCCC' } },
          gridLineColor: '#404040'
        }, {
          title: { text: 'Volume', style: { color: '#CCCCCC' } },
          labels: { style: { color: '#CCCCCC' } },
          opposite: true,
          gridLineColor: '#404040'
        }],
        legend: { 
          enabled: false 
        },
        plotOptions: {
          series: {
            animation: true,
            lineWidth: 2
          }
        },
        series: [{
          name: 'Price',
          data: priceData,
          color: '#00D1FF',
          yAxis: 0
        }, {
          name: 'Volume',
          data: volumeData,
          color: '#47CD89',
          type: 'column',
          yAxis: 1,
          opacity: 0.3
        }],
        credits: { enabled: false },
        tooltip: {
          backgroundColor: '#1e1e1e',
          style: { color: '#FFFFFF' },
          shared: true
        }
      })
    },
    
    toggleSwapPanel() {
      this.swapPanelOpen = !this.swapPanelOpen
    },
    
    handleSwapComplete() {
      this.swapPanelOpen = false
    },
    
    getTrendColor(direction) {
      return direction === 'bullish' ? 'green' : 'red'
    },
    
    getTrendIcon(direction) {
      return direction === 'bullish' ? 'mdi-trending-up' : 'mdi-trending-down'
    },
    
    getStrengthColor(strength) {
      switch(strength) {
        case 'strong': return 'green'
        case 'moderate': return 'orange'
        case 'weak': return 'red'
        default: return 'grey'
      }
    },
    
    getRSISignalColor(signal) {
      return signal === 'buy' ? 'green' : 'red'
    },
    
    getSignalColor(signal) {
      return signal === 'bullish' ? 'green' : 'red'
    },
    
    getBollingerColor(signal) {
      return signal === 'oversold' ? 'green' : 'red'
    },
    
    formatNumber(value, decimals = 2) {
      if (value === null || value === undefined || isNaN(value)) return 'N/A'
      return Number(value).toFixed(decimals)
    },
    
    formatCurrency(value) {
      if (!value) return '0'
      if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
      if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
      if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`
      return value.toFixed(2)
    },
    
    formatPercentage(change) {
      if (!change) return '0.00%'
      return `${Math.abs(change).toFixed(2)}%`
    },
    
    getChangeIcon(change) {
      if (!change || change === 0) return assts.arrowRightSvg
      return change > 0 ? assts.trendUpSvg : assts.trendDownSvg
    },
    
    getChangeColor(change) {
      if (!change || change === 0) return 'neutral-change'
      return change > 0 ? 'positive-change' : 'negative-change'
    },
    
    formatLastRefreshTime() {
      if (!this.lastRefreshTime) return ''
      const now = new Date()
      const diffMs = now - this.lastRefreshTime
      const diffMinutes = Math.floor(diffMs / 60000)
      
      if (diffMinutes < 1) return 'now'
      if (diffMinutes === 1) return '1m ago'
      if (diffMinutes < 60) return `${diffMinutes}m ago`
      
      const diffHours = Math.floor(diffMinutes / 60)
      if (diffHours === 1) return '1h ago'
      if (diffHours < 24) return `${diffHours}h ago`
      
      const diffDays = Math.floor(diffHours / 24)
      return `${diffDays}d ago`
    },
    
    formatFullRefreshTime() {
      if (!this.lastRefreshTime) return ''
      return this.lastRefreshTime.toLocaleTimeString()
    },
    
    formatNextRefreshTime() {
      if (!this.nextRefreshTime) return ''
      const now = new Date()
      const diffMs = this.nextRefreshTime - now
      const diffSeconds = Math.floor(diffMs / 1000)
      const diffMinutes = Math.floor(diffMs / 60000)
      
      if (diffMs <= 0) return 'Now'
      if (diffSeconds < 60) return `In ${diffSeconds} seconds`
      if (diffMinutes === 1) return 'In 1 minute'
      return `In ${diffMinutes} minutes`
    }
  },
  
  async mounted() {
    // Load market data when component mounts
    await this.loadMarketData()
    
    // Refresh market data every 5 minutes (background refresh)
    this.marketDataInterval = setInterval(() => {
      this.loadMarketData(true) // true indicates background refresh
    }, 5 * 60 * 1000)
    
    // Update countdown every 10 seconds for real-time display
    this.countdownInterval = setInterval(() => {
      this.$forceUpdate() // Force re-render to update countdown
    }, 10000)
    
    // Clean expired logos every hour
    this.logoCacheCleanupInterval = setInterval(() => {
      this.clearExpiredLogos()
    }, 60 * 60 * 1000)
  },
  
  beforeDestroy() {
    if (this.marketDataInterval) {
      clearInterval(this.marketDataInterval)
    }
    if (this.logoCacheCleanupInterval) {
      clearInterval(this.logoCacheCleanupInterval)
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval)
    }
  }
}
</script>

<style scoped>
.owned-tokens-market-cards {
  margin: 0;
}

.compact-card {
  height: 160px;
  border-radius: 8px;
  transition: all 0.2s ease;
  margin-top: 8px;
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
  border-left: 4px solid #2196F3;
  animation: volumeColorShift 8s ease-in-out infinite;
}

.gainers-card {
  border-left: 4px solid #3F51B5;
  animation: gainersColorShift 10s ease-in-out infinite;
}

.mcap-card {
  border-left: 4px solid #607D8B;
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

/* Technical Analysis Modal Styles */
.overview-headers {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #404040;
  padding-bottom: 4px;
}

.overview-header {
  flex: 1;
  text-align: center;
  font-size: 0.7rem;
  font-weight: 600;
  color: #888888;
  text-transform: uppercase;
}

.overview-values {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 4px;
}

.overview-value-item {
  flex: 1;
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
}

.overview-value-text {
  font-size: 0.75rem;
  font-weight: 500;
  color: #FFFFFF;
}

.token-overview-card-compact {
  min-height: auto !important;
}

.chart-container {
  background-color: #141414;
  border-radius: 8px;
  padding: 8px;
}

.swap-panel {
  background-color: #141414;
  border-left: 1px solid #404040;
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

/* Market Cards Coming Soon Overlay */
.market-cards-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(20, 20, 20, 0.75);
  backdrop-filter: blur(2px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
}

.market-cards-message {
  text-align: center;
  padding: 1rem;
  border-radius: 8px;
  background: rgba(15, 15, 15, 0.9);
  border: 1px solid rgba(0, 199, 243, 0.3);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.market-cards-content {
  filter: blur(3px);
  opacity: 0.7;
  pointer-events: none;
}
</style>