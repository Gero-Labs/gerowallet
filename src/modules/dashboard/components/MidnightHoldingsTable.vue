<template>
  <!-- Visual mirror of the Cardano `MarketTokenTable` for Midnight. Same
       column structure (TOKEN / BALANCE / PRICE / VALUE / 24H / MCAP /
       AVG COST / P&L) so the table reads identically across chains.
       Cells that don't apply to Midnight today render an em-dash, just
       like the Cardano table does for tokens missing market data. -->
  <v-data-table
    dense
    class="transparent tokens-table market-token-table"
    :headers="headers"
    :items="rows"
    :items-per-page="-1"
    hide-default-footer
    :header-props="{ 'sort-icon': 'mdi-menu-up' }"
  >
    <template v-slot:[`item.rank`]="{ index }">
      <span class="text--secondary" style="font-size: 12px">{{ index + 1 }}</span>
    </template>

    <template v-slot:[`item.name`]="{ item }">
      <v-list-item dense class="px-0">
        <v-list-item-action class="my-0" style="margin-right: 12px !important">
          <v-avatar size="28" :color="item.iconBg">
            <v-img v-if="item.image" :src="item.image" contain width="20" height="20" />
            <v-icon v-else small :color="item.iconColor">{{ item.icon }}</v-icon>
          </v-avatar>
        </v-list-item-action>
        <v-list-item-content>
          <v-list-item-title style="font-size: 13px">
            <span class="font-weight-bold">{{ item.ticker }}</span>
          </v-list-item-title>
          <v-list-item-subtitle style="font-size: 10px; opacity: 0.5">
            {{ item.name }}
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </template>

    <template v-slot:[`item.balance`]="{ item }">
      <v-skeleton-loader v-if="midnightLoading" type="text" width="110" style="margin-left: auto" />
      <span v-else style="font-family: 'Roboto Mono', monospace; font-size: 12px;">
        {{ item.balanceFormatted }}
      </span>
    </template>

    <template v-slot:[`item.price`]="{ item }">
      <span class="text--secondary" style="font-size: 12px;">{{ item.price }}</span>
    </template>

    <template v-slot:[`item.value`]="{ item }">
      <span class="text--secondary" style="font-size: 12px;">{{ item.value }}</span>
    </template>

    <template v-slot:[`item.change24h`]="{ item }">
      <span class="text--secondary" style="font-size: 12px;">{{ item.change24h }}</span>
    </template>

    <template v-slot:[`item.mcap`]="{ item }">
      <span class="text--secondary" style="font-size: 12px;">{{ item.mcap }}</span>
    </template>

    <template v-slot:[`item.avgCost`]="{ item }">
      <span class="text--secondary" style="font-size: 12px;">{{ item.avgCost }}</span>
    </template>

    <template v-slot:[`item.pnl`]="{ item }">
      <span class="text--secondary" style="font-size: 12px;">{{ item.pnl }}</span>
    </template>
  </v-data-table>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useMidnightLoading } from '@/shared/composables/useMidnightLoading';
import midnightLogo from '@/assets/svg/midnight.svg';

const { t } = useTranslation();
const midnightLoading = useMidnightLoading();

const { balances } = toRefs(midnightStore);
const { loggedWallet } = toRefs(walletStore);

const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);
const nightCurrency = computed(() => (isMainnet.value ? 'NIGHT' : 'tNIGHT'));

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);

function formatBigDecimal(value: bigint, divisor: bigint, fractionDigits: number): string {
  if (value < 0n) value = 0n;
  const whole = value / divisor;
  const remainder = value % divisor;
  if (fractionDigits === 0) return whole.toLocaleString('en-US');
  const remainderStr = remainder.toString().padStart(divisor.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, fractionDigits).padEnd(fractionDigits, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

// Column definitions match Cardano MarketTokenTable's holdings view.
// Inactive columns use an em-dash placeholder; once price feeds + indexer
// historical data are wired they'll fill in without layout changes.
const headers = computed(() => [
  { text: '#', value: 'rank', align: 'center' as const, sortable: false, width: 40 },
  { text: t('market.token'), value: 'name', align: 'start' as const, sortable: false },
  { text: 'Balance', value: 'balance', align: 'end' as const, sortable: false },
  { text: 'Price', value: 'price', align: 'end' as const, sortable: false },
  { text: 'Value', value: 'value', align: 'end' as const, sortable: false },
  { text: '24H', value: 'change24h', align: 'end' as const, sortable: false },
  { text: 'MCap', value: 'mcap', align: 'end' as const, sortable: false },
  { text: 'Avg Cost', value: 'avgCost', align: 'end' as const, sortable: false },
  { text: 'P&L', value: 'pnl', align: 'end' as const, sortable: false },
]);

interface MidnightHoldingRow {
  ticker: string;
  name: string;
  balanceFormatted: string;
  price: string;
  value: string;
  change24h: string;
  mcap: string;
  avgCost: string;
  pnl: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  /** Brand logo (takes precedence over the mdi icon when set). */
  image?: string;
}

// `nightRegistered` is a SUBSET of `nightUnshielded` (the portion registered
// for DUST generation), not a separate pile. Summing all three would
// double-count the registered amount.
const totalNight = computed<bigint>(() =>
  (balances.value.nightUnshielded ?? 0n) +
  (balances.value.nightShielded ?? 0n),
);

// tDUST is deliberately NOT a table row — the dedicated DUST battery panel
// above owns the live DUST display (it's a fee resource, not a holding).
const rows = computed<MidnightHoldingRow[]>(() => [
  {
    ticker: nightCurrency.value,
    name: 'Midnight Native Token',
    balanceFormatted: `${formatBigDecimal(totalNight.value, NIGHT_DIVISOR, 2)} ${nightCurrency.value}`,
    price: '—',
    value: '—',
    change24h: '—',
    mcap: '—',
    avgCost: '—',
    pnl: '—',
    icon: 'mdi-shield-outline',
    // Neutral near-black disc (was 'blue darken-4') so the white Midnight mark
    // reads as black-and-white, matching the chain's monochrome identity.
    iconBg: 'grey darken-4',
    iconColor: 'grey lighten-2',
    image: midnightLogo,
  },
]);
</script>

<style scoped>
.tokens-table ::v-deep .v-data-table__wrapper {
  background: transparent;
}

.tokens-table ::v-deep th {
  background: rgba(10, 14, 20, 0.8) !important;
  color: rgba(255, 255, 255, 0.5) !important;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 11px !important;
  font-weight: 600 !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
}

.tokens-table ::v-deep tbody tr {
  transition: background 0.15s ease;
}

.tokens-table ::v-deep tbody tr:hover {
  background: rgba(0, 199, 243, 0.04) !important;
}

.tokens-table ::v-deep tbody tr td {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04) !important;
  padding-top: 8px !important;
  padding-bottom: 8px !important;
}
</style>
