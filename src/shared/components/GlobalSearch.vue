<template>
  <v-dialog
    v-model="isOpen"
    max-width="560"
    content-class="global-search-dialog"
    :transition="'fade-transition'"
    @click:outside="close"
    @keydown.esc="close"
  >
    <v-card class="global-search-card" style="border-radius: 12px; overflow: hidden;">
      <!-- Search Input -->
      <v-card-text class="pa-0">
        <v-text-field
          ref="searchInput"
          v-model="query"
          :placeholder="t('search.globalPlaceholder')"
          prepend-inner-icon="mdi-magnify"
          hide-details
          solo
          flat
          autofocus
          dense
          class="global-search-input"
          @keydown.down.prevent="moveSelection(1)"
          @keydown.up.prevent="moveSelection(-1)"
          @keydown.enter.prevent="selectCurrent"
        />
      </v-card-text>

      <v-divider />

      <!-- Results -->
      <div class="global-search-results" v-if="query.length >= 2">
        <!-- Searching indicator -->
        <div v-if="searching && flatResults.length === 0" class="text-center py-4 grey--text text--lighten-1">
          <v-progress-circular indeterminate size="20" width="2" class="mr-2" />
          {{ t('search.searching') }}
        </div>

        <!-- No results -->
        <div v-else-if="flatResults.length === 0 && !searching" class="text-center py-6 grey--text text--lighten-1">
          {{ t('search.noResults') }}
        </div>

        <!-- Grouped results -->
        <template v-else>
          <template v-for="group in groupedResults">
            <div :key="group.type + '-header'" v-if="group.items.length > 0">
              <div class="global-search-category-header">{{ groupLabel(group.type) }}</div>
              <v-list dense class="transparent pa-0">
                <v-list-item
                  v-for="result in group.items"
                  :key="result.id"
                  :class="{ 'global-search-item-active': selectedIndex === result._flatIdx }"
                  class="global-search-item"
                  @click="navigateTo(result)"
                  @mouseenter="selectedIndex = result._flatIdx"
                >
                  <v-list-item-avatar size="28" class="mr-2">
                    <v-img v-if="result.icon && !result.icon.startsWith('mdi-')" :src="result.icon" />
                    <v-icon v-else small>{{ result.icon || 'mdi-circle' }}</v-icon>
                  </v-list-item-avatar>
                  <v-list-item-content>
                    <v-list-item-title class="text-body-2" :class="{ 'monospace': result.type === 'transaction' }">
                      {{ result.title }}
                    </v-list-item-title>
                    <v-list-item-subtitle class="text-caption">{{ result.subtitle }}</v-list-item-subtitle>
                  </v-list-item-content>
                  <v-list-item-action class="ma-0">
                    <v-icon x-small color="grey lighten-1">mdi-chevron-right</v-icon>
                  </v-list-item-action>
                </v-list-item>
              </v-list>
            </div>
          </template>

          <!-- Loading more from API -->
          <div v-if="searching" class="text-center py-2">
            <v-progress-circular indeterminate size="16" width="2" color="grey" />
          </div>
        </template>
      </div>

      <!-- Footer -->
      <v-divider v-if="query.length >= 2" />
      <div class="global-search-footer d-flex align-center justify-center py-2">
        <span class="grey--text text--lighten-1 text-caption">{{ t('search.pressEsc') }}</span>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, getCurrentInstance } from 'vue';
import { useGlobalSearch, settingsNavRequest, type SearchResult, type SearchResultType } from '@/shared/composables/useGlobalSearch';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();
const { isOpen, query, results, searching, close } = useGlobalSearch();

const vmProxy = getCurrentInstance()?.proxy as any;
const searchInput = ref<any>(null);
const selectedIndex = ref(0);

// All category types for grouping labels
const allTypes: SearchResultType[] = ['setting', 'token', 'nft', 'transaction', 'pool', 'drep', 'retailer', 'contact'];

// Flat list sorted by relevance score, with indices for keyboard navigation
const flatResults = computed(() => {
  const sorted = [...results.value].sort((a, b) => (b._score || 0) - (a._score || 0));
  return sorted.map((r, idx) => ({ ...r, _flatIdx: idx }));
});

// Group results by type, ordered by highest-scoring item in each group
const groupedResults = computed(() => {
  const groups: { type: SearchResultType; topScore: number; items: (SearchResult & { _flatIdx: number })[] }[] = [];
  for (const type of allTypes) {
    const items = flatResults.value.filter(r => r.type === type);
    if (items.length > 0) {
      const topScore = Math.max(...items.map(r => r._score || 0));
      groups.push({ type, topScore, items });
    }
  }
  // Sort groups: highest-scoring group first
  groups.sort((a, b) => b.topScore - a.topScore);
  return groups;
});

function groupLabel(type: SearchResultType): string {
  const labels: Record<SearchResultType, string> = {
    token: t('search.tokens'),
    transaction: t('search.transactions'),
    nft: t('search.nftCollections'),
    pool: t('search.stakePools'),
    drep: t('search.dreps'),
    retailer: t('search.cashbackStores'),
    contact: t('search.contacts'),
    setting: t('search.settings'),
  };
  return labels[type] || type;
}

function moveSelection(delta: number) {
  const total = flatResults.value.length;
  if (total === 0) return;
  selectedIndex.value = (selectedIndex.value + delta + total) % total;
}

function selectCurrent() {
  const result = flatResults.value[selectedIndex.value];
  if (result) {
    navigateTo(result);
  }
}

function navigateTo(result: SearchResult) {
  close();

  const router = vmProxy?.$router;
  if (!router) return;

  switch (result.type) {
    case 'token':
      router.push({ path: '/', query: { view: 'all', token: result.id } }).catch(() => {});
      break;
    case 'nft':
      router.push({ path: '/', query: { view: 'collectibles', nft: result.id } }).catch(() => {});
      break;
    case 'transaction':
      router.push({ path: '/transactions', query: { tx: result.id } }).catch(() => {});
      break;
    case 'pool':
      router.push({ path: '/staking', query: { pool: result.data?.ticker || result.data?.name || result.id } }).catch(() => {});
      break;
    case 'drep':
      router.push({ path: '/governance', query: { drep: result.data?.name || result.id } }).catch(() => {});
      break;
    case 'retailer':
      router.push({ path: '/cashback', query: { store: result.title } }).catch(() => {});
      break;
    case 'contact':
      settingsNavRequest.value = { tab: 'contacts', highlight: result.title };
      break;
    case 'setting':
      settingsNavRequest.value = { tab: result.data?.tab, highlight: result.data?.highlight };
      break;
    default:
      if (result.route) {
        router.push(result.route).catch(() => {});
      }
  }
}

// Reset selection when results change
watch(results, () => {
  selectedIndex.value = 0;
});

// Focus input when dialog opens
watch(isOpen, (val) => {
  if (val) {
    nextTick(() => {
      searchInput.value?.focus?.();
    });
  }
});
</script>

<style>
.global-search-dialog {
  align-self: flex-start;
  margin-top: 15vh !important;
}
</style>

<style scoped>
.global-search-card {
  background-color: #1a2035 !important;
}

.global-search-input {
  background-color: transparent !important;
}

.global-search-input >>> .v-input__slot {
  background-color: transparent !important;
  padding: 8px 16px !important;
}

.global-search-input >>> input {
  font-size: 15px !important;
}

.global-search-results {
  max-height: 400px;
  overflow-y: auto;
}

.global-search-category-header {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #8e99a4;
  padding: 10px 16px 4px;
}

.global-search-item {
  min-height: 44px !important;
  cursor: pointer;
  transition: background-color 0.1s;
}

.global-search-item:hover,
.global-search-item-active {
  background-color: rgba(255, 255, 255, 0.06) !important;
}

.global-search-footer {
  background-color: rgba(0, 0, 0, 0.15);
}

.monospace {
  font-family: 'Roboto Mono', monospace;
}
</style>
