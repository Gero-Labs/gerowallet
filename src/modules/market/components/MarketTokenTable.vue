<template>
  <v-data-table
    dense
    class="transparent tokens-table market-token-table"
    :headers="activeHeaders"
    :items="paginatedTokens"
    :sort-by.sync="sortBy"
    :sort-desc.sync="sortDesc"
    :custom-sort="customSort"
    :items-per-page="-1"
    hide-default-footer
    :header-props="{ 'sort-icon': 'mdi-menu-up' }"
    :loading="loading"
    :item-class="rowClass"
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
              <img v-else-if="chainLogo" :src="chainLogo" :alt="`${item.ticker} Logo`" style="opacity: 0.5" />
              <v-icon v-else>mdi-circle-outline</v-icon>
            </v-avatar>
          </v-badge>
          <v-avatar size="28" v-else>
            <img v-if="item.img" :src="item.img" :alt="`${item.ticker} Logo`" @error="handleImgError" />
            <img v-else-if="chainLogo" :src="chainLogo" :alt="`${item.ticker} Logo`" style="opacity: 0.5" />
            <v-icon v-else>mdi-circle-outline</v-icon>
          </v-avatar>
        </v-list-item-action>
        <v-list-item-content>
          <v-list-item-title style="font-size: 13px">
            <span class="font-weight-bold">{{ item.ticker }}</span>
            <v-chip
              v-if="showOwnedBadge && ownedUnits.has(item.unit)"
              x-small label
              color="primary"
              class="ml-1"
              style="height: 16px; font-size: 9px; padding: 0 4px;"
            >
              {{ $t('market.owned') }}
            </v-chip>
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
              ${{ (item.price ?? 0).toFixed(8) }}
            </v-tooltip>
          </v-list-item-title>
          <v-list-item-subtitle v-if="!item.isNative" style="font-size: 10px; opacity: 0.5">
            {{ (item.priceAda ?? 0).toFixed((item.priceAda ?? 0) < 1 ? 4 : 2) }} {{ nativeSymbol }}
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </template>

    <!-- Change columns -->
    <template v-slot:[`item.change1h`]="{ item }">
      <span :style="{ color: changeColor(item.change1h), fontSize: '12px', whiteSpace: 'nowrap' }">
        <v-avatar tile size="10" class="mr-1">
          <v-img :src="changeIcon(item.change1h)" alt="trend" />
        </v-avatar>
        {{ formatChange(item.change1h) }}
      </span>
    </template>

    <template v-slot:[`item.change24h`]="{ item }">
      <span :style="{ color: changeColor(item.change24h), fontSize: '12px', whiteSpace: 'nowrap' }">
        <v-avatar tile size="10" class="mr-1">
          <v-img :src="changeIcon(item.change24h)" alt="trend" />
        </v-avatar>
        {{ formatChange(item.change24h) }}
      </span>
    </template>

    <template v-slot:[`item.change7d`]="{ item }">
      <span :style="{ color: changeColor(item.change7d), fontSize: '12px', whiteSpace: 'nowrap' }">
        <v-avatar tile size="10" class="mr-1">
          <v-img :src="changeIcon(item.change7d)" alt="trend" />
        </v-avatar>
        {{ formatChange(item.change7d) }}
      </span>
    </template>

    <template v-slot:[`item.change30d`]="{ item }">
      <span :style="{ color: changeColor(item.change30d ?? 0), fontSize: '12px', whiteSpace: 'nowrap' }">
        <v-avatar tile size="10" class="mr-1">
          <v-img :src="changeIcon(item.change30d ?? 0)" alt="trend" />
        </v-avatar>
        {{ formatChange(item.change30d ?? 0) }}
      </span>
    </template>

    <!-- Sparkline column (7D) -->
    <template v-slot:[`item.sparkline`]="{ item }">
      <svg v-if="item.sparkline && item.sparkline.length > 1" width="72" height="22" viewBox="0 0 72 22" preserveAspectRatio="none" style="display: block">
        <polyline
          :points="sparklinePoints(item.sparkline)"
          fill="none"
          :stroke="sparklineColor(item.sparkline)"
          stroke-width="1.5"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      </svg>
      <span v-else style="font-size: 12px; opacity: 0.4">—</span>
    </template>

    <!-- Volume column -->
    <template v-slot:[`item.volume24h`]="{ item }">
      <v-tooltip top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on" style="font-size: 12px">${{ formatCompact(item.volume24h) }}</span>
        </template>
        ${{ (item.volume24h ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) }}
      </v-tooltip>
    </template>

    <!-- Volume 7D column -->
    <template v-slot:[`item.volume7d`]="{ item }">
      <v-tooltip v-if="item.volume7d" top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on" style="font-size: 12px">${{ formatCompact(item.volume7d) }}</span>
        </template>
        ${{ (item.volume7d ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) }}
      </v-tooltip>
      <span v-else style="font-size: 12px; opacity: 0.4">—</span>
    </template>

    <!-- TXN count (24h) column -->
    <template v-slot:[`item.txnCount24h`]="{ item }">
      <span style="font-size: 12px">{{ formatInt(item.txnCount24h) }}</span>
    </template>

    <!-- Maker count (24h) column -->
    <template v-slot:[`item.makerCount24h`]="{ item }">
      <span style="font-size: 12px">{{ formatInt(item.makerCount24h) }}</span>
    </template>

    <!-- Total Supply column -->
    <template v-slot:[`item.totalSupply`]="{ item }">
      <v-tooltip v-if="item.totalSupply != null" top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on" style="font-size: 12px">{{ formatCompact(item.totalSupply) }}</span>
        </template>
        {{ (item.totalSupply ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) }}
      </v-tooltip>
      <span v-else style="font-size: 12px; opacity: 0.4">—</span>
    </template>

    <!-- Market Cap column -->
    <template v-slot:[`item.mcap`]="{ item }">
      <v-tooltip v-if="item.mcap != null" top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on" style="font-size: 12px">${{ formatCompact(item.mcap) }}</span>
        </template>
        ${{ (item.mcap ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) }}
      </v-tooltip>
      <span v-else style="font-size: 12px; opacity: 0.4">—</span>
    </template>

    <!-- TVL column -->
    <template v-slot:[`item.tvl`]="{ item }">
      <v-tooltip v-if="item.tvl != null" top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on" style="font-size: 12px">{{ getCurrencySymbol() }}{{ formatCompact(convertFiat(item.tvl)) }}</span>
        </template>
        {{ getCurrencySymbol() }}{{ convertFiat(item.tvl).toLocaleString('en-US', { maximumFractionDigits: 0 }) }}
      </v-tooltip>
      <span v-else style="font-size: 12px; opacity: 0.4">—</span>
    </template>

    <!-- Holders column -->
    <template v-slot:[`item.holders`]="{ item }">
      <span v-if="item.holders != null" style="font-size: 12px">{{ formatCompact(item.holders) }}</span>
      <span v-else style="font-size: 12px; opacity: 0.4">—</span>
    </template>

    <!-- Risk Rating column -->
    <template v-slot:[`item.risk`]="{ item }">
      <v-avatar size="24" v-if="item.riskRating">
        <v-img
          :src="assets.resolveRisk(item.riskRating)"
          :alt="item.riskRating"
        />
      </v-avatar>
      <span v-else style="font-size: 12px; opacity: 0.4">—</span>
    </template>

    <!-- Holdings columns (when showHoldingsColumns) -->
    <template v-slot:[`item.balance`]="{ item }">
      <v-tooltip v-if="item.balance" top content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on" style="font-size: 12px">{{ hideBalances ? '••••••' : formatBalance(item.balance) }}</span>
        </template>
        {{ hideBalances ? '••••••' : item.balance.toLocaleString('en-US', { maximumFractionDigits: 20 }) }}
      </v-tooltip>
      <span v-else style="font-size: 12px">—</span>
    </template>

    <template v-slot:[`item.value`]="{ item }">
      <v-tooltip v-if="item.value" top content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on" style="font-size: 12px">{{ hideBalances ? '$•••' : '$' + formatBalance(item.value) }}</span>
        </template>
        {{ hideBalances ? '••••••' : '$' + item.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }) }}
      </v-tooltip>
      <span v-else style="font-size: 12px">—</span>
    </template>

    <!-- Allocation column (progress bar) -->
    <template v-slot:[`item.allocation`]="{ item }">
      <v-progress-linear
        v-if="item.allocation"
        class="allocation-bar"
        height="14"
        :value="totalAllocation > 0 ? (item.allocation / totalAllocation) * 100 : 0"
        color="primary"
        background-color="rgba(255,255,255,0.06)"
        rounded
      >
        <template v-slot:default="{ value }">
          <strong class="allocation-label">{{ value.toFixed(1) }}%</strong>
        </template>
      </v-progress-linear>
      <span v-else style="font-size: 12px">—</span>
    </template>

    <!-- Avg Cost column -->
    <template v-slot:[`item.avgCostBasis`]="{ item }">
      <span v-if="item.isNative" style="font-size: 12px">—</span>
      <span v-else-if="pnlLoading && item.avgCostBasis == null" class="pnl-skeleton"></span>
      <span v-else style="font-size: 12px">
        {{ item.avgCostBasis != null ? (hideBalances ? '••••••' : item.avgCostBasis.toFixed(item.avgCostBasis < 1 ? 4 : 2) + ' ' + nativeSymbol) : '—' }}
      </span>
    </template>

    <!-- Total P&L column -->
    <template v-slot:[`item.totalPnl`]="{ item }">
      <span v-if="item.isNative" style="font-size: 12px">—</span>
      <span v-else-if="pnlLoading && item.totalPnl == null" class="pnl-skeleton"></span>
      <v-tooltip v-else-if="item.totalPnl != null" top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span
            v-bind="attrs"
            v-on="on"
            :style="{ color: hideBalances ? undefined : pnlColor(item.totalPnl), fontSize: '12px', fontWeight: '500', whiteSpace: 'nowrap' }"
          >
            <v-avatar v-if="!hideBalances" tile size="10" class="mr-1">
              <v-img :src="changeIcon(item.totalPnl)" alt="pnl" />
            </v-avatar>
            {{ hideBalances ? '••••••' : (item.totalPnl >= 0 ? '+' : '') + item.totalPnl.toFixed(2) + ' ' + nativeSymbol }}
          </span>
        </template>
        <div v-if="!hideBalances">
          <div>{{ $t('market.totalPnl') }}: {{ item.totalPnl >= 0 ? '+' : '' }}{{ item.totalPnl.toFixed(4) }} {{ nativeSymbol }}</div>
          <div>{{ $t('market.unrealizedPnl') }}: {{ item.unrealizedPnl != null ? (item.unrealizedPnl >= 0 ? '+' : '') + item.unrealizedPnl.toFixed(4) + ' ' + nativeSymbol : '—' }}</div>
          <div>{{ $t('market.realizedPnl') }}: {{ item.realizedPnl != null ? (item.realizedPnl >= 0 ? '+' : '') + item.realizedPnl.toFixed(4) + ' ' + nativeSymbol : '—' }}</div>
        </div>
        <div v-else>••••••</div>
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

    <template v-slot:[`header.tvl`]="{ header }">
      <v-tooltip top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on">{{ header.text }}</span>
        </template>
        {{ $t('market.tvlTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.holders`]="{ header }">
      <v-tooltip top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on">{{ header.text }}</span>
        </template>
        {{ $t('market.holdersTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.risk`]="{ header }">
      <v-tooltip top :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on">{{ header.text }}</span>
        </template>
        {{ $t('market.riskTooltip') }}
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
import { useColumnPreferences } from '@/modules/market/composables/useColumnPreferences';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { MarketToken } from '@/modules/market/composables/useMarketData';
import { walletStore } from '@/stores/walletStore';
import { useNativeCurrency } from '@/modules/market/composables/useNativeCurrency';
import { Blockchain } from '@/models/types';
import networks from '@/utils/networks';

const chainLogo = computed(() =>
  networks.resolveCurrencyImage(walletStore.loggedWallet?.chain, walletStore.loggedWallet?.network) || ''
);

const hideBalances = computed(() => walletStore.config?.hideBalances || false);

const props = withDefaults(defineProps<{
  tokens: MarketToken[];
  showHoldingsColumns?: boolean;
  showOwnedBadge?: boolean;
  loading?: boolean;
  pnlLoading?: boolean;
}>(), {
  showHoldingsColumns: false,
  showOwnedBadge: false,
  loading: false,
  pnlLoading: false,
});

const ownedUnits = computed(() => {
  if (!props.showOwnedBadge) return new Set<string>();
  const tokens = walletStore.tokens || {};
  return new Set(
    Object.keys(tokens).filter(unit => {
      const t = tokens[unit];
      return t && (t.quantity > 0 || (t.amount && BigInt(t.amount) > 0n));
    })
  );
});

const emit = defineEmits<{
  (e: 'token-click', token: MarketToken): void;
}>();

const { t } = useTranslation();
const { isWatched, toggleWatchlist } = useWatchlist();
const { isColumnVisible } = useColumnPreferences();
const { convertFiat, getCurrencySymbol } = useCurrencyConverter();
const { currencySymbol: nativeSymbol } = useNativeCurrency();

const isApex = computed(() => {
  const chain = walletStore.loggedWallet?.chain;
  return chain === Blockchain.APEX_PRIME || chain === Blockchain.APEX_VECTOR;
});

// Apex wallets: fixed columns from CoinGecko (no column picker, no per-token market API)
const APEX_ALLOWED_COLUMNS = ['rank', 'name', 'price', 'change24h', 'volume24h', 'mcap', 'balance', 'value', 'watchlist'];

const sortBy = ref(props.showHoldingsColumns ? 'allocation' : 'mcap');
const sortDesc = ref(true);
const currentPage = ref(1);
const itemsPerPage = 25;

const baseHeaders = computed(() => {
  const headers: { text: string; value: string; sortable: boolean; width?: string; class?: string; cellClass?: string }[] = [
    { text: t('market.rank'), value: 'rank', sortable: false, width: '40px' },
    { text: t('market.token'), value: 'name', sortable: true },
    { text: t('market.price'), value: 'price', sortable: true, width: '100px' },
    { text: t('market.change1h'), value: 'change1h', sortable: true, width: '70px' },
    { text: t('market.change24h'), value: 'change24h', sortable: true, width: '70px' },
    { text: t('market.change7d'), value: 'change7d', sortable: true, width: '70px' },
    { text: t('market.change30d'), value: 'change30d', sortable: true, width: '70px' },
    { text: t('market.sparkline'), value: 'sparkline', sortable: false, width: '90px' },
    { text: t('market.volume24h'), value: 'volume24h', sortable: true, width: '90px' },
    { text: t('market.volume7d'), value: 'volume7d', sortable: true, width: '90px' },
    { text: t('market.txnCount'), value: 'txnCount24h', sortable: true, width: '80px' },
    { text: t('market.makerCount'), value: 'makerCount24h', sortable: true, width: '80px' },
    { text: t('market.totalSupply'), value: 'totalSupply', sortable: true, width: '90px' },
    { text: t('market.marketCap'), value: 'mcap', sortable: true, width: '90px' },
    { text: t('market.liquidity'), value: 'tvl', sortable: true, width: '90px' },
    ...(!props.showHoldingsColumns ? [{ text: t('market.holders'), value: 'holders', sortable: true, width: '80px' }] : []),
    { text: t('market.risk'), value: 'risk', sortable: true, width: '70px' },
  ];

  // Allocation is toggleable via column preferences (works in both market and holdings views)
  headers.push(
    { text: t('common.allocation'), value: 'allocation', sortable: true, width: '110px', class: 'hidden-sm-and-down', cellClass: 'hidden-sm-and-down' },
  );

  if (props.showHoldingsColumns) {
    // Balance after name
    const nameIndex = headers.findIndex(h => h.value === 'name');
    headers.splice(nameIndex + 1, 0,
      { text: t('market.balance'), value: 'balance', sortable: true, width: '80px' },
    );
    // Value after price
    const priceIndex = headers.findIndex(h => h.value === 'price');
    headers.splice(priceIndex + 1, 0,
      { text: t('market.value'), value: 'value', sortable: true, width: '80px' },
    );
    // Avg cost and PnL at the end (before watchlist)
    headers.push(
      { text: t('market.avgCost'), value: 'avgCostBasis', sortable: true, width: '80px', class: 'hidden-md-and-down', cellClass: 'hidden-md-and-down' },
      { text: t('market.totalPnl'), value: 'totalPnl', sortable: true, width: '90px' },
    );
  }

  headers.push(
    { text: '', value: 'watchlist', sortable: false, width: '36px' },
  );

  return headers;
});

const LOCKED_COLUMNS = ['rank', 'name', 'price', 'watchlist'];
const HOLDINGS_COLUMNS = ['balance', 'value', 'avgCostBasis', 'totalPnl'];

const activeHeaders = computed(() => {
  return baseHeaders.value.filter(header => {
    // Apex wallets: fixed set of columns from CoinGecko, no column preferences
    if (isApex.value) return APEX_ALLOWED_COLUMNS.includes(header.value);
    if (LOCKED_COLUMNS.includes(header.value)) return true;
    if (props.showHoldingsColumns && HOLDINGS_COLUMNS.includes(header.value)) return true;
    return isColumnVisible(header.value);
  });
});

// Reset to page 1 when token list changes (tab switch, search filter, etc.)
watch(() => props.tokens, () => {
  currentPage.value = 1;
});

// Switch default sort when toggling between holdings and market views
watch(() => props.showHoldingsColumns, (isHoldings) => {
  sortBy.value = isHoldings ? 'allocation' : 'mcap';
  sortDesc.value = true;
});

const totalAllocation = computed(() => {
  return props.tokens.reduce((sum, t) => sum + (t.allocation || 0), 0);
});

const sortedTokens = computed(() => {
  return customSort([...props.tokens], [sortBy.value], [sortDesc.value]);
});

const totalPages = computed(() => Math.ceil(sortedTokens.value.length / itemsPerPage));

const paginatedTokens = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage;
  return sortedTokens.value.slice(start, start + itemsPerPage);
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

import { formatPrice, formatCompact, formatBalance, formatChange, changeColor, formatInt } from '@/modules/market/utils/formatters';

/** Build an SVG polyline points string scaled to a 72x22 viewbox from a price series */
function sparklinePoints(series: number[]): string {
  if (!series || series.length < 2) return '';
  const w = 72;
  const h = 22;
  const pad = 2;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (series.length - 1);
  return series
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** Green if the series ends up vs starts, red if down */
function sparklineColor(series: number[]): string {
  if (!series || series.length < 2) return '#A3A3A3';
  return series[series.length - 1] >= series[0] ? '#47CD89' : '#F97066';
}

function changeIcon(change: number): string {
  if (change === 0) return assets.arrowRightSvg;
  return change > 0 ? assets.trendUpSvg : assets.trendDownSvg;
}

function pnlColor(pnl: number): string {
  if (pnl === 0) return '#A3A3A3';
  return pnl > 0 ? '#47CD89' : '#F97066';
}

function rowClass(item: MarketToken): string {
  return item.isNative ? 'native-token-row' : '';
}

// Risk rating sort weight: AAA (highest/safest) → D (lowest/riskiest)
const RISK_WEIGHT: Record<string, number> = {
  'AAA': 10, 'AA': 9, 'A': 8,
  'BBB': 7, 'BB': 6, 'B': 5,
  'CCC': 4, 'CC': 3, 'C': 2, 'D': 1,
};

// Pin native token (ADA) to the top regardless of sort column
function customSort(items: MarketToken[], sortByArr: string[], sortDescArr: boolean[]): MarketToken[] {
  const sortKey = sortByArr[0];
  const desc = sortDescArr[0];

  const native = items.filter(i => i.isNative);
  const rest = [...items.filter(i => !i.isNative)];

  if (sortKey) {
    // Remap header value to data field name where they differ
    const effectiveSortKey = sortKey === 'risk' ? 'riskRating' : sortKey;

    const key = effectiveSortKey as keyof MarketToken;
    rest.sort((a: MarketToken, b: MarketToken) => {
      const va = a[key];
      const vb = b[key];
      // Null/undefined always sort last regardless of direction
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      // Risk rating: use weight map for correct ordering (AAA > AA > A > BBB > ...)
      if (key === 'riskRating') {
        const wa = RISK_WEIGHT[va as string] ?? 0;
        const wb = RISK_WEIGHT[vb as string] ?? 0;
        return desc ? wb - wa : wa - wb;
      }
      if (typeof va === 'string' && typeof vb === 'string') {
        return desc ? vb.localeCompare(va) : va.localeCompare(vb);
      }
      return desc ? Number(vb) - Number(va) : Number(va) - Number(vb);
    });
  }

  return [...native, ...rest];
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

/* Allocation progress bar */
.allocation-bar {
  border-radius: 10px;
  min-width: 60px;
  max-width: 100px;
}

.allocation-label {
  font-size: 8px;
  color: white;
  font-family: 'Roboto Mono', monospace;
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

/* Native token (ADA) — subtle highlight */
.market-token-table >>> .native-token-row {
  background: rgba(0, 199, 243, 0.04) !important;
  border-left: 2px solid rgba(0, 199, 243, 0.3);
}

.market-token-table >>> .native-token-row:hover {
  background: rgba(0, 199, 243, 0.07) !important;
}

/* P&L loading skeleton shimmer */
.pnl-skeleton {
  display: inline-block;
  width: 50px;
  height: 12px;
  border-radius: 3px;
  background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
  background-size: 200% 100%;
  animation: pnlShimmer 1.5s infinite;
}

@keyframes pnlShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
