<template>
  <div class="pool-list-view">
    <!-- Search -->
    <v-text-field
      v-model="search"
      dense
      outlined
      hide-details
      placeholder="Search pools..."
      prepend-inner-icon="mdi-magnify"
      clearable
      class="pool-search mb-3"
      dark
    />

    <!-- Filter toggles -->
    <div class="d-flex mb-2" style="gap: 12px;">
      <v-switch
        v-model="hideSaturated"
        dense
        hide-details
        class="mt-0 pt-0 filter-switch"
      >
        <template v-slot:label>
          <span class="text-caption grey--text text--lighten-1">Hide saturated</span>
        </template>
      </v-switch>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-6">
      <v-progress-circular indeterminate :color="primaryColor" size="32" width="3" />
      <div class="grey--text text-caption mt-2">Loading pools...</div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="text-center py-6">
      <v-icon color="error" class="mb-2">mdi-alert-circle-outline</v-icon>
      <div class="grey--text text-caption">{{ error }}</div>
      <v-btn x-small text :color="primaryColor" class="mt-2" @click="loadPools(1)">Retry</v-btn>
    </div>

    <!-- Pool List -->
    <div v-else class="pool-list">
      <div v-if="pools.length === 0" class="text-center py-6">
        <v-icon color="grey" class="mb-2">mdi-database-off-outline</v-icon>
        <div class="grey--text text-caption">No pools found</div>
      </div>

      <div
        v-for="pool in pools"
        :key="pool.pool_id_bech32 || pool.pool_id"
        class="pool-item"
        @click="selectPool(pool)"
      >
        <div class="pool-item-header">
          <div class="pool-name-section">
            <span class="pool-ticker">[{{ pool.ticker }}]</span>
            <span class="pool-name ml-1">{{ pool.name || '' }}</span>
          </div>
          <div class="pool-ros">
            <span class="ros-value">{{ pool.ros ? pool.ros.toFixed(2) : '0.00' }}%</span>
            <span class="ros-label">ROA</span>
          </div>
        </div>

        <div class="pool-item-details">
          <div class="saturation-section">
            <v-progress-linear
              rounded
              :color="getColor(pool.live_saturation)"
              height="6"
              :value="pool.live_saturation"
              class="saturation-bar"
            />
            <span class="text-caption grey--text">{{ Math.ceil(pool.live_saturation || 0) }}%</span>
          </div>
          <div class="pool-meta">
            <span class="text-caption grey--text">
              {{ pool.live_delegators ? pool.live_delegators.toLocaleString('en-US') : '0' }} delegators
            </span>
          </div>
        </div>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="pagination-row">
        <v-btn
          icon
          x-small
          :disabled="page <= 1 || loading"
          @click="loadPools(page - 1)"
        >
          <v-icon small>mdi-chevron-left</v-icon>
        </v-btn>
        <span class="text-caption grey--text">{{ page }} / {{ totalPages }}</span>
        <v-btn
          icon
          x-small
          :disabled="page >= totalPages || loading"
          @click="loadPools(page + 1)"
        >
          <v-icon small>mdi-chevron-right</v-icon>
        </v-btn>
      </div>
    </div>

    <!-- Delegate Confirmation Bottom Sheet -->
    <BottomSheet
      v-model="showDelegateSheet"
      title="Delegate to Pool"
      height="45%"
    >
      <div v-if="selectedPool" class="delegate-confirm">
        <div class="confirm-pool-info">
          <div class="text-subtitle-1 white--text font-weight-bold mb-1">
            [{{ selectedPool.ticker }}] {{ selectedPool.name }}
          </div>
          <div class="d-flex justify-space-between mb-1">
            <span class="text-caption grey--text">ROA</span>
            <span class="text-caption white--text">{{ selectedPool.ros ? selectedPool.ros.toFixed(2) : '0.00' }}%</span>
          </div>
          <div class="d-flex justify-space-between mb-1">
            <span class="text-caption grey--text">Saturation</span>
            <span class="text-caption white--text">{{ Math.ceil(selectedPool.live_saturation || 0) }}%</span>
          </div>
          <div class="d-flex justify-space-between mb-1">
            <span class="text-caption grey--text">Fees</span>
            <span class="text-caption white--text">{{ selectedPool.margin }}% / {{ formatFee(selectedPool) }}</span>
          </div>
        </div>

        <v-btn
          block
          class="mt-4 delegate-btn"
          :loading="delegating"
          @click="confirmDelegate"
        >
          Confirm Delegation
        </v-btn>
      </div>
    </BottomSheet>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, watch, onMounted } from 'vue';
import { walletStore } from '@/stores/walletStore';
import stakingStoreActions, { stakingStore as stakingStoreState } from '@/stores/stakingStore';
import { useDelegation } from '@/shared/composables/useDelegation';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import BottomSheet from '../../components/BottomSheet.vue';
import { useChainContext } from '../../composables/useChainContext';
import debounce from 'lodash/debounce';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const { loggedWallet } = toRefs(walletStore);

const {
  pools,
  paginationMeta,
  loading,
  error,
} = toRefs(stakingStoreState);

const { delegate } = useDelegation();

const search = ref('');
const hideSaturated = ref(true);
const page = ref(1);
const showDelegateSheet = ref(false);
const selectedPool = ref<any>(null);
const delegating = ref(false);

const totalPages = computed(() => {
  return paginationMeta.value?.total_pages || 1;
});

const getColor = (value: number) => {
  return filters.getColor(value);
};

const currencySymbol = computed(() => {
  return networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network);
});

const formatFee = (pool: any) => {
  if (!pool?.fixed_cost) return '0';
  return filters.toCurrency(pool.fixed_cost, false, 0, currencySymbol.value);
};

const loadPools = async (pageNum: number = 1) => {
  if (!loggedWallet.value) return;
  page.value = pageNum;

  await stakingStoreActions.loadPoolsPaginated(loggedWallet.value, {
    page: pageNum,
    per_page: 10,
    search: search.value,
    hide_saturated: hideSaturated.value,
    sort_by: 'ros',
    sort_direction: 'desc',
  });
};

const debouncedSearch = debounce(() => {
  page.value = 1;
  loadPools(1);
}, 500);

watch(search, () => {
  debouncedSearch();
});

watch(hideSaturated, () => {
  page.value = 1;
  loadPools(1);
});

const selectPool = (pool: any) => {
  selectedPool.value = pool;
  showDelegateSheet.value = true;
};

const confirmDelegate = async () => {
  if (!selectedPool.value) return;
  delegating.value = true;

  try {
    await delegate(selectedPool.value);
    showDelegateSheet.value = false;
  } catch (e) {
    console.error('Delegation error:', e);
  } finally {
    delegating.value = false;
  }
};

onMounted(() => {
  loadPools(1);
});
</script>

<style scoped>
.pool-search {
  border-radius: 10px;
}

.pool-search >>> .v-input__slot {
  background: rgba(255, 255, 255, 0.04) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
  min-height: 36px !important;
}

.pool-search >>> .v-input__slot fieldset {
  border-color: rgba(255, 255, 255, 0.08) !important;
}

.filter-switch >>> .v-input--switch__track {
  opacity: 0.4;
}

.pool-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: calc(100vh - 320px);
  overflow-y: auto;
}

.pool-item {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.pool-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.pool-item-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 6px;
}

.pool-name-section {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pool-ticker {
  color: var(--chain-primary);
  font-size: 13px;
  font-weight: 600;
}

.pool-name {
  color: #ccc;
  font-size: 13px;
}

.pool-ros {
  text-align: right;
  flex-shrink: 0;
  margin-left: 8px;
}

.ros-value {
  color: #47cd89;
  font-size: 14px;
  font-weight: 600;
}

.ros-label {
  color: #666;
  font-size: 10px;
  margin-left: 2px;
}

.pool-item-details {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.saturation-section {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  max-width: 180px;
}

.saturation-bar {
  flex: 1;
}

.pool-meta {
  flex-shrink: 0;
}

.pagination-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 0 4px;
}

/* Delegate confirmation */
.confirm-pool-info {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 14px;
}

.delegate-btn {
  background: linear-gradient(135deg, var(--chain-gradient1), var(--chain-gradient2)) !important;
  color: #000 !important;
  font-weight: 600;
  text-transform: none;
  border-radius: 10px;
  height: 44px !important;
}
</style>
