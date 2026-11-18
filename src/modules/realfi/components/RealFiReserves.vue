<template>
  <section class="realfi-reserves" aria-labelledby="realfi-reserves-title">
    <header class="realfi-reserves__head">
      <div class="realfi-reserves__titles">
        <span class="t-label">{{ $t('realfi.reserves.label') }}</span>
        <h2 id="realfi-reserves-title" class="t-heading realfi-reserves__title">
          {{ $t('realfi.reserves.title') }}
        </h2>
      </div>
      <span class="t-caption realfi-reserves__source">{{ $t('realfi.reserves.source') }}</span>
    </header>

    <!-- Each figure carries its own date: custody is published daily, NAV weekly, and
         a single "as of" would misdate whichever one is older. -->
    <dl class="realfi-reserves__figures">
      <div v-for="f in figures" :key="f.key" class="realfi-reserves__figure">
        <dt class="t-caption realfi-reserves__muted">{{ f.label }}</dt>
        <dd :class="f.pending ? 't-body-lg realfi-reserves__pending' : 't-title g-num'">{{ f.value }}</dd>
        <dd class="t-caption realfi-reserves__muted">{{ f.note }}</dd>
      </div>
    </dl>

    <div v-if="sleeves.length" class="realfi-reserves__mix">
      <span class="t-body-sm realfi-reserves__subhead">{{ $t('realfi.reserves.composition') }}</span>
      <!-- One hue at falling strengths: the legend carries each name and share, so
           colour is never the only way to tell the sleeves apart. -->
      <div class="realfi-reserves__bar" role="img" :aria-label="mixAria">
        <span
          v-for="s in sleeves"
          :key="s.sleeve"
          :class="['realfi-reserves__seg', `realfi-reserves__tone--${s.tone}`]"
          :style="{ flexGrow: s.share }"
        />
      </div>
      <ul class="realfi-reserves__legend">
        <li v-for="s in sleeves" :key="s.sleeve" class="realfi-reserves__legend-row">
          <span :class="['realfi-reserves__swatch', `realfi-reserves__tone--${s.tone}`]" aria-hidden="true" />
          <span class="t-body-sm">{{ s.label }}</span>
          <span class="t-body-sm g-num realfi-reserves__strong">{{ s.shareText }}</span>
          <span class="t-body-sm g-num realfi-reserves__muted">{{ s.usdText }}</span>
        </li>
      </ul>
    </div>

    <RealFiReservesTrend v-if="showTrend" :nav="report.history.nav" :supply="report.history.supply" />

    <details v-if="custodians.length" class="realfi-reserves__details">
      <summary class="realfi-reserves__summary">
        <span class="realfi-reserves__summary-text">
          <span class="t-body-sm realfi-reserves__subhead">{{ $t('realfi.reserves.custodians.title') }}</span>
          <span class="t-caption realfi-reserves__muted">{{ custodianSummary }}</span>
        </span>
        <v-icon size="18" class="realfi-reserves__chevron" aria-hidden="true">mdi-chevron-down</v-icon>
      </summary>

      <!-- Wide on purpose: on a narrow window the table scrolls inside its box rather
           than squeezing five columns into unreadable ones. -->
      <div class="realfi-reserves__table-box">
        <table class="realfi-reserves__table">
          <thead>
            <tr class="t-caption">
              <th scope="col">{{ $t('realfi.reserves.custodians.colAsset') }}</th>
              <th scope="col">{{ $t('common.type') }}</th>
              <th scope="col" class="realfi-reserves__num">{{ $t('common.quantity') }}</th>
              <th scope="col" class="realfi-reserves__num">{{ $t('common.value') }}</th>
              <th scope="col" class="realfi-reserves__num">{{ $t('realfi.reserves.custodians.colShare') }}</th>
            </tr>
          </thead>
          <tbody v-for="c in custodians" :key="c.custodian">
            <tr class="realfi-reserves__custodian">
              <th scope="rowgroup" class="t-body-sm">
                {{ c.custodian }}
                <span v-if="c.valuedText" class="t-caption realfi-reserves__muted">{{ c.valuedText }}</span>
              </th>
              <td class="t-caption realfi-reserves__soft">{{ c.typeText }}</td>
              <td />
              <td class="t-body-sm g-num realfi-reserves__num realfi-reserves__strong">{{ c.usdText }}</td>
              <td class="t-body-sm g-num realfi-reserves__num realfi-reserves__muted">{{ c.shareText }}</td>
            </tr>
            <tr v-for="h in c.holdings" :key="h.key" class="realfi-reserves__holding">
              <td :class="['t-body-sm', { 'g-mono': h.mono }]">{{ h.label }}</td>
              <td class="t-caption realfi-reserves__soft">{{ h.typeText }}</td>
              <td class="t-body-sm g-num realfi-reserves__num">{{ h.quantityText }}</td>
              <td class="t-body-sm g-num realfi-reserves__num">{{ h.usdText }}</td>
              <td />
            </tr>
            <tr v-if="c.smallCount" class="realfi-reserves__holding">
              <td colspan="5" class="t-caption realfi-reserves__muted">
                {{ $t('realfi.reserves.custodians.small', c.smallCount) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>

    <p class="t-caption realfi-reserves__note">{{ $t('realfi.reserves.note') }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import i18n from '@/plugins/i18n';
import { formatCompact, formatTokenQuantity, formatUsd } from '@/shared/utils/format';
import RealFiReservesTrend from './RealFiReservesTrend.vue';
import type { RealFiReservesReport } from '../types';
import {
  assetClassLabel,
  coverageLabel,
  holdingLabel,
  isIsin,
  navPerTokenLabel,
  shareLabel,
  shortDate,
  sleeveLabel,
  usdCompact,
} from '../reservesFormat';

/**
 * What backs USDrf, as RealFi publishes it: the fund administrator's NAV, USDrf in
 * circulation, and the custody positions behind them, down to each holding.
 *
 * Shows only what RealFi published. Where RealFi has no figure (an official coverage
 * ratio, before it is published) the section says so or leaves it out; it never
 * computes one, because RealFi calls its own custody-sum ratio indicative only.
 */
const props = defineProps<{ report: RealFiReservesReport }>();

const t = (key: string, values?: Record<string, unknown>) => i18n.t(key, values) as string;

/** Positions smaller than this are counted on one line instead of listed: dust reads as $0.00. */
const SMALL_POSITION_USD = 1;
/** Strengths of the partner hue; a fifth sleeve and beyond share the faintest. */
const TONES = 4;

interface Figure {
  key: string;
  label: string;
  value: string;
  note: string;
  pending?: boolean;
}

const figures = computed<Figure[]>(() => {
  const { coverage, nav, supply, reserves } = props.report;
  const out: Figure[] = [];
  if (coverage) {
    out.push({
      key: 'coverage',
      label: t('realfi.reserves.coverage'),
      value: coverageLabel(coverage.ratio),
      note: t('realfi.reserves.coverageNote', { date: shortDate(coverage.asOf) }),
    });
  }
  if (nav) {
    // Each NAV figure on its own: RealFi can publish one without the other.
    if (nav.perToken !== null) {
      out.push({
        key: 'navPerToken',
        label: t('realfi.reserves.navPerToken'),
        value: navPerTokenLabel(nav.perToken),
        note: t('realfi.reserves.navPerTokenNote', { date: shortDate(nav.asOf) }),
      });
    }
    if (nav.totalUsd !== null) {
      out.push({
        key: 'nav',
        label: t('realfi.reserves.nav'),
        value: usdCompact(nav.totalUsd),
        note: t('realfi.reserves.navNote', { date: shortDate(nav.asOf) }),
      });
    }
  } else {
    out.push({
      key: 'nav',
      label: t('realfi.reserves.nav'),
      value: t('realfi.reserves.navPending'),
      note: t('realfi.reserves.navPendingNote'),
      pending: true,
    });
  }
  if (supply) {
    out.push({
      key: 'supply',
      label: t('realfi.reserves.supply'),
      value: formatCompact(supply.usdr),
      note: t('realfi.reserves.supplyNote', { date: shortDate(supply.asOf) }),
    });
  }
  if (reserves) {
    out.push({
      key: 'custody',
      label: t('realfi.reserves.custody'),
      value: usdCompact(reserves.totalUsd),
      note: i18n.tc('realfi.reserves.custodyNote', reserves.custodians.length, {
        n: reserves.custodians.length,
        date: shortDate(reserves.asOf),
      }),
    });
  }
  return out;
});

const sleeves = computed(() =>
  (props.report.reserves?.sleeves ?? []).map((s, i) => ({
    sleeve: s.sleeve,
    share: s.share,
    tone: Math.min(i + 1, TONES),
    label: sleeveLabel(s.sleeve),
    shareText: shareLabel(s.share),
    usdText: usdCompact(s.usd),
  })),
);

const mixAria = computed(() =>
  t('realfi.reserves.compositionAria', {
    list: sleeves.value.map((s) => `${s.label} ${s.shareText}`).join(', '),
  }),
);

const showTrend = computed(
  () => props.report.history.nav.length >= 2 || props.report.history.supply.length >= 2,
);

const custodians = computed(() => {
  const reserves = props.report.reserves;
  if (!reserves) return [];
  return reserves.custodians.map((c) => {
    const listed = c.holdings.filter((h) => h.usd >= SMALL_POSITION_USD);
    const classes = [...new Set(c.holdings.map((h) => h.assetClass))];
    return {
      custodian: c.custodian,
      usdText: formatUsd(c.usd),
      shareText: shareLabel(c.share),
      typeText: classes.map(assetClassLabel).join(', '),
      // Only when it trails the publish date: a valuation from the same day adds nothing.
      valuedText:
        c.valuedAsOf && c.valuedAsOf < reserves.asOf
          ? t('realfi.reserves.custodians.valuedOn', { date: shortDate(c.valuedAsOf) })
          : '',
      smallCount: c.holdings.length - listed.length,
      holdings: listed.map((h, i) => ({
        key: `${h.symbol}:${h.assetClass}:${h.sleeve}:${i}`,
        label: holdingLabel(h.symbol, h.assetClass),
        mono: isIsin(h.symbol),
        typeText: assetClassLabel(h.assetClass),
        quantityText: h.quantity === null ? '—' : formatTokenQuantity(h.quantity, 6),
        usdText: formatUsd(h.usd),
      })),
    };
  });
});

const custodianSummary = computed(() => {
  const list = props.report.reserves?.custodians ?? [];
  const positions = list.reduce((sum, c) => sum + c.holdings.length, 0);
  return [
    i18n.tc('realfi.reserves.custodians.count', list.length, { n: list.length }),
    i18n.tc('realfi.reserves.custodians.positions', positions, { n: positions }),
  ].join(' · ');
});
</script>

<style lang="scss" scoped>
.realfi-reserves {
  @include g-glass-panel(false);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-5);
  padding: var(--g-s-5);
  margin-top: var(--g-s-4);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
}

.realfi-reserves__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.realfi-reserves__titles {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.realfi-reserves__title {
  margin: 0;
}

.realfi-reserves__source,
.realfi-reserves__muted {
  color: var(--g-text-3);
}

.realfi-reserves__soft {
  color: var(--g-text-2);
}

.realfi-reserves__strong {
  font-weight: 550;
  color: var(--g-text-1);
}

.realfi-reserves__pending {
  margin-top: var(--g-s-1);
  color: var(--g-text-2);
}

.realfi-reserves__figures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--g-s-4);
  margin: 0;

  dd {
    margin: 0;
  }
}

.realfi-reserves__figure {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.realfi-reserves__subhead {
  font-weight: 550;
  color: var(--g-text-1);
}

.realfi-reserves__mix {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.realfi-reserves__bar {
  display: flex;
  gap: 2px;
  height: 8px;
  overflow: hidden;
  border-radius: var(--g-r-pill);
}

/* Every sleeve stays visible however small its share. */
.realfi-reserves__seg {
  flex-basis: 0;
  min-width: 3px;
}

.realfi-reserves__legend {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  column-gap: var(--g-s-6);
  padding: 0;
  margin: 0;
  list-style: none;
}

.realfi-reserves__legend-row {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto 72px;
  align-items: center;
  gap: var(--g-s-2);
  min-height: 40px;
  border-bottom: 1px solid var(--g-hairline-1);
}

.realfi-reserves__legend-row > :nth-child(n + 3) {
  text-align: right;
}

.realfi-reserves__swatch {
  width: 10px;
  height: 10px;
  border-radius: var(--g-r-chip);
}

.realfi-reserves__tone--1 {
  background: var(--g-partner-realfi);
}

.realfi-reserves__tone--2 {
  background: var(--g-partner-realfi);
  opacity: 0.6;
}

.realfi-reserves__tone--3 {
  background: var(--g-partner-realfi);
  opacity: 0.38;
}

.realfi-reserves__tone--4 {
  background: var(--g-partner-realfi);
  opacity: 0.22;
}

.realfi-reserves__summary {
  @include g-glass-tier(false);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  min-height: 48px;
  padding: 0 var(--g-s-4);
  cursor: pointer;
  list-style: none;
  border-radius: var(--g-r-control);

  &::-webkit-details-marker {
    display: none;
  }

  &:hover {
    @include g-glass-tier-hover(false);
  }
}

.realfi-reserves__summary-text {
  display: flex;
  flex-direction: column;
}

.realfi-reserves__chevron {
  color: var(--g-text-2);
  transition: transform var(--g-dur-fast) var(--g-ease);
}

.realfi-reserves__details[open] .realfi-reserves__chevron {
  transform: rotate(180deg);
}

.realfi-reserves__table-box {
  margin-top: var(--g-s-3);
  overflow-x: auto;
}

/* Table rows are solid by rule: the section around them carries the glass. */
.realfi-reserves__table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;

  th,
  td {
    padding: 0 var(--g-s-4);
    text-align: left;
  }

  thead th {
    padding-bottom: var(--g-s-2);
    font-weight: 400;
    color: var(--g-text-3);
    border-bottom: 1px solid var(--g-hairline-2);
  }

  tbody + tbody .realfi-reserves__custodian {
    border-top: 1px solid var(--g-hairline-1);
  }
}

.realfi-reserves__custodian {
  height: 44px;

  th {
    font-weight: 550;
    color: var(--g-text-1);

    span {
      margin-left: var(--g-s-2);
    }
  }
}

.realfi-reserves__holding {
  height: 36px;
  color: var(--g-text-2);

  td:first-child {
    padding-left: var(--g-s-6);
  }
}

.realfi-reserves__table .realfi-reserves__num {
  text-align: right;
}

.realfi-reserves__note {
  max-width: 72ch;
  margin: 0;
  color: var(--g-text-3);
}
</style>
