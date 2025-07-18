<template>
  <div class="market-page">
    <!-- Market Stats Header -->
    <v-card outlined class="mb-4 stats-card">
      <v-card-title class="py-2">
        <v-icon left color="primary">mdi-chart-line</v-icon>
        Market Overview
      </v-card-title>
      <v-card-text class="py-2">
        <v-row>
          <v-col cols="3">
            <div class="text-caption grey--text">Available Groups</div>
            <div class="text-h6">{{ availableGroups.length }}</div>
          </v-col>
          <v-col cols="3">
            <div class="text-caption grey--text">Total Tokens</div>
            <div class="text-h6">{{ allTokens.length }}</div>
          </v-col>
          <v-col cols="3">
            <div class="text-caption grey--text">Aggregate Tokens</div>
            <div class="text-h6">{{ aggregateTokens.length }}</div>
          </v-col>
          <v-col cols="3">
            <div class="text-caption grey--text">With Price Data</div>
            <div class="text-h6">{{ tokensWithPrices.length }}</div>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- DEX Groups -->
    <v-card outlined class="mb-4">
      <v-card-title class="py-2">
        <v-icon left color="blue">mdi-swap-horizontal</v-icon>
        Available DEX Groups
      </v-card-title>
      <v-card-text>
        <div v-if="loadingGroups" class="text-center py-4">
          <v-progress-circular indeterminate small></v-progress-circular>
        </div>
        <v-chip-group v-else>
          <v-chip
            v-for="group in availableGroups"
            :key="group.id"
            @click="selectGroup(group.id)"
            :color="selectedGroup === group.id ? 'primary' : 'default'"
            :outlined="selectedGroup !== group.id"
            small
          >
            {{ group.id }}
          </v-chip>
        </v-chip-group>
      </v-card-text>
    </v-card>

    <!-- Market Categories -->
    <v-row>
      <!-- Top by Daily Volume -->
      <v-col cols="12" md="6" lg="4">
        <v-card outlined class="market-category-card">
          <v-card-title class="py-2">
            <v-icon left color="green" size="16">mdi-trending-up</v-icon>
            <span class="text-subtitle-1">Top by Daily Volume</span>
          </v-card-title>
          <v-card-text class="py-1">
            <div v-if="loadingTopPerformers" class="text-center py-4">
              <v-progress-circular indeterminate small></v-progress-circular>
            </div>
            <div v-else>
              <div
                v-for="(token, index) in topByVolume.slice(0, 5)"
                :key="token.ticker || index"
                @click="selectToken(token)"
                class="market-item d-flex align-center justify-space-between py-1 hover-item"
              >
                <div class="d-flex align-center">
                  <span class="caption grey--text mr-2">{{ index + 1 }}.</span>
                  <div>
                    <div class="font-weight-medium">{{ token.symbol }}</div>
                    <div class="caption grey--text">{{ token.description }}</div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="caption">{{ formatCurrency(token.dailyVolume || 0) }}</div>
                  <div class="caption" :class="getChangeColor(token.dailyPriceChange)">
                    {{ formatPercentage(token.dailyPriceChange) }}
                  </div>
                </div>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Top Daily Gainers -->
      <v-col cols="12" md="6" lg="4">
        <v-card outlined class="market-category-card">
          <v-card-title class="py-2">
            <v-icon left color="green" size="16">mdi-chart-line</v-icon>
            <span class="text-subtitle-1">Top Daily Gainers</span>
          </v-card-title>
          <v-card-text class="py-1">
            <div v-if="loadingTopPerformers" class="text-center py-4">
              <v-progress-circular indeterminate small></v-progress-circular>
            </div>
            <div v-else>
              <div
                v-for="(token, index) in topGainers.slice(0, 5)"
                :key="token.ticker || index"
                @click="selectToken(token)"
                class="market-item d-flex align-center justify-space-between py-1 hover-item"
              >
                <div class="d-flex align-center">
                  <span class="caption grey--text mr-2">{{ index + 1 }}.</span>
                  <div>
                    <div class="font-weight-medium">{{ token.symbol }}</div>
                    <div class="caption grey--text">{{ token.description }}</div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="caption">${{ formatNumber(token.currentPrice || 0, 6) }}</div>
                  <div class="caption positive-change">
                    +{{ formatPercentage(token.dailyPriceChange) }}
                  </div>
                </div>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Top by TVL -->
      <v-col cols="12" md="6" lg="4">
        <v-card outlined class="market-category-card">
          <v-card-title class="py-2">
            <v-icon left color="blue" size="16">mdi-finance</v-icon>
            <span class="text-subtitle-1">Top by TVL</span>
          </v-card-title>
          <v-card-text class="py-1">
            <div v-if="loadingTopPerformers" class="text-center py-4">
              <v-progress-circular indeterminate small></v-progress-circular>
            </div>
            <div v-else>
              <div
                v-for="(token, index) in topByTvl.slice(0, 5)"
                :key="token.ticker || index"
                @click="selectToken(token)"
                class="market-item d-flex align-center justify-space-between py-1 hover-item"
              >
                <div class="d-flex align-center">
                  <span class="caption grey--text mr-2">{{ index + 1 }}.</span>
                  <div>
                    <div class="font-weight-medium">{{ token.symbol }}</div>
                    <div class="caption grey--text">{{ token.description }}</div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="caption">${{ formatCurrency(token.currentTvl || 0) }}</div>
                  <div class="caption" :class="getChangeColor(token.dailyPriceChange)">
                    {{ formatPercentage(token.dailyPriceChange) }}
                  </div>
                </div>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Tokens Table -->
    <v-card outlined class="mt-4">
      <v-card-title class="py-2">
        <v-icon left color="primary">mdi-table</v-icon>
        {{ selectedGroup ? `${selectedGroup} Tokens` : 'All Tokens' }}
        <v-spacer></v-spacer>
        <v-text-field
          v-model="searchQuery"
          append-icon="mdi-magnify"
          label="Search tokens..."
          single-line
          hide-details
          dense
          outlined
          class="mr-4"
          style="max-width: 300px"
        ></v-text-field>
        <v-btn
          icon
          @click="refreshData"
          :loading="loading"
        >
          <v-icon>mdi-refresh</v-icon>
        </v-btn>
      </v-card-title>
      <v-card-text class="pa-0">
        <v-data-table
          :headers="tableHeaders"
          :items="filteredTokens"
          :loading="loading"
          :items-per-page="25"
          :sort-by="['currentTvl']"
          :sort-desc="[true]"
          class="elevation-0"
          @click:row="selectToken"
        >
          <template v-slot:item.symbol="{ item }">
            <div>
              <div class="font-weight-medium">{{ item.symbol }}</div>
              <div class="caption grey--text">{{ item.description }}</div>
            </div>
          </template>

          <template v-slot:item.currentPrice="{ item }">
            <span v-if="item.currentPrice">${{ formatNumber(item.currentPrice, 6) }}</span>
            <span v-else class="grey--text">N/A</span>
          </template>

          <template v-slot:item.dailyPriceChange="{ item }">
            <div v-if="item.dailyPriceChange !== undefined" class="d-flex align-center">
              <v-icon
                small
                :color="item.dailyPriceChange >= 0 ? 'green' : 'red'"
                class="mr-1"
              >
                {{ item.dailyPriceChange >= 0 ? 'mdi-trending-up' : 'mdi-trending-down' }}
              </v-icon>
              <span :class="getChangeColor(item.dailyPriceChange)">
                {{ formatPercentage(item.dailyPriceChange) }}
              </span>
            </div>
            <span v-else class="grey--text">N/A</span>
          </template>

          <template v-slot:item.dailyVolume="{ item }">
            <span v-if="item.dailyVolume">${{ formatCurrency(item.dailyVolume) }}</span>
            <span v-else class="grey--text">N/A</span>
          </template>

          <template v-slot:item.currentTvl="{ item }">
            <span v-if="item.currentTvl">${{ formatCurrency(item.currentTvl) }}</span>
            <span v-else class="grey--text">N/A</span>
          </template>

          <template v-slot:item.group="{ item }">
            <v-chip x-small :color="item.group === 'Aggregate' ? 'primary' : 'default'">
              {{ item.group }}
            </v-chip>
          </template>
        </v-data-table>
      </v-card-text>
    </v-card>

    <!-- Token Details Modal -->
    <v-dialog v-model="showTokenDetails" max-width="800" scrollable>
      <v-card v-if="selectedTokenData">
        <v-card-title class="pa-4">
          <div class="d-flex align-center">
            <div class="mr-3">
              <div class="text-h6">{{ selectedTokenData.symbol }}</div>
              <div class="caption grey--text">{{ selectedTokenData.description }}</div>
            </div>
          </div>
          <v-spacer></v-spacer>
          <v-chip small class="ml-2">{{ selectedTokenData.group }}</v-chip>
          <v-btn icon @click="showTokenDetails = false" class="ml-2">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="6">
              <div class="text-caption grey--text">Current Price</div>
              <div class="text-h6">
                <span v-if="selectedTokenData.currentPrice">
                  ${{ formatNumber(selectedTokenData.currentPrice, 6) }}
                </span>
                <span v-else class="grey--text">N/A</span>
              </div>
            </v-col>
            <v-col cols="6">
              <div class="text-caption grey--text">24h Change</div>
              <div class="text-h6" :class="getChangeColor(selectedTokenData.dailyPriceChange)">
                {{ formatPercentage(selectedTokenData.dailyPriceChange) }}
              </div>
            </v-col>
            <v-col cols="6">
              <div class="text-caption grey--text">24h Volume</div>
              <div class="text-h6">
                <span v-if="selectedTokenData.dailyVolume">
                  ${{ formatCurrency(selectedTokenData.dailyVolume) }}
                </span>
                <span v-else class="grey--text">N/A</span>
              </div>
            </v-col>
            <v-col cols="6">
              <div class="text-caption grey--text">Total Value Locked</div>
              <div class="text-h6">
                <span v-if="selectedTokenData.currentTvl">
                  ${{ formatCurrency(selectedTokenData.currentTvl) }}
                </span>
                <span v-else class="grey--text">N/A</span>
              </div>
            </v-col>
          </v-row>

          <v-divider class="my-4"></v-divider>

          <v-row>
            <v-col cols="6">
              <div class="text-caption grey--text">Exchange</div>
              <div class="text-body-2">{{ selectedTokenData.exchange || 'N/A' }}</div>
            </v-col>
            <v-col cols="6">
              <div class="text-caption grey--text">Currency</div>
              <div class="text-body-2">{{ selectedTokenData.currency || 'N/A' }}</div>
            </v-col>
            <v-col cols="6">
              <div class="text-caption grey--text">Base Currency</div>
              <div class="text-body-2">{{ selectedTokenData.baseCurrency || 'N/A' }}</div>
            </v-col>
            <v-col cols="6">
              <div class="text-caption grey--text">Ticker ID</div>
              <div class="text-body-2 text-truncate">{{ selectedTokenData.ticker || 'N/A' }}</div>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import charli3API from '@/api/charli3-api'

export default {
  name: 'Market',
  data() {
    return {
      availableGroups: [],
      allTokens: [],
      aggregateTokens: [],
      tokensWithPrices: [],
      topPerformers: {
        topVolume: [],
        topGainers: [],
        topTvl: []
      },
      selectedGroup: null,
      searchQuery: '',
      showTokenDetails: false,
      selectedTokenData: null,
      loadingGroups: false,
      loadingTokens: false,
      loadingPrices: false,
      loadingTopPerformers: false,
      tableHeaders: [
        { text: 'Token', value: 'symbol', sortable: true },
        { text: 'Price', value: 'currentPrice', sortable: true },
        { text: '24h Change', value: 'dailyPriceChange', sortable: true },
        { text: '24h Volume', value: 'dailyVolume', sortable: true },
        { text: 'TVL', value: 'currentTvl', sortable: true },
        { text: 'Group', value: 'group', sortable: true }
      ]
    }
  },
  computed: {
    loading() {
      return this.loadingGroups || this.loadingTokens || this.loadingPrices || this.loadingTopPerformers
    },
    
    filteredTokens() {
      let tokens = this.selectedGroup 
        ? this.tokensWithPrices.filter(token => token.group === this.selectedGroup)
        : this.tokensWithPrices
      
      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase()
        tokens = tokens.filter(token => 
          token.symbol.toLowerCase().includes(query) ||
          token.description.toLowerCase().includes(query)
        )
      }
      
      return tokens
    },
    
    topByVolume() {
      return this.topPerformers.topVolume
    },
    
    topGainers() {
      return this.topPerformers.topGainers
    },
    
    topByTvl() {
      return this.topPerformers.topTvl
    }
  },
  async mounted() {
    await this.loadData()
  },
  methods: {
    async loadData() {
      await Promise.all([
        this.loadGroups(),
        this.loadAggregateTokens(),
        this.loadTopPerformers()
      ])
    },

    async loadGroups() {
      this.loadingGroups = true
      try {
        const response = await charli3API.getGroups()
        this.availableGroups = response.d.groups
      } catch (error) {
        console.error('Failed to load groups:', error)
      } finally {
        this.loadingGroups = false
      }
    },

    async loadAggregateTokens() {
      this.loadingTokens = true
      try {
        this.aggregateTokens = await charli3API.getAggregateTokens()
        await this.loadTokenPrices()
      } catch (error) {
        console.error('Failed to load aggregate tokens:', error)
      } finally {
        this.loadingTokens = false
      }
    },

    async loadTokenPrices() {
      this.loadingPrices = true
      try {
        this.tokensWithPrices = await charli3API.getTokenCurrentPrices(this.aggregateTokens)
      } catch (error) {
        console.error('Failed to load token prices:', error)
      } finally {
        this.loadingPrices = false
      }
    },

    async loadTopPerformers() {
      this.loadingTopPerformers = true
      try {
        // Use the more efficient method that gets data from /tokens/current
        this.topPerformers = await charli3API.getTopPerformersRealTime(10)
      } catch (error) {
        console.error('Failed to load top performers:', error)
        // Fallback to empty data
        this.topPerformers = {
          topVolume: [],
          topGainers: [],
          topTvl: []
        }
      } finally {
        this.loadingTopPerformers = false
      }
    },

    async selectGroup(groupId) {
      this.selectedGroup = this.selectedGroup === groupId ? null : groupId
      
      if (this.selectedGroup && this.selectedGroup !== 'Aggregate') {
        this.loadingTokens = true
        try {
          const symbolInfo = await charli3API.getSymbolInfo(this.selectedGroup)
          const groupTokens = symbolInfo.symbol.map((symbol, index) => ({
            symbol: symbol,
            description: symbolInfo.description[index],
            currency: symbolInfo.currency[index],
            baseCurrency: symbolInfo['base-currency']?.[index],
            exchange: symbolInfo['exchange-listed'][index],
            ticker: symbolInfo.ticker?.[index],
            group: this.selectedGroup,
            pricescale: symbolInfo.pricescale[index]
          }))
          
          // Try to get prices for this group's tokens
          const groupTokensWithPrices = await charli3API.getTokenCurrentPrices(groupTokens)
          
          // Merge with existing tokens
          this.tokensWithPrices = [
            ...this.tokensWithPrices.filter(token => token.group !== this.selectedGroup),
            ...groupTokensWithPrices
          ]
        } catch (error) {
          console.error(`Failed to load tokens for group ${this.selectedGroup}:`, error)
        } finally {
          this.loadingTokens = false
        }
      }
    },

    async refreshData() {
      await this.loadData()
    },

    selectToken(token) {
      this.selectedTokenData = token
      this.showTokenDetails = true
    },

    formatNumber(value, decimals = 2) {
      if (value === null || value === undefined || isNaN(value)) return '0'
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
      if (change === null || change === undefined || isNaN(change)) return '0.00%'
      const sign = change >= 0 ? '+' : ''
      return `${sign}${Number(change).toFixed(2)}%`
    },

    getChangeColor(change) {
      if (!change || change === 0) return 'neutral-change'
      return change > 0 ? 'positive-change' : 'negative-change'
    }
  }
}
</script>

<style scoped>
.market-page {
  padding: 16px;
}

.stats-card {
  border-radius: 8px;
  transition: all 0.2s ease;
}

.market-category-card {
  height: 280px;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.market-category-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.market-item {
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 1px;
}

.hover-item:hover {
  background-color: rgba(0, 0, 0, 0.04);
}

.theme--dark .hover-item:hover {
  background-color: rgba(255, 255, 255, 0.04);
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

.v-data-table >>> tr {
  cursor: pointer;
}

.v-data-table >>> tr:hover {
  background-color: rgba(0, 0, 0, 0.04);
}

.theme--dark .v-data-table >>> tr:hover {
  background-color: rgba(255, 255, 255, 0.04);
}
</style>