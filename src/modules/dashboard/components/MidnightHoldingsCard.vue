<template>
  <v-card flat class="liquid-glass holdings-table-card">
    <!-- Filter toolbar — single row, mirrors Cardano's PortfolioPage chip bar. -->
    <div class="filter-toolbar d-flex align-center px-3 py-1" style="gap: 6px;">
      <div class="d-flex align-center" style="gap: 6px;">
        <v-icon small color="cyan lighten-2">mdi-coin-outline</v-icon>
        <span class="text-caption text--secondary text-uppercase" style="letter-spacing: 0.08em;">
          {{ $t('assets.holdings') }}
        </span>
      </div>
      <v-spacer />
      <span class="text-caption text--secondary">{{ rows.length }} {{ $t('assets.assets') }}</span>
    </div>

    <!-- Holdings rows — same visual grammar as Cardano's MarketTokenTable but
         hand-rolled because Midnight has only NIGHT/DUST line items today. -->
    <v-simple-table dense>
      <thead>
        <tr>
          <th class="text-left">{{ $t('assets.asset') }}</th>
          <th class="text-right">Balance</th>
          <th class="text-right hidden-sm-and-down">Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key">
          <td>
            <div class="d-flex align-center">
              <v-avatar :color="row.iconBg" size="28" class="mr-2">
                <v-icon small :color="row.iconColor">{{ row.icon }}</v-icon>
              </v-avatar>
              <div>
                <div style="font-weight: 600;">{{ row.label }}</div>
                <div class="text-caption text--secondary">{{ row.sublabel }}</div>
              </div>
            </div>
          </td>
          <td class="text-right">
            <div style="font-weight: 600;">{{ row.amountFormatted }}</div>
            <div class="text-caption text--secondary">{{ row.currency }}</div>
          </td>
          <td class="text-right hidden-sm-and-down">
            <span class="text-caption text--secondary">{{ row.notes }}</span>
          </td>
        </tr>
      </tbody>
    </v-simple-table>
  </v-card>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';

const { balances, dustState } = toRefs(midnightStore);
const { loggedWallet } = toRefs(walletStore);

const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);
const nightCurrency = computed(() => (isMainnet.value ? 'NIGHT' : 'tNIGHT'));
const dustCurrency = computed(() => (isMainnet.value ? 'DUST' : 'tDUST'));

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);
const DUST_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.DUST);

function formatBigDecimal(value: bigint, divisor: bigint, fractionDigits: number): string {
  if (value < 0n) value = 0n;
  const whole = value / divisor;
  const remainder = value % divisor;
  if (fractionDigits === 0) return whole.toLocaleString('en-US');
  const remainderStr = remainder.toString().padStart(divisor.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, fractionDigits).padEnd(fractionDigits, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

interface HoldingRow {
  key: string;
  label: string;
  sublabel: string;
  amountFormatted: string;
  currency: string;
  notes: string;
  icon: string;
  iconBg: string;
  iconColor: string;
}

// One row per logical balance. Mirrors how Cardano shows ADA + tokens; for
// Midnight the breakdown is shielded/unshielded/registered NIGHT plus DUST.
const rows = computed<HoldingRow[]>(() => {
  const b = balances.value;
  const ds = dustState.value;
  const out: HoldingRow[] = [
    {
      key: 'night-unshielded',
      label: 'NIGHT (Unshielded)',
      sublabel: 'Public token in unshielded pool',
      amountFormatted: formatBigDecimal(b.nightUnshielded ?? 0n, NIGHT_DIVISOR, 2),
      currency: nightCurrency.value,
      notes: 'Transferable',
      icon: 'mdi-shield-off',
      iconBg: 'blue darken-4',
      iconColor: 'blue lighten-2',
    },
    {
      key: 'night-shielded',
      label: 'NIGHT (Shielded)',
      sublabel: 'Private token in shielded pool',
      amountFormatted: formatBigDecimal(b.nightShielded ?? 0n, NIGHT_DIVISOR, 2),
      currency: nightCurrency.value,
      notes: 'Private',
      icon: 'mdi-shield-lock',
      iconBg: 'purple darken-4',
      iconColor: 'purple lighten-2',
    },
    {
      key: 'night-registered',
      label: 'NIGHT (Registered)',
      sublabel: 'Producing DUST under your mapping',
      amountFormatted: formatBigDecimal(b.nightRegistered ?? 0n, NIGHT_DIVISOR, 2),
      currency: nightCurrency.value,
      notes: registrationNotes(ds?.registrationStatus),
      icon: 'mdi-check-circle',
      iconBg: 'green darken-4',
      iconColor: 'green lighten-2',
    },
    {
      key: 'dust',
      label: 'DUST',
      sublabel: 'Fee resource (non-transferable)',
      amountFormatted: formatBigDecimal(b.dust ?? 0n, DUST_DIVISOR, 4),
      currency: dustCurrency.value,
      notes: 'Pays for fees',
      icon: 'mdi-star',
      iconBg: 'amber darken-4',
      iconColor: 'amber lighten-2',
    },
  ];
  return out;
});

function registrationNotes(status: string | undefined): string {
  switch (status) {
    case 'Registered': return 'Active';
    case 'Pending': return 'Awaiting relay';
    case 'Invalid': return 'Mapping invalid';
    case 'Unregistered':
    default: return 'Not registered';
  }
}
</script>

<style scoped>
.holdings-table-card ::v-deep .v-data-table {
  background: transparent;
}
.holdings-table-card ::v-deep table {
  background: transparent;
}
.holdings-table-card ::v-deep th {
  background: rgba(10, 14, 20, 0.8);
  color: rgba(255, 255, 255, 0.5) !important;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 11px !important;
  font-weight: 600 !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
}
.holdings-table-card ::v-deep tbody tr {
  transition: background 0.15s ease;
}
.holdings-table-card ::v-deep tbody tr:hover {
  background: rgba(0, 199, 243, 0.04) !important;
}
.holdings-table-card ::v-deep tbody tr td {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04) !important;
  padding-top: 10px !important;
  padding-bottom: 10px !important;
}
</style>
