<template>
  <v-data-table-server
    density="compact"
    class="transparent tokens-table market-token-table"
    :headers="activeHeaders"
    :items="paginatedTokens"
    :item-value="(item) => item.rowKey || item.unit"
    v-model:sort-by="tableSort"
    :items-length="tokens.length"
    :items-per-page="-1"
    hide-default-footer
    :header-props="{ 'sort-icon': 'mdi-menu-up' }"
    :loading="loading"
    :row-props="({ item }) => ({ class: rowClass(item) })"
    :expanded="dustExpanded"
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

    <!-- DUST generation strip: rendered directly beneath the NIGHT (cNIGHT)
         holdings row. Half-height, distinct gold band with the dust-battery
         particle animation; X dismisses it (persisted). -->
    <template v-slot:expanded-row>
      <tr class="night-dust-row">
        <td :colspan="activeHeaders.length" class="dust-line-cell">
          <DustGenerationLine variant="row" @setup="$emit('dust-setup')" @dismiss="dismissDustLine" />
        </td>
      </tr>
    </template>

    <!-- No data -->
    <template v-slot:no-data>
      <div class="text-center py-6" style="opacity: 0.5">
        <v-icon size="large" class="mb-2">mdi-magnify</v-icon>
        <div>{{ $t('market.noTokens') }}</div>
      </div>
    </template>

    <!-- Rank column -->
    <template v-slot:[`item.rank`]="{ index }">
      <span class="text--secondary" style="font-size: 12px">{{ (currentPage - 1) * itemsPerPage + index + 1 }}</span>
    </template>

    <!-- Token name column -->
    <template v-slot:[`item.name`]="{ item }">
      <div class="name-cell d-flex align-center">
        <div class="token-avatar mr-2" style="position: relative; width: 26px; height: 26px; flex-shrink: 0;">
          <v-avatar size="26">
            <img v-if="item.img" :src="item.img" :alt="`${item.ticker} Logo`" @error="handleImgError" />
            <img v-else-if="chainLogo" :src="chainLogo" :alt="`${item.ticker} Logo`" style="opacity: 0.5" />
            <v-icon v-else>mdi-circle-outline</v-icon>
          </v-avatar>
          <v-tooltip location="top" v-if="isProgrammableRow(item)"  :open-delay="300" content-class="custom-tooltip">
            <template v-slot:activator="{ props: activatorProps }">
              <v-icon
                color="var(--g-warning)"
                class="programmable-badge"
                style="position: absolute; right: -3px; bottom: -3px; font-size: 13px; background: var(--g-surface); border-radius: 50%;"
                v-bind="activatorProps"

              >mdi-lock-outline</v-icon>
            </template>
            {{ $t(programmableTooltipKey(item.unit)) }}
          </v-tooltip>
          <v-icon
            v-else-if="item.isSnekFun"
            class="snek-badge"
            style="position: absolute; right: -4px; bottom: -4px; font-size: 14px; color: #A3E635; background: var(--g-surface); border-radius: 50%;"
            title="snek.fun"
          >mdi-snake</v-icon>
          <v-icon
            v-else-if="item.verified"
            color="var(--g-accent)"
            class="verified-check"
            style="position: absolute; right: -3px; bottom: -3px; font-size: 13px; background: var(--g-surface); border-radius: 50%;"
          >mdi-check-decagram</v-icon>
        </div>
        <v-tooltip location="top"  :open-delay="300" content-class="custom-tooltip">
          <template v-slot:activator="{ props: activatorProps }">
            <span class="font-weight-bold token-ticker" style="font-size: 13px" v-bind="activatorProps" >{{ item.ticker }}</span>
          </template>
          {{ item.name }}
        </v-tooltip>
        <v-chip
          v-if="isProgrammableRow(item)"
          size="x-small" label
          class="ml-1 flex-shrink-0"
          style="height: 16px; font-size: 10px; padding: 0 5px; color: var(--g-warning); background: var(--g-warning-fill); border: 1px solid var(--g-warning-line);"
        >
          {{ $t('programmableTokens.badge') }}
        </v-chip>
        <v-chip
          v-if="showOwnedBadge && ownedUnits.has(item.unit)"
          size="x-small" label
          color="primary"
          class="ml-1 flex-shrink-0"
          style="height: 16px; font-size: 11px; padding: 0 4px;"
        >
          {{ $t('market.owned') }}
        </v-chip>
      </div>
    </template>

    <!-- Price column (with live green/red flash on price change) -->
    <template v-slot:[`item.price`]="{ item }">
      <div class="price-flash-wrap">
        <span
          v-if="priceFlash[item.unit]"
          :key="priceFlash[item.unit].seq"
          aria-hidden="true"
          class="price-flash-overlay"
          :class="priceFlash[item.unit].dir === 'up' ? 'market-flash-up' : 'market-flash-down'"
        ></span>
        <v-tooltip location="top"  :open-delay="300" content-class="custom-tooltip">
          <template v-slot:activator="{ props: activatorProps }">
            <span v-bind="activatorProps"  style="font-size: 13px; white-space: nowrap; position: relative;">{{ formatPrice(item.price) }}</span>
          </template>
          <div>${{ (item.price ?? 0).toFixed(8) }}</div>
          <div v-if="!item.isNative" style="opacity: 0.7">
            {{ (item.priceAda ?? 0).toFixed((item.priceAda ?? 0) < 1 ? 4 : 2) }} {{ nativeSymbol }}
          </div>
        </v-tooltip>
      </div>
    </template>

    <!-- Change columns -->
    <template v-slot:[`item.change1h`]="{ item }">
      <span :style="{ color: changeColor(item.change1h), fontSize: '12px', whiteSpace: 'nowrap' }">
        <v-avatar rounded="0" size="10" class="mr-1">
          <v-img :src="changeIcon(item.change1h)" alt="trend" />
        </v-avatar>
        {{ formatChange(item.change1h) }}
      </span>
    </template>

    <template v-slot:[`item.change24h`]="{ item }">
      <span :style="{ color: changeColor(item.change24h), fontSize: '12px', whiteSpace: 'nowrap' }">
        <v-avatar rounded="0" size="10" class="mr-1">
          <v-img :src="changeIcon(item.change24h)" alt="trend" />
        </v-avatar>
        {{ formatChange(item.change24h) }}
      </span>
    </template>

    <template v-slot:[`item.change7d`]="{ item }">
      <span :style="{ color: changeColor(item.change7d), fontSize: '12px', whiteSpace: 'nowrap' }">
        <v-avatar rounded="0" size="10" class="mr-1">
          <v-img :src="changeIcon(item.change7d)" alt="trend" />
        </v-avatar>
        {{ formatChange(item.change7d) }}
      </span>
    </template>

    <template v-slot:[`item.change30d`]="{ item }">
      <span :style="{ color: changeColor(item.change30d ?? 0), fontSize: '12px', whiteSpace: 'nowrap' }">
        <v-avatar rounded="0" size="10" class="mr-1">
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
          :stroke="sparklineColor(item.sparkline, item.change7d)"
          stroke-width="1.5"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      </svg>
      <span v-else style="font-size: 12px; opacity: 0.4">—</span>
    </template>

    <!-- Volume column -->
    <template v-slot:[`item.volume24h`]="{ item }">
      <v-tooltip location="top"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span v-bind="activatorProps"  style="font-size: 12px">${{ formatCompact(item.volume24h) }}</span>
        </template>
        ${{ (item.volume24h ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) }}
      </v-tooltip>
    </template>

    <!-- Volume 7D column -->
    <template v-slot:[`item.volume7d`]="{ item }">
      <v-tooltip location="top" v-if="item.volume7d"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span v-bind="activatorProps"  style="font-size: 12px">${{ formatCompact(item.volume7d) }}</span>
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
      <v-tooltip location="top" v-if="item.totalSupply != null"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span v-bind="activatorProps"  style="font-size: 12px">{{ formatCompact(item.totalSupply) }}</span>
        </template>
        {{ (item.totalSupply ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) }}
      </v-tooltip>
      <span v-else style="font-size: 12px; opacity: 0.4">—</span>
    </template>

    <!-- Market Cap column -->
    <template v-slot:[`item.mcap`]="{ item }">
      <v-tooltip location="top" v-if="item.mcap != null"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span v-bind="activatorProps"  style="font-size: 12px">${{ formatCompact(item.mcap) }}</span>
        </template>
        ${{ (item.mcap ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) }}
      </v-tooltip>
      <span v-else style="font-size: 12px; opacity: 0.4">—</span>
    </template>

    <!-- TVL column -->
    <template v-slot:[`item.tvl`]="{ item }">
      <v-tooltip location="top" v-if="item.tvl != null"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span v-bind="activatorProps"  style="font-size: 12px">{{ getCurrencySymbol() }}{{ formatCompact(convertFiat(item.tvl)) }}</span>
        </template>
        {{ getCurrencySymbol() }}{{ convertFiat(item.tvl).toLocaleString('en-US', { maximumFractionDigits: 0 }) }}
      </v-tooltip>
      <span v-else style="font-size: 12px; opacity: 0.4">—</span>
    </template>

    <!-- Holdings columns (when showHoldingsColumns) -->
    <template v-slot:[`item.balance`]="{ item }">
      <div class="d-flex align-center" style="gap: 4px;">
        <v-tooltip location="top" v-if="item.balance"  content-class="custom-tooltip">
          <template v-slot:activator="{ props: activatorProps }">
            <span v-bind="activatorProps"  style="font-size: 12px">{{ hideBalances ? '••••••' : formatBalance(item.balance) }}</span>
          </template>
          {{ hideBalances ? '••••••' : item.balance.toLocaleString('en-US', { maximumFractionDigits: 20 }) }}
        </v-tooltip>
        <span v-else style="font-size: 12px">—</span>
        <!-- Decimals couldn't be resolved from any source — the balance above is
             raw units, not divided by decimals (issue 1003). -->
        <v-tooltip location="top" v-if="item.decimalsUnknown"  content-class="custom-tooltip">
          <template v-slot:activator="{ props: activatorProps }">
            <v-icon size="x-small" color="warning" v-bind="activatorProps" >mdi-help-circle-outline</v-icon>
          </template>
          {{ $t('market.decimalsUnknown') }}
        </v-tooltip>
      </div>
    </template>

    <template v-slot:[`item.value`]="{ item }">
      <v-tooltip location="top" v-if="item.value"  content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span v-bind="activatorProps"  style="font-size: 12px">{{ hideBalances ? '$•••' : '$' + formatBalance(item.value) }}</span>
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
        :model-value="totalAllocation > 0 ? (item.allocation / totalAllocation) * 100 : 0"
        color="var(--g-accent)"
        bg-color="var(--g-hairline-1)"
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
      <v-tooltip location="top" v-else-if="item.totalPnl != null"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span
            v-bind="activatorProps"

            :style="{ color: hideBalances ? undefined : pnlColor(item.totalPnl), fontSize: '12px', fontWeight: '500', whiteSpace: 'nowrap' }"
          >
            <v-avatar v-if="!hideBalances" rounded="0" size="10" class="mr-1">
              <v-img :src="changeIcon(item.totalPnl)" alt="pnl" />
            </v-avatar>
            {{ hideBalances ? '••••••' : formatPnl(item.totalPnl) + ' ' + nativeSymbol }}
          </span>
        </template>
        <div v-if="!hideBalances">
          <div>{{ $t('market.totalPnl') }}: {{ formatPnl(item.totalPnl, 4) }} {{ nativeSymbol }}</div>
          <div>{{ $t('market.unrealizedPnl') }}: {{ item.unrealizedPnl != null ? formatPnl(item.unrealizedPnl, 4) + ' ' + nativeSymbol : '—' }}</div>
          <div>{{ $t('market.realizedPnl') }}: {{ item.realizedPnl != null ? formatPnl(item.realizedPnl, 4) + ' ' + nativeSymbol : '—' }}</div>
        </div>
        <div v-else>••••••</div>
      </v-tooltip>
      <span v-else style="font-size: 12px">—</span>
    </template>

    <!-- Watchlist column -->
    <template v-slot:[`item.watchlist`]="{ item }">
      <v-tooltip location="bottom"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <v-btn icon variant="text" size="x-small" v-bind="activatorProps"  @click.stop="toggleWatch(item.unit)">
            <v-icon size="small" :color="isWatched(item.unit) ? 'amber' : ''">
              {{ isWatched(item.unit) ? 'mdi-star' : 'mdi-star-outline' }}
            </v-icon>
          </v-btn>
        </template>
        {{ isWatched(item.unit) ? $t('market.removeFromWatchlist') : $t('market.addToWatchlist') }}
      </v-tooltip>
    </template>

    <!-- Custom header tooltips -->
    <template v-slot:[`header.volume24h`]="{ column }">
      <v-tooltip location="top"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span v-bind="activatorProps" >{{ column.title }}</span>
        </template>
        {{ $t('market.volumeTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.mcap`]="{ column }">
      <v-tooltip location="top"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span v-bind="activatorProps" >{{ column.title }}</span>
        </template>
        {{ $t('market.mcapTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.change1h`]="{ column }">
      <v-tooltip location="top"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span v-bind="activatorProps" >{{ column.title }}</span>
        </template>
        {{ $t('market.change1hTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.change24h`]="{ column }">
      <v-tooltip location="top"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span v-bind="activatorProps" >{{ column.title }}</span>
        </template>
        {{ $t('market.change24hTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.change7d`]="{ column }">
      <v-tooltip location="top"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span v-bind="activatorProps" >{{ column.title }}</span>
        </template>
        {{ $t('market.change7dTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.tvl`]="{ column }">
      <v-tooltip location="top"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span v-bind="activatorProps" >{{ column.title }}</span>
        </template>
        {{ $t('market.tvlTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.avgCostBasis`]="{ column }">
      <v-tooltip location="top"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span v-bind="activatorProps" >{{ column.title }}</span>
        </template>
        {{ $t('market.avgCostTooltip') }}
      </v-tooltip>
    </template>

    <template v-slot:[`header.totalPnl`]="{ column }">
      <v-tooltip location="top"  :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ props: activatorProps }">
          <span v-bind="activatorProps" >{{ column.title }}</span>
        </template>
        {{ $t('market.totalPnlTooltip') }}
      </v-tooltip>
    </template>
  </v-data-table-server>
</template>

<script setup lang="ts">
import '@/shared/styles/compact-pagination.css';
import { ref, computed, watch, onMounted } from 'vue';
import type { DataTableHeader, DataTableSortItem } from 'vuetify';
import { programmableTooltipKey, isProgrammableRow } from '@/shared/utils/programmableTokenDisplay';
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
import DustGenerationLine from '@/modules/dashboard/components/DustGenerationLine.vue';
import { CNIGHT_ASSETS, isDustLineDismissed, dismissDustLineFor } from '@/shared/composables/useCnightDustRegistration';

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
  (e: 'dust-setup'): void;
}>();

// ── DUST generation line under the NIGHT (cNIGHT) holdings row ──────────────
// Only in the holdings view on a Cardano wallet, only for the NIGHT token, and
// only until the user dismisses it — dismissal is PER WALLET (stake address), so
// hiding it on one wallet doesn't suppress it on another that also holds NIGHT.
// localStorage isn't reactive, so re-read on mount and whenever the wallet changes.
const dustLineDismissed = ref(false);
function refreshDustDismissed() {
  dustLineDismissed.value = isDustLineDismissed(walletStore.loggedWallet?.stakeAddress);
}
onMounted(refreshDustDismissed);
watch(() => walletStore.loggedWallet?.stakeAddress, refreshDustDismissed);

const cnightUnit = computed(() => {
  const asset = CNIGHT_ASSETS[walletStore.loggedWallet?.network ?? ''];
  return asset ? asset.policyId + asset.assetNameHex : '';
});

/** The NIGHT row currently in the table (holdings + Cardano only). Dismissal
 *  hides the strip entirely; the registration status still surfaces in the
 *  token drawer + DUST battery widgets, which aren't dismissable. */
const dustExpanded = computed<string[]>(() => {
  if (!props.showHoldingsColumns || dustLineDismissed.value) return [];
  if (walletStore.loggedWallet?.chain !== Blockchain.CARDANO) return [];
  if (!cnightUnit.value) return [];
  const night = paginatedTokens.value.find((tk) => tk.unit === cnightUnit.value);
  return night ? [night.rowKey || night.unit] : [];
});

function dismissDustLine() {
  dustLineDismissed.value = true;
  dismissDustLineFor(walletStore.loggedWallet?.stakeAddress);
}

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
const tableSort = computed<DataTableSortItem[]>({
  get: (): DataTableSortItem[] => sortBy.value ? [{ key: sortBy.value, order: sortDesc.value ? 'desc' : 'asc' }] : [],
  set: value => { sortBy.value = value[0]?.key || ''; sortDesc.value = value[0]?.order === 'desc'; currentPage.value = 1; },
});
const currentPage = ref(1);
const itemsPerPage = 25;

const baseHeaders = computed(() => {
  const headers: DataTableHeader[] = [
    { title: t('market.rank'), key: 'rank', sortable: false, width: '40px' },
    { title: t('market.token'), key: 'name', sortable: true },
    { title: t('market.price'), key: 'price', sortable: true, width: '100px' },
    { title: t('market.change1h'), key: 'change1h', sortable: true, width: '70px' },
    { title: t('market.change24h'), key: 'change24h', sortable: true, width: '70px' },
    { title: t('market.change7d'), key: 'change7d', sortable: true, width: '70px' },
    { title: t('market.change30d'), key: 'change30d', sortable: true, width: '70px' },
    { title: t('market.sparkline'), key: 'sparkline', sortable: false, width: '90px' },
    { title: t('market.volume24h'), key: 'volume24h', sortable: true, width: '90px' },
    { title: t('market.volume7d'), key: 'volume7d', sortable: true, width: '90px' },
    { title: t('market.txnCount'), key: 'txnCount24h', sortable: true, width: '80px' },
    { title: t('market.makerCount'), key: 'makerCount24h', sortable: true, width: '80px' },
    { title: t('market.totalSupply'), key: 'totalSupply', sortable: true, width: '90px' },
    { title: t('market.marketCap'), key: 'mcap', sortable: true, width: '90px' },
    { title: t('market.liquidity'), key: 'tvl', sortable: true, width: '90px' },
  ];

  // Allocation is toggleable via column preferences (works in both market and holdings views)
  headers.push(
    { title: t('common.allocation'), key: 'allocation', sortable: true, width: '110px', headerProps: { class: 'hidden-sm-and-down' }, cellProps: { class: 'hidden-sm-and-down' } },
  );

  if (props.showHoldingsColumns) {
    // Balance after name
    const nameIndex = headers.findIndex(h => h.key === 'name');
    headers.splice(nameIndex + 1, 0,
      { title: t('market.balance'), key: 'balance', sortable: true, width: '80px' },
    );
    // Value after price
    const priceIndex = headers.findIndex(h => h.key === 'price');
    headers.splice(priceIndex + 1, 0,
      { title: t('market.value'), key: 'value', sortable: true, width: '80px' },
    );
    // Avg cost and PnL at the end (before watchlist)
    headers.push(
      { title: t('market.avgCost'), key: 'avgCostBasis', sortable: true, width: '80px', headerProps: { class: 'hidden-md-and-down' }, cellProps: { class: 'hidden-md-and-down' } },
      { title: t('market.totalPnl'), key: 'totalPnl', sortable: true, width: '90px' },
    );
  }

  headers.push(
    { title: '', key: 'watchlist', sortable: false, width: '36px' },
  );

  return headers;
});

const LOCKED_COLUMNS = ['rank', 'name', 'price', 'watchlist'];
// balance + value are core to the holdings view (always shown); avgCostBasis &
// totalPnl are now user-configurable via column preferences.
const HOLDINGS_COLUMNS = ['balance', 'value'];

const activeHeaders = computed(() => {
  return baseHeaders.value.filter(header => {
    // Apex wallets: fixed set of columns from CoinGecko, no column preferences
    if (isApex.value) return APEX_ALLOWED_COLUMNS.includes(header.key);
    if (LOCKED_COLUMNS.includes(header.key)) return true;
    if (props.showHoldingsColumns && HOLDINGS_COLUMNS.includes(header.key)) return true;
    return isColumnVisible(header.key);
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

// --- Live price-cell flash (green up / red down) — mirrors the market-data
// website's method. Each 15s price poll replaces props.tokens; any token whose
// price actually moved gets a one-shot background flash, and a monotonically
// rising seq re-keys the overlay so the CSS animation replays on every change.
// New/unseen tokens seed silently (no first-render flash), and a currency-display
// toggle never flashes because `price` is always the USD base value. ---
const priceFlash = ref<Record<string, { dir: 'up' | 'down'; seq: number }>>({});
const prevPrices: Record<string, number> = {};
let flashSeq = 0;

watch(
  () => props.tokens,
  (tokens) => {
    let changed = false;
    const next = { ...priceFlash.value };
    for (const tk of tokens) {
      const price = tk.price;
      if (typeof price !== 'number' || !Number.isFinite(price)) continue;
      const prev = prevPrices[tk.unit];
      if (prev !== undefined && price !== prev) {
        flashSeq += 1;
        next[tk.unit] = { dir: price > prev ? 'up' : 'down', seq: flashSeq };
        changed = true;
      }
      prevPrices[tk.unit] = price;
    }
    if (changed) priceFlash.value = next;
  },
);

function handleRowClick(_event: Event, { item }: { item: MarketToken }) {
  emit('token-click', item);
}

function toggleWatch(unit: string) {
  toggleWatchlist(unit);
}

function handleImgError(e: Event) {
  const target = e.target as HTMLImageElement;
  if (!target) return;
  // Fall back to the chain logo rather than hiding, which left an empty avatar in the row.
  // Clear the handler first so a chain logo that itself fails can't loop.
  target.onerror = null;
  if (chainLogo.value) target.src = chainLogo.value;
  else target.style.display = 'none';
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

/**
 * Colour follows the 7D change column when it is known, so the line and the number beside it
 * can never disagree. The backend series starts at the first hourly candle *inside* the window,
 * while the 7D % is measured from the daily close *before* it; for a sparse token the two can
 * have opposite signs (GERO: line down 0.85%, column +0.47%). Falls back to first-vs-last only
 * when the change is unknown or exactly zero.
 */
function sparklineColor(series: number[], change7d?: number | null): string {
  if (!series || series.length < 2) return '#A3A3A3';
  const hasChange = change7d != null && Number.isFinite(change7d) && change7d !== 0;
  const up = hasChange ? change7d > 0 : series[series.length - 1] >= series[0];
  return up ? '#47CD89' : '#F97066';
}

function changeIcon(change: number): string {
  if (change === 0) return assets.arrowRightSvg;
  return change > 0 ? assets.trendUpSvg : assets.trendDownSvg;
}

// Human-readable P&L: signed, with thousands separators (e.g. +13,212.45).
function formatPnl(value: number, decimals = 2): string {
  const sign = value >= 0 ? '+' : '';
  return sign + value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function pnlColor(pnl: number): string {
  if (pnl === 0) return 'var(--g-text-3)';
  return pnl > 0 ? 'var(--g-success)' : 'var(--g-error)';
}

function rowClass(item: MarketToken): string {
  const classes: string[] = [];
  if (item.isNative) classes.push('native-token-row');
  // The NIGHT row that has the DUST strip expanded beneath it drops its bottom
  // divider so the two read as one row.
  if (dustExpanded.value.includes(item.rowKey || item.unit)) classes.push('night-dust-attached');
  return classes.join(' ');
}

// Pin native token (ADA) to the top regardless of sort column
function customSort(items: MarketToken[], sortByArr: string[], sortDescArr: boolean[]): MarketToken[] {
  const sortKey = sortByArr[0];
  const desc = sortDescArr[0];

  const native = items.filter(i => i.isNative);
  const rest = [...items.filter(i => !i.isNative)];

  if (sortKey) {
    const key = sortKey as keyof MarketToken;
    rest.sort((a: MarketToken, b: MarketToken) => {
      const va = a[key];
      const vb = b[key];
      // Null/undefined always sort last regardless of direction
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
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
.market-token-table :deep(.v-table__wrapper) {
  overflow-x: auto;
}

.market-token-table :deep(tbody tr) {
  cursor: pointer;
}

.market-token-table :deep(tbody tr:hover) {
  background: var(--g-hairline-1) !important;
}

/* DUST line cell: Vuetify's dense rule pins td height to 32px, which vertically
   centers the shorter strip and leaves dark gaps above/below the gold band.
   Table cells treat `height` as a MINIMUM, so `auto` won't shrink it — pin the
   cell to the strip's exact height and zero the padding. Forced because the
   dense selector (.v-data-table--dense>...>td) is deep; specificity alone is
   fragile here. The strip then fills 100% of the cell, so the gold is flush. */
.market-token-table :deep(td.dust-line-cell) {
  padding: 0 !important;
  height: 24px !important;
  border-bottom: none !important;
}
/* Merge the NIGHT row with the DUST strip below it: drop the Vuetify row
   divider on the NIGHT row (tagged via rowClass) so the two read as one row.
   The override flag is required to beat Vuetify's tr:not(:last-child) td rule. */
.market-token-table :deep(tr.night-dust-attached > td) {
  border-bottom: none !important;
}
/* Vuetify boxes the expanded row with an inset top+bottom shadow
   (.v-data-table>.v-table__wrapper tbody tr.v-data-table__expanded__content,
   specificity 0,3,2) — that shadow is what made the DUST strip read as its own
   boxed row. Match Vuetify's depth (.v-table__wrapper tbody, 0,4,2) to
   remove it without an override flag. */
.market-token-table :deep(.v-table__wrapper tbody tr.v-data-table__expanded__content) {
  box-shadow: none;
  cursor: default;
}
.market-token-table :deep(.v-table__wrapper tbody tr.v-data-table__expanded__content:hover) {
  background: transparent;
}

.market-token-table :deep(th) {
  font-size: 11px !important;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.market-token-table :deep(td) {
  padding-top: 2px !important;
  padding-bottom: 2px !important;
  height: 40px !important;
}

.market-token-table :deep(tbody tr td) {
  border-bottom: 1px solid var(--g-hairline-1) !important;
}

/* Name cell — single-line, compact */
.name-cell {
  min-height: unset;
}

.name-cell .token-avatar {
  flex-shrink: 0;
  line-height: 0;
}

/* Live price-cell flash (green up / red down) — same effect as the market-data
   website: a 0.9s background fade behind the price on each price change. */
.price-flash-wrap {
  position: relative;
  display: inline-block;
}
.price-flash-overlay {
  position: absolute;
  top: -6px;
  bottom: -6px;
  left: -8px;
  right: -8px;
  border-radius: 4px;
  pointer-events: none;
}
@keyframes market-flash-up {
  0% { background-color: var(--g-success-fill); }
  100% { background-color: transparent; }
}
@keyframes market-flash-down {
  0% { background-color: var(--g-error-fill); }
  100% { background-color: transparent; }
}
.market-flash-up { animation: market-flash-up 0.9s ease; }
.market-flash-down { animation: market-flash-down 0.9s ease; }

.name-cell .token-ticker {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

/* Allocation progress bar */
.allocation-bar {
  border-radius: var(--g-r-control);
  min-width: 60px;
  max-width: 100px;
}

.allocation-label {
  font-size: 11px;
  color: var(--g-text-1);
  font-family: var(--g-font-mono);
}

/* Hide columns responsively via class */
@media (max-width: 1264px) {
  .market-token-table :deep(.hidden-md-and-down) {
    display: none !important;
  }
}

@media (max-width: 960px) {
  .market-token-table :deep(.hidden-sm-and-down) {
    display: none !important;
  }
}

/* Native token (ADA) — subtle highlight */
.market-token-table :deep(.native-token-row) {
  background: rgba(0, 199, 243, 0.04) !important;
  border-left: 2px solid rgba(0, 199, 243, 0.3);
}

.market-token-table :deep(.native-token-row:hover) {
  background: rgba(0, 199, 243, 0.07) !important;
}

/* P&L loading skeleton shimmer */
.pnl-skeleton {
  display: inline-block;
  width: 50px;
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
  background-size: 200% 100%;
  animation: pnlShimmer 1.5s infinite;
}

@keyframes pnlShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
