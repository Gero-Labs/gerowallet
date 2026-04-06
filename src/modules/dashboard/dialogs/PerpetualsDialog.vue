<template>
  <v-dialog v-model="dialogVisible" fullscreen transition="dialog-bottom-transition">
    <v-card dark class="perps-terminal">

      <!-- ═══════════════════════════════════════════════════════════════════
           ROW 1 — Symbol Tabs (scrollable)
           ═══════════════════════════════════════════════════════════════════ -->
      <div class="symbol-tabs-bar">
        <v-card-title class="px-1">{{ $t('navigation.perpetuals') }}</v-card-title>

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

        <v-btn icon small class="mr-1" @click="close">
          <v-icon size="18">mdi-close</v-icon>
        </v-btn>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           ROW 2 — Price Info Bar
           ═══════════════════════════════════════════════════════════════════ -->
      <div class="price-info-bar">
        <div class="symbol-pair">
          <img src="@/assets/svg/cardano-blue.svg" alt="" class="symbol-pair__icon" />
          <span class="symbol-pair__name">{{ selectedSymbol }}</span>
        </div>

        <template v-if="currentTicker">
          <div class="price-info-item">
            <v-tooltip bottom content-class="custom-tooltip" max-width="260">
              <template #activator="{ on, attrs }">
                <span class="price-info-label price-info-label--dashed" v-bind="attrs" v-on="on">{{ $t('perpetuals.markPrice') }}</span>
              </template>
              <span>{{ $t('perpetuals.markPriceTooltip') }}</span>
            </v-tooltip>
            <span
              class="price-info-value"
              :class="{
                'price-flash-up': markPriceFlash === 'up',
                'price-flash-down': markPriceFlash === 'down',
              }"
            >{{ formatPrice(liveMarkPrice ?? currentFunding?.markPrice) }}</span>
          </div>
          <div class="price-info-item">
            <v-tooltip bottom content-class="custom-tooltip" max-width="260">
              <template #activator="{ on, attrs }">
                <span class="price-info-label price-info-label--dashed" v-bind="attrs" v-on="on">{{ $t('perpetuals.indexPrice') }}</span>
              </template>
              <span>{{ $t('perpetuals.indexPriceTooltip') }}</span>
            </v-tooltip>
            <span class="price-info-value">{{ formatPrice(liveIndexPrice ?? currentFunding?.indexPrice) }}</span>
          </div>
          <div class="price-info-item">
            <v-tooltip bottom content-class="custom-tooltip" max-width="280">
              <template #activator="{ on, attrs }">
                <span class="price-info-label price-info-label--dashed" v-bind="attrs" v-on="on">{{ $t('perpetuals.fundingCountdown') }}</span>
              </template>
              <span>{{ $t('perpetuals.fundingCountdownTooltip') }}</span>
            </v-tooltip>
            <div class="funding-value-row">
              <span class="price-info-value" :class="fundingClass">
                {{ formatFundingRate(liveFundingRate ?? currentFunding?.lastFundingRate) }}
              </span>
              <span class="price-info-countdown">/ {{ fundingCountdown }}</span>
            </div>
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
            <span class="price-info-label">24h Vol({{ baseCurrency }})</span>
            <span class="price-info-value">{{ formatFullNumber(currentTicker.volume) }} {{ baseCurrency }}</span>
          </div>
          <div class="price-info-item">
            <span class="price-info-label">{{ $t('perpetuals.24hVolQuote') }}</span>
            <span class="price-info-value">${{ formatFullNumber(currentTicker.quoteVolume) }}</span>
          </div>
          <div class="price-info-item">
            <v-tooltip bottom content-class="custom-tooltip" max-width="260">
              <template #activator="{ on, attrs }">
                <span class="price-info-label price-info-label--dashed" v-bind="attrs" v-on="on">{{ $t('perpetuals.openInterest') }}</span>
              </template>
              <span>{{ $t('perpetuals.openInterestTooltip') }}</span>
            </v-tooltip>
            <span class="price-info-value">${{ formatFullNumber(openInterest) }}</span>
          </div>
        </template>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           MAIN 3-COLUMN LAYOUT
           ═══════════════════════════════════════════════════════════════════ -->
      <div class="terminal-body">

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
            </div>
            <!-- Chart toolbar (timeframes + price type) -->
            <div class="chart-toolbar">
              <span
                v-for="tf in ['5m', '1h', '1d']"
                :key="tf"
                class="chart-toolbar__tf"
                :class="{ 'chart-toolbar__tf--active': chartTimeframe === tf }"
                @click="chartTimeframe = tf"
              >
                {{ tf }}
              </span>
              <v-menu offset-y :attach="true" content-class="chart-price-menu">
                <template #activator="{ on, attrs }">
                  <span class="chart-toolbar__price-trigger" v-bind="attrs" v-on="on">
                    {{ priceTypeOptions.find(o => o.value === chartPriceType)?.label }}
                    <v-icon size="14" class="ml-1">mdi-chevron-down</v-icon>
                  </span>
                </template>
                <v-list dense dark class="chart-price-list">
                  <v-list-item
                    v-for="opt in priceTypeOptions"
                    :key="opt.value"
                    @click="chartPriceType = opt.value"
                    :class="{ 'chart-price-list__item--active': chartPriceType === opt.value }"
                  >
                    <v-list-item-title>{{ opt.label }}</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </div>
            <TradingViewChart
              :symbol="'ADA/USD'"
              :data="chartData"
              :enable-realtime="true"
              :realtime-data="strikeRealtimeData"
              :candle-interval="candleIntervalSeconds"
              width="100%"
              height="100%"
              theme="dark"
              :price-precision="symbolPrecision"
              :price-min-move="symbolMinMove"
              @chartReady="onChartReady"
            />
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
          <div v-if="obView === 'book'" ref="obContainerRef" class="ob-content">
            <!-- Filter icons + tick size -->
            <div class="ob-filter-row">
              <div class="ob-filter-icons">
                <span
                  class="ob-filter-icon"
                  :class="{ 'ob-filter-icon--active': obFilter === 'both' }"
                  @click="obFilter = 'both'"
                >
                  <span class="ob-filter-bar ob-filter-bar--red" />
                  <span class="ob-filter-bar ob-filter-bar--green" />
                </span>
                <span
                  class="ob-filter-icon"
                  :class="{ 'ob-filter-icon--active': obFilter === 'bids' }"
                  @click="obFilter = 'bids'"
                >
                  <span class="ob-filter-bar ob-filter-bar--green ob-filter-bar--big" />
                </span>
                <span
                  class="ob-filter-icon"
                  :class="{ 'ob-filter-icon--active': obFilter === 'asks' }"
                  @click="obFilter = 'asks'"
                >
                  <span class="ob-filter-bar ob-filter-bar--red ob-filter-bar--big" />
                </span>
              </div>
              <v-menu offset-y left :attach="true" content-class="ob-tick-menu">
                <template #activator="{ on, attrs }">
                  <span class="ob-tick-trigger" v-bind="attrs" v-on="on">
                    {{ obTickSize }}
                    <v-icon size="12" class="ml-1">mdi-chevron-down</v-icon>
                  </span>
                </template>
                <v-list dense dark class="ob-tick-list">
                  <v-list-item
                    v-for="ts in tickSizeOptions"
                    :key="ts"
                    @click="obTickSize = ts"
                    :class="{ 'ob-tick-list__item--active': obTickSize === ts }"
                  >
                    <v-list-item-title>{{ ts }}</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </div>

            <div class="ob-col-headers">
              <span>{{ $t('perpetuals.price') }}(USD)</span>
              <span>{{ $t('perpetuals.size') }}({{ baseAsset }})</span>
              <span>{{ $t('perpetuals.total') }}({{ baseAsset }})</span>
            </div>

            <!-- Asks (red, reversed so lowest ask is at bottom) -->
            <div v-if="obFilter !== 'bids'" class="ob-asks">
              <div
                v-for="(ask, i) in displayAsks"
                :key="'a' + i"
                class="ob-row ob-row--ask"
              >
                <div
                  class="ob-row-bg ob-row-bg--ask"
                  :style="{ width: ask.pct + '%' }"
                />
                <span class="ob-cell ob-price clr-red ob-cell--left">{{ ask.price }}</span>
                <span class="ob-cell ob-cell--center">{{ formatOBSize(ask.size) }}</span>
                <span class="ob-cell ob-cell--right">{{ formatOBSize(ask.total) }}</span>
              </div>
            </div>

            <!-- Spread / mid-price -->
            <div class="ob-spread">
              <span class="ob-spread__price" :class="lastTradeClass">
                {{ formatPrice(liveMarkPrice ?? currentTicker?.lastPrice) }}
                <v-icon size="11" :color="lastTradeClass === 'clr-green' ? '#0ecb81' : '#f6465d'">
                  {{ lastTradeClass === 'clr-green' ? 'mdi-arrow-up-bold' : 'mdi-arrow-down-bold' }}
                </v-icon>
              </span>
              <span class="ob-spread__info">
                Spread: {{ spreadValue }}/{{ spreadPercent }}
              </span>
            </div>

            <!-- Bids (green) -->
            <div v-if="obFilter !== 'asks'" class="ob-bids">
              <div
                v-for="(bid, i) in displayBids"
                :key="'b' + i"
                class="ob-row ob-row--bid"
              >
                <div
                  class="ob-row-bg ob-row-bg--bid"
                  :style="{ width: bid.pct + '%' }"
                />
                <span class="ob-cell ob-price clr-green ob-cell--left">{{ bid.price }}</span>
                <span class="ob-cell ob-cell--center">{{ formatOBSize(bid.size) }}</span>
                <span class="ob-cell ob-cell--right">{{ formatOBSize(bid.total) }}</span>
              </div>
            </div>

            <!-- Buy / Sell ratio bar -->
            <div class="ob-ratio">
              <div class="ob-ratio__bar">
                <div class="ob-ratio__buy" :style="{ width: buyRatioPct + '%' }" />
                <div class="ob-ratio__sell" :style="{ width: (100 - buyRatioPct) + '%' }" />
              </div>
              <div class="ob-ratio__labels">
                <span class="clr-green">B {{ buyRatioPct.toFixed(2) }}%</span>
                <span class="clr-red">{{ (100 - buyRatioPct).toFixed(2) }}% S</span>
              </div>
            </div>
          </div>

          <!-- Recent Trades view -->
          <div v-else class="ob-content">
            <div class="ob-col-headers">
              <span>Price</span>
              <span>Size ({{ baseAsset }})</span>
              <span>Time</span>
            </div>
            <div class="ob-trades-list">
              <div
                v-for="(trade, i) in recentTrades"
                :key="'t' + i"
                class="ob-row"
              >
                <span class="ob-cell ob-price" :class="trade.isBuyerMaker ? 'clr-red' : 'clr-green'">
                  {{ trade.price }}
                </span>
                <span class="ob-cell ob-cell--center">{{ formatOBSize(trade.qty) }}</span>
                <span class="ob-cell ob-cell--right ob-time">{{ formatTradeTime(trade.time) }}</span>
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
              <v-btn x-small outlined class="of-top-btn" @click="pendingMarginMode = marginMode; showMarginDialog = true">
                {{ marginMode === 'cross' ? $t('perpetuals.cross') : $t('perpetuals.isolated') }}
              </v-btn>
              <v-btn x-small outlined class="of-top-btn" @click="pendingLeverage = leverage; showLeverageDialog = true">
                {{ leverage }}x
              </v-btn>
              <v-btn x-small outlined class="of-top-btn" @click="showPosModeDialog = true">
                {{ $t('perpetuals.oneWay') }}
              </v-btn>
            </div>

            <!-- Margin Mode Dialog -->
            <v-dialog v-model="showMarginDialog" max-width="420" dark>
              <v-card class="perps-modal">
                <div class="perps-modal__header">
                  <span class="perps-modal__title">{{ $t('perpetuals.marginMode') }}</span>
                  <v-icon size="20" @click="showMarginDialog = false" class="perps-modal__close">mdi-close</v-icon>
                </div>
                <div class="perps-modal__body">
                  <div
                    class="perps-modal__option"
                    :class="{ 'perps-modal__option--active': pendingMarginMode === 'cross' }"
                    @click="pendingMarginMode = 'cross'"
                  >
                    <v-icon size="20" :color="pendingMarginMode === 'cross' ? '#26FAB0' : '#848e9c'" class="mr-2">
                      {{ pendingMarginMode === 'cross' ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                    </v-icon>
                    <div>
                      <div class="perps-modal__option-title">{{ $t('perpetuals.cross') }}</div>
                      <div class="perps-modal__option-desc">{{ $t('perpetuals.crossDesc') }}</div>
                    </div>
                  </div>
                  <div
                    class="perps-modal__option"
                    :class="{ 'perps-modal__option--active': pendingMarginMode === 'isolated' }"
                    @click="pendingMarginMode = 'isolated'"
                  >
                    <v-icon size="20" :color="pendingMarginMode === 'isolated' ? '#26FAB0' : '#848e9c'" class="mr-2">
                      {{ pendingMarginMode === 'isolated' ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                    </v-icon>
                    <div>
                      <div class="perps-modal__option-title">{{ $t('perpetuals.isolated') }}</div>
                      <div class="perps-modal__option-desc">{{ $t('perpetuals.isolatedDesc') }}</div>
                    </div>
                  </div>
                </div>
                <v-btn block color="#26FAB0" class="perps-modal__confirm" @click="marginMode = pendingMarginMode; showMarginDialog = false; snackbar.fireSuccess(`Margin mode set to ${pendingMarginMode}`)">
                  {{ $t('perpetuals.confirm') }}
                </v-btn>
              </v-card>
            </v-dialog>

            <!-- Leverage Dialog -->
            <v-dialog v-model="showLeverageDialog" max-width="420" dark>
              <v-card class="perps-modal">
                <div class="perps-modal__header">
                  <span class="perps-modal__title">{{ $t('perpetuals.adjustLeverage') }}</span>
                  <v-icon size="20" @click="showLeverageDialog = false" class="perps-modal__close">mdi-close</v-icon>
                </div>
                <div class="perps-modal__body text-center">
                  <div class="leverage-display">{{ pendingLeverage }}x</div>
                  <div class="leverage-max">{{ $t('perpetuals.maxLeverage') }}: 20x</div>
                  <v-slider
                    v-model="pendingLeverage"
                    min="1"
                    max="20"
                    step="1"
                    color="#4efab080"
                    track-color="#ffffff1a"
                    hide-details
                    class="mt-4 custom-slider"
                    ticks="always"
                    tick-size="4"
                  />
                  <div class="d-flex justify-space-between mt-1">
                    <span class="slider-tick">1x</span>
                    <span class="slider-tick">20x</span>
                  </div>
                </div>
                <v-btn block color="#26FAB0" class="perps-modal__confirm" @click="leverage = pendingLeverage; applyLeverage(); showLeverageDialog = false">
                  {{ $t('perpetuals.confirm') }}
                </v-btn>
                <div class="leverage-warning mt-3">
                  {{ $t('perpetuals.leverageWarning') }}
                </div>
                <div class="leverage-max-size mt-2 text-center">
                  {{ $t('perpetuals.maxPositionSize') }}: $5,000
                </div>
              </v-card>
            </v-dialog>

            <!-- Position Mode Dialog -->
            <v-dialog v-model="showPosModeDialog" max-width="420" dark>
              <v-card class="perps-modal">
                <div class="perps-modal__header">
                  <span class="perps-modal__title">{{ $t('perpetuals.positionMode') }}</span>
                  <v-icon size="20" @click="showPosModeDialog = false" class="perps-modal__close">mdi-close</v-icon>
                </div>
                <div class="perps-modal__body">
                  <div class="perps-modal__option perps-modal__option--active">
                    <v-icon size="20" color="#26FAB0" class="mr-2">mdi-checkbox-marked</v-icon>
                    <div>
                      <div class="perps-modal__option-title">{{ $t('perpetuals.oneWay') }}</div>
                      <div class="perps-modal__option-desc">{{ $t('perpetuals.oneWayDesc') }}</div>
                    </div>
                  </div>
                </div>
                <v-btn block color="#26FAB0" class="perps-modal__confirm" @click="showPosModeDialog = false">
                  {{ $t('perpetuals.confirm') }}
                </v-btn>
              </v-card>
            </v-dialog>

            <!-- Order type tabs -->
            <v-tabs
              :value="orderTypes.findIndex(tr => tr.value === orderType)"
              background-color="transparent"
              grow
              color="#eaecef"
              slider-color="#26FAB0"
              height="32"
              class="of-type-tabs"
              @change="(i) => orderType = orderTypes[i].value"
            >
              <v-tab v-for="t in orderTypes" :key="t.value" class="of-type-tab">
                {{ $t(t.label) }}
              </v-tab>
            </v-tabs>

            <!-- Side toggle: Long/Buy — Short/Sell -->
            <v-btn-toggle v-model="orderSide" mandatory dense class="of-side-toggle">
              <v-btn value="buy" class="of-side-btn of-side-btn--buy">
                {{ $t('perpetuals.buyLong') }}
              </v-btn>
              <v-btn value="sell" class="of-side-btn of-side-btn--sell">
                {{ $t('perpetuals.sellShort') }}
              </v-btn>
            </v-btn-toggle>

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
            <div v-if="orderType !== 'market'" class="of-field mb-2">
              <span class="of-field__label">{{ $t('perpetuals.price') }}</span>
              <input v-model="limitPrice" type="number" class="of-field__input"  />
              <span class="of-field__suffix">USD</span>
            </div>

            <!-- Stop price (stop-limit) -->
            <div v-if="orderType === 'stop_limit'" class="of-field mb-2">
              <span class="of-field__label">{{ $t('perpetuals.stopPrice') }}</span>
              <input v-model="stopPrice" type="number" class="of-field__input"  />
              <span class="of-field__suffix">USD</span>
            </div>

            <!-- Size input -->
            <div class="of-field mb-2">
              <input
                :value="formatCurrencyInput(orderSize)"
                @input="onSizeInput"
                type="text"
                inputmode="decimal"
                class="of-field__input"
                :placeholder="t('perpetuals.size')"
              />
              <v-menu offset-y left :attach="true" content-class="of-asset-menu">
                <template #activator="{ on, attrs }">
                  <span class="of-field__asset-trigger" v-bind="attrs" v-on="on">
                    {{ sizeAsset }}
                    <v-icon size="12" class="ml-1">mdi-chevron-down</v-icon>
                  </span>
                </template>
                <v-list dense dark class="of-asset-list">
                  <v-list-item
                    v-for="a in ['USD', baseAsset]"
                    :key="a"
                    @click="sizeAsset = a"
                    :class="{ 'of-asset-list__current-item': sizeAsset === a }"
                  >
                    <v-list-item-title>{{ a }}</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </div>

            <!-- Size slider -->
            <div class="of-slider-row">
              <v-slider
                v-model="_sizePercent"
                min="0"
                max="100"
                step="0.1"
                color="#4efab080"
                track-color="#ffffff1a"
                hide-details
                class="of-slider custom-slider"
              />
              <span class="of-slider-pct-box">{{ _sizePercent.toFixed(1) }}%</span>
            </div>

            <!-- Checkboxes: Reduce Only + TP/SL -->
            <div class="of-checkboxes">
              <v-checkbox
                v-model="reduceOnly"
                :label="$t('perpetuals.reduceOnly')"
                hide-details
                dense
                color="#26FAB0"
                class="of-checkbox"
                :ripple="false"
              />
              <v-checkbox
                v-model="showTpSl"
                :label="$t('perpetuals.tpSl')"
                hide-details
                dense
                color="#26FAB0"
                class="of-checkbox"
                :ripple="false"
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
              :color="(insufficientBalance || belowMinOrder || aboveMaxOrder) ? '#2b2f36' : (orderSide === 'buy' ? '#26FAB0' : '#F6465D')"
              :loading="placingOrder"
              :disabled="!canPlaceOrder"
              @click="placeOrderAction()"
              class="of-place-btn mt-3"
              :style="{ color: (insufficientBalance || belowMinOrder || aboveMaxOrder) ? '#F6465D' : (orderSide === 'buy' ? '#0b0e11' : '#ffffff') }"
            >
              {{ insufficientBalance ? $t('errors.insufficientBalance') : belowMinOrder ? $t('perpetuals.minOrderSize') : aboveMaxOrder ? $t('perpetuals.maxOrderSize') : $t('perpetuals.placeOrder') }}
            </v-btn>

            <v-alert v-if="tradingError" type="error" dense class="mt-2" dismissible @input="tradingError = null">
              {{ tradingError }}
            </v-alert>

            <!-- Order info estimates -->
            <div class="of-estimates mt-3">
              <div class="of-est-row">
                <v-tooltip bottom content-class="custom-tooltip" max-width="220">
                  <template #activator="{ on, attrs }">
                    <span class="price-info-label--dashed" v-bind="attrs" v-on="on">{{ $t('perpetuals.estLiqPrice') }}</span>
                  </template>
                  <span>{{ $t('perpetuals.estLiqPriceTooltip') }}</span>
                </v-tooltip>
                <span class="form-value">{{ estLiquidationPrice }}</span>
              </div>
              <div class="of-est-row">
                <span>{{ $t('perpetuals.margin') }}</span>
                <span class="form-value">{{ estMargin }}</span>
              </div>
              <div class="of-est-row">
                <span>{{ $t('perpetuals.orderValue') }}</span>
                <span class="form-value">{{ notionalValue }}</span>
              </div>
              <div class="of-est-row">
                <v-tooltip bottom content-class="custom-tooltip" max-width="240">
                  <template #activator="{ on, attrs }">
                    <span class="price-info-label--dashed" v-bind="attrs" v-on="on">{{ $t('perpetuals.estFee') }}</span>
                  </template>
                  <span style="white-space: pre-line;">{{ $t('perpetuals.estFeeTooltip') }}</span>
                </v-tooltip>
                <span class="form-value">{{ estFee }}</span>
              </div>
            </div>

          </div>
        </div>

        <!-- Positions area — spans chart + OB columns via grid -->
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
                  x-small text color="#F6465D"
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
              <v-btn x-small text color="#F6465D" :loading="cancellingAll" @click="cancelAllOrdersAction()">
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
                <v-btn x-small text color="#F6465D" :loading="cancellingOrder === item.ID" @click="cancelOrderAction(item)" class="action-btn">
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
              v-else dense
              :headers="orderHistoryHeaders"
              :items="orderHistory"
              class="transparent perps-table"
              :items-per-page="20"
              :footer-props="{ itemsPerPageOptions: [10, 20, 50] }"
            >
              <template v-slot:[`item.side`]="{ item }">
                <span :class="item.side === 'buy' ? 'clr-green' : 'clr-red'" class="fw-600 text-uppercase font-mono">{{ item.side }}</span>
              </template>
              <template v-slot:[`item.created_at`]="{ item }">{{ formatTime(item.created_at) }}</template>
            </v-data-table>
          </v-tab-item>

          <!-- Fill History -->
          <v-tab-item>
            <div v-if="tabLoading[3]" class="tab-loading">
              <v-progress-circular indeterminate color="#26FAB0" size="24" />
            </div>
            <div v-else-if="fillHistory.length === 0" class="empty-state">
              <v-icon size="32" color="#2b2f36">mdi-swap-horizontal</v-icon>
              <p class="mt-1">{{ $t('perpetuals.noFillHistory') }}</p>
            </div>
            <v-data-table
              v-else dense
              :headers="fillHistoryHeaders"
              :items="fillHistory"
              class="transparent perps-table"
              :items-per-page="20"
              :footer-props="{ itemsPerPageOptions: [10, 20, 50] }"
            >
              <template v-slot:[`item.side`]="{ item }">
                <span :class="item.side === 'buy' ? 'clr-green' : 'clr-red'" class="fw-600 text-uppercase font-mono">{{ item.side }}</span>
              </template>
              <template v-slot:[`item.realized_pnl`]="{ item }">
                <span :class="parseFloat(item.realized_pnl) >= 0 ? 'clr-green' : 'clr-red'" class="font-mono">
                  {{ parseFloat(item.realized_pnl) >= 0 ? '+' : '' }}{{ parseFloat(item.realized_pnl).toFixed(4) }}
                </span>
              </template>
              <template v-slot:[`item.time`]="{ item }">{{ formatTime(item.time) }}</template>
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
              v-else dense
              :headers="fundingHistoryHeaders"
              :items="fundingHistory"
              class="transparent perps-table"
              :items-per-page="20"
              :footer-props="{ itemsPerPageOptions: [10, 20, 50] }"
            >
              <template v-slot:[`item.income`]="{ item }">
                <span :class="parseFloat(item.income) >= 0 ? 'clr-green' : 'clr-red'" class="font-mono">
                  {{ parseFloat(item.income) >= 0 ? '+' : '' }}{{ parseFloat(item.income).toFixed(6) }} {{ item.asset }}
                </span>
              </template>
              <template v-slot:[`item.time`]="{ item }">{{ formatTime(item.time) }}</template>
            </v-data-table>
          </v-tab-item>
        </v-tabs-items>
        </div>
        <!-- end positions-area -->

        <!-- Account section — below order form, right of positions -->
        <div class="col-account">
          <div class="of-deposit-row">
            <v-btn small outlined class="of-deposit-btn" color="#26FAB0">
              {{ $t('perpetuals.deposit') }}
            </v-btn>
            <v-btn small outlined class="of-deposit-btn" color="#848e9c">
              {{ $t('perpetuals.withdraw') }}
            </v-btn>
          </div>

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
              <span>{{ $t('perpetuals.withdrawableBalance') }}</span>
              <span class="form-value">${{ formatBalance(account?.available_balance) }}</span>
            </div>
            <div class="of-account-row">
              <span>{{ $t('perpetuals.positionValue') }}</span>
              <span class="form-value">${{ formatBalance(account?.total_margin) }}</span>
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
      <!-- end terminal-body -->

      <!-- Footer -->
      <div class="terminal-footer">
        <span class="powered-by">{{ $t('common.poweredBy') }}</span>
        <img
          src="https://app.strikefinance.org/logo.svg"
          alt="Strike Finance"
          class="strike-logo"
          @error="onLogoError"
        />
        <span class="footer-spacer" />
        <a href="https://docs.strikefinance.org/" target="_blank" rel="noopener" class="footer-link">Docs</a>
        <a href="mailto:shan@strikefinance.org" class="footer-link">Support</a>
      </div>

    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { IChartApi, Time } from 'lightweight-charts';
import { useStrikeMarket } from '@/modules/market/composables/useStrikeMarket';
import { useStrikeTrading } from '@/modules/market/composables/useStrikeTrading';
import { useStrikeMarketWs } from '@/modules/market/composables/useStrikeMarketWs';
import { useStrikeOnboarding } from '@/modules/market/composables/useStrikeOnboarding';
import { walletStore } from '@/stores/walletStore';
import { strikeMarketApi } from '@/api/strike-v2.market';
import { strikeUserApi } from '@/api/strike-v2.user';
import { strikeTradeApi } from '@/api/strike-v2.trade';
import type {
  CreateOrderRequest,
  FillHistoryResult,
  FundingHistoryResult,
  MarginMode,
  Order,
  OrderHistoryResult,
  Position,
  TradeResponse,
} from '@/api/strike-v2.types';
import snackbar from '@/plugins/snackbar';
import TradingViewChart from '@/shared/components/TradingViewChart.vue';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

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

const { symbolNames, tickers, fundingRates, loading: marketLoading } = useStrikeMarket();
// For Cardano wallets, default to ADA-USD. BTC-USD is for future Bitcoin wallet support.
const selectedSymbol = ref<string>('ADA-USD');
const baseCurrency = computed(() => selectedSymbol.value.split('-')[0]);
const openInterest = ref<string>('');

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
  const rate = parseFloat(liveFundingRate.value ?? currentFunding.value?.lastFundingRate ?? '0');
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
  const nextTime = liveNextFundingTime.value ?? currentFunding.value?.nextFundingTime;
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
  error: _tradingErrorRef,
  loadAccount,
  loadOpenOrders,
  loadPositions,
  cancelOrder,
  cancelAllOrders,
  setLeverage: apiSetLeverage,
  setMarginMode: _apiSetMarginMode,
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

interface CandlestickDataPoint {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

const chartData = ref<CandlestickDataPoint[]>([]);
const chartTimeframe = ref('5m');
const chartPriceType = ref<'mark' | 'index' | 'last'>('mark');
const priceTypeOptions: { value: 'mark' | 'index' | 'last'; label: string }[] = [
  { label: 'Mark Price', value: 'mark' },
  { label: 'Index Price', value: 'index' },
  { label: 'Last Traded Price', value: 'last' },
];

// Live price updates from Strike mark price WebSocket
const strikeRealtimeData = ref<{ lastPrice: number } | null>(null);
const liveMarkPrice = ref<string | null>(null);
const liveIndexPrice = ref<string | null>(null);
const liveFundingRate = ref<string | null>(null);
const liveNextFundingTime = ref<number | null>(null);
const markPriceFlash = ref<'up' | 'down' | null>(null);
let markPriceFlashTimer: ReturnType<typeof setTimeout> | null = null;
const candleIntervalSeconds = computed(() => {
  const map: Record<string, number> = { '5m': 300, '1h': 3600, '1d': 86400 };
  return map[chartTimeframe.value] ?? 300;
});
const chartLoading = ref(false);
let _chartInstance: IChartApi | null = null;

const symbolPrecision = computed(() => {
  // ADA has 4-6 decimal places for price
  return selectedSymbol.value.startsWith('ADA') ? 5 : 2;
});

const symbolMinMove = computed(() => {
  return 1 / Math.pow(10, symbolPrecision.value);
});

function onChartReady(chart: IChartApi) {
  _chartInstance = chart;
}

async function loadChartData() {
  chartLoading.value = true;
  try {
    const now = Date.now();
    const intervalMs: Record<string, number> = { '5m': 300_000, '1h': 3_600_000, '1d': 86_400_000 };
    const ms = intervalMs[chartTimeframe.value] ?? 3_600_000;
    const startTime = now - ms * 500;

    const klines = await strikeMarketApi.getKlines({
      symbol: selectedSymbol.value,
      interval: chartTimeframe.value,
      priceType: chartPriceType.value,
      limit: 500,
      startTime,
      endTime: now,
    });

    // Strike klines returns arrays: [openTime, open, high, low, close, volume, closeTime, ...]
    chartData.value = klines.map((k: any) => {
      const row = Array.isArray(k) ? k : k;
      if (Array.isArray(row)) {
        return {
          time: Math.floor(Number(row[0]) / 1000) as any,
          open: parseFloat(row[1]),
          high: parseFloat(row[2]),
          low: parseFloat(row[3]),
          close: parseFloat(row[4]),
          volume: parseFloat(row[5]),
        };
      }
      return {
        time: Math.floor(k.openTime / 1000) as any,
        open: parseFloat(k.open),
        high: parseFloat(k.high),
        low: parseFloat(k.low),
        close: parseFloat(k.close),
        volume: parseFloat(k.volume),
      };
    });
  } catch (e) {
    console.warn('[Perps] Failed to load chart data:', e);
  } finally {
    chartLoading.value = false;
  }
}

// Reload chart when timeframe or price type changes
watch(chartTimeframe, () => loadChartData());
watch(chartPriceType, () => loadChartData());

async function loadOpenInterest() {
  try {
    const res = await strikeMarketApi.getOpenInterest(selectedSymbol.value) as { openInterest: string };
    openInterest.value = res.openInterest;
  } catch {
    openInterest.value = '';
  }
}

// ---------------------------------------------------------------------------
// WebSocket — order book + trades
// ---------------------------------------------------------------------------

const { subscribeDepth, subscribeTrades, subscribeMarkPrice, connected: wsConnected } = useStrikeMarketWs();

interface OBLevel { price: string; size: string; total: string; pct: number; }

const obAsks = ref<[string, string][]>([]);
const obBids = ref<[string, string][]>([]);
const recentTrades = ref<TradeResponse[]>([]);
const obView = ref<'book' | 'trades'>('book');
const obFilter = ref<'both' | 'bids' | 'asks'>('both');
const obTickSize = ref('0.00001');
const tickSizeOptions = ['0.00001', '0.00005', '0.0001', '0.0005', '0.001'];

const obContainerRef = ref<HTMLElement | null>(null);
const obRowHeight = 20; // px per row
const obContainerHeight = ref(0);

let obResizeObserver: ResizeObserver | null = null;

watch(obContainerRef, (el, _, onCleanup) => {
  if (!el) return;
  const update = () => { obContainerHeight.value = el.clientHeight; };
  update();
  obResizeObserver = new ResizeObserver(update);
  obResizeObserver.observe(el);
  onCleanup(() => { obResizeObserver?.disconnect(); obResizeObserver = null; });
}, { immediate: true });

const obDepth = computed(() => {
  const fixedHeader = 30 + 24; // filter row + col headers
  const fixedSpread = 32; // spread row always visible
  const fixedRatio = 36;
  const available = obContainerHeight.value - fixedHeader - fixedSpread - fixedRatio;
  const sides = obFilter.value === 'both' ? 2 : 1;
  const perSide = Math.floor(available / sides / obRowHeight);
  return Math.max(4, Math.min(perSide, 50));
});

function formatCurrencyInput(val: string): string {
  if (!val) return '';
  const parts = val.split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.length > 1 ? `${intPart}.${parts[1]}` : intPart;
}

function parseCurrencyInput(val: string): string {
  const cleaned = val.replace(/,/g, '').replace(/[^\d.]/g, '');
  // Allow only one decimal point
  const parts = cleaned.split('.');
  if (parts.length > 2) return parts[0] + '.' + parts.slice(1).join('');
  return cleaned;
}

function onSizeInput(e: Event) {
  orderSize.value = parseCurrencyInput((e.target as HTMLInputElement).value);
}

function formatOBSize(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

let unsubDepth: (() => void) | null = null;
let unsubTrades: (() => void) | null = null;
let unsubMarkPrice: (() => void) | null = null;
let obBuffer: Array<{ u: bigint; a?: [string, string][]; b?: [string, string][] }> = [];
let obSnapshotReady = false;

// Internal maps for fast merge — only convert to sorted arrays on read
const askMap = new Map<string, string>();
const bidMap = new Map<string, string>();

const OB_MAX_LEVELS = 100;

function applyUpdates(side: 'ask' | 'bid', updates: [string, string][]) {
  const map = side === 'ask' ? askMap : bidMap;
  for (const [p, q] of updates) {
    if (parseFloat(q) === 0) map.delete(p);
    else map.set(p, q);
  }
  // Convert to sorted array for Vue reactivity
  let entries: [string, string][] = Array.from(map.entries());
  entries.sort((a, b) => {
    const diff = parseFloat(a[0]) - parseFloat(b[0]);
    return side === 'ask' ? diff : -diff;
  });
  // Cap to nearest OB_MAX_LEVELS — discard far-from-market levels
  if (entries.length > OB_MAX_LEVELS) {
    const removed = entries.slice(OB_MAX_LEVELS);
    entries = entries.slice(0, OB_MAX_LEVELS);
    for (const [p] of removed) map.delete(p);
  }
  if (side === 'ask') obAsks.value = entries;
  else obBids.value = entries;
}

function subscribeSymbolWs(symbol: string) {
  // Clean up previous
  if (unsubDepth) { unsubDepth(); unsubDepth = null; }
  if (unsubTrades) { unsubTrades(); unsubTrades = null; }
  if (unsubMarkPrice) { unsubMarkPrice(); unsubMarkPrice = null; }
  obAsks.value = [];
  obBids.value = [];
  recentTrades.value = [];
  askMap.clear();
  bidMap.clear();
  obBuffer = [];
  obSnapshotReady = false;

  // 1. Subscribe to WS depth first (buffer events until snapshot arrives)
  unsubDepth = subscribeDepth(symbol, (data: unknown) => {
    const raw = data as { u?: number | string; a?: [string, string][]; b?: [string, string][] };

    if (!obSnapshotReady) {
      obBuffer.push({ u: BigInt(raw.u ?? 0), a: raw.a, b: raw.b });
      return;
    }

    if (raw.a) applyUpdates('ask', raw.a);
    if (raw.b) applyUpdates('bid', raw.b);
  });

  // 2. Fetch initial snapshot (100 levels per side — matches Strike's depth)
  strikeMarketApi.getOrderBook(symbol, 100).then((snap) => {
    const snapId = BigInt((snap as Record<string, unknown>).lastUpdateId as number ?? 0);

    // Populate maps from snapshot
    for (const [p, q] of (snap.asks ?? [])) askMap.set(p, q);
    for (const [p, q] of (snap.bids ?? [])) bidMap.set(p, q);

    // Apply buffered WS events after snapshot
    for (const evt of obBuffer) {
      if (evt.u <= snapId) continue;
      if (evt.a) for (const [p, q] of evt.a) { if (parseFloat(q) === 0) askMap.delete(p); else askMap.set(p, q); }
      if (evt.b) for (const [p, q] of evt.b) { if (parseFloat(q) === 0) bidMap.delete(p); else bidMap.set(p, q); }
    }
    obBuffer = [];

    // Trigger Vue reactivity once
    applyUpdates('ask', []);
    applyUpdates('bid', []);
    obSnapshotReady = true;
  }).catch(() => { obSnapshotReady = true; });

  // Fetch initial recent trades
  strikeMarketApi.getRecentTrades(symbol, 50).then((trades) => {
    // Sort newest first
    recentTrades.value = trades.sort((a, b) => b.time - a.time);
  }).catch(() => {});

  // WS trades — prepend new trades in real-time
  unsubTrades = subscribeTrades(symbol, (data: unknown) => {
    const t = data as TradeResponse;
    if (t && t.price) {
      recentTrades.value = [t, ...recentTrades.value].slice(0, 50);
    }
  });

  // WS mark price → feed chart realtime + live mark/index price display
  // Event: { e: "markPriceUpdate", p: markPrice, i: indexPrice, r: fundingRate, ... }
  unsubMarkPrice = subscribeMarkPrice(symbol, (data: unknown) => {
    const d = data as { p?: string; i?: string; r?: string; T?: number };
    const markStr = d.p ?? '';
    const mark = parseFloat(markStr);
    if (mark > 0) {
      // Flash direction
      const prev = strikeRealtimeData.value?.lastPrice;
      if (prev != null && mark !== prev) {
        markPriceFlash.value = mark > prev ? 'up' : 'down';
        if (markPriceFlashTimer) clearTimeout(markPriceFlashTimer);
        markPriceFlashTimer = setTimeout(() => { markPriceFlash.value = null; }, 300);
      }
      liveMarkPrice.value = markStr;
      strikeRealtimeData.value = { lastPrice: mark };
    }
    if (d.i) liveIndexPrice.value = d.i;
    if (d.r) liveFundingRate.value = d.r;
    if (d.T) liveNextFundingTime.value = d.T;
  });
}



const tickDecimals = computed(() => obTickSize.value.split('.')[1]?.length ?? 5);

function aggregateByTick(levels: [string, string][], side: 'ask' | 'bid', displayDepth: number): [string, string][] {
  const tick = parseFloat(obTickSize.value);
  const dec = tickDecimals.value;
  if (tick <= 0) return levels.slice(0, displayDepth);
  const map = new Map<string, number>();
  // Process raw levels until we have enough distinct buckets for the display
  for (const [p, q] of levels) {
    const price = parseFloat(p);
    const bucketed = Math.floor(price / tick) * tick;
    const key = (Math.round(bucketed * Math.pow(10, dec)) / Math.pow(10, dec)).toFixed(dec);
    map.set(key, (map.get(key) ?? 0) + parseFloat(q));
    // Stop once we have enough buckets — +1 so slice later trims cleanly
    if (map.size > displayDepth) break;
  }
  const entries: [string, string][] = Array.from(map.entries()).map(([p, q]) => [p, String(Math.round(q))]);
  entries.sort((a, b) => {
    const diff = parseFloat(a[0]) - parseFloat(b[0]);
    return side === 'ask' ? diff : -diff;
  });
  return entries.slice(0, displayDepth);
}

// Midpoint bucket: aggregated asks must be strictly above this, bids strictly below
const midBucket = computed(() => {
  const tick = parseFloat(obTickSize.value);
  const dec = tickDecimals.value;
  const bestAsk = obAsks.value.length > 0 ? parseFloat(obAsks.value[0][0]) : 0;
  const bestBid = obBids.value.length > 0 ? parseFloat(obBids.value[0][0]) : 0;
  const mid = (bestAsk + bestBid) / 2;
  const bucketed = Math.floor(mid / tick) * tick;
  return Math.round(bucketed * Math.pow(10, dec)) / Math.pow(10, dec);
});

const displayAsks = computed<OBLevel[]>(() => {
  const aggregated = aggregateByTick(obAsks.value, 'ask', obDepth.value + 5);
  // Remove buckets at or below the mid bucket
  const clean = aggregated.filter(([p]) => parseFloat(p) > midBucket.value);
  const sliced = clean.slice(0, obDepth.value);
  let cumTotal = 0;
  const levels = sliced.map(([p, q]) => {
    cumTotal += parseFloat(q);
    return { price: p, size: q, total: String(Math.round(cumTotal)), cumTotal };
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
  const aggregated = aggregateByTick(obBids.value, 'bid', obDepth.value + 5);
  // Remove buckets at or above the mid bucket
  const clean = aggregated.filter(([p]) => parseFloat(p) < midBucket.value);
  const sliced = clean.slice(0, obDepth.value);
  let cumTotal = 0;
  const levels = sliced.map(([p, q]) => {
    cumTotal += parseFloat(q);
    return { price: p, size: q, total: String(Math.round(cumTotal)), cumTotal };
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
  const spread = Math.abs(bestAsk - bestBid);
  return spread.toFixed(tickDecimals.value);
});

const spreadPercent = computed(() => {
  if (obAsks.value.length === 0 || obBids.value.length === 0) return '—';
  const bestAsk = parseFloat(obAsks.value[0][0]);
  const bestBid = parseFloat(obBids.value[0][0]);
  const mid = (bestAsk + bestBid) / 2;
  if (mid === 0) return '0%';
  return (Math.abs(bestAsk - bestBid) / mid * 100).toFixed(3) + '%';
});

const buyRatioPct = computed(() => {
  const bidVol = obBids.value.slice(0, obDepth.value).reduce((s, [, q]) => s + parseFloat(q), 0);
  const askVol = obAsks.value.slice(0, obDepth.value).reduce((s, [, q]) => s + parseFloat(q), 0);
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

// Re-fetch snapshot when tick size changes (reset accumulated WS density)
watch(obTickSize, () => refreshOBSnapshot());

function refreshOBSnapshot() {
  askMap.clear();
  bidMap.clear();
  strikeMarketApi.getOrderBook(selectedSymbol.value, 100).then((snap) => {
    for (const [p, q] of (snap.asks ?? [])) askMap.set(p, q);
    for (const [p, q] of (snap.bids ?? [])) bidMap.set(p, q);
    applyUpdates('ask', []);
    applyUpdates('bid', []);
  }).catch(() => {});
}

onBeforeUnmount(() => {
  if (unsubDepth) unsubDepth();
  if (unsubTrades) unsubTrades();
  if (unsubMarkPrice) unsubMarkPrice();
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
const _sizePercent = ref(0);

// Available ADA balance from wallet (controlled_amount is in lovelace)
const walletAdaBalance = computed(() => {
  const lovelace = parseFloat(walletStore.account?.controlled_amount ?? '0');
  return lovelace / 1_000_000;
});

// Available balance in ADA for the slider
const availableBalanceAda = computed(() => {
  // Use Strike account balance if connected, otherwise wallet ADA balance
  const strikeBal = parseFloat(account.value?.available_balance ?? '0');
  const bal = strikeBal > 0 ? strikeBal : walletAdaBalance.value;
  return bal;
});

// Convert available balance to selected asset
const availableBalanceInAsset = computed(() => {
  if (sizeAsset.value === 'USD') {
    const mark = strikeRealtimeData.value?.lastPrice ?? 0;
    return availableBalanceAda.value * mark;
  }
  return availableBalanceAda.value;
});

let _syncingFromSlider = false;
let _syncingFromInput = false;

// Slider → orderSize
watch(_sizePercent, (pct) => {
  if (_syncingFromInput) return;
  _syncingFromSlider = true;
  const total = availableBalanceInAsset.value;
  if (total > 0) {
    const size = (pct / 100) * total;
    orderSize.value = size > 0 ? size.toFixed(2) : '';
  }
  nextTick(() => { _syncingFromSlider = false; });
});

// orderSize → slider
watch(orderSize, (val) => {
  if (_syncingFromSlider) return;
  _syncingFromInput = true;
  const total = availableBalanceInAsset.value;
  if (total > 0) {
    const size = parseFloat(val) || 0;
    _sizePercent.value = Math.min((size / total) * 100, 100);
  }
  nextTick(() => { _syncingFromInput = false; });
});
const reduceOnly = ref(false);
const showTpSl = ref(false);
const showMarginDialog = ref(false);
const showLeverageDialog = ref(false);
const showPosModeDialog = ref(false);
const pendingMarginMode = ref<MarginMode>('cross');
const pendingLeverage = ref(20);
const takeProfitPrice = ref<string>('');
const stopLossPrice = ref<string>('');
const placingOrder = ref(false);

// Update sizeAsset when symbol changes
watch(baseAsset, (v) => { sizeAsset.value = v; });

// Entry price for estimates: mark price for market orders, limit price for limit orders
const estEntryPrice = computed(() => {
  if (orderType.value === 'market') {
    return strikeRealtimeData.value?.lastPrice ?? parseFloat(currentTicker.value?.lastPrice ?? '0');
  }
  return parseFloat(limitPrice.value || '0');
});

const notionalValue = computed(() => {
  const size = parseFloat(orderSize.value);
  const price = estEntryPrice.value;
  if (!size || !price) return '—';
  return `$${(size * price).toFixed(2)}`;
});

// Margin = notional / leverage
const estMargin = computed(() => {
  const size = parseFloat(orderSize.value);
  const price = estEntryPrice.value;
  if (!size || !price) return '—';
  const notional = size * price;
  return `$${(notional / leverage.value).toFixed(2)}`;
});

// Estimated fee = notional × taker fee rate (0.1%)
const TAKER_FEE_RATE = 0.001;
const estFee = computed(() => {
  const size = parseFloat(orderSize.value);
  const price = estEntryPrice.value;
  if (!size || !price) return '—';
  return `$${(size * price * TAKER_FEE_RATE).toFixed(2)}`;
});

// Est. liquidation price (simplified)
// Long: entryPrice × (1 - 1/leverage + maintenanceMarginRate)
// Short: entryPrice × (1 + 1/leverage - maintenanceMarginRate)
const MAINTENANCE_MARGIN_RATE = 0.005; // 0.5%
const estLiquidationPrice = computed(() => {
  const size = parseFloat(orderSize.value);
  const price = estEntryPrice.value;
  if (!size || !price) return '—';
  const liq = orderSide.value === 'buy'
    ? price * (1 - 1 / leverage.value + MAINTENANCE_MARGIN_RATE)
    : price * (1 + 1 / leverage.value - MAINTENANCE_MARGIN_RATE);
  return liq.toFixed(5);
});

const MIN_ORDER_USD = 10;
const MAX_ORDER_USD = 100_000;

const orderValueUsd = computed(() => {
  const size = parseFloat(orderSize.value) || 0;
  if (size <= 0) return 0;
  if (sizeAsset.value === 'USD') return size;
  const mark = strikeRealtimeData.value?.lastPrice ?? 0;
  return size * mark;
});

const insufficientBalance = computed(() => {
  const size = parseFloat(orderSize.value);
  if (!size || size <= 0) return false;
  return size > availableBalanceInAsset.value;
});

const belowMinOrder = computed(() => {
  const size = parseFloat(orderSize.value);
  if (!size || size <= 0) return false;
  return orderValueUsd.value < MIN_ORDER_USD;
});

const aboveMaxOrder = computed(() => {
  const size = parseFloat(orderSize.value);
  if (!size || size <= 0) return false;
  return orderValueUsd.value > MAX_ORDER_USD;
});

const canPlaceOrder = computed(() => {
  const size = parseFloat(orderSize.value);
  if (!size || size <= 0) return false;
  if (insufficientBalance.value) return false;
  if (belowMinOrder.value) return false;
  if (aboveMaxOrder.value) return false;
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
    snackbar.fireSuccess(`Leverage set to ${leverage.value}x`);
  } catch (e) {
    snackbar.setError(e instanceof Error ? e.message : String(e));
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

    snackbar.fireSuccess(`Order placed: ${order.ID ?? order.ClientOrderID}`);
    orderSize.value = '';
    limitPrice.value = '';
    stopPrice.value = '';
    takeProfitPrice.value = '';
    stopLossPrice.value = '';
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
    snackbar.fireSuccess('Position closed');
    await loadPositions(selectedSymbol.value);
  } catch (e) {
    snackbar.setError(e instanceof Error ? e.message : String(e));
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
    snackbar.fireSuccess('Order cancelled');
  } catch (e) {
    snackbar.setError(e instanceof Error ? e.message : String(e));
  } finally {
    cancellingOrder.value = null;
  }
}

async function cancelAllOrdersAction() {
  cancellingAll.value = true;
  try {
    await cancelAllOrders(selectedSymbol.value);
    snackbar.fireSuccess('All orders cancelled');
  } catch (e) {
    snackbar.setError(e instanceof Error ? e.message : String(e));
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
    snackbar.setError(e instanceof Error ? e.message : String(e));
  } finally {
    tabLoading.value[tab] = false;
  }
}

watch(selectedSymbol, () => {
  tabLoaded.value = { 0: false, 1: false, 2: false, 3: false, 4: false };
  onTabChange(activeTab.value);
  loadChartData();
  loadOpenInterest();
});

watch(dialogVisible, async (open) => {
  if (open) {
    // Load chart candles + open interest from Strike API (public, no auth needed)
    loadChartData();
    loadOpenInterest();
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
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

function formatFullNumber(val: string | number | undefined): string {
  if (val === undefined || val === null || val === '') return '—';
  const n = parseFloat(String(val));
  if (isNaN(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

.symbol-pair {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 4px 0;
}

.symbol-pair__icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.symbol-pair__name {
  font-size: 16px;
  font-weight: 700;
  color: #eaecef;
  letter-spacing: 0.3px;
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

.price-info-label--dashed {
  text-decoration: underline dotted #848e9c;
  text-underline-offset: 2px;
  cursor: pointer;
}

.price-info-value {
  font-size: 12px;
  font-weight: 600;
  color: #eaecef;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  line-height: 1.3;
  transition: color 0.15s ease;
}

.price-flash-up {
  color: #0ecb81 !important;
}

.price-flash-down {
  color: #f6465d !important;
}

.funding-value-row {
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.price-info-countdown {
  font-size: 11px;
  color: #eaecef;
  font-weight: 600;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  line-height: 1.3;
}

/* ── Main 3-column body ──────────────────────────────────────────────── */

.terminal-body {
  display: grid;
  grid-template-rows: 1fr auto;
  flex: 1;
  overflow: hidden;
}

/* Left column: chart */
.col-left {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #2b2f36;
  min-width: 0;
  overflow: hidden;
}

/* Center column: order book */
.col-center {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #2b2f36;
  min-width: 210px;
  overflow: hidden;
}

/* Right column: order form — row 1 only */
.col-right {
  grid-column: 3;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  max-width: 230px;
  overflow-y: auto;
}

/* Account section — below order form, right of positions */
.col-account {
  grid-column: 3;
  grid-row: 2;
  display: flex;
  flex-direction: column;
  padding: 10px;
  border-top: 1px solid #2b2f36;
  overflow-y: auto;
  max-width: 230px;
}

/* ── Chart area ───────────────────────────────────────────────────────── */

.chart-area {
  flex: 1;
  display: flex;
  flex-direction: column;
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

/* ── Chart toolbar ────────────────────────────────────────────────────── */

.chart-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  flex-shrink: 0;
}

.chart-toolbar__tf {
  font-size: 12px;
  font-weight: 600;
  color: #848e9c;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: color 0.15s;
}

.chart-toolbar__tf:hover {
  color: #eaecef;
}

.chart-toolbar__tf--active {
  color: #eaecef;
  background: rgba(255, 255, 255, 0.08);
}

.chart-toolbar__price-trigger {
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  color: #eaecef;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
  margin-left: 8px;
}

.chart-toolbar__price-trigger:hover {
  background: rgba(255, 255, 255, 0.06);
}

.chart-toolbar__price-trigger .v-icon {
  color: #848e9c !important;
}

.chart-price-menu {
  min-width: 160px !important;
}

.chart-price-list {
  background: #1b1d23 !important;
  padding: 4px 0 !important;
}

.chart-price-list .v-list-item {
  min-height: 32px !important;
}

.chart-price-list .v-list-item__title {
  font-size: 12px !important;
  font-weight: 500;
  color: #eaecef;
}

.chart-price-list__item--active .v-list-item__title {
  color: #26FAB0;
  font-weight: 600;
}

.chart-area >>> .trading-view-chart-container {
  flex: 1;
  min-height: 300px;
  background: transparent;
}

/* ── Positions area ───────────────────────────────────────────────────── */

.positions-area {
  grid-column: 1 / 3;
  grid-row: 2;
  min-height: 180px;
  max-height: 300px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-top: 1px solid #2b2f36;
  border-right: 1px solid #2b2f36;
}

.positions-area >>> .v-tabs {
  flex: 0 0 auto;
}

.positions-tabs-items {
  overflow-y: auto;
  flex: 1;
}

/* ── Order Book ───────────────────────────────────────────────────────── */

.ob-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-bottom: 1px solid #2b2f36;
  flex-shrink: 0;
  height: 31.5px;
}

.ob-filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  flex-shrink: 0;
}

.ob-filter-icons {
  display: flex;
  gap: 6px;
}

.ob-filter-icon {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 3px 4px;
  border-radius: 3px;
  cursor: pointer;
  opacity: 0.5;
}

.ob-filter-icon--active {
  opacity: 1;
  background: rgba(255, 255, 255, 0.06);
}

.ob-filter-bar {
  display: block;
  width: 14px;
  height: 3px;
  border-radius: 1px;
}

.ob-filter-bar--green { background: #0ecb81; }
.ob-filter-bar--red { background: #f6465d; }
.ob-filter-bar--big { height: 8px; }

.ob-tick-trigger {
  display: flex;
  align-items: center;
  font-size: 11px;
  font-weight: 500;
  color: #eaecef;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
}

.ob-tick-trigger:hover {
  background: rgba(255, 255, 255, 0.06);
}

.ob-tick-trigger .v-icon {
  color: #848e9c !important;
}

.ob-tick-menu {
  min-width: 100px !important;
}

.ob-tick-list {
  background: #1b1d23 !important;
  padding: 4px 0 !important;
}

.ob-tick-list .v-list-item {
  min-height: 28px !important;
}

.ob-tick-list .v-list-item__title {
  font-size: 11px !important;
  font-weight: 500;
  color: #eaecef;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.ob-tick-list__item--active .v-list-item__title {
  color: #26FAB0;
  font-weight: 600;
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
  font-size: 9px;
  color: #5e6673;
  border-bottom: 1px solid #1b1d23;
}

.ob-asks, .ob-bids {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ob-trades-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.ob-asks {
  justify-content: flex-end;
}

.ob-row {
  display: flex;
  justify-content: space-between;
  padding: 1px 8px;
  position: relative;
  line-height: 18px;
  transition: background-color 0.15s ease-out;
}

.ob-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.ob-row-bg {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  pointer-events: none;
  transition: width 0.2s ease-out;
}

.ob-row-bg--ask {
  background: linear-gradient(to left, rgba(246, 70, 93, 0.20), rgba(246, 70, 93, 0.05));
}

.ob-row-bg--bid {
  background: linear-gradient(to left, rgba(14, 203, 129, 0.20), rgba(14, 203, 129, 0.05));
}

@media (prefers-reduced-motion: reduce) {
  .ob-row-bg {
    transition: none;
  }
}

.ob-cell {
  position: relative;
  z-index: 1;
  color: #eaecef;
  min-width: 0;
  flex: 1;
  text-align: right;
}
.ob-cell:first-child { text-align: left; }
.ob-cell.ob-cell--left { text-align: left; }
.ob-cell.ob-cell--center { text-align: center; }
.ob-cell.ob-cell--right { text-align: right; }

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
  font-size: 13px;
  font-weight: 700;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.ob-spread__info {
  font-size: 9px;
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

.of-top-btn {
  flex: 1;
  font-size: 11px !important;
  font-weight: 600 !important;
  text-transform: none !important;
  border-color: #2b2f36 !important;
  color: #eaecef !important;
  letter-spacing: 0 !important;
}

/* ── Perps modal dialogs ──────────────────────────────────────────────── */

.perps-modal {
  background: #1b1d23 !important;
  border-radius: 12px !important;
  padding: 20px !important;
  border: 1px solid #2b2f36;
}

.perps-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.perps-modal__title {
  font-size: 18px;
  font-weight: 700;
  color: #eaecef;
}

.perps-modal__close {
  color: #848e9c !important;
  cursor: pointer;
}

.perps-modal__body {
  margin-bottom: 16px;
}

.perps-modal__option {
  display: flex;
  align-items: flex-start;
  padding: 14px;
  border: 1px solid #2b2f36;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 10px;
  transition: border-color 0.15s ease-out;
}

.perps-modal__option:hover {
  border-color: #3b3f46;
}

.perps-modal__option--active {
  border-color: #26FAB0;
}

.perps-modal__option-title {
  font-size: 14px;
  font-weight: 600;
  color: #eaecef;
  margin-bottom: 4px;
}

.perps-modal__option-desc {
  font-size: 12px;
  color: #848e9c;
  line-height: 1.5;
}

.perps-modal__confirm {
  color: #0b0e11 !important;
  font-weight: 700 !important;
  text-transform: none !important;
  border-radius: 8px !important;
  height: 44px !important;
}

.leverage-display {
  font-size: 36px;
  font-weight: 700;
  color: #26FAB0;
  margin-top: 8px;
}

.leverage-max {
  font-size: 12px;
  color: #848e9c;
  margin-top: 4px;
}

.leverage-warning {
  background: rgba(246, 190, 66, 0.08);
  border: 1px solid rgba(246, 190, 66, 0.25);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
  color: #F6BE42;
  line-height: 1.5;
}

.leverage-max-size {
  font-size: 12px;
  color: #848e9c;
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
  margin-bottom: 8px;
}

.of-type-tab {
  font-size: 11px !important;
  font-weight: 500 !important;
  text-transform: none !important;
  letter-spacing: 0 !important;
  min-width: auto !important;
  padding: 0 12px !important;
}

/* Side toggle */
.of-side-toggle {
  width: 100%;
  margin-bottom: 10px;
  border-radius: 4px !important;
  overflow: hidden;
}

.of-side-btn {
  flex: 1 !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  text-transform: none !important;
  letter-spacing: 0 !important;
  height: 32px !important;
  border: none !important;
  opacity: 1 !important;
}

.of-side-btn--buy {
  background: rgba(38, 250, 176, 0.15) !important;
  color: #26FAB0 !important;
}
.of-side-btn--buy.v-btn--active {
  background: #26FAB0 !important;
  color: #0b0e11 !important;
}

.of-side-btn--sell {
  background: rgba(246, 70, 93, 0.15) !important;
  color: #F6465D !important;
}
.of-side-btn--sell.v-btn--active {
  background: #F6465D !important;
  color: #ffffff !important;
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

/* Custom field */
.of-field {
  display: flex;
  align-items: center;
  border: 1px solid #2b2f36;
  border-radius: 4px;
  padding: 0 6px 0 10px;
  height: 36px;
  background: transparent;
  transition: border-color 0.15s ease-out;
}

.of-field:focus-within {
  border-color: #26FAB0;
}

.of-field__label {
  font-size: 11px;
  color: #848e9c;
  white-space: nowrap;
  margin-right: 8px;
}

.of-field__input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 12px;
  color: #eaecef;
  min-width: 0;
  text-align: left;
}

/* Hide number input spinners */
.of-field__input::-webkit-outer-spin-button,
.of-field__input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.of-field__suffix {
  font-size: 12px;
  color: #848e9c;
  margin-left: 8px;
  white-space: nowrap;
}

.of-field__divider {
  width: 1px;
  height: 18px;
  background: #2b2f36;
  margin: 0 4px;
  flex-shrink: 0;
}

.of-field__asset-trigger {
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  color: #eaecef;
  cursor: pointer;
  padding: 2px 2px;
  border-radius: 3px;
  white-space: nowrap;
}

.of-field__asset-trigger:hover {
  background: rgba(255, 255, 255, 0.06);
}

.of-field__asset-trigger .v-icon {
  color: #848e9c !important;
}

.of-asset-menu {
  border: 1px solid #2b2f36;
  border-radius: 4px;
}

.of-asset-list {
  background: #1b1d23 !important;
  padding: 2px 0 !important;
}

.of-asset-list .v-list-item {
  min-height: 28px !important;
  padding: 0 12px !important;
}

.of-asset-list .v-list-item__title {
  font-size: 12px !important;
  font-weight: 500;
  color: #848e9c;
  text-align: right;
}

.of-asset-list .v-list-item:hover .v-list-item__title {
  color: #eaecef;
}

.of-asset-list__current-item {
  opacity: 1 !important;
}

.of-asset-list__current-item .v-list-item__title {
  color: #eaecef !important;
  font-weight: 600 !important;
}

/* Size row (legacy) */
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
.of-slider-pct-box {
  font-size: 11px;
  color: #26FAB0;
  font-weight: 600;
  min-width: 46px;
  text-align: center;
  flex-shrink: 0;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  border: 1px solid #2b2f36;
  border-radius: 4px;
  padding: 3px 6px;
  background: transparent;
}

/* Checkboxes */
.of-checkboxes {
  display: flex;
  flex-flow: column;
}

.of-checkbox {
  margin: 0 !important;
  padding: 0 !important;
}
.of-checkbox >>> .v-label {
  font-size: 10px !important;
  color: #fff !important;
  font-weight: 700 !important;
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
  flex: 1;
  min-height: 206px;
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
  padding: 3px 12px;
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

.footer-spacer {
  flex: 1;
}

.footer-link {
  font-size: 11px;
  color: #848e9c;
  text-decoration: none;
  margin-left: 16px;
  cursor: pointer;
}

.footer-link:hover {
  color: #eaecef;
}

.custom-slider >>> .v-slider__tick {
  background-color: rgb(255 255 255 / 20%)!important;
  border-radius: 50%;
}
.custom-slider >>> .v-slider__thumb {
  background-color: #000 !important;
  border: 1px solid #4efab0 !important;
  width: 14px!important;
  height: 14px!important;
}
.custom-slider >>> .v-slider--horizontal .v-slider__track-container {
  height: 6px !important;
}
</style>
