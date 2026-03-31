<template>
  <v-dialog v-model="dialogVisible" fullscreen transition="dialog-bottom-transition">
    <v-card dark class="perps-terminal">

      <!-- ═══════════════════════════════════════════════════════════════════
           ROW 1 — Symbol Tabs (scrollable)
           ═══════════════════════════════════════════════════════════════════ -->
      <div class="symbol-tabs-bar">
        <v-btn icon small class="mr-1" @click="close">
          <v-icon size="18">mdi-close</v-icon>
        </v-btn>

        <div class="symbol-tabs-scroll">
          <div
            v-for="name in symbolNames"
            :key="name"
            class="symbol-tab"
            :class="{ 'symbol-tab--active': name === selectedSymbol }"
            @click="selectedSymbol = name"
          >
            <v-icon
              x-small
              class="mr-1 star-icon"
              :color="isFavorite(name) ? '#F0B90B' : '#848e9c'"
              @click.stop="toggleFavorite(name)"
            >
              {{ isFavorite(name) ? 'mdi-star' : 'mdi-star-outline' }}
            </v-icon>
            <span class="symbol-tab__name">{{ name }}</span>
            <span
              class="symbol-tab__change ml-1"
              :class="getTickerChangeClass(name)"
            >
              {{ formatChange(tickers[name]?.priceChangePercent) }}%
            </span>
          </div>
        </div>

        <v-spacer />

        <v-btn icon small :loading="tradingLoading" @click="refreshAll()">
          <v-icon size="18">mdi-reload</v-icon>
        </v-btn>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           ROW 2 — Price Info Bar
           ═══════════════════════════════════════════════════════════════════ -->
      <div class="price-info-bar">
        <v-select
          v-model="selectedSymbol"
          :items="symbolNames"
          dense
          hide-details
          outlined
          class="symbol-dropdown"
          :attach="true"
          :loading="marketLoading"
        />

        <template v-if="currentTicker">
          <div class="price-info-item">
            <span class="price-info-label">{{ $t('perpetuals.markPrice') }}</span>
            <span class="price-info-value">{{ formatPrice(currentFunding?.markPrice) }}</span>
          </div>
          <div class="price-info-item">
            <span class="price-info-label">{{ $t('perpetuals.indexPrice') }}</span>
            <span class="price-info-value">{{ formatPrice(currentFunding?.indexPrice) }}</span>
          </div>
          <div class="price-info-item">
            <span class="price-info-label">{{ $t('perpetuals.funding') }}</span>
            <span class="price-info-value" :class="fundingClass">
              {{ formatFundingRate(currentFunding?.lastFundingRate) }}
            </span>
            <span class="price-info-countdown ml-1">/ {{ fundingCountdown }}</span>
          </div>
          <div class="price-info-item">
            <span class="price-info-label">{{ $t('perpetuals.24hChange') }}</span>
            <span class="price-info-value" :class="tickerChangeClass">
              {{ formatChange(currentTicker.priceChangePercent) }}%
            </span>
          </div>
          <div class="price-info-item">
            <span class="price-info-label">{{ $t('perpetuals.24hHigh') }}</span>
            <span class="price-info-value">{{ formatPrice(currentTicker.highPrice) }}</span>
          </div>
          <div class="price-info-item">
            <span class="price-info-label">{{ $t('perpetuals.24hLow') }}</span>
            <span class="price-info-value">{{ formatPrice(currentTicker.lowPrice) }}</span>
          </div>
          <div class="price-info-item">
            <span class="price-info-label">{{ $t('perpetuals.24hVol') }}</span>
            <span class="price-info-value">{{ formatVolume(currentTicker.volume) }}</span>
          </div>
        </template>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           MAIN 3-COLUMN LAYOUT
           ═══════════════════════════════════════════════════════════════════ -->
      <div class="terminal-body">

        <!-- ─────────────────────────────────────────────────────────────────
             LEFT COLUMN (~60%) — Chart + Positions
             ───────────────────────────────────────────────────────────────── -->
        <div class="col-left">
          <!-- Chart area -->
          <div class="chart-area">
            <div class="chart-subtabs">
              <span
                v-for="tab in chartSubTabs"
                :key="tab.id"
                class="chart-subtab"
                :class="{ 'chart-subtab--active': activeChartSubTab === tab.id }"
                @click="activeChartSubTab = tab.id"
              >
                {{ $t(tab.label) }}
              </span>
              <span class="chart-subtabs-spacer" />
              <span
                v-for="tf in ['5m', '1h', '1d']"
                :key="tf"
                class="chart-subtab chart-tf"
                :class="{ 'chart-subtab--active': chartTimeframe === tf }"
                @click="chartTimeframe = tf"
              >
                {{ tf }}
              </span>
            </div>
            <TradingViewChart
              :symbol="'ADA/USD'"
              :data="chartData"
              :enable-realtime="true"
              :realtime-data="adaRealtimeData"
              width="100%"
              height="100%"
              theme="dark"
              :price-precision="symbolPrecision"
              :price-min-move="symbolMinMove"
              @chartReady="onChartReady"
            />
          </div>

          <!-- Positions / Orders tabs (spans full width below chart) -->
          <div class="positions-area">
            <v-tabs
              v-model="activeTab"
              background-color="transparent"
              color="#26FAB0"
              slider-color="#26FAB0"
              height="32"
              @change="onTabChange"
            >
              <v-tab class="tab-item">
                <span class="tab-text">{{ $t('perpetuals.positions') }}</span>
                <span v-if="openPositions.length > 0" class="tab-count ml-1">{{ openPositions.length }}</span>
              </v-tab>
              <v-tab class="tab-item">
                <span class="tab-text">{{ $t('perpetuals.openOrders') }}</span>
                <span v-if="openOrders.length > 0" class="tab-count ml-1">{{ openOrders.length }}</span>
              </v-tab>
              <v-tab class="tab-item">
                <span class="tab-text">{{ $t('perpetuals.orderHistory') }}</span>
              </v-tab>
              <v-tab class="tab-item">
                <span class="tab-text">{{ $t('perpetuals.fillHistory') }}</span>
              </v-tab>
              <v-tab class="tab-item">
                <span class="tab-text">{{ $t('perpetuals.funding') }}</span>
              </v-tab>
            </v-tabs>

            <v-tabs-items v-model="activeTab" class="transparent positions-tabs-items">

              <!-- Positions -->
              <v-tab-item>
                <div v-if="tabLoading[0]" class="tab-loading">
                  <v-progress-circular indeterminate color="#26FAB0" size="24" />
                </div>
                <div v-else-if="openPositions.length === 0" class="empty-state">
                  <v-icon size="32" color="#2b2f36">mdi-chart-line</v-icon>
                  <p class="mt-1">{{ $t('perpetuals.noOpenPositions') }}</p>
                </div>
                <v-data-table
                  v-else
                  dense
                  :headers="positionHeaders"
                  :items="openPositions"
                  class="transparent perps-table"
                  hide-default-footer
                  :items-per-page="-1"
                >
                  <template v-slot:[`item.Side`]="{ item }">
                    <span :class="item.Side === 'long' ? 'clr-green' : 'clr-red'" class="fw-600 text-uppercase font-mono">
                      {{ item.Side }}
                    </span>
                  </template>
                  <template v-slot:[`item.EntryPrice`]="{ item }">
                    <span class="font-mono">{{ formatPrice(item.EntryPrice) }}</span>
                  </template>
                  <template v-slot:[`item.mark_price`]="{ item }">
                    <span class="font-mono">{{ formatPrice(item.mark_price) }}</span>
                  </template>
                  <template v-slot:[`item.liquidation_price`]="{ item }">
                    <span class="font-mono clr-yellow">{{ formatPrice(item.liquidation_price) }}</span>
                  </template>
                  <template v-slot:[`item.upnl`]="{ item }">
                    <span :class="parseFloat(item.upnl) >= 0 ? 'clr-green' : 'clr-red'" class="font-mono fw-600">
                      {{ parseFloat(item.upnl) >= 0 ? '+' : '' }}{{ parseFloat(item.upnl).toFixed(2) }}
                    </span>
                  </template>
                  <template v-slot:[`item.actions`]="{ item }">
                    <v-btn
                      x-small
                      text
                      color="#F6465D"
                      :loading="closingPosition === item.PositionID"
                      @click="closePosition(item)"
                      class="action-btn"
                    >
                      {{ $t('perpetuals.close') }}
                    </v-btn>
                  </template>
                </v-data-table>
              </v-tab-item>

              <!-- Open Orders -->
              <v-tab-item>
                <div class="d-flex justify-end pa-1" v-if="openOrders.length > 0">
                  <v-btn
                    x-small text color="#F6465D"
                    :loading="cancellingAll"
                    @click="cancelAllOrdersAction()"
                  >
                    {{ $t('perpetuals.cancelAll') }}
                  </v-btn>
                </div>
                <div v-if="tabLoading[1]" class="tab-loading">
                  <v-progress-circular indeterminate color="#26FAB0" size="24" />
                </div>
                <div v-else-if="openOrders.length === 0" class="empty-state">
                  <v-icon size="32" color="#2b2f36">mdi-format-list-bulleted</v-icon>
                  <p class="mt-1">{{ $t('perpetuals.noOpenOrders') }}</p>
                </div>
                <v-data-table
                  v-else
                  dense
                  :headers="openOrderHeaders"
                  :items="openOrders"
                  class="transparent perps-table"
                  hide-default-footer
                  :items-per-page="-1"
                >
                  <template v-slot:[`item.Side`]="{ item }">
                    <span :class="item.Side === 'buy' ? 'clr-green' : 'clr-red'" class="fw-600 text-uppercase font-mono">
                      {{ item.Side }}
                    </span>
                  </template>
                  <template v-slot:[`item.actions`]="{ item }">
                    <v-btn
                      x-small text color="#F6465D"
                      :loading="cancellingOrder === item.ID"
                      @click="cancelOrderAction(item)"
                      class="action-btn"
                    >
                      {{ $t('perpetuals.cancel') }}
                    </v-btn>
                  </template>
                </v-data-table>
              </v-tab-item>

              <!-- Order History -->
              <v-tab-item>
                <div v-if="tabLoading[2]" class="tab-loading">
                  <v-progress-circular indeterminate color="#26FAB0" size="24" />
                </div>
                <div v-else-if="orderHistory.length === 0" class="empty-state">
                  <v-icon size="32" color="#2b2f36">mdi-history</v-icon>
                  <p class="mt-1">{{ $t('perpetuals.noOrderHistory') }}</p>
                </div>
                <v-data-table
                  v-else
                  dense
                  :headers="orderHistoryHeaders"
                  :items="orderHistory"
                  class="transparent perps-table"
                  :items-per-page="20"
                  :footer-props="{ itemsPerPageOptions: [10, 20, 50] }"
                >
                  <template v-slot:[`item.side`]="{ item }">
                    <span :class="item.side === 'buy' ? 'clr-green' : 'clr-red'" class="fw-600 text-uppercase font-mono">
                      {{ item.side }}
                    </span>
                  </template>
                  <template v-slot:[`item.created_at`]="{ item }">
                    {{ formatTime(item.created_at) }}
                  </template>
                </v-data-table>
              </v-tab-item>

              <!-- Fill / Trade History -->
              <v-tab-item>
                <div v-if="tabLoading[3]" class="tab-loading">
                  <v-progress-circular indeterminate color="#26FAB0" size="24" />
                </div>
                <div v-else-if="fillHistory.length === 0" class="empty-state">
                  <v-icon size="32" color="#2b2f36">mdi-swap-horizontal</v-icon>
                  <p class="mt-1">{{ $t('perpetuals.noFillHistory') }}</p>
                </div>
                <v-data-table
                  v-else
                  dense
                  :headers="fillHistoryHeaders"
                  :items="fillHistory"
                  class="transparent perps-table"
                  :items-per-page="20"
                  :footer-props="{ itemsPerPageOptions: [10, 20, 50] }"
                >
                  <template v-slot:[`item.side`]="{ item }">
                    <span :class="item.side === 'buy' ? 'clr-green' : 'clr-red'" class="fw-600 text-uppercase font-mono">
                      {{ item.side }}
                    </span>
                  </template>
                  <template v-slot:[`item.realized_pnl`]="{ item }">
                    <span :class="parseFloat(item.realized_pnl) >= 0 ? 'clr-green' : 'clr-red'" class="font-mono">
                      {{ parseFloat(item.realized_pnl) >= 0 ? '+' : '' }}{{ parseFloat(item.realized_pnl).toFixed(4) }}
                    </span>
                  </template>
                  <template v-slot:[`item.time`]="{ item }">
                    {{ formatTime(item.time) }}
                  </template>
                </v-data-table>
              </v-tab-item>

              <!-- Funding History -->
              <v-tab-item>
                <div v-if="tabLoading[4]" class="tab-loading">
                  <v-progress-circular indeterminate color="#26FAB0" size="24" />
                </div>
                <div v-else-if="fundingHistory.length === 0" class="empty-state">
                  <v-icon size="32" color="#2b2f36">mdi-percent</v-icon>
                  <p class="mt-1">{{ $t('perpetuals.noFundingHistory') }}</p>
                </div>
                <v-data-table
                  v-else
                  dense
                  :headers="fundingHistoryHeaders"
                  :items="fundingHistory"
                  class="transparent perps-table"
                  :items-per-page="20"
                  :footer-props="{ itemsPerPageOptions: [10, 20, 50] }"
                >
                  <template v-slot:[`item.income`]="{ item }">
                    <span :class="parseFloat(item.income) >= 0 ? 'clr-green' : 'clr-red'" class="font-mono">
                      {{ parseFloat(item.income) >= 0 ? '+' : '' }}{{ parseFloat(item.income).toFixed(6) }}
                      {{ item.asset }}
                    </span>
                  </template>
                  <template v-slot:[`item.time`]="{ item }">
                    {{ formatTime(item.time) }}
                  </template>
                </v-data-table>
              </v-tab-item>

            </v-tabs-items>
          </div>
        </div>

        <!-- ─────────────────────────────────────────────────────────────────
             CENTER COLUMN (~20%) — Order Book
             ───────────────────────────────────────────────────────────────── -->
        <div class="col-center">
          <!-- OB / Trades toggle -->
          <div class="ob-header">
            <span
              class="ob-tab"
              :class="{ 'ob-tab--active': obView === 'book' }"
              @click="obView = 'book'"
            >
              {{ $t('perpetuals.orderBook') }}
            </span>
            <span
              class="ob-tab"
              :class="{ 'ob-tab--active': obView === 'trades' }"
              @click="obView = 'trades'"
            >
              {{ $t('perpetuals.trades') }}
            </span>
          </div>

          <!-- Order Book view -->
          <div v-if="obView === 'book'" class="ob-content">
            <div class="ob-col-headers">
              <span>{{ $t('perpetuals.price') }} (USD)</span>
              <span>{{ $t('perpetuals.size') }} ({{ baseAsset }})</span>
              <span>{{ $t('perpetuals.total') }} ({{ baseAsset }})</span>
            </div>

            <!-- Asks (red, reversed so lowest ask is at bottom) -->
            <div class="ob-asks">
              <div
                v-for="(ask, i) in displayAsks"
                :key="'a' + i"
                class="ob-row ob-row--ask"
              >
                <div
                  class="ob-row-bg ob-row-bg--ask"
                  :style="{ width: ask.pct + '%' }"
                />
                <span class="ob-cell ob-price clr-red">{{ ask.price }}</span>
                <span class="ob-cell">{{ ask.size }}</span>
                <span class="ob-cell">{{ ask.total }}</span>
              </div>
            </div>

            <!-- Spread / mid-price -->
            <div class="ob-spread">
              <span class="ob-spread__price" :class="lastTradeClass">
                {{ formatPrice(currentTicker?.lastPrice) }}
              </span>
              <span class="ob-spread__info">
                {{ $t('perpetuals.spread') }}: {{ spreadValue }} / {{ spreadPercent }}
              </span>
            </div>

            <!-- Bids (green) -->
            <div class="ob-bids">
              <div
                v-for="(bid, i) in displayBids"
                :key="'b' + i"
                class="ob-row ob-row--bid"
              >
                <div
                  class="ob-row-bg ob-row-bg--bid"
                  :style="{ width: bid.pct + '%' }"
                />
                <span class="ob-cell ob-price clr-green">{{ bid.price }}</span>
                <span class="ob-cell">{{ bid.size }}</span>
                <span class="ob-cell">{{ bid.total }}</span>
              </div>
            </div>

            <!-- Buy / Sell ratio bar -->
            <div class="ob-ratio">
              <div class="ob-ratio__bar">
                <div class="ob-ratio__buy" :style="{ width: buyRatioPct + '%' }" />
                <div class="ob-ratio__sell" :style="{ width: (100 - buyRatioPct) + '%' }" />
              </div>
              <div class="ob-ratio__labels">
                <span class="clr-green">{{ buyRatioPct.toFixed(1) }}%</span>
                <span class="clr-red">{{ (100 - buyRatioPct).toFixed(1) }}%</span>
              </div>
            </div>
          </div>

          <!-- Recent Trades view -->
          <div v-else class="ob-content">
            <div class="ob-col-headers">
              <span>{{ $t('perpetuals.price') }} (USD)</span>
              <span>{{ $t('perpetuals.size') }} ({{ baseAsset }})</span>
              <span>{{ $t('perpetuals.time') }}</span>
            </div>
            <div class="ob-trades-list">
              <div
                v-for="(trade, i) in recentTrades"
                :key="'t' + i"
                class="ob-row"
              >
                <span class="ob-cell ob-price" :class="trade.isBuyerMaker ? 'clr-red' : 'clr-green'">
                  {{ formatPrice(trade.price) }}
                </span>
                <span class="ob-cell">{{ formatSize(trade.qty) }}</span>
                <span class="ob-cell ob-time">{{ formatTradeTime(trade.time) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ─────────────────────────────────────────────────────────────────
             RIGHT COLUMN (~20%) — Order Form + Account
             ───────────────────────────────────────────────────────────────── -->
        <div class="col-right">
          <div class="order-form-scroll">

            <!-- Margin mode / Leverage / Position mode -->
            <div class="of-margin-row">
              <v-btn-toggle v-model="marginMode" mandatory dense class="of-toggle of-toggle--margin">
                <v-btn value="cross" x-small>{{ $t('perpetuals.cross') }}</v-btn>
                <v-btn value="isolated" x-small>{{ $t('perpetuals.isolated') }}</v-btn>
              </v-btn-toggle>

              <v-menu offset-y :attach="true">
                <template v-slot:activator="{ on, attrs }">
                  <v-btn x-small outlined class="of-leverage-btn" v-bind="attrs" v-on="on">
                    {{ leverage }}x
                  </v-btn>
                </template>
                <v-card dark class="panel-bg pa-3" style="width: 220px;">
                  <div class="form-label mb-2">{{ $t('perpetuals.leverage') }}</div>
                  <v-slider
                    v-model="leverage"
                    min="1"
                    max="125"
                    step="1"
                    color="#26FAB0"
                    track-color="rgba(255,255,255,0.1)"
                    thumb-label
                    hide-details
                    dense
                  />
                  <div class="d-flex justify-space-between mt-1">
                    <span class="slider-tick">1x</span>
                    <span class="slider-tick">25x</span>
                    <span class="slider-tick">50x</span>
                    <span class="slider-tick">125x</span>
                  </div>
                  <v-btn
                    small block color="#26FAB0" class="mt-2"
                    style="color: #0b0e11;"
                    @click="applyLeverage()"
                  >
                    {{ $t('perpetuals.confirm') }}
                  </v-btn>
                </v-card>
              </v-menu>

              <span class="of-posmode-label">{{ $t('perpetuals.oneWay') }}</span>
            </div>

            <!-- Order type tabs -->
            <div class="of-type-tabs">
              <span
                v-for="t in orderTypes"
                :key="t.value"
                class="of-type-tab"
                :class="{ 'of-type-tab--active': orderType === t.value }"
                @click="orderType = t.value"
              >
                {{ $t(t.label) }}
              </span>
            </div>

            <!-- Side toggle: Long/Buy — Short/Sell -->
            <div class="of-side-toggle">
              <div
                class="of-side-btn of-side-btn--buy"
                :class="{ 'of-side-btn--active': orderSide === 'buy' }"
                @click="orderSide = 'buy'"
              >
                {{ $t('perpetuals.buyLong') }}
              </div>
              <div
                class="of-side-btn of-side-btn--sell"
                :class="{ 'of-side-btn--active': orderSide === 'sell' }"
                @click="orderSide = 'sell'"
              >
                {{ $t('perpetuals.sellShort') }}
              </div>
            </div>

            <!-- Available balance + current position -->
            <div class="of-info-row">
              <span class="form-label">{{ $t('perpetuals.availableBalance') }}</span>
              <span class="form-value">${{ formatBalance(account?.available_balance) }}</span>
            </div>
            <div class="of-info-row">
              <span class="form-label">{{ $t('perpetuals.currentPosition') }}</span>
              <span class="form-value">{{ currentPositionSize }} {{ baseAsset }}</span>
            </div>

            <!-- Price field (limit / stop-limit) -->
            <v-text-field
              v-if="orderType !== 'market'"
              v-model="limitPrice"
              :label="$t('perpetuals.price')"
              type="number"
              outlined
              dense
              hide-details
              class="of-input mb-2"
              prefix="$"
            />

            <!-- Stop price (stop-limit) -->
            <v-text-field
              v-if="orderType === 'stop_limit'"
              v-model="stopPrice"
              :label="$t('perpetuals.stopPrice')"
              type="number"
              outlined
              dense
              hide-details
              class="of-input mb-2"
              prefix="$"
            />

            <!-- Size input -->
            <div class="of-size-row">
              <v-text-field
                v-model="orderSize"
                :label="$t('perpetuals.size')"
                type="number"
                outlined
                dense
                hide-details
                class="of-input of-size-input"
              />
              <v-select
                v-model="sizeAsset"
                :items="[baseAsset, 'USD']"
                dense
                outlined
                hide-details
                class="of-size-asset"
                :attach="true"
              />
            </div>

            <!-- Size slider -->
            <div class="of-slider-row">
              <v-slider
                v-model="sizePercent"
                min="0"
                max="100"
                step="1"
                color="#26FAB0"
                track-color="rgba(255,255,255,0.1)"
                hide-details
                dense
                class="of-slider"
              />
              <span class="of-slider-pct">{{ sizePercent }}%</span>
            </div>

            <!-- Checkboxes: Reduce Only + TP/SL -->
            <div class="of-checkboxes">
              <v-checkbox
                v-model="reduceOnly"
                :label="$t('perpetuals.reduceOnly')"
                hide-details
                dense
                class="of-checkbox"
              />
              <v-checkbox
                v-model="showTpSl"
                :label="$t('perpetuals.tpSl')"
                hide-details
                dense
                class="of-checkbox"
              />
            </div>

            <!-- TP/SL inputs (expanded) -->
            <div v-if="showTpSl" class="of-tpsl">
              <v-text-field
                v-model="takeProfitPrice"
                :label="$t('perpetuals.takeProfitPriceUsd')"
                type="number"
                outlined
                dense
                hide-details
                class="of-input mb-2"
                prefix="$"
              />
              <v-text-field
                v-model="stopLossPrice"
                :label="$t('perpetuals.stopLossPriceUsd')"
                type="number"
                outlined
                dense
                hide-details
                class="of-input"
                prefix="$"
              />
            </div>

            <!-- Place Order button -->
            <v-btn
              block
              :color="orderSide === 'buy' ? '#26FAB0' : '#F6465D'"
              :loading="placingOrder"
              :disabled="!canPlaceOrder"
              @click="placeOrderAction()"
              class="of-place-btn mt-3"
              :style="{ color: orderSide === 'buy' ? '#0b0e11' : '#ffffff' }"
            >
              {{ orderSide === 'buy' ? $t('perpetuals.buyLong') : $t('perpetuals.sellShort') }}
              {{ selectedSymbol }}
            </v-btn>

            <v-alert v-if="tradingError" type="error" dense class="mt-2" dismissible @input="tradingError = null">
              {{ tradingError }}
            </v-alert>

            <!-- Order info estimates -->
            <div class="of-estimates mt-3">
              <div class="of-est-row">
                <span>{{ $t('perpetuals.estLiqPrice') }}</span>
                <span class="form-value">—</span>
              </div>
              <div class="of-est-row">
                <span>{{ $t('perpetuals.margin') }}</span>
                <span class="form-value">—</span>
              </div>
              <div class="of-est-row">
                <span>{{ $t('perpetuals.orderValue') }}</span>
                <span class="form-value">{{ notionalValue }}</span>
              </div>
              <div class="of-est-row">
                <span>{{ $t('perpetuals.estFee') }}</span>
                <span class="form-value">—</span>
              </div>
            </div>

            <!-- Divider -->
            <v-divider class="my-3" style="border-color: #2b2f36;" />

            <!-- Deposit / Withdraw -->
            <div class="of-deposit-row">
              <v-btn small outlined class="of-deposit-btn" color="#26FAB0">
                {{ $t('perpetuals.deposit') }}
              </v-btn>
              <v-btn small outlined class="of-deposit-btn" color="#848e9c">
                {{ $t('perpetuals.withdraw') }}
              </v-btn>
            </div>

            <!-- Account overview -->
            <div class="of-account-section mt-3">
              <div class="of-account-header">{{ $t('perpetuals.accountOverview') }}</div>
              <div class="of-account-row">
                <span>{{ $t('perpetuals.accountValue') }}</span>
                <span class="form-value">${{ formatBalance(account?.wallet_balance) }}</span>
              </div>
              <div class="of-account-row">
                <span>{{ $t('perpetuals.availableBalance') }}</span>
                <span class="form-value">${{ formatBalance(account?.available_balance) }}</span>
              </div>
              <div class="of-account-row">
                <span>{{ $t('perpetuals.unrealizedPnl') }}</span>
                <span
                  class="form-value"
                  :class="parseFloat(account?.unrealized_pnl ?? '0') >= 0 ? 'clr-green' : 'clr-red'"
                >
                  ${{ formatBalance(account?.unrealized_pnl) }}
                </span>
              </div>
              <div class="of-account-row">
                <span>{{ $t('perpetuals.marginRatio') }}</span>
                <span class="form-value">{{ marginRatioDisplay }}%</span>
              </div>
              <div class="of-account-row">
                <span>{{ $t('perpetuals.maintenanceMargin') }}</span>
                <span class="form-value">${{ formatBalance(account?.maintenance_margin) }}</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div class="terminal-footer">
        <span class="powered-by">{{ $t('common.poweredBy') }}</span>
        <img
          src="https://app.strikefinance.org/logo.svg"
          alt="Strike Finance"
          class="strike-logo"
          @error="onLogoError"
        />
      </div>

    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useStrikeMarket } from '@/modules/market/composables/useStrikeMarket';
import { useStrikeTrading } from '@/modules/market/composables/useStrikeTrading';
import { useStrikeMarketWs } from '@/modules/market/composables/useStrikeMarketWs';
import { useStrikeAccount } from '@/modules/market/composables/useStrikeAccount';
import { useStrikePositions } from '@/modules/market/composables/useStrikePositions';
import { useStrikeHistory } from '@/modules/market/composables/useStrikeHistory';
import { useMarketData } from '@/modules/market/composables/useMarketData';
import { priceStore } from '@/stores/priceStore';
import { useStrikeOnboarding } from '@/modules/market/composables/useStrikeOnboarding';
import { strikeMarketApi } from '@/api/strike-v2.market';
import { strikeUserApi } from '@/api/strike-v2.user';
import { strikeTradeApi } from '@/api/strike-v2.trade';
import type {
  Position,
  Order,
  OrderHistoryResult,
  FillHistoryResult,
  FundingHistoryResult,
  CreateOrderRequest,
  TradeResponse,
  MarginMode,
} from '@/api/strike-v2.types';
import snackbar from '@/plugins/snackbar';
import TradingViewChart from '@/shared/components/TradingViewChart.vue';
import type { IChartApi } from 'lightweight-charts';

// ---------------------------------------------------------------------------
// Props / emits
// ---------------------------------------------------------------------------

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
}>();

const dialogVisible = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v),
});

function close() {
  dialogVisible.value = false;
}

// ---------------------------------------------------------------------------
// Market data (singleton)
// ---------------------------------------------------------------------------

const { symbols, symbolNames, tickers, fundingRates, loading: marketLoading, getSymbolInfo, getTicker, getFunding } = useStrikeMarket();
const { getTokenCandles } = useMarketData();

// For Cardano wallets, default to ADA-USD. BTC-USD is for future Bitcoin wallet support.
const selectedSymbol = ref<string>('ADA-USD');

watch(symbolNames, (names) => {
  if (names.length > 0 && !names.includes(selectedSymbol.value)) {
    selectedSymbol.value = names[0];
  }
}, { immediate: true });

const currentTicker = computed(() => tickers.value[selectedSymbol.value]);
const currentFunding = computed(() => fundingRates.value[selectedSymbol.value]);

const baseAsset = computed(() => {
  const sym = selectedSymbol.value;
  const idx = sym.indexOf('-');
  return idx > 0 ? sym.substring(0, idx) : sym;
});

const tickerChangeClass = computed(() => {
  const pct = parseFloat(currentTicker.value?.priceChangePercent ?? '0');
  return pct >= 0 ? 'clr-green' : 'clr-red';
});

const fundingClass = computed(() => {
  const rate = parseFloat(currentFunding.value?.lastFundingRate ?? '0');
  return rate >= 0 ? 'clr-green' : 'clr-red';
});

function getTickerChangeClass(name: string): string {
  const pct = parseFloat(tickers.value[name]?.priceChangePercent ?? '0');
  return pct >= 0 ? 'clr-green' : 'clr-red';
}

// Funding countdown
const fundingCountdown = ref('--:--:--');
let countdownInterval: ReturnType<typeof setInterval> | null = null;

function updateFundingCountdown() {
  const nextTime = currentFunding.value?.nextFundingTime;
  if (!nextTime) { fundingCountdown.value = '--:--:--'; return; }
  const diff = nextTime - Date.now();
  if (diff <= 0) { fundingCountdown.value = '00:00:00'; return; }
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  fundingCountdown.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

countdownInterval = setInterval(updateFundingCountdown, 1000);
onBeforeUnmount(() => { if (countdownInterval) clearInterval(countdownInterval); });

// Favorites (use plain object — Vue 2 doesn't support reactive Set)
const favorites = ref<Record<string, boolean>>({});

function toggleFavorite(name: string) {
  if (favorites.value[name]) {
    delete favorites.value[name];
    favorites.value = { ...favorites.value }; // trigger reactivity
  } else {
    favorites.value = { ...favorites.value, [name]: true };
  }
}

function isFavorite(name: string): boolean {
  return !!favorites.value[name];
}

// ---------------------------------------------------------------------------
// Onboarding / auth
// ---------------------------------------------------------------------------

const { isConnected, checkConnection } = useStrikeOnboarding();

// ---------------------------------------------------------------------------
// Trading state (shared singleton)
// ---------------------------------------------------------------------------

const {
  account,
  openOrders,
  positions,
  loading: tradingLoading,
  error: tradingErrorRef,
  loadAccount,
  loadOpenOrders,
  loadPositions,
  cancelOrder,
  cancelAllOrders,
  setLeverage: apiSetLeverage,
  setMarginMode: apiSetMarginMode,
} = useStrikeTrading();

const tradingError = ref<string | null>(null);

const openPositions = computed<Position[]>(() =>
  (positions.value ?? []).filter((p) => parseFloat(p.Size) !== 0),
);

const currentPositionSize = computed(() => {
  const pos = openPositions.value.find((p) => p.symbol === selectedSymbol.value);
  if (!pos) return '0.00';
  return parseFloat(pos.Size).toFixed(2);
});

// ---------------------------------------------------------------------------
// TradingView chart — ADA/USD candle data from Gero market API
// ---------------------------------------------------------------------------

interface CandlestickDataPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

const chartData = ref<CandlestickDataPoint[]>([]);
const chartTimeframe = ref('5m');

// Live price updates for the chart from Gero price store (ADA/USD)
const adaRealtimeData = computed(() => priceStore.adaUsd);
const chartLoading = ref(false);
let chartInstance: IChartApi | null = null;

const symbolPrecision = computed(() => {
  // ADA has 4-6 decimal places for price
  return selectedSymbol.value.startsWith('ADA') ? 5 : 2;
});

const symbolMinMove = computed(() => {
  return 1 / Math.pow(10, symbolPrecision.value);
});

function onChartReady(chart: IChartApi) {
  chartInstance = chart;
}

async function loadChartData() {
  chartLoading.value = true;
  try {
    // Use Gero market API for ADA/USD candles
    const candles = await getTokenCandles('lovelace', chartTimeframe.value, 'usd');
    chartData.value = candles;
  } catch (e) {
    console.warn('[Perps] Failed to load chart data:', e);
  } finally {
    chartLoading.value = false;
  }
}

// Reload chart when timeframe changes
watch(chartTimeframe, () => loadChartData());

// ---------------------------------------------------------------------------
// WebSocket — order book + trades
// ---------------------------------------------------------------------------

const { subscribeDepth, subscribeTrades, connected: wsConnected } = useStrikeMarketWs();

interface OBLevel { price: string; size: string; total: string; pct: number; }

const obAsks = ref<[string, string][]>([]);
const obBids = ref<[string, string][]>([]);
const recentTrades = ref<TradeResponse[]>([]);
const obView = ref<'book' | 'trades'>('book');

const OB_DEPTH = 14;

let unsubDepth: (() => void) | null = null;
let unsubTrades: (() => void) | null = null;

function subscribeSymbolWs(symbol: string) {
  // Clean up previous
  if (unsubDepth) { unsubDepth(); unsubDepth = null; }
  if (unsubTrades) { unsubTrades(); unsubTrades = null; }
  obAsks.value = [];
  obBids.value = [];
  recentTrades.value = [];

  // Fetch initial order book snapshot
  strikeMarketApi.getOrderBook(symbol, OB_DEPTH * 2).then((snap) => {
    obAsks.value = snap.asks ?? [];
    obBids.value = snap.bids ?? [];
  }).catch(() => {});

  // WS depth updates
  unsubDepth = subscribeDepth(symbol, (data: unknown) => {
    const d = data as { a?: [string, string][]; b?: [string, string][] };
    if (d.a) obAsks.value = mergeOBSide(obAsks.value, d.a, 'ask');
    if (d.b) obBids.value = mergeOBSide(obBids.value, d.b, 'bid');
  });

  // WS trades
  unsubTrades = subscribeTrades(symbol, (data: unknown) => {
    const t = data as TradeResponse;
    if (t && t.price) {
      recentTrades.value = [t, ...recentTrades.value].slice(0, 50);
    }
  });
}

function mergeOBSide(
  existing: [string, string][],
  updates: [string, string][],
  side: 'ask' | 'bid',
): [string, string][] {
  const map = new Map<string, string>();
  for (const [p, q] of existing) map.set(p, q);
  for (const [p, q] of updates) {
    if (parseFloat(q) === 0) map.delete(p);
    else map.set(p, q);
  }
  const entries = Array.from(map.entries());
  entries.sort((a, b) => {
    const diff = parseFloat(a[0]) - parseFloat(b[0]);
    return side === 'ask' ? diff : -diff;
  });
  return entries;
}

const displayAsks = computed<OBLevel[]>(() => {
  // Show lowest asks, reversed so lowest is at bottom
  const sliced = obAsks.value.slice(0, OB_DEPTH);
  let cumTotal = 0;
  const levels = sliced.map(([p, q]) => {
    cumTotal += parseFloat(q);
    return { price: p, size: q, total: cumTotal.toFixed(4), cumTotal };
  });
  const maxTotal = levels.length > 0 ? levels[levels.length - 1].cumTotal : 1;
  return levels.reverse().map((l) => ({
    price: l.price,
    size: l.size,
    total: l.total,
    pct: (l.cumTotal / maxTotal) * 100,
  }));
});

const displayBids = computed<OBLevel[]>(() => {
  const sliced = obBids.value.slice(0, OB_DEPTH);
  let cumTotal = 0;
  const levels = sliced.map(([p, q]) => {
    cumTotal += parseFloat(q);
    return { price: p, size: q, total: cumTotal.toFixed(4), cumTotal };
  });
  const maxTotal = levels.length > 0 ? levels[levels.length - 1].cumTotal : 1;
  return levels.map((l) => ({
    price: l.price,
    size: l.size,
    total: l.total,
    pct: (l.cumTotal / maxTotal) * 100,
  }));
});

const spreadValue = computed(() => {
  if (obAsks.value.length === 0 || obBids.value.length === 0) return '—';
  const bestAsk = parseFloat(obAsks.value[0][0]);
  const bestBid = parseFloat(obBids.value[0][0]);
  return (bestAsk - bestBid).toFixed(5);
});

const spreadPercent = computed(() => {
  if (obAsks.value.length === 0 || obBids.value.length === 0) return '—';
  const bestAsk = parseFloat(obAsks.value[0][0]);
  const bestBid = parseFloat(obBids.value[0][0]);
  const mid = (bestAsk + bestBid) / 2;
  if (mid === 0) return '0%';
  return ((bestAsk - bestBid) / mid * 100).toFixed(3) + '%';
});

const buyRatioPct = computed(() => {
  const bidVol = obBids.value.slice(0, OB_DEPTH).reduce((s, [, q]) => s + parseFloat(q), 0);
  const askVol = obAsks.value.slice(0, OB_DEPTH).reduce((s, [, q]) => s + parseFloat(q), 0);
  const total = bidVol + askVol;
  return total > 0 ? (bidVol / total) * 100 : 50;
});

const lastTradeClass = computed(() => {
  if (recentTrades.value.length === 0) return 'clr-green';
  return recentTrades.value[0].isBuyerMaker ? 'clr-red' : 'clr-green';
});

// Subscribe on symbol change
watch(selectedSymbol, (sym) => {
  subscribeSymbolWs(sym);
}, { immediate: true });

onBeforeUnmount(() => {
  if (unsubDepth) unsubDepth();
  if (unsubTrades) unsubTrades();
});

// ---------------------------------------------------------------------------
// Chart sub-tabs
// ---------------------------------------------------------------------------

const chartSubTabs = [
  { id: 'chart', label: 'perpetuals.chart' },
  { id: 'data', label: 'perpetuals.data' },
  { id: 'depth', label: 'perpetuals.depth' },
  { id: 'liquidations', label: 'perpetuals.liquidations' },
  { id: 'details', label: 'perpetuals.details' },
];
const activeChartSubTab = ref('chart');

// ---------------------------------------------------------------------------
// Order form state
// ---------------------------------------------------------------------------

const orderTypes = [
  { value: 'market', label: 'perpetuals.market' },
  { value: 'limit', label: 'perpetuals.limit' },
  { value: 'stop_limit', label: 'perpetuals.stopLimit' },
] as const;

const orderType = ref<'market' | 'limit' | 'stop_limit'>('market');
const orderSide = ref<'buy' | 'sell'>('buy');
const orderSize = ref<string>('');
const limitPrice = ref<string>('');
const stopPrice = ref<string>('');
const leverage = ref<number>(20);
const marginMode = ref<MarginMode>('cross');
const sizeAsset = ref<string>('ADA');
const sizePercent = ref<number>(0);
const reduceOnly = ref(false);
const showTpSl = ref(false);
const takeProfitPrice = ref<string>('');
const stopLossPrice = ref<string>('');
const placingOrder = ref(false);

// Update sizeAsset when symbol changes
watch(baseAsset, (v) => { sizeAsset.value = v; });

const notionalValue = computed(() => {
  const size = parseFloat(orderSize.value);
  const price = orderType.value === 'market'
    ? parseFloat(currentTicker.value?.lastPrice ?? '0')
    : parseFloat(limitPrice.value || '0');
  if (!size || !price) return '$0.00';
  return `$${(size * price).toFixed(2)}`;
});

const canPlaceOrder = computed(() => {
  const size = parseFloat(orderSize.value);
  if (!size || size <= 0) return false;
  if (orderType.value === 'limit' || orderType.value === 'stop_limit') {
    const price = parseFloat(limitPrice.value);
    if (!price || price <= 0) return false;
  }
  if (orderType.value === 'stop_limit') {
    const sp = parseFloat(stopPrice.value);
    if (!sp || sp <= 0) return false;
  }
  return true;
});

const marginRatioDisplay = computed(() => {
  const margin = parseFloat(account.value?.total_margin ?? '0');
  const balance = parseFloat(account.value?.margin_balance ?? '0');
  if (!margin || !balance) return '0.00';
  return ((margin / balance) * 100).toFixed(2);
});

async function applyLeverage() {
  try {
    await apiSetLeverage(selectedSymbol.value, leverage.value);
    snackbar.show({ message: `Leverage set to ${leverage.value}x`, color: 'success' });
  } catch (e) {
    snackbar.show({ message: e instanceof Error ? e.message : String(e), color: 'error' });
  }
}

async function placeOrderAction() {
  if (!canPlaceOrder.value) return;
  placingOrder.value = true;
  tradingError.value = null;
  try {
    const hasTPSL = !!takeProfitPrice.value || !!stopLossPrice.value;
    const params: CreateOrderRequest = {
      symbol: selectedSymbol.value,
      side: orderSide.value,
      type: orderType.value === 'stop_limit' ? 'stop' : orderType.value,
      size: orderSize.value,
    };
    if (orderType.value !== 'market' && limitPrice.value) {
      params.price = limitPrice.value;
    }
    if (orderType.value === 'stop_limit' && stopPrice.value) {
      params.stop_price = stopPrice.value;
    }
    if (reduceOnly.value) {
      params.reduce_only = true;
    }

    let order: Order;
    if (hasTPSL) {
      const strategyParams: any = {
        ...params,
        strategy_id: crypto.randomUUID(),
      };
      if (takeProfitPrice.value) {
        strategyParams.tp_order = {
          type: 'take_profit',
          size: orderSize.value,
          stop_price: takeProfitPrice.value,
        };
      }
      if (stopLossPrice.value) {
        strategyParams.sl_order = {
          type: 'stop',
          size: orderSize.value,
          stop_price: stopLossPrice.value,
        };
      }
      order = await strikeTradeApi.createStrategyOrder(strategyParams);
    } else {
      order = await strikeTradeApi.createOrder(params);
    }

    snackbar.show({ message: `Order placed: ${order.ID ?? order.ClientOrderID}`, color: 'success' });
    orderSize.value = '';
    limitPrice.value = '';
    stopPrice.value = '';
    takeProfitPrice.value = '';
    stopLossPrice.value = '';
    sizePercent.value = 0;
    await Promise.all([loadOpenOrders(selectedSymbol.value), loadAccount()]);
  } catch (e) {
    tradingError.value = e instanceof Error ? e.message : String(e);
  } finally {
    placingOrder.value = false;
  }
}

// ---------------------------------------------------------------------------
// Close position
// ---------------------------------------------------------------------------

const closingPosition = ref<string | null>(null);

async function closePosition(position: Position) {
  closingPosition.value = position.PositionID;
  try {
    await strikeTradeApi.createOrder({
      symbol: position.symbol,
      side: position.Side === 'long' ? 'sell' : 'buy',
      type: 'market',
      size: position.Size,
      reduce_only: true,
      close_position: true,
    });
    snackbar.show({ message: 'Position closed', color: 'success' });
    await loadPositions(selectedSymbol.value);
  } catch (e) {
    snackbar.show({ message: e instanceof Error ? e.message : String(e), color: 'error' });
  } finally {
    closingPosition.value = null;
  }
}

// ---------------------------------------------------------------------------
// Cancel order(s)
// ---------------------------------------------------------------------------

const cancellingOrder = ref<string | null>(null);
const cancellingAll = ref(false);

async function cancelOrderAction(order: Order) {
  cancellingOrder.value = order.ID;
  try {
    await cancelOrder(order.ID, order.Symbol);
    snackbar.show({ message: 'Order cancelled', color: 'success' });
  } catch (e) {
    snackbar.show({ message: e instanceof Error ? e.message : String(e), color: 'error' });
  } finally {
    cancellingOrder.value = null;
  }
}

async function cancelAllOrdersAction() {
  cancellingAll.value = true;
  try {
    await cancelAllOrders(selectedSymbol.value);
    snackbar.show({ message: 'All orders cancelled', color: 'success' });
  } catch (e) {
    snackbar.show({ message: e instanceof Error ? e.message : String(e), color: 'error' });
  } finally {
    cancellingAll.value = false;
  }
}

// ---------------------------------------------------------------------------
// History — loaded lazily on tab activation
// ---------------------------------------------------------------------------

const activeTab = ref(0);
const tabLoading = ref<Record<number, boolean>>({ 0: false, 1: false, 2: false, 3: false, 4: false });

const orderHistory = ref<OrderHistoryResult[]>([]);
const fillHistory = ref<FillHistoryResult[]>([]);
const fundingHistory = ref<FundingHistoryResult[]>([]);

const tabLoaded = ref<Record<number, boolean>>({ 0: false, 1: false, 2: false, 3: false, 4: false });

async function onTabChange(tab: number) {
  if (tabLoaded.value[tab]) return;
  tabLoading.value[tab] = true;
  try {
    if (tab === 0) {
      await loadPositions(selectedSymbol.value);
    } else if (tab === 1) {
      await loadOpenOrders(selectedSymbol.value);
    } else if (tab === 2) {
      const res = await strikeUserApi.getOrderHistory({ symbol: selectedSymbol.value, limit: 50 });
      orderHistory.value = res.orders;
    } else if (tab === 3) {
      const res = await strikeUserApi.getFillHistory({ symbol: selectedSymbol.value, limit: 50 });
      fillHistory.value = res.fills;
    } else if (tab === 4) {
      const res = await strikeUserApi.getFundingHistory({ symbol: selectedSymbol.value, limit: 50 });
      fundingHistory.value = res.funding;
    }
    tabLoaded.value[tab] = true;
  } catch (e) {
    snackbar.show({ message: e instanceof Error ? e.message : String(e), color: 'error' });
  } finally {
    tabLoading.value[tab] = false;
  }
}

watch(selectedSymbol, () => {
  tabLoaded.value = { 0: false, 1: false, 2: false, 3: false, 4: false };
  onTabChange(activeTab.value);
});

watch(dialogVisible, async (open) => {
  if (open) {
    // Always load chart data (ADA/USD from Gero market API — no Strike auth needed)
    loadChartData();
    await checkConnection();
    if (isConnected.value) {
      await Promise.all([loadAccount(), onTabChange(0), onTabChange(1)]);
    }
  }
});

async function refreshAll() {
  tabLoaded.value = { 0: false, 1: false, 2: false, 3: false, 4: false };
  if (isConnected.value) {
    await Promise.all([loadAccount(), onTabChange(activeTab.value)]);
  }
}

// ---------------------------------------------------------------------------
// Table headers
// ---------------------------------------------------------------------------

const positionHeaders = [
  { text: 'Symbol', value: 'symbol', sortable: true },
  { text: 'Side', value: 'Side', sortable: true },
  { text: 'Size', value: 'Size', sortable: true },
  { text: 'Entry Price', value: 'EntryPrice', sortable: true },
  { text: 'Mark Price', value: 'mark_price', sortable: false },
  { text: 'Liq. Price', value: 'liquidation_price', sortable: false },
  { text: 'Margin', value: 'IsolatedMargin', sortable: true },
  { text: 'PNL (ROE%)', value: 'upnl', sortable: true },
  { text: 'Funding', value: 'maintenance_margin', sortable: false },
  { text: 'TP/SL', value: 'tpsl', sortable: false },
  { text: '', value: 'actions', sortable: false, width: 70 },
];

const openOrderHeaders = [
  { text: 'Type', value: 'Type', sortable: true },
  { text: 'Side', value: 'Side', sortable: true },
  { text: 'Symbol', value: 'Symbol', sortable: true },
  { text: 'Price', value: 'Price', sortable: true },
  { text: 'Size', value: 'Size', sortable: true },
  { text: 'Filled', value: 'Filled', sortable: true },
  { text: 'Status', value: 'Status', sortable: true },
  { text: '', value: 'actions', sortable: false, width: 70 },
];

const orderHistoryHeaders = [
  { text: 'Type', value: 'type', sortable: true },
  { text: 'Side', value: 'side', sortable: true },
  { text: 'Symbol', value: 'symbol', sortable: true },
  { text: 'Price', value: 'price', sortable: true },
  { text: 'Size', value: 'size', sortable: true },
  { text: 'Filled', value: 'filled', sortable: true },
  { text: 'Status', value: 'status', sortable: true },
  { text: 'Time', value: 'created_at', sortable: true },
];

const fillHistoryHeaders = [
  { text: 'Symbol', value: 'symbol', sortable: true },
  { text: 'Side', value: 'side', sortable: true },
  { text: 'Price', value: 'price', sortable: true },
  { text: 'Qty', value: 'qty', sortable: true },
  { text: 'Fee', value: 'commission', sortable: true },
  { text: 'Realized PnL', value: 'realized_pnl', sortable: true },
  { text: 'Time', value: 'time', sortable: true },
];

const fundingHistoryHeaders = [
  { text: 'Symbol', value: 'symbol', sortable: true },
  { text: 'Income', value: 'income', sortable: true },
  { text: 'Time', value: 'time', sortable: true },
];

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatPrice(val: string | number | undefined): string {
  if (val === undefined || val === null || val === '') return '—';
  const n = parseFloat(String(val));
  if (isNaN(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function formatSize(val: string | number | undefined): string {
  if (val === undefined || val === null || val === '') return '—';
  const n = parseFloat(String(val));
  if (isNaN(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatVolume(val: string | number | undefined): string {
  if (val === undefined || val === null || val === '') return '—';
  const n = parseFloat(String(val));
  if (isNaN(n)) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatChange(val: string | undefined): string {
  if (!val) return '0.00';
  const n = parseFloat(val);
  return (n >= 0 ? '+' : '') + n.toFixed(2);
}

function formatFundingRate(val: string | undefined): string {
  if (!val) return '0.0000%';
  const n = parseFloat(val) * 100;
  return (n >= 0 ? '+' : '') + n.toFixed(4) + '%';
}

function formatBalance(val: string | undefined): string {
  if (!val) return '0.00';
  const n = parseFloat(val);
  if (isNaN(n)) return '0.00';
  return n.toFixed(2);
}

function formatTime(val: number | string | undefined): string {
  if (!val) return '—';
  const ts = typeof val === 'number' ? val : Date.parse(val);
  if (isNaN(ts)) return String(val);
  return new Date(ts).toLocaleString();
}

function formatTradeTime(val: number | undefined): string {
  if (!val) return '—';
  const d = new Date(val);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function onLogoError(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none';
}
</script>

<style scoped>
/* ═══════════════════════════════════════════════════════════════════════════
   TERMINAL LAYOUT
   ═══════════════════════════════════════════════════════════════════════════ */

.perps-terminal {
  background: #0b0e11 !important;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* ── Symbol tabs bar ──────────────────────────────────────────────────── */

.symbol-tabs-bar {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 8px;
  border-bottom: 1px solid #2b2f36;
  flex-shrink: 0;
  background: #0b0e11;
}

.symbol-tabs-scroll {
  display: flex;
  overflow-x: auto;
  gap: 2px;
  flex: 1;
  scrollbar-width: none;
}
.symbol-tabs-scroll::-webkit-scrollbar { display: none; }

.symbol-tab {
  display: flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  font-size: 12px;
  color: #848e9c;
  transition: background 0.15s;
}
.symbol-tab:hover { background: rgba(255,255,255,0.04); }
.symbol-tab--active {
  background: rgba(255,255,255,0.06);
  color: #ffffff;
}

.symbol-tab__name { font-weight: 600; }
.symbol-tab__change { font-size: 11px; font-weight: 600; }

.star-icon { cursor: pointer; }

/* ── Price info bar ───────────────────────────────────────────────────── */

.price-info-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 4px 12px;
  border-bottom: 1px solid #2b2f36;
  flex-shrink: 0;
  background: #0b0e11;
  overflow-x: auto;
}

.symbol-dropdown {
  max-width: 140px;
  flex-shrink: 0;
  font-weight: 600;
}

.price-info-item {
  display: flex;
  flex-direction: column;
  white-space: nowrap;
}

.price-info-label {
  font-size: 10px;
  color: #848e9c;
  line-height: 1.2;
}

.price-info-value {
  font-size: 12px;
  font-weight: 600;
  color: #eaecef;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  line-height: 1.3;
}

.price-info-countdown {
  font-size: 10px;
  color: #848e9c;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

/* ── Main 3-column body ──────────────────────────────────────────────── */

.terminal-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Left column: chart + positions */
.col-left {
  flex: 3;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #2b2f36;
  min-width: 0;
}

/* Center column: order book */
.col-center {
  flex: 1;
  min-width: 220px;
  max-width: 280px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #2b2f36;
}

/* Right column: order form */
.col-right {
  flex: 1;
  min-width: 260px;
  max-width: 320px;
  display: flex;
  flex-direction: column;
}

/* ── Chart area ───────────────────────────────────────────────────────── */

.chart-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid #2b2f36;
  min-height: 300px;
}

.chart-subtabs {
  display: flex;
  gap: 2px;
  padding: 4px 8px;
  border-bottom: 1px solid #1b1d23;
}

.chart-subtab {
  font-size: 11px;
  color: #848e9c;
  padding: 3px 10px;
  cursor: pointer;
  border-radius: 3px;
}
.chart-subtab:hover { background: rgba(255,255,255,0.04); }
.chart-subtab--active {
  color: #26FAB0;
  background: rgba(38, 250, 176, 0.08);
}

.chart-subtabs-spacer {
  flex: 1;
}

.chart-area >>> .trading-view-chart-container {
  flex: 1;
  min-height: 300px;
  background: #1b1d23;
}

/* ── Positions area ───────────────────────────────────────────────────── */

.positions-area {
  flex-shrink: 0;
  min-height: 180px;
  max-height: 300px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.positions-tabs-items {
  overflow-y: auto;
  flex: 1;
}

/* ── Order Book ───────────────────────────────────────────────────────── */

.ob-header {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid #2b2f36;
}

.ob-tab {
  font-size: 11px;
  color: #848e9c;
  padding: 2px 8px;
  cursor: pointer;
  border-radius: 3px;
  font-weight: 600;
}
.ob-tab:hover { background: rgba(255,255,255,0.04); }
.ob-tab--active { color: #eaecef; background: rgba(255,255,255,0.06); }

.ob-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 11px;
}

.ob-col-headers {
  display: flex;
  justify-content: space-between;
  padding: 4px 8px;
  font-size: 10px;
  color: #5e6673;
  border-bottom: 1px solid #1b1d23;
}

.ob-asks, .ob-bids, .ob-trades-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.ob-row {
  display: flex;
  justify-content: space-between;
  padding: 1px 8px;
  position: relative;
  line-height: 18px;
}

.ob-row-bg {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  pointer-events: none;
}
.ob-row-bg--ask { background: rgba(246, 70, 93, 0.08); }
.ob-row-bg--bid { background: rgba(38, 250, 176, 0.08); }

.ob-cell {
  position: relative;
  z-index: 1;
  color: #eaecef;
  min-width: 0;
  flex: 1;
  text-align: right;
}
.ob-cell:first-child { text-align: left; }

.ob-price { font-weight: 600; }

.ob-time {
  font-size: 10px;
  color: #5e6673;
}

.ob-spread {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-top: 1px solid #2b2f36;
  border-bottom: 1px solid #2b2f36;
  background: rgba(255,255,255,0.02);
}

.ob-spread__price {
  font-size: 14px;
  font-weight: 700;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.ob-spread__info {
  font-size: 10px;
  color: #5e6673;
}

.ob-ratio {
  padding: 6px 8px;
  flex-shrink: 0;
}

.ob-ratio__bar {
  display: flex;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
}

.ob-ratio__buy { background: #26FAB0; }
.ob-ratio__sell { background: #F6465D; }

.ob-ratio__labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  margin-top: 2px;
}

/* ── Order Form (right column) ────────────────────────────────────────── */

.order-form-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
}

.of-margin-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.of-toggle--margin {
  height: 24px !important;
}
.of-toggle--margin .v-btn {
  height: 24px !important;
  font-size: 10px !important;
  text-transform: none !important;
  padding: 0 8px !important;
  min-width: auto !important;
}

.of-leverage-btn {
  font-size: 11px !important;
  text-transform: none !important;
  min-width: auto !important;
  height: 24px !important;
  padding: 0 8px !important;
  border-color: #2b2f36 !important;
  color: #eaecef !important;
}

.of-posmode-label {
  font-size: 10px;
  color: #848e9c;
  margin-left: auto;
}

/* Order type tabs */
.of-type-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 8px;
}

.of-type-tab {
  font-size: 11px;
  color: #848e9c;
  padding: 3px 10px;
  cursor: pointer;
  border-radius: 3px;
  font-weight: 500;
}
.of-type-tab:hover { background: rgba(255,255,255,0.04); }
.of-type-tab--active {
  color: #eaecef;
  background: rgba(255,255,255,0.08);
}

/* Side toggle */
.of-side-toggle {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}

.of-side-btn {
  flex: 1;
  text-align: center;
  padding: 6px 0;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.of-side-btn--buy {
  color: #0b0e11;
  background: rgba(38, 250, 176, 0.15);
  color: #26FAB0;
}
.of-side-btn--buy.of-side-btn--active {
  background: #26FAB0;
  color: #0b0e11;
}

.of-side-btn--sell {
  background: rgba(246, 70, 93, 0.15);
  color: #F6465D;
}
.of-side-btn--sell.of-side-btn--active {
  background: #F6465D;
  color: #ffffff;
}

/* Info rows */
.of-info-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.form-label {
  font-size: 11px;
  color: #848e9c;
}

.form-value {
  font-size: 11px;
  font-weight: 600;
  color: #eaecef;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

/* Inputs */
.of-input {
  font-size: 12px !important;
}

.of-input >>> .v-input__slot {
  min-height: 32px !important;
  background: #1b1d23 !important;
  border-color: #2b2f36 !important;
}

.of-input >>> input {
  font-family: 'JetBrains Mono', 'Fira Code', monospace !important;
  font-size: 12px !important;
  color: #eaecef !important;
}

/* Size row */
.of-size-row {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}

.of-size-input { flex: 1; }

.of-size-asset {
  max-width: 80px;
  flex-shrink: 0;
}

.of-size-asset >>> .v-input__slot {
  min-height: 32px !important;
  background: #1b1d23 !important;
  border-color: #2b2f36 !important;
}

/* Slider row */
.of-slider-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.of-slider { flex: 1; }
.of-slider-pct {
  font-size: 11px;
  color: #26FAB0;
  font-weight: 600;
  min-width: 32px;
  text-align: right;
}

/* Checkboxes */
.of-checkboxes {
  display: flex;
  gap: 12px;
  margin-bottom: 4px;
}

.of-checkbox {
  margin: 0 !important;
  padding: 0 !important;
}
.of-checkbox >>> .v-label {
  font-size: 11px !important;
  color: #848e9c !important;
}
.of-checkbox >>> .v-input--selection-controls__input {
  margin-right: 4px !important;
}

/* TP/SL */
.of-tpsl {
  margin-top: 6px;
}

/* Place order button */
.of-place-btn {
  border-radius: 4px !important;
  text-transform: none !important;
  font-weight: 700 !important;
  font-size: 13px !important;
  height: 40px !important;
  letter-spacing: 0 !important;
}

/* Estimates */
.of-estimates {
  background: rgba(255,255,255,0.02);
  border-radius: 4px;
  padding: 6px 8px;
}

.of-est-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #5e6673;
  line-height: 20px;
}

/* Deposit/Withdraw row */
.of-deposit-row {
  display: flex;
  gap: 8px;
}

.of-deposit-btn {
  flex: 1;
  text-transform: none !important;
  font-size: 11px !important;
  height: 28px !important;
}

/* Account overview */
.of-account-section {
  background: rgba(255,255,255,0.02);
  border-radius: 4px;
  padding: 8px;
}

.of-account-header {
  font-size: 11px;
  font-weight: 600;
  color: #848e9c;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.of-account-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #5e6673;
  line-height: 20px;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHARED STYLES
   ═══════════════════════════════════════════════════════════════════════════ */

.panel-bg { background: #1b1d23 !important; }

.slider-tick {
  font-size: 9px;
  color: #5e6673;
}

/* Tabs */
.tab-item {
  min-width: auto !important;
  padding: 0 10px !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  text-transform: none !important;
}

.tab-text { font-size: 11px; }

.tab-count {
  background: rgba(38, 250, 176, 0.15);
  color: #26FAB0;
  border-radius: 8px;
  padding: 0 4px;
  font-size: 9px;
  font-weight: 600;
}

/* Tables */
.perps-table { background: transparent !important; }

.perps-table >>> th {
  font-size: 10px !important;
  color: #5e6673 !important;
  white-space: nowrap;
  padding: 4px 8px !important;
  height: 28px !important;
}

.perps-table >>> td {
  font-size: 11px !important;
  white-space: nowrap;
  padding: 2px 8px !important;
  height: 28px !important;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: #eaecef;
}

/* Loading / empty states */
.tab-loading {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 24px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: #5e6673;
  font-size: 12px;
}

/* Action buttons */
.action-btn {
  font-size: 10px !important;
  text-transform: none !important;
  min-width: auto !important;
  height: 22px !important;
  padding: 0 6px !important;
}

/* Color utilities */
.clr-green { color: #26FAB0 !important; }
.clr-red { color: #F6465D !important; }
.clr-yellow { color: #F0B90B !important; }

.fw-600 { font-weight: 600; }

.font-mono { font-family: 'JetBrains Mono', 'Fira Code', monospace; }

/* Footer */
.terminal-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px 0;
  border-top: 1px solid #2b2f36;
  background: #0b0e11;
  flex-shrink: 0;
}

.powered-by {
  font-size: 10px;
  color: #5e6673;
  margin-right: 6px;
}

.strike-logo {
  height: 14px;
  opacity: 0.6;
}
</style>
