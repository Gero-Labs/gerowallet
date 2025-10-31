<template>
  <v-card class="transactions-card" outlined>
    <v-card-title>
      {{ t('card.transactions') }}
    </v-card-title>
    <v-card-text>
      <v-data-table
        :header-props="{ 'sort-icon': 'mdi-menu-up' }"
        :headers="headers"
        :items="formattedTransactions"
        :loading="loading"
        :page.sync="currentPage"
        :items-per-page="10"
        dense
        :server-items-length="cardStore.cardHistoryMeta?.totalRecords || 0"
        hide-default-footer
        class="transactions-table"
        :no-data-text="t('card.noTransactionsYet')"
        :loading-text="t('card.loadingTransactions')"
      >
        <template v-slot:item.reference="{ item }">
          <v-list-item class="px-0">
            <v-list-item-content class="px-0">
              <v-list-item-title class="px-0">
                {{ filters.truncate(item.reference) }}<CopyButton style="margin-bottom: 1px;" x-small :value="item.reference" />
              </v-list-item-title>
            </v-list-item-content>
          </v-list-item>
        </template>

        <!-- Date & Time column -->
        <template v-slot:item.datetime="{ item }">
          <v-list-item class="px-0">
            <v-list-item-content class="px-0">
              <v-list-item-title class="px-0" style="font-size: 13px">
                {{ item.dateFormatted }}
              </v-list-item-title>
              <v-list-item-subtitle class="px-0" style="font-size: 12px">
                {{ item.timeFormatted }}
              </v-list-item-subtitle>
            </v-list-item-content>
          </v-list-item>
        </template>

        <!-- Amount column -->
        <template v-slot:item.amount="{ item }">
          <v-list-item class="px-0">
            <v-list-item-content class="px-0">
              <v-list-item-title class="px-0">
                <span class="amount" :class="{ negative: item.amount < 0 }">
                  {{ filters.toCurrency(item.amount, true, 2, item.currency, '', true, 0) }}
                </span>
              </v-list-item-title>
              <v-list-item-subtitle 
                v-if="item.isTopUp && item.adaAmount" 
                class="px-0 ada-equivalent"
              >
                ₳{{ filters.toCurrency(item.adaAmount, false, 2, '', '', false, 0) }}
              </v-list-item-subtitle>
            </v-list-item-content>
          </v-list-item>
        </template>

        <!-- Category column -->
        <template v-slot:item.category="{ item }">
          <div class="category-badge" :class="item.categoryClass">
            <div class="category-dot" :class="item.categoryDotClass"></div>
            <span class="category-text">{{ item.category }}</span>
          </div>
        </template>
      </v-data-table>
    </v-card-text>
    <v-card-actions v-if="totalPages > 1 && !loading" class="pagination-container">
      <v-pagination
        v-model="currentPage"
        :length="totalPages"
        :total-visible="7"
        class="custom-pagination"
        @input="handlePageChange"
      ></v-pagination>
    </v-card-actions>

    <!-- Vuetify Pagination -->

  </v-card>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed } from 'vue';
import type { CardTransactionHistory } from '@/models/card';
import cardStore from '@/stores/modules/card';
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';

interface Props {
  transactions?: CardTransactionHistory[];
  loading?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits(['orderCard']);

const { t } = useTranslation();

// Exchange rate from store (same as AmountInputStep.vue)
const EXCHANGE_RATE = computed(() => {
  return Number(cardStore.state.exchangeRate?.buy) || 0;
});

// Define table headers
const headers = [
  { text: t('card.dateTime'), value: 'datetime', sortable: true, align: 'start', width: '150' },
  { text: t('card.category'), value: 'category', sortable: false, align: 'start' },
  { text: t('card.transaction'), value: 'name', sortable: false, align: 'start' },
  { text: t('card.reference'), value: 'reference', sortable: true, align: 'start', width: '150' },
  { text: t('card.amount'), value: 'amount', sortable: false, align: 'start' },
];

// Parse European date format DD.MM.YYYY HH:mm
const parseEuropeanDate = (dateStr: string): Date => {
  // Split date and time
  const [datePart, timePart] = dateStr.split(' ');
  const [day, month, year] = datePart.split('.');
  const [hours, minutes] = timePart.split(':');

  // Create Date object (month is 0-indexed)
  return new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hours),
    parseInt(minutes)
  );
};

const resolveCurrencySymbol = (currencyName: string) => {
  switch (currencyName) {
    case "EUR":
    default:
      return '€'
  }
}

// Transform API transactions to UI format
const formattedTransactions = computed(() => {
  const transactionsToDisplay = props.transactions || [];

  const allTransactions = transactionsToDisplay.map((tx, index) => {
    console.log('Transaction:', tx);

    // Extract merchant name from cardAcceptorNameAndLocation
    const merchantName: string = tx.narrative || 'Unknown';

    // Determine category based on MCC code
    const category = getCategoryFromMCC(tx.mcc.code);
    const categoryClass = getCategoryClass(category);
    const categoryDotClass = getCategoryDotClass(category);

    // Check if this is a top-up transaction (MCC code '6012')
    const isTopUp = tx.mcc.code === '6012';

    // Calculate ADA equivalent for top-up transactions
    const adaAmount = isTopUp && EXCHANGE_RATE.value > 0
      ? tx.amount.amount / EXCHANGE_RATE.value
      : null;

    // Parse date and convert to local time
    const localDate = parseEuropeanDate(tx.createTime);

    // Format date as MM/DD/YYYY
    const dateFormatted = localDate.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric'
    });

    // Format time as HH:mm AM/PM
    const timeFormatted = localDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    return {
      id: index + 1,
      date: localDate.getTime(),
      dateFormatted,
      timeFormatted,
      name: merchantName,
      avatarText: merchantName.substring(0, 2).toUpperCase(),
      avatarClass: 'avatar-default',
      icon: undefined, // No icon for now
      amount: tx.amount.amount,
      currency: resolveCurrencySymbol(tx.amount.currencyCode),
      category,
      categoryClass,
      categoryDotClass,
      reference: tx.reference,
      isTopUp,
      adaAmount,
    };
  });

  // Slice data for pagination (10 items per page)
  const startIndex = (currentPage.value - 1) * 10;
  const endIndex = startIndex + 10;
  return allTransactions.slice(startIndex, endIndex);
});

// Helper functions
const getCategoryFromMCC = (mccCode: string): string => {
  const mccCategories: Record<string, string> = {
    '4899': t('card.subscriptions'),
    '5942': t('card.ecommerce'),
    '5814': t('card.foodAndDining'),
    '5411': t('card.groceries'),
    '5541': t('card.transportation'),
    '7011': t('card.travel'),
    '8099': t('card.entertainment'),
    '6012': t('card.topUpCategory'),
  };

  return mccCategories[mccCode] || t('card.other');
};

const getCategoryClass = (category: string): string => {
  const categoryClasses: Record<string, string> = {
    'Subscriptions': 'category-green',
    'Ecommerce': 'category-blue',
    'Food and dining': 'category-pink',
    'Groceries': 'category-orange',
    'Transportation': 'category-purple',
    'Travel': 'category-cyan',
    'Entertainment': 'category-red',
    'Top-up': 'category-green', // Green for positive/credit transactions
    'Other': 'category-gray',
  };

  return categoryClasses[category] || 'category-gray';
};

const getCategoryDotClass = (category: string): string => {
  const dotClasses: Record<string, string> = {
    'Subscriptions': 'dot-green',
    'Ecommerce': 'dot-blue',
    'Food and dining': 'dot-pink',
    'Groceries': 'dot-orange',
    'Transportation': 'dot-purple',
    'Travel': 'dot-cyan',
    'Entertainment': 'dot-red',
    'Top-up': 'dot-green', // Green dot for top-up transactions
    'Other': 'dot-gray',
  };

  return dotClasses[category] || 'dot-gray';
};

const currentPage = ref(1);
const totalPages = computed(() => {
  const totalRecords = cardStore.cardHistoryMeta?.totalRecords || props.transactions?.length || 0;
  return Math.ceil(totalRecords / 10);
});

const handlePageChange = (page: number) => {
  currentPage.value = page;
  console.log('Page changed to:', page);
  // TODO: Emit event or call API to fetch new page data
};

</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.transactions-card {
  background: $background-card;
  border: 1px solid $border-secondary;
  border-radius: $border-radius-md;
  padding: $spacing-lg;
  width: 100%;

  .card-header {
    margin-bottom: $spacing-2xl;
  }

  .card-title {
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    font-size: $font-size-xl;
    line-height: 1.4;
    color: $text-primary;
    margin: 0;
  }

  // v-data-table styling
  :deep(.v-data-table) {
    background: transparent;

    .v-data-table__wrapper {
      overflow-x: auto;
    }

    thead {
      th {
        font-family: $font-family-primary !important;
        font-weight: $font-weight-semibold !important;
        font-size: $font-size-xs !important;
        line-height: 1.5 !important;
        color: $text-muted !important;
        background: transparent !important;
        border-bottom: 1px solid $border-secondary !important;
        padding: 0 8px 0 8px !important;
      }
    }

    tbody {
      tr {
        border-bottom: 1px solid $border-secondary !important;

        &:last-child {
          border-bottom: none !important;
        }

        &:hover {
          background: transparent !important;
        }

        td {
          padding: 0 8px 0 8px !important;
          border: none !important;
          background: transparent !important;
        }
      }
    }
  }

  // Date cell styling
  .date-cell {
    font-family: $font-family-primary;
    font-weight: $font-weight-medium;
    font-size: $font-size-sm;
    line-height: 1.43;
    color: $text-primary;
  }

  // Transaction info styling
  .transaction-info {
    display: flex;
    align-items: center;
    gap: 12px;

    .transaction-name {
      font-family: $font-family-primary;
      font-weight: $font-weight-medium;
      font-size: $font-size-sm;
      line-height: 1.43;
      color: $text-primary;
    }
  }

  // Amount styling
  .amount {
    display: inline-block;
    font-family: $font-family-primary;
    font-weight: $font-weight-normal;
    font-size: $font-size-sm;
    line-height: 1.43;
    color: var(--v-primary-base);
    white-space: nowrap;
    vertical-align: middle;

    &.negative {
      color: var(--v-error-base);
    }
  }

  // ADA equivalent styling (for top-ups)
  .ada-equivalent {
    font-family: $font-family-primary;
    font-weight: $font-weight-normal;
    font-size: $font-size-xs;
    line-height: 1.5;
    color: $text-muted;
    margin-top: 2px;
  }

  // Category badge styling
  .category-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: $border-radius-sm;
    background: $background-card;
    border: 1px solid $border-primary;
    box-shadow: $shadow-sm;
    width: fit-content;
    white-space: nowrap;
    vertical-align: middle;

    .category-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;

      &.dot-pink { background: #ee46bc; }
      &.dot-green { background: #17b26a; }
      &.dot-blue { background: #36bffa; }
      &.dot-red { background: #fecdca; }
      &.dot-orange { background: #ff9f00; }
      &.dot-purple { background: #9c27b0; }
      &.dot-cyan { background: #00bcd4; }
      &.dot-gray { background: #fecdca; }
    }

    .category-text {
      font-family: $font-family-primary;
      font-weight: $font-weight-medium;
      font-size: $font-size-xs;
      line-height: 1.5;
      color: $text-secondary;
      white-space: nowrap;
    }
  }

  // Card info styling
  .card-info {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;

    .card-icon {
      width: 46px;
      height: 32px;
      border: 1px solid $border-secondary;
      border-radius: 4px;

      img {
        width: 46px;
        height: 32px;
      }
    }

    .card-details {
      display: flex;
      flex-direction: column;
      gap: 2px;

      .card-number {
        font-family: $font-family-primary;
        font-weight: $font-weight-medium;
        font-size: $font-size-sm;
        line-height: 1.43;
        color: $text-primary;
      }

      .card-expiry {
        font-family: $font-family-primary;
        font-weight: $font-weight-normal;
        font-size: $font-size-sm;
        line-height: 1.43;
        color: $text-muted;
      }
    }
  }

  // v-pagination styling
  .pagination-container {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-top: $spacing-2xl;
    padding-top: $spacing-lg;
    border-top: 1px solid $border-secondary;
  }

  :deep(.v-pagination) {
    .v-pagination__list {
      justify-content: center;
    }

    .v-pagination__item,
    .v-pagination__navigation {
      background: transparent;
      color: $text-muted;
      font-family: $font-family-primary;
      font-weight: $font-weight-medium;
      font-size: 14px;
      box-shadow: none;
      min-width: 40px;
      height: 40px;
      border-radius: 50%;
      transition: all 0.2s ease;

      &:hover {
        background: lighten($background-card, 2%);
      }

      &.v-pagination__item--active {
        background: $background-secondary !important;
        color: $text-secondary !important;
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    .v-pagination__more {
      color: $text-muted;
    }
  }
}

@media (max-width: $breakpoint-lg) {
  .transactions-card {
    :deep(.v-data-table) {
      thead th,
      tbody td {
        padding: 0 8px 0 8px !important;
      }
    }
  }
}

@media (max-width: $breakpoint-md) {
  .transactions-card {
    .pagination-container {
      flex-direction: column;
      gap: $spacing-lg;
    }

    :deep(.v-data-table) {
      .v-data-table__wrapper {
        overflow-x: scroll;
      }
    }
  }
}
</style>
