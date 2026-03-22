<template>
  <v-data-table
    dense
    class="transparent tokens-table adaptive-height"
    :headers="headers"
    :items="paginatedTokens"
    :sort-by.sync="sortOptions.by"
    :sort-desc.sync="sortOptions.desc"
    :items-per-page="-1"
    hide-default-footer
    :header-props="{ 'sort-icon': 'mdi-menu-up' }"
    :style="{ minHeight: tableHeight + 'px' }"
    @click:row="handleTokenRowClick"
  >
    <template v-slot:body.append>
      <tr v-if="tokensList.length > 6" class="no-hover">
        <td :colspan="headers.length" class="text-center pa-0 ma-0">
          <v-pagination
            v-model="currentPage"
            :length="Math.ceil(tokensList.length / 6)"
            :total-visible="6"
            circle
            class="compact-pagination ma-0"
          ></v-pagination>
        </td>
      </tr>
    </template>
    <template v-slot:[`item.name`]="{ item }">
      <v-list-item dense class="px-0">
        <v-list-item-action class="my-0" style="margin-right: 16px !important">
          <v-badge overlap avatar color="transparent" :offset-y="37" v-if="item['verified']">
            <template v-slot:badge>
              <v-avatar color="transparent" tile>
                <v-icon small color="primary"> mdi-check-decagram </v-icon>
              </v-avatar>
            </template>
            <v-avatar size="32">
              <img v-if="item['img']" :src="item['img']" :alt="`${item['ticker']} Logo`" />
            </v-avatar>
          </v-badge>
          <v-avatar size="32" v-else>
            <img v-if="item['img']" :src="item['img']" :alt="`${item['ticker']} Logo`" />
          </v-avatar>
        </v-list-item-action>
        <v-list-item-content>
          <v-list-item-title>
            <v-tooltip top :open-delay="300" content-class="custom-tooltip" v-if="item?.metadata?.description">
              <template v-slot:activator="{ on, attrs }">
                <span v-bind="attrs" v-on="on" class="token-name-hover">{{ item.name }}</span>
              </template>
              <div class="token-description-content">
                {{ item.metadata.description }}
              </div>
            </v-tooltip>
            <span v-else>{{ item.name }}</span>
            <v-avatar size="16" style="margin-top: -2px; margin-left: 4px !important">
              <v-img
                width="32"
                style="margin: auto"
                v-if="item.risk && item.risk !== 'N/A'"
                :src="assets.resolveRisk(item.risk)"
                :alt="item.risk"
              />
            </v-avatar>
          </v-list-item-title>
        </v-list-item-content>
      </v-list-item>
    </template>
    <template v-slot:[`item.quantity`]="{ item }">
      <v-tooltip top :open-delay="500" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on">
            {{ filters.toCurrency(item.quantity, false, 3, '', '', true, item.metadata?.decimals) }}
          </span>
        </template>
        {{ filters.toCurrency(item.quantity, false, 6, '', '', false, item.metadata?.decimals) }}
      </v-tooltip>
    </template>
    <template v-slot:[`item.price`]="{ item }">
      <v-list-item two-line class="px-0" style="min-height: unset">
        <v-list-item-content class="pa-0">
          <v-list-item-title style="font-size: 0.875rem; margin-bottom: 0">
            <span v-if="!item.price">N/A</span>
            <span v-else>
              <v-tooltip top :open-delay="500" content-class="custom-tooltip">
                <template v-slot:activator="{ on, attrs }">
                  <span v-bind="attrs" v-on="on">
                    {{ filters.toCurrency(item.price, false, 4, getCurrencySymbol(), '', true, 0) }}
                  </span>
                </template>
                {{ filters.toCurrency(item.price, false, 6, getCurrencySymbol(), '', false, 0) }}
              </v-tooltip>
            </span>
          </v-list-item-title>
          <v-list-item-subtitle class="px-0" v-if="item.change !== undefined">
            <v-avatar tile size="12" class="mr-1" style="align-self: center">
              <v-img
                :src="
                  item.change === 0 ? assets.arrowRightSvg : item.change > 0 ? assets.trendUpSvg : assets.trendDownSvg
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
              {{ Math.abs(item.change).toFixed(2) + '%' }}
            </span>
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </template>
    <template v-slot:[`item.value`]="{ item }">
      <span v-if="!item.price">N/A</span>
      <span v-else>
        <v-tooltip top :open-delay="500" content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <span v-bind="attrs" v-on="on">
              {{ filters.toCurrency(item.value, false, 3, getCurrencySymbol(), '', true, 0) }}
            </span>
          </template>
          {{ filters.toCurrency(item.value, false, 6, getCurrencySymbol(), '', false, 0) }}
        </v-tooltip>
      </span>
    </template>
    <template v-slot:[`item.mcap`]="{ item }">
      <v-tooltip v-if="item.mcap" top :open-delay="500" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on">
            {{ filters.toCurrency(Number(item.mcap), false, 2, getCurrencySymbol(), '', true, 0) }}
          </span>
        </template>
        {{ filters.toCurrency(Number(item.mcap), false, 4, getCurrencySymbol(), '', false, 0) }}
      </v-tooltip>
      <span v-else>N/A</span>
    </template>
    <template v-slot:[`item.allocation`]="{ item }">
      <span v-if="!item.allocation">N/A</span>
      <v-progress-linear
        v-else
        class="progress-bar"
        height="14"
        :value="(item.allocation / totalAllocation) * 100"
        color="primary"
      >
        <template v-slot:default="{ value }">
          <strong style="font-size: 8px">{{ value.toFixed(1) }}%</strong>
        </template>
      </v-progress-linear>
    </template>
  </v-data-table>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, toRefs, watch } from 'vue';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { xerberusStore } from '@/stores/xerberusStore';
import { dexHunterStore } from '@/stores/dexHunterStore';
import { realFiStore } from '@/stores/realFiStore';
import { coinGeckoStore } from '@/stores/coinGeckoStore';
import { priceStore } from '@/stores/priceStore';
import { get24hChange } from '@/shared/utils/resolver';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';

// Props
interface Props {
  sortOptions: any;
  hideScam?: boolean;
  hideUnverified?: boolean;
  hideUnrated?: boolean;
  searchTerm?: string;
  containerHeight?: number;
}

const props = withDefaults(defineProps<Props>(), {
  hideScam: false,
  hideUnverified: false,
  hideUnrated: false,
  searchTerm: '',
  containerHeight: 348,
});

// Emits
const emit = defineEmits(['update:sortOptions']);
const { t } = useTranslation();
// Store references
const { price } = toRefs(networkStore);
const { loggedWallet, tokens } = toRefs(walletStore);
const { risks } = toRefs(xerberusStore);
const { dexHunterTokens } = toRefs(dexHunterStore);
const { tokens: realFiTokens } = toRefs(realFiStore);
const { cache } = toRefs(coinGeckoStore);

const { convertFiat, getCurrencySymbol } = useCurrencyConverter();

// Headers for the data table
const headers = ref<any[]>([
  { text: String(t('common.asset')), align: 'start', sortable: true, value: 'name' },
  { text: String(t('common.quantity')), align: 'center', sortable: true, value: 'quantity', width: '102' },
  { text: String(t('common.price')), align: 'center', sortable: true, value: 'price', width: '100' },
  { text: String(t('common.value')), align: 'center', sortable: true, value: 'value', width: '88' },
  { text: String(t('common.marketCap')), align: 'center', sortable: true, value: 'mcap', width: '104' },
  { text: String(t('common.allocation')), align: 'center', sortable: true, value: 'allocation', width: '130' },
]);

// Pagination
const currentPage = ref(1);
const itemsPerPage = 6;

// Computed for two-way binding with parent
const sortOptions = computed({
  get() {
    return props.sortOptions;
  },
  set(value) {
    emit('update:sortOptions', value);
  },
});

// Methods
const customSort = (items: any[], sortBy: any[], sortDesc: any[]) => {
  // First, separate native tokens from others
  const nativeTokens = items.filter(item => {
    // Check if it's a native token (empty policy_id means native token)
    if (item.policy_id === '') {
      // For Cardano blockchain, pin ADA (Cardano)
      if (loggedWallet.value?.chain === 'Cardano' && item.name === 'Cardano') {
        return true;
      }
      // For Apex blockchains, pin AP3X (Apex Fusion)
      if (
        (loggedWallet.value?.chain === 'Apex Fusion Prime' || loggedWallet.value?.chain === 'Apex Fusion Vector') &&
        item.name === 'Apex Fusion'
      ) {
        return true;
      }
    }
    return false;
  });

  const otherTokens = items.filter(item => {
    if (item.policy_id === '') {
      if (loggedWallet.value?.chain === 'Cardano' && item.name === 'Cardano') {
        return false;
      }
      if (
        (loggedWallet.value?.chain === 'Apex Fusion Prime' || loggedWallet.value?.chain === 'Apex Fusion Vector') &&
        item.name === 'Apex Fusion'
      ) {
        return false;
      }
    }
    return true;
  });

  // Sort the non-native tokens if sortBy is specified
  if (sortBy.length) {
    otherTokens.sort((a: any, b: any) => {
      const sortKey = sortBy[0];
      const compareA = a[sortKey];
      const compareB = b[sortKey];
      if (sortKey === 'risk') {
        const riskOrder = {
          AAA: 1,
          AA: 2,
          A: 3,
          BBB: 4,
          BB: 5,
          B: 6,
          CCC: 7,
          CC: 8,
          C: 9,
          D: 10,
        };

        const rankA = riskOrder[compareA] || 11; // Default for unknown ratings
        const rankB = riskOrder[compareB] || 11;

        return sortDesc[0] ? rankA - rankB : rankB - rankA;
      } else if (sortKey === 'quantity') {
        const quantityA = Number(
          filters.toCurrency(a.quantity, false, 6, '', '', false, a.metadata?.decimals).replaceAll(',', '')
        );
        const quantityB = Number(
          filters.toCurrency(b.quantity, false, 6, '', '', false, b.metadata?.decimals).replaceAll(',', '')
        );
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

  // Always put native tokens first
  return [...nativeTokens, ...otherTokens];
};

// Computed properties
const tokensList = computed(() => {
  let res = Object.values(tokens.value).map((token: any) => {
    if (token.policy_id === '') {
      token.risk = 'AAA';
      // Use Kraken WebSocket price for ADA, fallback to network store price (in USD)
      // Convert to user's selected currency (USD or EUR)
      const usdPrice = priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0;
      token.price = convertFiat(usdPrice);
      let coinGeckoCurrency = 'cardano';
      if (token.name === 'Cardano') {
        coinGeckoCurrency = 'cardano';
      } else if (token.name === 'Apex Fusion') {
        coinGeckoCurrency = 'apex-2';
        token.price = convertFiat(price.value?.lastPrice || 0);
      }
      token.mcap = convertFiat(cache.value[coinGeckoCurrency]?.usd_market_cap);
      const quantity = Number(
        filters.toCurrency(token.quantity, false, 6, '', '', false, token.metadata?.decimals).replaceAll(',', '')
      );
      token.value = quantity * token.price;
      token.allocation = token.value;
      // Use Kraken WebSocket price change for ADA, fallback to network store
      token.change = priceStore.adaUsd?.priceChangePercentage || price.value?.priceChangePercent;
    } else {
      token.risk = risks.value[token.fingerprint]?.risk;
      // DexHunter prices are in ADA, convert to USD first, then to user's selected currency
      const priceInAda = dexHunterTokens.value[token.unit]?.price || 0;
      const adaPriceUsd = priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0;
      const priceInUsd = priceInAda * adaPriceUsd;
      token.price = convertFiat(priceInUsd);
      token.mcap = convertFiat(dexHunterTokens.value[token.unit]?.mcap);
      const quantity = Number(
        filters.toCurrency(token.quantity, false, 6, '', '', false, token.metadata?.decimals).replaceAll(',', '')
      );
      token.value = quantity * token.price;
      token.allocation = token.value;
      token.change = get24hChange(realFiTokens.value[token.unit])?.percentChange;
    }
    if (isNaN(token.allocation)) {
      token.allocation = 0;
    }
    return token;
  });

  // Apply filters
  res = res.filter(token => {
    if (props.hideScam && token.isScam) {
      return false;
    }
    if (props.hideUnverified && !token.verified) {
      return false;
    }
    if (props.hideUnrated && !token.risk) {
      return false;
    }
    return true;
  });

  // Apply search filter
  if (props.searchTerm && props.searchTerm.trim()) {
    const searchTerm = props.searchTerm.toLowerCase().trim();
    res = res.filter(token => {
      const name = token.name?.toLowerCase() || '';
      const ticker = token.metadata?.ticker?.toLowerCase() || '';
      const description = token.metadata?.description?.toLowerCase() || '';
      const unit = token.unit?.toLowerCase() || '';

      return (
        name.includes(searchTerm) ||
        ticker.includes(searchTerm) ||
        description.includes(searchTerm) ||
        unit.includes(searchTerm)
      );
    });
  }

  // Pin ADA to the top for Cardano blockchain
  if (loggedWallet.value?.chain === 'Cardano') {
    const adaToken = res.find(
      token =>
        token.policy_id === '' &&
        (token.name === 'Cardano' || token.metadata?.ticker === 'ADA' || token.unit === 'lovelace')
    );

    if (adaToken) {
      const otherTokens = res.filter(
        token =>
          !(
            token.policy_id === '' &&
            (token.name === 'Cardano' || token.metadata?.ticker === 'ADA' || token.unit === 'lovelace')
          )
      );
      res = [adaToken, ...otherTokens];
    }
  }

  return res;
});

const totalAllocation = computed(() => {
  let total = 0;
  if (tokensList.value.length === 1) {
    const token = tokensList.value[0];
    // Use the already calculated value (already in correct currency)
    return token.value || 0;
  }
  tokensList.value.forEach(token => {
    if (token.value) {
      total += token.value;
    }
  });
  return total;
});

const handleTokenRowClick = (_row: any) => {
  // TODO: Implement token detail view
};

// Sort the full tokensList first, then paginate
const sortedTokens = computed(() => {
  const sortBy = [sortOptions.value.by];
  const sortDesc = [sortOptions.value.desc];

  // Apply custom sort to the entire tokensList
  return customSort(tokensList.value, sortBy, sortDesc);
});

const paginatedTokens = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage;
  const end = start + itemsPerPage;

  // Now paginate the already sorted and filtered results
  return sortedTokens.value.slice(start, end);
});

// Use the shared container height from parent
const tableHeight = computed(() => props.containerHeight);

// Watch for search term changes to reset pagination
watch(
  () => props.searchTerm,
  () => {
    currentPage.value = 1;
  }
);
</script>

<style scoped>
.progress-bar {
  border-radius: 10px;
  background-color: #333741;
  display: inline-block;
  margin-right: 10px;
}

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

.token-description-content {
  color: #ffffff !important;
  font-size: 14px !important;
  line-height: 1.4 !important;
  font-weight: 400 !important;
}

.token-name-hover {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
  transition: opacity 0.2s ease;
}

.token-name-hover:hover {
  opacity: 0.8;
}
.tokens-table.adaptive-height {
  transition: min-height 0.3s ease;
  overflow: visible;
}

.tokens-table.adaptive-height >>> .v-data-table__wrapper {
  overflow: visible;
  min-height: unset;
}

.tokens-table >>> tbody {
  transition: height 0.2s ease;
}
</style>
