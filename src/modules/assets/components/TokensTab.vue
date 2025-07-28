<template>
  <v-data-table
    dense
    class="transparent"
    :headers="headers"
    :items="tokensList"
    :sort-by.sync="sortOptions.by"
    :sort-desc.sync="sortOptions.desc"
    :items-per-page="5"
    :header-props="{ 'sort-icon': 'mdi-menu-up' }"
    :custom-sort="customSort"
  >
    <template v-slot:[`item.name`]="{ item }">
      <v-list-item dense class="px-0">
        <v-list-item-action class="my-0 mr-4">
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
            <v-avatar size="16" style="margin-top: -2px; margin-left: 2px;">
              <v-img width="32" style="margin: auto" v-if="item.risk && item.risk !== 'N/A'" :src="assets.resolveRisk(item.risk)" :alt="item.risk" />
            </v-avatar>
          </v-list-item-title>
          <v-list-item-subtitle style="display: -webkit-box; -webkit-line-clamp: 1; line-clamp: 1; -webkit-box-orient: vertical;overflow: hidden;text-overflow: ellipsis;white-space: normal;">
            {{item?.metadata?.description}}
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </template>
    <template v-slot:[`item.quantity`]="{ item }">
      <v-tooltip top :open-delay="500">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on">
            {{ filters.toCurrency(item.quantity, false, 3, '', '', true, item.metadata?.decimals) }}
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
                ? assets.arrowRightSvg
                : item.change > 0
                ? assets.trendUpSvg
                : assets.trendDownSvg
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
              {{ filters.toCurrency(item.value, false, 3, '$', '', true, 0) }}
            </span>
          </template>
          {{ filters.toCurrency(item.value, false, 6, '$', '', false, 0) }}
        </v-tooltip>
      </span>
    </template>
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
</template>

<script setup lang="ts">
import { ref, computed, toRefs } from 'vue';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { xerberusStore } from '@/stores/xerberusStore';
import { dexHunterStore } from '@/stores/dexHunterStore';
import { realFiStore } from '@/stores/realFiStore';
import { coinGeckoStore } from '@/stores/coinGeckoStore';
import { get24hChange } from '@/shared/utils/resolver';

// Props
interface Props {
  sortOptions: any;
  hideScam?: boolean;
  hideUnverified?: boolean;
  hideUnrated?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  hideScam: false,
  hideUnverified: false,
  hideUnrated: false
});

// Emits
const emit = defineEmits(['update:sortOptions']);

// Store references
const { price } = toRefs(networkStore);
const { loggedWallet, tokens } = toRefs(walletStore);
const { risks } = toRefs(xerberusStore);
const { dexHunterTokens } = toRefs(dexHunterStore);
const { tokens: realFiTokens } = toRefs(realFiStore);
const { cache } = toRefs(coinGeckoStore);

// Headers for the data table
const headers = ref<any[]>([
  { text: "Asset", align: "start", sortable: true, value: "name" },
  { text: "Quantity", align: "center", sortable: true, value: "quantity", width: "102" },
  { text: "Price", align: "center", sortable: true, value: "price", width: "100"  },
  { text: "Value", align: "center", sortable: true, value: "value", width: "88" },
  { text: "M. Cap", align: "center", sortable: true, value: "mcap", width: "104" },
  { text: "Allocation", align: "center", sortable: true, value: "allocation", width: "130" },
]);

// Computed for two-way binding with parent
const sortOptions = computed({
  get() {
    return props.sortOptions;
  },
  set(value) {
    emit('update:sortOptions', value);
  }
});

// Methods
const customSort = (items: any[], sortBy: any[], sortDesc: any[]) => {
  if (!sortBy.length) return items;

  return items.sort((a: any, b: any) => {
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
};

// Computed properties
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
    if (props.hideScam && token.isScam) {
      return false;
    }
    if (props.hideUnverified && !token.verified) {
      return false;
    }
    return !(props.hideUnrated && !token.risk);

  })
  return res;
});

const totalAllocation = computed(() => {
  let total = 0
  if (tokensList.value.length === 1) {
    const token = tokensList.value[0]
    let res: any;
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
});
</script>

<style scoped>
.progress-bar {
  border-radius: 10px;
  background-color: #333741;
  display: inline-block;
  margin-right: 10px;
}
</style>
