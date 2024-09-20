<template>
  <v-card outlined class="no-gutters fill-height" :loading="loadingTxs">
    <v-card-title>
      Token Allocation ({{assets?.length + collectibles?.length}})
      <v-spacer></v-spacer>
      <v-btn-toggle mandatory active-class="highlight" @change="handleSwitchTab">
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
            class="token-allocation-table transparent"
            :headers="assetsHeaders"
            :items="assets"
            @click:row="handleOnRowClick"
            :sort-by.sync="assetsSortBy"
            :sort-desc.sync="assetsSortDesc"
            :items-per-page="5"
            :header-props="{ 'sort-icon': 'mdi-menu-up' }"
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
            <template v-slot:[`item.quantity`]="{ item }">
              <v-tooltip top :open-delay="500">
                <template v-slot:activator="{ on, attrs }">
                  <span v-bind="attrs" v-on="on">
                    {{ Number(item.quantity) | toCurrency(false, 2, '', '', true, item.metadata?.decimals) }}
                  </span>
                </template>
                {{ (Number(item.quantity) / (item.metadata?.decimals ? Math.pow(10, item.metadata?.decimals) : 1)).toLocaleString(undefined, {maximumFractionDigits: 2}) }}
              </v-tooltip>
            </template>
            <template v-slot:[`item.last_price`]="{ item }">
              <div v-if="item.name === 'Cardano' && price">{{Number(price.lastPrice) | toCurrency(false, 4, '$', '', false, 0)}}</div>
              <span v-else-if="!item.last_price">N/A</span>
              <span v-else>{{item.last_price | toCurrency(false, 4, '$', '', false, 0)}}</span>
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
              <div v-if="item.name === 'Cardano' && price">{{item.quantity * Number(price.lastPrice) | toCurrency(false, 2, '$', '', true, item.metadata?.decimals)}}</div>
              <span v-else-if="!item.last_price">N/A</span>
              <span v-else>{{item.value | toCurrency(false, 2, '$', '', true, 0)}}</span>
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
                {{ Number(item.mcap).toLocaleString(undefined, {minimumFractionDigits: item.metadata.decimals}) }}
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
            :items-per-page="5"
            :header-props="{ 'sort-icon': 'mdi-menu-up' }"
            :sort-by.sync="collectiblesSortBy"
            :sort-desc.sync="collectiblesSortDesc"
          >
            <template v-slot:[`item.name`]="{ item }">
              <v-list-item dense>
                <v-list-item-avatar class="my-0" size="32">
                  <img :src="item.img" :alt="item.name + ' Logo'"/>
                </v-list-item-avatar>
                <v-list-item-content>
                  <v-list-item-title>
                    {{item.name}}
                  </v-list-item-title>
                  <v-list-item-subtitle style="display: -webkit-box; -webkit-line-clamp: 1;-webkit-box-orient: vertical;overflow: hidden;text-overflow: ellipsis;white-space: normal;">
                    {{item.description}}
                  </v-list-item-subtitle>
                </v-list-item-content>
              </v-list-item>
            </template>
            <template v-slot:[`item.quantity`]="{ item }">
              <span class="table-text">{{ Number(item.quantity).toLocaleString() }}</span>
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
import { mapState } from 'pinia';
import { useStore } from '@/store';
import Sparkline from '@/modules/navigation/components/Sparkline.vue';
import TokensDialog from '@/modules/assets/dialogs/TokensDialog.vue';
import filters from '@/shared/utils/filters';
import networks from '../../../shared/utils/networks';

export default {
  name: "tokenAllocationTable",
  components: { TokensDialog, Sparkline },
  methods: {
    handleSwitchTab(tab) {
      this.currentTab = tab;
    },
    closeDialog() {
      this.dialogData = null;
    },
    handleOnRowClick(row) {
      // this.dialogData = row; TODO
    },
  },
  filters,
  computed: {
    filters() {
      return filters
    },
    networks() {
      return networks
    },
    ...mapState(useStore, ['loggedWallet', 'resolvedAssets', 'resolvedCollections', 'price', 'loadingTxs']),
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
      if (this.resolvedAssets && this.price) {
        this.resolvedAssets.forEach(token => {
          if (token.value) {
            totalAllocation += token.value
          }
        })
        return this.resolvedAssets.map(token => {
          if (token['name'] === 'Cardano') {
            token['value'] = Number(filters.toCurrency(token.quantity * Number(this.price.lastPrice), false, token.metadata?.decimals, '', '', false, token.metadata?.decimals).replaceAll(",", ""))
          }
          if (token['value']) {
            token['total_allocation'] = token['value'] / totalAllocation * 100
          }
          return token
        })
      }
      return this.resolvedAssets
    },
    collectibles() {
      return this.resolvedCollections
    }
  },
  data: () => ({
    assetsSortBy: 'name',
    assetsSortDesc: false,
    collectiblesSortBy: 'name',
    collectiblesSortDesc: false,
    currentTab: 0,
    chartData: [],
    assetsHeaders: [
      { text: "Asset", align: "start", sortable: true, value: "name" },
      { text: "Risk", align: "center", sortable: true, value: "risk", width: "100" },
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

};
</script>
<style>
.token-allocation-table {

  tbody{
    cursor: pointer;
  }

  .table-text {
    font-size: 12px;
  }

  .table-text-opacity {
    font-size: 12px;
    opacity: 0.5;
    display: block;
  }
  .progress-bar {
    border-radius: 10px;
    background-color: #333741;
    width: 50%;
    display: inline-block;
    margin-right: 10px;
  }

  .avatar {
    margin-right: 5px;
  }
}
</style>
