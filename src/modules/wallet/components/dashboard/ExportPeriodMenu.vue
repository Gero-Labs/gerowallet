<template>
  <div>
    <!-- Export CSV Button with Period Selection -->
    <v-menu
      v-model="exportMenu"
      :close-on-content-click="false"
      transition="scale-transition"
      offset-y
    >
      <template v-slot:activator="{ on, attrs }">
        <v-btn
          x-small
          outlined
          class="export-csv-btn"
          :disabled="props.disabled"
          v-bind="attrs"
          v-on="on"
        >
          <v-icon small left>mdi-download</v-icon>
          {{ t('card.exportCSV') }}
        </v-btn>
      </template>
      <v-card class="export-menu-card">
        <v-card-title class="export-menu-title">
          {{ t('card.selectExportPeriod') }}
        </v-card-title>
        <v-card-text class="export-menu-content">
          <div class="export-period-options">
            <div class="export-quick-buttons">
              <v-btn
                v-for="option in quickDateOptions"
                :key="option.key"
                outlined
                class="export-period-btn"
                @click="handleQuickPeriod(option.key)"
              >
                <v-icon small left>mdi-calendar-clock</v-icon>
                {{ option.label }}
              </v-btn>
            </div>
            <v-btn
              block
              outlined
              class="export-period-btn export-custom-btn"
              @click="handleCustomPeriod"
            >
              <v-icon small left>mdi-calendar-range</v-icon>
              {{ t('card.customDateRange') }}
            </v-btn>
          </div>
        </v-card-text>
      </v-card>
    </v-menu>

    <!-- Custom Export Date Range Picker -->
    <v-dialog
      v-model="exportDatePickerMenu"
      :close-on-content-click="false"
      max-width="600px"
      persistent
      content-class="export-date-range-dialog"
    >
      <v-card class="export-date-range-card">
        <v-card-title class="export-date-range-title">
          {{ t('card.selectExportDateRange') }}
        </v-card-title>
        <v-card-text>
          <div class="date-range-picker">
            <v-row>
              <v-col cols="12" sm="6">
                <v-menu
                  v-model="startDateMenu"
                  :close-on-content-click="false"
                  transition="scale-transition"
                  offset-y
                  max-width="290px"
                >
                  <template v-slot:activator="{ on, attrs }">
                    <v-text-field
                      v-model="formattedStartDate"
                      :label="t('card.from')"
                      prepend-inner-icon="mdi-calendar"
                      readonly
                      outlined
                      dense
                      v-bind="attrs"
                      v-on="on"
                    ></v-text-field>
                  </template>
                  <v-date-picker
                    v-model="startDate"
                    :max="maxDate"
                    :min="minDate"
                    @input="onStartDateChange"
                  ></v-date-picker>
                </v-menu>
              </v-col>
              <v-col cols="12" sm="6">
                <v-menu
                  v-model="endDateMenu"
                  :close-on-content-click="false"
                  transition="scale-transition"
                  offset-y
                  max-width="290px"
                >
                  <template v-slot:activator="{ on, attrs }">
                    <v-text-field
                      v-model="formattedEndDate"
                      :label="t('card.to')"
                      prepend-inner-icon="mdi-calendar"
                      readonly
                      outlined
                      dense
                      v-bind="attrs"
                      v-on="on"
                    ></v-text-field>
                  </template>
                  <v-date-picker
                    v-model="endDate"
                    :max="maxDate"
                    :min="startDate || minDate"
                    @input="onEndDateChange"
                  ></v-date-picker>
                </v-menu>
              </v-col>
            </v-row>
            <div v-if="dateRangeError" class="error-message mt-2">
              {{ dateRangeError }}
            </div>
          </div>
        </v-card-text>
        <v-card-actions class="export-date-range-actions">
          <v-spacer></v-spacer>
          <v-btn outlined small class="export-dialog-close-btn" @click="exportDatePickerMenu = false">
            {{ t('card.close') }}
          </v-btn>
          <v-btn small class="export-dialog-export-btn" @click="applyCustomExportDateRange">
            {{ t('card.export') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import cardStore from '@/stores/modules/card';

interface Props {
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
});

const { t } = useTranslation();

// Quick date options
const quickDateOptions = computed(() => [
  { key: '24H', label: '24H', days: 1 },
  { key: '7D', label: '7D', days: 7 },
  { key: '30D', label: '30D', days: 30 },
  { key: '90D', label: '90D', days: 88 }, // cause kaiserex has max 89 days limit (+- day)
]);

// Menu state
const exportMenu = ref(false);
const exportDatePickerMenu = ref(false);
const startDateMenu = ref(false);
const endDateMenu = ref(false);
const startDate = ref<string>('');
const endDate = ref<string>('');
const dateRangeError = ref<string | null>(null);

// Date limits (3 months max)
const maxDate = computed(() => {
  const date = new Date();
  return date.toISOString().split('T')[0];
});

const minDate = computed(() => {
  const date = new Date();
  date.setMonth(date.getMonth() - 3);
  return date.toISOString().split('T')[0];
});

// Format date for display
const formattedStartDate = computed(() => {
  if (!startDate.value) return '';
  const date = new Date(startDate.value);
  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
});

const formattedEndDate = computed(() => {
  if (!endDate.value) return '';
  const date = new Date(endDate.value);
  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
});

// Format date for API (dd.mm.yyyy)
const formatDateForAPI = (date: Date): string => {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
};

// Handle start date change
const onStartDateChange = (date: string) => {
  startDate.value = date;
  startDateMenu.value = false;
  validateDateRange();
};

// Handle end date change
const onEndDateChange = (date: string) => {
  endDate.value = date;
  endDateMenu.value = false;
  validateDateRange();
};

// Validate date range (3 months max)
const validateDateRange = () => {
  dateRangeError.value = null;

  if (!startDate.value || !endDate.value) {
    return;
  }

  const start = new Date(startDate.value);
  const end = new Date(endDate.value);

  // Check if start is after end
  if (start > end) {
    dateRangeError.value = t('card.startDateAfterEndDate');
    return;
  }

  // Validate 3 months limit
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  if (start < threeMonthsAgo) {
    dateRangeError.value = t('card.dateRangeExceeds3Months');
    return;
  }

  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const maxDays = 90; // 3 months

  if (diffDays > maxDays) {
    dateRangeError.value = t('card.dateRangeExceeds3Months');
    return;
  }
};

// Handle quick period selection
const handleQuickPeriod = async (key: string) => {
  exportMenu.value = false;

  const option = quickDateOptions.value.find(opt => opt.key === key);
  if (!option) return;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - option.days);

  // Validate 3 months limit
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  if (start < threeMonthsAgo) {
    start.setTime(threeMonthsAgo.getTime());
  }

  await exportToCSV(start, end);
};

// Handle custom period
const handleCustomPeriod = () => {
  exportMenu.value = false;
  // Reset dates for export
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  endDate.value = end.toISOString().split('T')[0];
  startDate.value = start.toISOString().split('T')[0];
  dateRangeError.value = null;
  // Open export date picker menu
  setTimeout(() => {
    exportDatePickerMenu.value = true;
  }, 100);
};

// Apply custom export date range
const applyCustomExportDateRange = async () => {
  if (dateRangeError.value) {
    return;
  }

  if (startDate.value && endDate.value) {
    const start = new Date(startDate.value);
    const end = new Date(endDate.value);
    exportDatePickerMenu.value = false;
    await exportToCSV(start, end);
  }
};

// Parse European date format DD.MM.YYYY HH:mm
const parseEuropeanDate = (dateStr: string): Date => {
  const [datePart, timePart] = dateStr.split(' ');
  const [day, month, year] = datePart.split('.');
  const [hours, minutes] = timePart.split(':');
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hours), parseInt(minutes));
};

const resolveCurrencySymbol = (currencyName: string) => {
  switch (currencyName) {
    case 'EUR':
    default:
      return '€';
  }
};

// Get category from MCC code
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

// Export to CSV
const exportToCSV = async (startDate: Date, endDate: Date) => {
  try {
    const params = {
      periodFrom: formatDateForAPI(startDate),
      periodTo: formatDateForAPI(endDate),
      page: 1,
      size: 10000, // Fetch all transactions for export
    };

    const exportTransactions = await cardStore.fetchCardHistoryForExport(params);

    if (exportTransactions.length === 0) {
      console.warn('No transactions to export');
      return;
    }

    const headers = [
      t('card.dateTime'),
      t('card.category'),
      t('card.transaction'),
      t('card.reference'),
      t('card.amount'),
    ];

    const rows = exportTransactions.map(tx => {
      const merchantName = tx.narrative || 'Unknown';
      const category = getCategoryFromMCC(tx.mcc.code);
      const amount = tx.amount.amount;
      const currency = resolveCurrencySymbol(tx.amount.currencyCode);
      const date = parseEuropeanDate(tx.createTime);
      const dateTime = date.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });

      return [dateTime, category, merchantName, tx.reference, `${amount} ${currency}`];
    });

    const csvContent = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const urlObj = URL.createObjectURL(blob);
    link.setAttribute('href', urlObj);

    const startStr = formatDateForAPI(startDate).replace(/\./g, '-');
    const endStr = formatDateForAPI(endDate).replace(/\./g, '-');
    link.setAttribute('download', `transactions_${startStr}_to_${endStr}.csv`);

    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(urlObj);
  } catch (error) {
    console.error('Failed to export CSV:', error);
  }
};
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

:deep(.export-csv-btn) {
  min-width: auto !important;
  padding: 4px 8px !important;
  font-size: 11px !important;
  text-transform: none !important;
  border-color: $border-secondary !important;
  color: $text-secondary !important;

  &:hover {
    background: lighten($background-card, 2%) !important;
    border-color: $border-primary !important;
  }

  &:disabled {
    opacity: 0.5 !important;
    cursor: not-allowed !important;
  }
}

:deep(.export-menu-card) {
  background: $background-card !important;
  border: 1px solid $border-secondary !important;
  min-width: 320px !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
}

:deep(.export-menu-title) {
  font-family: $font-family-primary !important;
  font-weight: $font-weight-bold !important;
  font-size: 13px !important;
  color: #ffffff !important;
  padding: 16px 20px !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
  text-align: center !important;
}

:deep(.export-menu-content) {
  padding: 20px !important;
}

.export-period-options {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.export-quick-buttons {
  display: flex;
  flex-direction: row;
  gap: 8px;
  flex-wrap: wrap;
}

:deep(.export-period-btn) {
  text-transform: uppercase !important;
  font-size: 12px !important;
  font-family: $font-family-primary !important;
  font-weight: $font-weight-semibold !important;
  padding: 12px 20px !important;
  height: auto !important;
  min-height: 44px !important;
  justify-content: center !important;
  border: 1px solid #00c7f3 !important;
  border-color: #00c7f3 !important;
  color: #ffffff !important;
  background: rgba(20, 22, 28, 0.8) !important;
  transition: all 0.2s ease !important;
  border-radius: 6px !important;
  letter-spacing: 0.3px !important;

  &:hover {
    background: rgba(30, 32, 38, 0.95) !important;
    border-color: #00c7f3 !important;
    color: #ffffff !important;
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 199, 243, 0.3);
  }

  &:active {
    transform: translateY(0);
  }

  .v-icon {
    margin-right: 8px !important;
    color: #ffffff !important;
  }
}

:deep(.export-custom-btn) {
  margin-top: 0 !important;
  border-style: dashed !important;
  border: 1px solid #00c7f3 !important;
  border-color: #00c7f3 !important;
  font-size: 11px !important;
  letter-spacing: 0.5px !important;
  padding: 14px 20px !important;

  &:hover {
    border-style: dashed !important;
    border-color: #00c7f3 !important;
    background: rgba(30, 32, 38, 0.95) !important;
  }
}

// Export Date Range Dialog Styles
:deep(.export-date-range-dialog) {
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.export-date-range-card) {
  background: $background-card !important;
  border: 1px solid $border-secondary !important;
}

:deep(.export-date-range-title) {
  font-family: $font-family-primary !important;
  font-weight: $font-weight-semibold !important;
  font-size: $font-size-base !important;
  color: $text-primary !important;
  padding: 20px 24px 16px 24px !important;
  border-bottom: 1px solid $border-secondary !important;
}

:deep(.export-date-range-actions) {
  padding: 16px 24px 20px 24px !important;
  border-top: 1px solid $border-secondary !important;
}

:deep(.export-dialog-close-btn) {
  text-transform: uppercase !important;
  font-size: 12px !important;
  font-weight: $font-weight-medium !important;
  font-family: $font-family-primary !important;
  padding: 8px 20px !important;
  min-width: 80px !important;
  background: rgba(30, 32, 36, 0.9) !important;
  border-color: rgba(255, 255, 255, 0.15) !important;
  color: #ffffff !important;
  border-radius: 4px !important;

  &:hover {
    background: rgba(30, 32, 36, 1) !important;
    border-color: rgba(255, 255, 255, 0.25) !important;
  }
}

:deep(.export-dialog-export-btn) {
  text-transform: uppercase !important;
  font-size: 12px !important;
  font-weight: $font-weight-medium !important;
  font-family: $font-family-primary !important;
  padding: 8px 20px !important;
  min-width: 80px !important;
  background: #00c7f3 !important;
  color: #ffffff !important;
  border-radius: 4px !important;
  box-shadow: none !important;

  &:hover {
    background: #00b0d9 !important;
    box-shadow: 0 2px 8px rgba(0, 199, 243, 0.3) !important;
  }

  &:active {
    background: #0099bf !important;
  }
}

.date-range-picker {
  .error-message {
    color: var(--v-error-base);
    font-size: 12px;
    padding: 8px;
    background: rgba(244, 67, 54, 0.1);
    border-radius: 4px;
    border: 1px solid var(--v-error-base);
  }
}
</style>
