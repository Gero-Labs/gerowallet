<template>
  <v-card outlined class="no-gutters fill-height liquid-glass" :loading="loadingTxs">
    <v-card-title class="token-allocation-title" ref="headerRef">
      {{ $t('assets.tokenHoldings') }}
      <!-- Top-level search box -->
      <v-text-field
        v-model="searchTerm"
        dense
        flat
        solo
        hide-details
        :placeholder="currentTab === 0 ? $t('assets.searchAssets') : $t('assets.searchCollections')"
        prepend-inner-icon="mdi-magnify"
        clearable
        style="max-width: 200px; margin-left: 16px;"
        class="top-level-search"
      ></v-text-field>
      <v-spacer />
      <v-menu
        v-if="loggedWallet?.chain === Blockchain.CARDANO && loggedWallet?.network === Network.MAINNET"
        v-model="filtersMenu"
        :close-on-content-click="false"
        offset-y
        eager
        transition="none"
      >
        <template v-slot:activator="{ on, attrs }">
          <v-badge
            :value="filtersAmount"
            :content="filtersAmount"
            bordered
            color="primary"
            dot
            overlap
          >
            <v-btn
              icon
              plain
              v-bind="attrs"
              v-on="on"
            >
              <v-icon>
                mdi-filter
              </v-icon>
            </v-btn>
          </v-badge>
        </template>
        <v-card outlined class="liquid-glass-dialog" style="border: 1px solid rgba(255, 255, 255, 0.15) !important;">
          <v-card-text class="pa-0">
            <div class="filter-header px-3 py-2" style="background-color: rgba(255, 255, 255, 0.05); border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
              <div class="text-caption" style="color: #00c7f3; font-weight: 600;">
                {{ currentTab === 0 ? $t('assets.assetsFilters') : $t('assets.collectiblesFilters') }}
              </div>
            </div>
            <v-list dense class="transparent">
              <v-list-item v-if="loggedWallet?.chain === Blockchain.CARDANO && loggedWallet?.network === Network.MAINNET && currentTab === 0">
                <v-list-item-action>
                  <v-switch v-model="hideUnverified" inset dense class="mr-5 mt-0" hide-details/>
                </v-list-item-action>
                <v-list-item-title>
                  {{ $t('assets.hideUnverifiedTokens') }}
                </v-list-item-title>
              </v-list-item>
              <v-list-item>
                <v-list-item-action>
                  <v-switch v-model="hideScam" inset dense class="mr-5 mt-0" hide-details v-if="loggedWallet?.chain === Blockchain.CARDANO && loggedWallet?.network === Network.MAINNET && currentTab === 0"/>
                  <v-switch v-model="hideScam" inset dense class="mr-5 mt-0" hide-details v-if="currentTab === 1"/>
                </v-list-item-action>
                <v-list-item-title>
                  {{ currentTab === 0 ? $t('assets.hideScamTokens') : $t('assets.hideScamCollectibles') }}
                </v-list-item-title>
              </v-list-item>
              <v-list-item v-if="currentTab === 0">
                <v-list-item-action>
                  <v-switch v-model="hideUnrated" inset dense class="mr-5 mt-0" hide-details v-if="loggedWallet?.chain === Blockchain.CARDANO && loggedWallet?.network === Network.MAINNET"/>
                </v-list-item-action>
                <v-list-item-title>
                  {{ $t('assets.hideUnratedTokens') }}
                </v-list-item-title>
              </v-list-item>
              <v-list-item v-if="currentTab === 1">
                <v-list-item-content>
                  <v-list-item-title>{{ $t('assets.sortBy') }}</v-list-item-title>
                  <v-select
                    v-model="collectiblesSortBy"
                    :items="collectiblesSortOptions"
                    dense
                    outlined
                    hide-details
                    style="margin-top: 8px; max-width: 158px;"
                    class="sort-select-small"
                  ></v-select>
                </v-list-item-content>
              </v-list-item>
            </v-list>
            <v-divider></v-divider>
          </v-card-text>
          <v-card-actions class="justify-center">
            <v-btn block small color="error" :disabled="filtersAmount === 0" @click="clearFilters">
              <v-icon small class="pr-1">
                mdi-filter-remove
              </v-icon>
              {{ $t('assets.clearFilters') }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-menu>
      <v-tabs class="ml-1 responsive-tabs" @change="handleSwitchTab" height="30" style="flex: 0 1 auto;width: unset;border-radius: 10px" background-color="transparent">
        <v-tab class="responsive-tab">
          <v-icon class="tab-icon" :class="{ 'd-none': !useIconMode }">mdi-chart-line</v-icon>
          <span class="tab-text" :class="{ 'd-none': useIconMode }">{{ $t('assets.assets') }}</span>
          <span class="tab-count" style="color: white">&nbsp;{{ `(${tokensCount})` }}</span>
        </v-tab>
        <v-tab class="responsive-tab" :disabled="collectiblesLength === 0">
          <v-icon class="tab-icon" :class="{ 'd-none': !useIconMode }">mdi-image-multiple</v-icon>
          <span class="tab-text" :class="{ 'd-none': useIconMode }">{{ $t('assets.collectibles') }}</span>
          <span class="tab-count" style="color: white">&nbsp;{{`(${collectiblesLength})`}}</span>
        </v-tab>
      </v-tabs>
    </v-card-title>
    <v-card-text class="pa-0">
      <v-tabs-items v-model="currentTab" class="transparent">
        <v-tab-item>
          <TokensTab
            :sort-options="sortOptions"
            @update:sort-options="sortOptions = $event"
            :hide-scam="hideScam"
            :hide-unverified="hideUnverified"
            :hide-unrated="hideUnrated"
            :search-term="currentTab === 0 ? searchTerm : ''"
            :container-height="sharedContainerHeight"
          />
        </v-tab-item>
        <v-tab-item>
          <CollectiblesTab
            :hide-scam="hideScam"
            :search-term="currentTab === 1 ? searchTerm : ''"
            :sort-by="collectiblesSortBy"
            :container-height="sharedContainerHeight"
          />
        </v-tab-item>
      </v-tabs-items>
    </v-card-text>
  </v-card>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, toRefs, onMounted, onUnmounted, watch } from 'vue';
import CollectiblesTab from '@/modules/assets/components/CollectiblesTab.vue';
import TokensTab from '@/modules/assets/components/TokensTab.vue';
import { Blockchain, Network } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { loadingState } from '@/stores/loading';
import { setWalletConfiguration } from '@/db/wallet-db';
import WalletStore from '@/stores/walletStore';



const { t } = useTranslation();
const { loggedWallet, config, collections, tokens } = toRefs(walletStore);
const { loadingTxs } = toRefs(loadingState);

const hideScam = ref<boolean>(false);
const hideUnrated = ref<boolean>(false);
const hideUnverified = ref<boolean>(false);
const sortOptions = ref<any>({
  by: 'allocation',
  desc: true
})
const collectiblesSortBy = ref<string>('name');
const filtersMenu = ref<boolean>(false);
const currentTab = ref<number>(0);
const searchTerm = ref<string>('');
const useIconMode = ref<boolean>(false);
const headerRef = ref<HTMLElement | null>(null);

const assetsSort = computed({
  get() {
    return config.value.tokenAllocationSort || {
      by: 'allocation',
      desc: true
    }
  },
  set(val) {
    setWalletConfiguration(loggedWallet.value.id, 'tokenAllocationSort', val)
  },
})

watch(hideScam, (newVal, _oldVal) => {
  WalletStore.setHideScamTokens(newVal);
})

watch(hideUnverified, (newVal, _oldVal) => {
  WalletStore.setHideUnverifiedTokens(newVal);
})

watch(hideUnrated, (newVal, _oldVal) => {
  WalletStore.setHideUnratedTokens(newVal);
})

watch(sortOptions, (newVal, _oldVal) => {
  assetsSort.value = newVal
}, {
  deep: true
})

// Watch for config changes after initial mount
watch(() => config.value, (newConfig) => {
  if (newConfig) {
    hideScam.value = newConfig.hideScamTokens || false;
    hideUnrated.value = newConfig.hideUnratedTokens || false;
    hideUnverified.value = newConfig.hideUnverifiedTokens || false;
  }
}, { immediate: true })

const handleSwitchTab = (tab) => {
  currentTab.value = tab;
  // Clear search when switching tabs
  searchTerm.value = '';
}

const clearFilters = () => {
  hideUnverified.value = false;
  hideScam.value = false;
  hideUnrated.value = false;
}



const filtersAmount = computed(() => {
  let amt = 0
  if (hideScam.value) {
    amt++
  }
  if (hideUnrated.value) {
    amt++
  }
  if (hideUnverified.value) {
    amt++
  }
  return amt
})

const tokensCount = computed(() => {
  return Object.keys(tokens.value).length || 0;
});

const collectiblesLength = computed(() => {
  let amount = 0;
  if (collectibles.value.length > 0) {
    collectibles.value.forEach((collection: any) => {
      if (collection.items) {
        amount += collection.items.length
      }
    })
  }
  return amount
})

// Shared height calculation for both tabs based on their content
const sharedContainerHeight = computed(() => {
  // Calculate the height needed for the asset tab
  const assetsCount = tokensCount.value;
  const assetsRows = Math.min(assetsCount, 6); // Max 6 items per page
  const assetsHeight = (assetsRows * 40); // header + rows

  // Calculate height needed for collectible tab
  const filteredCollectibles = collectibles.value.filter((collection: any) => {
    if (currentTab.value === 1 && searchTerm.value?.trim()) {
      const search = searchTerm.value.toLowerCase().trim();
      const nameMatch = collection.name?.toLowerCase().includes(search);
      const descMatch = collection.description && (
        typeof collection.description === 'string'
          ? collection.description.toLowerCase().includes(search)
          : Array.isArray(collection.description)
            ? collection.description.join(' ').toLowerCase().includes(search)
            : false
      );
      return nameMatch || descMatch;
    }
    return true;
  });

  const collectiblesCount = filteredCollectibles.length;
  let collectiblesHeight: number; // minimum

  // Match collectible height to equivalent asset rows
  // 1 row of collectibles (cards) should equal about 2-3 asset rows in visual height
  if (collectiblesCount === 0) {
    collectiblesHeight = 72; // Minimum (2 asset rows)
  } else if (collectiblesCount <= 7) {
    // 1 row of collectibles = roughly the same as 2-3 asset rows
    // 2 assets = 148 px, 3 assets = 198 px,
    // So 1 row of collectibles should match the asset height when we have 2-3 assets
    collectiblesHeight = 148; // Match 2 asset rows for 1 row of cards
  } else if (collectiblesCount <= 14) {
    // 2 rows of collectibles without pagination
    collectiblesHeight = 298; // Match 5 asset rows
  } else {
    // 2 rows with pagination
    collectiblesHeight = 322; // Match 6 asset rows
  }

  // Use the larger height to ensure no content is cut off
  const maxContentHeight = Math.max(assetsHeight, collectiblesHeight);

  // Ensure a minimum height of 148px (1 asset row)
  return Math.max(72, maxContentHeight);
})


const collectibles = computed(() => {
  let res = Object.values(collections.value).filter((collection: any) => collection.items.every(item => !item.metadata))
  if (res && hideScam.value) {
    res = res.filter((collection: any) => !collection.isScam)
  }
  return res
})

const collectiblesSortOptions = computed(() => [
  { text: t('assets.sortNameAZ'), value: 'name' },
  { text: t('assets.sortNameZA'), value: 'name_desc' },
  { text: t('assets.sortQuantityHighLow'), value: 'quantity_desc' },
  { text: t('assets.sortQuantityLowHigh'), value: 'quantity' }
])

// Simple breakpoint-based responsive detection
const checkHeaderOverflow = () => {
  if (!headerRef.value) return;

  const headerWidth = headerRef.value.offsetWidth;

  // At 800px and below, switch to icons to prevent wrapping
  const shouldUseIconMode = headerWidth <= 788;

  if (useIconMode.value !== shouldUseIconMode) {
    useIconMode.value = shouldUseIconMode;
  }
};

// Debounced version to prevent excessive calls
let checkTimeout: NodeJS.Timeout | null = null;
const debouncedCheck = () => {
  if (checkTimeout) clearTimeout(checkTimeout);
  checkTimeout = setTimeout(checkHeaderOverflow, 100);
};


onMounted(() => {
  sortOptions.value = assetsSort.value;
  hideScam.value = config.value?.hideScamTokens || false;
  hideUnrated.value = config.value?.hideUnratedTokens || false;
  hideUnverified.value = config.value?.hideUnverifiedTokens || false;

  // Set up responsive tab detection
  window.addEventListener('resize', debouncedCheck);
  setTimeout(checkHeaderOverflow, 100);
})

onUnmounted(() => {
  if (checkTimeout) {
    clearTimeout(checkTimeout);
  }
  window.removeEventListener('resize', debouncedCheck);
})

// Watch for content changes that might affect header width
watch([tokensCount, collectiblesLength, searchTerm], debouncedCheck)
</script>
<style scoped>
.badge .v-badge__wrapper {
  margin: 0
}

.token-allocation-title {
  padding-bottom: calc(16px - 4px) !important;
}

.v-data-table.v-data-table tbody tr {
  height: 50px !important;
  max-height: 50px !important;
  min-height: 50px !important;
}

.v-data-table.v-data-table tbody tr td {
  height: 50px !important;
  max-height: 50px !important;
  padding-top: 0px !important;
  padding-bottom: 0px !important;
  line-height: 1 !important;
  font-size: 14px !important;
  overflow: hidden !important;
}

.top-level-search.v-text-field {
  background: transparent !important;
  background-color: transparent !important;
}

.top-level-search >>> .v-input__slot {
  background: transparent !important;
  background-color: transparent !important;
  box-shadow: none !important;
}

.top-level-search >>> .v-input__control {
  background: transparent !important;
  background-color: transparent !important;
}

.top-level-search >>> .v-text-field__slot {
  background: transparent !important;
  background-color: transparent !important;
}

.top-level-search >>> .v-input__slot:before {
  border: none !important;
}

.top-level-search >>> .v-input__slot:after {
  border: none !important;
}

.top-level-search.v-text-field--solo > .v-input__control > .v-input__slot {
  background: transparent !important;
}

/* Override Vuetify v-select height with higher specificity */
.sort-select-small.v-text-field--outlined.v-input--dense.v-text-field--single-line > .v-input__control > .v-input__slot,
.sort-select-small.v-text-field--outlined.v-input--dense.v-text-field--outlined > .v-input__control > .v-input__slot {
  min-height: 32px !important;
  height: 32px !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}

.sort-select-small.v-select .v-input__control {
  height: 32px !important;
  min-height: 32px !important;
}

.sort-select-small .v-select__selection {
  line-height: 30px !important;
}

.sort-select-small.v-text-field--outlined.v-input--dense:not(.v-text-field--solo) .v-input__append-inner {
  margin-top: 4px !important;
}

/* Liquid glass styling for the main filters dialog */
.liquid-glass-dialog.v-card {
  background-color: rgba(0, 0, 0, 0.4) !important;
  background-image: none !important;
  backdrop-filter: blur(20px) saturate(1.8) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.8) !important;
  border-radius: 12px !important;
  position: relative !important;
  overflow: hidden !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  isolation: isolate !important;
}

/* Dynamic responsive tabs styling */
.responsive-tab {
  min-width: 48px !important;
  transition: all 0.3s ease !important;
}

.tab-icon, .tab-text {
  transition: opacity 0.3s ease !important;
}

/* Fallback for very narrow screens */
@media (max-width: 600px) {
  .token-allocation-title {
    flex-wrap: wrap !important;
  }

  .responsive-tabs {
    order: 3 !important;
    width: 100% !important;
    margin-left: 0 !important;
    margin-top: 8px !important;
  }

  .top-level-search {
    order: 2 !important;
    margin-left: 0 !important;
    margin-top: 8px !important;
    flex: 1 1 auto !important;
  }
}

/* Adaptive content container */
.adaptive-content {
  position: relative;
  transition: height 0.3s ease;
}

/* Smooth tab transitions */
.tab-transition {
  position: relative;
}

.tab-transition .v-tab-item {
  transition: opacity 0.2s ease-in-out;
}

/* Prevent jarring height changes during tab switch */
.v-tabs-items {
  transition: height 0.3s ease;
}

/* Fade transition for tab content */
.fade-transition-enter-active,
.fade-transition-leave-active {
  transition: opacity 0.2s ease;
}

.fade-transition-enter,
.fade-transition-leave-to {
  opacity: 0;
}

</style>
