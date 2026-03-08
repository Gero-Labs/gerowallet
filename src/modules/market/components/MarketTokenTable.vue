<template>
  <v-data-table
    dense
    class="transparent tokens-table market-token-table"
    :headers="activeHeaders"
    :items="paginatedTokens"
    :sort-by.sync="sortBy"
    :sort-desc.sync="sortDesc"
    :items-per-page="-1"
    hide-default-footer
    :header-props="{ 'sort-icon': 'mdi-menu-up' }"
    :loading="loading"
    @click:row="handleRowClick"
  >
    <!-- Pagination -->
    <template v-slot:body.append>
      <tr v-if="tokens.length > itemsPerPage" class="no-hover">
        <td :colspan="activeHeaders.length" class="text-center pa-0 ma-0">
          <v-pagination
            v-model="currentPage"
            :length="totalPages"
            :total-visible="6"
            circle
            class="compact-pagination ma-0"
          ></v-pagination>
        </td>
      </tr>
    </template>

    <!-- No data -->
    <template v-slot:no-data>
      <div class="text-center py-6" style="opacity: 0.5">
        <v-icon large class="mb-2">mdi-magnify</v-icon>
        <div>{{ $t('market.noTokens') }}</div>
      </div>
    </template>

    <!-- Rank column -->
    <template v-slot:[`item.rank`]="{ index }">
      <span class="text--secondary" style="font-size: 12px">{{ (currentPage - 1) * itemsPerPage + index + 1 }}</span>
    </template>

    <!-- Token name column -->
    <template v-slot:[`item.name`]="{ item }">
      <v-list-item dense class="px-0">
        <v-list-item-action class="my-0" style="margin-right: 12px !important">
          <v-badge overlap avatar color="transparent" :offset-y="34" v-if="item.verified">
            <template v-slot:badge>
              <v-avatar color="transparent" tile>
                <v-icon x-small color="primary">mdi-check-decagram</v-icon>
              </v-avatar>
            </template>
            <v-avatar size="28">
              <img v-if="item.img" :src="item.img" :alt="`${item.ticker} Logo`" @error="handleImgError" />
              <v-icon v-else>mdi-circle-outline</v-icon>
            </v-avatar>
          </v-badge>
          <v-avatar size="28" v-else>
            <img v-if="item.img" :src="item.img" :alt="`${item.ticker} Logo`" @error="handleImgError" />
            <v-icon v-else>mdi-circle-outline</v-icon>
          </v-avatar>
        </v-list-item-action>
        <v-list-item-content>
          <v-list-item-title style="font-size: 13px">
            <span class="font-weight-bold">{{ item.ticker }}</span>
            <v-avatar size="14" style="margin-top: -2px; margin-left: 4px !important" v-if="item.riskRating">
              <v-img
                width="14"
                :src="assets.resolveRisk(item.riskRating)"
                :alt="item.riskRating"
              />
            </v-avatar>
          </v-list-item-title>
          <v-list-item-subtitle style="font-size: 10px; opacity: 0.5">
            {{ item.name }}
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </template>

    <!-- Price column -->
    <template v-slot:[`item.price`]="{ item }">
      <v-list-item two-line class="px-0" style="min-height: unset">
        <v-list-item-content class="pa-0">
          <v-list-item-title style="font-size: 13px; margin-bottom: 0">
            <v-tooltip top :open-delay="300" content-class="custom-tooltip">
              <template v-slot:activator="{ on, attrs }">
                <span v-bind="attrs" v-on="on">{{ formatPrice(item.price) }}</span>
              </template>
              ${{ item.price.toFixed(8) }}
            </v-tooltip>
          </v-list-item-title>
          <v-list-item-subtitle style="font-size: 10px; opacity: 0.5">
            {{ item.priceAda.toFixed(item.priceAda < 1 ? 4 : 2) }} ₳
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </template>

    <!-- Change columns -->
    <template v-slot:[`item.change1h`]="{ item }">
      <span :style="{ color: changeColor(item.change1h), fontSize: '12px' }">
        <v-avatar tile size="10" class="mr-1">
          <v-img :src="changeIcon(item.change1h)" alt="trend" />
        </v-avatar>
        {{ formatChange(item.change1h) }}
      </span>
    </template>

    <template v-slot:[`item.change24h`]="{ item }">
      <span :style="{ color: changeColor(item.change24h), fontSize: '12px' }">
        <v-avatar tile size="10" class="mr-1">
          <v-img :src="changeIcon(item.change24h)" alt="trend" />
        </v-avatar>
        {{ formatChange(item.change24h) }}
      </span>
    </template>

    <template v-slot:[`item.change7d`]="{ item }">
      <span :style="{ color: changeColor(item.change7d), fontSize: '12px' }">
        <v-avatar tile size="10" class="mr-1">
          <v-img :src="changeIcon(item.change7d)" alt="trend" />
        </v-avatar>
        {{ formatChange(item.change7d) }}
      </span>
    </template>

    <!-- Volume column -->
    <template v-slot:[`item.volume24h`]="{ item }">
      <v-tooltip top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on" style="font-size: 12px">${{ formatCompact(item.volume24h) }}</span>
        </template>
        ${{ item.volume24h.toLocaleString('en-US', { maximumFractionDigits: 0 }) }}
      </v-tooltip>
    </template>

    <!-- Market Cap column -->
    <template v-slot:[`item.mcap`]="{ item }">
      <v-tooltip top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on" style="font-size: 12px">${{ formatCompact(item.mcap) }}</span>
        </template>
        ${{ item.mcap.toLocaleString('en-US', { maximumFractionDigits: 0 }) }}
      </v-tooltip>
    </template>

    <!-- Holdings columns (when showHoldingsColumns) -->
    <template v-slot:[`item.balance`]="{ item }">
      <span style="font-size: 12px">{{ item.balance ? formatCompact(item.balance) : '—' }}</span>
    </template>

    <template v-slot:[`item.value`]="{ item }">
      <span style="font-size: 12px">{{ item.value ? '$' + formatCompact(item.value) : '—' }}</span>
    </template>

    <!-- Avg Cost column -->
    <template v-slot:[`item.avgCostBasis`]="{ item }">
      <span style="font-size: 12px">
        {{ item.avgCostBasis != null ? item.avgCostBasis.toFixed(item.avgCostBasis < 1 ? 4 : 2) + ' ₳' : '—' }}
      </span>
    </template>

    <!-- Total P&L column -->
    <template v-slot:[`item.totalPnl`]="{ item }">
      <v-tooltip top :open-delay="300" content-class="custom-tooltip" v-if="item.totalPnl != null">
        <template v-slot:activator="{ on, attrs }">
          <span
            v-bind="attrs"
            v-on="on"
            :style="{ color: pnlColor(item.totalPnl), fontSize: '12px', fontWeight: '500' }"
          >
            <v-avatar tile size="10" class="mr-1">
              <v-img :src="changeIcon(item.totalPnl)" alt="pnl" />
            </v-avatar>
            {{ item.totalPnl >= 0 ? '+' : '' }}{{ formatCompact(item.totalPnl) }} ₳
          </span>
        </template>
        <div>
          <div>{{ $t('market.unrealizedPnl') }}: {{ item.unrealizedPnl != null ? (item.unrealizedPnl >= 0 ? '+' : '') + item.unrealizedPnl.toFixed(2) + ' ₳' : '—' }}</div>
          <div>{{ $t('market.realizedPnl') }}: {{ item.realizedPnl != null ? (item.realizedPnl >= 0 ? '+' : '') + item.realizedPnl.toFixed(2) + ' ₳' : '—' }}</div>
        </div>
      </v-tooltip>
      <span v-else style="font-size: 12px">—</span>
    </template>

    <!-- Watchlist column -->
    <template v-slot:[`item.watchlist`]="{ item }">
      <v-tooltip bottom :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <v-btn icon x-small v-bind="attrs" v-on="on" @click.stop="toggleWatch(item.unit)">
            <v-icon small :color="isWatched(item.unit) ? 'amber' : ''">
              {{ isWatched(item.unit) ? 'mdi-star' : 'mdi-star-outline' }}
            </v-icon>
          </v-btn>
        </template>
        {{ isWatched(item.unit) ? $t('market.removeFromWatchlist') : $t('market.addToWatchlist') }}
      </v-tooltip>
    </template>

    <!-- Swap column -->
    <template v-slot:[`item.swap`]="{ item }">
      <v-tooltip bottom :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <v-btn icon x-small v-bind="attrs" v-on="on" @click.stop="$emit('swap-token', item)">
            <v-icon small>mdi-swap-horizontal</v-icon>
          </v-btn>
        </template>
        {{ $t('market.swapToken') }}
      </v-tooltip>
    </template>

    <!-- Custom header tooltips -->
    <template v-slot:[`header.volume24h`]="{ header }">
      <v-tooltip top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on">{{ header.text }}</span>
        </template>
        {{ $t('market.volumeTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.mcap`]="{ header }">
      <v-tooltip top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on">{{ header.text }}</span>
        </template>
        {{ $t('market.mcapTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.change1h`]="{ header }">
      <v-tooltip top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on">{{ header.text }}</span>
        </template>
        {{ $t('market.change1hTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.change24h`]="{ header }">
      <v-tooltip top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on">{{ header.text }}</span>
        </template>
        {{ $t('market.change24hTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.change7d`]="{ header }">
      <v-tooltip top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on">{{ header.text }}</span>
        </template>
        {{ $t('market.change7dTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.avgCostBasis`]="{ header }">
      <v-tooltip top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on">{{ header.text }}</span>
        </template>
        {{ $t('market.avgCostTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.totalPnl`]="{ header }">
      <v-tooltip top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on">{{ header.text }}</span>
        </template>
        {{ $t('market.totalPnlTooltip') }}
      </v-tooltip>
    </template>
  </v-data-table>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import assets from '@/utils/assets';
import { useWatchlist } from '@/modules/market/composables/useWatchlist';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { MarketToken } from '@/modules/market/composables/useMarketData';

const props = withDefaults(defineProps<{
  tokens: MarketToken[];
  showHoldingsColumns?: boolean;
  loading?: boolean;
}>(), {
  showHoldingsColumns: false,
  loading: false,
});

const emit = defineEmits<{
  (e: 'token-click', token: MarketToken): void;
  (e: 'swap-token', token: MarketToken): void;
}>();

const { t } = useTranslation();
const { isWatched, toggleWatchlist } = useWatchlist();

const sortBy = ref('mcap');
const sortDesc = ref(true);
const currentPage = ref(1);
const itemsPerPage = 25;

const baseHeaders = computed(() => {
  const headers: any[] = [
    { text: t('market.rank'), value: 'rank', sortable: false, width: '40px' },
    { text: t('market.token'), value: 'name', sortable: true },
    { text: t('market.price'), value: 'price', sortable: true, width: '100px' },
    { text: t('market.change1h'), value: 'change1h', sortable: true, width: '70px', class: 'hidden-md-and-down' },
    { text: t('market.change24h'), value: 'change24h', sortable: true, width: '70px' },
    { text: t('market.change7d'), value: 'change7d', sortable: true, width: '70px', class: 'hidden-md-and-down' },
    { text: t('market.volume24h'), value: 'volume24h', sortable: true, width: '90px', class: 'hidden-sm-and-down' },
    { text: t('market.marketCap'), value: 'mcap', sortable: true, width: '90px' },
  ];

  if (props.showHoldingsColumns) {
    headers.push(
      { text: t('market.balance'), value: 'balance', sortable: true, width: '80px' },
      { text: t('market.value'), value: 'value', sortable: true, width: '80px' },
      { text: t('market.avgCost'), value: 'avgCostBasis', sortable: true, width: '80px', class: 'hidden-md-and-down' },
      { text: t('market.totalPnl'), value: 'totalPnl', sortable: true, width: '90px' },
    );
  }

  headers.push(
    { text: '', value: 'watchlist', sortable: false, width: '36px' },
    { text: '', value: 'swap', sortable: false, width: '36px' },
  );

  return headers;
});

const activeHeaders = baseHeaders;

// Reset to page 1 when token list changes (tab switch, search filter, etc.)
watch(() => props.tokens, () => {
  currentPage.value = 1;
});

const totalPages = computed(() => Math.ceil(props.tokens.length / itemsPerPage));

const paginatedTokens = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage;
  return props.tokens.slice(start, start + itemsPerPage);
});

function handleRowClick(item: MarketToken) {
  emit('token-click', item);
}

function toggleWatch(unit: string) {
  toggleWatchlist(unit);
}

function handleImgError(e: Event) {
  const target = e.target as HTMLImageElement;
  if (target) target.style.display = 'none';
}

function formatPrice(price: number): string {
  if (price >= 1) return '$' + price.toFixed(2);
  if (price >= 0.01) return '$' + price.toFixed(4);
  return '$' + price.toFixed(6);
}

function formatCompact(value: number): string {
  if (value >= 1e9) return (value / 1e9).toFixed(1) + 'B';
  if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M';
  if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return value.toFixed(value < 1 ? 4 : 0);
}

function formatChange(change: number): string {
  return Math.abs(change).toFixed(1) + '%';
}

function changeColor(change: number): string {
  if (change === 0) return '#A3A3A3';
  return change > 0 ? '#47CD89' : '#F97066';
}

function changeIcon(change: number): string {
  if (change === 0) return assets.arrowRightSvg;
  return change > 0 ? assets.trendUpSvg : assets.trendDownSvg;
}

function pnlColor(pnl: number): string {
  if (pnl === 0) return '#A3A3A3';
  return pnl > 0 ? '#47CD89' : '#F97066';
}
</script>

<style scoped>
.market-token-table >>> .v-data-table__wrapper {
  overflow-x: auto;
}

.market-token-table >>> tbody tr {
  cursor: pointer;
}

.market-token-table >>> tbody tr:hover {
  background: rgba(255, 255, 255, 0.03) !important;
}

.market-token-table >>> th {
  font-size: 11px !important;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.market-token-table >>> td {
  padding-top: 4px !important;
  padding-bottom: 4px !important;
}

/* Hide columns responsively via class */
@media (max-width: 1264px) {
  .market-token-table >>> .hidden-md-and-down {
    display: none !important;
  }
}

@media (max-width: 960px) {
  .market-token-table >>> .hidden-sm-and-down {
    display: none !important;
  }
}
</style>
