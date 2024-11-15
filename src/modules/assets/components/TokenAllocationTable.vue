<template>
  <v-card outlined class="no-gutters fill-height" :loading="loadingTxs">
    <v-card-title>
      Token Allocation ({{assets?.length + collectibles?.length}})
      <v-spacer></v-spacer>
      <v-menu
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
      <v-btn-toggle class="ml-4" mandatory active-class="highlight" @change="handleSwitchTab">
        <v-btn color="black" :value="0" rounded style="text-transform: capitalize">Assets
          <v-chip small outlined color="#009DAB" style="background-color: #00555C!important; color: #CECFD2;" class="ml-1 px-1">{{assets?.length}}</v-chip>
        </v-btn>
        <v-btn color="black" :value="1" rounded style="text-transform: capitalize" :disabled="collectiblesLength === 0">Collectibles
          <v-chip small outlined color="#009DAB" style="background-color: #00555C!important; color: #CECFD2;" class="ml-1 px-1">{{collectiblesLength}}</v-chip>
        </v-btn>
      </v-btn-toggle>
    </v-card-title>
    <v-card-text class="pa-0">
      <v-tabs-items v-model="currentTab" class="transparent">
        <v-tab-item>
          <v-data-table
            class="transparent"
            :headers="assetsHeaders"
            :items="assets"
            :sort-by.sync="assetsSort.by"
            :sort-desc.sync="assetsSort.desc"
            :items-per-page="10"
            :header-props="{ 'sort-icon': 'mdi-menu-up' }"
            :custom-sort="customSort"
            @click:row="handleTokenRowClick"
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
              <v-img width="32" style="margin: auto" v-if="item.risk && item.risk !== 'N/A'" :src="require('@/assets/svg/risk/'+item.risk+'.svg')" :alt="item.risk" />
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
                        ? require('@/assets/svg/arrow-right.svg')
                        : item.change > 0
                        ? require('@/assets/svg/trend-up-01.svg')
                        : require('@/assets/svg/trend-down-01.svg')
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
                    {{ Number(item.mcap) | toCurrency(false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true, 0) }}
                  </span>
                </template>
                {{ Number(item.mcap).toLocaleString('en-US', {minimumFractionDigits: item.metadata.decimals}) }}
              </v-tooltip>
              <span v-else>N/A</span>
            </template>
            <template v-slot:[`item.total_allocation`]="{ item }">
              <span v-if="!item.last_price && item.name !== 'Cardano'">N/A</span>
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
  </v-card>
</template>
<script>
import { mapActions, mapState } from 'pinia';
import { useStore } from '@/store';
import Sparkline from '@/modules/navigation/components/Sparkline.vue';
import TokensDialog from '@/modules/assets/dialogs/TokensDialog.vue';
import filters from '@/shared/utils/filters';
import networks from '../../../shared/utils/networks';
import { walletConfigStore } from '@/store/modules/walletConfig';
import { Blockchain, Network } from '@/models/types';

export default {
  name: "tokenAllocationTable",
  components: { TokensDialog, Sparkline },
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
      console.log(row)
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
      let totalAllocation = 0
      const resolvedAssets = structuredClone(this.resolvedAssets)
      if (resolvedAssets && this.price) {
        resolvedAssets.forEach(token => {
          if (token.value) {
            totalAllocation += token.value
          }
        })
        let res = resolvedAssets.map(token => {
          token['quantity'] = Number(filters.toCurrency(token.quantity, false, 6, '', '', false, token.metadata?.decimals).replaceAll(',', ''))
          if (token['name'] === 'Cardano') {
            token['last_price'] = Number(filters.toCurrency(this.price.lastPrice, false, 4, '', '', true, 0).replaceAll(",", ""))
            token['change'] = Number(this.price.priceChangePercent)
          } else {
            token['last_price'] = Number(filters.toCurrency(token.last_price * Number(this.price.lastPrice), false, 6, '', '', false, 0).replaceAll(',', ''))
          }
          token['value'] = Number(filters.toCurrency(token.quantity * token.last_price, false, 4, '', '', false, 0).replaceAll(",", ""))
          if (token['value']) {
            token['total_allocation'] = token['value'] / totalAllocation * 100
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
</style>
