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

      <v-card
        flat
        outlined
        class="mx-auto liquid-glass compact-perpetuals-widget d-flex flex-column px-3 py-3 fixed-height-card"
      >
        <v-card-text class="pa-2 flex-grow-1 d-flex flex-column">
          <!-- Two-column layout -->
          <v-card-text class="pb-0 px-0 pt-0">
            <div class="two-column-layout">
              <!-- Left Column: Chart and Positions -->
              <div class="positions-column">
                <!-- ADA/USD Chart Header -->
                <div
                  class="d-flex align-items-center justify-space-between mb-2"
                >
                  <h4 class="column-title compact">{{ tickerSymbol }}/USD</h4>
                  <span class="chart-timeframe">24H Price Action</span>
                </div>

                <!-- TradingView ADA/USD Histogram Chart -->
                <div class="chart-section mb-3">
                  <TradingViewChart
                    :symbol="tickerSymbol + '/USD'"
                    :data="chartData"
                    :fetchData="shouldFetchChartData"
                    :useKraken="true"
                    width="100%"
                    height="160px"
                    theme="dark"
                    @chartReady="onChartReady"
                  />
                </div>

                <!-- My Positions Header -->
                <div
                  class="d-flex align-items-center justify-space-between mb-2"
                >
                  <div class="d-flex align-items-center">
                    <h4 class="column-title compact">My Positions</h4>
                    <v-btn
                      icon
                      x-small
                      @click="loadPositions"
                      :loading="loadingPositions"
                      class="refresh-btn-external ml-2"
                    >
                      <v-icon x-small>mdi-reload</v-icon>
                    </v-btn>
                  </div>
                  <span v-if="positions.length > 0" class="positions-count">
                    {{ positions.length }} position{{
                      positions.length === 1 ? "" : "s"
                    }}
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
                  <p class="mt-1 text-caption">
                    Your perpetual positions will appear here
                  </p>
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
                    <!-- Custom headers with padding -->
                    <template v-slot:[`header.asset`]="{ header }">
                      <span style="padding-left: 12px">{{ header.text }}</span>
                    </template>
                    <template v-slot:[`header.positionType`]="{ header }">
                      <span style="padding: 0 8px">{{ header.text }}</span>
                    </template>
                    <template v-slot:[`header.currentValue`]="{ header }">
                      <span style="padding: 0 8px">{{ header.text }}</span>
                    </template>
                    <template v-slot:[`header.entryPrice`]="{ header }">
                      <span style="padding: 0 8px">{{ header.text }}</span>
                    </template>
                    <template v-slot:[`header.pnlWithFees`]="{ header }">
                      <span style="padding: 0 8px">{{ header.text }}</span>
                    </template>
                    <template v-slot:[`header.leverage`]="{ header }">
                      <span style="padding: 0 8px">{{ header.text }}</span>
                    </template>
                    <template v-slot:[`header.actions`]="{ header }">
                      <span style="padding: 0 8px">{{ header.text }}</span>
                    </template>

                    <template v-slot:body.append>
                      <tr
                        v-if="positions.length > positionsPerPage"
                        class="no-hover"
                      >
                        <td
                          :colspan="positionHeaders.length"
                          class="text-center pa-0 ma-0"
                        >
                          <v-pagination
                            v-model="currentPositionsPage"
                            :length="
                              Math.ceil(positions.length / positionsPerPage)
                            "
                            :total-visible="5"
                            circle
                            class="compact-pagination ma-0"
                          ></v-pagination>
                        </td>
                      </tr>
                    </template>
                    <!-- Asset column with trend icon -->
                    <template v-slot:[`item.asset`]="{ item }">
                      <div class="d-flex align-items-center pl-2">
                        <span class="asset-name">{{
                          item.asset?.name || "ADA"
                        }}</span>
                        <v-avatar
                          v-if="
                            item.pnl !== undefined ||
                            item.unrealizedPnl !== undefined
                          "
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
                        :color="
                          item.position.toUpperCase() === 'LONG'
                            ? 'success'
                            : 'error'
                        "
                        x-small
                        label
                        class="ultra-compact-chip"
                        :style="
                          item.position.toUpperCase() === 'LONG'
                            ? 'background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0.1) 100%) !important; color: #10b981 !important; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 9px !important; height: 20px !important; padding: 0 6px !important;'
                            : 'background: linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.1) 100%) !important; color: #ef4444 !important; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 9px !important; height: 20px !important; padding: 0 6px !important;'
                        "
                      >
                        {{ item.position.toUpperCase() }}
                      </v-chip>
                    </template>

                    <!-- Current Value column with Strike Finance style tooltip -->
                    <template v-slot:[`item.currentValue`]="{ item }">
                      <div
                        v-if="item.currentPositionValueUsd !== undefined"
                        class="position-value-compact"
                      >
                        <v-tooltip
                          top
                          content-class="custom-tooltip"
                          max-width="280"
                        >
                          <template v-slot:activator="{ on, attrs }">
                            <div
                              v-bind="attrs"
                              v-on="on"
                              class="position-value-hover"
                            >
                              <div class="value-usd">
                                ${{ item.currentPositionValueUsd.toFixed(2) }}
                              </div>
                              <div class="value-ada">
                                {{ item.currentPositionValueAda.toFixed(2) }}A
                              </div>
                            </div>
                          </template>
                          <div class="fees-tooltip-content">
                            <div class="fees-title">Position Breakdown</div>
                            <div class="position-main-info">
                              <div
                                style="
                                  font-size: 14px;
                                  font-weight: 600;
                                  margin-bottom: 4px;
                                "
                              >
                                ${{
                                  calculatePositionFees(
                                    item,
                                    perpetualsPrice?.lastPrice
                                  )?.positionValueUSD.toFixed(2)
                                }}
                                ({{
                                  calculatePositionFees(
                                    item,
                                    perpetualsPrice?.lastPrice
                                  )?.positionValueADA.toFixed(2)
                                }}
                                ADA)
                              </div>
                              <div
                                :class="
                                  calculatePositionFees(item, perpetualsPrice?.lastPrice)
                                    ?.pnlWithFees >= 0
                                    ? 'profit'
                                    : 'loss'
                                "
                                style="font-size: 13px; font-weight: 600"
                              >
                                ${{
                                  calculatePositionFees(
                                    item,
                                    perpetualsPrice?.lastPrice
                                  )?.pnlWithFees.toFixed(2)
                                }}
                                ({{
                                  calculatePositionFees(
                                    item,
                                    perpetualsPrice?.lastPrice
                                  )?.pnlWithFeesPercentage.toFixed(2)
                                }}%)
                              </div>
                            </div>

                            <div
                              v-if="
                                calculatePositionFees(item, perpetualsPrice?.lastPrice)
                              "
                            >
                              <div class="fee-item">
                                <span>Opening Fee:</span>
                                <span
                                  >${{
                                    calculatePositionFees(
                                      item,
                                      perpetualsPrice?.lastPrice
                                    )?.openingFeeUSD.toFixed(2)
                                  }}</span
                                >
                              </div>
                              <div class="fee-item">
                                <span>Hourly Borrow Fee:</span>
                                <span
                                  >${{
                                    calculatePositionFees(
                                      item,
                                      perpetualsPrice?.lastPrice
                                    )?.hourlyBorrowFeeUSD.toFixed(4)
                                  }}
                                  ({{
                                    calculatePositionFees(
                                      item,
                                      perpetualsPrice?.lastPrice
                                    )?.hourlyBorrowFeePercentage
                                  }})</span
                                >
                              </div>
                              <div class="fee-item">
                                <span>Next Hourly Fee Update:</span>
                                <span
                                  style="
                                    color: #26fab0;
                                    font-weight: 600;
                                    font-family: monospace;
                                  "
                                  >{{
                                    calculatePositionFees(
                                      item,
                                      perpetualsPrice?.lastPrice
                                    )?.nextCountdown
                                  }}</span
                                >
                              </div>
                              <div class="fee-item">
                                <span>Liquidation After Hourly:</span>
                                <span
                                  >${{
                                    formatPriceWithMinDigits(
                                      calculatePositionFees(
                                        item,
                                        perpetualsPrice?.lastPrice
                                      )?.liquidationAfterHourly || 0
                                    )
                                  }}</span
                                >
                              </div>
                              <div class="fee-item">
                                <span>Accumulated Borrow Fee:</span>
                                <span
                                  >${{
                                    calculatePositionFees(
                                      item,
                                      perpetualsPrice?.lastPrice
                                    )?.accumulatedBorrowFeeUSD.toFixed(2)
                                  }}</span
                                >
                              </div>
                              <div class="fee-item">
                                <span>PNL:</span>
                                <span
                                  :class="
                                    calculatePositionFees(
                                      item,
                                      perpetualsPrice?.lastPrice
                                    )?.basePNL >= 0
                                      ? 'profit'
                                      : 'loss'
                                  "
                                >
                                  {{
                                    formatCurrency(
                                      calculatePositionFees(
                                        item,
                                        perpetualsPrice?.lastPrice
                                      )?.basePNL || 0
                                    )
                                  }}
                                </span>
                              </div>
                              <div
                                class="fee-item"
                                style="
                                  margin-top: 8px;
                                  padding-top: 8px;
                                  border-top: 1px solid rgba(255, 255, 255, 0.1);
                                "
                              >
                                <span><strong>PNL With Fees:</strong></span>
                                <span
                                  :class="
                                    calculatePositionFees(
                                      item,
                                      perpetualsPrice?.lastPrice
                                    )?.pnlWithFees >= 0
                                      ? 'profit'
                                      : 'loss'
                                  "
                                  style="font-weight: 600"
                                >
                                  <strong
                                    >${{
                                      calculatePositionFees(
                                        item,
                                        perpetualsPrice?.lastPrice
                                      )?.pnlWithFees.toFixed(2)
                                    }}</strong
                                  >
                                </span>
                              </div>
                            </div>
                            <div v-else class="fee-item">
                              <span
                                >Tooltip unavailable - missing market data</span
                              >
                            </div>
                          </div>
                        </v-tooltip>
                      </div>
                      <span v-else>-</span>
                    </template>

                    <!-- Entry / Mark Price column -->
                    <template v-slot:[`item.entryPrice`]="{ item }">
                      <div
                        v-if="item.entryPrice !== undefined"
                        class="price-values-compact"
                      >
                        <div class="entry-price">
                          ${{ item.entryPrice.toFixed(4) }}
                        </div>
                        <div
                          v-if="
                            item.markPrice !== undefined &&
                            item.markPrice !== item.entryPrice
                          "
                          class="mark-price"
                        >
                          / ${{ item.markPrice.toFixed(4) }}
                        </div>
                      </div>
                      <span v-else>-</span>
                    </template>

                    <!-- P&L with Fees column with trend icon -->
                    <template v-slot:[`item.pnlWithFees`]="{ item }">
                      <div
                        v-if="calculatePositionFees(item, perpetualsPrice?.lastPrice)"
                        class="d-flex align-items-center justify-center"
                      >
                        <v-avatar
                          tile
                          size="10"
                          class="mr-1 trend-icon-centered"
                        >
                          <v-img
                            :src="
                              calculatePositionFees(item, perpetualsPrice?.lastPrice)?.pnlWithFees > 0
                                ? assets.trendUpSvg
                                : calculatePositionFees(item, perpetualsPrice?.lastPrice)?.pnlWithFees < 0
                                ? assets.trendDownSvg
                                : assets.arrowRightSvg
                            "
                            alt="trend"
                          />
                        </v-avatar>
                        <div class="pnl-values-compact">
                          <div :class="calculatePositionFees(item, perpetualsPrice?.lastPrice)?.pnlWithFees >= 0 ? 'profit' : 'loss'">
                            ${{ calculatePositionFees(item, perpetualsPrice?.lastPrice)?.pnlWithFees.toFixed(0) }}
                          </div>
                          <div
                            v-if="calculatePositionFees(item, perpetualsPrice?.lastPrice)?.pnlWithFeesPercentage !== undefined"
                            class="pnl-percentage"
                            :class="calculatePositionFees(item, perpetualsPrice?.lastPrice)?.pnlWithFees >= 0 ? 'profit' : 'loss'"
                          >
                            {{ calculatePositionFees(item, perpetualsPrice?.lastPrice)?.pnlWithFeesPercentage.toFixed(1) }}%
                          </div>
                        </div>
                      </div>
                      <span v-else>-</span>
                    </template>

                    <!-- Leverage column -->
                    <template v-slot:[`item.leverage`]="{ item }">
                      <span v-if="item.leverage !== undefined"
                        >{{ item.leverage }}x</span
                      >
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
                        <v-icon x-small>{{
                          closingPositions[item.id]
                            ? "mdi-loading mdi-spin"
                            : "mdi-close"
                        }}</v-icon>
                      </v-btn>
                    </template>
                  </v-data-table>
                </div>
              </div>

              <!-- Right Column: Open Position Form -->
              <div class="open-position-column d-flex flex-column">
                <div
                  class="d-flex align-items-center justify-space-between mb-2"
                >
                  <h4 class="column-title compact">Open New Position</h4>
                  <!-- Real-time ADA Price Ticker -->
                  <div
                    class="ada-ticker-compact-corner"
                    v-if="perpetualsPrice?.lastPrice"
                  >
                    <div class="d-flex align-items-center">
                      <span class="ada-ticker-label-compact">ADA/USD</span>
                      <span
                        class="price-change-symbol"
                        :style="{
                          color:
                            !perpetualsPrice?.priceChangePercentage ||
                            perpetualsPrice.priceChangePercentage === 0
                              ? '#A3A3A3'
                              : perpetualsPrice.priceChangePercentage > 0
                              ? '#47CD89'
                              : '#F97066',
                          fontSize: '11px',
                          fontWeight: '700',
                          marginLeft: '4px',
                          marginRight: '1px',
                        }"
                      >
                        {{
                          !perpetualsPrice?.priceChangePercentage ||
                          perpetualsPrice.priceChangePercentage === 0
                            ? ""
                            : perpetualsPrice.priceChangePercentage > 0
                            ? "+"
                            : "-"
                        }}
                      </span>
                      <span
                        :style="{
                          color:
                            !perpetualsPrice?.priceChangePercentage ||
                            perpetualsPrice.priceChangePercentage === 0
                              ? '#A3A3A3'
                              : perpetualsPrice.priceChangePercentage > 0
                              ? '#47CD89'
                              : '#F97066',
                          fontSize: '11px',
                          fontWeight: '600',
                        }"
                      >
                        {{
                          perpetualsPrice?.priceChangePercentage
                            ? Math.abs(perpetualsPrice.priceChangePercentage).toFixed(2) +
                              "%"
                            : "0.00%"
                        }}
                      </span>
                      <span class="ada-current-price-compact ml-2"
                        >${{ Number(perpetualsPrice.lastPrice).toFixed(4) }}</span
                      >
                    </div>
                  </div>
                </div>

                <!-- Scrollable form content -->
                <div class="form-content-scrollable flex-grow-1">
                  <!-- Step 1: Position Direction -->
                  <div class="form-section compact">
                    <div class="form-label compact">Position Direction</div>
                    <v-btn-toggle
                      mandatory
                      active-class="geroButton"
                      v-model="positionData.position"
                      dense
                      class="mb-2 compact-toggle full-width-toggle"
                    >
                      <v-btn
                        value="LONG"
                        small
                        rounded
                        class="position-btn long-btn compact flex-btn"
                      >
                        <v-icon x-small class="mr-1">mdi-trending-up</v-icon>
                        LONG
                      </v-btn>
                      <v-btn
                        value="SHORT"
                        small
                        rounded
                        class="position-btn short-btn compact flex-btn"
                      >
                        <v-icon x-small class="mr-1">mdi-trending-down</v-icon>
                        SHORT
                      </v-btn>
                    </v-btn-toggle>
                  </div>

                  <!-- Step 2: Order Type -->
                  <div class="form-section compact">
                    <div class="form-label compact">Order Type</div>
                    <v-btn-toggle
                      mandatory
                      :active-class="
                        positionData.position === 'SHORT'
                          ? 'geroButtonShort'
                          : 'geroButton'
                      "
                      v-model="positionData.orderType"
                      dense
                      class="mb-2 compact-toggle full-width-toggle"
                    >
                      <v-btn
                        value="MARKET"
                        small
                        rounded
                        class="order-type-btn compact flex-btn"
                        :class="{ 'short-theme': positionData.position === 'SHORT' }"
                      >
                        <v-icon x-small class="mr-1">mdi-flash</v-icon>
                        MARKET
                      </v-btn>
                      <v-btn
                        value="LIMIT"
                        small
                        rounded
                        class="order-type-btn compact flex-btn"
                        :class="{ 'short-theme': positionData.position === 'SHORT' }"
                      >
                        <v-icon x-small class="mr-1">mdi-target</v-icon>
                        LIMIT
                      </v-btn>
                    </v-btn-toggle>
                  </div>

                  <!-- Limit Price (only for LIMIT orders) -->
                  <div
                    v-if="positionData.orderType === 'LIMIT'"
                    class="form-section compact"
                  >
                    <div class="form-label compact">Limit Price</div>
                    <v-card
                      class="input-card compact"
                      outlined
                      :class="{
                        'short-position': positionData.position === 'SHORT',
                      }"
                    >
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
                          <span
                            class="input-suffix"
                            :class="{
                              'short-position':
                                positionData.position === 'SHORT',
                            }"
                            >USD</span
                          >
                        </div>
                      </v-card-text>
                    </v-card>
                  </div>

                  <!-- Step 3: Collateral Amount -->
                  <div class="form-section compact">
                    <div class="d-flex align-center justify-space-between">
                      <div class="form-label compact">Collateral Amount</div>
                      <span class="available-balance compact"
                        >Available: {{ availableAdaBalance }} ADA</span
                      >
                    </div>
                    <v-card
                      class="input-card compact"
                      outlined
                      :class="{
                        'short-position': positionData.position === 'SHORT',
                      }"
                    >
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
                          <span
                            class="input-suffix"
                            :class="{
                              'short-position':
                                positionData.position === 'SHORT',
                            }"
                            >ADA</span
                          >
                        </div>
                      </v-card-text>
                    </v-card>
                  </div>

                  <!-- Step 4: Leverage -->
                  <div class="form-section compact">
                    <div class="d-flex align-center justify-space-between mb-1">
                      <div class="form-label compact">Leverage</div>
                      <div
                        class="leverage-display compact"
                        :class="{
                          'short-position': positionData.position === 'SHORT',
                        }"
                      >
                        {{ positionData.leverage }}x
                      </div>
                    </div>
                    <v-slider
                      v-model="positionData.leverage"
                      :min="1"
                      :max="15"
                      :step="0.1"
                      thumb-label
                      :color="
                        positionData.position === 'SHORT'
                          ? '#FF5252'
                          : '#26FAB0'
                      "
                      :track-color="
                        positionData.position === 'SHORT'
                          ? 'rgba(255, 82, 82, 0.2)'
                          : 'rgba(38, 250, 176, 0.2)'
                      "
                      :thumb-color="
                        positionData.position === 'SHORT'
                          ? '#FF5252'
                          : '#26FAB0'
                      "
                      class="leverage-slider compact"
                      :class="{
                        'short-position-slider':
                          positionData.position === 'SHORT',
                      }"
                      @input="onLeverageSliderChange"
                    />
                  </div>

                  <!-- Step 5: Take Profit / Stop Loss (Optional) -->
                  <div class="form-section compact">
                    <v-expansion-panels flat class="tp-sl-panel compact">
                      <v-expansion-panel>
                        <v-expansion-panel-header class="tp-sl-header compact">
                          <div class="d-flex align-items-center">
                            <v-icon x-small class="mr-1" color="#26FAB0"
                              >mdi-shield-check</v-icon
                            >
                            <span class="tp-sl-title compact"
                              >Take Profit / Stop Loss</span
                            >
                            <span class="tp-sl-subtitle compact"
                              >(Optional)</span
                            >
                          </div>
                        </v-expansion-panel-header>
                        <v-expansion-panel-content
                          class="tp-sl-content compact"
                        >
                          <!-- Take Profit -->
                          <div class="mb-2">
                            <div class="form-label small compact">
                              Take Profit Price
                            </div>
                            <v-card
                              class="input-card small compact"
                              outlined
                              :class="{
                                'short-position':
                                  positionData.position === 'SHORT',
                              }"
                            >
                              <v-card-text class="pa-1">
                                <div class="input-container">
                                  <v-text-field
                                    v-model.number="
                                      positionData.takeProfitPrice
                                    "
                                    placeholder="0.0000"
                                    dense
                                    flat
                                    solo
                                    hide-details
                                    type="number"
                                    step="0.0001"
                                    class="price-input small compact"
                                  />
                                  <span
                                    class="input-suffix"
                                    :class="{
                                      'short-position':
                                        positionData.position === 'SHORT',
                                    }"
                                    >USD</span
                                  >
                                </div>
                              </v-card-text>
                            </v-card>
                          </div>

                          <!-- Stop Loss -->
                          <div class="mb-2">
                            <div class="form-label small compact">
                              Stop Loss Price
                            </div>
                            <v-card
                              class="input-card small compact"
                              outlined
                              :class="{
                                'short-position':
                                  positionData.position === 'SHORT',
                              }"
                            >
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
                                  <span
                                    class="input-suffix"
                                    :class="{
                                      'short-position':
                                        positionData.position === 'SHORT',
                                    }"
                                    >USD</span
                                  >
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
                    <v-card
                      flat
                      class="position-summary-card compact"
                      :class="{
                        'short-position': positionData.position === 'SHORT',
                      }"
                    >
                      <v-card-text class="pa-2">
                        <div
                          class="d-flex align-items-center justify-space-between mb-2"
                        >
                          <div
                            class="summary-title compact"
                            :class="{
                              'short-position':
                                positionData.position === 'SHORT',
                            }"
                          >
                            Position Summary
                          </div>
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
                                <v-icon x-small class="mr-1"
                                  >mdi-information</v-icon
                                >
                                View Fees
                              </v-btn>
                            </template>
                            <div class="fees-tooltip-content">
                              <div
                                class="fees-title"
                                :class="{
                                  'short-position':
                                    positionData.position === 'SHORT',
                                }"
                              >
                                Trading Fees
                              </div>
                              <div class="fee-item">
                                <span>Opening Fee:</span>
                                <span>0.1%</span>
                              </div>
                              <div class="fee-item">
                                <span>Hourly Borrow Fee:</span>
                                <span>~0.001%</span>
                              </div>
                              <div class="fee-item">
                                <span>Accumulated Borrow Fee:</span>
                                <span
                                  >{{
                                    (accumulatedBorrowFee * 100).toFixed(4)
                                  }}%</span
                                >
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
                          <span
                            class="summary-value"
                            :class="{
                              'short-position':
                                positionData.position === 'SHORT',
                            }"
                            >{{ positionSize }} ADA</span
                          >
                        </div>
                        <div class="summary-row compact">
                          <span>Notional Value:</span>
                          <span
                            class="summary-value"
                            :class="{
                              'short-position':
                                positionData.position === 'SHORT',
                            }"
                            >${{ notionalValue }}</span
                          >
                        </div>
                        <div class="summary-row compact">
                          <span>Est. Liquidation Price:</span>
                          <span
                            class="summary-value"
                            :class="{
                              'short-position':
                                positionData.position === 'SHORT',
                            }"
                            >{{ liquidationPrice }}</span
                          >
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
                    :class="{
                      'short-position': positionData.position === 'SHORT',
                    }"
                  >
                    <v-icon class="mr-1" small>{{
                      positionData.orderType === "MARKET"
                        ? "mdi-flash"
                        : "mdi-target"
                    }}</v-icon>
                    Open {{ positionData.position }} Position
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
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  toRefs,
  nextTick,
} from "vue";
import BaseDialog from "@/shared/dialogs/BaseDialog.vue";
import TradingViewChart from "@/shared/components/TradingViewChart.vue";
import { walletStore } from "@/stores/walletStore";
import { networkStore } from "@/stores/networkStore";
import { dexHunterStore } from "@/stores/dexHunterStore";
import { WalletManager } from "@/services/walletManager.service";
import axios from "axios";
import assets from "@/utils/assets";
import type {
  CreatePerpetualRequest,
  ClosePerpetualRequest,
  PerpetualPosition,
} from "@/api/strike/types";
import type { Time, IChartApi } from "lightweight-charts";
import tapToolsApi from "@/api/tap-tools-api";
import dexHunterApi from "@/api/dexhunter-api";
import { priceStore } from "@/stores/priceStore";

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

const emit = defineEmits(["close"]);

const { loggedWallet } = toRefs(walletStore);
const { price } = toRefs(networkStore);
const { dexHunterTokens } = toRefs(dexHunterStore);
const walletManager = WalletManager.getInstance();

// Local Kraken price state for perpetuals dialog
const krakenPrice = ref<any>({
  lastPrice: null,
  priceChangePercentage: null,
  source: 'kraken'
});

// Use global Kraken price store, fallback to network price
const perpetualsPrice = computed(() => {
  if (priceStore.adaUsd?.lastPrice) {
    return priceStore.adaUsd;
  }
  return price.value || {};
});

// Calculate accumulated borrow fee with 5-minute validity interval offset
const calculateAccumulatedBorrowFee = (
  hourlyBorrowFee: number,
  enteredPositionTime: number
) => {
  const currentTime = Date.now() + 300000; // Add 5 minutes (300000ms) for validity interval
  const hoursElapsed = (currentTime - enteredPositionTime) / (1000 * 60 * 60);
  return hourlyBorrowFee * hoursElapsed;
};

// Calculate next hourly fee countdown
const calculateNextHourlyCountdown = (enteredPositionTime: number) => {
  const currentTime = Date.now() + 300000;
  const hoursElapsed = (currentTime - enteredPositionTime) / (1000 * 60 * 60);
  const minutesSinceLastHour = (hoursElapsed % 1) * 60;
  const minutesUntilNext = 60 - minutesSinceLastHour;

  const minutes = Math.floor(minutesUntilNext);
  const seconds = Math.floor((minutesUntilNext - minutes) * 60);

  return `${minutes}m ${seconds}s`;
};

// Calculate opening fee according to documentation
const calculateOpeningFee = (
  positionSize: number,
  entryPrice: number,
  totalLongInterest: number,
  totalShortInterest: number,
  position: "Long" | "Short",
  version?: number,
  token: "ada" | "snek" = "ada"
) => {
  return (
    calculateOpeningFeeADA(
      positionSize,
      totalLongInterest,
      totalShortInterest,
      position,
      version,
      token
    ) * entryPrice
  );
};

const calculateOpeningFeeADA = (
  positionSize: number,
  totalLongInterest: number,
  totalShortInterest: number,
  position: "Long" | "Short",
  version?: number,
  token: "ada" | "snek" = "ada"
) => {
  // Get percentage - use version if provided, otherwise use dynamic calculation
  const percentage = version
    ? getVersionPercentage(version, token)
    : openingFee(position, totalLongInterest, totalShortInterest, token);

  // Platform fee: percentage of position size OR at least 2 ADA/SNEK
  const platformFee = Math.max(positionSize * percentage, 2);
  const lpFee = positionSize * 0.002;
  const openFee = platformFee + lpFee;

  return openFee;
};

const getVersionPercentage = (
  version: number,
  token: "ada" | "snek" = "ada"
): number => {
  const config = {
    ada: { v1: 0.003, v2: 0.0025, default: 0.004 },
    snek: { v1: 0.003, v2: 0.0025, default: 0.004 },
  };
  return version === 1
    ? config[token].v1
    : version === 2
    ? config[token].v2
    : config[token].default;
};

const openingFee = (
  position: "Long" | "Short",
  totalLongInterest: number,
  totalShortInterest: number,
  token: "ada" | "snek" = "ada"
): number => {
  if (position === "Short") {
    return 0.001;
  }

  // Calculate total interest
  const totalInterest = totalLongInterest + totalShortInterest;

  // Handle edge case where total interest is 0
  if (totalInterest === 0) {
    return 0.0025; // Default to v2 fee
  }

  // Calculate long percentage
  const longPercentage = (totalLongInterest / totalInterest) * 100;

  // Return fee based on long percentage thresholds
  if (longPercentage > 95) {
    return 0.0065;
  } else if (longPercentage > 90) {
    return 0.0055;
  } else if (longPercentage > 85) {
    return 0.0045;
  } else if (longPercentage > 80) {
    return 0.0035;
  } else if (longPercentage > 75) {
    return 0.00325;
  } else if (longPercentage > 70) {
    return 0.003;
  } else if (longPercentage > 65) {
    return 0.00275;
  } else {
    return 0.0025;
  }
};

// Format percentage with proper precision - exactly matching React component
const formatPercentage = (value: number, totalPositionValue: number) => {
  if (totalPositionValue === 0) return "0.00%";
  const percentage = (Math.abs(value) / totalPositionValue) * 100;

  if (percentage === 0) return "0.00%";
  if (percentage >= 0.01) return `${percentage.toFixed(2)}%`;

  // For very small percentages, show at least 2 significant digits
  const percentageStr = percentage.toFixed(20);
  const [, decimalPart = ""] = percentageStr.split(".");

  let firstNonZeroIndex = -1;
  for (let i = 0; i < decimalPart.length; i++) {
    if (decimalPart[i] !== "0") {
      firstNonZeroIndex = i;
      break;
    }
  }

  if (firstNonZeroIndex === -1) return "0.00%";

  const decimalPlaces = firstNonZeroIndex + 2;
  return `${percentage.toFixed(decimalPlaces)}%`;
};

// Format currency - exactly matching React component
const formatCurrency = (value: number) => {
  const formattedValue = Math.abs(value).toFixed(
    Math.max(2, Math.abs(value) < 0.01 ? 4 : 2)
  );
  return value < 0 ? `-$${formattedValue}` : `$${formattedValue}`;
};

// Format price with minimum digits - exactly matching React component
const formatPriceWithMinDigits = (price: number): string => {
  if (price === 0 || !isFinite(price) || isNaN(price)) return "0.0000";

  if (price >= 1) {
    // For prices >= 1, show standard 2 decimal places
    return price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  // For prices < 1, we need to show at least 4 significant digits
  // Convert to string in fixed notation to avoid scientific notation
  const priceStr = price.toFixed(20); // Use high precision to avoid rounding
  const [, decimalPart = ""] = priceStr.split(".");

  // Find the first non-zero digit in decimal part
  let firstNonZeroIndex = -1;
  for (let i = 0; i < decimalPart.length; i++) {
    if (decimalPart[i] !== "0") {
      firstNonZeroIndex = i;
      break;
    }
  }

  if (firstNonZeroIndex === -1) return "0.0000";

  // We want at least 4 significant digits after the first non-zero
  const decimalPlaces = firstNonZeroIndex + 4;

  return price.toFixed(decimalPlaces);
};

// Calculate PNL according to documentation
const calculatePNL = (
  entryPrice: number,
  markPrice: number,
  side: "Long" | "Short",
  size: number
) => {
  const pnl =
    side === "Long"
      ? (markPrice - entryPrice) * size
      : (entryPrice - markPrice) * size;


  return Number(pnl.toFixed(2));
};

// Calculate PNL with fees according to documentation
const calculatePNLWithFees = (
  entryPrice: number,
  markPrice: number,
  side: "Long" | "Short",
  size: number,
  includeFees: boolean,
  hourlyBorrowFee: number,
  version: number,
  enteredPositionTime: number,
  openingUSDFee?: number
) => {
  const basePNL = calculatePNL(entryPrice, markPrice, side, size);

  if (!includeFees) {
    return basePNL;
  }

  let openingFee = 0;

  if (openingUSDFee) {
    openingFee = openingUSDFee;
  } else {
    openingFee = calculateOpeningFee(size, entryPrice, 0, 0, "Long", version);
  }

  const accumulatedBorrowFee = calculateAccumulatedBorrowFee(
    hourlyBorrowFee,
    enteredPositionTime
  );

  return Number((basePNL - openingFee - accumulatedBorrowFee).toFixed(2));
};

// Calculate detailed position fees breakdown - matching React PositionValueTooltip exactly
const calculatePositionFees = (position: any, currentPrice: number) => {
  if (!position) return null;

  // Extract props exactly as React component receives them
  const positionSize = Number(position.positionSize || 0);
  const entryPrice = Number(position.entryPrice || currentPrice);
  const side = position.position as "Long" | "Short";
  const version = Number(position.version || 2);
  const enteredPositionTime = Number(
    position.enteredPositionTime || Date.now()
  );
  const hourlyBorrowFee = Number(position.hourlyBorrowFee || 0);
  const openingUSDFee = position.openingUSDFee;
  const assetTicker = position.asset?.ticker || "ADA";
  const collateralAmount = Number(position.collateralAmount || positionSize);

  // Raw values (used only for liquidation calculation when all are available)
  const rawPositionAssetAmount = position.rawPositionAssetAmount;
  const rawEnteredAtUsdPrice = position.rawEnteredAtUsdPrice;
  const rawMaintainMarginAmount = position.rawMaintainMarginAmount;
  const rawCollateralAssetAmount = position.rawCollateralAssetAmount;
  const rawHourlyUsdBorrowFee = position.rawHourlyUsdBorrowFee;

  // If we don't have hourly borrow fee data, we can't show accurate calculations
  if (!hourlyBorrowFee) {
    return null;
  }

  // Opening fee calculation - exactly matching React
  const openingFee =
    openingUSDFee ||
    calculateOpeningFee(positionSize, entryPrice, 0, 0, "Long", version);

  // Accumulated borrow fee calculation - exactly matching React
  const accumulatedBorrowFee = calculateAccumulatedBorrowFee(
    hourlyBorrowFee,
    enteredPositionTime
  );

  // PNL calculation - exactly matching React
  // Use markPrice from position if available, otherwise currentPrice
  const markPrice = position.markPrice ? Number(position.markPrice) : currentPrice;
  const profit = calculatePNL(entryPrice, markPrice, side, positionSize);

  // PNL with fees calculation - exactly matching React
  const profitWithFees = calculatePNLWithFees(
    entryPrice,
    markPrice,
    side,
    positionSize,
    true,
    hourlyBorrowFee,
    version,
    enteredPositionTime,
    openingUSDFee
  );

  // Liquidation price calculation - exactly matching React
  const liquidationAfterHourly = calculateLiquidationPriceAfterNextHourlyUpdate(
    positionSize,
    entryPrice,
    side,
    hourlyBorrowFee,
    enteredPositionTime,
    assetTicker,
    rawPositionAssetAmount,
    rawEnteredAtUsdPrice,
    rawMaintainMarginAmount,
    rawCollateralAssetAmount,
    rawHourlyUsdBorrowFee,
    collateralAmount
  );

  // Format percentage for hourly borrow fee
  const totalPositionValue = positionSize * currentPrice;
  const hourlyBorrowFeePercentage = formatPercentage(
    hourlyBorrowFee,
    totalPositionValue
  );

  const result = {
    positionValueUSD: totalPositionValue,
    positionValueADA: positionSize,
    openingFeeUSD: openingFee,
    hourlyBorrowFeeUSD: hourlyBorrowFee,
    hourlyBorrowFeePercentage,
    accumulatedBorrowFeeUSD: accumulatedBorrowFee,
    basePNL: profit,
    pnlWithFees: profitWithFees,
    pnlWithFeesPercentage:
      collateralAmount > 0
        ? (profitWithFees / (collateralAmount * entryPrice)) * 100
        : 0,
    liquidationAfterHourly,
    nextCountdown: calculateNextHourlyCountdown(enteredPositionTime),
  };


  return result;
};

// Calculate liquidation price after next hourly update - exactly matching React component
const calculateLiquidationPriceAfterNextHourlyUpdate = (
  positionSize: number,
  entryPrice: number,
  position: "Long" | "Short",
  hourlyBorrowFee: number,
  enteredPositionTime: number,
  assetTicker: string,
  rawPositionAssetAmount?: number,
  rawEnteredAtUsdPrice?: number,
  rawMaintainMarginAmount?: number,
  rawCollateralAssetAmount?: number,
  rawHourlyUsdBorrowFee?: number,
  collateralAmount?: number
) => {
  const currentTime = Date.now() + 300000;
  const nextHourTime = currentTime + 60 * 60 * 1000;

  if (
    rawPositionAssetAmount !== undefined &&
    rawEnteredAtUsdPrice !== undefined &&
    rawMaintainMarginAmount !== undefined &&
    rawCollateralAssetAmount !== undefined &&
    rawHourlyUsdBorrowFee !== undefined
  ) {
    const liquidationPrice = findLiquidationPrice(
      position,
      rawPositionAssetAmount,
      rawEnteredAtUsdPrice,
      rawMaintainMarginAmount,
      rawCollateralAssetAmount,
      rawHourlyUsdBorrowFee,
      enteredPositionTime,
      nextHourTime
    );

    const usdPriceMultiplier = assetTicker === "SNEK" ? 1_000_000 : 10_000;
    return liquidationPrice / usdPriceMultiplier;
  } else {
    const usdPriceMultiplier = assetTicker === "SNEK" ? 1_000_000 : 10_000;
    const decimals = assetTicker === "SNEK" ? 1 : 1_000_000;
    const maintainMargin = assetTicker === "SNEK" ? 10 : 5; // snekMaintainMarginAmount : maintainMarginAmount

    const positionAssetAmount = positionSize * decimals;
    const enteredAtUsdPrice = entryPrice * usdPriceMultiplier;
    const collateralAssetAmount = (collateralAmount || positionSize) * decimals;
    const hourlyUsdBorrowFee = hourlyBorrowFee * usdPriceMultiplier;

    const liquidationPrice = findLiquidationPrice(
      position,
      positionAssetAmount,
      enteredAtUsdPrice,
      maintainMargin,
      collateralAssetAmount,
      hourlyUsdBorrowFee,
      enteredPositionTime,
      nextHourTime
    );

    return liquidationPrice / usdPriceMultiplier;
  }
};

// findLiquidationPrice function exactly matching the React component's math library
const findLiquidationPrice = (
  position: "Long" | "Short",
  positionAssetAmount: number,
  enteredAtUsdPrice: number,
  maintainMarginAmount: number,
  collateralAssetAmount: number,
  hourlyUsdBorrowFee: number,
  enteredPositionTime: number,
  targetTime: number
) => {
  const currentTime = targetTime;
  const hoursElapsed = (currentTime - enteredPositionTime) / (1000 * 60 * 60);
  const interestFee = hourlyUsdBorrowFee * hoursElapsed;

  const maintainMarginFactor = maintainMarginAmount / 100;

  if (position === "Long") {
    const liquidationPrice =
      (collateralAssetAmount * enteredAtUsdPrice -
        positionAssetAmount * enteredAtUsdPrice -
        interestFee) /
      (positionAssetAmount * (maintainMarginFactor - 1));
    return Math.floor(liquidationPrice);
  } else {
    const liquidationPrice =
      (collateralAssetAmount * enteredAtUsdPrice +
        positionAssetAmount * enteredAtUsdPrice -
        interestFee) /
      (positionAssetAmount * (maintainMarginFactor + 1));
    return Math.ceil(liquidationPrice);
  }
};

// Process position data - ONLY return what exists in the API + calculated values from other APIs
const processPositionData = (position: any) => {
  const result: any = {};

  // Use Kraken WebSocket ADA price as current price for perpetuals (more accurate for trading)
  if (perpetualsPrice.value?.lastPrice) {
    result.currentPrice = Number(perpetualsPrice.value.lastPrice);
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
  if (
    position.entryPrice !== undefined &&
    position.positionSize !== undefined &&
    result.currentPrice
  ) {
    const entryPrice = Number(position.entryPrice);
    const positionSize = Number(position.positionSize);
    const leverage = Number(position.leverage || 1);
    const currentPrice = result.currentPrice;
    const positionType = position.position?.toLowerCase();

    let priceDiff;
    if (positionType === "long") {
      priceDiff = currentPrice - entryPrice;
    } else {
      // short
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

  // Handle fees with real-time accumulated borrow fee calculation
  if (position.totalFees !== undefined) {
    result.totalFees = Number(position.totalFees);
  } else if (
    position.openingFee !== undefined ||
    position.accumulatedFees !== undefined ||
    position.accumulatedBorrowFee !== undefined
  ) {
    const openingFee = Number(position.openingFee || 0);
    let accumulatedFees = Number(
      position.accumulatedFees || position.accumulatedBorrowFee || 0
    );

    // Calculate real-time accumulated borrow fee if position has entered time
    if (
      position.enteredPositionTime &&
      position.hourlyBorrowFee !== undefined
    ) {
      const realTimeAccumulatedFee = calculateAccumulatedBorrowFee(
        Number(position.hourlyBorrowFee),
        Number(position.enteredPositionTime)
      );
      accumulatedFees = realTimeAccumulatedFee;
    }

    result.totalFees = Number((openingFee + accumulatedFees).toFixed(6));
    result.realTimeAccumulatedBorrowFee = accumulatedFees;
  }

  // Calculate Current Position Value based on COLLATERAL (not total position size)
  if ((position.collateralAmount !== undefined || position.rawCollateralAssetAmount !== undefined) && result.currentPrice) {
    // Use raw collateral amount if available for more precision, otherwise fall back to collateralAmount
    const rawCollateralAmount = position.rawCollateralAssetAmount;
    const regularCollateralAmount = position.collateralAmount;
    
    // Convert raw collateral amount from microADA to ADA (1 ADA = 1,000,000 microADA)
    const collateralSizeAda = rawCollateralAmount 
      ? Number(rawCollateralAmount) / 1000000  // Convert microADA to ADA
      : Number(regularCollateralAmount);       // Use regular collateral amount if no raw amount
    const currentPrice = result.currentPrice;
    
    // Current position value based on COLLATERAL at market price (without PNL consideration)
    const basePositionValueUsd = collateralSizeAda * currentPrice;
    
    // Add PNL and subtract fees to get the actual current position value
    const pnl = result.pnl || 0; // Unrealized PNL
    
    // Calculate real-time total fees (opening + current accumulated borrow fees)
    const staticTotalFees = result.totalFees || 0; // From API
    
    // Get real-time fees using the same calculation as the tooltip
    const tooltipFees = calculatePositionFees(position, currentPrice);
    // Only use accumulated borrow fees, not opening fees (opening fees are in PNL)
    const realTimeBorrowFees = tooltipFees ? tooltipFees.accumulatedBorrowFeeUSD : 0;
    
    // Use only borrow fees for position value (opening fees already in PNL)
    const totalFeesToUse = realTimeBorrowFees;
    
    // Final position value = base value + PNL - fees (including real-time borrow fees)
    const finalPositionValueUsd = basePositionValueUsd + pnl - totalFeesToUse;
    
    
    result.currentPositionValueUsd = Number(finalPositionValueUsd.toFixed(2));
    result.currentPositionValueAda = collateralSizeAda;
  }

  return result;
};

// Create a direct HTTP client for Strike API
const createStrikeHttpClient = () => {
  const baseURL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";

  return {
    async getPositions(address: string): Promise<any[]> {
      try {
        const response = await axios.get(`${baseURL}/api/strike/perpetuals/getPositions`, {
          params: { address },
          timeout: 30000,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });

        return response.data || [];
      } catch (error) {
        console.error("Strike API error:", error?.message || error);
        throw error;
      }
    },

    async openPosition(request: CreatePerpetualRequest): Promise<string> {
      try {
        const response = await axios.post(
          `${baseURL}/api/strike/perpetuals/openPosition`,
          request,
          {
            timeout: 30000,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );

        return response.data?.transactionId || response.data;
      } catch (error) {
        console.error("Strike openPosition error:", error?.message || error);
        throw error;
      }
    },

    async closePosition(request: ClosePerpetualRequest): Promise<string> {
      try {
        const response = await axios.post(
          `${baseURL}/api/strike/perpetuals/closePosition`,
          request,
          {
            timeout: 30000,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );

        return response.data?.transactionId || response.data;
      } catch (error) {
        console.error("Strike closePosition error:", error?.message || error);
        throw error;
      }
    },
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
const fetchTokenHistoryFromDexHunter = async (
  ticker: string
): Promise<CandlestickDataPoint[]> => {
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
    const priceChangeResponse = await tapToolsApi.dailyPriceChange("lovelace");

    if (priceChangeResponse?.status === 200 && priceChangeResponse.data) {
      // Convert price change data to OHLC estimation
      console.debug(
        "Got ADA price change data from TapTools:",
        priceChangeResponse.data
      );
      return convertPriceDataToOHLC(priceChangeResponse.data);
    }

    // Fallback: generate OHLC from current price
    const currentPrice = networkStore.perpetualsPrice?.lastPrice || 0.5; // Current ADA price
    if (currentPrice > 0) {
      return generateOHLCFromPrice(currentPrice);
    }

    return [];
  } catch (error) {
    console.error("Error fetching real ADA OHLC data:", error);
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
  const currentPrice = networkStore.perpetualsPrice?.lastPrice || 0.5;

  for (let i = 23; i >= 0; i--) {
    const time = Math.floor((now - i * oneHour) / 1000) as Time;

    // Simulate volume based on typical ADA trading patterns
    const hourOfDay = new Date(now - i * oneHour).getHours();

    // Higher volume during US/EU trading hours
    let timeFactor = 1.0;
    if (hourOfDay >= 8 && hourOfDay <= 16) {
      // 8 AM - 4 PM UTC
      timeFactor = 1.3; // 30% higher during active hours
    } else if (hourOfDay >= 20 || hourOfDay <= 2) {
      // Evening/night
      timeFactor = 0.7; // 30% lower during quiet hours
    }

    // Add some volatility and market structure
    const volatility = 0.6 + Math.random() * 0.8; // 0.6 to 1.4x
    const marketTrend = Math.sin(i * 0.3) * 0.2 + 1; // Slight wave pattern

    // Calculate hourly volume in USD
    const hourlyVolumeUSD =
      (baseVolumeUSD / 24) * timeFactor * volatility * marketTrend;

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

  let currentPrice = networkStore.perpetualsPrice?.lastPrice || 0.58; // Use real ADA price or fallback

  for (let i = 23; i >= 0; i--) {
    const time = Math.floor((now - i * oneHour) / 1000) as Time;

    // Generate realistic OHLC data
    const volatility = 0.015; // 1.5% max hourly movement
    const hourlyChange = (Math.random() - 0.5) * volatility; // Random walk

    // Calculate open price (previous close or current)
    const open = currentPrice;

    // Generate high and low around the open price
    const spread = Math.abs(hourlyChange) * 2; // Price spread for the hour
    const high = open + Math.random() * spread;
    const low = Math.max(0.01, open - Math.random() * spread); // Keep price positive

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

  let currentPrice = networkStore.perpetualsPrice?.lastPrice || 0.58; // Use real ADA price or fallback

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

// Update accumulated borrow fees every minute
let borrowFeeUpdateInterval: NodeJS.Timeout | null = null;
const borrowFeeUpdateTrigger = ref(0);

// Real-time countdown for next hourly fee update
const nextHourlyFeeCountdown = ref("");
let countdownInterval: NodeJS.Timeout | null = null;

const startChartUpdates = () => {
  if (chartUpdateInterval) {
    clearInterval(chartUpdateInterval);
  }

  // Chart component handles its own updates for all tickers
  console.debug(
    `Chart updates for ${tickerSymbol.value} handled by TradingViewChart component`
  );

  // Start real-time borrow fee updates
  startBorrowFeeUpdates();
};

const startBorrowFeeUpdates = () => {
  if (borrowFeeUpdateInterval) {
    clearInterval(borrowFeeUpdateInterval);
  }

  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  // Update accumulated borrow fees every minute to reflect real-time changes
  borrowFeeUpdateInterval = setInterval(() => {
    borrowFeeUpdateTrigger.value += 1; // Trigger reactivity for computed values
    console.debug("Updated real-time accumulated borrow fees");
  }, 60000); // Every 60 seconds

  // Update countdown every second for real-time display
  countdownInterval = setInterval(() => {
    borrowFeeUpdateTrigger.value += 0.1; // Small increment to trigger tooltip updates
  }, 1000); // Every second
};

const stopChartUpdates = () => {
  if (chartUpdateInterval) {
    clearInterval(chartUpdateInterval);
    chartUpdateInterval = null;
  }

  if (borrowFeeUpdateInterval) {
    clearInterval(borrowFeeUpdateInterval);
    borrowFeeUpdateInterval = null;
  }

  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
};

// Reactive positions that update when ADA price changes
const positions = computed(() => {
  console.debug('🔍 Positions computed - rawPositions.value:', {
    length: rawPositions.value.length,
    hasData: rawPositions.value.length > 0,
    firstPosition: rawPositions.value[0] || 'none'
  });
  
  if (!rawPositions.value.length) {
    console.debug('🔍 No rawPositions available, returning empty array');
    return [];
  }

  const processed = rawPositions.value.map((position, index) => {
    // Re-process position data with current price
    const processedData = processPositionData(position);

    // Return enhanced position with updated calculations
    const enhanced = {
      ...position,
      ...processedData,
    };

    // Debug what the table will receive
    console.debug('📋 Table Position Data:', {
      index,
      positionSize: enhanced.positionSize,
      currentPrice: enhanced.currentPrice,
      pnl: enhanced.pnl,
      totalFees: enhanced.totalFees,
      currentPositionValueUsd: enhanced.currentPositionValueUsd,
      'Should show in table': `$${enhanced.currentPositionValueUsd?.toFixed(2) || 'N/A'}`
    });

    return enhanced;
  });

  return processed;
});

// Ticker symbol for the chart (extracted from the trading pair)
const tickerSymbol = computed(() => {
  return "ADA"; // Default to ADA, can be made dynamic based on selected asset
});

const closingPositions = ref<Record<string, boolean>>({});
const loadingPositions = ref(false);

// Component cleanup
onBeforeUnmount(() => {
  stopChartUpdates();
});

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
  asset: "ADA/USD",
  collateralAmount: 0,
  leverage: 1,
  position: "LONG",
  orderType: "MARKET", // MARKET or LIMIT
  limitPrice: 0,
  stopLossPrice: 0,
  takeProfitPrice: 0,
});

// Table headers for positions - ultra compact for more space
const positionHeaders = ref([
  {
    text: "Asset",
    align: "start",
    sortable: true,
    value: "asset",
    width: "35",
  },
  {
    text: "Side",
    align: "center",
    sortable: true,
    value: "positionType",
    width: "28",
  },
  {
    text: "Value",
    align: "center",
    sortable: true,
    value: "currentValue",
    width: "42",
  },
  {
    text: "Entry/Mark",
    align: "center",
    sortable: true,
    value: "entryPrice",
    width: "52",
  },
  { text: "P&L", align: "center", sortable: true, value: "pnlWithFees", width: "42" },
  {
    text: "Lev",
    align: "center",
    sortable: true,
    value: "leverage",
    width: "22",
  },
  { text: "", align: "center", sortable: false, value: "actions", width: "26" },
]);

// Computed properties
const availableAdaBalance = computed(() => {
  // Get ADA balance from wallet store (simplified - you might need to access the actual balance)
  const tokens = walletStore.tokens || {};
  const adaToken = Object.values(tokens).find(
    (token: any) => token.policy_id === ""
  ) as any;

  if (adaToken?.quantity) {
    const balance = Number(adaToken.quantity) / 1000000; // Convert from lovelace to ADA
    return balance.toFixed(2);
  }

  return "0.00";
});

watch(
  () => props.isOpen,
  async (newVal) => {
    if (newVal) {
      console.debug("PerpetualsDialog: Dialog opened, initializing chart data");
      await loadPositions();

      // Reset chart state and enable fetching
      shouldFetchChartData.value = false; // Reset first
      chartData.value = []; // Clear any cached data

      // Use nextTick to ensure the chart component sees the reset
      await nextTick();

      // Now enable fetching - this will trigger the chart component to fetch fresh data
      shouldFetchChartData.value = true;
      console.debug("PerpetualsDialog: Enabled chart data fetching");

      startChartUpdates(); // Start real-time chart updates when dialog opens
    } else {
      console.debug("PerpetualsDialog: Dialog closed, stopping updates");
      shouldFetchChartData.value = false; // Disable fetching when closed
      stopChartUpdates(); // Stop chart updates when dialog closes
    }
  }
);

// Watch for ADA price changes and log updates (now using Kraken WebSocket)
watch(
  () => perpetualsPrice.value?.lastPrice,
  (newPrice, oldPrice) => {
    if (newPrice !== oldPrice && rawPositions.value.length > 0) {
      console.debug(
        `🦑 💰 Kraken ADA price updated: $${oldPrice} → $${newPrice} - Recalculating ${rawPositions.value.length} positions`
      );
    }
  }
);

const positionSize = computed(() => {
  return (
    positionData.value.collateralAmount * positionData.value.leverage
  ).toFixed(2);
});

const notionalValue = computed(() => {
  const currentAdaPrice = Number(perpetualsPrice.value?.lastPrice || 0);
  const positionSizeAda = Number(positionSize.value);
  return (positionSizeAda * currentAdaPrice).toFixed(2);
});

// Real-time accumulated borrow fee calculation
const accumulatedBorrowFee = computed(() => {
  // Use trigger to ensure reactivity updates every minute
  borrowFeeUpdateTrigger.value; // Access to trigger reactivity

  const hourlyBorrowFeeRate = 0.00001; // ~0.001% hourly rate
  const enteredTime = Date.now() - 2 * 60 * 60 * 1000; // Example: 2 hours ago for demo
  return calculateAccumulatedBorrowFee(hourlyBorrowFeeRate, enteredTime);
});

const liquidationPrice = computed(() => {
  const currentAdaPrice = Number(perpetualsPrice.value?.lastPrice || 0.85);
  const leverage = positionData.value.leverage;
  const collateral = positionData.value.collateralAmount;

  // Include accumulated borrow fee in liquidation calculation
  const totalFees = 0.001 + accumulatedBorrowFee.value; // Opening fee + accumulated borrow fee
  const adjustedLiquidationMargin = 0.9 / leverage + totalFees;

  if (positionData.value.position === "LONG") {
    const liqPrice = currentAdaPrice * (1 - adjustedLiquidationMargin);
    return `$${liqPrice.toFixed(4)}`;
  } else {
    const liqPrice = currentAdaPrice * (1 + adjustedLiquidationMargin);
    return `$${liqPrice.toFixed(4)}`;
  }
});

// Leverage input synchronization
const onLeverageSliderChange = () => {
  // Update only when slider changes - no need for input synchronization
};

const canOpenPosition = computed(() => {
  const hasRequiredFields =
    positionData.value.asset &&
    positionData.value.collateralAmount > 0 &&
    positionData.value.leverage >= 1;

  // Additional validation for LIMIT orders
  if (positionData.value.orderType === "LIMIT") {
    return hasRequiredFields && positionData.value.limitPrice > 0;
  }

  return hasRequiredFields;
});

const openPosition = async () => {
  const walletAddress = loggedWallet.value?.baseAddress;

  if (!walletAddress) {
    console.warn("No wallet address available");
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
      ...(positionData.value.stopLossPrice > 0 && {
        stopLossPrice: positionData.value.stopLossPrice,
      }),
      ...(positionData.value.takeProfitPrice > 0 && {
        takeProfitPrice: positionData.value.takeProfitPrice,
      }),
      // Add limit price for LIMIT orders
      ...(positionData.value.orderType === "LIMIT" && {
        limitPrice: positionData.value.limitPrice,
      }),
    };

    const strikeClient = createStrikeHttpClient();
    await strikeClient.openPosition(openRequest);

    // Reset form after success
    positionData.value = {
      asset: "ADA/USD",
      collateralAmount: 0,
      leverage: 1,
      position: "LONG",
      orderType: "MARKET",
      limitPrice: 0,
      stopLossPrice: 0,
      takeProfitPrice: 0,
    };
    await loadPositions();
  } catch (error) {
    console.error("Failed to open position:", error);
    // TODO: Show user-friendly error notification
  } finally {
    loading.value = false;
  }
};

const closePosition = async (position: PerpetualPosition) => {
  if (!position.id || !position.outRef) {
    console.error("Invalid position data for closing");
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
    console.error("Failed to close position:", error);
    // TODO: Show user-friendly error notification
  } finally {
    closingPositions.value[position.id] = false;
  }
};

const getStatusColor = (status?: string) => {
  switch (status?.toUpperCase()) {
    case "OPEN":
      return "status-open";
    case "CLOSED":
      return "status-closed";
    case "LIQUIDATED":
      return "status-liquidated";
    default:
      return "status-unknown";
  }
};

const getPositionTrendIcon = (position: any) => {
  // Use P&L with fees as primary indicator, fallback to unrealized P&L
  const pnlValue =
    position.pnl !== undefined ? position.pnl : position.unrealizedPnl;

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
    console.warn("No wallet address available");
    return;
  }

  loadingPositions.value = true;
  
  try {
    const strikeClient = createStrikeHttpClient();
    const fetchedPositions = await strikeClient.getPositions(walletAddress);
    // Store raw positions for reactive processing
    rawPositions.value = fetchedPositions.map((position, index) => {
      // Extract collateral amount from the API data structure
      const collateralAmount =
        position.collateral?.amount || position.collateralAmount || 0;

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
        outRef: position.outRef || { txHash: `fake-${index}`, outputIndex: 0 },
      };

      return basePosition;
    });
    
  } catch (error) {
    console.error("Failed to load positions:", error?.message || error);
    rawPositions.value = [];
  } finally {
    loadingPositions.value = false;
  }
};

// Logo error handler
const onLogoError = (event: Event) => {
  console.warn("Strike Finance logo failed to load, hiding logo");
  const img = event.target as HTMLImageElement;
  img.style.display = "none";
};

onMounted(async () => {
  if (props.isOpen) {
    loadPositions();
  }

  // Initialize chart data with real ADA data
  try {
    chartData.value = await generateChartData();
    console.debug(
      "PerpetualsDialog: Initialized chart data with",
      chartData.value.length,
      "points"
    );
  } catch (error) {
    console.error("Failed to initialize chart data:", error);
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
  background-color: #26fab0 !important;
}

::v-deep .v-slider__thumb-label {
  background-color: #26fab0 !important;
}

::v-deep .v-slider__track-fill {
  background-color: #26fab0 !important;
}

::v-deep .v-slider__track-background {
  background-color: rgba(38, 250, 176, 0.2) !important;
}

/* SHORT position slider styling - force red colors */
::v-deep .short-position-slider .v-slider__thumb {
  background-color: #ff5252 !important;
}

::v-deep .short-position-slider .v-slider__thumb-label {
  background-color: #ff5252 !important;
}

::v-deep .short-position-slider .v-slider__track-fill {
  background-color: #ff5252 !important;
}

::v-deep .short-position-slider .v-slider__track-background {
  background-color: rgba(255, 82, 82, 0.2) !important;
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
  background: linear-gradient(135deg, #26fab0 0%, #1de89a 100%) !important;
  color: #1a1a1a !important;
  border-color: #26fab0 !important;
}

::v-deep .v-btn-toggle .v-btn.geroButton .v-icon {
  color: #1a1a1a !important;
}

::v-deep .v-btn-toggle .v-btn.geroButtonShort {
  background: linear-gradient(135deg, #ff5252 0%, #ef4444 100%) !important;
  color: #ffffff !important;
  border-color: #ff5252 !important;
}

::v-deep .v-btn-toggle .v-btn.geroButtonShort .v-icon {
  color: #ffffff !important;
}

/* More specific targeting for order type buttons in SHORT mode */
::v-deep .compact-toggle .v-btn.geroButtonShort,
::v-deep .full-width-toggle .v-btn.geroButtonShort,
::v-deep .v-btn-toggle.compact-toggle .v-btn.geroButtonShort,
::v-deep .v-btn-toggle.full-width-toggle .v-btn.geroButtonShort {
  background: linear-gradient(135deg, #ff5252 0%, #ef4444 100%) !important;
  color: #ffffff !important;
  border: 1px solid #ff5252 !important;
}

::v-deep .compact-toggle .v-btn.geroButtonShort .v-icon,
::v-deep .full-width-toggle .v-btn.geroButtonShort .v-icon,
::v-deep .v-btn-toggle.compact-toggle .v-btn.geroButtonShort .v-icon,
::v-deep .v-btn-toggle.full-width-toggle .v-btn.geroButtonShort .v-icon {
  color: #ffffff !important;
}

/* Force override any conflicting styles */
::v-deep .v-btn.geroButtonShort.order-type-btn.compact.flex-btn {
  background: linear-gradient(135deg, #ff5252 0%, #ef4444 100%) !important;
  color: #ffffff !important;
  border-color: #ff5252 !important;
}

::v-deep .v-btn.geroButtonShort.order-type-btn.compact.flex-btn .v-icon {
  color: #ffffff !important;
}

/* Maximum specificity override for SHORT order type buttons */
::v-deep .v-btn-toggle.compact-toggle.full-width-toggle .v-btn.geroButtonShort.order-type-btn.compact.flex-btn,
::v-deep .compact-toggle.full-width-toggle .v-btn.geroButtonShort.order-type-btn.compact.flex-btn,
::v-deep .v-btn-toggle .v-btn.geroButtonShort.order-type-btn.compact.flex-btn:not(.v-btn--outlined) {
  background: linear-gradient(135deg, #ff5252 0%, #ef4444 100%) !important;
  background-color: #ff5252 !important;
  color: #ffffff !important;
  border: 1px solid #ff5252 !important;
  border-color: #ff5252 !important;
}

::v-deep .v-btn-toggle.compact-toggle.full-width-toggle .v-btn.geroButtonShort.order-type-btn.compact.flex-btn .v-icon,
::v-deep .compact-toggle.full-width-toggle .v-btn.geroButtonShort.order-type-btn.compact.flex-btn .v-icon,
::v-deep .v-btn-toggle .v-btn.geroButtonShort.order-type-btn.compact.flex-btn:not(.v-btn--outlined) .v-icon {
  color: #ffffff !important;
}

/* SHORT theme for order type buttons when active */
::v-deep .v-btn-toggle .v-btn.short-theme.geroButton,
::v-deep .v-btn-toggle .v-btn.short-theme.geroButton.v-btn--active,
::v-deep .v-btn-toggle .v-btn.short-theme.v-btn--active,
::v-deep .compact-toggle .v-btn.short-theme.geroButton,
::v-deep .full-width-toggle .v-btn.short-theme.geroButton {
  background: linear-gradient(135deg, #ff5252 0%, #ef4444 100%) !important;
  background-color: #ff5252 !important;
  color: #ffffff !important;
  border: 1px solid #ff5252 !important;
  border-color: #ff5252 !important;
}

::v-deep .v-btn-toggle .v-btn.short-theme.geroButton .v-icon,
::v-deep .v-btn-toggle .v-btn.short-theme.geroButton.v-btn--active .v-icon,
::v-deep .v-btn-toggle .v-btn.short-theme.v-btn--active .v-icon,
::v-deep .compact-toggle .v-btn.short-theme.geroButton .v-icon,
::v-deep .full-width-toggle .v-btn.short-theme.geroButton .v-icon {
  color: #ffffff !important;
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
  color: #75e0a7 !important;
  font-weight: 600 !important;
}

.loss {
  color: #fda29b !important;
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
  color: #75e0a7 !important;
  font-weight: 600 !important;
}

.status-closed {
  color: #9ca3af !important;
  font-weight: 500 !important;
}

.status-liquidated {
  color: #fda29b !important;
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
  color: #26fab0;
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
  color: #26fab0;
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
  color: #26fab0;
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
  line-height: 1;
}

.position-value-compact .value-ada {
  color: #9ca3af;
  font-size: 9px;
  line-height: 1;
  margin-top: 1px;
}

/* P&L values styling */
.pnl-values-compact {
  text-align: left;
}

.pnl-values-compact .pnl-percentage {
  font-size: 9px;
  line-height: 1;
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
  font-weight: 600;
  color: #26fab0;
  text-align: right;
}

.leverage-display.short-position {
  color: #ff5252 !important;
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
  color: #26fab0 !important;
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
  padding-left: 4px;
}

/* Close position button */
.close-position-btn {
  min-width: 75px !important;
  height: 32px !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.3px !important;
  border: 1px solid #fda29b !important;
  color: #fda29b !important;
  background: rgba(253, 162, 155, 0.05) !important;
  border-radius: 6px !important;
  transition: all 0.2s ease !important;
}

.close-position-btn:hover:not(:disabled) {
  background: rgba(253, 162, 155, 0.15) !important;
  border-color: #fda29b !important;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(253, 162, 155, 0.2) !important;
}

.close-position-btn:disabled {
  opacity: 0.6 !important;
  cursor: not-allowed !important;
  transform: none !important;
}

.close-position-btn .v-icon {
  color: #fda29b !important;
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
  color: #fda29b !important;
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
  color: #ffffff;
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
  background-color: #161b26 !important;
  transition: border-color 0.2s ease;
}

.input-card:hover {
  border-color: rgba(38, 250, 176, 0.3) !important;
}

.input-card.short-position {
  border-color: rgba(255, 82, 82, 0.2) !important;
}

.input-card.short-position:hover {
  border-color: rgba(255, 82, 82, 0.4) !important;
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

.input-suffix.short-position {
  color: #ff5252 !important;
}

/* Position and order type buttons */
.position-btn,
.order-type-btn {
  min-width: 80px !important;
  height: 36px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
}

.position-btn.compact,
.order-type-btn.compact {
  height: 28px !important;
  min-width: 60px !important;
  font-size: 11px !important;
}

::v-deep .v-btn-toggle .long-btn.geroButton {
  background: linear-gradient(
    135deg,
    rgba(38, 250, 176, 0.2) 0%,
    rgba(16, 185, 129, 0.1) 100%
  ) !important;
  color: #26fab0 !important;
  border: 1px solid rgba(38, 250, 176, 0.4) !important;
}

::v-deep .v-btn-toggle .long-btn.geroButton .v-icon {
  color: #26fab0 !important;
}

.long-btn:not(.geroButton) {
  background: transparent !important;
  color: rgba(38, 250, 176, 0.7) !important;
  border: 1px solid rgba(38, 250, 176, 0.2) !important;
}

.long-btn:not(.geroButton):hover {
  background: rgba(38, 250, 176, 0.1) !important;
  color: #26fab0 !important;
  border: 1px solid rgba(38, 250, 176, 0.3) !important;
}

::v-deep .v-btn-toggle .short-btn.geroButton {
  background: linear-gradient(
    135deg,
    rgba(255, 82, 82, 0.3) 0%,
    rgba(239, 68, 68, 0.2) 100%
  ) !important;
  color: #ff5252 !important;
  border: 1px solid rgba(255, 82, 82, 0.5) !important;
}

::v-deep .v-btn-toggle .short-btn.geroButton .v-icon {
  color: #ff5252 !important;
}

.short-btn:not(.geroButton) {
  background: transparent !important;
  color: rgba(255, 82, 82, 0.7) !important;
  border: 1px solid rgba(255, 82, 82, 0.2) !important;
}

.short-btn:not(.geroButton):hover {
  background: rgba(255, 82, 82, 0.1) !important;
  color: #ff5252 !important;
  border: 1px solid rgba(255, 82, 82, 0.3) !important;
}

.order-type-btn.geroButton {
  background: linear-gradient(135deg, #26fab0 0%, #1de89a 100%) !important;
  color: #1a1a1a !important;
  border: 1px solid #26fab0 !important;
}

.order-type-btn.geroButton .v-icon {
  color: #1a1a1a !important;
}

.order-type-btn.geroButtonShort,
::v-deep .order-type-btn.geroButtonShort {
  background: linear-gradient(135deg, #ff5252 0%, #ef4444 100%) !important;
  color: #ffffff !important;
  border: 1px solid #ff5252 !important;
}

.order-type-btn.geroButtonShort .v-icon,
::v-deep .order-type-btn.geroButtonShort .v-icon {
  color: #ffffff !important;
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
  color: #26fab0;
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
  color: #26fab0 !important;
  background: rgba(38, 250, 176, 0.05) !important;
}

.fees-tooltip-content {
  color: #ffffff !important;
  min-width: 200px;
}

.fees-title {
  color: #26fab0 !important;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(38, 250, 176, 0.2);
  padding-bottom: 4px;
}

.fees-title.short-position {
  color: #ff5252 !important;
  border-bottom: 1px solid rgba(255, 82, 82, 0.2);
}

/* Position value hover effect */
.position-value-hover {
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.position-value-hover:hover {
  opacity: 0.8;
}

/* Position main info section for tooltip */
.position-main-info {
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
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

.position-summary-card.short-position {
  background: rgba(255, 82, 82, 0.05) !important;
  border: 1px solid rgba(255, 82, 82, 0.2) !important;
}

.position-summary-card.compact {
  border-radius: 6px !important;
}

.summary-title {
  color: #ffffff;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 12px;
  text-align: center;
}

.summary-title.compact {
  font-size: 11px;
  margin-bottom: 4px;
}

.summary-title.short-position {
  color: #ffffff !important;
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
  color: #26fab0;
  font-weight: 600;
}

.summary-value.short-position {
  color: #ff5252 !important;
  font-weight: 600;
}

/* Short position button styling */
.open-position-btn.enhanced.short-position {
  background: linear-gradient(135deg, #ff5252 0%, #ef4444 100%) !important;
  color: #ffffff !important;
}

.open-position-btn.enhanced.short-position .v-icon {
  color: #ffffff !important;
}

.open-position-btn.enhanced.short-position:hover {
  background: linear-gradient(135deg, #ef4444 0%, #ff5252 100%) !important;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(255, 82, 82, 0.3) !important;
}

/* Enhanced open position button */
.open-position-btn.enhanced {
  background: linear-gradient(135deg, #26fab0 0%, #1de89a 100%) !important;
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
  background: linear-gradient(135deg, #1de89a 0%, #26fab0 100%) !important;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(38, 250, 176, 0.3) !important;
}
</style>
