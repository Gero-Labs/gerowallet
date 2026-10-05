<template>
  <section class="card-tx glass-panel" aria-labelledby="card-tx-title">
    <header class="card-tx__head">
      <h2 id="card-tx-title" class="t-heading">{{ t('card.recentTransactions') }}</h2>
      <div class="card-tx__tools">
        <CardChip>{{ t('card.last30DaysLabel') }}</CardChip>
        <ExportPeriodMenu :disabled="loading || rows.length === 0" />
      </div>
    </header>

    <div v-if="loading && !rows.length" class="card-tx__skeleton" aria-hidden="true">
      <div v-for="n in 4" :key="n" class="g-skeleton card-tx__skeleton-row"></div>
    </div>

    <div v-else-if="!rows.length" class="card-tx__empty">
      <IsoScene name="empty" class="card-tx__empty-art" />
      <p class="t-body">{{ t('card.noTransactionsYet') }}</p>
    </div>

    <div v-else class="card-tx__scroll">
      <table class="card-tx__table">
        <thead>
          <tr>
            <th scope="col">{{ t('card.transaction') }}</th>
            <th scope="col">{{ t('card.dateTime') }}</th>
            <th scope="col">{{ t('card.reference') }}</th>
            <th scope="col" class="card-tx__num">{{ t('card.amount') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pageRows" :key="row.key" :class="{ 'is-declined': row.declined }">
            <td>
              <span class="card-tx__merchant">{{ row.name }}</span>
              <span class="t-caption">
                {{ row.category }}
                <CardChip v-if="row.declined" tone="error" class="card-tx__declined" :title="row.reason">
                  {{ t('card.declined') }}
                </CardChip>
              </span>
            </td>
            <td class="g-num card-tx__when">{{ row.when }}</td>
            <td>
              <span class="card-tx__ref">
                <span class="g-mono">{{ row.shortRef }}</span>
                <CopyButton x-small :value="row.reference" />
              </span>
            </td>
            <td class="card-tx__num g-num">
              <span :class="{ 'delta-up': row.credit && !row.declined }">{{ row.amount }}</span>
              <span v-if="row.ada" class="t-caption">≈ {{ row.ada }} ADA</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <v-pagination
      v-if="pageCount > 1"
      v-model="page"
      :length="pageCount"
      :total-visible="7"
      class="card-tx__pager"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useIntervalFn } from '@vueuse/core';
import type { CardTransactionHistory } from '@/models/card';
import cardStore from '@/stores/modules/card';
import { useTranslation } from '@/shared/composables/useTranslation';
import { adaFigure, cardMoney, uiLocale } from '@/modules/wallet/utils/cardFormat';
import CopyButton from '@/shared/components/CopyButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import CardChip from '../ui/CardChip.vue';
import ExportPeriodMenu from './ExportPeriodMenu.vue';

const PAGE_SIZE = 10;
const TOP_UP_MCC = '6012';

const { t } = useTranslation();
const page = ref(1);

const loading = computed(() => cardStore.state.loading.cardHistory);
const records = computed<CardTransactionHistory[]>(() => cardStore.getSelectedCard()?.cardHistory?.records || []);

const MCC_CATEGORY: Record<string, string> = {
  '4899': 'card.subscriptions',
  '5942': 'card.ecommerce',
  '5814': 'card.foodAndDining',
  '5411': 'card.groceries',
  '5541': 'card.transportation',
  '7011': 'card.travel',
  '8099': 'card.entertainment',
  [TOP_UP_MCC]: 'card.topUpCategory',
};

/** Provider timestamps are "DD.MM.YYYY HH:mm". */
function parseProviderDate(value: string): Date | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(value || '');
  if (!match) return null;
  const [, day, month, year, hours = '0', minutes = '0'] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes));
}

const buyRate = computed(() => {
  const rate = parseFloat(String(cardStore.state.exchangeRate?.buy ?? ''));
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
});

const rows = computed(() => {
  const dateFormat = new Intl.DateTimeFormat(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  return records.value
    .map((tx, index) => {
      const date = parseProviderDate(tx.createTime);
      const signed = Number(tx.amount?.amount) || 0;
      const value = Math.abs(signed);
      // `debit` decides when present; older records only carry the sign of the amount.
      const credit = typeof tx.debit === 'boolean' ? !tx.debit : signed > 0;
      const isTopUp = tx.mcc?.code === TOP_UP_MCC;
      const reference = tx.reference || '';
      return {
        key: `${reference}-${index}`,
        time: date?.getTime() ?? 0,
        name: tx.narrative || tx.cardAcceptorNameAndLocation || t('card.other'),
        category: t(MCC_CATEGORY[tx.mcc?.code] || 'card.other'),
        when: date ? dateFormat.format(date) : tx.createTime,
        reference,
        shortRef: reference.length > 12 ? `${reference.slice(0, 6)}…${reference.slice(-4)}` : reference,
        credit,
        declined: !!tx.rejectReason,
        reason: tx.rejectReason || '',
        amount: `${credit ? '+' : '−'}${cardMoney(value, tx.amount?.currencyCode || 'EUR')}`,
        ada: isTopUp && buyRate.value ? adaFigure(value / buyRate.value) : '',
      };
    })
    .sort((a, b) => b.time - a.time);
});

const pageCount = computed(() => Math.ceil(rows.value.length / PAGE_SIZE));
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

function formatForApi(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

async function load(): Promise<void> {
  if (!cardStore.state.selectedCardId) return;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  try {
    await cardStore.fetchCardHistory({ periodFrom: formatForApi(start), periodTo: formatForApi(end), page: 1, size: 1000 });
  } catch {
    // The rows already on screen stay; the next refresh retries.
  }
}

watch(() => cardStore.state.selectedCardId, () => {
  page.value = 1;
  load();
});
watch(pageCount, count => {
  if (page.value > Math.max(1, count)) page.value = 1;
});

useIntervalFn(load, 60000);
onMounted(load);
</script>

<style lang="scss" scoped>
.card-tx {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-5);
}

.card-tx__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);

  h2 {
    margin: 0;
  }
}

.card-tx__tools {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.card-tx__scroll {
  overflow-x: auto;
}

.card-tx__table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  font-size: 13px;

  th {
    padding: var(--g-s-2) var(--g-s-3);
    text-align: left;
    border-bottom: 1px solid var(--g-hairline-2);
    color: var(--g-text-3);
    font-size: 11px;
    font-weight: 550;
  }

  td {
    padding: var(--g-s-3);
    border-bottom: 1px solid var(--g-hairline-1);
    color: var(--g-text-2);
    vertical-align: middle;
  }

  td:first-child > span {
    display: flex;
    align-items: center;
    gap: var(--g-s-2);
  }
}

.card-tx__merchant {
  color: var(--g-text-1);
}

.card-tx__when {
  white-space: nowrap;
}

.card-tx__ref {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);

  .g-mono {
    word-break: normal;
  }
}

.card-tx__num {
  text-align: right;

  > span {
    display: block;
  }

  > span:first-child {
    color: var(--g-text-1);
  }

  > span.delta-up {
    color: var(--g-success);
  }
}

th.card-tx__num {
  text-align: right;
}

.is-declined .card-tx__num > span:first-child {
  color: var(--g-text-3);
  text-decoration: line-through;
}

.card-tx__declined {
  height: 20px;
}

.card-tx__skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.card-tx__skeleton-row {
  height: var(--g-row-h-table);
}

.card-tx__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-5) 0;

  p {
    margin: 0;
  }
}

.card-tx__empty-art {
  width: 180px;
}

.card-tx__pager {
  align-self: center;
}
</style>
