<template>
  <BaseDialog 
    :isOpen="isOpen" 
    @close="$emit('close')" 
    title="Strike Perpetuals" 
    subtitle="Trade perpetual futures with leverage on Cardano"
    :height="950"
    :min-height="850"
    :width="1100"
    :scrollable="false"
  >
    <v-card-text class="pt-1 dialog-content-container">
      
      <!-- Refresh button positioned above the card -->
      <div class="d-flex justify-end mb-2">
        <v-btn icon x-small @click="loadPositions" :loading="loadingPositions" class="refresh-btn-external">
          <v-icon x-small>mdi-reload</v-icon>
        </v-btn>
      </div>
      
      <v-card flat outlined class="mx-auto liquid-glass compact-perpetuals-widget d-flex flex-column px-3 py-3 fixed-height-card">
        <v-card-text class="pa-2 flex-grow-1 d-flex flex-column">
          <!-- Two-column layout -->
          <v-card-text class="pb-0 px-0 pt-0">
            <div class="two-column-layout">
              <!-- Left Column: Chart and Positions -->
              <div class="positions-column">
                <!-- ADA/USD Chart Header -->
                <div class="d-flex align-items-center justify-space-between mb-2">
                  <h4 class="column-title compact">{{ tickerSymbol }}/USD</h4>
                  <span class="chart-timeframe">24H Price Action</span>
                </div>

                <!-- TradingView ADA/USD Histogram Chart -->
                <div class="chart-section mb-3">
                  <TradingViewChart 
                    :symbol="tickerSymbol + '/USD'"
                    :data="chartData"
                    :fetchData="shouldFetchChartData"
                    width="100%"
                    height="160px"
                    theme="dark"
                    @chartReady="onChartReady"
                  />
                </div>

                <!-- My Positions Header -->
                <div class="d-flex align-items-center justify-space-between mb-2">
                  <h4 class="column-title compact">My Positions</h4>
                  <span v-if="positions.length > 0" class="positions-count">
                    {{ positions.length }} position{{ positions.length === 1 ? '' : 's' }}
                  </span>
                </div>
                
                <!-- Loading state -->
                <div v-if="loadingPositions" class="loading-state">
                  <v-progress-circular
                    indeterminate
                    color="#26FAB0"
                    size="40"
                  />
                  <p class="mt-3">Loading positions...</p>
                </div>
                
                <!-- Empty state -->
                <div v-else-if="positions.length === 0" class="empty-state">
                  <v-icon size="48" color="grey">mdi-chart-line</v-icon>
                  <p class="mt-2">No open positions</p>
                  <p class="mt-1 text-caption">Your perpetual positions will appear here</p>
                </div>
                
                <!-- Positions table -->
                <div v-else class="positions-table">
                  <v-data-table
                    dense
                    class="transparent positions-data-table"
                    :headers="positionHeaders"
                    :items="paginatedPositions"
                    :items-per-page="-1"
                    hide-default-footer
                    :header-props="{ 'sort-icon': 'mdi-menu-up' }"
                  >
                    <template v-slot:body.append>
                      <tr v-if="positions.length > positionsPerPage" class="no-hover">
                        <td :colspan="positionHeaders.length" class="text-center pa-0 ma-0">
                          <v-pagination
                            v-model="currentPositionsPage"
                            :length="Math.ceil(positions.length / positionsPerPage)"
                            :total-visible="5"
                            circle
                            class="compact-pagination ma-0"
                          ></v-pagination>
                        </td>
                      </tr>
                    </template>
                    <!-- Asset column with trend icon -->
                    <template v-slot:[`item.asset`]="{ item }">
                      <div class="d-flex align-items-center">
                        <span class="asset-name">{{ item.asset?.name || 'ADA' }}</span>
                        <v-avatar 
                          v-if="item.pnl !== undefined || item.unrealizedPnl !== undefined" 
                          tile 
                          size="16" 
                          class="ml-2"
                        >
                          <v-img
                            :src="getPositionTrendIcon(item)"
                            alt="P&L trend"
                          />
                        </v-avatar>
                      </div>
                    </template>

                    <!-- Position Type column with chip -->
                    <template v-slot:[`item.positionType`]="{ item }">
                      <v-chip
                        v-if="item.position"
                        :color="item.position.toUpperCase() === 'LONG' ? 'success' : 'error'"
                        x-small
                        label
                        class="ultra-compact-chip"
                        :style="item.position.toUpperCase() === 'LONG' ? 'background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0.1) 100%) !important; color: #10b981 !important; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 9px !important; height: 20px !important; padding: 0 6px !important;' : 'background: linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.1) 100%) !important; color: #ef4444 !important; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 9px !important; height: 20px !important; padding: 0 6px !important;'"
                      >
                        {{ item.position.toUpperCase() }}
                      </v-chip>
                    </template>

                    <!-- Current Value column -->
                    <template v-slot:[`item.currentValue`]="{ item }">
                      <div v-if="item.currentPositionValueUsd !== undefined" class="position-value-compact">
                        <div class="value-usd">${{ item.currentPositionValueUsd.toFixed(0) }}</div>
                        <div class="value-ada">{{ item.currentPositionValueAda.toFixed(0) }}A</div>
                      </div>
                      <span v-else>-</span>
                    </template>

                    <!-- Entry / Mark Price column -->
                    <template v-slot:[`item.entryPrice`]="{ item }">
                      <div v-if="item.entryPrice !== undefined" class="price-values-compact">
                        <div class="entry-price">${{ item.entryPrice.toFixed(4) }}</div>
                        <div v-if="item.markPrice !== undefined && item.markPrice !== item.entryPrice" class="mark-price">
                          / ${{ item.markPrice.toFixed(4) }}
                        </div>
                      </div>
                      <span v-else>-</span>
                    </template>

                    <!-- P&L column with trend icon -->
                    <template v-slot:[`item.pnl`]="{ item }">
                      <div v-if="item.pnl !== undefined" class="d-flex align-items-center justify-center">
                        <v-avatar tile size="10" class="mr-1 trend-icon-centered">
                          <v-img
                            :src="item.pnl > 0 ? assets.trendUpSvg : item.pnl < 0 ? assets.trendDownSvg : assets.arrowRightSvg"
                            alt="trend"
                          />
                        </v-avatar>
                        <div class="pnl-values-compact">
                          <div :class="item.pnl >= 0 ? 'profit' : 'loss'">
                            ${{ item.pnl.toFixed(0) }}
                          </div>
                          <div v-if="item.pnlPercentage !== undefined" class="pnl-percentage" :class="item.pnl >= 0 ? 'profit' : 'loss'">
                            {{ item.pnlPercentage.toFixed(1) }}%
                          </div>
                        </div>
                      </div>
                      <span v-else>-</span>
                    </template>

                    <!-- Leverage column -->
                    <template v-slot:[`item.leverage`]="{ item }">
                      <span v-if="item.leverage !== undefined">{{ item.leverage }}x</span>
                      <span v-else>-</span>
                    </template>

                    <!-- Actions column -->
                    <template v-slot:[`item.actions`]="{ item }">
                      <v-btn
                        color="error"
                        text
                        x-small
                        @click="closePosition(item)"
                        :loading="closingPositions[item.id]"
                        class="close-position-btn-compact"
                        :disabled="closingPositions[item.id]"
                      >
                        <v-icon x-small>{{ closingPositions[item.id] ? 'mdi-loading mdi-spin' : 'mdi-close' }}</v-icon>
                      </v-btn>
                    </template>
                  </v-data-table>
                </div>
              </div>
              
              <!-- Right Column: Open Position Form -->
              <div class="open-position-column d-flex flex-column">
                <div class="d-flex align-items-center justify-space-between mb-2">
                  <h4 class="column-title compact">Open New Position</h4>
                  <!-- Real-time ADA Price Ticker -->
                  <div class="ada-ticker-compact-corner" v-if="price?.lastPrice">
                    <div class="d-flex align-items-center">
                      <span class="ada-ticker-label-compact">ADA/USD</span>
                      <span
                        class="price-change-symbol"
                        :style="{
                          color: !price?.priceChangePercent || price.priceChangePercent === 0 ? '#A3A3A3' : price.priceChangePercent > 0 ? '#47CD89' : '#F97066',
                          fontSize: '11px',
                          fontWeight: '700',
                          marginLeft: '4px',
                          marginRight: '1px'
                        }"
                      >
                        {{ !price?.priceChangePercent || price.priceChangePercent === 0 ? '' : price.priceChangePercent > 0 ? '+' : '-' }}
                      </span>
                      <span
                        :style="{
                          color: !price?.priceChangePercent || price.priceChangePercent === 0 ? '#A3A3A3' : price.priceChangePercent > 0 ? '#47CD89' : '#F97066',
                          fontSize: '11px',
                          fontWeight: '600'
                        }"
                      >
                        {{ price?.priceChangePercent ? Math.abs(price.priceChangePercent).toFixed(2) + '%' : '0.00%' }}
                      </span>
                      <span class="ada-current-price-compact ml-2">${{ Number(price.lastPrice).toFixed(4) }}</span>
                    </div>
                  </div>
                </div>
                
                <!-- Scrollable form content -->
                <div class="form-content-scrollable flex-grow-1">
                
                <!-- Step 1: Position Direction -->
                <div class="form-section compact">
                  <div class="form-label compact">Position Direction</div>
                  <v-btn-toggle mandatory active-class="geroButton" v-model="positionData.position" dense class="mb-2 compact-toggle full-width-toggle">
                    <v-btn value="LONG" small rounded class="position-btn long-btn compact flex-btn">
                      <v-icon x-small class="mr-1">mdi-trending-up</v-icon>
                      LONG
                    </v-btn>
                    <v-btn value="SHORT" small rounded class="position-btn short-btn compact flex-btn">
                      <v-icon x-small class="mr-1">mdi-trending-down</v-icon>
                      SHORT
                    </v-btn>
                  </v-btn-toggle>
                </div>

                <!-- Step 2: Order Type -->
                <div class="form-section compact">
                  <div class="form-label compact">Order Type</div>
                  <v-btn-toggle mandatory active-class="geroButton" v-model="positionData.orderType" dense class="mb-2 compact-toggle full-width-toggle">
                    <v-btn value="MARKET" small rounded class="order-type-btn compact flex-btn">
                      <v-icon x-small class="mr-1">mdi-flash</v-icon>
                      MARKET
                    </v-btn>
                    <v-btn value="LIMIT" small rounded class="order-type-btn compact flex-btn">
                      <v-icon x-small class="mr-1">mdi-target</v-icon>
                      LIMIT
                    </v-btn>
                  </v-btn-toggle>
                </div>

                <!-- Limit Price (only for LIMIT orders) -->
                <div v-if="positionData.orderType === 'LIMIT'" class="form-section compact">
                  <div class="form-label compact">Limit Price</div>
                  <v-card class="input-card compact" outlined>
                    <v-card-text class="pa-1">
                      <div class="input-container">
                        <v-text-field
                          v-model.number="positionData.limitPrice"
                          placeholder="0.0000"
                          dense
                          flat
                          solo
                          hide-details
                          type="number"
                          step="0.0001"
                          class="price-input compact"
                        />
                        <span class="input-suffix">USD</span>
                      </div>
                    </v-card-text>
                  </v-card>
                </div>

                <!-- Step 3: Collateral Amount -->
                <div class="form-section compact">
                  <div class="d-flex align-center justify-space-between">
                    <div class="form-label compact">Collateral Amount</div>
                    <span class="available-balance compact">Available: {{ availableAdaBalance }} ADA</span>
                  </div>
                  <v-card class="input-card compact" outlined>
                    <v-card-text class="pa-1">
                      <div class="input-container">
                        <v-text-field
                          v-model.number="positionData.collateralAmount"
                          placeholder="0.00"
                          dense
                          flat
                          solo
                          hide-details
                          type="number"
                          step="0.01"
                          class="amount-input compact"
                        />
                        <span class="input-suffix">ADA</span>
                      </div>
                    </v-card-text>
                  </v-card>
                </div>

                <!-- Step 4: Leverage -->
                <div class="form-section compact">
                  <div class="d-flex align-center justify-space-between mb-1">
                    <div class="form-label compact">Leverage</div>
                    <div class="leverage-display compact">
                      {{ positionData.leverage }}x
                    </div>
                  </div>
                  <v-slider
                    v-model="positionData.leverage"
                    :min="1"
                    :max="15"
                    :step="0.1"
                    thumb-label
                    color="#26FAB0"
                    track-color="rgba(38, 250, 176, 0.2)"
                    class="leverage-slider compact"
                    @input="onLeverageSliderChange"
                  />
                </div>

                <!-- Step 5: Take Profit / Stop Loss (Optional) -->
                <div class="form-section compact">
                  <v-expansion-panels flat class="tp-sl-panel compact">
                    <v-expansion-panel>
                      <v-expansion-panel-header class="tp-sl-header compact">
                        <div class="d-flex align-items-center">
                          <v-icon x-small class="mr-1" color="#26FAB0">mdi-shield-check</v-icon>
                          <span class="tp-sl-title compact">Take Profit / Stop Loss</span>
                          <span class="tp-sl-subtitle compact">(Optional)</span>
                        </div>
                      </v-expansion-panel-header>
                      <v-expansion-panel-content class="tp-sl-content compact">
                        <!-- Take Profit -->
                        <div class="mb-2">
                          <div class="form-label small compact">Take Profit Price</div>
                          <v-card class="input-card small compact" outlined>
                            <v-card-text class="pa-1">
                              <div class="input-container">
                                <v-text-field
                                  v-model.number="positionData.takeProfitPrice"
                                  placeholder="0.0000"
                                  dense
                                  flat
                                  solo
                                  hide-details
                                  type="number"
                                  step="0.0001"
                                  class="price-input small compact"
                                />
                                <span class="input-suffix">USD</span>
                              </div>
                            </v-card-text>
                          </v-card>
                        </div>

                        <!-- Stop Loss -->
                        <div class="mb-2">
                          <div class="form-label small compact">Stop Loss Price</div>
                          <v-card class="input-card small compact" outlined>
                            <v-card-text class="pa-1">
                              <div class="input-container">
                                <v-text-field
                                  v-model.number="positionData.stopLossPrice"
                                  placeholder="0.0000"
                                  dense
                                  flat
                                  solo
                                  hide-details
                                  type="number"
                                  step="0.0001"
                                  class="price-input small compact"
                                />
                                <span class="input-suffix">USD</span>
                              </div>
                            </v-card-text>
                          </v-card>
                        </div>
                      </v-expansion-panel-content>
                    </v-expansion-panel>
                  </v-expansion-panels>
                </div>

                
                </div>
                <!-- End scrollable form content -->
                
                <!-- Bottom section - always at bottom -->
                <div class="bottom-section">

                <!-- Position Summary -->
                <div class="form-section compact">
                  <v-card flat class="position-summary-card compact">
                    <v-card-text class="pa-2">
                      <div class="d-flex align-items-center justify-space-between mb-2">
                        <div class="summary-title compact">Position Summary</div>
                        <!-- View Fees Tooltip -->
                        <v-tooltip top content-class="custom-tooltip">
                          <template v-slot:activator="{ on, attrs }">
                            <v-btn
                              text
                              x-small
                              class="fees-btn compact"
                              v-bind="attrs"
                              v-on="on"
                            >
                              <v-icon x-small class="mr-1">mdi-information</v-icon>
                              View Fees
                            </v-btn>
                          </template>
                          <div class="fees-tooltip-content">
                            <div class="fees-title">Trading Fees</div>
                            <div class="fee-item">
                              <span>Opening Fee:</span>
                              <span>0.1%</span>
                            </div>
                            <div class="fee-item">
                              <span>Hourly Borrow Fee:</span>
                              <span>~0.001%</span>
                            </div>
                            <div class="fee-item">
                              <span>Network Fee:</span>
                              <span>~2-5 ADA</span>
                            </div>
                          </div>
                        </v-tooltip>
                      </div>
                      <div class="summary-row compact">
                        <span>Position Size:</span>
                        <span class="summary-value">{{ positionSize }} ADA</span>
                      </div>
                      <div class="summary-row compact">
                        <span>Notional Value:</span>
                        <span class="summary-value">${{ notionalValue }}</span>
                      </div>
                      <div class="summary-row compact">
                        <span>Est. Liquidation Price:</span>
                        <span class="summary-value">{{ liquidationPrice }}</span>
                      </div>
                    </v-card-text>
                  </v-card>
                </div>

                <!-- Open Position Button -->
                <v-btn
                  color="primary"
                  block
                  @click="openPosition"
                  :loading="loading"
                  :disabled="!canOpenPosition"
                  class="open-position-btn enhanced compact"
                >
                  <v-icon class="mr-1" small>{{ positionData.orderType === 'MARKET' ? 'mdi-flash' : 'mdi-target' }}</v-icon>
                  Open {{ positionData.position }} {{ positionData.orderType }}
                </v-btn>
                
                </div>
                <!-- End bottom section -->
              </div>
            </div>
          </v-card-text>
        </v-card-text>
      </v-card>
    </v-card-text>
    
    <!-- Powered by Strike Finance Footer - positioned at dialog bottom -->
    <div class="d-flex align-center justify-center py-2 dialog-footer">
      <span class="powered-by-text mr-2">Powered by</span>
      <img 
        src="https://app.strikefinance.org/logo.svg" 
        alt="Strike Finance Logo"
        class="strike-logo"
        @error="onLogoError"
      />
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, toRefs, nextTick } from 'vue';
import BaseDialog from "@/shared/dialogs/BaseDialog.vue";
import TradingViewChart from '@/shared/components/TradingViewChart.vue';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { dexHunterStore } from '@/stores/dexHunterStore';
import { WalletManager } from '@/services/walletManager.service';
import axios from 'axios';
import assets from '@/utils/assets';
import type { CreatePerpetualRequest, ClosePerpetualRequest, PerpetualPosition } from '@/api/strike/types';
import type { Time, IChartApi } from 'lightweight-charts';
import tapToolsApi from '@/api/tap-tools-api';
import dexHunterApi from '@/api/dexhunter-api';

interface CandlestickDataPoint {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits(['close']);

const { loggedWallet } = toRefs(walletStore);
const { price } = toRefs(networkStore);
const { dexHunterTokens } = toRefs(dexHunterStore);
const walletManager = WalletManager.getInstance();


// Process position data - ONLY return what exists in the API + calculated values from other APIs
const processPositionData = (position: any) => {
  
  const result: any = {};
  
  // Use wallet store ADA price as current price (this is what Strike Finance shows)
  if (price.value?.lastPrice) {
    result.currentPrice = Number(price.value.lastPrice);
  } else if (position.currentPrice !== undefined) {
    result.currentPrice = Number(position.currentPrice);
  }
  
  // Use mark price from API if available, otherwise fallback to current price
  if (position.markPrice !== undefined) {
    result.markPrice = Number(position.markPrice);
  } else if (result.currentPrice) {
    result.markPrice = result.currentPrice;
  }
  
  // Calculate P&L using Strike Finance formula: (current_price - entry_price) * position_size * leverage
  if (position.entryPrice !== undefined && position.positionSize !== undefined && result.currentPrice) {
    const entryPrice = Number(position.entryPrice);
    const positionSize = Number(position.positionSize);
    const leverage = Number(position.leverage || 1);
    const currentPrice = result.currentPrice;
    const positionType = position.position?.toLowerCase();
    
    let priceDiff;
    if (positionType === 'long') {
      priceDiff = currentPrice - entryPrice;
    } else { // short
      priceDiff = entryPrice - currentPrice;
    }
    
    const unrealizedPnl = priceDiff * positionSize;
    const pnlPercentage = entryPrice > 0 ? (priceDiff / entryPrice) * 100 : 0;
    
    result.pnl = Number(unrealizedPnl.toFixed(2));
    result.unrealizedPnl = result.pnl;
    result.pnlPercentage = Number(pnlPercentage.toFixed(2));
    
  } else if (position.pnl !== undefined) {
    // Fallback to API provided P&L
    result.pnl = Number(position.pnl);
    if (position.unrealizedPnl !== undefined) {
      result.unrealizedPnl = Number(position.unrealizedPnl);
    }
    if (position.pnlPercentage !== undefined) {
      result.pnlPercentage = Number(position.pnlPercentage);
    }
  }
  
  // Handle fees
  if (position.totalFees !== undefined) {
    result.totalFees = Number(position.totalFees);
  } else if (position.openingFee !== undefined || position.accumulatedFees !== undefined || position.accumulatedBorrowFee !== undefined) {
    const openingFee = Number(position.openingFee || 0);
    const accumulatedFees = Number(position.accumulatedFees || position.accumulatedBorrowFee || 0);
    result.totalFees = Number((openingFee + accumulatedFees).toFixed(2));
  }
  
  // Calculate Current Position Value (always use wallet ADA price for accurate real-time values)
  if (position.positionSize !== undefined && result.currentPrice) {
    const positionSizeAda = Number(position.positionSize);
    result.currentPositionValueUsd = Number((positionSizeAda * result.currentPrice).toFixed(2));
    result.currentPositionValueAda = positionSizeAda;
    
  }
  
  return result;
};

// Create a direct HTTP client for Strike API
const createStrikeHttpClient = () => {
  const baseURL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
  
  return {
    async getPositions(address: string): Promise<any[]> {
      try {
        
        const response = await axios.get(`${baseURL}/api/strike/perpetuals/getPositions`, {
          params: { address },
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        });
        
        return response.data || [];
      } catch (error) {
        console.error('Strike API error:', error?.message || error);
        throw error;
      }
    },
    
    async openPosition(request: CreatePerpetualRequest): Promise<string> {
      try {
        const response = await axios.post(`${baseURL}/api/strike/perpetuals/openPosition`, request, {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        });
        
        return response.data?.transactionId || response.data;
      } catch (error) {
        console.error('Strike openPosition error:', error?.message || error);
        throw error;
      }
    },
    
    async closePosition(request: ClosePerpetualRequest): Promise<string> {
      try {
        const response = await axios.post(`${baseURL}/api/strike/perpetuals/closePosition`, request, {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        });
        
        return response.data?.transactionId || response.data;
      } catch (error) {
        console.error('Strike closePosition error:', error?.message || error);
        throw error;
      }
    }
  };
};

// Note: Using direct HTTP client instead of wallet API for Strike Finance calls

const loading = ref(false);
const rawPositions = ref<PerpetualPosition[]>([]);

// TradingView chart data and handlers
const chartData = ref<CandlestickDataPoint[]>([]);
const chart = ref<IChartApi | null>(null);
const shouldFetchChartData = ref(false);

// Generate or fetch chart data based on the ticker
const generateChartData = async (): Promise<CandlestickDataPoint[]> => {
  const ticker = tickerSymbol.value;
  
  // For all tickers, let the TradingViewChart component handle fetching
  // ADA will use the backend /crypto/history/ADAUSDT endpoint
  // Other tokens will use TapTools/DexHunter APIs
  console.debug(`${ticker} ticker detected, chart will fetch appropriate data`);
  shouldFetchChartData.value = true;
  return []; // Return empty, chart will fetch its own data
};

// Fetch token price history from DexHunter API
const fetchTokenHistoryFromDexHunter = async (ticker: string): Promise<CandlestickDataPoint[]> => {
  try {
    console.debug(`Fetching ${ticker} price history from DexHunter/TapTools`);
    
    // Since TradingViewChart component now handles the fetching,
    // we can just return empty array and let the component handle it
    return [];
  } catch (error) {
    console.warn(`Failed to fetch ${ticker} data:`, error);
    return generateSimpleOHLCData();
  }
};

// Fetch real ADA OHLC data (now handled by TradingViewChart component)
const fetchRealAdaOHLC = async (): Promise<CandlestickData[]> => {
  try {
    // First try to get ADA price change data from TapTools
    const priceChangeResponse = await tapToolsApi.dailyPriceChange('lovelace');
    
    if (priceChangeResponse?.status === 200 && priceChangeResponse.data) {
      // Convert price change data to OHLC estimation
      console.debug('Got ADA price change data from TapTools:', priceChangeResponse.data);
      return convertPriceDataToOHLC(priceChangeResponse.data);
    }
    
    // Fallback: generate OHLC from current price
    const currentPrice = networkStore.price?.lastPrice || 0.5; // Current ADA price
    if (currentPrice > 0) {
      return generateOHLCFromPrice(currentPrice);
    }
    
    return [];
  } catch (error) {
    console.error('Error fetching real ADA OHLC data:', error);
    return [];
  }
};

// Convert price data to volume estimates (higher price volatility = higher volume)
const convertPriceDataToVolumeEstimate = (priceData: any): ChartData[] => {
  const data: ChartData[] = [];
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  // Base volume for ADA (typical daily volume is ~200M - 1B USD)
  const baseVolumeUSD = 400000000; // 400M USD base
  const currentPrice = networkStore.price?.lastPrice || 0.5;
  
  for (let i = 23; i >= 0; i--) {
    const time = Math.floor((now - i * oneHour) / 1000) as Time;
    
    // Simulate volume based on typical ADA trading patterns
    const hourOfDay = new Date(now - i * oneHour).getHours();
    
    // Higher volume during US/EU trading hours
    let timeFactor = 1.0;
    if (hourOfDay >= 8 && hourOfDay <= 16) { // 8 AM - 4 PM UTC
      timeFactor = 1.3; // 30% higher during active hours
    } else if (hourOfDay >= 20 || hourOfDay <= 2) { // Evening/night
      timeFactor = 0.7; // 30% lower during quiet hours
    }
    
    // Add some volatility and market structure
    const volatility = 0.6 + Math.random() * 0.8; // 0.6 to 1.4x
    const marketTrend = Math.sin(i * 0.3) * 0.2 + 1; // Slight wave pattern
    
    // Calculate hourly volume in USD
    const hourlyVolumeUSD = (baseVolumeUSD / 24) * timeFactor * volatility * marketTrend;
    
    data.push({
      time,
      value: Math.round(hourlyVolumeUSD),
    });
  }
  
  return data;
};

// Generate volume data based on current price (when API data is not available)
const generateVolumeFromPrice = (currentPrice: number): ChartData[] => {
  const data: ChartData[] = [];
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  // Estimate volume based on price level (higher price often means more activity)
  const priceMultiplier = Math.max(0.5, Math.min(2.0, currentPrice)); // Scale with price
  const baseVolume = 300000000 * priceMultiplier; // Base 300M USD, scaled by price
  
  for (let i = 23; i >= 0; i--) {
    const time = Math.floor((now - i * oneHour) / 1000) as Time;
    
    // Add realistic trading patterns
    const timeVariation = Math.sin(i * 0.4) * 0.3 + 1; // Sine wave for daily pattern
    const randomVolatility = 0.7 + Math.random() * 0.6; // 0.7 to 1.3x
    
    const volume = (baseVolume / 24) * timeVariation * randomVolatility;
    
    data.push({
      time,
      value: Math.round(volume),
    });
  }
  
  return data;
};

// Generate simple OHLC data based on current ADA price
const generateSimpleOHLCData = (): CandlestickDataPoint[] => {
  const data: CandlestickDataPoint[] = [];
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  let currentPrice = networkStore.price?.lastPrice || 0.58; // Use real ADA price or fallback
  
  for (let i = 23; i >= 0; i--) {
    const time = Math.floor((now - i * oneHour) / 1000) as Time;
    
    // Generate realistic OHLC data
    const volatility = 0.015; // 1.5% max hourly movement
    const hourlyChange = (Math.random() - 0.5) * volatility; // Random walk
    
    // Calculate open price (previous close or current)
    const open = currentPrice;
    
    // Generate high and low around the open price
    const spread = Math.abs(hourlyChange) * 2; // Price spread for the hour
    const high = open + (Math.random() * spread);
    const low = Math.max(0.01, open - (Math.random() * spread)); // Keep price positive
    
    // Close price with trend
    const close = Math.max(0.01, open * (1 + hourlyChange));
    
    // Ensure high is highest and low is lowest
    const actualHigh = Math.max(open, close, high);
    const actualLow = Math.min(open, close, low);
    
    data.push({
      time,
      open: Number(open.toFixed(4)),
      high: Number(actualHigh.toFixed(4)),
      low: Number(actualLow.toFixed(4)),
      close: Number(close.toFixed(4)),
    });
    
    // Update current price for next iteration
    currentPrice = close;
  }
  
  return data;
};

// Generate realistic candlestick data based on current ADA price  
const generateEstimatedCandlestickData = (): CandlestickData[] => {
  const data: CandlestickData[] = [];
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  let currentPrice = networkStore.price?.lastPrice || 0.58; // Use real ADA price or fallback
  
  for (let i = 23; i >= 0; i--) {
    const time = Math.floor((now - i * oneHour) / 1000) as Time;
    
    // Generate realistic price movement
    const volatility = 0.015; // 1.5% max hourly movement
    const trend = (Math.random() - 0.5) * volatility; // Random walk
    const open = currentPrice;
    
    // Generate high and low based on volatility
    const spread = Math.random() * 0.008; // Up to 0.8% intra-hour spread
    const high = open + Math.random() * spread;
    const low = open - Math.random() * spread;
    
    // Close price with trend
    const close = Math.max(low, Math.min(high, open * (1 + trend)));
    currentPrice = close; // Update for next candle
    
    data.push({
      time,
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
    });
  }
  
  return data;
};

const onChartReady = (chartInstance: IChartApi) => {
  chart.value = chartInstance;
};

// Update chart data periodically (every 30 seconds)
let chartUpdateInterval: NodeJS.Timeout | null = null;

const startChartUpdates = () => {
  if (chartUpdateInterval) {
    clearInterval(chartUpdateInterval);
  }
  
  // Chart component handles its own updates for all tickers
  console.debug(`Chart updates for ${tickerSymbol.value} handled by TradingViewChart component`);
  // We could add periodic refresh logic here if needed in the future
};

const stopChartUpdates = () => {
  if (chartUpdateInterval) {
    clearInterval(chartUpdateInterval);
    chartUpdateInterval = null;
  }
};

// Reactive positions that update when ADA price changes
const positions = computed(() => {
  
  if (!rawPositions.value.length) {
    return [];
  }
  
  
  const processed = rawPositions.value.map((position, index) => {
    
    // Re-process position data with current price
    const processedData = processPositionData(position);
    
    // Return enhanced position with updated calculations
    const enhanced = {
      ...position,
      ...processedData
    };
    
    return enhanced;
  });
  
  return processed;
});

// Ticker symbol for the chart (extracted from the trading pair)
const tickerSymbol = computed(() => {
  return 'ADA'; // Default to ADA, can be made dynamic based on selected asset
});

const closingPositions = ref<Record<string, boolean>>({});
const loadingPositions = ref(false);

// Pagination for positions table (consistent with TokensTab.vue)
const currentPositionsPage = ref(1);
const positionsPerPage = ref(5); // Match tokens table default

// Computed for paginated positions
const paginatedPositions = computed(() => {
  const start = (currentPositionsPage.value - 1) * positionsPerPage.value;
  const end = start + positionsPerPage.value;
  return positions.value.slice(start, end);
});

const positionData = ref({
  asset: 'ADA/USD',
  collateralAmount: 0,
  leverage: 1,
  position: 'LONG',
  orderType: 'MARKET', // MARKET or LIMIT
  limitPrice: 0,
  stopLossPrice: 0,
  takeProfitPrice: 0,
});

// Table headers for positions - ultra compact for more space
const positionHeaders = ref([
  { text: "Asset", align: "start", sortable: true, value: "asset", width: "35" },
  { text: "Side", align: "center", sortable: true, value: "positionType", width: "28" },
  { text: "Value", align: "center", sortable: true, value: "currentValue", width: "42" },
  { text: "Entry / Mark", align: "center", sortable: true, value: "entryPrice", width: "48" },
  { text: "P&L", align: "center", sortable: true, value: "pnl", width: "42" },
  { text: "Lev", align: "center", sortable: true, value: "leverage", width: "22" },
  { text: "", align: "center", sortable: false, value: "actions", width: "26" },
]);

// Computed properties
const availableAdaBalance = computed(() => {
  // Get ADA balance from wallet store (simplified - you might need to access the actual balance)
  const tokens = walletStore.tokens || {};
  const adaToken = Object.values(tokens).find((token: any) => token.policy_id === '') as any;
  
  if (adaToken?.quantity) {
    const balance = Number(adaToken.quantity) / 1000000; // Convert from lovelace to ADA
    return balance.toFixed(2);
  }
  
  return '0.00';
});

watch(() => props.isOpen, async (newVal) => {
  if (newVal) {
    console.debug('PerpetualsDialog: Dialog opened, initializing chart data');
    loadPositions();
    
    // Reset chart state and enable fetching
    shouldFetchChartData.value = false; // Reset first
    chartData.value = []; // Clear any cached data
    
    // Use nextTick to ensure the chart component sees the reset
    await nextTick();
    
    // Now enable fetching - this will trigger the chart component to fetch fresh data
    shouldFetchChartData.value = true;
    console.debug('PerpetualsDialog: Enabled chart data fetching');
    
    startChartUpdates(); // Start real-time chart updates when dialog opens
  } else {
    console.debug('PerpetualsDialog: Dialog closed, stopping updates');
    shouldFetchChartData.value = false; // Disable fetching when closed
    stopChartUpdates(); // Stop chart updates when dialog closes
  }
});

// Watch for ADA price changes and log updates
watch(() => price.value?.lastPrice, (newPrice, oldPrice) => {
  if (newPrice !== oldPrice && rawPositions.value.length > 0) {
  }
});

const positionSize = computed(() => {
  return (positionData.value.collateralAmount * positionData.value.leverage).toFixed(2);
});

const notionalValue = computed(() => {
  const currentAdaPrice = Number(price.value?.lastPrice || 0);
  const positionSizeAda = Number(positionSize.value);
  return (positionSizeAda * currentAdaPrice).toFixed(2);
});

const liquidationPrice = computed(() => {
  const currentAdaPrice = Number(price.value?.lastPrice || 0.85);
  const leverage = positionData.value.leverage;
  
  if (positionData.value.position === 'LONG') {
    const liqPrice = currentAdaPrice * (1 - 0.9/leverage);
    return `$${liqPrice.toFixed(4)}`;
  } else {
    const liqPrice = currentAdaPrice * (1 + 0.9/leverage);
    return `$${liqPrice.toFixed(4)}`;
  }
});

// Leverage input synchronization
const onLeverageSliderChange = () => {
  // Update only when slider changes - no need for input synchronization
};

const canOpenPosition = computed(() => {
  const hasRequiredFields = positionData.value.asset && 
                           positionData.value.collateralAmount > 0 && 
                           positionData.value.leverage >= 1;
  
  // Additional validation for LIMIT orders
  if (positionData.value.orderType === 'LIMIT') {
    return hasRequiredFields && positionData.value.limitPrice > 0;
  }
  
  return hasRequiredFields;
});

const openPosition = async () => {
  const walletAddress = loggedWallet.value?.baseAddress;
  
  if (!walletAddress) {
    console.warn('No wallet address available');
    return;
  }

  loading.value = true;
  try {
    
    const openRequest: CreatePerpetualRequest = {
      address: walletAddress,
      asset: {
        name: positionData.value.asset,
        // TODO: Add policyId and assetName if needed
      },
      collateralAmount: positionData.value.collateralAmount,
      leverage: positionData.value.leverage,
      position: positionData.value.position,
      enteredPositionTime: Date.now(),
      // Include optional fields if they have values
      ...(positionData.value.stopLossPrice > 0 && { stopLossPrice: positionData.value.stopLossPrice }),
      ...(positionData.value.takeProfitPrice > 0 && { takeProfitPrice: positionData.value.takeProfitPrice }),
      // Add limit price for LIMIT orders
      ...(positionData.value.orderType === 'LIMIT' && { limitPrice: positionData.value.limitPrice }),
    };

    const strikeClient = createStrikeHttpClient();
    await strikeClient.openPosition(openRequest);
    
    // Reset form after success
    positionData.value = {
      asset: 'ADA/USD',
      collateralAmount: 0,
      leverage: 1,
      position: 'LONG',
      orderType: 'MARKET',
      limitPrice: 0,
      stopLossPrice: 0,
      takeProfitPrice: 0,
    };
    await loadPositions();
    
  } catch (error) {
    console.error('Failed to open position:', error);
    // TODO: Show user-friendly error notification
  } finally {
    loading.value = false;
  }
};

const closePosition = async (position: PerpetualPosition) => {
  if (!position.id || !position.outRef) {
    console.error('Invalid position data for closing');
    return;
  }

  closingPositions.value[position.id] = true;
  try {
    
    const closeRequest: ClosePerpetualRequest = {
      address: loggedWallet.value?.baseAddress,
      asset: position.asset,
      outRef: position.outRef,
      enteredPositionTime: position.enteredPositionTime,
    };

    const strikeClient = createStrikeHttpClient();
    await strikeClient.closePosition(closeRequest);
    
    // Reload positions after successful close
    await loadPositions();
    
  } catch (error) {
    console.error('Failed to close position:', error);
    // TODO: Show user-friendly error notification
  } finally {
    closingPositions.value[position.id] = false;
  }
};

const getStatusColor = (status?: string) => {
  switch (status?.toUpperCase()) {
    case 'OPEN':
      return 'status-open';
    case 'CLOSED':
      return 'status-closed';
    case 'LIQUIDATED':
      return 'status-liquidated';
    default:
      return 'status-unknown';
  }
};

const getPositionTrendIcon = (position: any) => {
  // Use P&L with fees as primary indicator, fallback to unrealized P&L
  const pnlValue = position.pnl !== undefined ? position.pnl : position.unrealizedPnl;
  
  if (pnlValue === undefined || pnlValue === null) {
    return assets.arrowRightSvg; // Neutral/unknown
  }
  
  if (pnlValue > 0) {
    return assets.trendUpSvg; // Profit - green up arrow
  } else if (pnlValue < 0) {
    return assets.trendDownSvg; // Loss - red down arrow
  } else {
    return assets.arrowRightSvg; // Break-even - neutral arrow
  }
};

const loadPositions = async () => {
  const walletAddress = loggedWallet.value?.baseAddress;
  
  if (!walletAddress) {
    console.warn('No wallet address available');
    return;
  }

  loadingPositions.value = true;
  try {
    
    // Use direct HTTP client instead of problematic API object
    const strikeClient = createStrikeHttpClient();
    const fetchedPositions = await strikeClient.getPositions(walletAddress);
    
    
    
    // Store raw positions for reactive processing
    rawPositions.value = fetchedPositions.map((position, index) => {
      
      // Extract collateral amount from the API data structure
      const collateralAmount = position.collateral?.amount || position.collateralAmount || 0;
      
      // Create base position object with required UI fields
      const basePosition = {
        // Use ALL original API data first
        ...position,
        
        // Add required UI fields without overriding API data
        id: position.outRef?.txHash || `position-${index}`,
        address: walletAddress,
        
        // Use API collateral structure but also provide legacy field for display
        collateralAmount: collateralAmount,
        
        // Ensure we have required fields for UI
        enteredPositionTime: position.enteredPositionTime || Date.now(),
        outRef: position.outRef || { txHash: `fake-${index}`, outputIndex: 0 }
      };
      
      return basePosition;
    });
    
  } catch (error) {
    console.error('Failed to load positions:', error?.message || error);
    // Show user-friendly error message
    rawPositions.value = [];
  } finally {
    loadingPositions.value = false;
  }
};

// Logo error handler
const onLogoError = (event: Event) => {
  console.warn('Strike Finance logo failed to load, hiding logo');
  const img = event.target as HTMLImageElement;
  img.style.display = 'none';
};

onMounted(async () => {
  if (props.isOpen) {
    loadPositions();
  }
  
  // Initialize chart data with real ADA data
  try {
    chartData.value = await generateChartData();
    console.debug('PerpetualsDialog: Initialized chart data with', chartData.value.length, 'points');
  } catch (error) {
    console.error('Failed to initialize chart data:', error);
    // Fallback to simple price data
    chartData.value = generateSimpleOHLCData();
  }
});

onBeforeUnmount(() => {
  stopChartUpdates();
});
</script>

<style scoped>
/* Compact widget matching SwapWidget */
.compact-perpetuals-widget {
  height: 100% !important;
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

/* Input card containers matching SwapWidget */
.card-container {
  border-radius: 12px !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
}

/* Text field styling to match SwapWidget inputs */
::v-deep .v-text-field--solo .v-input__control {
  background: transparent !important;
}

::v-deep .v-text-field--solo .v-input__slot {
  background: transparent !important;
}

::v-deep .v-text-field input {
  color: #ffffff !important;
  font-size: 16px !important;
  font-weight: 500 !important;
}

::v-deep .v-text-field.compact input {
  font-size: 14px !important;
}

/* Remove number input arrows */
::v-deep .v-text-field input[type="number"]::-webkit-outer-spin-button,
::v-deep .v-text-field input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none !important;
  margin: 0 !important;
}

::v-deep .v-text-field input[type="number"] {
  -moz-appearance: textfield !important;
}

::v-deep .v-text-field input::placeholder {
  color: #9ca3af !important;
}

/* Slider styling with Strike Finance green theme */
::v-deep .v-slider__thumb {
  background-color: #26FAB0 !important;
}

::v-deep .v-slider__thumb-label {
  background-color: #26FAB0 !important;
}

::v-deep .v-slider__track-fill {
  background-color: #26FAB0 !important;
}

::v-deep .v-slider__track-background {
  background-color: rgba(38, 250, 176, 0.2) !important;
}

/* Button toggle styling matching SwapWidget */
::v-deep .v-btn-toggle {
  background: transparent !important;
  border-radius: 8px !important;
}

::v-deep .v-btn-toggle.compact-toggle {
  border-radius: 6px !important;
}

::v-deep .v-btn-toggle.full-width-toggle {
  width: 100% !important;
  display: flex !important;
}

::v-deep .v-btn-toggle.full-width-toggle .v-btn.flex-btn {
  flex: 1 !important;
  min-width: 0 !important;
}

::v-deep .v-btn-toggle .v-btn {
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  color: #9ca3af !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
}

::v-deep .v-btn-toggle .v-btn.geroButton {
  background: linear-gradient(135deg, #26FAB0 0%, #1DE89A 100%) !important;
  color: #1a1a1a !important;
  border-color: #26FAB0 !important;
}

::v-deep .v-btn-toggle .v-btn.geroButton .v-icon {
  color: #1a1a1a !important;
}

/* Position summary matching SwapWidget details */
.position-summary {
  background: rgba(255, 255, 255, 0.02) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 8px !important;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 11px;
  color: #9ca3af;
}

.summary-row span:last-child {
  color: #ffffff;
  font-weight: 600;
}

.summary-row:last-child {
  margin-bottom: 0;
}

/* Open position button */
.open-position-btn {
  border-radius: 8px !important;
  text-transform: none !important;
  font-weight: 600 !important;
  letter-spacing: 0 !important;
  height: 40px !important;
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #6b7280;
}

.empty-state p {
  margin-top: 8px;
  font-size: 14px;
}

/* Loading state */
.loading-state {
  text-align: center;
  padding: 40px 20px;
  color: #9ca3af;
}

.loading-state p {
  margin-top: 8px;
  font-size: 14px;
}

/* Chart section styling */
.chart-section {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.chart-section >>> .trading-view-chart-container {
  border: none;
  background: transparent;
}

/* Profit/Loss styling */
.profit {
  color: #75E0A7 !important;
  font-weight: 600 !important;
}

.loss {
  color: #FDA29B !important;
  font-weight: 600 !important;
}

/* Reload button matching SwapWidget */
::v-deep .v-btn--icon {
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
}

::v-deep .v-btn--icon:hover {
  background: rgba(255, 255, 255, 0.1) !important;
}

/* Status colors */
.status-open {
  color: #75E0A7 !important;
  font-weight: 600 !important;
}

.status-closed {
  color: #9ca3af !important;
  font-weight: 500 !important;
}

.status-liquidated {
  color: #FDA29B !important;
  font-weight: 600 !important;
}

.status-unknown {
  color: #6b7280 !important;
  font-weight: 400 !important;
}

/* Strike Finance branding styles */
.strike-logo {
  height: 20px;
  width: auto;
  opacity: 0.8;
  transition: opacity 0.3s ease;
}

.strike-logo:hover {
  opacity: 1;
}

.powered-by-text {
  font-size: 12px;
  color: #26FAB0;
  font-weight: 500;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

/* ADA Ticker Styles */
.ada-ticker-compact {
  background: rgba(38, 250, 176, 0.03);
  border: 1px solid rgba(38, 250, 176, 0.15);
  border-radius: 6px;
  padding: 6px 8px;
  max-width: 200px;
  margin: 0 auto;
}

/* Corner ADA Ticker for top-right position */
.ada-ticker-compact-corner {
  background: rgba(38, 250, 176, 0.05);
  border: 1px solid rgba(38, 250, 176, 0.2);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 10px;
}

.ada-ticker-label-compact {
  font-size: 11px;
  font-weight: 600;
  color: #26FAB0;
  letter-spacing: 0.3px;
}

.ada-current-price-compact {
  font-size: 11px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.2px;
}

/* Two-column layout */
.two-column-layout {
  display: flex;
  gap: 16px;
  width: 100%;
}

.positions-column {
  flex: 1.2;
  min-width: 0;
  max-width: 600px;
}

.open-position-column {
  flex: 0.8;
  min-width: 280px;
  max-width: 420px;
}

.column-title {
  color: #26FAB0;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  margin-top: 0;
  letter-spacing: 0.3px;
}

.column-title.compact {
  font-size: 13px;
  margin-bottom: 6px;
}

.perpetuals-title {
  color: #ffffff;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

/* Positions table styling */
.positions-table {
  width: 100%;
  border: 1px solid rgba(38, 250, 176, 0.1);
  border-radius: 4px;
  padding: 2px;
}

.positions-data-table {
  background: transparent !important;
  width: 100% !important;
}

.positions-data-table >>> .v-data-table__wrapper {
  background: transparent !important;
}

.positions-data-table >>> .v-data-table-header {
  background: transparent !important;
}

.positions-data-table >>> .v-data-table-header th {
  background: transparent !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
  color: #9ca3af !important;
  font-size: 9px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.3px !important;
  padding: 2px 1px !important;
  height: 28px !important;
}

.positions-data-table >>> tbody tr {
  background: transparent !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
}

.positions-data-table >>> tbody tr:hover {
  background: rgba(38, 250, 176, 0.03) !important;
}

.positions-data-table >>> tbody td {
  border-bottom: none !important;
  padding: 4px 1px !important;
  font-size: 11px !important;
  color: #ffffff !important;
}

/* Position values styling */
.position-value-compact {
  text-align: center;
}

.position-value-compact .value-usd {
  color: #ffffff;
  font-weight: 600;
  font-size: 11px;
  line-height: 1.0;
}

.position-value-compact .value-ada {
  color: #9ca3af;
  font-size: 9px;
  line-height: 1.0;
  margin-top: 1px;
}

/* P&L values styling */
.pnl-values-compact {
  text-align: left;
}

.pnl-values-compact .pnl-percentage {
  font-size: 9px;
  line-height: 1.0;
  margin-top: 1px;
}

/* Price display styling */
.price-values-compact {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.1;
}

.entry-price {
  font-size: 11px;
  font-weight: 500;
  color: #ffffff;
}

.mark-price {
  font-size: 10px;
  color: #999999;
  font-weight: 400;
}

/* Trend icon centering */
.trend-icon-centered {
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: center;
}

/* Leverage display styling */
.leverage-display {
  font-size: 12px;
  font-weight: 500;
  color: #ffffff;
  text-align: right;
}

/* Center table headers and content */
::v-deep .v-data-table thead th {
  text-align: center !important;
}

::v-deep .v-data-table tbody td {
  text-align: center !important;
}

/* Override for asset column to remain left-aligned */
::v-deep .v-data-table tbody td:first-child,
::v-deep .v-data-table thead th:first-child {
  text-align: left !important;
}

/* External refresh button styling */
.refresh-btn-external {
  background: rgba(38, 250, 176, 0.08) !important;
  border: 1px solid rgba(38, 250, 176, 0.2) !important;
  border-radius: 6px !important;
  transition: all 0.2s ease !important;
}

.refresh-btn-external:hover {
  background: rgba(38, 250, 176, 0.15) !important;
  border-color: rgba(38, 250, 176, 0.4) !important;
  transform: scale(1.05);
}

.refresh-btn-external .v-icon {
  color: #26FAB0 !important;
}

/* Compact pagination styling (consistent with TokensTab.vue) */
.compact-pagination >>> .v-pagination__item {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  font-size: 12px !important;
  margin: 0 4px !important;
}

.compact-pagination >>> .v-pagination__item .v-btn {
  display: flex !important;
  align-items: flex-end !important;
  justify-content: center !important;
  min-height: 24px !important;
  height: 24px !important;
}

.compact-pagination >>> .v-pagination__navigation {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  margin: 0 8px !important;
}

.compact-pagination >>> .v-pagination__navigation .v-btn {
  display: flex !important;
  align-items: flex-end !important;
  justify-content: center !important;
  min-height: 24px !important;
  height: 24px !important;
}

.compact-pagination >>> .v-pagination__navigation .v-icon {
  font-size: 16px !important;
}

/* Remove hover effect and margins from pagination row */
.no-hover:hover {
  background-color: transparent !important;
}

.no-hover td {
  padding: 0 !important;
  margin: 0 !important;
  position: relative;
  height: 44px !important;
}

.compact-pagination.ma-0 {
  margin: 0 !important;
}

/* Dialog content height control */
.dialog-content-container {
  max-height: 870px !important;
  overflow-y: visible !important;
  overflow-x: hidden !important;
  height: auto !important;
}

/* Force no scrolling on dialog */
::v-deep .v-dialog {
  overflow: hidden !important;
}

::v-deep .v-dialog .v-card {
  overflow: hidden !important;
  position: relative !important;
}

::v-deep .v-dialog .v-card .v-card__text {
  overflow: visible !important;
}

/* Fixed height card for consistent layout */
.fixed-height-card {
  height: 750px !important;
  min-height: 750px !important;
  max-height: 750px !important;
  overflow: hidden !important;
}

/* Allow scrolling in open position column */
.open-position-column {
  max-height: 700px !important;
}

/* Scrollable form content */
.form-content-scrollable {
  overflow-y: auto !important;
  overflow-x: hidden !important;
  flex: 1 !important;
  min-height: 0 !important;
}

/* Bottom section always at bottom */
.bottom-section {
  flex-shrink: 0 !important;
  margin-top: auto !important;
  background: rgba(255, 255, 255, 0.02);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 12px;
  border-radius: 0 0 8px 8px;
}

/* Dialog footer positioning */
.dialog-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
}

/* Positions count styling */
.positions-count {
  font-size: 11px;
  color: #999999;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* Asset name styling */
.asset-name {
  font-weight: 600;
  color: #ffffff;
  font-size: 11px;
}

/* Close position button */
.close-position-btn {
  min-width: 75px !important;
  height: 32px !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.3px !important;
  border: 1px solid #FDA29B !important;
  color: #FDA29B !important;
  background: rgba(253, 162, 155, 0.05) !important;
  border-radius: 6px !important;
  transition: all 0.2s ease !important;
}

.close-position-btn:hover:not(:disabled) {
  background: rgba(253, 162, 155, 0.15) !important;
  border-color: #FDA29B !important;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(253, 162, 155, 0.2) !important;
}

.close-position-btn:disabled {
  opacity: 0.6 !important;
  cursor: not-allowed !important;
  transform: none !important;
}

.close-position-btn .v-icon {
  color: #FDA29B !important;
}

/* Compact close button */
.close-position-btn-compact {
  min-width: 28px !important;
  width: 28px !important;
  height: 28px !important;
  border-radius: 50% !important;
  padding: 0 !important;
}

.close-position-btn-compact .v-icon {
  color: #FDA29B !important;
  font-size: 14px !important;
}

.close-position-btn-compact:hover:not(:disabled) {
  background: rgba(253, 162, 155, 0.1) !important;
}

/* Enhanced form styling */
.form-section {
  margin-bottom: 20px;
}

.form-section.compact {
  margin-bottom: 8px;
}

.form-label {
  color: #26FAB0;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  letter-spacing: 0.3px;
}

.form-label.small {
  font-size: 12px;
  margin-bottom: 6px;
}

.form-label.compact {
  font-size: 11px;
  margin-bottom: 2px;
}

.available-balance {
  color: #9ca3af;
  font-size: 11px;
  font-weight: 400;
}

.available-balance.compact {
  font-size: 9px;
}

/* Input cards */
.input-card {
  border-radius: 8px !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  background-color: #161B26 !important;
  transition: border-color 0.2s ease;
}

.input-card:hover {
  border-color: rgba(38, 250, 176, 0.3) !important;
}

.input-card.small {
  background-color: #101828 !important;
}

.input-card.compact {
  min-height: 32px !important;
}

.input-container {
  display: flex;
  align-items: center;
}

.input-suffix {
  color: #9ca3af;
  font-size: 14px;
  font-weight: 500;
  margin-left: 8px;
  min-width: 40px;
}

/* Position and order type buttons */
.position-btn, .order-type-btn {
  min-width: 80px !important;
  height: 36px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
}

.position-btn.compact, .order-type-btn.compact {
  height: 28px !important;
  min-width: 60px !important;
  font-size: 11px !important;
}

.long-btn.geroButton {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0.1) 100%) !important;
  color: #10b981 !important;
  border: 1px solid rgba(16, 185, 129, 0.4) !important;
}

.short-btn.geroButton {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.1) 100%) !important;
  color: #ef4444 !important;
  border: 1px solid rgba(239, 68, 68, 0.4) !important;
}

.order-type-btn.geroButton {
  background: linear-gradient(135deg, #26FAB0 0%, #1DE89A 100%) !important;
  color: #1a1a1a !important;
  border: 1px solid #26FAB0 !important;
}

.order-type-btn.geroButton .v-icon {
  color: #1a1a1a !important;
}

/* Leverage input styling */
.leverage-input-container {
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 4px 8px;
  min-width: 70px;
}

.leverage-input-container.compact {
  min-width: 60px;
  padding: 2px 6px;
}

.leverage-text-input {
  width: 50px !important;
  min-width: 50px !important;
}

.leverage-text-input.compact {
  width: 40px !important;
  min-width: 40px !important;
}

.leverage-text-input >>> .v-input__control {
  min-height: 28px !important;
}

.leverage-text-input.compact >>> .v-input__control {
  min-height: 24px !important;
}

.leverage-text-input >>> .v-text-field__details {
  display: none !important;
}

.leverage-suffix {
  color: #26FAB0;
  font-weight: 600;
  font-size: 12px;
  margin-left: 4px;
}

.leverage-slider {
  margin-top: 8px;
}

.leverage-slider.compact {
  margin-top: 4px;
}

/* Take Profit / Stop Loss panel */
.tp-sl-panel {
  background: transparent !important;
}

.tp-sl-panel.compact >>> .v-expansion-panel {
  background: rgba(255, 255, 255, 0.02) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 6px !important;
}

.tp-sl-panel >>> .v-expansion-panel {
  background: rgba(255, 255, 255, 0.02) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 8px !important;
}

.tp-sl-header {
  padding: 12px 16px !important;
  min-height: 40px !important;
}

.tp-sl-header.compact {
  padding: 8px 12px !important;
  min-height: 32px !important;
}

.tp-sl-title {
  color: #ffffff;
  font-weight: 600;
  font-size: 13px;
  margin-right: 8px;
}

.tp-sl-title.compact {
  font-size: 12px;
  margin-right: 6px;
}

.tp-sl-subtitle {
  color: #9ca3af;
  font-size: 11px;
  font-style: italic;
}

.tp-sl-subtitle.compact {
  font-size: 10px;
}

.tp-sl-content {
  padding-top: 8px !important;
}

.tp-sl-content.compact {
  padding-top: 4px !important;
}

/* Fees tooltip */
.fees-btn {
  color: #9ca3af !important;
  font-size: 11px !important;
  text-transform: none !important;
  padding: 4px 8px !important;
  min-width: auto !important;
  height: 28px !important;
}

.fees-btn.compact {
  font-size: 10px !important;
  padding: 2px 6px !important;
  height: 24px !important;
}

.fees-btn:hover {
  color: #26FAB0 !important;
  background: rgba(38, 250, 176, 0.05) !important;
}

.fees-tooltip-content {
  color: #ffffff !important;
  min-width: 200px;
}

.fees-title {
  color: #26FAB0 !important;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(38, 250, 176, 0.2);
  padding-bottom: 4px;
}

.fee-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 12px;
}

.fee-item span:first-child {
  color: #9ca3af;
}

.fee-item span:last-child {
  color: #ffffff;
  font-weight: 600;
}

/* Position summary card */
.position-summary-card {
  background: rgba(38, 250, 176, 0.05) !important;
  border: 1px solid rgba(38, 250, 176, 0.2) !important;
  border-radius: 8px !important;
}

.position-summary-card.compact {
  border-radius: 6px !important;
}

.summary-title {
  color: #26FAB0;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 12px;
  text-align: center;
}

.summary-title.compact {
  font-size: 11px;
  margin-bottom: 4px;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  color: #9ca3af;
}

.summary-row.compact {
  margin-bottom: 2px;
  font-size: 10px;
}

.summary-row:last-child {
  margin-bottom: 0;
}

.summary-value {
  color: #ffffff;
  font-weight: 600;
}

/* Enhanced open position button */
.open-position-btn.enhanced {
  background: linear-gradient(135deg, #26FAB0 0%, #1DE89A 100%) !important;
  border-radius: 8px !important;
  text-transform: none !important;
  font-weight: 600 !important;
  letter-spacing: 0.3px !important;
  height: 48px !important;
  font-size: 15px !important;
  margin-top: 16px;
  color: #1a1a1a !important;
}

.open-position-btn.enhanced .v-icon {
  color: #1a1a1a !important;
}

.open-position-btn.enhanced.compact {
  height: 36px !important;
  font-size: 12px !important;
  margin-top: 8px;
  border-radius: 6px !important;
}

.open-position-btn.enhanced:hover {
  background: linear-gradient(135deg, #1DE89A 0%, #26FAB0 100%) !important;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(38, 250, 176, 0.3) !important;
}
</style>