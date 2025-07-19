<template>
  <v-card outlined class="no-gutters fill-height dashboard-card-radius" :loading="loadingTxs">
    <v-card-title>
      Token Allocation ({{assets?.length + collectibles?.length}})
      <v-spacer></v-spacer>
      <v-menu
        v-if="loggedWallet?.chain === Blockchain.CARDANO && loggedWallet?.network === Network.MAINNET"
        v-model="filtersMenu"
        :close-on-content-click="false"
        offset-y
      >
        <template v-slot:activator="{ on, attrs }">
          <v-badge
            :value="filtersAmount"
            :content="filtersAmount"
            bordered
            color="primary"
            dot
            overlap
          >
            <v-btn
              icon
              plain
              v-bind="attrs"
              v-on="on"
            >
              <v-icon>
                mdi-filter
              </v-icon>
            </v-btn>
          </v-badge>
        </template>
        <v-card outlined style="background-color: #1e1e1e!important;">
          <v-card-text class="pa-0">
            <v-list dense class="transparent">
              <v-list-item>
                <v-list-item-action>
                  <v-switch v-model="hideUnverified" inset dense class="mr-5 mt-0" hide-details v-if="loggedWallet?.chain === Blockchain.CARDANO && loggedWallet?.network === Network.MAINNET"/>
                </v-list-item-action>
                <v-list-item-title>
                  Hide Unverified Tokens
                </v-list-item-title>
              </v-list-item>
              <v-list-item>
                <v-list-item-action>
                  <v-switch v-model="hideScam" inset dense class="mr-5 mt-0" hide-details v-if="loggedWallet?.chain === Blockchain.CARDANO && loggedWallet?.network === Network.MAINNET"/>
                </v-list-item-action>
                <v-list-item-title>
                  Hide Scam Tokens
                </v-list-item-title>
              </v-list-item>
              <v-list-item>
                <v-list-item-action>
                  <v-switch v-model="hideUnrated" inset dense class="mr-5 mt-0" hide-details v-if="loggedWallet?.chain === Blockchain.CARDANO && loggedWallet?.network === Network.MAINNET"/>
                </v-list-item-action>
                <v-list-item-title>
                  Hide Unrated Tokens
                </v-list-item-title>
              </v-list-item>
            </v-list>
            <v-divider></v-divider>
          </v-card-text>
          <v-card-actions class="justify-center">
            <v-btn block small color="error" :disabled="filtersAmount === 0" @click="clearFilters">
              <v-icon small class="pr-1">
                mdi-filter-remove
              </v-icon>
              Clear Filters
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-menu>
      <v-tabs class="ml-1" @change="handleSwitchTab" height="30" style="flex: 0 1 auto;width: unset;border-radius: 10px" background-color="transparent">
        <v-tab>
          Assets
         <span style="color: white">&nbsp;{{ `(${assets ? assets.length : 0})` }}</span>
        </v-tab>
        <v-tab :disabled="collectiblesLength === 0">
          Collectibles
          <span style="color: white">&nbsp;{{`(${collectiblesLength})`}}</span>
        </v-tab>
      </v-tabs>
    </v-card-title>
    <v-card-text class="pa-0">
      <v-tabs-items v-model="currentTab" class="transparent">
        <v-tab-item>
          <v-data-table
            dense
            class="transparent clickable-rows"
            :headers="assetsHeaders"
            :items="assets"
            :sort-by.sync="assetsSort.by"
            :sort-desc.sync="assetsSort.desc"
            :items-per-page="10"
            :header-props="{ 'sort-icon': 'mdi-menu-up' }"
            :custom-sort="customSort"
            @click:row="handleRowClick"
            :item-class="getRowClass"
          >
            <template v-slot:[`item.name`]="{ item }">
              <v-list-item dense>
                <v-list-item-action class="my-0">
                  <v-badge
                    overlap
                    avatar
                    color="transparent"
                    :offset-y="37"
                    v-if="item['verified']"
                  >
                    <template v-slot:badge>
                      <v-avatar color="transparent" tile >
                        <v-icon small color="primary">
                          mdi-check-decagram
                        </v-icon>
                      </v-avatar>
                    </template>
                    <v-avatar size="32">
                      <img v-if="item['img']"
                        :src="item['img']"
                        :alt="`${item['ticker']} Logo`"
                      />
                    </v-avatar>
                  </v-badge>
                  <v-avatar size="32" v-else>
                    <img v-if="item['img']"
                      :src="item['img']"
                      :alt="`${item['ticker']} Logo`"
                    />
                  </v-avatar>
                </v-list-item-action>
                <v-list-item-content>
                  <v-list-item-title>
                    {{item.name}}
                  </v-list-item-title>
                  <v-list-item-subtitle style="display: -webkit-box; -webkit-line-clamp: 1;-webkit-box-orient: vertical;overflow: hidden;text-overflow: ellipsis;white-space: normal;">
                    {{item?.metadata?.description}}
                  </v-list-item-subtitle>
                </v-list-item-content>
              </v-list-item>
            </template>
            <template v-slot:[`item.risk`]="{ item }">
              <v-img width="32" style="margin: auto" v-if="item.risk && item.risk !== 'N/A'" :src="assts.resolveRisk(item.risk)" :alt="item.risk" />
            </template>
            <template v-slot:[`item.quantity`]="{ item }">
              <v-tooltip top :open-delay="500">
                <template v-slot:activator="{ on, attrs }">
                  <span v-bind="attrs" v-on="on">
                    {{ item.quantity | toCurrency(false, 2, '', '', true, 0) }}
                  </span>
                </template>
                {{ item.quantity | toCurrency(false, 6, '', '', false, 0) }}
              </v-tooltip>
            </template>
            <template v-slot:[`item.last_price`]="{ item }">
              <span v-if="!item.last_price">N/A</span>
              <span v-else>
                <v-tooltip top :open-delay="500">
                  <template v-slot:activator="{ on, attrs }">
                    <span v-bind="attrs" v-on="on">
                      {{ item.last_price | toCurrency(false, 4, '$', '', true, 0) }}
                    </span>
                  </template>
                  {{ item.last_price | toCurrency(false, 6, '$', '', false, 0) }}
                </v-tooltip>
              </span>
            </template>
            <template v-slot:[`item.change`]="{ item }">
              <div style="display: flex" v-if="item.change !== undefined ">
                <v-avatar tile size="20" class="mr-1">
                  <v-img
                    :src="
                      item.change === 0
                        ? assts.arrowRightSvg
                        : item.change > 0
                        ? assts.trendUpSvg
                        : assts.trendDownSvg
                    "
                    alt="trend"
                  ></v-img>
                </v-avatar>
                <span :style="item.change === 0 ? {color: '#A3A3A3' } : item.change > 0 ? { color: '#47CD89' } : { color: '#F97066' }">{{
                  Math.abs(item.change).toFixed(2) + "%"
                }}</span>
              </div>
              <span v-else>N/A</span>
            </template>
            <template v-slot:[`item.value`]="{ item }">
              <span v-if="!item.last_price">N/A</span>
              <span v-else>
                 <v-tooltip top :open-delay="500">
                  <template v-slot:activator="{ on, attrs }">
                    <span v-bind="attrs" v-on="on">
                      {{ item.value | toCurrency(false, 2, '$', '', true, 0) }}
                    </span>
                  </template>
                  {{ item.value | toCurrency(false, 6, '$', '', false, 0) }}
                </v-tooltip>
              </span>
            </template>
<!--            <template v-slot:[`item.cost_basis`]="{ }">-->
<!--              <v-chip outlined x-small color="#F97066">Soon</v-chip>-->
<!--            </template>-->
<!--            <template v-slot:[`item.avg_price`]="{  }">-->
<!--              <v-chip outlined x-small color="#F97066">Soon</v-chip>-->
<!--            </template>-->
<!--            <template v-slot:[`item.pnl`]="{ }">-->
<!--              <v-chip outlined x-small color="#F97066">Soon</v-chip>-->
<!--            </template>-->
            <template v-slot:[`item.mcap`]="{ item }">
              <v-tooltip top :open-delay="500" v-if="item.mcap">
                <template v-slot:activator="{ on, attrs }">
                  <span v-bind="attrs" v-on="on">
                    {{ Number(item.mcap) * price.lastPrice | toCurrency(false, 2, '$', '', true, 0) }}
                  </span>
                </template>
                {{ Number(item.mcap) * price.lastPrice | toCurrency(false, 4, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', false, 0) }}
              </v-tooltip>
              <span v-else>N/A</span>
            </template>
            <template v-slot:[`item.total_allocation`]="{ item }">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span v-if="!item.last_price && item.name !== networks.resolveCurrencyName(loggedWallet?.chain, loggedWallet?.network)">N/A</span>
                <v-progress-linear
                  v-else
                  class="progress-bar"
                  height="14"
                  :value="item.total_allocation"
                  color="#00dff3"
                >
                  <template v-slot:default="{ value }">
                    <strong style="font-size: 8px">{{ value.toFixed(1) }}%</strong>
                  </template>
                </v-progress-linear>
              </div>
            </template>
            <template v-slot:[`item.last_7_days`]="{ item }">
              <div v-if="item.name === 'ADA'">
                <sparkline :width="3"></sparkline>
              </div>
              <v-chip v-else outlined x-small color="#F97066">Soon</v-chip>
            </template>
          </v-data-table>
        </v-tab-item>
        <v-tab-item>
          <!-- NFT Gallery View -->
          <div class="nft-gallery-container">
            <!-- Gallery Controls -->
            <div class="gallery-controls mb-4">
              <div class="d-flex align-center justify-space-between">
                <div class="d-flex align-center gap-3">
                  <v-text-field
                    v-model="collectiblesSearch"
                    dense
                    outlined
                    hide-details
                    placeholder="Search collections..."
                    prepend-inner-icon="mdi-magnify"
                    clearable
                    style="max-width: 280px;"
                    class="collection-search"
                  ></v-text-field>
                </div>
                
                <div class="d-flex align-center gap-3">
                  <v-select
                    v-model="collectiblesSortBy"
                    :items="sortOptions"
                    dense
                    outlined
                    hide-details
                    style="max-width: 160px;"
                    class="sort-select"
                  ></v-select>
                  
                  <span class="text-caption mr-2">Size:</span>
                  <v-btn-toggle v-model="cardSizeMode" mandatory dense>
                    <v-btn value="small" x-small>S</v-btn>
                    <v-btn value="medium" x-small>M</v-btn>
                    <v-btn value="large" x-small>L</v-btn>
                  </v-btn-toggle>
                </div>
              </div>
            </div>

            <!-- Gallery Grid -->
            <div v-if="collectiblesViewMode === 'grid'" class="gallery-grid" :class="gridSizeClass">
              <v-card 
                v-for="collection in paginatedCollectibles" 
                :key="collection.id || collection.name"
                class="nft-collection-card"
                @click="handleOnRowClick(collection)"
              >
                <!-- Image Container -->
                <div class="card-image-container" :style="{ height: cardSize + 'px' }">
                  <v-img 
                    :src="collection.img" 
                    :alt="collection.name"
                    :aspect-ratio="1"
                    class="collection-image"
                    :gradient="collection.isScam ? 'to bottom, transparent 60%, rgba(249, 112, 102, 0.8) 100%' : 'to bottom, transparent 60%, rgba(0,0,0,0.8) 100%'"
                  >
                    <!-- Overlay badges -->
                    <div class="card-badges">
                      <v-chip v-if="collection.isScam" small color="error">
                        <v-icon left x-small>mdi-alert-decagram</v-icon>
                        Scam
                      </v-chip>
                      <v-chip v-if="collection.verified" small color="primary">
                        <v-icon left x-small>mdi-check-decagram</v-icon>
                        Verified
                      </v-chip>
                    </div>
                    
                    <!-- Quantity badge -->
                    <div class="quantity-badge">
                      <v-chip small outlined class="quantity-chip">
                        {{ Number(collection.quantity || 1).toLocaleString() }} items
                      </v-chip>
                    </div>
                  </v-img>
                </div>

                <!-- Card Content with Liquid Glass Effect -->
                <div class="card-content-overlay">
                  <h3 class="collection-name-glass">{{ collection.name }}</h3>
                </div>
              </v-card>
            </div>

            <!-- Masonry Layout -->
            <div v-else-if="collectiblesViewMode === 'masonry'" class="gallery-masonry">
              <v-card 
                v-for="collection in paginatedCollectibles" 
                :key="collection.id || collection.name"
                class="nft-collection-card masonry-item"
                @click="handleOnRowClick(collection)"
              >
                <div class="card-image-container">
                  <v-img 
                    :src="collection.img" 
                    :alt="collection.name"
                    class="collection-image"
                    contain
                  >
                    <div class="card-badges">
                      <v-chip v-if="collection.isScam" small color="error">Scam</v-chip>
                    </div>
                    <div class="quantity-badge">
                      <v-chip small outlined class="quantity-chip">{{ Number(collection.quantity || 1).toLocaleString() }} items</v-chip>
                    </div>
                  </v-img>
                </div>
                <div class="card-content-overlay">
                  <h3 class="collection-name-glass">{{ collection.name }}</h3>
                </div>
              </v-card>
            </div>

            <!-- List View (fallback to table-like) -->
            <div v-else class="gallery-list">
              <v-list class="transparent">
                <v-list-item 
                  v-for="collection in paginatedCollectibles"
                  :key="collection.id || collection.name"
                  @click="handleOnRowClick(collection)"
                  class="collection-list-item"
                >
                  <v-list-item-avatar size="48">
                    <v-img :src="collection.img" :alt="collection.name"></v-img>
                  </v-list-item-avatar>
                  <v-list-item-content>
                    <v-list-item-title>
                      {{ collection.name }}
                      <v-chip v-if="collection.isScam" x-small color="error" class="ml-1">Scam</v-chip>
                    </v-list-item-title>
                    <v-list-item-subtitle>
                      {{ Number(collection.quantity).toLocaleString() }} items
                    </v-list-item-subtitle>
                  </v-list-item-content>
                  <v-list-item-action>
                    <v-chip small outlined color="#F97066">Floor: Soon</v-chip>
                  </v-list-item-action>
                </v-list-item>
              </v-list>
            </div>

            <!-- Pagination -->
            <div v-if="totalPages > 1" class="gallery-pagination mt-4">
              <v-pagination
                v-model="collectiblesPage"
                :length="totalPages"
                :total-visible="7"
                color="primary"
                circle
              ></v-pagination>
            </div>

            <!-- Empty State -->
            <div v-if="!collectibles || collectibles.length === 0" class="empty-state">
              <v-icon size="64" color="grey">mdi-image-multiple-outline</v-icon>
              <h3 class="mt-4 grey--text">No Collectibles Found</h3>
              <p class="grey--text">Your NFT collections will appear here when you have some.</p>
            </div>
          </div>
        </v-tab-item>
      </v-tabs-items>
    </v-card-text>
    <TokensDialog @close="closeDialog" :modalData="dialogData"></TokensDialog>
    <!-- Token Analytics Coming Soon Modal -->
    <v-dialog v-model="showTechnicalAnalysis" max-width="500">
      <v-card style="background-color: #141414; border-radius: 12px; overflow: hidden;">
        <v-card-title class="pa-4 pb-2" style="background-color: #141414; color: white; font-family: 'Inter', sans-serif;">
          <v-spacer></v-spacer>
          <v-btn icon @click="showTechnicalAnalysis = false" style="opacity: 0.7;">
            <v-icon color="white">mdi-close</v-icon>
          </v-btn>
        </v-card-title>

        <v-card-text class="pa-6 text-center" style="background-color: #141414; position: relative;">
          <!-- Blurred background effect -->
          <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; 
                      background: linear-gradient(135deg, rgba(0, 223, 243, 0.1) 0%, rgba(0, 223, 243, 0.05) 100%);
                      backdrop-filter: blur(10px);
                      -webkit-backdrop-filter: blur(10px);">
          </div>
          
          <!-- Content -->
          <div style="position: relative; z-index: 1;">
            <div class="mb-4">
              <v-icon size="64" color="primary" class="mb-2">mdi-chart-line</v-icon>
            </div>
            
            <h2 class="text-h5 font-weight-medium mb-3" style="color: white; font-family: 'Inter', sans-serif;">
              Token Analytics
            </h2>
            
            <p class="text-body-1 mb-4" style="color: #ccc; font-family: 'Inter', sans-serif; line-height: 1.6;">
              Advanced technical analysis and real-time market data are coming soon. 
              This feature will include live price charts, technical indicators, 
              and comprehensive token metrics.
            </p>
            
            <v-chip 
              color="primary" 
              outlined 
              label 
              class="mb-4"
              style="font-family: 'Inter', sans-serif;"
            >
              <v-icon left small>mdi-clock-outline</v-icon>
              Coming Soon
            </v-chip>
            
            <div class="text-caption" style="color: #888; font-family: 'Inter', sans-serif;">
              Stay tuned for real-time charts, technical indicators, and market insights
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-card>
</template>
<script>
import { mapActions, mapState } from 'pinia';
import { useStore } from '@/stores';
import Sparkline from '@/modules/navigation/components/Sparkline.vue';
import TokensDialog from '@/modules/assets/dialogs/TokensDialog.vue';
import SwapWidget from '@/modules/swap/components/SwapWidget.vue';
import { createChart } from 'lightweight-charts';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import { walletConfigStore } from '@/stores/modules/walletConfig';
import { Blockchain, Network } from '@/models/types';
import assts from '@/utils/assets';

export default {
  name: "tokenAllocationTable",
  components: { TokensDialog, Sparkline, SwapWidget },
  watch: {
    async hideUnverified(val) {
      await this.setHideUnverifiedTokens(val)
    },
    async hideScam(val) {
      await this.setHideScamTokens(val)
    },
    async hideUnrated(val) {
      await this.setHideUnratedTokens(val)
    },
    assetsSort: {
      async handler(val) {
        await this.setTokenAllocationTableSort(val)
      },
      deep: true
    },
    showTechnicalAnalysis(val) {
      // Modal state changed
    },
    cardSizeMode() {
      // Reset to first page when card size changes
      this.collectiblesPage = 1
    },
    collectiblesSearch() {
      // Reset to first page when search changes
      this.collectiblesPage = 1
    },
    analysisData(val) {
      // Create chart when analysis data is available
      if (val) {
        this.$nextTick(() => {
          this.createTechnicalChart();
        });
      }
    },
  },
  methods: {
    ...mapActions(walletConfigStore, ['setHideScamTokens', 'setHideUnverifiedTokens', 'setHideUnratedTokens', 'setTokenAllocationTableSort']),
    getRowClass(item) {
      // Add gradient class to Cardano token row
      if (item.name === this.networks.resolveCurrencyName(this.loggedWallet?.chain, this.loggedWallet?.network)) {
        return 'cardano-token-row'
      }
      return ''
    },
    handleSwitchTab(tab) {
      this.currentTab = tab;
    },
    closeDialog() {
      this.dialogData = null;
    },
    handleOnRowClick(row) {
      this.dialogData = row;
    },
    // NFT Gallery helper methods
    truncateDescription(description) {
      if (!description) return ''
      const text = Array.isArray(description) ? description.join('') : description
      return text.length > 80 ? text.substring(0, 80) + '...' : text
    },
    formatTotalValue(collection) {
      // Placeholder since we don't have value calculation yet
      return 'TBD'
    },
    handleTokenRowClick(row) {
      this.openTechnicalAnalysis(row);
    },
    handleRowClick(row, event) {
      // Add click effect
      if (event && event.target) {
        const rowElement = event.target.closest('tr');
        if (rowElement) {
          rowElement.classList.add('row-clicked');
          setTimeout(() => {
            if (rowElement) {
              rowElement.classList.remove('row-clicked');
            }
          }, 600);
        }
      } else {
        // Fallback: try to find the row element through other means
        const tableRows = document.querySelectorAll('.clickable-rows tbody tr');
        tableRows.forEach(tr => {
          if (tr.querySelector('td')?.textContent?.includes(row.name)) {
            tr.classList.add('row-clicked');
            setTimeout(() => {
              tr.classList.remove('row-clicked');
            }, 600);
          }
        });
      }
      this.openTechnicalAnalysis(row);
    },
    openTechnicalAnalysis(token) {
      this.selectedToken = token;
      this.analysisLoading = true;
      this.showTechnicalAnalysis = true;
      this.generateRealAnalysis(token);
    },
    async generateRealAnalysis(token, timeRange = null) {
      this.analysisLoading = true;
      
      try {
        // Use mock data for now - will be replaced with new approach
        this.generateMockAnalysis(token, timeRange || this.selectedTimeRange);
        
      } catch (error) {
        console.error('Error fetching real analysis data:', error);
        // Fallback to mock data
        this.generateMockAnalysis(token, timeRange || this.selectedTimeRange);
      }
    },

    getOptimalResolution(timeRange) {
      // Calculate optimal resolution based on time range for efficient data fetching
      const ranges = {
        '1D': { 
          days: 1, 
          resolution: '5min',
          label: '24 hours, 5-minute',
          maxPoints: 288, // 24 hours * 12 points/hour
          fallbacks: ['15min', '30min', '1H']
        },
        '7D': { 
          days: 7, 
          resolution: '30min',
          label: '7 days, 30-minute',
          maxPoints: 336, // 7 days * 48 points/day
          fallbacks: ['1H', '2H', '4H']
        },
        '30D': { 
          days: 30, 
          resolution: '2H',
          label: '30 days, 2-hour',
          maxPoints: 360, // 30 days * 12 points/day
          fallbacks: ['4H', '6H', '1D']
        },
        '90D': { 
          days: 90, 
          resolution: '1D',
          label: '90 days, daily',
          maxPoints: 90, // 90 days * 1 point/day
          fallbacks: ['2D', '1W']
        }
      };
      
      const config = ranges[timeRange] || ranges['1D'];
      
      // Log resolution choice reasoning
      console.log('📊 Resolution selected:', {
        timeRange,
        resolution: config.resolution,
        expectedPoints: config.maxPoints,
        reasoning: `${config.days} days needs ${config.resolution} resolution for ${config.maxPoints} data points`
      });
      
      return config;
    },
    





    generateMockAnalysis(token, timeRange = '1D') {
      this.analysisLoading = false;
      
      // Generate mock data immediately (fallback)
      this.analysisData = {
        asset: token.ticker || token.name,
        priceHistory: this.generateMockPriceData(token.last_price || 1, timeRange),
        indicators: {
          sma: { period: 20, current: (token.last_price || 1) * 0.98, values: [] },
          ema: { period: 12, current: (token.last_price || 1) * 0.99, values: [] },
          rsi: { 
            period: 14, 
            current: 45 + Math.random() * 30, 
            signal: this.getRandomRSISignal(),
            values: [] 
          },
          macd: { 
            macdLine: Math.random() * 0.001 - 0.0005,
            signalLine: Math.random() * 0.001 - 0.0005,
            histogram: Math.random() * 0.001 - 0.0005,
            signal: this.getRandomMACDSignal()
          },
          bollinger: {
            upper: (token.last_price || 1) * 1.02,
            middle: (token.last_price || 1),
            lower: (token.last_price || 1) * 0.98,
            bandwidth: 4 + Math.random() * 2,
            signal: this.getRandomBollingerSignal()
          },
          stochastic: {
            k: 20 + Math.random() * 60,
            d: 20 + Math.random() * 60,
            signal: this.getRandomStochasticSignal()
          },
          support: [
            (token.last_price || 1) * 0.95,
            (token.last_price || 1) * 0.90,
            (token.last_price || 1) * 0.85
          ],
          resistance: [
            (token.last_price || 1) * 1.05,
            (token.last_price || 1) * 1.10,
            (token.last_price || 1) * 1.15
          ]
        },
        trend: {
          direction: this.getRandomTrendDirection(),
          strength: this.getRandomTrendStrength(),
          timeframe: '1d',
          confidence: 0.6 + Math.random() * 0.3
        },
        signals: this.generateMockSignals(),
        lastUpdated: Date.now(),
        dataSource: 'MOCK_DATA',
        dataPoints: 0
      };
      this.analysisLoading = false;
      
      // Create chart automatically
      this.$nextTick(() => {
        this.createTechnicalChart();
      });
    },
    createTechnicalChart() {
      if (!this.$refs.technicalChart || !this.analysisData) return;
      
      try {
        // Destroy existing chart if it exists
        if (this.chart) {
          this.chart.remove();
          this.chart = null;
        }
        
        // Reset volume series reference
        this.volumeSeries = null;
        
        // Disconnect existing resize observer
        if (this.resizeObserver) {
          this.resizeObserver.disconnect();
          this.resizeObserver = null;
        }
      
      // Create TradingView chart
      this.chart = createChart(this.$refs.technicalChart, {
        width: this.$refs.technicalChart.clientWidth,
        height: this.$refs.technicalChart.clientHeight || 400,
        layout: {
          background: { color: '#141414' },
          textColor: '#ffffff'
        },
        grid: {
          vertLines: { color: 'rgba(255, 255, 255, 0.1)' },
          horzLines: { color: 'rgba(255, 255, 255, 0.1)' }
        },
        crosshair: {
          mode: 0 // Normal crosshair mode for v4
        },
        rightPriceScale: {
          borderColor: 'rgba(255, 255, 255, 0.3)',
          scaleMargins: {
            top: 0.02,
            bottom: this.showVolume ? 0.15 : 0.02, // Price chart dominates the space
          },
        },
        leftPriceScale: {
          visible: this.showVolume,
          borderColor: 'rgba(255, 255, 255, 0.1)',
          textColor: 'rgba(255, 255, 255, 0.6)',
          scaleMargins: {
            top: 0.95,
            bottom: 0,
          },
        },
        timeScale: {
          borderColor: 'rgba(255, 255, 255, 0.3)',
          timeVisible: true,
          secondsVisible: false
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true
        }
      });

      console.log('Chart created:', this.chart);
      console.log('Chart methods:', Object.getOwnPropertyNames(this.chart));
      console.log('addCandlestickSeries available:', typeof this.chart.addCandlestickSeries);
      
      // Check if the chart was created properly
      if (!this.chart || typeof this.chart.addCandlestickSeries !== 'function') {
        throw new Error('Chart not properly initialized or addCandlestickSeries method not available');
      }

      // Prepare price data for TradingView format
      const priceData = this.analysisData.priceHistory;
      const candlestickData = priceData.map(p => ({
        time: Math.floor(p.timestamp / 1000), // TradingView expects seconds
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close
      }));

      // Get color scheme based on user preference
      const colors = this.getColorScheme();
      
      // Add main series based on user's chart style preference
      let mainSeries;
      
      if (this.chartStyle === 'line') {
        // Line chart mode
        const lineData = candlestickData.map(d => ({
          time: d.time,
          value: d.close
        }));
        mainSeries = this.chart.addLineSeries({
          color: colors.upColor,
          lineWidth: 2,
          priceFormat: {
            type: 'price',
            precision: 6,
            minMove: 0.000001,
          }
        });
        mainSeries.setData(lineData);
        console.log('Line series added successfully');
      } else {
        // Candlestick chart mode with customization
        try {
          const candlestickOptions = {
            upColor: this.hollowCandles ? 'transparent' : colors.upColor,
            downColor: this.hollowCandles ? 'transparent' : colors.downColor,
            borderDownColor: colors.borderDownColor,
            borderUpColor: colors.borderUpColor,
            wickDownColor: this.showWicks ? colors.wickDownColor : 'transparent',
            wickUpColor: this.showWicks ? colors.wickUpColor : 'transparent',
            priceFormat: {
              type: 'price',
              precision: 6,
              minMove: 0.000001,
            }
          };
          
          mainSeries = this.chart.addCandlestickSeries(candlestickOptions);
          mainSeries.setData(candlestickData);
          console.log('Candlestick series added successfully');
        } catch (candleError) {
          console.warn('Candlestick series failed, falling back to line chart:', candleError);
          // Fallback to line chart
          const lineData = candlestickData.map(d => ({
            time: d.time,
            value: d.close
          }));
          mainSeries = this.chart.addLineSeries({
            color: colors.upColor,
            lineWidth: 2,
            priceFormat: {
              type: 'price',
              precision: 6,
              minMove: 0.000001,
            }
          });
          mainSeries.setData(lineData);
        }
      }
      
      // Store reference for tooltip functionality
      this.candlestickSeries = mainSeries;

      // Add volume series (simplified for v4 compatibility)
      try {
        const volumeData = priceData.map(p => ({
          time: Math.floor(p.timestamp / 1000),
          value: p.volume
        }));

        if (this.showVolume) {
          // Create volume series with very constrained height
          this.volumeSeries = this.chart.addHistogramSeries({
            color: 'rgba(38, 166, 154, 0.4)',
            priceFormat: {
              type: 'volume',
            },
            priceScaleId: 'left',
            scaleMargins: {
              top: 0.95, // Volume takes up only bottom 5% of chart
              bottom: 0,
            },
            visible: true,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          
          // Dramatically scale down volume data
          const maxVolume = Math.max(...volumeData.map(d => d.value));
          const scaleFactor = 0.1; // Make volume 10% of its original scale
          
          const scaledVolumeData = volumeData.map(d => ({
            ...d,
            value: (d.value / maxVolume) * scaleFactor * maxVolume
          }));
          
          this.volumeSeries.setData(scaledVolumeData);
          console.log('Volume series added successfully with scale factor:', scaleFactor);
        }
      } catch (volumeError) {
        console.warn('Volume series failed to add:', volumeError);
      }

      // Calculate and add moving averages
      try {
        const prices = priceData.map(p => p.close);
        const sma20 = this.calculateSMA(prices, 20);
        const ema12 = this.calculateEMA(prices, 12);

        // Add SMA line (only if enabled)
        if (this.showSMA) {
          const smaData = priceData.map((p, i) => ({
            time: Math.floor(p.timestamp / 1000),
            value: sma20[i]
          })).filter(d => d.value !== null);

          if (smaData.length > 0) {
            const smaSeries = this.chart.addLineSeries({
              color: 'rgba(255, 152, 0, 0.7)', // More subtle orange
              lineWidth: 1,
              priceLineVisible: false,
              title: 'SMA(20)'
            });
            smaSeries.setData(smaData);
            console.log('SMA series added successfully');
          }
        }

        // Add EMA line (only if enabled)
        if (this.showEMA) {
          const emaData = priceData.map((p, i) => ({
            time: Math.floor(p.timestamp / 1000),
            value: ema12[i]
          }));

          const emaSeries = this.chart.addLineSeries({
            color: 'rgba(33, 150, 243, 0.7)', // More subtle blue
            lineWidth: 1,
            priceLineVisible: false,
            title: 'EMA(12)'
          });
          emaSeries.setData(emaData);
          console.log('EMA series added successfully');
        }

        // Add Bollinger Bands (only if enabled)
        if (this.showBollinger) {
          const upperBollingerData = priceData.map(p => ({
            time: Math.floor(p.timestamp / 1000),
            value: this.analysisData.indicators.bollinger.upper
          }));

          const lowerBollingerData = priceData.map(p => ({
            time: Math.floor(p.timestamp / 1000),
            value: this.analysisData.indicators.bollinger.lower
          }));

          const upperBollingerSeries = this.chart.addLineSeries({
            color: 'rgba(244, 67, 54, 0.4)', // Very subtle red
            lineWidth: 1,
            lineStyle: 2, // Dashed line
            priceLineVisible: false,
            title: 'BB Upper'
          });
          upperBollingerSeries.setData(upperBollingerData);

          const lowerBollingerSeries = this.chart.addLineSeries({
            color: 'rgba(244, 67, 54, 0.4)', // Very subtle red
            lineWidth: 1,
            lineStyle: 2, // Dashed line
            priceLineVisible: false,
            title: 'BB Lower'
          });
          lowerBollingerSeries.setData(lowerBollingerData);
          console.log('Bollinger Bands added successfully');
        }
      } catch (indicatorError) {
        console.warn('Technical indicators failed to add:', indicatorError);
      }

      // Setup tooltips if enabled
      this.setupTooltips();

      // Handle resize
      const resizeObserver = new ResizeObserver(entries => {
        if (this.chart && entries[0]) {
          const { width, height } = entries[0].contentRect;
          this.chart.applyOptions({ width, height: height || 400 });
        }
      });
      
      resizeObserver.observe(this.$refs.technicalChart);
      this.resizeObserver = resizeObserver;
      
      } catch (error) {
        console.error('Error creating TradingView chart:', error);
        // Fallback: show error message in chart container
        if (this.$refs.technicalChart) {
          this.$refs.technicalChart.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #fff; font-family: Inter, sans-serif;">
              <div style="text-align: center;">
                <div style="font-size: 18px; margin-bottom: 8px;">⚠️ Chart Error</div>
                <div style="font-size: 14px; opacity: 0.7;">Unable to load TradingView chart</div>
              </div>
            </div>
          `;
        }
      }
    },
    calculateSMA(prices, period) {
      const sma = [];
      for (let i = 0; i < prices.length; i++) {
        if (i < period - 1) {
          sma.push(null);
        } else {
          const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
          sma.push(sum / period);
        }
      }
      return sma;
    },
    calculateEMA(prices, period) {
      const ema = [];
      const multiplier = 2 / (period + 1);
      
      for (let i = 0; i < prices.length; i++) {
        if (i === 0) {
          ema.push(prices[i]);
        } else {
          ema.push((prices[i] - ema[i - 1]) * multiplier + ema[i - 1]);
        }
      }
      return ema;
    },
    
    calculateRSI(prices, period = 14) {
      if (prices.length < period + 1) return [];
      
      const rsi = [];
      const gains = [];
      const losses = [];
      
      // Calculate initial gains and losses
      for (let i = 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? Math.abs(change) : 0);
      }
      
      // Calculate RSI
      for (let i = period - 1; i < gains.length; i++) {
        if (i === period - 1) {
          // First RSI calculation
          const avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
          const avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
          const rs = avgGain / (avgLoss || 0.001);
          rsi.push(100 - (100 / (1 + rs)));
        } else {
          // Subsequent RSI calculations using smoothed averages
          const prevAvgGain = (rsi.length > 0) ? gains.slice(i - period + 1, i).reduce((a, b) => a + b, 0) / period : 0;
          const prevAvgLoss = (rsi.length > 0) ? losses.slice(i - period + 1, i).reduce((a, b) => a + b, 0) / period : 0;
          
          const avgGain = (prevAvgGain * (period - 1) + gains[i]) / period;
          const avgLoss = (prevAvgLoss * (period - 1) + losses[i]) / period;
          const rs = avgGain / (avgLoss || 0.001);
          rsi.push(100 - (100 / (1 + rs)));
        }
      }
      
      return rsi;
    },
    
    calculateBollingerBands(prices, period = 20, stdDev = 2) {
      const sma = this.calculateSMA(prices, period);
      const upper = [];
      const middle = [];
      const lower = [];
      
      for (let i = period - 1; i < prices.length; i++) {
        const slice = prices.slice(i - period + 1, i + 1);
        const mean = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
        const standardDeviation = Math.sqrt(variance);
        
        middle.push(mean);
        upper.push(mean + (standardDeviation * stdDev));
        lower.push(mean - (standardDeviation * stdDev));
      }
      
      return { upper, middle, lower };
    },
    
    calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
      const emaFast = this.calculateEMA(prices, fastPeriod);
      const emaSlow = this.calculateEMA(prices, slowPeriod);
      
      const macd = [];
      const startIndex = Math.max(0, slowPeriod - fastPeriod);
      
      for (let i = startIndex; i < emaFast.length; i++) {
        const slowIndex = i - startIndex;
        if (slowIndex < emaSlow.length) {
          macd.push(emaFast[i] - emaSlow[slowIndex]);
        }
      }
      
      const signal = this.calculateEMA(macd, signalPeriod);
      const histogram = [];
      
      for (let i = 0; i < signal.length; i++) {
        histogram.push(macd[i + macd.length - signal.length] - signal[i]);
      }
      
      return { macd, signal, histogram };
    },
    
    calculateSupportLevels(priceHistory) {
      // Find local minima as support levels
      const lows = priceHistory.map(p => p.low);
      const supports = [];
      
      for (let i = 2; i < lows.length - 2; i++) {
        if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && 
            lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
          supports.push(lows[i]);
        }
      }
      
      // Return top 3 support levels
      return supports.sort((a, b) => b - a).slice(0, 3);
    },
    
    calculateResistanceLevels(priceHistory) {
      // Find local maxima as resistance levels
      const highs = priceHistory.map(p => p.high);
      const resistances = [];
      
      for (let i = 2; i < highs.length - 2; i++) {
        if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && 
            highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
          resistances.push(highs[i]);
        }
      }
      
      // Return top 3 resistance levels
      return resistances.sort((a, b) => b - a).slice(0, 3);
    },
    
    calculateSlope(prices) {
      const n = prices.length;
      const x = Array.from({length: n}, (_, i) => i);
      const sumX = x.reduce((a, b) => a + b, 0);
      const sumY = prices.reduce((a, b) => a + b, 0);
      const sumXY = x.reduce((sum, xi, i) => sum + xi * prices[i], 0);
      const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
      
      return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    },
    
    calculateVolatility(prices) {
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
      return Math.sqrt(variance) / mean; // Coefficient of variation
    },
    
    getRSISignal(rsi) {
      if (rsi > 70) return 'overbought';
      if (rsi < 30) return 'oversold';
      return 'neutral';
    },
    
    getMACDSignal(macd) {
      const lastMacd = macd.macd[macd.macd.length - 1] || 0;
      const lastSignal = macd.signal[macd.signal.length - 1] || 0;
      const lastHist = macd.histogram[macd.histogram.length - 1] || 0;
      
      if (lastMacd > lastSignal && lastHist > 0) return 'bullish';
      if (lastMacd < lastSignal && lastHist < 0) return 'bearish';
      return 'neutral';
    },
    
    getBollingerSignal(currentPrice, bollinger) {
      const lastUpper = bollinger.upper[bollinger.upper.length - 1] || 0;
      const lastLower = bollinger.lower[bollinger.lower.length - 1] || 0;
      const bandwidth = (lastUpper - lastLower) / bollinger.middle[bollinger.middle.length - 1];
      
      if (bandwidth < 0.1) return 'squeeze';
      if (bandwidth > 0.2) return 'expansion';
      return 'normal';
    },
    
    calculateBollingerBandwidth(bollinger) {
      const lastUpper = bollinger.upper[bollinger.upper.length - 1] || 0;
      const lastLower = bollinger.lower[bollinger.lower.length - 1] || 0;
      const lastMiddle = bollinger.middle[bollinger.middle.length - 1] || 1;
      
      return ((lastUpper - lastLower) / lastMiddle) * 100;
    },
    getRandomRSISignal() {
      const signals = ['oversold', 'overbought', 'neutral'];
      return signals[Math.floor(Math.random() * signals.length)];
    },
    getRandomMACDSignal() {
      const signals = ['bullish', 'bearish', 'neutral'];
      return signals[Math.floor(Math.random() * signals.length)];
    },
    getRandomBollingerSignal() {
      const signals = ['squeeze', 'expansion', 'normal'];
      return signals[Math.floor(Math.random() * signals.length)];
    },
    getRandomStochasticSignal() {
      const signals = ['oversold', 'overbought', 'neutral'];
      return signals[Math.floor(Math.random() * signals.length)];
    },
    getRandomTrendDirection() {
      const directions = ['bullish', 'bearish', 'sideways'];
      return directions[Math.floor(Math.random() * directions.length)];
    },
    getRandomTrendStrength() {
      const strengths = ['weak', 'moderate', 'strong'];
      return strengths[Math.floor(Math.random() * strengths.length)];
    },
    getRandomSignalType() {
      const types = ['buy', 'sell', 'hold'];
      return types[Math.floor(Math.random() * types.length)];
    },
    generateMockSignals() {
      const signals = [];
      const baseTimestamp = Date.now();
      
      if (Math.random() > 0.5) {
        signals.push({
          type: this.getRandomSignalType(),
          indicator: 'RSI',
          strength: 0.6 + Math.random() * 0.3,
          description: 'RSI indicating potential reversal',
          timestamp: baseTimestamp
        });
      }
      if (Math.random() > 0.6) {
        signals.push({
          type: this.getRandomSignalType(),
          indicator: 'MACD',
          strength: 0.7 + Math.random() * 0.2,
          description: 'MACD showing momentum shift',
          timestamp: baseTimestamp + Math.random() * 1000 // Add random offset
        });
      }
      return signals;
    },
    generateMockPriceData(basePrice, timeRange = '1D') {
      const data = [];
      const now = Date.now();
      let price = basePrice;
      
      // Configure data points and intervals based on time range
      const timeConfigs = {
        '1D': { points: 96, interval: 15 * 60 * 1000 }, // 15 minutes
        '7D': { points: 168, interval: 60 * 60 * 1000 }, // 1 hour
        '30D': { points: 180, interval: 4 * 60 * 60 * 1000 }, // 4 hours
        '90D': { points: 90, interval: 24 * 60 * 60 * 1000 } // 1 day
      };
      
      const config = timeConfigs[timeRange] || timeConfigs['1D'];
      
      for (let i = config.points; i >= 0; i--) {
        const timestamp = now - (i * config.interval);
        const volatility = 0.01 + Math.random() * 0.03; // Reduced volatility for more realistic candlesticks
        const direction = Math.random() > 0.5 ? 1 : -1;
        
        // Calculate open price (close of previous candle or slight variation)
        const open = price;
        
        // Add some price movement during the day
        const priceChange = direction * volatility * Math.random();
        const close = price * (1 + priceChange);
        
        // Calculate realistic high and low
        const high = Math.max(open, close) * (1 + Math.random() * 0.02);
        const low = Math.min(open, close) * (1 - Math.random() * 0.02);
        
        // Ensure price stays positive
        price = Math.max(close, 0.001);
        
        data.push({
          timestamp,
          open: Math.max(open, 0.001),
          high: Math.max(high, 0.001),
          low: Math.max(low, 0.001),
          close: Math.max(close, 0.001),
          volume: Math.random() * 100000 + 10000
        });
      }
      
      return data.sort((a, b) => a.timestamp - b.timestamp); // Ensure chronological order
    },
    
    calculateRealIndicators(prices, priceHistory) {
      // Calculate technical indicators from real price data
      const sma20 = this.calculateSMA(prices, 20);
      const ema12 = this.calculateEMA(prices, 12);
      const rsi = this.calculateRSI(prices, 14);
      const bollinger = this.calculateBollingerBands(prices, 20, 2);
      const macd = this.calculateMACD(prices);
      
      // Calculate support and resistance levels
      const supportLevels = this.calculateSupportLevels(priceHistory);
      const resistanceLevels = this.calculateResistanceLevels(priceHistory);
      
      return {
        sma: { 
          period: 20, 
          current: sma20[sma20.length - 1] || 0, 
          values: sma20 
        },
        ema: { 
          period: 12, 
          current: ema12[ema12.length - 1] || 0, 
          values: ema12 
        },
        rsi: { 
          period: 14, 
          current: rsi[rsi.length - 1] || 50,
          signal: this.getRSISignal(rsi[rsi.length - 1] || 50),
          values: rsi 
        },
        macd: {
          macdLine: macd.macd[macd.macd.length - 1] || 0,
          signalLine: macd.signal[macd.signal.length - 1] || 0,
          histogram: macd.histogram[macd.histogram.length - 1] || 0,
          signal: this.getMACDSignal(macd)
        },
        bollinger: {
          upper: bollinger.upper[bollinger.upper.length - 1] || 0,
          middle: bollinger.middle[bollinger.middle.length - 1] || 0,
          lower: bollinger.lower[bollinger.lower.length - 1] || 0,
          bandwidth: this.calculateBollingerBandwidth(bollinger),
          signal: this.getBollingerSignal(prices[prices.length - 1], bollinger)
        },
        stochastic: {
          k: 0, // TODO: Implement if needed
          d: 0,
          signal: 'neutral'
        },
        support: supportLevels,
        resistance: resistanceLevels
      };
    },
    
    calculateTrend(prices) {
      if (prices.length < 10) {
        return {
          direction: 'sideways',
          strength: 'weak',
          timeframe: '1d',
          confidence: 0.5
        };
      }
      
      // Simple trend calculation using linear regression slope
      const recentPrices = prices.slice(-10); // Last 10 data points
      const slope = this.calculateSlope(recentPrices);
      const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
      const volatility = this.calculateVolatility(recentPrices);
      
      // Determine trend direction
      let direction = 'sideways';
      if (slope > avgPrice * 0.001) direction = 'bullish';
      else if (slope < -avgPrice * 0.001) direction = 'bearish';
      
      // Determine trend strength
      const slopeStrength = Math.abs(slope) / avgPrice;
      let strength = 'weak';
      if (slopeStrength > 0.005) strength = 'strong';
      else if (slopeStrength > 0.002) strength = 'moderate';
      
      // Calculate confidence based on consistency
      const confidence = Math.min(0.9, 0.3 + (1 - volatility) * 0.6);
      
      return {
        direction,
        strength,
        timeframe: '1d',
        confidence
      };
    },
    
    generateRealSignals(indicators) {
      const signals = [];
      const now = Date.now();
      
      // RSI signals
      if (indicators.rsi.current > 70) {
        signals.push({
          type: 'sell',
          indicator: 'RSI',
          strength: 0.7,
          description: 'RSI indicates overbought conditions',
          timestamp: now
        });
      } else if (indicators.rsi.current < 30) {
        signals.push({
          type: 'buy',
          indicator: 'RSI',
          strength: 0.7,
          description: 'RSI indicates oversold conditions',
          timestamp: now
        });
      }
      
      // MACD signals
      if (indicators.macd.macdLine > indicators.macd.signalLine && indicators.macd.histogram > 0) {
        signals.push({
          type: 'buy',
          indicator: 'MACD',
          strength: 0.6,
          description: 'MACD shows bullish momentum',
          timestamp: now + 1000
        });
      } else if (indicators.macd.macdLine < indicators.macd.signalLine && indicators.macd.histogram < 0) {
        signals.push({
          type: 'sell',
          indicator: 'MACD',
          strength: 0.6,
          description: 'MACD shows bearish momentum',
          timestamp: now + 2000
        });
      }
      
      return signals;
    },
    requestAnalysis(timeframe) {
      console.log('Requesting analysis for timeframe:', timeframe);
      if (this.selectedToken) {
        this.generateRealAnalysis(this.selectedToken);
      }
    },
    onSettingsChanged(settings) {
      console.log('Settings changed:', settings);
      if (this.selectedToken) {
        this.generateRealAnalysis(this.selectedToken);
      }
    },
    toggleSwapPanel() {
      this.swapPanelOpen = !this.swapPanelOpen;
      
      // Trigger chart resize after transition
      if (this.chart) {
        setTimeout(() => {
          this.chart.applyOptions({
            width: this.$refs.technicalChart?.clientWidth || 600,
            height: this.$refs.technicalChart?.clientHeight || 400
          });
        }, 350);
      }
    },
    handleSwapComplete() {
      // Close swap panel after successful swap
      this.swapPanelOpen = false;
      
      // Trigger chart resize
      if (this.chart) {
        setTimeout(() => {
          this.chart.applyOptions({
            width: this.$refs.technicalChart?.clientWidth || 600,
            height: this.$refs.technicalChart?.clientHeight || 400
          });
        }, 350);
      }
    },
    getTrendColor(direction) {
      switch (direction) {
        case 'bullish': return 'green';
        case 'bearish': return 'red';
        default: return 'orange';
      }
    },
    getTrendIcon(direction) {
      switch (direction) {
        case 'bullish': return 'mdi-trending-up';
        case 'bearish': return 'mdi-trending-down';
        default: return 'mdi-trending-neutral';
      }
    },
    getStrengthColor(strength) {
      switch (strength) {
        case 'strong': return 'purple';
        case 'moderate': return 'blue';
        default: return 'grey';
      }
    },
    getRSISignalColor(signal) {
      switch (signal) {
        case 'overbought': return 'red';
        case 'oversold': return 'green';
        default: return 'grey';
      }
    },
    getSignalColor(signal) {
      switch (signal) {
        case 'bullish': return 'green';
        case 'bearish': return 'red';
        default: return 'grey';
      }
    },
    getBollingerColor(signal) {
      switch (signal) {
        case 'squeeze': return 'orange';
        case 'expansion': return 'blue';
        default: return 'grey';
      }
    },
    toggleVolumeVisibility() {
      this.showVolume = !this.showVolume;
      
      if (this.chart) {
        if (this.showVolume) {
          // Re-create the chart to add volume
          this.createTechnicalChart();
        } else {
          // Remove volume series and adjust price scale
          if (this.volumeSeries) {
            this.chart.removeSeries(this.volumeSeries);
            this.volumeSeries = null;
          }
          
          // Adjust price scale to take full height
          this.chart.applyOptions({
            rightPriceScale: {
              borderColor: 'rgba(255, 255, 255, 0.3)',
              scaleMargins: {
                top: 0.05,
                bottom: 0.05, // Take more space when volume is hidden
              },
            }
          });
        }
      }
    },
    clearFilters() {
      this.hideUnverified = false
      this.hideScam = false
      this.hideUnrated = false
    },
    customSort(items, sortBy, sortDesc) {
      if (!sortBy.length) return items;

      const cardanoCurrencyName = networks.resolveCurrencyName(this.loggedWallet?.chain, this.loggedWallet?.network);
      
      return items.sort((a, b) => {
        // Always prioritize Cardano token first
        if (a.name === cardanoCurrencyName) return -1;
        if (b.name === cardanoCurrencyName) return 1;
        
        const sortKey = sortBy[0];
        const compareA = a[sortKey];
        const compareB = b[sortKey];
        if (sortKey === 'risk') {
          const riskOrder = {
            'AAA': 1,
            'AA': 2,
            'A': 3,
            'BBB': 4,
            'BB': 5,
            'B': 6,
            'CCC': 7,
            'CC': 8,
            'C': 9,
            'D': 10
          };

          const rankA = riskOrder[compareA] || 11; // Default for unknown ratings
          const rankB = riskOrder[compareB] || 11;

          return sortDesc[0] ? rankB - rankA : rankA - rankB;
        } else {
          // Explicit undefined checks:
          if (compareA === undefined && compareB !== undefined) {
            // A is undefined, B is defined -> A should go to bottom
            return sortDesc[0] ? 1 : -1;
          } else if (compareB === undefined && compareA !== undefined) {
            // B is undefined, A is defined -> B should go to bottom
            return sortDesc[0] ? -1 : 1;
          } else if (compareA === undefined && compareB === undefined) {
            // Both undefined, consider them equal
            return 0;
          }

          let result;
          if (typeof compareA === 'string' && typeof compareB === 'string') {
            result = compareA.localeCompare(compareB);
          } else {
            result = compareA < compareB ? -1 : compareA > compareB ? 1 : 0;
          }
          return sortDesc[0] ? -result : result;
        }
      });
    },
    createSyntheticHistory(currentData, config, endTime) {
      // Creating synthetic history data
      
      // Calculate time intervals based on resolution
      const resolutionMinutes = this.getResolutionInMinutes(config.resolution);
      const intervalSeconds = resolutionMinutes * 60;
      const totalSeconds = config.days * 24 * 60 * 60;
      const numPoints = Math.floor(totalSeconds / intervalSeconds);
      
      console.log('📊 Synthetic data config:', {
        resolution: config.resolution,
        resolutionMinutes,
        intervalSeconds,
        totalSeconds,
        numPoints,
        days: config.days
      });
      
      const timestamps = [];
      const opens = [];
      const highs = [];
      const lows = [];
      const closes = [];
      const volumes = [];
      
      const basePrice = currentData.current_price;
      const dailyChange = currentData.daily_price_change || 0;
      const baseVolume = currentData.daily_volume || 1000;
      
      // Create realistic price movement with some volatility
      for (let i = 0; i < numPoints; i++) {
        const timeOffset = (numPoints - 1 - i) * intervalSeconds;
        const timestamp = endTime - timeOffset;
        
        // Create price variation based on daily change and some randomness
        const progressRatio = i / numPoints; // 0 to 1 progression through time
        const trendEffect = (dailyChange / 100) * progressRatio * basePrice;
        
        // Add some realistic volatility (±2% random movement)
        const volatility = basePrice * 0.02 * (Math.random() - 0.5);
        const price = basePrice + trendEffect + volatility;
        
        // Ensure price stays positive
        const adjustedPrice = Math.max(price, basePrice * 0.5);
        
        // Create OHLC data with some realistic spread
        const spread = adjustedPrice * 0.01; // 1% spread for OHLC
        const open = adjustedPrice + (Math.random() - 0.5) * spread;
        const close = adjustedPrice + (Math.random() - 0.5) * spread;
        const high = Math.max(open, close) + Math.random() * spread;
        const low = Math.min(open, close) - Math.random() * spread;
        
        // Volume with some variation
        const volumeVariation = baseVolume * (0.5 + Math.random());
        
        timestamps.push(timestamp);
        opens.push(Math.max(open, 0.000001));
        highs.push(Math.max(high, 0.000001));
        lows.push(Math.max(low, 0.000001));
        closes.push(Math.max(close, 0.000001));
        volumes.push(Math.max(volumeVariation, 0));
      }
      
      return {
        s: 'ok',
        t: timestamps,
        o: opens,
        h: highs,
        l: lows,
        c: closes,
        v: volumes
      };
    },
    getResolutionInMinutes(resolution) {
      const resolutionMap = {
        '1min': 1,
        '5min': 5,
        '15min': 15,
        '30min': 30,
        '1H': 60,
        '4H': 240,
        '1D': 1440
      };
      return resolutionMap[resolution] || 60; // Default to 60 minutes
    },
    enhanceHistoryData(realData, config, endTime) {
      if (!realData || realData.length === 0) return [];
      
      console.log('🔧 Enhancing history data with config:', config);
      console.log('📊 Real data points:', realData.length);
      
      // Calculate expected timeline
      const resolutionMinutes = this.getResolutionInMinutes(config.resolution);
      const intervalSeconds = resolutionMinutes * 60;
      const totalSeconds = config.days * 24 * 60 * 60;
      const numPoints = Math.floor(totalSeconds / intervalSeconds);
      
      // Sort real data by timestamp to ensure chronological order
      const sortedRealData = [...realData].sort((a, b) => a.timestamp - b.timestamp);
      
      console.log('📈 Creating', numPoints, 'interpolated points from', sortedRealData.length, 'real points');
      
      const enhancedData = [];
      
      // Create timeline of expected timestamps
      for (let i = 0; i < numPoints; i++) {
        const timeOffset = (numPoints - 1 - i) * intervalSeconds;
        const timestamp = endTime - timeOffset;
        const timestampMs = timestamp * 1000;
        
        // Find the closest real data points for interpolation
        const interpolatedPoint = this.interpolateDataPoint(timestampMs, sortedRealData);
        enhancedData.push(interpolatedPoint);
      }
      
      console.log('✨ Enhanced data timeline:', {
        originalPoints: sortedRealData.length,
        enhancedPoints: enhancedData.length,
        timeSpan: `${config.days} days`,
        resolution: config.resolution
      });
      
      return enhancedData;
    },
    interpolateDataPoint(targetTimestamp, realDataPoints) {
      // Find the two closest real data points for interpolation
      let beforePoint = null;
      let afterPoint = null;
      
      for (let i = 0; i < realDataPoints.length; i++) {
        const point = realDataPoints[i];
        
        if (point.timestamp <= targetTimestamp) {
          beforePoint = point;
        }
        
        if (point.timestamp >= targetTimestamp && !afterPoint) {
          afterPoint = point;
          break;
        }
      }
      
      // If we have both before and after points, interpolate
      if (beforePoint && afterPoint && beforePoint.timestamp !== afterPoint.timestamp) {
        const timeDiff = afterPoint.timestamp - beforePoint.timestamp;
        const targetDiff = targetTimestamp - beforePoint.timestamp;
        const ratio = targetDiff / timeDiff;
        
        return {
          timestamp: targetTimestamp,
          open: this.interpolateValue(beforePoint.open, afterPoint.open, ratio),
          high: this.interpolateValue(beforePoint.high, afterPoint.high, ratio, 0.005), // Add slight volatility
          low: this.interpolateValue(beforePoint.low, afterPoint.low, ratio, -0.005),
          close: this.interpolateValue(beforePoint.close, afterPoint.close, ratio),
          volume: this.interpolateValue(beforePoint.volume, afterPoint.volume, ratio, 0.1) // Volume variation
        };
      }
      
      // If we only have one reference point, use it with slight variation
      const referencePoint = beforePoint || afterPoint || realDataPoints[0];
      const basePrice = referencePoint.close;
      const volatility = basePrice * 0.01; // 1% volatility
      
      return {
        timestamp: targetTimestamp,
        open: basePrice + (Math.random() - 0.5) * volatility,
        high: basePrice + Math.random() * volatility,
        low: basePrice - Math.random() * volatility,
        close: basePrice + (Math.random() - 0.5) * volatility,
        volume: referencePoint.volume * (0.8 + Math.random() * 0.4) // 80-120% of original volume
      };
    },
    interpolateValue(value1, value2, ratio, randomFactor = 0) {
      const interpolated = value1 + (value2 - value1) * ratio;
      const randomness = randomFactor * interpolated * (Math.random() - 0.5);
      return Math.max(interpolated + randomness, 0.000001); // Ensure positive values
    },
    async onTimeRangeChange(newRange) {
      if (!this.selectedToken) return;
      
      this.isLoadingTimeRange = newRange;
      console.log('📅 Time range changed to:', newRange, 'for token:', this.selectedToken.name);
      this.saveChartSettings();
      
      try {
        // Regenerate analysis with new time range
        await this.generateRealAnalysis(this.selectedToken, newRange);
        
        // Update the chart
        if (this.analysisData && this.chart) {
          this.createTechnicalChart();
        }
      } catch (error) {
        console.error('❌ Error changing time range:', error);
      } finally {
        this.isLoadingTimeRange = null;
      }
    },
    onChartStyleChange() {
      console.log('📊 Chart style changed to:', this.chartStyle);
      this.saveChartSettings();
      if (this.chart && this.analysisData) {
        this.createTechnicalChart();
      }
    },
    onColorSchemeChange() {
      console.log('🎨 Color scheme changed to:', this.colorScheme);
      this.saveChartSettings();
      if (this.chart && this.analysisData) {
        this.createTechnicalChart();
      }
    },
    onCandleStyleChange() {
      console.log('🕯️ Candle style changed - Hollow:', this.hollowCandles, 'Wicks:', this.showWicks);
      this.saveChartSettings();
      if (this.chart && this.analysisData) {
        this.createTechnicalChart();
      }
    },
    onTooltipToggle() {
      console.log('💬 Tooltips toggled:', this.showTooltips);
      this.saveChartSettings();
      if (this.chart) {
        this.setupTooltips();
      }
    },
    onIndicatorToggle() {
      console.log('📊 Indicators toggled - SMA:', this.showSMA, 'EMA:', this.showEMA, 'Bollinger:', this.showBollinger);
      this.saveChartSettings();
      if (this.chart && this.analysisData) {
        this.createTechnicalChart();
      }
    },
    onVolumeToggle() {
      console.log('📊 Volume toggled:', this.showVolume);
      this.saveChartSettings();
      // Just recreate the chart with the new volume setting
      if (this.chart && this.analysisData) {
        this.createTechnicalChart();
      }
    },
    setupTooltips() {
      if (!this.chart || !this.showTooltips) {
        this.hideTooltip();
        return;
      }
      
      console.log('🔧 Setting up tooltips for chart');
      
      // Subscribe to crosshair move for tooltip functionality
      this.chart.subscribeCrosshairMove((param) => {
        if (!param.point || !param.time || !param.seriesData) {
          this.hideTooltip();
          return;
        }
        
        console.log('📍 Crosshair moved:', param.time, param.seriesData.size);
        
        // Get data for the hovered point from any available series
        let priceData = null;
        let volumeData = null;
        
        // Try to get data from candlestick series first
        if (this.candlestickSeries && param.seriesData.has(this.candlestickSeries)) {
          priceData = param.seriesData.get(this.candlestickSeries);
        }
        
        // If no candlestick data, try any other series (line chart)
        if (!priceData && param.seriesData.size > 0) {
          const firstSeries = param.seriesData.values().next().value;
          priceData = firstSeries;
        }
        
        // Get volume data if available
        if (this.volumeSeries && param.seriesData.has(this.volumeSeries)) {
          volumeData = param.seriesData.get(this.volumeSeries);
          console.log('📊 Volume data found:', volumeData);
        } else {
          console.log('📊 Volume data not found. volumeSeries exists:', !!this.volumeSeries, 'has volumeSeries in data:', this.volumeSeries ? param.seriesData.has(this.volumeSeries) : false);
        }
        
        if (priceData) {
          console.log('📊 Showing tooltip with data:', priceData, 'volume:', volumeData);
          this.showTooltip(param.point, param.time, priceData, volumeData);
        } else {
          this.hideTooltip();
        }
      });
    },
    showTooltip(point, time, priceData, volumeData) {
      // Create or update tooltip element
      let tooltip = document.getElementById('chart-tooltip');
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'chart-tooltip';
        tooltip.style.cssText = `
          position: absolute;
          background: rgba(20, 20, 20, 0.95);
          border: 1px solid #00c7f3;
          border-radius: 6px;
          padding: 10px 14px;
          color: white;
          font-size: 12px;
          font-family: 'Inter', sans-serif;
          z-index: 1000;
          pointer-events: none;
          backdrop-filter: blur(4px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          min-width: 180px;
        `;
        document.body.appendChild(tooltip);
      }
      
      // Format the timestamp for crypto trading
      const date = new Date(time * 1000);
      const timeStr = date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      
      // Format price values for ADA pair
      const formatPrice = (value) => typeof value === 'number' ? value.toFixed(6) + ' ADA' : 'N/A';
      const formatVolume = (volumeData) => {
        if (!volumeData) return 'N/A';
        
        // Handle different volume data structures
        let volume = null;
        if (typeof volumeData === 'number') {
          volume = volumeData;
        } else if (volumeData.value !== undefined) {
          volume = volumeData.value;
        } else if (volumeData.volume !== undefined) {
          volume = volumeData.volume;
        }
        
        console.log('📊 Formatting volume:', volumeData, '→', volume);
        return typeof volume === 'number' ? volume.toLocaleString(undefined, { maximumFractionDigits: 0 }) : 'N/A';
      };
      
      // Handle different data types (candlestick vs line)
      let contentHTML = '';
      
      if (priceData.open !== undefined) {
        // Candlestick data
        const currentPrice = priceData.close;
        contentHTML = `
          <div style="font-weight: 600; margin-bottom: 8px; color: #00c7f3; font-size: 13px;">${timeStr}</div>
          <div style="margin-bottom: 6px;">
            <div style="font-size: 14px; font-weight: 600; color: white;">
              ${formatPrice(currentPrice)}
            </div>
          </div>
          <div style="display: grid; grid-template-columns: auto auto; gap: 4px 12px; align-items: center; font-size: 11px;">
            <span style="color: #888;">High:</span><span style="color: #4caf50;">${formatPrice(priceData.high)}</span>
            <span style="color: #888;">Low:</span><span style="color: #f44336;">${formatPrice(priceData.low)}</span>
            ${volumeData ? `<span style="color: #888;">Volume:</span><span style="color: #ccc;">${formatVolume(volumeData)}</span>` : ''}
          </div>
        `;
      } else if (priceData.value !== undefined) {
        // Line chart data
        contentHTML = `
          <div style="font-weight: 600; margin-bottom: 8px; color: #00c7f3; font-size: 13px;">${timeStr}</div>
          <div style="margin-bottom: 6px;">
            <div style="font-size: 14px; font-weight: 600; color: white;">
              ${formatPrice(priceData.value)}
            </div>
          </div>
          ${volumeData ? `<div style="font-size: 11px; color: #888;">Volume: <span style="color: #ccc;">${formatVolume(volumeData)}</span></div>` : ''}
        `;
      } else {
        // Fallback for unknown data format
        contentHTML = `
          <div style="font-weight: 600; margin-bottom: 8px; color: #00c7f3; font-size: 13px;">${timeStr}</div>
          <div style="color: #888; font-size: 11px;">Price data available</div>
        `;
      }
      
      tooltip.innerHTML = contentHTML;
      
      // Position tooltip
      const chartElement = this.$refs.technicalChart;
      if (!chartElement) return;
      
      const chartRect = chartElement.getBoundingClientRect();
      
      // Smart positioning to avoid edges
      const tooltipX = Math.min(chartRect.left + point.x + 15, window.innerWidth - 200);
      const tooltipY = Math.max(chartRect.top + point.y - 80, 10);
      
      tooltip.style.left = tooltipX + 'px';
      tooltip.style.top = tooltipY + 'px';
      tooltip.style.display = 'block';
    },
    hideTooltip() {
      const tooltip = document.getElementById('chart-tooltip');
      if (tooltip) {
        tooltip.style.display = 'none';
      }
    },
    getColorScheme() {
      const schemes = {
        default: {
          upColor: '#00c7f3',
          downColor: '#f44336',
          borderUpColor: '#00c7f3',
          borderDownColor: '#f44336',
          wickUpColor: '#00c7f3',
          wickDownColor: '#f44336'
        },
        classic: {
          upColor: '#4caf50',
          downColor: '#f44336',
          borderUpColor: '#4caf50',
          borderDownColor: '#f44336',
          wickUpColor: '#4caf50',
          wickDownColor: '#f44336'
        }
      };
      return schemes[this.colorScheme] || schemes.default;
    },
    saveChartSettings() {
      const settings = {
        chartStyle: this.chartStyle,
        colorScheme: this.colorScheme,
        hollowCandles: this.hollowCandles,
        showWicks: this.showWicks,
        showTooltips: this.showTooltips,
        showSMA: this.showSMA,
        showEMA: this.showEMA,
        showBollinger: this.showBollinger,
        showVolume: this.showVolume,
        selectedTimeRange: this.selectedTimeRange
      };
      
      try {
        localStorage.setItem('gero_chart_settings', JSON.stringify(settings));
        console.log('💾 Chart settings saved:', settings);
      } catch (error) {
        console.warn('Failed to save chart settings:', error);
      }
    },
    loadChartSettings() {
      try {
        const savedSettings = localStorage.getItem('gero_chart_settings');
        if (savedSettings) {
          const settings = JSON.parse(savedSettings);
          console.log('📂 Loading chart settings:', settings);
          
          // Apply saved settings
          this.chartStyle = settings.chartStyle || 'candlestick';
          this.colorScheme = settings.colorScheme || 'default';
          this.hollowCandles = settings.hollowCandles !== undefined ? settings.hollowCandles : false;
          this.showWicks = settings.showWicks !== undefined ? settings.showWicks : true;
          this.showTooltips = settings.showTooltips !== undefined ? settings.showTooltips : true;
          this.showSMA = settings.showSMA !== undefined ? settings.showSMA : false;
          this.showEMA = settings.showEMA !== undefined ? settings.showEMA : false;
          this.showBollinger = settings.showBollinger !== undefined ? settings.showBollinger : false;
          this.showVolume = settings.showVolume !== undefined ? settings.showVolume : true;
          this.selectedTimeRange = settings.selectedTimeRange || '1D';
          
          console.log('✅ Chart settings loaded successfully');
          return true;
        }
      } catch (error) {
        console.warn('Failed to load chart settings:', error);
      }
      return false;
    },
  },
  filters,
  computed: {
    isSwapDisabled() {
      if (this.loggedWallet) {
        return !networks.resolveSwapSupport(this.loggedWallet?.chain, this.loggedWallet?.network)
      }
      return true
    },
    totalAllocation() {
      let totalAllocation = 0
      if (this.resolvedAssets) {
        if (this.resolvedAssets.length === 1) {
          const token = this.resolvedAssets[0]
          let res;
          if (token.metadata.ticker === networks.resolveCurrencyTicker(this.loggedWallet?.chain, this.loggedWallet?.network)) {
            res = Number(filters.toCurrency(token.quantity, false, token.decimals, '', '', false, 6)) * this.price?.lastPrice
          } else {
            res = this.resolvedAssets[0].value
          }
          return res;
        }
        this.resolvedAssets.forEach(token => {
          if (token.value) {
            totalAllocation += token.value
          }
        })
      }
      return totalAllocation * this.price?.lastPrice
    },
    filtersAmount() {
      let amt = 0
      if (this.hideScam) {
        amt++
      }
      if (this.hideUnrated) {
        amt++
      }
      if (this.hideUnverified) {
        amt++
      }
      return amt
    },
    Network() {
      return Network
    },
    Blockchain() {
      return Blockchain
    },
    ...mapState(useStore, ['loggedWallet', 'resolvedAssets', 'resolvedCollections', 'price', 'loadingTxs']),
    ...mapState(walletConfigStore, ['getHideScamTokens', 'getHideUnverifiedTokens', 'getHideUnratedTokens', 'getTokenAllocationTableSort']),
    filters() {
      return filters
    },
    networks() {
      return networks
    },
    collectiblesLength() {
      let amount = 0;
      if (this.resolvedCollections) {
        this.resolvedCollections.forEach(collection => {
          if (collection.items) {
            amount += collection.items.length
          }
        })
      }
      return amount
    },
    assets() {
      const resolvedAssets = structuredClone(this.resolvedAssets)
      if (resolvedAssets && this.price) {
        let res = resolvedAssets.map(token => {
          token['quantity'] = Number(filters.toCurrency(token.quantity, false, 6, '', '', false, token.metadata?.decimals).replaceAll(',', ''))
          if (token['name'] === networks.resolveCurrencyName(this.loggedWallet?.chain, this.loggedWallet?.network)) {
            token['last_price'] = Number(filters.toCurrency(this.price.lastPrice, false, 4, '', '', true, 0).replaceAll(",", ""))
            token['change'] = Number(this.price.priceChangePercent)
          } else {
            token['last_price'] = Number(filters.toCurrency(token.last_price * Number(this.price.lastPrice), false, 6, '', '', false, 0).replaceAll(',', ''))
          }

          token['value'] = Number(filters.toCurrency(token.quantity * token.last_price, false, 4, '', '', false, 0).replaceAll(",", ""))
          if (token['value']) {
            token['total_allocation'] = token['value'] / this.totalAllocation * 100
          }
          return token
        })
        if (this.hideScam) {
          res = res.filter(token => !token.isScam)
        }
        if (this.hideUnverified) {
          res = res.filter(token => token.verified)
        }
        if (this.hideUnrated) {
          res = res.filter(token => {
            return token.risk && token.risk !== 'N/A'
          })
        }
        
        // Always put Cardano token first
        const cardanoToken = res.find(token => token.name === networks.resolveCurrencyName(this.loggedWallet?.chain, this.loggedWallet?.network))
        if (cardanoToken) {
          res = res.filter(token => token.name !== networks.resolveCurrencyName(this.loggedWallet?.chain, this.loggedWallet?.network))
          res.unshift(cardanoToken)
        }
        
        return res
      }
      return resolvedAssets
    },
    collectibles() {
      let res =  this.resolvedCollections
      if (res && this.hideScam) {
        res = res.filter(collection => !collection.isScam)
      }
      return res
    },
    // NFT Gallery computed properties
    sortOptions() {
      return [
        { text: 'Name (A-Z)', value: 'name' },
        { text: 'Name (Z-A)', value: 'name_desc' },
        { text: 'Quantity (High-Low)', value: 'quantity_desc' },
        { text: 'Quantity (Low-High)', value: 'quantity' }
      ]
    },
    cardSize() {
      switch (this.cardSizeMode) {
        case 'small': return 140
        case 'medium': return 200
        case 'large': return 260
        default: return 140
      }
    },
    gridSizeClass() {
      return `grid-${this.cardSizeMode}`
    },
    dynamicItemsPerPage() {
      // Simple calculation based on typical screen sizes and card dimensions
      switch (this.cardSizeMode) {
        case 'small': return 30   // 140px cards
        case 'medium': return 20  // 200px cards  
        case 'large': return 12   // 260px cards
        default: return 20
      }
    },
    sortedCollectibles() {
      if (!this.collectibles) return []
      
      let sorted = [...this.collectibles]
      
      // Apply search filter first
      if (this.collectiblesSearch) {
        const searchTerm = this.collectiblesSearch.toLowerCase()
        sorted = sorted.filter(collection => {
          // Search in name
          if (collection.name && collection.name.toLowerCase().includes(searchTerm)) {
            return true
          }
          
          // Search in description (handle different data types)
          if (collection.description) {
            let descriptionText = ''
            if (typeof collection.description === 'string') {
              descriptionText = collection.description
            } else if (Array.isArray(collection.description)) {
              descriptionText = collection.description.join(' ')
            } else {
              descriptionText = String(collection.description)
            }
            
            if (descriptionText.toLowerCase().includes(searchTerm)) {
              return true
            }
          }
          
          return false
        })
      }
      
      // Then apply sorting
      switch (this.collectiblesSortBy) {
        case 'name_desc':
          sorted.sort((a, b) => b.name.localeCompare(a.name))
          break
        case 'quantity':
          sorted.sort((a, b) => (a.quantity || 0) - (b.quantity || 0))
          break
        case 'quantity_desc':
          sorted.sort((a, b) => (b.quantity || 0) - (a.quantity || 0))
          break
        default: // 'name'
          sorted.sort((a, b) => a.name.localeCompare(b.name))
      }
      
      return sorted
    },
    paginatedCollectibles() {
      const start = (this.collectiblesPage - 1) * this.dynamicItemsPerPage
      const end = start + this.dynamicItemsPerPage
      return this.sortedCollectibles.slice(start, end)
    },
    totalPages() {
      return Math.ceil(this.sortedCollectibles.length / this.dynamicItemsPerPage)
    }
  },
  data: () => ({
    filtersMenu: false,
    hideScam: false,
    hideUnverified: false,
    hideUnrated: false,
    swapPanelOpen: false,
    assetsSort: {
      by: 'total_allocation',
      desc: true
    },
    assetsSortBy: 'name',
    assetsSortDesc: false,
    collectiblesSortBy: 'name',
    collectiblesSortDesc: false,
    // NFT Gallery properties
    collectiblesViewMode: 'grid',
    cardSizeMode: 'small',
    collectiblesSearch: '',
    collectiblesPage: 1,
    collectiblesPerPage: 12,
    currentTab: 0,
    chartData: [],
    assetsHeaders: [
      { text: "Asset", align: "start", sortable: true, value: "name" },
      { text: "Risk", align: "center", sortable: true, value: "risk", width: "64" },
      { text: "Quantity", align: "center", sortable: true, value: "quantity", width: "100" },
      { text: "Last Price", align: "center", sortable: true, value: "last_price", width: "100"  },
      { text: "Change", align: "center", sortable: true, value: "change", width: "85" },
      { text: "Value", align: "center", sortable: true, value: "value", width: "72" },
      // { text: "Cost Basis", align: "center", sortable: false, value: "cost_basis", width: "102" },
      // { text: "AVG Price", align: "center", sortable: false, value: "avg_price", width: "98" },
      // { text: "P&L", align: "center", sortable: false, value: "pnl" },
      { text: "Mcap", align: "center", sortable: true, value: "mcap", width: "100" },
      { text: "Allocation", align: "center", sortable: true, value: "total_allocation", width: "150" },
    ],
    collectiblesHeaders: [
      { text: "Asset", align: "start", sortable: true, value: "name" },
      { text: "Quantity", align: "center", sortable: true, value: "quantity", width: "90" },
      { text: "Floor", align: "center", sortable: true, value: "floor" },
      { text: "Cost Basis", align: "center", sortable: true, value: "cost_basis", width: "102" },
      { text: "AVG Price", align: "center", sortable: true, value: "avg_price", width: "98" },
      { text: "P&L", align: "center", sortable: true, value: "pnl" },
      { text: "Allocation", align: "center", sortable: true, value: "allocation", width: "150" },
      { text: "Last 7 Days", align: "center", sortable: true, value: "last_7_days", width: "140" },
    ],
    dialogData: null,
    showTechnicalAnalysis: false,
    selectedToken: null,
    analysisData: null,
    analysisLoading: false,
    activeTab: 0,
    chart: null,
    resizeObserver: null,
    showVolume: true,
    volumeSeries: null,
    selectedTimeRange: '1D',
    isLoadingTimeRange: null,
    chartStyle: 'candlestick',
    colorScheme: 'default',
    hollowCandles: false,
    showWicks: true,
    showTooltips: true,
    showSMA: false,
    showEMA: false, 
    showBollinger: false,
    candlestickSeries: null,
    assts,
  }),
  mounted() {
    this.hideUnverified = walletConfigStore().getHideUnverifiedTokens
    this.hideScam = walletConfigStore().getHideScamTokens
    this.hideUnrated = walletConfigStore().getHideUnratedTokens
    this.assetsSort = walletConfigStore().getTokenAllocationTableSort
    
    // Load chart settings
    this.loadChartSettings()
  },
  beforeDestroy() {
    // Clean up chart and resize observer
    if (this.chart) {
      this.chart.remove();
      this.chart = null;
    }
    this.volumeSeries = null;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }
};
</script>
<style>
.progress-bar {
  border-radius: 10px;
  background-color: #333741;
  display: inline-block;
  margin-right: 10px;
}

.dashboard-card-radius {
  border-radius: 8px !important;
}

.cardano-token-row {
  background: linear-gradient(90deg, rgba(0, 123, 255, 0.08), rgba(0, 150, 255, 0.05)) !important;
  border-left: 3px solid #007bff !important;
  position: relative;
}

.cardano-token-row:hover {
  background: linear-gradient(90deg, rgba(0, 123, 255, 0.12), rgba(0, 150, 255, 0.08)) !important;
}
.badge .v-badge__wrapper {
  margin: 0
}

.ai-analysis-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border: none;
  border-radius: 20px;
  background: linear-gradient(135deg, #00dff3 0%, #00c7f3 100%);
  color: #1a1a1a;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(0, 223, 243, 0.4);
  overflow: hidden;
  min-width: 45px;
  height: 28px;
}

.ai-analysis-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
  transition: left 0.5s ease;
}

.ai-analysis-btn:hover::before {
  left: 100%;
}

.ai-analysis-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0, 223, 243, 0.6);
  background: linear-gradient(135deg, #00c7f3 0%, #00dff3 100%);
}

.ai-analysis-btn:active {
  transform: translateY(0);
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
}

.ai-analysis-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
}

.ai-analysis-btn:disabled:hover {
  transform: none;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
}

.ai-text {
  font-size: 10px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  text-shadow: 0 0 8px rgba(26, 26, 26, 0.3);
  animation: sparkle 2s ease-in-out infinite;
}

@keyframes sparkle {
  0%, 100% { 
    opacity: 1;
    transform: scale(1);
  }
  50% { 
    opacity: 0.8;
    transform: scale(1.1);
  }
}

/* Clickable rows styling */
.clickable-rows ::v-deep tbody tr {
  cursor: pointer !important;
  transition: all 0.3s ease;
  position: relative;
}

.clickable-rows ::v-deep tbody tr td {
  cursor: pointer !important;
}

.clickable-rows ::v-deep tbody tr:hover {
  background-color: rgba(0, 223, 243, 0.1) !important;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 223, 243, 0.2);
}

.clickable-rows ::v-deep tbody tr:hover td {
  background-color: rgba(0, 223, 243, 0.1) !important;
}

/* AI-inspired click effect */
.clickable-rows ::v-deep tbody tr.row-clicked {
  animation: aiClickEffect 0.6s ease-out;
}

@keyframes aiClickEffect {
  0% {
    background: linear-gradient(90deg, transparent, rgba(0, 223, 243, 0.3), transparent) !important;
    box-shadow: 0 0 0 0 rgba(0, 223, 243, 0.7);
  }
  50% {
    background: linear-gradient(90deg, rgba(0, 223, 243, 0.2), rgba(0, 223, 243, 0.5), rgba(0, 223, 243, 0.2)) !important;
    box-shadow: 0 0 0 4px rgba(0, 223, 243, 0.4);
  }
  100% {
    background: linear-gradient(90deg, transparent, rgba(0, 223, 243, 0.1), transparent) !important;
    box-shadow: 0 0 0 0 rgba(0, 223, 243, 0);
  }
}

/* Token overview styling */
.token-overview-card {
  border: 1px solid #404040;
  border-radius: 8px;
}

.token-overview-card-compact {
  border: 1px solid #404040;
  border-radius: 6px;
  min-height: auto;
}

.overview-item {
  min-height: 32px;
}

.overview-item-compact {
  min-height: 24px;
}

.overview-label {
  color: #888888 !important;
  font-size: 11px !important;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 2px;
}

.overview-label-compact {
  color: #888888 !important;
  font-size: 9px !important;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: 1px;
  line-height: 1.2;
}

.overview-value {
  color: white !important;
  font-size: 12px !important;
  line-height: 1.2;
}

.overview-value-compact {
  color: white !important;
  font-size: 11px !important;
  line-height: 1.3;
}

.compact-overview {
  gap: 4px;
}

/* Table-like overview styling */
.overview-headers {
  display: flex;
  align-items: center;
  border-bottom: 1px solid #404040;
  padding-bottom: 4px;
}

.overview-header {
  flex: 1;
  text-align: center;
  color: #888888 !important;
  font-size: 11px !important;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  font-weight: 600;
}

.overview-values {
  display: flex;
  align-items: center;
  padding-top: 6px;
}

.overview-value-item {
  flex: 1;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
}

.overview-value-text {
  color: white !important;
  font-size: 13px !important;
  font-weight: 500;
  line-height: 1.2;
}

/* Force cursor pointer on table rows */
.v-data-table.clickable-rows tbody tr {
  cursor: pointer !important;
}

.v-data-table.clickable-rows tbody tr td {
  cursor: pointer !important;
}

.v-data-table.clickable-rows tbody tr:hover {
  background-color: rgba(0, 223, 243, 0.1) !important;
}

.v-data-table.clickable-rows tbody tr.row-clicked {
  background-color: rgba(0, 223, 243, 0.3) !important;
  animation: clickPulse 0.6s ease-out;
}

@keyframes clickPulse {
  0% {
    background-color: rgba(0, 223, 243, 0.5) !important;
    transform: scale(1);
  }
  50% {
    background-color: rgba(0, 223, 243, 0.3) !important;
    transform: scale(1.01);
  }
  100% {
    background-color: rgba(0, 223, 243, 0.1) !important;
    transform: scale(1);
  }
}

.technical-analysis-content {
  position: relative;
  height: 100%;
}

/* NFT Gallery Styles */
.nft-gallery-container {
  padding: 16px;
  min-height: 400px;
}

.gallery-controls {
  margin-bottom: 20px;
}

.gallery-controls .gap-3 > * {
  margin-right: 12px;
}

.gallery-controls .gap-2 > * {
  margin-right: 8px;
}

.sort-select .v-input__control .v-input__slot {
  background: rgba(255, 255, 255, 0.05) !important;
  border-color: rgba(255, 255, 255, 0.2) !important;
  min-height: 28px !important;
  height: 28px !important;
}

.sort-select .v-input__control {
  min-height: 28px !important;
  height: 28px !important;
}

.sort-select .v-select__slot {
  font-size: 0.75rem !important;
}

.sort-select .v-input__append-inner {
  margin-top: 2px !important;
}

.card-size-slider .v-slider__track-container {
  height: 4px;
}

.gallery-grid {
  display: grid;
  gap: 20px;
  transition: all 0.3s ease;
}

.gallery-grid.grid-small { 
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); 
}

.gallery-grid.grid-medium { 
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); 
}

.gallery-grid.grid-large { 
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); 
}

.gallery-masonry {
  columns: 4;
  column-gap: 20px;
}

@media (max-width: 1200px) { 
  .gallery-masonry { columns: 3; }
  .gallery-grid.grid-small { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
  .gallery-grid.grid-medium { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
  .gallery-grid.grid-large { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
}

@media (max-width: 768px) { 
  .gallery-masonry { columns: 2; }
  .gallery-grid.grid-small { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
  .gallery-grid.grid-medium { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
  .gallery-grid.grid-large { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
}

@media (max-width: 480px) { 
  .gallery-masonry { columns: 1; }
  .gallery-grid.grid-small,
  .gallery-grid.grid-medium,
  .gallery-grid.grid-large { 
    grid-template-columns: 1fr; 
  }
}

.nft-collection-card {
  background: rgba(255, 255, 255, 0.06) !important;
  backdrop-filter: blur(12px) saturate(120%);
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 12px !important;
  overflow: hidden;
  transition: all 0.3s ease;
  cursor: pointer;
  box-shadow: 
    0 4px 16px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.nft-collection-card:hover {
  transform: translateY(-4px);
  box-shadow: 
    0 8px 25px rgba(0, 0, 0, 0.3), 
    0 0 20px rgba(0, 199, 243, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
  border-color: rgba(0, 199, 243, 0.3) !important;
}

.nft-collection-card.masonry-item {
  break-inside: avoid;
  margin-bottom: 20px;
}

.card-image-container {
  position: relative;
  overflow: hidden;
  aspect-ratio: 1 / 1;
  width: 100%;
}

.collection-image {
  transition: transform 0.3s ease;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.nft-collection-card:hover .collection-image {
  transform: scale(1.05);
}

.card-badges {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 8px;
  flex-direction: column;
  align-items: flex-end;
  z-index: 2;
}

.quantity-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
}

.quantity-chip {
  background: rgba(255, 255, 255, 0.08) !important;
  backdrop-filter: blur(12px) saturate(120%) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  color: white !important;
  box-shadow: 
    0 4px 12px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  font-weight: 600 !important;
  font-size: 0.75rem !important;
}

.card-content {
  padding: 16px !important;
}

.collection-name {
  font-weight: 600;
  font-size: 1.1rem;
  line-height: 1.3;
  margin-bottom: 8px;
  color: white !important;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collection-description {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.7) !important;
  line-height: 1.4;
  margin-bottom: 16px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stats-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

.stat-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6) !important;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  font-weight: 600;
  color: #00c7f3 !important;
  font-size: 0.875rem;
}

.gallery-list .collection-list-item {
  background: rgba(255, 255, 255, 0.04) !important;
  margin-bottom: 8px;
  border-radius: 8px !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  transition: all 0.2s ease;
}

.gallery-list .collection-list-item:hover {
  background: rgba(255, 255, 255, 0.08) !important;
  border-color: rgba(0, 199, 243, 0.3) !important;
  transform: translateY(-1px);
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  min-height: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.empty-state h3 {
  font-size: 1.5rem;
  margin-bottom: 8px;
}

.empty-state p {
  font-size: 1rem;
  max-width: 400px;
  line-height: 1.5;
}

.gallery-pagination {
  display: flex;
  justify-content: center;
  padding: 20px 0;
}

.gallery-pagination .v-pagination .v-pagination__item {
  background: rgba(255, 255, 255, 0.06) !important;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  color: white !important;
}

.gallery-pagination .v-pagination .v-pagination__item--active {
  background: rgba(0, 199, 243, 0.2) !important;
  border-color: rgba(0, 199, 243, 0.4) !important;
  color: #00c7f3 !important;
}

.gallery-pagination .v-pagination .v-pagination__item:hover {
  background: rgba(255, 255, 255, 0.1) !important;
  border-color: rgba(0, 199, 243, 0.3) !important;
}

.card-content-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(15px) saturate(140%);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0 0 8px 8px;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.collection-name-glass {
  color: white;
  font-weight: 600;
  font-size: 0.75rem;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  margin: 0;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: 1.2em;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  transform-origin: center;
}

.nft-collection-card:hover .card-content-overlay {
  padding: 16px 12px;
}

.nft-collection-card:hover .collection-name-glass {
  white-space: normal;
  overflow: visible;
  text-overflow: unset;
  line-height: 1.3;
  max-height: 4em;
  transform: scale(1.02);
}

.collection-search .v-input__control .v-input__slot {
  background: rgba(255, 255, 255, 0.05) !important;
  border-color: rgba(255, 255, 255, 0.2) !important;
}

.collection-search .v-input__control .v-input__slot:hover {
  border-color: rgba(0, 199, 243, 0.3) !important;
}

.collection-search .v-input--is-focused .v-input__control .v-input__slot {
  border-color: rgba(0, 199, 243, 0.5) !important;
  box-shadow: 0 0 0 1px rgba(0, 199, 243, 0.2) !important;
}
</style>
