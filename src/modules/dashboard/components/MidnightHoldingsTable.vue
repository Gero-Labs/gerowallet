<template>
  <!-- Visual mirror of the Cardano `MarketTokenTable` for Midnight. Same
       column structure (TOKEN / BALANCE / PRICE / VALUE / 24H / MCAP /
       AVG COST / P&L) so the table reads identically across chains.
       Cells that don't apply to Midnight today render an em-dash, just
       like the Cardano table does for tokens missing market data. -->
  <div class="midnight-holdings-table-root">
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
      <div v-else style="text-align: right;">
        <div style="font-family: 'Roboto Mono', monospace; font-size: 12px;">
          {{ item.balanceFormatted }}
        </div>
        <div v-if="item.breakdownText" class="breakdown-row">
          <span class="t-caption g-num">{{ item.breakdownText }}</span>
          <v-tooltip v-if="convertEnabled" top content-class="custom-tooltip" max-width="220">
            <template v-slot:activator="{ on, attrs }">
              <button
                type="button"
                class="convert-link-btn"
                v-bind="attrs"
                v-on="on"
                @click="convertDialogOpen = true"
              >{{ t('midnight.shieldConvert.entryButton') }}</button>
            </template>
            <span>{{ t('midnight.shieldConvert.entryButtonTooltip') }}</span>
          </v-tooltip>
        </div>
      </div>
    </template>

    <template v-slot:[`item.price`]="{ item }">
      <span class="text--secondary" style="font-size: 12px;">{{ item.price }}</span>
    </template>

    <template v-slot:[`item.value`]="{ item }">
      <span class="text--secondary" style="font-size: 12px;">{{ item.value }}</span>
    </template>

    <template v-slot:[`item.change24h`]="{ item }">
      <span
        class="g-num"
        :class="item.change24hRaw === null ? 'text--secondary' : (item.change24hRaw >= 0 ? 'delta-up' : 'delta-down')"
        style="font-size: 12px;"
      >{{ item.change24h }}</span>
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

  <!-- Shield/unshield conversion entry point — reused, not a new nav
       destination (this is a transaction type, not a settings page).
       Flag-gated DARK (isMidnightConvertEnabled): the shield direction is
       protocol-blocked at ledger gen 8 (node error 138, see
       featureFlagsStore.isMidnightConvertEnabled's doc comment). Code kept
       intact for when Midnight ships a sanctioned conversion path. -->
  <ShieldConvertDialog
    v-if="convertEnabled"
    :is-open="convertDialogOpen"
    @close="convertDialogOpen = false"
  />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useMidnightLoading } from '@/shared/composables/useMidnightLoading';
import { useNightFiat } from '@/shared/composables/useNightFiat';
import { formatPrice, formatUsd, formatSignedChange } from '@/shared/utils/format';
import midnightLogo from '@/assets/svg/midnight.svg';
import ShieldConvertDialog from '@/modules/dashboard/dialogs/ShieldConvertDialog.vue';
import featureFlagsStore from '@/stores/featureFlagsStore';

const convertDialogOpen = ref(false);
const convertEnabled = computed(() => featureFlagsStore.isMidnightConvertEnabled());

const { t } = useTranslation();
const midnightLoading = useMidnightLoading();

const { balances } = toRefs(midnightStore);
const { loggedWallet } = toRefs(walletStore);

const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);
const nightCurrency = computed(() => (isMainnet.value ? 'NIGHT' : 'tNIGHT'));

// NIGHT fiat price - mainnet only (testnet tNIGHT has no market). Mirrors the
// sidepanel BalanceSection's usage of the same composable (mirror-dashboard rule).
const nightFiat = useNightFiat();
watch(isMainnet, (on) => { if (on) void nightFiat.refresh(); }, { immediate: true });

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
  /** "Public X / Private Y" caption; empty string hides the row. */
  breakdownText: string;
  price: string;
  value: string;
  change24h: string;
  /** Raw 24h change for delta-up/delta-down coloring; null when no price data. */
  change24hRaw: number | null;
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

// Public/private breakdown caption. Only shown once the wallet has a
// viewing key (shieldedSyncAvailable) or already holds shielded NIGHT -
// wallets without a viewing key would otherwise see a meaningless "Private 0".
const showBreakdown = computed(() =>
  midnightStore.shieldedSyncAvailable || (balances.value.nightShielded ?? 0n) > 0n);

const breakdownText = computed<string>(() => {
  if (!showBreakdown.value) return '';
  const pub = formatBigDecimal(balances.value.nightUnshielded ?? 0n, NIGHT_DIVISOR, 2);
  const priv = formatBigDecimal(balances.value.nightShielded ?? 0n, NIGHT_DIVISOR, 2);
  return `${t('midnight.common.public')} ${pub} / ${t('midnight.common.private')} ${priv}`;
});

// NIGHT has a market on mainnet only; testnet tNIGHT keeps the placeholders.
const hasNightPrice = computed(() => isMainnet.value && nightFiat.hasPrice.value);

const nightValueUsd = computed<number>(() => {
  if (!hasNightPrice.value || !nightFiat.usd.value) return 0;
  return Number(totalNight.value) / Number(NIGHT_DIVISOR) * nightFiat.usd.value;
});

// tDUST is deliberately NOT a table row — the dedicated DUST battery panel
// above owns the live DUST display (it's a fee resource, not a holding).
const rows = computed<MidnightHoldingRow[]>(() => [
  {
    ticker: nightCurrency.value,
    name: 'Midnight Native Token',
    balanceFormatted: `${formatBigDecimal(totalNight.value, NIGHT_DIVISOR, 2)} ${nightCurrency.value}`,
    breakdownText: breakdownText.value,
    price: hasNightPrice.value && nightFiat.usd.value ? formatPrice(nightFiat.usd.value) : '—',
    value: hasNightPrice.value ? formatUsd(nightValueUsd.value) : '—',
    change24h: hasNightPrice.value && nightFiat.change24h.value !== null
      ? formatSignedChange(nightFiat.change24h.value)
      : '—',
    change24hRaw: hasNightPrice.value ? nightFiat.change24h.value : null,
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
.midnight-holdings-table-root {
  width: 100%;
}

.breakdown-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--g-s-2);
  margin-top: 2px;
}

.convert-link-btn {
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  color: var(--g-accent);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.convert-link-btn:hover {
  text-decoration: underline;
}

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
