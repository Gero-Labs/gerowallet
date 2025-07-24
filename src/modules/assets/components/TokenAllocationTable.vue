<template>
  <v-card outlined class="no-gutters fill-height" :loading="loadingTxs">
    <v-card-title>
      Token Allocation
      <v-spacer />
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
         <span style="color: white">&nbsp;{{ `(${tokensList ? tokensList.length : 0})` }}</span>
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
            class="transparent"
            :headers="assetsHeaders"
            :items="tokensList"
            :sort-by.sync="sortOptions.by"
            :sort-desc.sync="sortOptions.desc"
            :items-per-page="10"
            :header-props="{ 'sort-icon': 'mdi-menu-up' }"
            :custom-sort="customSort"
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
                    {{ filters.toCurrency(item.quantity, false, 4, '', '', true, item.metadata?.decimals) }}
                  </span>
                </template>
                {{ filters.toCurrency(item.quantity, false, 6, '', '', false, item.metadata?.decimals) }}
              </v-tooltip>
            </template>
            <template v-slot:[`item.price`]="{ item }">
              <span v-if="!item.price">N/A</span>
              <span v-else>
                <v-tooltip top :open-delay="500">
                  <template v-slot:activator="{ on, attrs }">
                    <span v-bind="attrs" v-on="on">
                      {{ filters.toCurrency(item.price, false, 4, '$', '', true, 0) }}
                    </span>
                  </template>
                  {{ filters.toCurrency(item.price, false, 6, '$', '', false, 0) }}
                </v-tooltip>
              </span>
              <div style="display: flex; justify-self: center" v-if="item.change !== undefined">
                <v-avatar tile size="12" class="mr-1" style="align-self: center;">
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
                <span
                  :style="{
                    color: item.change === 0 ? '#A3A3A3' : item.change > 0 ? '#47CD89' : '#F97066',
                    fontSize: '10px',
                  }"
                >
                  {{ Math.abs(item.change).toFixed(2) + "%" }}
                </span>
              </div>
            </template>
            <template v-slot:[`item.value`]="{ item }">
              <span v-if="!item.price">N/A</span>
              <span v-else>
                 <v-tooltip top :open-delay="500">
                  <template v-slot:activator="{ on, attrs }">
                    <span v-bind="attrs" v-on="on">
                      {{ filters.toCurrency(item.value, false, 4, '$', '', true, 0) }}
                    </span>
                  </template>
                  {{ filters.toCurrency(item.value, false, 6, '$', '', false, 0) }}
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
                    {{ filters.toCurrency(Number(item.mcap), false, 2, '$', '', true, 0) }}
                  </span>
                </template>
                {{ filters.toCurrency(Number(item.mcap), false, 4, '$', '', false, 0) }}
              </v-tooltip>
              <span v-else>N/A</span>
            </template>
            <template v-slot:[`item.allocation`]="{ item }">
              <span v-if="!item.allocation">N/A</span>
              <v-progress-linear
                v-else
                class="progress-bar"
                height="14"
                :value="item.allocation / totalAllocation * 100"
                color="#00dff3"
              >
                <template v-slot:default="{ value }">
                  <strong style="font-size: 8px">{{ value.toFixed(1) }}%</strong>
                </template>
              </v-progress-linear>
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
          </v-data-table>
        </v-tab-item>
      </v-tabs-items>
    </v-card-text>
    <TokensDialog @close="closeDialog" :modalData="dialogData"></TokensDialog>
  </v-card>
</template>
<script setup lang="ts">
import { ref, computed, toRefs, onMounted, watch } from 'vue';
import TokensDialog from '@/modules/assets/dialogs/TokensDialog.vue';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import { Blockchain, Network } from '@/models/types';
import assts from '@/utils/assets'
import { walletStore } from '@/stores/walletStore';
import { loadingState } from '@/stores/loading';
import { networkStore } from '@/stores/networkStore';
import { xerberusStore } from '@/stores/xerberusStore';
import { dexHunterStore } from '@/stores/dexHunterStore';
import { realFiStore } from '@/stores/realFiStore';
import { get24hChange } from '@/shared/utils/resolver';
import { setWalletConfiguration } from '@/db/wallet-db';
import { coinGeckoStore } from '@/stores/coinGeckoStore';
import WalletStore from '@/stores/walletStore';

const { price } = toRefs(networkStore);
const { loggedWallet, config, collections, tokens } = toRefs(walletStore);
const { loadingTxs } = toRefs(loadingState);
const { risks } = toRefs(xerberusStore);
const { dexHunterTokens } = toRefs(dexHunterStore);
const { tokens: realFiTokens } = toRefs(realFiStore);
const { cache } = toRefs(coinGeckoStore)

const hideScam = ref<boolean>(false);
const hideUnrated = ref<boolean>(false);
const hideUnverified = ref<boolean>(false);
const sortOptions = ref<any>({
  by: 'allocation',
  desc: true
})
const filtersMenu = ref<boolean>(false);
const collectiblesSortBy = ref<string>('name');
const collectiblesSortDesc = ref<boolean>(false);
const currentTab = ref<number>(0);
const assetsHeaders = ref<any[]>([
  { text: "Asset", align: "start", sortable: true, value: "name" },
  { text: "Risk", align: "center", sortable: true, value: "risk", width: "64" },
  { text: "Quantity", align: "center", sortable: true, value: "quantity", width: "100" },
  { text: "Price", align: "center", sortable: true, value: "price", width: "100"  },
  { text: "Value", align: "center", sortable: true, value: "value", width: "72" },
  // { text: "Cost Basis", align: "center", sortable: false, value: "cost_basis", width: "102" },
  // { text: "AVG Price", align: "center", sortable: false, value: "avg_price", width: "98" },
  // { text: "P&L", align: "center", sortable: false, value: "pnl" },
  { text: "M. Cap", align: "center", sortable: true, value: "mcap", width: "100" },
  { text: "Allocation", align: "center", sortable: true, value: "allocation", width: "150" },
]);

const collectiblesHeaders = ref<any[]>([
  { text: "Asset", align: "start", sortable: true, value: "name" },
  { text: "Quantity", align: "center", sortable: true, value: "quantity", width: "90" },
  { text: "Floor", align: "center", sortable: true, value: "floor" },
  { text: "Cost Basis", align: "center", sortable: true, value: "cost_basis", width: "102" },
  { text: "AVG Price", align: "center", sortable: true, value: "avg_price", width: "98" },
  { text: "P&L", align: "center", sortable: true, value: "pnl" },
  { text: "Allocation", align: "center", sortable: true, value: "allocation", width: "150" },
]);
const dialogData = ref<any>(null);

const assetsSort = computed({
  get() {
    return config.value.tokenAllocationSort || {
      by: 'allocation',
      desc: true
    }
  },
  set(val) {
    setWalletConfiguration(loggedWallet.value.id, 'tokenAllocationSort', val)
  },
})

watch(hideScam, (newVal, _oldVal) => {
  WalletStore.setHideScamTokens(newVal);
})

watch(hideUnverified, (newVal, _oldVal) => {
  WalletStore.setHideUnverifiedTokens(newVal);
})

watch(hideUnrated, (newVal, _oldVal) => {
  WalletStore.setHideUnratedTokens(newVal);
})

watch(sortOptions, (newVal, _oldVal) => {
  assetsSort.value = newVal
}, {
  deep: true
})

// Watch for config changes after initial mount
watch(() => config.value, (newConfig) => {
  if (newConfig) {
    hideScam.value = newConfig.hideScamTokens || false;
    hideUnrated.value = newConfig.hideUnratedTokens || false;
    hideUnverified.value = newConfig.hideUnverifiedTokens || false;
  }
}, { immediate: true })

const handleSwitchTab = (tab) => {
  currentTab.value = tab;
}

const closeDialog = () => {
  dialogData.value = null;
}

const handleOnRowClick = (row) => {
  dialogData.value = row;
}

const handleTokenRowClick = (row) => {
  console.log(row)
}

const clearFilters = () => {
  hideUnverified.value = false;
  hideScam.value = false;
  hideUnrated.value = false;
}

const customSort = (items, sortBy, sortDesc) => {
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

      return sortDesc[0] ? rankA - rankB : rankB - rankA;
    } else if (sortKey === 'quantity') {
      const quantityA = Number(filters.toCurrency(a.quantity, false, 6, '', '', false, a.metadata?.decimals).replaceAll(',', ''))
      const quantityB = Number(filters.toCurrency(b.quantity, false, 6, '', '', false, b.metadata?.decimals).replaceAll(',', ''))
      return sortDesc[0] ? quantityB - quantityA : quantityA - quantityB;
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
}

const totalAllocation = computed(() => {
  let total = 0
  if (tokensList.value.length === 1) {
    const token = tokensList.value[0]
    let res;
    if (token.metadata.ticker === networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)) {
      res = Number(filters.toCurrency(token.quantity, false, token.decimals, '', '', false, 6)) * price.value?.lastPrice
    } else {
      res = token.value
    }
    return res;
  }
  tokensList.value.forEach(token => {
    if (token.value) {
      total += token.value
    }
  })
  return total
})

const filtersAmount = computed(() => {
  let amt = 0
  if (hideScam.value) {
    amt++
  }
  if (hideUnrated.value) {
    amt++
  }
  if (hideUnverified.value) {
    amt++
  }
  return amt
})

const collectiblesLength = computed(() => {
  let amount = 0;
  if (collectibles.value.length > 0) {
    collectibles.value.forEach((collection: any) => {
      if (collection.items) {
        amount += collection.items.length
      }
    })
  }
  return amount
})

const tokensList = computed(() => {
  let res = Object.values(tokens.value).map((token: any) => {
    if (token.policy_id === '') {
      token.risk = 'AAA';
      token.price = Number(price.value?.lastPrice);
      let coinGeckoCurrency = 'cardano'
      if (token.name === 'Cardano') {
        coinGeckoCurrency = 'cardano'
      } else if (token.name === 'Apex Fusion') {
        coinGeckoCurrency = 'apex-2'
      }
      token.mcap = cache.value[coinGeckoCurrency]?.usd_market_cap
      const quantity = Number(filters.toCurrency(token.quantity, false, 6, '', '', false, token.metadata?.decimals).replaceAll(',', ''))
      token.value = quantity * token.price;
      token.allocation = token.value;
      token.change = price.value?.priceChangePercent;
    } else {
      token.risk = risks.value[token.fingerprint]?.risk
      token.price = dexHunterTokens.value[token.unit]?.price
      token.mcap = dexHunterTokens.value[token.unit]?.mcap
      const quantity = Number(filters.toCurrency(token.quantity, false, 6, '', '', false, token.metadata?.decimals).replaceAll(',', ''))
      token.value = quantity * token.price
      token.allocation = token.value
      token.change = get24hChange(realFiTokens.value[token.unit])?.percentChange
    }
    if (isNaN(token.allocation)) {
      token.allocation = 0
    }
    return token
  });
  res = res.filter(token => {
    if (hideScam.value && token.isScam) {
      return false;
    }
    if (hideUnverified.value && !token.verified) {
      return false;
    }
    if (hideUnrated.value && !token.risk) {
      return false;
    }
    return true;
  })
  return res;
});

const collectibles = computed(() => {
  let res = Object.values(collections.value).filter((collection: any) => collection.items.every(item => !item.metadata))
  if (res && hideScam.value) {
    res = res.filter((collection: any) => !collection.isScam)
  }
  return res
})



onMounted(() => {
  sortOptions.value = assetsSort.value;
  hideScam.value = config.value?.hideScamTokens || false;
  hideUnrated.value = config.value?.hideUnratedTokens || false;
  hideUnverified.value = config.value?.hideUnverifiedTokens || false;
})
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
</style>
