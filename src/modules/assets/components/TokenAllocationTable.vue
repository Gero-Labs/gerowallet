<template>
  <v-card outlined class="no-gutters fill-height" :loading="loadingTxs">
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
          <v-data-table
            class="token-allocation-table transparent"
            :headers="collectiblesHeaders"
            :items="collectibles"
            @click:row="handleOnRowClick"
            :items-per-page="10"
            :header-props="{ 'sort-icon': 'mdi-menu-up' }"
            :sort-by.sync="collectiblesSortBy"
            :sort-desc.sync="collectiblesSortDesc"
          >
            <template v-slot:[`item.name`]="{ item }">
              <v-list-item dense>
                <v-list-item-action class="my-0">
                  <v-badge
                    overlap
                    avatar
                    color="transparent"
                    :offset-y="37"
                    v-if="item['isScam']"
                  >
                    <template v-slot:badge>
                      <v-avatar color="transparent" tile size="20" >
                        <v-icon small color="#F97066">
                          mdi-alert-decagram
                        </v-icon>
                      </v-avatar>
                    </template>
                    <v-avatar size="32">
                      <v-img v-if="item['img']" :src="item['img']" :alt="`${item['name']} Logo`" contain />
                    </v-avatar>
                  </v-badge>
                  <v-avatar size="32" v-else>
                    <img v-if="item['img']" :src="item['img']" :alt="`${item['name']} Logo`"
                    />
                  </v-avatar>
                </v-list-item-action>
                <v-list-item-content>
                  <v-list-item-title style="display: -webkit-box; -webkit-line-clamp: 1;-webkit-box-orient: vertical;overflow: hidden;text-overflow: ellipsis;white-space: normal;">
                    {{item.name}} <v-chip x-small v-if="item.isScam" class="ml-1" color="#F97066">Scam Token</v-chip>
                  </v-list-item-title>
                  <v-list-item-subtitle style="display: -webkit-box; -webkit-line-clamp: 1;-webkit-box-orient: vertical;overflow: hidden;text-overflow: ellipsis;white-space: normal;">
                    {{ Array.isArray(item.description) ? item.description.join('') : item.description }}
                  </v-list-item-subtitle>
                </v-list-item-content>
              </v-list-item>
            </template>
            <template v-slot:[`item.quantity`]="{ item }">
              <span class="table-text">{{ Number(item.quantity).toLocaleString('en-US') }}</span>
            </template>
            <template v-slot:[`item.floor`]="{  }">
              <v-chip outlined x-small color="#F97066">Soon</v-chip>
<!--              <div>-->
<!--                <span class="table-text">${{ item.floor[0].toLocaleString() }}</span>-->
<!--                <span class="table-text-opacity">Â{{ item.floor[1].toLocaleString() }}</span>-->
<!--              </div>-->
            </template>
            <template v-slot:[`item.change`]="{  }">
              <v-chip outlined x-small color="#F97066">Soon</v-chip>
<!--              <v-avatar tile size="20">-->
<!--                <v-img-->
<!--                  :src="-->
<!--                    item.change >= 0-->
<!--                      ? require('@/assets/svg/trend-up-01.svg')-->
<!--                      : require('@/assets/svg/trend-down-01.svg')-->
<!--                  "-->
<!--                  alt="trend"-->
<!--                ></v-img>-->
<!--              </v-avatar>-->
<!--              <span class="table-text" :style="item.change >= 0 ? { color: '#47CD89' } : { color: '#F97066' }">{{-->
<!--                Math.abs(item.change * 100) + "%"-->
<!--              }}</span>-->
            </template>
            <template v-slot:[`item.cost_basis`]="{  }">
              <v-chip outlined x-small color="#F97066">Soon</v-chip>
            </template>
            <template v-slot:[`item.avg_price`]="{  }">
              <v-chip outlined x-small color="#F97066">Soon</v-chip>
            </template>
            <template v-slot:[`item.pnl`]="{  }">
              <v-chip outlined x-small color="#F97066">Soon</v-chip>
            </template>
            <template v-slot:[`item.allocation`]="{  }">
              <v-chip outlined x-small color="#F97066">Soon</v-chip>
<!--              <v-progress-linear-->
<!--                class="progress-bar"-->
<!--                height="8"-->
<!--                :value="item.allocation"-->
<!--                color="#00dff3"-->
<!--              ></v-progress-linear>-->
<!--              <span class="table-text">{{ item.allocation }}%</span>-->
            </template>
            <template v-slot:[`item.last_7_days`]="{  }">
              <v-chip outlined x-small color="#F97066">Soon</v-chip>
<!--              <span>{{ item.last_7_days }}</span>-->
            </template>
          </v-data-table>
        </v-tab-item>
      </v-tabs-items>
    </v-card-text>
    <TokensDialog @close="closeDialog" :modalData="dialogData"></TokensDialog>
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
                          <span class="overview-value-text">${{ selectedToken?.last_price?.toFixed(6) || 'N/A' }}</span>
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
                              {{ selectedToken?.change ? Math.abs(selectedToken.change).toFixed(2) + '%' : 'N/A' }}
                            </span>
                          </div>
                        </div>
                        <div class="overview-value-item">
                          <span class="overview-value-text">${{ selectedToken?.value?.toLocaleString() || 'N/A' }}</span>
                        </div>
                        <div class="overview-value-item">
                          <span class="overview-value-text">${{ selectedToken?.mcap ? (Number(selectedToken.mcap) * price?.lastPrice).toLocaleString() : 'N/A' }}</span>
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
                            <span class="overview-value-text">{{ selectedToken?.total_allocation?.toFixed(1) || '0.0' }}%</span>
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
                    <v-card-text class="pt-0 pb-2">
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
                            {{ analysisData.indicators.rsi.current.toFixed(1) }}
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
          
          <div v-else class="text-center py-8 d-flex align-center justify-center" style="height: 700px;">
            <div>
              <v-icon large color="grey">mdi-chart-bell-curve</v-icon>
              <div class="text-h6 grey--text mt-2">No Analysis Available</div>
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
import * as Highcharts from 'highcharts';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import { walletConfigStore } from '@/stores/modules/walletConfig';
import { Blockchain, Network } from '@/models/types';
import assts from '@/utils/assets'

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
      console.log('Technical analysis modal state changed:', val);
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
    handleSwitchTab(tab) {
      this.currentTab = tab;
    },
    closeDialog() {
      this.dialogData = null;
    },
    handleOnRowClick(row) {
      this.dialogData = row;
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
      console.log('Opening technical analysis for:', token.name, 'Token structure:', token);
      this.selectedToken = token;
      this.analysisData = null;
      this.analysisLoading = false;
      this.showTechnicalAnalysis = true;
      this.generateMockAnalysis(token);
    },
    generateMockAnalysis(token) {
      this.analysisLoading = true;
      this.analysisData = null;
      
      // Simulate API call delay
      setTimeout(() => {
        this.analysisData = {
          asset: token.ticker || token.name,
          priceHistory: this.generateMockPriceData(token.last_price || 1),
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
          lastUpdated: Date.now()
        };
        this.analysisLoading = false;
        
        // Create chart automatically
        this.$nextTick(() => {
          this.createTechnicalChart();
        });
      }, 1500);
    },
    createTechnicalChart() {
      if (!this.$refs.technicalChart || !this.analysisData) return;
      
      // Destroy existing chart if it exists
      if (this.chart) {
        this.chart.destroy();
      }
      
      // Prepare data
      const priceData = this.analysisData.priceHistory;
      const prices = priceData.map(p => p.close);
      
      // Calculate moving averages for visualization
      const sma20 = this.calculateSMA(prices, 20);
      const ema12 = this.calculateEMA(prices, 12);
      
      // Prepare series data for Highcharts
      const priceSeriesData = priceData.map(p => [p.timestamp, p.close]);
      const smaSeriesData = priceData.map((p, i) => [p.timestamp, sma20[i]]).filter(d => d[1] !== null);
      const emaSeriesData = priceData.map((p, i) => [p.timestamp, ema12[i]]);
      
      // Chart configuration for Highcharts
      const config = {
        chart: {
          type: 'line',
          backgroundColor: '#141414',
          style: {
            fontFamily: 'Inter, sans-serif'
          }
        },
        title: {
          text: `${this.selectedToken?.name || this.selectedToken?.ticker} - Technical Analysis Chart`,
          style: {
            color: 'white',
            fontSize: '16px',
            fontFamily: 'Inter, sans-serif'
          }
        },
        xAxis: {
          type: 'datetime',
          gridLineColor: 'rgba(255, 255, 255, 0.1)',
          lineColor: 'rgba(255, 255, 255, 0.3)',
          tickColor: 'rgba(255, 255, 255, 0.3)',
          labels: {
            style: { 
              color: 'white',
              fontFamily: 'Inter, sans-serif'
            }
          }
        },
        yAxis: {
          title: {
            text: 'Price ($)',
            style: { 
              color: 'white',
              fontFamily: 'Inter, sans-serif'
            }
          },
          gridLineColor: 'rgba(255, 255, 255, 0.1)',
          lineColor: 'rgba(255, 255, 255, 0.3)',
          tickColor: 'rgba(255, 255, 255, 0.3)',
          labels: {
            style: { 
              color: 'white',
              fontFamily: 'Inter, sans-serif'
            },
            formatter: function() {
              return '$' + this.value.toFixed(6);
            }
          }
        },
        legend: {
          itemStyle: { 
            color: 'white',
            fontFamily: 'Inter, sans-serif'
          },
          itemHoverStyle: { color: '#ccc' }
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          style: { 
            color: 'white',
            fontFamily: 'Inter, sans-serif'
          },
          borderColor: 'rgba(255, 255, 255, 0.3)'
        },
        plotOptions: {
          line: {
            marker: {
              enabled: false
            }
          }
        },
        series: [
          {
            name: 'Price',
            data: priceSeriesData,
            color: '#2196F3',
            fillOpacity: 0.3,
            lineWidth: 2
          },
          {
            name: 'SMA (20)',
            data: smaSeriesData,
            color: '#FF9800',
            lineWidth: 1
          },
          {
            name: 'EMA (12)',
            data: emaSeriesData,
            color: '#4CAF50',
            lineWidth: 1
          },
          {
            name: 'Upper Bollinger',
            data: priceData.map(p => [p.timestamp, this.analysisData.indicators.bollinger.upper]),
            color: 'rgba(244, 67, 54, 0.5)',
            lineWidth: 1,
            dashStyle: 'Dash'
          },
          {
            name: 'Lower Bollinger',
            data: priceData.map(p => [p.timestamp, this.analysisData.indicators.bollinger.lower]),
            color: 'rgba(244, 67, 54, 0.5)',
            lineWidth: 1,
            dashStyle: 'Dash'
          }
        ]
      };
      
      // Create chart
      this.chart = Highcharts.chart(this.$refs.technicalChart, config);
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
    generateMockPriceData(basePrice) {
      const data = [];
      const now = Date.now();
      let price = basePrice;
      
      for (let i = 100; i >= 0; i--) {
        const timestamp = now - (i * 24 * 60 * 60 * 1000) + Math.random() * 1000; // Add random ms to avoid duplicates
        const volatility = 0.02 + Math.random() * 0.04;
        const direction = Math.random() > 0.5 ? 1 : -1;
        
        price = price * (1 + (direction * volatility * 0.5));
        price = Math.max(price, 0.001);
        
        data.push({
          timestamp,
          open: price * (0.98 + Math.random() * 0.04),
          high: price * (1.00 + Math.random() * 0.03),
          low: price * (0.97 + Math.random() * 0.03),
          close: price,
          volume: Math.random() * 100000 + 10000
        });
      }
      
      return data;
    },
    requestAnalysis(timeframe) {
      console.log('Requesting analysis for timeframe:', timeframe);
      if (this.selectedToken) {
        this.generateMockAnalysis(this.selectedToken);
      }
    },
    onSettingsChanged(settings) {
      console.log('Settings changed:', settings);
      if (this.selectedToken) {
        this.generateMockAnalysis(this.selectedToken);
      }
    },
    toggleSwapPanel() {
      this.swapPanelOpen = !this.swapPanelOpen;
      
      // Trigger chart resize after transition
      if (this.chart) {
        setTimeout(() => {
          this.chart.reflow();
        }, 350);
      }
    },
    handleSwapComplete() {
      // Close swap panel after successful swap
      this.swapPanelOpen = false;
      
      // Trigger chart resize
      if (this.chart) {
        setTimeout(() => {
          this.chart.reflow();
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
    clearFilters() {
      this.hideUnverified = false
      this.hideScam = false
      this.hideUnrated = false
    },
    customSort(items, sortBy, sortDesc) {
      if (!sortBy.length) return items;

      return items.sort((a, b) => {
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
    assts,
  }),
  mounted() {
    this.hideUnverified = walletConfigStore().getHideUnverifiedTokens
    this.hideScam = walletConfigStore().getHideScamTokens
    this.hideUnrated = walletConfigStore().getHideUnratedTokens
    this.assetsSort = walletConfigStore().getTokenAllocationTableSort
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
  font-size: 9px !important;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  font-weight: 600;
}

.overview-values {
  display: flex;
  align-items: center;
  padding-top: 4px;
}

.overview-value-item {
  flex: 1;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
}

.overview-value-text {
  color: white !important;
  font-size: 10px !important;
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
</style>
