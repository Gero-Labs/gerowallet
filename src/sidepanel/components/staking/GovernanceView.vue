<template>
  <div class="governance-view">
    <!-- Current Delegation Info -->
    <div class="governance-info-card mb-3">
      <div class="info-header">
        <span class="text-caption grey--text text--lighten-1">Your DRep ID</span>
      </div>
      <div class="drep-id-row" v-if="drepId">
        <span class="text-caption white--text">{{ truncate(drepId) }}</span>
        <v-btn icon x-small class="ml-1" @click="copyToClipboard(drepId)">
          <v-icon x-small color="grey">mdi-content-copy</v-icon>
        </v-btn>
      </div>
      <div v-else class="text-caption grey--text">No DRep ID available</div>

      <div class="info-links mt-2">
        <a href="https://gov.tools/" target="_blank" class="gov-link">
          <v-icon x-small :color="primaryColor" class="mr-1">mdi-open-in-new</v-icon>
          <span class="text-caption">Governance Tools</span>
        </a>
        <a href="https://www.1694.io/en" target="_blank" class="gov-link">
          <v-icon x-small :color="primaryColor" class="mr-1">mdi-open-in-new</v-icon>
          <span class="text-caption">CIP-1694</span>
        </a>
      </div>
    </div>

    <!-- Quick Delegation -->
    <div class="quick-delegate mb-3">
      <v-select
        v-model="delegationModel"
        :items="delegationOptions"
        outlined
        dense
        hide-details
        placeholder="Quick delegate..."
        class="delegation-select"
        attach
        dark
      />
      <v-btn
        small
        class="delegate-action-btn ml-2"
        :disabled="!delegationModel || delegateLoading"
        :loading="delegateLoading"
        @click="quickDelegate"
      >
        Delegate
      </v-btn>
    </div>

    <!-- Search DReps -->
    <v-text-field
      v-model="search"
      dense
      outlined
      hide-details
      placeholder="Search DReps..."
      prepend-inner-icon="mdi-magnify"
      clearable
      class="drep-search mb-3"
      dark
    />

    <!-- Loading -->
    <div v-if="loading" class="text-center py-6">
      <v-progress-circular indeterminate :color="primaryColor" size="32" width="3" />
      <div class="grey--text text-caption mt-2">Loading DReps...</div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="text-center py-6">
      <v-icon color="error" class="mb-2">mdi-alert-circle-outline</v-icon>
      <div class="grey--text text-caption">{{ error }}</div>
      <v-btn x-small text :color="primaryColor" class="mt-2" @click="loadDReps(1)">Retry</v-btn>
    </div>

    <!-- DRep List -->
    <div v-else class="drep-list">
      <div v-if="drepsList.length === 0" class="text-center py-6">
        <v-icon color="grey" class="mb-2">mdi-account-group-outline</v-icon>
        <div class="grey--text text-caption">No DReps found</div>
      </div>

      <div
        v-for="drep in drepsList"
        :key="drep.id"
        class="drep-item"
        @click="selectDRep(drep)"
      >
        <div class="drep-item-left">
          <v-avatar size="28" rounded class="mr-2" v-if="drep.image">
            <v-img :src="drep.image" contain />
          </v-avatar>
          <v-avatar size="28" rounded class="mr-2 drep-avatar-placeholder" v-else>
            <v-icon small color="grey">mdi-account</v-icon>
          </v-avatar>
          <div class="drep-info">
            <div class="drep-name">{{ drep.name }}</div>
            <div class="text-caption grey--text">{{ truncate(drep.id) }}</div>
          </div>
        </div>
        <div class="drep-item-right">
          <div class="drep-voting-power">{{ formatVotingPower(drep.voting_power) }}</div>
          <div class="text-caption grey--text">{{ drep.delegators }} del.</div>
        </div>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="pagination-row">
        <v-btn
          icon
          x-small
          :disabled="currentPage <= 1 || loading"
          @click="loadDReps(currentPage - 1)"
        >
          <v-icon small>mdi-chevron-left</v-icon>
        </v-btn>
        <span class="text-caption grey--text">{{ currentPage }} / {{ totalPages }}</span>
        <v-btn
          icon
          x-small
          :disabled="currentPage >= totalPages || loading"
          @click="loadDReps(currentPage + 1)"
        >
          <v-icon small>mdi-chevron-right</v-icon>
        </v-btn>
      </div>
    </div>

    <!-- DRep Delegate Bottom Sheet -->
    <BottomSheet
      v-model="showDRepSheet"
      title="Delegate to DRep"
      height="40%"
    >
      <div v-if="selectedDRep" class="delegate-confirm">
        <div class="confirm-drep-info">
          <div class="d-flex align-center mb-2">
            <v-avatar size="32" rounded class="mr-2" v-if="selectedDRep.image">
              <v-img :src="selectedDRep.image" contain />
            </v-avatar>
            <div>
              <div class="text-subtitle-2 white--text font-weight-bold">{{ selectedDRep.name }}</div>
              <div class="text-caption grey--text">{{ truncate(selectedDRep.id) }}</div>
            </div>
          </div>
          <div class="d-flex justify-space-between mb-1">
            <span class="text-caption grey--text">Voting Power</span>
            <span class="text-caption white--text">{{ formatVotingPower(selectedDRep.voting_power) }}</span>
          </div>
          <div class="d-flex justify-space-between mb-1">
            <span class="text-caption grey--text">Delegators</span>
            <span class="text-caption white--text">{{ selectedDRep.delegators }}</span>
          </div>
        </div>

        <v-btn
          block
          class="mt-4 delegate-btn"
          :loading="drepDelegating"
          @click="confirmDRepDelegate"
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
import governanceStoreActions, { governanceStore as governanceStoreState } from '@/stores/governanceStore';
import filtersUtil from '@/shared/utils/filters';
import networks from '@/utils/networks';
import snackbar from '@/plugins/snackbar';
import BottomSheet from '../../components/BottomSheet.vue';
import { useChainContext } from '../../composables/useChainContext';
import debounce from 'lodash/debounce';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const { truncate, toCurrency } = filtersUtil;

const { loggedWallet, account, keys } = toRefs(walletStore);

const {
  dreps: governanceDReps,
  loading,
  error,
  paginationMeta,
} = toRefs(governanceStoreState);

const search = ref('');
const currentPage = ref(1);
const showDRepSheet = ref(false);
const selectedDRep = ref<any>(null);
const drepDelegating = ref(false);
const delegateLoading = ref(false);
const delegationModel = ref<string | undefined>(undefined);

const delegationOptions = ['Abstain', 'No Confidence'];

const drepId = computed(() => keys.value?.drep129?.[0]?.address);

const currencySymbol = computed(() => {
  return networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network);
});

const totalPages = computed(() => {
  return paginationMeta.value?.total_pages || 1;
});

const formatVotingPower = (amount: number) => {
  if (!amount) return `${currencySymbol.value}0`;
  return toCurrency(amount, false, 2, currencySymbol.value, '', true);
};

const drepsList = computed(() => {
  if (!governanceDReps.value?.length) return [];

  return governanceDReps.value.map(drep => {
    let name = 'N/A';
    const meta = drep.metadata?.meta_json?.body?.givenName;
    if (meta) {
      name = meta['@value'] || meta;
    }
    let image;
    if (drep.metadata?.meta_json?.body?.image?.contentUrl) {
      image = drep.metadata.meta_json.body.image.contentUrl;
    }
    return {
      id: drep.drep_id,
      name,
      image,
      delegators: drep.delegators?.length || 0,
      votes: drep.votes?.length || 0,
      voting_power: Number(drep.amount || 0),
      hex: drep.hex,
      has_script: drep.has_script,
    };
  });
});

const loadDReps = async (page: number = 1) => {
  if (!loggedWallet.value) return;
  currentPage.value = page;

  await governanceStoreActions.loadDRepsPaginated(loggedWallet.value, {
    page,
    per_page: 15,
    search: search.value,
    sort_by: 'voting_power',
    sort_direction: 'desc',
  });
};

const debouncedSearch = debounce(() => {
  currentPage.value = 1;
  loadDReps(1);
}, 500);

watch(search, () => {
  debouncedSearch();
});

const selectDRep = (drep: any) => {
  selectedDRep.value = drep;
  showDRepSheet.value = true;
};

const confirmDRepDelegate = async () => {
  if (!selectedDRep.value) return;
  drepDelegating.value = true;

  try {
    showDRepSheet.value = false;

    // Navigate to full dashboard for transaction signing
    const optionsUrl = chrome.runtime.getURL('index.html#/governance');
    chrome.tabs.create({ url: optionsUrl });
  } catch (err: any) {
    console.error('Error delegating to DRep:', err);
    snackbar.setError('Failed to initiate delegation');
  } finally {
    drepDelegating.value = false;
  }
};

const quickDelegate = async () => {
  if (!delegationModel.value) return;
  delegateLoading.value = true;

  try {
    // Open full dashboard for signing
    const optionsUrl = chrome.runtime.getURL('index.html#/governance');
    chrome.tabs.create({ url: optionsUrl });
  } catch (err: any) {
    console.error('Error with quick delegation:', err);
    snackbar.setError('Failed to initiate delegation');
  } finally {
    delegateLoading.value = false;
  }
};

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text).catch(() => {});
};

onMounted(async () => {
  await loadDReps(1);

  // Load current DRep info
  if (account.value?.drep_id) {
    await governanceStoreActions.loadDRepById(loggedWallet.value, account.value.drep_id);
  }
});
</script>

<style scoped>
.governance-info-card {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 12px 14px;
}

.info-header {
  margin-bottom: 4px;
}

.drep-id-row {
  display: flex;
  align-items: center;
}

.info-links {
  display: flex;
  gap: 16px;
}

.gov-link {
  display: flex;
  align-items: center;
  color: var(--chain-primary);
  text-decoration: none;
  font-size: 12px;
}

.gov-link:hover {
  text-decoration: underline;
}

.quick-delegate {
  display: flex;
  align-items: center;
}

.delegation-select {
  flex: 1;
}

.delegation-select >>> .v-input__slot {
  background: rgba(255, 255, 255, 0.04) !important;
  min-height: 36px !important;
}

.delegation-select >>> .v-input__slot fieldset {
  border-color: rgba(255, 255, 255, 0.08) !important;
}

.delegate-action-btn {
  background: transparent !important;
  color: #fff !important;
  font-weight: 600;
  text-transform: none;
  height: 36px !important;
  border-radius: 8px;
}

.delegate-action-btn.v-btn--disabled {
  color: #fff !important;
}

.drep-search >>> .v-input__slot {
  background: rgba(255, 255, 255, 0.04) !important;
  min-height: 36px !important;
}

.drep-search >>> .v-input__slot fieldset {
  border-color: rgba(255, 255, 255, 0.08) !important;
}

.drep-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: calc(100vh - 420px);
  overflow-y: auto;
}

.drep-item {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: background 0.15s ease;
}

.drep-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.drep-item-left {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.drep-avatar-placeholder {
  background: rgba(255, 255, 255, 0.06);
}

.drep-info {
  min-width: 0;
  overflow: hidden;
}

.drep-name {
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drep-item-right {
  text-align: right;
  flex-shrink: 0;
  margin-left: 8px;
}

.drep-voting-power {
  color: var(--chain-primary);
  font-size: 12px;
  font-weight: 600;
}

.pagination-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 0 4px;
}

/* Delegate confirmation */
.confirm-drep-info {
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
