<template>
  <div>
    <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="t('perpetuals.strikePerpetuals').toString()"
    :subtitle="t('perpetuals.tradePerpetualFutures').toString()"
    :min-height="734"
    :height="734"
    :width="1100"
    :scrollable="true"
    :persistent="false"
  >
    <v-card-text class="pt-1 dialog-content-container" style="z-index: 4">
      <v-row>
        <v-col cols="8">
          <!-- ADA/USD Chart Header -->
          <div
            class="d-flex align-items-center justify-space-between"
            style="margin-top: 5px; margin-bottom: 5px;"
          >
            <h4 class="column-title compact">{{ tickerSymbol }}/USD</h4>
            <span class="chart-timeframe">{{ t('perpetuals.24hPriceAction') }}</span>
          </div>

          <!-- TradingView ADA/USD Histogram Chart -->
          <div class="chart-section mb-3">
            <TradingViewChart
              :symbol="tickerSymbol + '/USD'"
              :data="chartData"
              :enableRealtime="true"
              :realtimeData="priceStore.adaUsd"
              width="100%"
              height="160px"
              theme="dark"
              @chartReady="onChartReady"
            />
          </div>

          <!-- Trading Tabs -->
          <div class="trading-tabs-container mb-2">
            <v-tabs
              v-model="activeTab"
              background-color="transparent"
              color="#26FAB0"
              slider-color="#26FAB0"
              height="32"
              @change="onTabChange"
            >
              <v-tab class="tab-item">
                <div class="d-flex align-items-center">
                  <span class="tab-text">{{ t('perpetuals.positions') }}</span>
                  <span v-if="positions.length > 0" class="tab-count ml-1">{{ positions.length }}</span>
                </div>
              </v-tab>
              <v-tab class="tab-item">
                <div class="d-flex align-items-center">
                  <span class="tab-text">{{ t('perpetuals.limitOrders') }}</span>
                  <span v-if="limitOrders.length > 0" class="tab-count ml-1">{{ limitOrders.length }}</span>
                </div>
              </v-tab>
              <v-tab class="tab-item">
                <div class="d-flex align-items-center">
                  <span class="tab-text">{{ t('perpetuals.history') }}</span>
                  <span v-if="history.length > 0" class="tab-count ml-1">{{ history.length }}</span>
                </div>
              </v-tab>
            </v-tabs>

            <div class="d-flex align-items-center">
              <v-btn
                icon
                x-small
                @click="refreshCurrentTab"
                :loading="isCurrentTabLoading"
                class="refresh-btn-external"
              >
                <v-icon x-small>mdi-reload</v-icon>
              </v-btn>
            </div>
          </div>

          <v-tabs-items v-model="activeTab">
            <!-- Positions Tab -->
            <v-tab-item>
              <!-- Loading state -->
              <div v-if="loadingPositions" class="loading-state">
                <v-progress-circular
                  indeterminate
                  color="#26FAB0"
                  size="40"
                />
                <p class="mt-3">{{ t('perpetuals.loadingPositions') }}</p>
              </div>

              <!-- Empty state -->
              <div v-else-if="positions.length === 0" class="empty-state">
                <v-icon size="48" color="grey">mdi-chart-line</v-icon>
                <p class="mt-2">{{ t('perpetuals.noOpenPositions') }}</p>
                <p class="mt-1 text-caption">
                  {{ t('perpetuals.yourPerpetualPositions') }}
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
              <template v-slot:[`header.collateral`]="{ header }">
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
                      color="#26FAB0"
                      v-model="currentPositionsPage"
                      :length="
                          Math.ceil(positions.length / positionsPerPage)
                        "
                      :total-visible="5"
                      circle
                      class="compact-pagination ma-0"
                    />
                  </td>
                </tr>
              </template>
              <template v-slot:[`item.asset`]="{ item }">
                <div class="d-flex align-items-center pl-2">
                  <div class="asset-info d-flex flex-column justify-center">
                    <div class="asset-name text-center">{{ item.asset?.ticker || 'ADA' }}</div>
                    <div class="asset-leverage text-caption text--secondary text-center">{{ item.leverage }}x</div>
                  </div>
                  <v-avatar
                    v-if="
                        item.pnl !== undefined ||
                        item.unrealizedPnl !== undefined
                      "
                    tile
                    size="16"
                    class="ml-2 align-self-center"
                  >
                    <v-img
                      :src="getPositionTrendIcon(item)"
                      :alt="t('perpetuals.pnlTrend')"
                    />
                  </v-avatar>
                </div>
              </template>

              <!-- Position Type column with chip -->
              <template v-slot:[`item.positionType`]="{ item }">
                <v-chip
                  v-if="item.position"
                  :color="
                      (item.position || '').toUpperCase() === 'LONG'
                        ? 'success'
                        : 'error'
                    "
                  x-small
                  label
                  class="ultra-compact-chip"
                  :style="
                      (item.position || '').toUpperCase() === 'LONG'
                        ? 'background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0.1) 100%) !important; color: #10b981 !important; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 9px !important; height: 20px !important; padding: 0 6px !important;'
                        : 'background: linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.1) 100%) !important; color: #ef4444 !important; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 9px !important; height: 20px !important; padding: 0 6px !important;'
                    "
                >
                  {{ (item.position || '').toUpperCase() }}
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
                          ${{ item.currentPositionValueUsd?.toFixed(2) || '0.00' }}
                        </div>
                        <div class="value-ada">
                          {{ item.currentPositionValueAda?.toFixed(2) || '0.00' }}A
                        </div>
                      </div>
                    </template>
                    <div class="fees-tooltip-content">
                      <div class="fees-title">{{ t('perpetuals.positionBreakdown') }}</div>
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
                          <span>{{ t('perpetuals.openingFee') }}</span>
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
                          <span>{{ t('perpetuals.hourlyBorrowFee') }}</span>
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
                          <span>{{ t('perpetuals.nextHourlyFeeUpdate') }}</span>
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
                          <span>{{ t('perpetuals.liquidationAfterHourly') }}</span>
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
                          <span>{{ t('perpetuals.accumulatedBorrowFee') }}</span>
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
                          <span>{{ t('perpetuals.pnlLabel') }}</span>
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
                          <span><strong>{{ t('perpetuals.pnlWithFees') }}</strong></span>
                          <span
                            :class="calculatePositionFees(item, perpetualsPrice?.lastPrice)?.pnlWithFees >= 0 ? 'profit' : 'loss'"
                            style="font-weight: 600"
                          >
                              <strong>
                                {{ formatCurrency(calculatePositionFees(item, perpetualsPrice?.lastPrice)?.pnlWithFees || 0) }}
                              </strong>
                            </span>
                        </div>
                      </div>
                      <div v-else class="fee-item">
                        <span>{{ t('perpetuals.tooltipUnavailable') }}</span>
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
                    ${{ item.entryPrice?.toFixed(4) || '0.0000' }}
                  </div>
                  <div
                    v-if="
                        item.markPrice !== undefined &&
                        item.markPrice !== item.entryPrice
                      "
                    class="mark-price"
                  >
                    / ${{ item.markPrice?.toFixed(4) || '0.0000' }}
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
                      :alt="t('perpetuals.trend')"
                    />
                  </v-avatar>
                  <div class="pnl-values-compact">
                    <div :class="calculatePositionFees(item, perpetualsPrice?.lastPrice)?.pnlWithFees >= 0 ? 'profit' : 'loss'">
                      {{ formatCurrency(calculatePositionFees(item, perpetualsPrice?.lastPrice)?.pnlWithFees || 0) }}
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

              <!-- Collateral column -->
              <template v-slot:[`item.collateral`]="{ item }">
                <div class="text-center">
                  <span class="font-weight-medium">
                    ${{ getCollateralAmount(item) }}
                  </span>
                </div>
              </template>

              <!-- Actions column -->
              <template v-slot:[`item.actions`]="{ item }">
                <v-btn
                  color="error"
                  text
                  x-small
                  @click="closePosition(item)"
                  :loading="closingPositions[`${item.outRef.txHash}#${item.outRef.outputIndex}`]"
                  class="close-position-btn-compact mr-1"
                  :disabled="closingPositions[`${item.outRef.txHash}#${item.outRef.outputIndex}`]"
                >
                  <v-icon x-small>mdi-close</v-icon>
                </v-btn>
              </template>
            </v-data-table>
              </div>
            </v-tab-item>

            <!-- Limit Orders Tab -->
            <v-tab-item>
              <!-- Loading state -->
              <div v-if="loadingLimitOrders" class="loading-state">
                <v-progress-circular
                  indeterminate
                  color="#26FAB0"
                  size="40"
                />
                <p class="mt-3">{{ t('perpetuals.loadingLimitOrders') }}</p>
              </div>

              <!-- Empty state -->
              <div v-else-if="limitOrders.length === 0" class="empty-state">
                <v-icon size="48" color="grey">mdi-target</v-icon>
                <p class="mt-2">{{ t('perpetuals.noLimitOrders') }}</p>
                <p class="mt-1 text-caption">
                  {{ t('perpetuals.yourPendingLimitOrders') }}
                </p>
              </div>

              <!-- Limit Orders table -->
              <div v-else class="positions-table">
                <v-data-table
                  dense
                  class="transparent positions-data-table"
                  :headers="limitOrderHeaders"
                  :items="paginatedLimitOrders"
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
                  <template v-slot:[`header.limitPrice`]="{ header }">
                    <span style="padding: 0 8px">{{ header.text }}</span>
                  </template>
                  <template v-slot:[`header.collateral`]="{ header }">
                    <span style="padding: 0 8px">{{ header.text }}</span>
                  </template>
                  <template v-slot:[`header.status`]="{ header }">
                    <span style="padding: 0 8px">{{ header.text }}</span>
                  </template>
                  <template v-slot:[`header.actions`]="{ header }">
                    <span style="padding: 0 8px">{{ header.text }}</span>
                  </template>

                  <template v-slot:[`item.asset`]="{ item }">
                    <div class="d-flex align-items-center pl-2">
                      <div class="asset-info d-flex flex-column justify-center">
                        <div class="asset-name text-center">{{ item.asset?.ticker || 'ADA' }}</div>
                        <div class="asset-leverage text-caption text--secondary text-center">{{ item.leverage }}x</div>
                      </div>
                    </div>
                  </template>

                  <template v-slot:[`item.positionType`]="{ item }">
                    <v-chip
                      v-if="item.position || item.type"
                      :color="(item.position || item.type || '').toUpperCase() === 'LONG' ? 'success' : 'error'"
                      x-small
                      label
                      class="ultra-compact-chip"
                      :style="(item.position || item.type || '').toUpperCase() === 'LONG'
                        ? 'background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0.1) 100%) !important; color: #10b981 !important; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 9px !important; height: 20px !important; padding: 0 6px !important;'
                        : 'background: linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.1) 100%) !important; color: #ef4444 !important; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 9px !important; height: 20px !important; padding: 0 6px !important;'"
                    >
                      {{ (item.position || item.type || '').toUpperCase() }}
                    </v-chip>
                    <span v-else>-</span>
                  </template>

                  <template v-slot:[`item.limitPrice`]="{ item }">
                    <div class="price-values-compact">
                      <div class="entry-price">
                        ${{ item.limitUSDPrice?.toFixed(2) || item.price?.toFixed(2) || '--' }}
                      </div>
                    </div>
                  </template>

                  <template v-slot:[`item.collateral`]="{ item }">
                    <div class="collateral-values-compact">
                      <div class="collateral-usd">${{ item.collateralAmount?.toFixed(2) || '0.00' }}</div>
                    </div>
                  </template>

                  <template v-slot:[`item.status`]="{ item }">
                    <v-chip
                      :color="getPositionStatusColor(item.status)"
                      x-small
                      label
                      class="status-chip"
                    >
                      {{ (item.status || t('perpetuals.unknown')).toUpperCase() }}
                    </v-chip>
                  </template>

                  <template v-slot:[`item.actions`]="{ item }">
                    <div class="d-flex justify-center">
                      <v-btn
                        color="error"
                        text
                        x-small
                        @click="cancelLimitOrder(item)"
                        :loading="cancellingOrders[`${item.outRef.txHash}#${item.outRef.outputIndex}`]"
                        class="close-position-btn-compact mr-1"
                        :disabled="cancellingOrders[`${item.outRef.txHash}#${item.outRef.outputIndex}`]"
                      >
                        <v-icon x-small>mdi-close</v-icon>
                      </v-btn>
                    </div>
                  </template>
                </v-data-table>
              </div>
            </v-tab-item>

            <!-- History Tab -->
            <v-tab-item>
              <v-card class="transparent history-card-container">
                <v-card-text class="pa-0 history-card-content">
                  <!-- Loading state -->
                  <div v-if="loadingHistory" class="loading-state">
                    <v-progress-circular
                      indeterminate
                      color="#26FAB0"
                      size="40"
                    />
                    <p class="mt-3">{{ t('perpetuals.loadingHistory') }}</p>
                  </div>

                  <!-- Empty state -->
                  <div v-else-if="history.length === 0" class="empty-state">
                    <v-icon size="48" color="grey">mdi-format-list-bulleted</v-icon>
                    <p class="mt-2">{{ t('perpetuals.noHistory') }}</p>
                    <p class="mt-1 text-caption">
                      {{ t('perpetuals.allPositionsAndOrders') }}
                    </p>
                  </div>

                  <!-- History table -->
                  <div v-else class="positions-table">
                    <v-data-table
                      dense
                      class="transparent positions-data-table"
                      :headers="historyHeaders"
                      :items="paginatedHistory"
                      :items-per-page="positionsPerPage"
                      hide-default-footer
                      :header-props="{ 'sort-icon': 'mdi-menu-up' }"
                    >
                      <!-- Custom headers with padding -->
                      <template v-slot:[`header.action`]="{ header }">
                        <span style="padding-left: 12px">{{ header.text }}</span>
                      </template>


                      <template v-slot:[`item.asset`]="{ item }">
                        <div class="d-flex align-items-center pl-2">
                          <div class="asset-info d-flex flex-column justify-center">
                            <div class="asset-name text-center">{{ item.asset?.ticker || 'ADA' }}</div>
                          </div>
                        </div>
                      </template>

                      <template v-slot:[`item.action`]="{ item }">
                        <v-chip
                          x-small
                          label
                          class="ultra-compact-chip"
                          :style="(item.position || item.type)?.toUpperCase() === 'LONG'
                        ? 'background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0.1) 100%) !important; color: #10b981 !important; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 9px !important; height: 20px !important; padding: 0 6px !important;'
                        : 'background: linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.1) 100%) !important; color: #ef4444 !important; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 9px !important; height: 20px !important; padding: 0 6px !important;'"
                          :color="(item.position || item.type)?.toUpperCase() === 'LONG' ? 'success' : 'error'"
                        >
                          <v-icon class="mr-1" x-small :color="(item.position || item.type)?.toUpperCase() === 'LONG' ? 'success' : 'error'">{{
                              item.action?.includes('Limit') ? "mdi-target"
                                : "mdi-flash"
                            }}</v-icon>
                          {{ (item.action)?.toUpperCase() }}
                        </v-chip>
                      </template>

                      <template v-slot:[`item.entryPrice`]="{ item }">
                        <div class="price-values-compact">
                          <div class="entry-price">${{ (item.entryPrice || item.price)?.toFixed(2) || '0.00' }}</div>
                        </div>
                      </template>

                      <template v-slot:[`item.finalPnl`]="{ item }">
                        <div class="d-flex align-items-center justify-center">
                          <v-avatar tile size="10" class="mr-1 trend-icon-centered">
                            <v-img
                              :src="(item.pnl || 0) > 0 ? assets.trendUpSvg : (item.pnl || 0) < 0 ? assets.trendDownSvg : assets.arrowRightSvg"
                              :alt="t('perpetuals.trend')"
                            />
                          </v-avatar>
                          <div class="pnl-values-compact">
                            <div :class="(item.pnl || 0) > 0 ? 'profit' : (item.pnl) == 0 ? 'even' : 'loss'">
                              {{ formatCurrency(item.pnl || 0) }}
                            </div>
                          </div>
                        </div>
                      </template>
                      <template v-slot:[`item.closedTime`]="{ item }">
                        <div class="text-caption">
                          {{ item.enteredPositionTime ? formatDate(item.enteredPositionTime) : '-' }}
                        </div>
                      </template>
                    </v-data-table>
                  </div>
                </v-card-text>
                <v-card-actions v-if="history.length > positionsPerPage" class="text-center justify-center">
                  <v-pagination
                    color="#26FAB0"
                    v-model="currentHistoryPage"
                    :length="Math.ceil(history.length / positionsPerPage)"
                    :total-visible="7"
                    circle
                    class="compact-pagination ma-0"
                  />
                </v-card-actions>
              </v-card>
            </v-tab-item>
          </v-tabs-items>
        </v-col>
        <v-col cols="4">
          <div
            class="d-flex align-items-center justify-space-between mb-2"
          >
            <h4 class="column-title compact" style="align-content: center;">{{ t('perpetuals.openNewPosition') }}</h4>
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

          <!-- Step 1: Position Direction -->
            <div class="form-section compact">
              <div class="form-label compact">{{ t('perpetuals.positionDirection') }}</div>
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
                  {{ $t('perpetuals.long') }}
                </v-btn>
                <v-btn
                  value="SHORT"
                  small
                  rounded
                  class="position-btn short-btn compact flex-btn"
                >
                  <v-icon x-small class="mr-1">mdi-trending-down</v-icon>
                  {{ $t('perpetuals.short') }}
                </v-btn>
              </v-btn-toggle>
            </div>

            <!-- Step 2: Order Type -->
            <div class="form-section compact">
              <div class="form-label compact">{{ t('perpetuals.orderType') }}</div>
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
              <div class="form-label compact">
                Limit Price
                <v-tooltip top content-class="custom-tooltip">
                  <template v-slot:activator="{ on, attrs }">
                    <v-icon
                      small
                      class="ml-1"
                      v-bind="attrs"
                      v-on="on"
                      color="grey"
                    >
                      mdi-help-circle-outline
                    </v-icon>
                  </template>
                  <span>
                    Price at which your limit order executes.
                    Long: Set below current price.
                    Short: Set above current price.
                  </span>
                </v-tooltip>
              </div>
              <v-card
                class="input-card compact"
                outlined
                :class="{
                    'short-position': positionData.position === 'SHORT',
                    'invalid-input': limitPriceValidation.isInvalid
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

              <!-- Limit Price Validation Warning -->
              <div
                v-if="limitPriceValidation.isInvalid && positionData.limitPrice > 0"
                class="limit-price-warning mt-2"
              >
                <v-icon small color="#f59e0b" class="mr-1">mdi-alert</v-icon>
                <span class="warning-text">{{ limitPriceValidation.message }}</span>
              </div>
            </div>

            <!-- Step 3: Collateral Amount -->
            <div class="form-section compact">
              <div class="d-flex align-center justify-space-between">
                <div class="form-label compact">{{ t('perpetuals.collateral') }}</div>
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
                <div class="form-label compact">{{ t('perpetuals.leverage') }}</div>
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
                hide-details
                v-model="positionData.leverage"
                :min="1.1"
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
                      >{{ t('perpetuals.takeProfitStopLoss') }}</span
                      >
                      <span class="tp-sl-subtitle compact"
                      >({{ $t('common.optional') }})</span
                      >
                    </div>
                  </v-expansion-panel-header>
                  <v-expansion-panel-content
                    class="tp-sl-content compact"
                  >
                    <!-- Take Profit -->
                    <div class="mb-2">
                      <div class="form-label small compact">
                        {{ t('perpetuals.takeProfitPrice') }}
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
                              v-model="positionData.takeProfitPrice"
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
                        {{ t('perpetuals.stopLossPrice') }}
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
                              v-model="positionData.stopLossPrice"
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

          <!-- Position Summary -->
          <div class="form-section compact mt-3">
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
                          {{ t('perpetuals.viewFees') }}
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
                          {{ t('perpetuals.tradingFees') }}
                        </div>
                        <div class="fee-item">
                          <span>{{ t('perpetuals.openingFee') }}</span>
                          <span>0.1%</span>
                        </div>
                        <div class="fee-item">
                          <span>{{ t('perpetuals.hourlyBorrowFee') }}</span>
                          <span>~0.001%</span>
                        </div>
                        <div class="fee-item">
                          <span>{{ t('perpetuals.accumulatedBorrowFee') }}</span>
                          <span
                          >{{
                              (accumulatedBorrowFee * 100).toFixed(4)
                            }}%</span
                          >
                        </div>
                        <div class="fee-item">
                          <span>{{ t('perpetuals.networkFee') }}</span>
                          <span>~2-5 ADA</span>
                        </div>
                      </div>
                    </v-tooltip>
                  </div>
                  <div class="summary-row compact">
                    <span>{{ t('perpetuals.positionSize') }}:</span>
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
                    <span>{{ t('perpetuals.notionalValue') }}</span>
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
                    <span>{{ t('perpetuals.estLiqPrice') }}</span>
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
          <div class="mt-3">
            <v-btn
              color="primary"
              block
              @click="openPosition"
              :loading="loading || openingPosition"
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
              {{ buttonText }}
            </v-btn>
          </div>
        </v-col>
      </v-row>
    </v-card-text>

    <!-- Powered by Strike Finance Footer - positioned at dialog bottom -->
    <div class="d-flex align-center justify-center py-2 dialog-footer">
      <span class="powered-by-text mr-2">{{ t('perpetuals.poweredBy') }}</span>
      <img
        src="https://app.strikefinance.org/logo.svg"
        :alt="t('perpetuals.strikeLogo').toString()"
        class="strike-logo"
        @error="onLogoError"
      />
    </div>
  </BaseDialog>

  <!-- Update Position Dialog -->
  <v-dialog
    v-model="updatePositionDialog"
    max-width="400"
    persistent
  >
    <v-card>
      <v-card-title class="headline">
        {{ t('perpetuals.updatePosition') }}
      </v-card-title>

      <v-card-text>
        <div v-if="selectedPosition" class="mb-4">
          <div class="position-info mb-3">
            <v-chip
              :color="selectedPosition.position === 'Long' ? 'success' : 'error'"
              small
              class="mr-2"
            >
              {{ selectedPosition.position.toUpperCase() }}
            </v-chip>
            <span class="asset-name">{{ selectedPosition.asset.asset?.ticker || 'ADA' }}</span>
          </div>

          <v-text-field
            v-model="updatePositionData.stopLossPrice"
            :label="t('perpetuals.stopLossPriceUsd')"
            type="number"
            step="0.01"
            min="0"
            outlined
            dense
            prepend-inner-icon="mdi-stop-circle"
            :placeholder="selectedPosition.stopLossPrice?.toString() || '0.00'"
            class="mb-3"
          />

          <v-text-field
            v-model="updatePositionData.takeProfitPrice"
            :label="t('perpetuals.takeProfitPriceUsd')"
            type="number"
            step="0.01"
            min="0"
            outlined
            dense
            prepend-inner-icon="mdi-target"
            :placeholder="selectedPosition.takeProfitPrice?.toString() || '0.00'"
          />
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn
          text
          @click="updatePositionDialog = false"
        >
          {{ t('perpetuals.cancel') }}
        </v-btn>
        <v-btn
          color="primary"
          @click="updatePosition"
        >
          {{ t('perpetuals.update') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
const { t } = useTranslation();
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRefs, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import TradingViewChart from '@/shared/components/TradingViewChart.vue';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import assets from '@/utils/assets';
import strikeFinanceApi, {
  Asset,
  CancelLimitOrderRequest,
  ClosePerpetualRequest,
  CreateLimitOrderRequest,
  CreatePerpetualRequest,
  LimitOrder,
  PerpetualPosition,
  UpdatePositionRequest,
} from '@/api/strike-finance.api';
import type { IChartApi, Time } from 'lightweight-charts';
import { priceService, priceStore } from '@/stores/priceStore';
import { AxiosResponse } from 'axios';
import { Messaging } from '@/chrome/messaging';
import { METHOD } from '@/chrome/config';
import snackbar from '@/plugins/snackbar';
import { MessageTypes } from '@/models/MessageTypes';
import { debugLog } from '@/utils/debug';

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

const { loggedWallet, tokens, utxos } = toRefs(walletStore);
const { price } = toRefs(networkStore);

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
  const currentTime = Date.now() + 300000; // Add 5 minutes (300,000 ms) for a validity interval
  const hoursElapsed = (currentTime - enteredPositionTime) / (1000 * 60 * 60);
  return hourlyBorrowFee * hoursElapsed;
};

// Calculate the next hourly fee countdown
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
  // Get a percentage-use version if provided, otherwise use dynamic calculation
  const percentage = version
    ? getVersionPercentage(version, token)
    : openingFee(position, totalLongInterest, totalShortInterest, token);

  // Platform fee: percentage of position size OR at least 2 ADA/SNEK
  const platformFee = Math.max(positionSize * percentage, 2);
  const lpFee = positionSize * 0.002;
  return platformFee + lpFee;
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
  _token: "ada" | "snek" = "ada"
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
    Math.max(2, Math.abs(value) < 0.01 ? 2 : 2)
  );
  return value < 0 ? `-$${formattedValue}` : `$${formattedValue}`;
};

// Format price with minimum digits - exactly matching the React component
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

  // Find the first non-zero digit in the decimal part
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
  let openingFee: number;
  if (openingUSDFee) {
    openingFee = openingUSDFee;
  } else {
    openingFee = calculateOpeningFee(size, entryPrice, 0, 0, "Long", version);
  }
  const accumulatedBorrowFee = calculateAccumulatedBorrowFee(hourlyBorrowFee, enteredPositionTime);
  return Number((basePNL - openingFee - accumulatedBorrowFee).toFixed(2));
};

// Calculate detailed position fees breakdown - matching React PositionValueTooltip exactly
const calculatePositionFees = (position: any, currentPrice: number) => {
  if (!position) return null;

  // Extract props exactly as a component receives them
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

  return {
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
  const hoursElapsed = (targetTime - enteredPositionTime) / (1000 * 60 * 60);
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

  // Use Kraken WebSocket ADA price as the current price for perpetuals (more accurate for trading)
  if (perpetualsPrice.value?.lastPrice) {
    result.currentPrice = Number(perpetualsPrice.value.lastPrice);
  } else if (position.currentPrice !== undefined) {
    result.currentPrice = Number(position.currentPrice);
  }

  // Use mark price from API if available, otherwise fallback to the current price
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

    // Calculate real-time accumulated borrow fee if the position has entered time
    if (
      position.enteredPositionTime &&
      position.hourlyBorrowFee !== undefined
    ) {
      accumulatedFees = calculateAccumulatedBorrowFee(
        Number(position.hourlyBorrowFee),
        Number(position.enteredPositionTime)
      );
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

    // Get real-time fees using the same calculation as the tooltip
    const tooltipFees = calculatePositionFees(position, currentPrice);
    // Only use accumulated borrow fees, not opening fees (opening fees are in PNL)
    // Use only borrow fees for position value (opening fees already in PNL)
    const totalFeesToUse = tooltipFees ? tooltipFees.accumulatedBorrowFeeUSD : 0;

    // Final position value = base value + PNL - fees (including real-time borrow fees)
    const finalPositionValueUsd = basePositionValueUsd + pnl - totalFeesToUse;


    result.currentPositionValueUsd = Number(finalPositionValueUsd.toFixed(2));
    result.currentPositionValueAda = collateralSizeAda;
  }

  return result;
};


const loading = ref(false);
const rawPositions = ref<PerpetualPosition[]>([]);

// TradingView chart data and handlers
const chartData = ref<CandlestickDataPoint[]>([]);
const chart = ref<IChartApi | null>(null);
const shouldFetchChartData = ref(false);

// Generate or fetch chart data based on the ticker
const generateChartData = async (): Promise<CandlestickDataPoint[]> => {
  const ticker = tickerSymbol.value;

  if (ticker === 'ADA') {
    // Fetch real ADA/USD data from Kraken
    try {
      const response = await fetch('https://api.kraken.com/0/public/OHLC?pair=ADAUSD&interval=5');
      const data = await response.json();

      if (data.error && data.error.length > 0) {
        throw new Error(`Kraken API error: ${data.error.join(', ')}`);
      }

      // Find the pair key in the result
      const pairKey = Object.keys(data.result).find(
        key => key !== 'last' && key.toUpperCase().includes('ADAUSD')
      );

      if (!pairKey || !data.result[pairKey]) {
        console.warn('[StrikeFinance] No OHLC data found for ADA/USD');
        return generateSimpleOHLCData();
      }

      const krakenData = data.result[pairKey];

      // Convert Kraken format to chart format
      const chartData: CandlestickDataPoint[] = krakenData.map((candle: any[]) => ({
        time: candle[0] as Time,
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4])
      })).sort((a: any, b: any) => a.time - b.time);

      debugLog(`[StrikeFinance] Fetched ${chartData.length} candles from Kraken for ADA/USD`);
      return chartData;

    } catch (error) {
      console.error('[StrikeFinance] Failed to fetch ADA data from Kraken:', error);
      return generateSimpleOHLCData();
    }
  } else {
    // For other tokens, use TapTools/DexHunter
    return fetchTokenHistoryFromDexHunter(ticker);
  }
};

// Fetch token price history from DexHunter API
const fetchTokenHistoryFromDexHunter = async (
  ticker: string
): Promise<CandlestickDataPoint[]> => {
  try {
    debugLog(`[StrikeFinance] Fetching ${ticker} price history from DexHunter/TapTools`);

    // Since the TradingViewChart component now handles the fetching,
    // we can just return the empty array and let the component handle it
    return [];
  } catch (error) {
    console.warn(`[StrikeFinance] Failed to fetch ${ticker} data:`, error);
    return generateSimpleOHLCData();
  }
};

// Generate simple OHLC data based on the current ADA price
const generateSimpleOHLCData = (): CandlestickDataPoint[] => {
  const data: CandlestickDataPoint[] = [];
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  let currentPrice = perpetualsPrice.value?.lastPrice || 0.58; // Use real ADA price or fallback

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


const onChartReady = (chartInstance: IChartApi) => {
  chart.value = chartInstance;

  // Immediately resize chart to proper dimensions
  setTimeout(() => {
    if (chart.value) {
      try {
        const chartContainer = document.querySelector('.chart-section');
        if (chartContainer) {
          const containerWidth = chartContainer.clientWidth;
          const containerHeight = 160;

          debugLog("PerpetualsDialog: Initial chart resize to", containerWidth, "x", containerHeight);

          chart.value.applyOptions({
            width: containerWidth,
            height: containerHeight,
          });
          chart.value.timeScale().fitContent();
        }
      } catch (error) {
        console.warn("PerpetualsDialog: Failed initial chart resize:", error);
      }
    }
  }, 50); // Quick resize after chart ready
};

// Update chart data periodically (every 30 seconds)
let chartUpdateInterval: NodeJS.Timeout | null = null;

// Update accumulated borrow fees every minute
let borrowFeeUpdateInterval: NodeJS.Timeout | null = null;
const borrowFeeUpdateTrigger = ref(0);

// Real-time countdown for next hourly fee update
let countdownInterval: NodeJS.Timeout | null = null;

const startChartUpdates = () => {
  if (chartUpdateInterval) {
    clearInterval(chartUpdateInterval);
  }

  // Chart component handles its own updates for all tickers
  debugLog(
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
    debugLog("Updated real-time accumulated borrow fees");
  }, 60000); // Every 60 seconds

  // Update countdown every second for a real-time display
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

// Alias for positions - used for checking if position still exists during polling
const perpetualPositions = computed(() => positions.value);

// Reactive positions that update when ADA price changes
const positions = computed(() => {
  console.log('🔍 [PerpetualsDialog] Positions computed - rawPositions.value:', {
    length: rawPositions.value.length,
    hasData: rawPositions.value.length > 0,
    allPositions: rawPositions.value,
    allStatuses: rawPositions.value.map(p => ({ id: p.id, status: p.status }))
  });

  if (!rawPositions.value.length) {
    console.log('🔍 [PerpetualsDialog] No rawPositions available, returning empty array');
    return [];
  }

  // For Positions tab: show all positions regardless of status
  // The API should only return active positions, not completed/closed ones
  // If we need to filter, we should use an inclusive filter (e.g., status === 'ACTIVE')
  // rather than an exclusive filter
  const filteredPositions = rawPositions.value;

  console.log('🔍 [PerpetualsDialog] Processing positions:', {
    count: filteredPositions.length,
    positions: filteredPositions
  });

  return filteredPositions.map((position, index) => {
    // Re-process position data with the current price
    const processedData = processPositionData(position);

    console.log(`🔍 [PerpetualsDialog] Processed position ${index}:`, {
      id: position.id,
      status: position.status,
      processedData
    });

    // Return an enhanced position with updated calculations
    return {
      ...position,
      ...processedData,
    };
  });
});

// Ticker symbol for the chart (extracted from the trading pair)
const tickerSymbol = computed(() => {
  return "ADA"; // Default to ADA can be made dynamic based on the selected asset
});

const closingPositions = ref<Record<string, boolean>>({});
const closingPositionIntervals = ref<Record<string, number>>({});
const loadingPositions = ref(false);
const limitOrders = ref<LimitOrder[]>([]);
const loadingLimitOrders = ref(false);
const cancellingOrders = ref<Record<string, boolean>>({});
const cancellingOrderIntervals = ref<Record<string, number>>({});
const openingPosition = ref(false);
const openingPositionInterval = ref<number | null>(null);
const activeTab = ref(0);
const history = ref<any[]>([]);
const loadingHistory = ref(false);
const currentLimitOrdersPage = ref(1);
const currentHistoryPage = ref(1);
const updatePositionDialog = ref(false);
const selectedPosition = ref<PerpetualPosition | null>(null);
const updatePositionData = ref({
  stopLossPrice: 0,
  takeProfitPrice: 0
});


// Component cleanup
onBeforeUnmount(() => {
  stopChartUpdates();
});

// Pagination for positions table (consistent with TokensTab.vue)
const currentPositionsPage = ref(1);
const positionsPerPage = ref(7); // Match tokens table default

// Computed for paginated positions
const paginatedPositions = computed(() => {
  const start = (currentPositionsPage.value - 1) * positionsPerPage.value;
  const end = start + positionsPerPage.value;
  return positions.value.slice(start, end);
});

// Computed for paginated limit orders
const paginatedLimitOrders = computed(() => {
  const start = (currentLimitOrdersPage.value - 1) * positionsPerPage.value;
  const end = start + positionsPerPage.value;
  return limitOrders.value.slice(start, end);
});

// Computed for paginated history
const paginatedHistory = computed(() => {
  const start = (currentHistoryPage.value - 1) * positionsPerPage.value;
  const end = start + positionsPerPage.value;
  return history.value.slice(start, end);
});

// Computed for loading state based on the active tab
const isCurrentTabLoading = computed(() => {
  switch (activeTab.value) {
    case 0: return loadingPositions.value;
    case 1: return loadingLimitOrders.value;
    case 2: return loadingHistory.value;
    default: return false;
  }
});

const positionData = ref({
  asset: "ADA/USD",
  collateralAmount: 0,
  leverage: 1.1,
  position: "LONG",
  orderType: "MARKET", // MARKET or LIMIT
  limitPrice: 0,
  stopLossPrice: 0,
  takeProfitPrice: 0,
});

// Table headers for positions - ultra-compact for more space
const positionHeaders = ref([
  {
    text: String(t('perpetuals.asset')),
    align: "start",
    sortable: true,
    value: "asset",
    width: "35",
  },
  {
    text: String(t('perpetuals.side')),
    align: "center",
    sortable: true,
    value: "positionType",
    width: "28",
  },
  {
    text: String(t('perpetuals.value')),
    align: "center",
    sortable: true,
    value: "currentValue",
    width: "42",
  },
  {
    text: String(t('perpetuals.entryMark')),
    align: "center",
    sortable: true,
    value: "entryPrice",
    width: "52",
  },
  { text: String(t('perpetuals.pnl')), align: "center", sortable: true, value: "pnlWithFees", width: "42" },
  {
    text: String(t('perpetuals.collateral')),
    align: "center",
    sortable: true,
    value: "collateral",
    width: "60",
  },
  { text: "", align: "center", sortable: false, value: "actions", width: "26" },
]);

// Limit Order Headers
const limitOrderHeaders = ref([
  {
    text: String(t('perpetuals.asset')),
    align: "start",
    sortable: true,
    value: "asset",
    width: "25",
  },
  {
    text: String(t('perpetuals.side')),
    align: "center",
    sortable: true,
    value: "positionType",
    width: "20",
  },
  {
    text: String(t('perpetuals.price')),
    align: "center",
    sortable: true,
    value: "limitPrice",
    width: "22",
  },
  {
    text: String(t('perpetuals.collateral')),
    align: "center",
    sortable: true,
    value: "collateral",
    width: "25",
  },
  {
    text: String(t('perpetuals.status')),
    align: "center",
    sortable: true,
    value: "status",
    width: "20",
  },
  { text: "", align: "center", sortable: false, value: "actions", width: "15" },
]);

// History Headers
const historyHeaders = ref([
  {
    text: String(t('perpetuals.type')),
    align: "start",
    sortable: true,
    value: "action",
    width: "164",
  },
  {
    text: String(t('perpetuals.asset')),
    align: "center",
    sortable: true,
    value: "asset",
    width: "10",
  },
  {
    text: String(t('perpetuals.entryPrice')),
    align: "start",
    sortable: true,
    value: "entryPrice",
    width: "20",
  },
  {
    text: String(t('perpetuals.pnl')),
    align: "center",
    sortable: true,
    value: "finalPnl",
    width: "20",
  },
  {
    text: String(t('perpetuals.date')),
    align: "center",
    sortable: true,
    value: "closedTime",
    width: "126",
  },
]);

// Computed properties
const availableAdaBalance = computed(() => {
  // Get ADA balance from the wallet store (simplified - you might need to access the actual balance)
  const adaToken = Object.values(tokens.value).find(
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
      debugLog("PerpetualsDialog: Dialog opened, optimizing load sequence");

      // Start positions loading immediately for the main tab
      const positionsPromise = loadPositions(false);

      // Start background tasks in parallel
      const backgroundTasks = Promise.allSettled([
        // Generate chart data
        (async () => {
          try {
            chartData.value = await generateChartData();
            debugLog("PerpetualsDialog: Initialized chart data with", chartData.value.length, "points");
          } catch (error) {
            console.error("Failed to initialize chart data:", error);
            chartData.value = generateSimpleOHLCData();
          }
        })(),
        // Price service initialization (non-blocking)
        (async () => {
          if (!priceService.isConnected()) {
            try {
              await priceService.initialize();
              debugLog("PerpetualsDialog: Price service initialized");
            } catch (error) {
              console.warn("PerpetualsDialog: Failed to initialize price service:", error);
            }
          }
        })(),
        // Load secondary tab data
        loadLimitOrders(false),
        loadHistory()
      ]);

      // Enable the chart after a brief delay to ensure the component is ready
      setTimeout(async () => {
        await nextTick();
        shouldFetchChartData.value = true;
        debugLog("PerpetualsDialog: Enabled chart data fetching");
        startChartUpdates();
      }, 10);

      // Handle chart resize with proper dimensions
      setTimeout(() => {
        if (chart.value) {
          try {
            // Get the actual chart container dimensions
            const chartContainer = document.querySelector('.chart-section');
            if (chartContainer) {
              const containerWidth = chartContainer.clientWidth;
              const containerHeight = 160; // Fixed height as specified

              debugLog("PerpetualsDialog: Resizing chart to", containerWidth, "x", containerHeight);

              chart.value.applyOptions({
                width: containerWidth,
                height: containerHeight,
              });
              chart.value.timeScale().fitContent();
              debugLog("PerpetualsDialog: Chart resized successfully");
            }
          } catch (error) {
            console.warn("PerpetualsDialog: Failed to resize chart:", error);
          }
        }
      }, 100); // Increased delay to ensure the container is ready

      // Wait for positions (main tab) to complete
      await positionsPromise;

      // Let background tasks complete without blocking the UI
      backgroundTasks.catch(() => {}); // Silent catch for background tasks

      debugLog("PerpetualsDialog: Fast load sequence completed");
    } else {
      debugLog("PerpetualsDialog: Dialog closed, stopping updates");
      shouldFetchChartData.value = false;
      stopChartUpdates();

      // Clean up all position closing polling intervals
      Object.entries(closingPositionIntervals.value).forEach(([positionKey, intervalId]) => {
        debugLog(`[StrikeFinance] Clearing polling interval for position ${positionKey}`);
        clearInterval(intervalId);
      });
      closingPositionIntervals.value = {};

      // Reset all closing position states
      closingPositions.value = {};

      // Clean up all order cancelling polling intervals
      Object.entries(cancellingOrderIntervals.value).forEach(([orderKey, intervalId]) => {
        debugLog(`[StrikeFinance] Clearing polling interval for order ${orderKey}`);
        clearInterval(intervalId);
      });
      cancellingOrderIntervals.value = {};

      // Reset all cancelling order states
      cancellingOrders.value = {};

      // Clean up opening position polling interval
      if (openingPositionInterval.value !== null) {
        debugLog(`[StrikeFinance] Clearing polling interval for opening position`);
        clearInterval(openingPositionInterval.value);
        openingPositionInterval.value = null;
      }

      // Reset opening position state
      openingPosition.value = false;
    }
  }
);

// Watch for ADA price changes and log updates (now using Kraken WebSocket)
watch(
  () => perpetualsPrice.value?.lastPrice,
  (newPrice, oldPrice) => {
    if (newPrice !== oldPrice && rawPositions.value.length > 0) {
      debugLog(
        `🦑 💰 Kraken ADA price updated: $${oldPrice} → $${newPrice} - Recalculating ${rawPositions.value.length} positions`
      );
    }
  }
);

// Debounced calculations for performance
let leverageCalculationTimeout: NodeJS.Timeout | null = null;
const debouncedPositionSize = ref('0.00');
const debouncedNotionalValue = ref('0.00');
const debouncedLiquidationPrice = ref('$0.0000');

const updateDebouncedCalculations = () => {
  if (leverageCalculationTimeout) clearTimeout(leverageCalculationTimeout);

  leverageCalculationTimeout = setTimeout(() => {
    // Position size calculation
    const posSize = (positionData.value.collateralAmount * positionData.value.leverage).toFixed(2);
    debouncedPositionSize.value = posSize;

    // Notional value calculation
    const currentAdaPrice = Number(perpetualsPrice.value?.lastPrice || 0);
    const positionSizeAda = Number(posSize);
    debouncedNotionalValue.value = (positionSizeAda * currentAdaPrice).toFixed(2);

    // Liquidation price calculation
    const leverage = positionData.value.leverage;
    const totalFees = 0.001 + accumulatedBorrowFee.value;
    const adjustedLiquidationMargin = 0.9 / leverage + totalFees;

    if (positionData.value.position === "LONG") {
      const liqPrice = currentAdaPrice * (1 - adjustedLiquidationMargin);
      debouncedLiquidationPrice.value = `$${liqPrice.toFixed(4)}`;
    } else {
      const liqPrice = currentAdaPrice * (1 + adjustedLiquidationMargin);
      debouncedLiquidationPrice.value = `$${liqPrice.toFixed(4)}`;
    }
  }, 50); // 50 ms debounce for smooth UI updates
};

// Fast computed for immediate slider response
const positionSize = computed(() => {
  return debouncedPositionSize.value;
});

const notionalValue = computed(() => {
  return debouncedNotionalValue.value;
});

const liquidationPrice = computed(() => {
  return debouncedLiquidationPrice.value;
});

// Real-time accumulated borrow fee calculation (cached)
const accumulatedBorrowFee = computed(() => {
  borrowFeeUpdateTrigger.value; // Access to trigger reactivity
  const hourlyBorrowFeeRate = 0.00001;
  const enteredTime = Date.now() - 2 * 60 * 60 * 1000;
  return calculateAccumulatedBorrowFee(hourlyBorrowFeeRate, enteredTime);
});

// Leverage input synchronization with debounced calculations
const onLeverageSliderChange = () => {
  updateDebouncedCalculations();
};

// Watch for collateral amount changes to update calculations
watch(
  () => positionData.value.collateralAmount,
  () => {
    updateDebouncedCalculations();
  }
);

// Limit price validation
const limitPriceValidation = computed(() => {
  const currentPrice = Number(perpetualsPrice.value?.lastPrice || 0);
  const limitPrice = positionData.value.limitPrice;
  const position = positionData.value.position;

  if (!limitPrice || limitPrice <= 0 || !currentPrice) {
    return { isInvalid: false, message: '' };
  }

  // For LONG positions: limit price should be BELOW current price
  if (position === 'LONG' && limitPrice >= currentPrice) {
    return {
      isInvalid: true,
      message: `Long limit price must be below current price ($${currentPrice.toFixed(4)})`
    };
  }

  // For SHORT positions: limit price should be ABOVE current price
  if (position === 'SHORT' && limitPrice <= currentPrice) {
    return {
      isInvalid: true,
      message: `Short limit price must be above current price ($${currentPrice.toFixed(4)})`
    };
  }

  return { isInvalid: false, message: '' };
});

const canOpenPosition = computed(() => {
  const hasRequiredFields =
    positionData.value.asset &&
    positionData.value.collateralAmount > 0 &&
    positionData.value.collateralAmount * perpetualsPrice.value?.lastPrice > 20 &&
    positionData.value.leverage > 1;

  // Additional validation for LIMIT orders
  if (positionData.value.orderType === "LIMIT") {
    return hasRequiredFields &&
           positionData.value.limitPrice > 0 &&
           !limitPriceValidation.value.isInvalid;
  }

  return hasRequiredFields;
});

const buttonText = computed(() => {
  const currentAdaPrice = Number(perpetualsPrice.value?.lastPrice || 0);
  const collateralValueUsd = positionData.value.collateralAmount * currentAdaPrice;

  // Check if collateral is greater than $0 but less than $20
  if (positionData.value.collateralAmount > 0 && collateralValueUsd < 20) {
    const adaNeededFor20 = currentAdaPrice > 0 ? (20 / currentAdaPrice).toFixed(2) : '0.00';
    return `Min value is $20 (${adaNeededFor20} ADA)`;
  }

  // Default button text based on order type and position
  const orderAction = positionData.value.orderType === 'MARKET' ? 'Open' : 'Place Limit';
  const orderSuffix = positionData.value.orderType === 'MARKET' ? 'Position' : 'Order';
  return `${orderAction} ${positionData.value.position} ${orderSuffix}`;
});

const openPosition = async () => {
  const walletAddress = loggedWallet.value?.baseAddress;

  if (!walletAddress) {
    console.warn("No wallet address available");
    return;
  }

  loading.value = true;
  try {
    if (positionData.value.orderType === 'MARKET') {
      await openMarketPosition(walletAddress);
    } else {
      await openLimitPosition(walletAddress);
    }
  } catch (error: any) {
    if (error.name === 'AxiosError') {
      snackbar.setError(error.response?.data?.error || error.message);
    } else {
      console.error("Failed to open position:", error);
      snackbar.setError(`${t('perpetuals.failedToOpenPosition')}: ${error.message}`);
    }
    // TODO: Show user-friendly error notification
  } finally {
    loading.value = false;
  }
};

const openMarketPosition = async (walletAddress: string) => {
  const asset: Asset = {
    policyId: '', // Native ADA has empty policy_id
    assetName: '', // Native ADA has empty asset_name
  };

  const openPositionRequest: CreatePerpetualRequest = {
    address: walletAddress,
    asset,
    collateralAmount: positionData.value.collateralAmount,
    leverage: positionData.value.leverage,
    position: positionData.value.position === 'LONG' ? 'Long' : 'Short',
    enteredPositionTime: Date.now(),
    stopLossPrice: positionData.value.stopLossPrice,
    takeProfitPrice: positionData.value.takeProfitPrice,
  };

  debugLog('[StrikeFinance] Opening position with request:', openPositionRequest);

  // Get initial position count to detect new position
  const initialPositionCount = positions.value.length;

  const cborResponse: AxiosResponse<string> = await strikeFinanceApi.openPosition(openPositionRequest);
  const txCbor: string = cborResponse.data['cbor'];
  // Sign the transaction with partial signing to add user's witness
  const signaturesRes: any = await Messaging.sendToBackground({
    method: METHOD.signTx,
    data: { tx: txCbor, partialSign: true, origin: 'https://gerowallet.io/', mergeWitnesses: false },
  });
  if (signaturesRes.error) {
    snackbar.setError(signaturesRes.error.info)
  } else {
    await submit(txCbor, signaturesRes.data);
    positionData.value = {
      asset: "ADA/USD",
      collateralAmount: 0,
      leverage: 1,
      position: "LONG",
      orderType: "LIMIT",
      limitPrice: 0,
      stopLossPrice: 0,
      takeProfitPrice: 0,
    };

    // Set loading state and start polling for the new position
    openingPosition.value = true;
    debugLog(`[StrikeFinance] Starting polling for new market position`);

    let pollAttempts = 0;
    const maxPollAttempts = 24; // 2-minute max (24 * 5 seconds)

    openingPositionInterval.value = window.setInterval(async () => {
      pollAttempts++;
      debugLog(`[StrikeFinance] Polling for new position (attempt ${pollAttempts}/${maxPollAttempts})`);

      await loadPositions(false); // Don't show loading spinner

      // Check if a new position appeared
      const hasNewPosition = positions.value.length > initialPositionCount;

      if (hasNewPosition || pollAttempts >= maxPollAttempts) {
        if (hasNewPosition) {
          debugLog(`[StrikeFinance] New position detected, stopping poll`);
        } else {
          console.warn(`[StrikeFinance] Max poll attempts reached, stopping poll`);
        }

        if (openingPositionInterval.value !== null) {
          clearInterval(openingPositionInterval.value);
          openingPositionInterval.value = null;
        }
        openingPosition.value = false;
      }
    }, 5000);
  }
}

const openLimitPosition = async (walletAddress: string) => {
  const asset: Asset = {
    policyId: '', // Native ADA has empty policy_id
    assetName: '', // Native ADA has empty asset_name
  };

  const openPositionRequest: CreateLimitOrderRequest = {
    address: walletAddress,
    asset,
    collateralAmount: positionData.value.collateralAmount,
    leverage: positionData.value.leverage,
    position: positionData.value.position === 'LONG' ? 'Long' : 'Short',
    stopLossPrice: positionData.value.stopLossPrice,
    takeProfitPrice: positionData.value.takeProfitPrice,
    limitUSDPrice: positionData.value.limitPrice,
  };

  debugLog('[StrikeFinance] Opening limit position with request:', openPositionRequest);

  // Get initial limit order count to detect new order
  const initialOrderCount = limitOrders.value.length;

  const cborResponse: AxiosResponse<string> = await strikeFinanceApi.openLimitOrder(openPositionRequest);
  const txCbor: string = cborResponse.data['cbor'];

  // Sign the transaction with partial signing to add user's witness
  const signaturesRes: any = await Messaging.sendToBackground({
    method: METHOD.signTx,
    data: { tx: txCbor, partialSign: true, origin: 'https://gerowallet.io/', mergeWitnesses: false },
  });
  if (signaturesRes.error) {
    snackbar.setError(signaturesRes.error.info)
  } else {
    await submit(txCbor, signaturesRes.data);
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

    // Set loading state and start polling for the new limit order
    openingPosition.value = true;
    debugLog(`[StrikeFinance] Starting polling for new limit order`);

    let pollAttempts = 0;
    const maxPollAttempts = 24; // 2 minutes max (24 * 5 seconds)

    openingPositionInterval.value = window.setInterval(async () => {
      pollAttempts++;
      debugLog(`[StrikeFinance] Polling for new limit order (attempt ${pollAttempts}/${maxPollAttempts})`);

      await loadLimitOrders(false); // Don't show loading spinner

      // Check if a new limit order appeared
      const hasNewOrder = limitOrders.value.length > initialOrderCount;

      if (hasNewOrder || pollAttempts >= maxPollAttempts) {
        if (hasNewOrder) {
          debugLog(`[StrikeFinance] New limit order detected, stopping poll`);
        } else {
          console.warn(`[StrikeFinance] Max poll attempts reached, stopping poll`);
        }

        if (openingPositionInterval.value !== null) {
          clearInterval(openingPositionInterval.value);
          openingPositionInterval.value = null;
        }
        openingPosition.value = false;
      }
    }, 5000);
  }
}

const closePosition = async (position: PerpetualPosition) => {
  if (!position.outRef) {
    console.error("Invalid position data for closing - missing required fields:", {
      hasOutRef: !!position.outRef,
      outRef: position.outRef
    });
    return;
  }

  if (!position.outRef.txHash || position.outRef.outputIndex === undefined) {
    console.error("Invalid outRef data - missing txHash or outputIndex:", position.outRef);
    return;
  }

  const positionKey = `${position.outRef.txHash}#${position.outRef.outputIndex}`;
  closingPositions.value[positionKey] = true;

  // Store polling interval ID for cleanup
  let pollingIntervalId: number | null = null;

  try {
    const closeRequest: ClosePerpetualRequest = {
      address: loggedWallet.value?.baseAddress,
      asset: {
        policyId: position.asset.asset.policyId,
        assetName: position.asset.asset.assetName
      },
      outRef: {
        txHash: position.outRef.txHash,
        outputIndex: position.outRef.outputIndex,
      },
    };
    const cborResponse: AxiosResponse<string> = await strikeFinanceApi.closePosition(closeRequest);
    const txCbor: string = cborResponse.data['cbor'];

    // Sign the transaction with partial signing to add user's witness
    const signaturesRes: any = await Messaging.sendToBackground({
      method: METHOD.signTx,
      data: { tx: txCbor, partialSign: true, origin: 'https://gerowallet.io/', mergeWitnesses: false },
    });
    if (signaturesRes.error) {
      snackbar.setError(signaturesRes.error.info)
      return;
    }
    await submit(txCbor, signaturesRes.data);

    // Start polling for position closure
    const maxPollingAttempts = 60; // Poll for up to 5 minutes (60 * 5 seconds)
    let pollingAttempts = 0;

    pollingIntervalId = window.setInterval(async () => {
      pollingAttempts++;
      console.log(`[StrikeFinance] Polling for position closure (attempt ${pollingAttempts}/${maxPollingAttempts})`);

      try {
        await loadPositions(false);

        // Check if position is still in the list
        const stillExists = perpetualPositions.value.some(
          p => p.outRef.txHash === position.outRef.txHash &&
               p.outRef.outputIndex === position.outRef.outputIndex
        );

        if (!stillExists) {
          // Position successfully closed
          console.log('[StrikeFinance] Position successfully closed');
          if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
          }
          closingPositions.value[positionKey] = false;
          snackbar.fireSuccess(String(t('perpetuals.positionClosedSuccess')));
        } else if (pollingAttempts >= maxPollingAttempts) {
          // Max attempts reached
          console.warn('[StrikeFinance] Max polling attempts reached, stopping poll');
          if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
          }
          closingPositions.value[positionKey] = false;
        }
      } catch (error) {
        console.error('[StrikeFinance] Error during position polling:', error);
      }
    }, 5000); // Poll every 5 seconds

    // Store interval ID for cleanup on dialog close
    if (!closingPositionIntervals.value) {
      closingPositionIntervals.value = {};
    }
    closingPositionIntervals.value[positionKey] = pollingIntervalId;

  } catch (error) {
    console.error("[StrikeFinance]  Failed to close position - detailed error:", {
      error,
      errorMessage: (error as any)?.message,
      errorResponse: (error as any)?.response?.data,
      errorStatus: (error as any)?.response?.status,
      position: position,
      request: {
        address: loggedWallet.value?.baseAddress,
        asset: position.asset,
        outRef: position.outRef,
        enteredPositionTime: position.enteredPositionTime,
      }
    });
    snackbar.setError(String(t('perpetuals.failedToClosePosition')));
    closingPositions.value[positionKey] = false;

    // Clean up polling interval on error
    if (pollingIntervalId) {
      clearInterval(pollingIntervalId);
      pollingIntervalId = null;
    }
  }
};

const submit = async (cborHex: string, witnessSetHex?: string) => {
  const submitResult = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SUBMIT_TX,
    data: {
      txCbor: cborHex,
      witnessHex: witnessSetHex || null,
      utxos: utxos.value
    }
  }) as { data: { txId?: string; error?: string } };
  if (submitResult.data.error) {
    throw new Error(submitResult.data.error);
  }
  const txId = submitResult.data.txId;
  snackbar.fireSuccess(t('perpetuals.txSentSuccess', { txId }));
  console.log(txId)
}

const getPositionTrendIcon = (position: any) => {
  // Use P&L with fees as the primary indicator, fallback to unrealized P&L
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

const loadPositions = async (withLoading: boolean = true) => {
  const walletAddress = loggedWallet.value?.baseAddress;

  if (!walletAddress) {
    console.warn("No wallet address available");
    return;
  }
  if (withLoading) loadingPositions.value = true;
  try {
    debugLog('[StrikeFinance]  Loading positions for wallet:', walletAddress);
    const res: AxiosResponse<PerpetualPosition[]> = await strikeFinanceApi.getPositions(walletAddress);
    if (res.status !== 200) {
      throw new Error(`Failed to load positions: ${res.statusText}`);
    }
    rawPositions.value = res.data
    debugLog('[StrikeFinance]  Fetched positions from API:', rawPositions.value);
  } catch (error) {
    console.error("Failed to load positions:", (error as any)?.message || error);
    rawPositions.value = [];
  } finally {
    if (withLoading) loadingPositions.value = false;
  }
};


// Load history (all positions and limit orders)
const loadHistory = async () => {
  const walletAddress = loggedWallet.value?.baseAddress;

  if (!walletAddress) {
    console.warn("No wallet address available for history");
    return;
  }
  loadingHistory.value = true;
  try {
    debugLog('[StrikeFinance] Loading perpetual history for wallet:', walletAddress);

    const historyRes = await strikeFinanceApi.getPerpetualHistory(walletAddress);
    const transactions = historyRes.data?.transactions || [];

    // Map API response to match table structure
    const mappedHistory = transactions.map(tx => ({
      asset: {
        ticker: tx.assetTicker,
      },
      leverage: Math.round(tx.positionSize / tx.collateralAmount) || 1, // Calculate leverage from position size
      orderType: tx.type?.toUpperCase() || 'MARKET',
      position: tx.positionType?.toUpperCase() || 'LONG',
      type: tx.positionType?.toUpperCase() || 'LONG',
      entryPrice: tx.enteredPrice,
      price: tx.enteredPrice,
      pnl: tx.pnl,
      status: tx.status?.toLowerCase() || 'unknown',
      enteredPositionTime: tx.time,
      txHash: tx.txHash,
      description: tx.description,
      action: tx.action,
      collateralAmount: tx.collateralAmount,
      positionSize: tx.positionSize,
      currentPrice: tx.currentPrice,
      contract: tx.contract,
      pair: tx.pair,
      originalTxHash: tx.originalTxHash,
    }));

    history.value = mappedHistory;

    debugLog('[StrikeFinance] Perpetual history loaded:', {
      transactions: transactions.length,
      mapped: mappedHistory.length
    });

    debugLog('[StrikeFinance] Action breakdown:',
      mappedHistory.reduce((acc, item) => {
        acc[item.action] = (acc[item.action] || 0) + 1;
        return acc;
      }, {})
    );

  } catch (error) {
    console.error("Failed to load history:", (error as any)?.message || error);
    history.value = [];
  } finally {
    loadingHistory.value = false;
  }
};

// Tab change handler
const onTabChange = (tabIndex: number) => {
  activeTab.value = tabIndex;
};

// Refresh the current tab
const refreshCurrentTab = () => {
  switch (activeTab.value) {
    case 0: loadPositions(); break;
    case 1: loadLimitOrders(); break;
    case 2: loadHistory(); break;
  }
};

const getPositionStatusColor = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'open':
    case 'active': return 'primary';      // Blue for active positions
    case 'closed':
    case 'completed': return 'success';   // Green for completed positions
    case 'liquidated': return 'error';    // Red for liquidated positions
    case 'pending': return 'warning';     // Orange for pending positions
    case 'cancelled':
    case 'canceled': return 'grey';       // Grey for canceled orders
    default: return 'grey';               // Grey for unknown statuses
  }
};

// Format date helper
const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleString();
};

// Logo error handler
const onLogoError = (event: Event) => {
  console.warn("Strike Finance logo failed to load, hiding logo");
  const img = event.target as HTMLImageElement;
  img.style.display = "none";
};

onMounted(async () => {
  // Initialize debounced calculations
  updateDebouncedCalculations();

  if (props.isOpen) {
    // Load all tab data to show correct badge counts immediately
    await Promise.allSettled([
      loadPositions(),
      loadLimitOrders(),
      loadHistory()
    ]);
  }

  // Initialize chart data with real ADA data
  try {
    chartData.value = await generateChartData();
    debugLog(
      "PerpetualsDialog: Initialized chart data with",
      chartData.value.length,
      "points"
    );
  } catch (error) {
    console.error("Failed to initialize chart data:", error);
    // Fallback to simple price data
    chartData.value = generateSimpleOHLCData();
  }

  // Enable the chart after a brief delay to ensure the component is ready
  setTimeout(async () => {
    await nextTick();
    shouldFetchChartData.value = true;
    debugLog("PerpetualsDialog: Enabled chart data fetching");
    startChartUpdates();
  }, 100);
});

onBeforeUnmount(() => {
  stopChartUpdates();
});

// Load limit orders
const loadLimitOrders = async (withLoading: boolean = true) => {
  const walletAddress = loggedWallet.value?.baseAddress;
  if (!walletAddress) return;
  if (withLoading) loadingLimitOrders.value = true;
  try {
    const response = await strikeFinanceApi.getLimitOrders(walletAddress);
    limitOrders.value = response.data;
    debugLog('[StrikeFinance] Loaded limit orders:', limitOrders.value);
    debugLog('[StrikeFinance] Limit orders data structure:', limitOrders.value.map(order => ({
      id: order.id,
      position: order.position,
      asset: order.asset,
      status: order.status,
      limitUSDPrice: order.limitUSDPrice,
      // Check for alternative price field names
      allFields: Object.keys(order),
      priceFields: Object.keys(order).filter(key => key.toLowerCase().includes('price'))
    })));

    // Log first order completely to see all available fields
    if (limitOrders.value.length > 0) {
      debugLog('[StrikeFinance] First limit order complete structure:', limitOrders.value[0]);
    }
  } catch (error) {
    console.error('Failed to load limit orders:', error);
    limitOrders.value = [];
  } finally {
    if (withLoading) loadingLimitOrders.value = false;
  }
};

const cancelLimitOrder = async (order: LimitOrder) => {
  if (!order.outRef) {
    console.error('Invalid order data for cancelling');
    return;
  }

  const orderKey = `${order.outRef.txHash}#${order.outRef.outputIndex}`;
  cancellingOrders.value[orderKey] = true;

  // Store polling interval ID for cleanup
  let pollingIntervalId: number | null = null;

  const cancelRequest: CancelLimitOrderRequest = {
    address: loggedWallet.value?.baseAddress,
    asset: {
      policyId: "",
      assetName: "",
    },
    outRef: {
      txHash: order.outRef.txHash,
      outputIndex: order.outRef.outputIndex,
    }
  };

  try {
    const cborResponse: AxiosResponse<string> = await strikeFinanceApi.cancelLimitOrder(cancelRequest);
    const txCbor: string = cborResponse.data['cbor'];

    // Sign the transaction with partial signing to add user's witness
    const signaturesRes: any = await Messaging.sendToBackground({
      method: METHOD.signTx,
      data: { tx: txCbor, partialSign: true, origin: 'https://gerowallet.io/', mergeWitnesses: false },
    });
    if (signaturesRes.error) {
      snackbar.setError(signaturesRes.error.info)
      return;
    }
    await submit(txCbor, signaturesRes.data);

    // Start polling for order cancellation
    const maxPollingAttempts = 60; // Poll for up to 5 minutes (60 * 5 seconds)
    let pollingAttempts = 0;

    pollingIntervalId = window.setInterval(async () => {
      pollingAttempts++;
      console.log(`[StrikeFinance] Polling for order cancellation (attempt ${pollingAttempts}/${maxPollingAttempts})`);

      try {
        await loadLimitOrders(false);

        // Check if order is still in the list
        const stillExists = limitOrders.value.some(
          o => o.outRef.txHash === order.outRef.txHash &&
               o.outRef.outputIndex === order.outRef.outputIndex
        );

        if (!stillExists) {
          // Order successfully cancelled
          console.log('[StrikeFinance] Order successfully cancelled');
          if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
          }
          cancellingOrders.value[orderKey] = false;
          snackbar.fireSuccess(String(t('perpetuals.orderCancelledSuccess')));
        } else if (pollingAttempts >= maxPollingAttempts) {
          // Max attempts reached
          console.warn('[StrikeFinance] Max polling attempts reached, stopping poll');
          if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
          }
          cancellingOrders.value[orderKey] = false;
        }
      } catch (error) {
        console.error('[StrikeFinance] Error during order polling:', error);
      }
    }, 5000); // Poll every 5 seconds

    // Store interval ID for cleanup on dialog close
    if (!cancellingOrderIntervals.value) {
      cancellingOrderIntervals.value = {};
    }
    cancellingOrderIntervals.value[orderKey] = pollingIntervalId;

  } catch (error: any) {
    console.error("[StrikeFinance] Failed to cancel limit order", error);
    snackbar.setError(`${t('perpetuals.failedToCancelLimitOrder')} ${error.message}`);
    cancellingOrders.value[orderKey] = false;

    // Clean up polling interval on error
    if (pollingIntervalId) {
      clearInterval(pollingIntervalId);
      pollingIntervalId = null;
    }
  }
};

// Update position
const updatePosition = async () => {
  if (!selectedPosition.value) return;

  try {
    const updateRequest: UpdatePositionRequest = {
      address: loggedWallet.value?.baseAddress,
      asset: selectedPosition.value.asset.asset,
      outRef: selectedPosition.value.outRef,
      side: selectedPosition.value.position.toLowerCase(),
      ...(updatePositionData.value.stopLossPrice > 0 && {
        stopLossPrice: updatePositionData.value.stopLossPrice
      }),
      ...(updatePositionData.value.takeProfitPrice > 0 && {
        takeProfitPrice: updatePositionData.value.takeProfitPrice
      })
    };

    debugLog('[StrikeFinance] Updating position:', updateRequest);
    const cborResponse = await strikeFinanceApi.updatePosition(updateRequest);
    debugLog('[StrikeFinance] Update position response:', cborResponse.data);

    // Close the dialog and reload positions
    updatePositionDialog.value = false;
    await loadPositions();
  } catch (error) {
    console.error('Failed to update position:', error);
  }
};

// Get collateral amount in USD (based on entry price)
const getCollateralAmount = (item: any) => {
  // Get the entry price (price when position was opened)
  let entryPrice = 0;
  if (item.entryPrice) {
    entryPrice = Number(item.entryPrice);
  } else if (item.rawEnteredAtUsdPrice) {
    entryPrice = Number(item.rawEnteredAtUsdPrice);
  }

  // Get the collateral amount in ADA
  let collateralAda = 0;

  // Try different ADA collateral fields
  const adaCandidates = [
    item.collateralSizeAda,
    item.currentPositionValueAda,
    item.rawCollateralAssetAmount ? Number(item.rawCollateralAssetAmount) / 1000000 : null,
    item.initialCollateral,
    item.collateralAmount,
    item.collateral
  ];

  for (const candidate of adaCandidates) {
    if (candidate !== undefined && candidate !== null && candidate > 0) {
      collateralAda = Number(candidate);
      break;
    }
  }

  // Calculate USD value: collateral ADA × entry price
  if (collateralAda > 0 && entryPrice > 0) {
    const collateralUsd = collateralAda * entryPrice;
    return collateralUsd.toFixed(2);
  }

  // Fallback: check if there's already a USD collateral field
  const usdCandidates = [
    item.collateralUsd,
    item.initialCollateralUsd,
    item.collateralValueUsd
  ];

  for (const candidate of usdCandidates) {
    if (candidate !== undefined && candidate !== null && candidate > 0) {
      return Number(candidate).toFixed(2);
    }
  }

  return '0.00';
};
</script>

<style scoped>
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
  appearance: textfield !important;
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

.even {
  color: #ffffff !important;
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

/* Fix refresh button loading spinner size */
::v-deep .refresh-btn-external .v-btn__loader {
  width: 12px !important;
  height: 12px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  justify-self: anchor-center;
  align-self: anchor-center;
}

::v-deep .refresh-btn-external .v-btn__loader .v-progress-circular {
  width: 12px !important;
  height: 12px !important;
}

::v-deep .refresh-btn-external .v-btn__loader .v-progress-circular svg {
  width: 12px !important;
  height: 12px !important;
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
.column-title {
  color: #26fab0;
  font-size: 16px;
  font-weight: 600;
  margin-top: 0;
  letter-spacing: 0.3px;
}

.column-title.compact {
  font-size: 13px;
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
  margin: 2px 0px;
  height: 274px;
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
  white-space: nowrap !important;
  vertical-align: middle !important;
}

.positions-data-table >>> tbody tr {
  background: transparent !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
}

.positions-data-table >>> tbody tr:hover {
  background: rgba(38, 250, 176, 0.03) !important;
}

/* Override the v-tabs-items dark theme background */
.trading-tabs-container >>> .theme--dark.v-tabs-items {
  background: none !important;
  background-color: transparent !important;
}

.trading-tabs-container >>> .v-tabs-items.theme--dark {
  background: none !important;
  background-color: transparent !important;
}

.v-tabs-items {
  background: none !important;
  background-color: transparent !important;
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

.input-card.invalid-input {
  border-color: rgba(245, 158, 11, 0.5) !important;
  background-color: rgba(245, 158, 11, 0.05) !important;
}

.input-card.invalid-input:hover {
  border-color: rgba(245, 158, 11, 0.7) !important;
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
/* Disabled state styling */
.open-position-btn.enhanced:disabled,
.open-position-btn.enhanced.v-btn--disabled {
  background: #454545 !important;
  color: #c3c3c3 !important;
  opacity: 0.6 !important;
  cursor: not-allowed !important;
  transform: none !important;
  box-shadow: none !important;
}
.open-position-btn.enhanced:disabled .v-icon,
.open-position-btn.enhanced.v-btn--disabled .v-icon {
  color: #9e9e9e !important;
}
.open-position-btn.enhanced.short-position:disabled,
.open-position-btn.enhanced.short-position.v-btn--disabled {
  background: #e0e0e0 !important;
  color: #9e9e9e !important;
}

/* Tab styles */
.trading-tabs-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.trading-tabs-container >>> .v-tabs {
  flex: 1;
}

.tab-item {
  min-width: auto !important;
  padding: 0 12px !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  text-transform: none !important;
}

.tab-text {
  font-size: 11px;
  font-weight: 500;
}

.tab-count {
  background: rgba(38, 250, 176, 0.2);
  color: #26FAB0;
  border-radius: 10px;
  padding: 1px 4px;
  font-size: 9px;
  font-weight: 600;
  min-width: 16px;
  text-align: center;
}

.trading-tabs-container >>> .v-tab {
  color: #9ca3af !important;
  transition: color 0.3s ease !important;
}

.trading-tabs-container >>> .v-tab--active {
  color: #26FAB0 !important;
}

.trading-tabs-container >>> .v-tabs-slider {
  background-color: #26FAB0 !important;
  height: 2px !important;
}

/* Status chip styles */
.status-chip {
  font-size: 8px !important;
  height: 18px !important;
  padding: 0 6px !important;
  font-weight: 600 !important;
}

/* Custom status chip colors */
.status-chip.primary {
  background: linear-gradient(135deg, rgba(33, 150, 243, 0.2) 0%, rgba(33, 150, 243, 0.1) 100%) !important;
  color: #2196f3 !important;
  border: 1px solid rgba(33, 150, 243, 0.3) !important;
}

.status-chip.success {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0.1) 100%) !important;
  color: #10b981 !important;
  border: 1px solid rgba(16, 185, 129, 0.3) !important;
}

.status-chip.error {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.1) 100%) !important;
  color: #ef4444 !important;
  border: 1px solid rgba(239, 68, 68, 0.3) !important;
}

.status-chip.warning {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(245, 158, 11, 0.1) 100%) !important;
  color: #f59e0b !important;
  border: 1px solid rgba(245, 158, 11, 0.3) !important;
}

.status-chip.grey {
  background: linear-gradient(135deg, rgba(156, 163, 175, 0.2) 0%, rgba(156, 163, 175, 0.1) 100%) !important;
  color: #9ca3af !important;
  border: 1px solid rgba(156, 163, 175, 0.3) !important;
}

.action-btn-compact {
  font-size: 10px !important;
  height: 20px !important;
  padding: 0 8px !important;
  min-width: auto !important;
}

/* Limit Price Validation Warning */
.limit-price-warning {
  display: flex;
  align-items: center;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 6px;
  padding: 8px 10px;
  animation: fadeIn 0.3s ease;
}

.limit-price-warning .warning-text {
  color: #f59e0b;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
}

.limit-price-warning .v-icon {
  flex-shrink: 0;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
