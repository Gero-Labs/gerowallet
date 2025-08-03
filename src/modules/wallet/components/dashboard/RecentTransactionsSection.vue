<template>
  <v-card class="transactions-card" outlined>
    <div class="card-header">
      <h3 class="card-title">Recent Transactions</h3>
    </div>
    <div class="table-container">
      <table class="transactions-table">
        <thead>
          <tr>
            <th class="header-cell">Date</th>
            <th class="header-cell">Transaction</th>
            <th class="header-cell">Amount</th>
            <th class="header-cell">Category</th>
            <th class="header-cell">Card</th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="transaction in formattedTransactions" :key="transaction.id" class="table-row">
            <td class="table-cell date-cell">{{ transaction.date }}</td>
            <td class="table-cell transaction-cell">
              <div class="transaction-info">
                <div class="avatar" :class="transaction.avatarClass">
                  <img v-if="transaction.icon" :src="transaction.icon" :alt="transaction.name" />
                  <span v-else class="avatar-text">{{ transaction.avatarText }}</span>
                </div>
                <span class="transaction-name">{{ transaction.name }}</span>
              </div>
            </td>
            <td class="table-cell amount-cell">
              <span class="amount" :class="{ negative: transaction.amount.startsWith('-') }">
                {{ transaction.amount }}
              </span>
            </td>
            <td class="table-cell category-cell">
              <div class="category-badge" :class="transaction.categoryClass">
                <div class="category-dot" :class="transaction.categoryDotClass"></div>
                <span class="category-text">{{ transaction.category }}</span>
              </div>
            </td>
            <td class="table-cell card-cell">
              <div class="card-info">
                <div class="card-icon">
                  <img src="@/modules/wallet/icons/mastercard.svg" alt="Mastercard" />
                </div>
                <div class="card-details">
                  <span class="card-number">Master Card 1234</span>
                  <span class="card-expiry">Expiry 08/2029</span>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pagination-container">
      <div class="pagination-wrapper">
        <v-btn
          variant="text"
          size="small"
          class="pagination-btn"
          :disabled="currentPage === 1"
          @click="handlePageChange(currentPage - 1)"
        >
          <img src="@/modules/wallet/icons/arrow-left.svg" alt="Previous" class="btn-icon" />
          Previous
        </v-btn>

        <div class="pagination-numbers">
          <div
            v-for="(page, index) in visiblePages"
            :key="`page-${index}-${page}`"
            class="page-number"
            :class="{ active: page === currentPage && typeof page === 'number' }"
            @click="handlePageChange(page)"
          >
            {{ typeof page === 'string' ? '...' : page }}
          </div>
        </div>

        <v-btn
          variant="text"
          size="small"
          class="pagination-btn"
          :disabled="currentPage === totalPages"
          @click="handlePageChange(currentPage + 1)"
        >
          Next
          <img src="@/modules/wallet/icons/arrow-right.svg" alt="Next" class="btn-icon" />
        </v-btn>
      </div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { CardTransactionHistory } from '@/models/card';

interface Props {
  transactions?: CardTransactionHistory[];
}

const props = defineProps<Props>();

// Transform API transactions to UI format
const formattedTransactions = computed(() => {
  if (!props.transactions) return [];

  return props.transactions.map((tx, index) => {
    const date = new Date(tx.createTime);
    const formattedDate = date.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const amount = tx.debit
      ? `- ${tx.amount.currencyCode}${tx.amount.amount.toFixed(2)}`
      : `+ ${tx.amount.currencyCode}${tx.amount.amount.toFixed(2)}`;

    // Extract merchant name from cardAcceptorNameAndLocation
    const merchantName = tx.cardAcceptorNameAndLocation.split(' ')[0] || 'Unknown';

    // Determine category based on MCC code
    const category = getCategoryFromMCC(tx.mcc.code);
    const categoryClass = getCategoryClass(category);
    const categoryDotClass = getCategoryDotClass(category);

    return {
      id: index + 1,
      date: formattedDate,
      name: merchantName,
      avatarText: merchantName.substring(0, 2).toUpperCase(),
      avatarClass: 'avatar-default',
      icon: undefined, // No icon for now
      amount,
      category,
      categoryClass,
      categoryDotClass,
    };
  });
});

// Helper functions
const getCategoryFromMCC = (mccCode: string): string => {
  const mccCategories: Record<string, string> = {
    '4899': 'Subscriptions',
    '5942': 'Ecommerce',
    '5814': 'Food and dining',
    '5411': 'Groceries',
    '5541': 'Transportation',
    '7011': 'Travel',
    '8099': 'Entertainment',
  };

  return mccCategories[mccCode] || 'Other';
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
    'Other': 'dot-gray',
  };

  return dotClasses[category] || 'dot-gray';
};

const currentPage = ref(1);
const totalPages = ref(10);

const visiblePages = computed(() => {
  const pages: (number | string)[] = [];
  const maxVisible = 7;

  if (totalPages.value <= maxVisible) {
    for (let i = 1; i <= totalPages.value; i++) {
      pages.push(i);
    }
  } else {
    if (currentPage.value <= 4) {
      for (let i = 1; i <= 5; i++) {
        pages.push(i);
      }
      pages.push('ellipsis-1');
      pages.push(totalPages.value);
    } else if (currentPage.value >= totalPages.value - 3) {
      pages.push(1);
      pages.push('ellipsis-2');
      for (let i = totalPages.value - 4; i <= totalPages.value; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      pages.push('ellipsis-3');
      for (let i = currentPage.value - 1; i <= currentPage.value + 1; i++) {
        pages.push(i);
      }
      pages.push('ellipsis-4');
      pages.push(totalPages.value);
    }
  }

  return pages;
});

const handlePageChange = (page: number | string) => {
  if (typeof page === 'number') {
    currentPage.value = page;
    console.log('Page changed to:', page);
  }
  // Ignore clicks on ellipsis
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

  .table-container {
    width: 100%;
    overflow-x: auto;

    .transactions-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 800px;

      thead {
        tr {
          border-bottom: 1px solid $border-secondary;

          th {
            font-family: $font-family-primary;
            font-weight: $font-weight-semibold;
            font-size: $font-size-xs;
            line-height: 1.5;
            color: $text-muted;
            text-align: left;
            padding: 12px 24px 12px 0;
            border: none;
            background: transparent;
          }
        }
      }

      tbody {
        tr {
          border-bottom: 1px solid $border-secondary;

          &:last-child {
            border-bottom: none;
          }

          td {
            padding: 16px 24px 16px 0;
            border: none;
            vertical-align: middle;

            &.date-cell {
              font-family: $font-family-primary;
              font-weight: $font-weight-medium;
              font-size: $font-size-sm;
              line-height: 1.43;
              color: $text-primary;
            }

            &.transaction-cell {
              width: 200px;
              .transaction-info {
                display: flex;
                align-items: center;
                gap: 12px;

                .avatar {
                  width: 40px;
                  height: 40px;
                  border-radius: 50%;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  border: 0.75px solid rgba(255, 255, 255, 0.12);
                  background: $background-secondary;

                  img {
                    width: 24px;
                    height: 24px;
                  }

                  .avatar-text {
                    font-family: $font-family-primary;
                    font-weight: $font-weight-semibold;
                    font-size: $font-size-base;
                    line-height: 1.5;
                    color: $text-primary;
                  }
                }

                .transaction-name {
                  font-family: $font-family-primary;
                  font-weight: $font-weight-medium;
                  font-size: $font-size-sm;
                  line-height: 1.43;
                  color: $text-primary;
                }
              }
            }

            &.amount-cell {
              .amount {
                font-family: $font-family-primary;
                font-weight: $font-weight-normal;
                font-size: $font-size-sm;
                line-height: 1.43;
                color: $text-primary;

                &.negative {
                  color: $text-primary;
                }
              }
            }

            &.category-cell {
              .category-badge {
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 2px 6px;
                border-radius: $border-radius-sm;
                background: $background-card;
                border: 1px solid $border-primary;
                box-shadow: $shadow-sm;
                width: fit-content;

                .category-dot {
                  width: 6px;
                  height: 6px;
                  border-radius: 50%;

                  &.dot-pink {
                    background: #ee46bc;
                  }

                  &.dot-green {
                    background: #17b26a;
                  }

                  &.dot-blue {
                    background: #36bffa;
                  }

                  &.dot-red {
                    background: #fecdca;
                  }
                }

                .category-text {
                  font-family: $font-family-primary;
                  font-weight: $font-weight-medium;
                  font-size: $font-size-xs;
                  line-height: 1.5;
                  color: $text-secondary;
                }
              }
            }

            &.card-cell {
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
            }
          }
        }
      }
    }
  }

  .pagination-container {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-top: $spacing-2xl;
    padding-top: $spacing-lg;
    border-top: 1px solid $border-secondary;

    .pagination-wrapper {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 0;
      background: transparent;
      border: none;
      box-shadow: none;
      justify-content: space-between;
    }

    .pagination-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: $font-family-primary;
      font-weight: $font-weight-semibold;
      font-size: 14px;
      line-height: 1.43;
      color: $text-muted;
      text-transform: none;
      background: transparent;
      border: none;
      padding: 0;
      min-width: auto;
      height: auto;

      .btn-icon {
        width: 12px;
        height: 12px;
        filter: brightness(0) saturate(100%) invert(83%) sepia(0%) saturate(0%) hue-rotate(93deg) brightness(89%)
          contrast(86%);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: transparent;
      }
    }

    .pagination-numbers {
      display: flex;
      gap: 2px;

      .page-number {
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: $font-family-primary;
        font-weight: $font-weight-medium;
        font-size: 14px;
        line-height: 1.43;
        color: $text-muted;
        border-radius: 50%;
        cursor: pointer;
        transition: all 0.2s ease;

        &:hover:not(.active) {
          background: lighten($background-card, 2%);
        }

        &.active {
          background: $background-secondary;
          color: $text-secondary;
        }
      }
    }
  }
}

@media (max-width: $breakpoint-lg) {
  .transactions-card {
    .table-container {
      .transactions-table {
        thead th,
        tbody td {
          padding: 12px 12px 12px 0;
        }
      }
    }
  }
}

@media (max-width: $breakpoint-md) {
  .transactions-card {
    .table-container {
      .transactions-table {
        thead {
          display: none;
        }

        tbody {
          tr {
            display: flex;
            flex-direction: column;
            gap: $spacing-md;
            padding: $spacing-lg;
            border: 1px solid $border-secondary;
            border-radius: $border-radius-md;
            margin-bottom: $spacing-md;
            background: $background-card;

            &:last-child {
              margin-bottom: 0;
            }

            td {
              padding: 0;
              border: none;
              display: block;

              &.date-cell {
                order: 1;
                font-size: $font-size-xs;
                color: $text-muted;
              }

              &.transaction-cell {
                order: 2;

                .transaction-info {
                  gap: $spacing-md;

                  .avatar {
                    width: 48px;
                    height: 48px;

                    img {
                      width: 28px;
                      height: 28px;
                    }

                    .avatar-text {
                      font-size: $font-size-lg;
                    }
                  }

                  .transaction-name {
                    font-size: $font-size-base;
                    font-weight: $font-weight-semibold;
                  }
                }
              }

              &.amount-cell {
                order: 3;

                .amount {
                  font-size: $font-size-lg;
                  font-weight: $font-weight-semibold;
                }
              }

              &.category-cell {
                order: 4;

                .category-badge {
                  display: inline-flex;
                  padding: 4px 8px;

                  .category-text {
                    font-size: $font-size-sm;
                  }
                }
              }

              &.card-cell {
                order: 5;

                .card-info {
                  gap: $spacing-md;

                  .card-icon {
                    width: 52px;
                    height: 36px;
                  }

                  .card-details {
                    gap: 4px;

                    .card-number {
                      font-size: $font-size-base;
                      font-weight: $font-weight-semibold;
                    }

                    .card-expiry {
                      font-size: $font-size-sm;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    .pagination-container {
      flex-direction: column;
      gap: $spacing-lg;
    }
  }
}

@media (max-width: $breakpoint-sm) {
  .transactions-card {
    .table-container {
      .transactions-table {
        tbody {
          tr {
            padding: $spacing-md;

            td {
              &.transaction-cell {
                .transaction-info {
                  flex-direction: column;
                  align-items: flex-start;
                  gap: $spacing-sm;
                  text-align: center;

                  .avatar {
                    align-self: center;
                  }
                }
              }

              &.card-cell {
                .card-info {
                  flex-direction: column;
                  align-items: flex-start;
                  gap: $spacing-sm;
                  text-align: center;

                  .card-icon {
                    align-self: center;
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
</style>
