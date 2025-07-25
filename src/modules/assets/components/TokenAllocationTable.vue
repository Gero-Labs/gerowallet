<template>
  <v-card outlined class="no-gutters fill-height liquid-glass" :loading="loadingTxs">
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
          <!-- NFT Gallery Container -->
          <div class="nft-gallery-container">
            
            <!-- Gallery Controls -->
            <div class="gallery-controls mb-4">
              <div class="d-flex align-center justify-space-between">
                <div class="d-flex align-center gap-3">
                  <v-text-field
                    v-model="collectiblesSearch"
                    dense
                    outlined
                    hide-details
                    placeholder="Search collections..."
                    prepend-inner-icon="mdi-magnify"
                    clearable
                    style="max-width: 280px;"
                    class="collection-search"
                  ></v-text-field>
                </div>
                
                <div class="d-flex align-center gap-3">
                  <v-select
                    v-model="collectiblesSortBy"
                    :items="sortOptionsDropdown"
                    dense
                    outlined
                    hide-details
                    style="max-width: 120px; font-size: 12px; margin-right: 12px;"
                    class="sort-select-small"
                  ></v-select>
                  
                  <span class="text-caption mr-2">Size:</span>
                  <v-btn-toggle v-model="cardSizeMode" mandatory dense>
                    <v-btn value="small" x-small>S</v-btn>
                    <v-btn value="medium" x-small>M</v-btn>
                    <v-btn value="large" x-small>L</v-btn>
                  </v-btn-toggle>
                </div>
              </div>
            </div>

            <!-- Grid View -->
            <div v-if="collectiblesViewMode === 'grid'" class="gallery-grid" :class="gridSizeClass">
              <v-card 
                v-for="collection in paginatedCollectibles" 
                :key="collection.id || collection.name"
                class="nft-collection-card liquid-glass-card"
                @click="handleOnRowClick(collection)"
              >
                <!-- Image Container -->
                <div class="card-image-container" :style="{ height: cardSize + 'px' }">
                  <v-img 
                    :src="collection.img" 
                    :alt="collection.name"
                    :aspect-ratio="1"
                    class="collection-image"
                    :gradient="collection.isScam ? 'to bottom, transparent 60%, rgba(249, 112, 102, 0.8) 100%' : 'to bottom, transparent 60%, rgba(0,0,0,0.8) 100%'"
                  >
                    <!-- Overlay badges -->
                    <div class="card-badges">
                      <v-chip v-if="collection.isScam" small color="error">
                        <v-icon left x-small>mdi-alert-decagram</v-icon>
                        Scam
                      </v-chip>
                      <v-chip v-if="collection.verified" small color="primary">
                        <v-icon left x-small>mdi-check-decagram</v-icon>
                        Verified
                      </v-chip>
                    </div>
                    
                    <!-- Quantity badge -->
                    <div class="quantity-badge">
                      <v-chip small outlined class="quantity-chip">
                        {{ Number(collection.quantity || 1).toLocaleString() }} items
                      </v-chip>
                    </div>
                  </v-img>
                </div>

                <!-- Card Content with Liquid Glass Effect -->
                <div class="card-content-overlay">
                  <h3 class="collection-name-glass">{{ collection.name }}</h3>
                </div>
              </v-card>
            </div>

            <!-- Masonry Layout -->
            <div v-if="collectiblesViewMode === 'masonry'" class="gallery-masonry">
              <v-card 
                v-for="collection in paginatedCollectibles" 
                :key="collection.id || collection.name"
                class="nft-collection-card masonry-item liquid-glass-card"
                @click="handleOnRowClick(collection)"
              >
                <div class="card-image-container">
                  <v-img 
                    :src="collection.img" 
                    :alt="collection.name"
                    class="collection-image"
                    contain
                  >
                    <div class="card-badges">
                      <v-chip v-if="collection.isScam" small color="error">Scam</v-chip>
                    </div>
                    <div class="quantity-badge">
                      <v-chip small outlined class="quantity-chip">{{ Number(collection.quantity || 1).toLocaleString() }} items</v-chip>
                    </div>
                  </v-img>
                </div>
                <div class="card-content-overlay">
                  <h3 class="collection-name-glass">{{ collection.name }}</h3>
                </div>
              </v-card>
            </div>

            <!-- List View -->
            <div v-if="collectiblesViewMode === 'list'" class="gallery-list">
              <v-card 
                v-for="collection in paginatedCollectibles" 
                :key="collection.id || collection.name"
                class="nft-collection-item liquid-glass-card mb-3"
                @click="handleOnRowClick(collection)"
              >
                <div class="d-flex align-center pa-3">
                  <v-avatar size="60" class="mr-4">
                    <v-img :src="collection.img" :alt="collection.name" />
                  </v-avatar>
                  <div class="flex-grow-1">
                    <h3 class="collection-name-glass mb-1">{{ collection.name }}</h3>
                    <p class="text-caption mb-0">{{ Number(collection.quantity || 1).toLocaleString() }} items</p>
                    <p v-if="collection.description" class="text-body-2 text--secondary mb-0">
                      {{ Array.isArray(collection.description) ? collection.description.join('') : collection.description }}
                    </p>
                  </div>
                  <div class="ml-3">
                    <v-chip v-if="collection.isScam" small color="error">Scam</v-chip>
                    <v-chip v-if="collection.verified" small color="primary">Verified</v-chip>
                  </div>
                </div>
              </v-card>
            </div>

            <!-- Pagination for gallery views -->
            <v-pagination
              v-if="totalPages > 1"
              v-model="collectiblesPage"
              :length="totalPages"
              :total-visible="7"
              class="mt-4"
            ></v-pagination>

          </div>
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

// Advanced Gallery Features
const collectiblesViewMode = ref<string>('grid'); // grid, masonry, list
const cardSizeMode = ref<string>('small'); // small, medium, large
const collectiblesSearch = ref<string>('');
const collectiblesPage = ref<number>(1);

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

// Gallery computed properties
const sortOptionsDropdown = computed(() => [
  { text: 'Name (A-Z)', value: 'name' },
  { text: 'Name (Z-A)', value: 'name_desc' },
  { text: 'Quantity (High-Low)', value: 'quantity_desc' },
  { text: 'Quantity (Low-High)', value: 'quantity' }
])

const cardSize = computed(() => {
  switch (cardSizeMode.value) {
    case 'small': return 140
    case 'medium': return 200
    case 'large': return 260
    default: return 200
  }
})

const gridSizeClass = computed(() => {
  return `grid-${cardSizeMode.value}`
})

const dynamicItemsPerPage = computed(() => {
  switch (cardSizeMode.value) {
    case 'small': return 30
    case 'medium': return 20
    case 'large': return 12
    default: return 20
  }
})

const sortedCollectibles = computed(() => {
  if (!collectibles.value) return []
  
  let sorted = [...collectibles.value]
  
  // Apply search filter first
  if (collectiblesSearch.value) {
    const searchTerm = collectiblesSearch.value.toLowerCase()
    sorted = sorted.filter(collection => {
      // Search in name
      if (collection.name && collection.name.toLowerCase().includes(searchTerm)) {
        return true
      }
      
      // Search in description
      if (collection.description) {
        let descriptionText = ''
        if (typeof collection.description === 'string') {
          descriptionText = collection.description
        } else if (Array.isArray(collection.description)) {
          descriptionText = collection.description.join(' ')
        }
        if (descriptionText.toLowerCase().includes(searchTerm)) {
          return true
        }
      }
      
      return false
    })
  }
  
  // Then apply sorting
  switch (collectiblesSortBy.value) {
    case 'name_desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name))
      break
    case 'quantity':
      sorted.sort((a, b) => (a.quantity || 0) - (b.quantity || 0))
      break
    case 'quantity_desc':
      sorted.sort((a, b) => (b.quantity || 0) - (a.quantity || 0))
      break
    default: // 'name'
      sorted.sort((a, b) => a.name.localeCompare(b.name))
  }
  
  return sorted
})

const paginatedCollectibles = computed(() => {
  const start = (collectiblesPage.value - 1) * dynamicItemsPerPage.value
  const end = start + dynamicItemsPerPage.value
  return sortedCollectibles.value.slice(start, end)
})

const totalPages = computed(() => {
  return Math.ceil(sortedCollectibles.value.length / dynamicItemsPerPage.value)
})

// Watch for search and card size changes to reset pagination
watch(cardSizeMode, () => {
  collectiblesPage.value = 1
})

watch(collectiblesSearch, () => {
  collectiblesPage.value = 1
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

/* NFT Gallery Liquid Glass Effects */
.nft-gallery-container {
  position: relative;
  z-index: 1;
}

.liquid-glass-card,
.v-card.liquid-glass-card {
  background-color: rgba(255, 255, 255, 0.05) !important;
  background-image: none !important;
  backdrop-filter: blur(10px) !important;
  -webkit-backdrop-filter: blur(10px) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 12px !important;
  transition: all 0.3s ease !important;
  cursor: pointer !important;
  overflow: hidden !important;
}

.liquid-glass-card:hover,
.v-card.liquid-glass-card:hover {
  background-color: rgba(255, 255, 255, 0.08) !important;
  backdrop-filter: blur(15px) !important;
  -webkit-backdrop-filter: blur(15px) !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  transform: translateY(-2px) !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
}

.nft-collection-card {
  position: relative;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
}

.card-image-container {
  position: relative;
  overflow: hidden;
  border-radius: 12px 12px 0 0;
}

.collection-image {
  transition: transform 0.3s ease;
}

.nft-collection-card:hover .collection-image {
  transform: scale(1.05);
}

.card-badges {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  display: flex;
  gap: 4px;
}

.quantity-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  z-index: 2;
}

.quantity-chip {
  background: rgba(0, 0, 0, 0.7) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  color: white !important;
}

.card-content-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.collection-name-glass {
  color: white;
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Gallery Grid Layouts */
.gallery-grid {
  display: grid;
  gap: 16px;
}

.grid-small {
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
}

.grid-medium {
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

.grid-large {
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}

/* Masonry Layout */
.gallery-masonry {
  column-count: 4;
  column-gap: 16px;
}

.masonry-item {
  break-inside: avoid;
  margin-bottom: 16px;
}

@media (max-width: 1200px) {
  .gallery-masonry {
    column-count: 3;
  }
}

@media (max-width: 768px) {
  .gallery-masonry {
    column-count: 2;
  }
  .grid-small, .grid-medium, .grid-large {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
}

@media (max-width: 480px) {
  .gallery-masonry {
    column-count: 1;
  }
  .grid-small, .grid-medium, .grid-large {
    grid-template-columns: 1fr;
  }
}

/* List View */
.gallery-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.nft-collection-item {
  border-radius: 12px;
}

/* Gallery Controls */
.gallery-controls {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0;
}

.collection-search .v-input__control,
.sort-select .v-input__control {
  background: rgba(255, 255, 255, 0.05) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.collection-search .v-input__control .v-input__slot,
.sort-select .v-input__control .v-input__slot {
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
}

/* Ensure consistent smaller height for all gallery controls */
.gallery-controls .v-text-field {
  height: 32px !important;
}

.gallery-controls .v-text-field .v-input__control {
  min-height: 32px !important;
  height: 32px !important;
}

.gallery-controls .v-text-field .v-input__slot {
  min-height: 32px !important;
  height: 32px !important;
  padding: 0 12px !important;
}

.gallery-controls .v-text-field .v-input__prepend-inner {
  align-self: center !important;
  margin-top: 0 !important;
  padding-top: 0 !important;
}

.gallery-controls .v-text-field .v-input__prepend-inner .v-input__icon {
  height: 32px !important;
  align-items: center !important;
  justify-content: center !important;
}

.gallery-controls .v-text-field .v-input__prepend-inner .v-icon {
  font-size: 16px !important;
}

/* Smaller sort dropdown */
.sort-select-small {
  height: 24px !important;
  font-size: 12px !important;
}

.sort-select-small .v-input__control {
  min-height: 24px !important;
  height: 24px !important;
  font-size: 12px !important;
}

.sort-select-small .v-input__slot {
  min-height: 24px !important;
  height: 24px !important;
  padding: 0 24px 0 8px !important; /* More space for text, less for arrow */
  font-size: 12px !important;
}

.sort-select-small .v-select__selection {
  font-size: 12px !important;
  line-height: 24px !important;
  max-width: calc(100% - 20px) !important; /* Allow text to use more space */
}

.sort-select-small .v-input__append-inner {
  position: absolute !important;
  right: 4px !important; /* Position arrow close to right border */
  top: 50% !important;
  transform: translateY(-50%) !important;
  margin: 0 !important;
  padding: 0 !important;
  width: 16px !important;
}

.sort-select-small .v-input__append-inner .v-input__icon {
  padding: 0 !important;
  margin: 0 !important;
  width: 16px !important;
}

.sort-select-small .v-input__append-inner .v-icon {
  font-size: 16px !important;
}
</style>
