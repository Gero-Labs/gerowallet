<template>
  <!-- Side panel: one row per offer, the open one with its time bar. -->
  <section v-if="!table" class="swap-yours" :aria-labelledby="headingId">
    <div class="swap-yours__heading">
      <span :id="headingId" class="t-label">{{ t('midnight.swap.yours') }}</span>
      <SwapHint :text="t('midnight.swap.hint.yours')" />
    </div>
    <p v-if="!rows.length" class="t-caption swap-yours__empty">{{ t('midnight.swap.yoursEmpty') }}</p>
    <button
      v-for="row in rows"
      :key="row.record.offerId"
      type="button"
      class="glass-tier swap-yours__row"
      :data-test="`swap-offer-${row.record.offerId.slice(0, 8)}`"
      @click="emit('open', row.record)"
    >
      <span class="swap-yours__line">
        <span class="t-body g-num swap-yours__terms" :class="{ 'swap-yours__terms--done': row.status !== 'open' }">{{ row.terms }}</span>
        <SwapStatusChip :status="row.status" />
      </span>
      <SwapTimeBar
        v-if="row.status === 'open'"
        :created-at="row.record.createdAt"
        :expires-at="row.record.expiresAt"
        :now="now"
        :estimate="row.record.expiry === 'root-window'"
      />
    </button>
  </section>

  <!-- Dashboard: a table, actions in the row. -->
  <section v-else class="swap-yours" :aria-labelledby="headingId">
    <div class="swap-yours__heading">
      <h2 :id="headingId" class="t-body-lg swap-yours__title">{{ t('midnight.swap.yours') }}</h2>
      <SwapHint :text="t('midnight.swap.hint.yours')" />
    </div>
    <p v-if="!rows.length" class="t-caption swap-yours__empty">{{ t('midnight.swap.yoursEmpty') }}</p>
    <div v-else class="swap-table-wrap">
    <table class="swap-table t-body-sm">
      <thead>
        <tr>
          <th scope="col" class="t-caption">{{ t('midnight.swap.youGive') }}</th>
          <th scope="col" class="t-caption">{{ t('midnight.swap.youWant') }}</th>
          <th scope="col" class="t-caption">{{ t('midnight.swap.status.title') }}</th>
          <th scope="col"><span class="g-sr-only">{{ t('midnight.swap.actions') }}</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.record.offerId" :data-test="`swap-offer-${row.record.offerId.slice(0, 8)}`">
          <td class="g-num">{{ row.gives }}</td>
          <td class="g-num">{{ row.wants }}</td>
          <td>
            <SwapStatusChip :status="row.status">
              <template v-if="row.status === 'open'">
                {{ row.record.expiry === 'root-window'
                  ? t('midnight.swap.expiresAbout', { n: minutesLeft(row.record.expiresAt, now) })
                  : t('midnight.swap.status.openFor', { n: minutesLeft(row.record.expiresAt, now) }) }}
              </template>
            </SwapStatusChip>
          </td>
          <td class="swap-table__actions">
            <template v-if="row.status === 'open'">
              <GButton tier="tertiary" compact @click="emit('show-code', row.record)">{{ t('midnight.swap.showCodeShort') }}</GButton>
              <GButton
                v-if="canWithdrawSwapOffer(row.record)"
                tier="tertiary"
                compact
                class="swap-table__danger"
                data-test="swap-row-withdraw"
                @click="emit('withdraw', row.record)"
              >
                {{ t('midnight.swap.withdrawShort') }}
              </GButton>
            </template>
            <GButton v-else tier="tertiary" compact @click="emit('open', row.record)">{{ settledText(row.record) }}</GButton>
          </td>
        </tr>
      </tbody>
    </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { MidnightSwapOfferRecord } from '@/chains/midnight/midnightSwapRecords';
import { injectMidnightSwap } from './swapContext';
import { swapDisplayStatus } from './swapStatus';
import { canWithdrawSwapOffer } from './swapPrivacy';
import { minutesLeft, swapLegText } from './swapTokens';
import SwapStatusChip from './SwapStatusChip.vue';
import SwapTimeBar from './SwapTimeBar.vue';
import SwapHint from './SwapHint.vue';

withDefaults(defineProps<{ table?: boolean }>(), { table: false });
const emit = defineEmits<{
  (e: 'open', record: MidnightSwapOfferRecord): void;
  (e: 'show-code', record: MidnightSwapOfferRecord): void;
  (e: 'withdraw', record: MidnightSwapOfferRecord): void;
}>();
const { t } = useTranslation();
const { offers, now, network } = injectMidnightSwap();
const headingId = useId();

const rows = computed(() => offers.value.map((record) => {
  const gives = record.gives.map(leg => swapLegText(leg, network.value)).join(', ');
  const wants = record.wants.map(leg => swapLegText(leg, network.value)).join(', ');
  return { record, gives, wants, terms: `${gives} → ${wants}`, status: swapDisplayStatus(record, now.value) };
}));

/** When it settled, for the table's last column. */
function settledText(record: MidnightSwapOfferRecord): string {
  const at = record.settledAt ?? record.expiresAt;
  return new Date(at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}
</script>

<style scoped lang="scss">
.swap-yours {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.swap-yours__heading {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  margin-top: var(--g-s-1);
}

.swap-yours__title {
  margin: 0;
}

.swap-yours__empty {
  margin: 0;
}

.swap-yours__row {
  width: 100%;
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
  border: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  text-align: left;
  color: inherit;
  cursor: pointer;
}

.swap-yours__row:focus-visible {
  outline: 2px solid var(--g-accent);
  outline-offset: 2px;
}

.swap-yours__line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.swap-yours__terms {
  color: var(--g-text-1);
  font-weight: 600;
  min-width: 0;
}

.swap-yours__terms--done {
  color: var(--g-text-2);
  font-weight: 400;
}

/* Table rows are justified solids: the card carries the material. */
.swap-table {
  width: 100%;
  border-collapse: collapse;
}

.swap-table-wrap {
  overflow-x: auto;
}

.swap-table th {
  white-space: nowrap;
  text-align: left;
  font-weight: 550;
  padding: 0 var(--g-s-3) var(--g-s-2);
}

.swap-table td {
  white-space: nowrap;
  height: var(--g-row-h-table);
  padding: 0 var(--g-s-3);
  border-top: 1px solid var(--g-hairline-1);
  color: var(--g-text-1);
}

.swap-table__actions {
  text-align: right;
  white-space: nowrap;
}

.swap-table__danger {
  color: var(--g-error);
}
</style>
