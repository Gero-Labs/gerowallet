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
        <!-- No results -->
        <div v-if="results.length === 0" class="text-center py-6 grey--text text--lighten-1">
          {{ t('search.noResults') }}
        </div>

        <!-- Grouped results -->
        <template v-else>
          <!-- Tokens -->
          <div v-if="tokenResults.length > 0">
            <div class="global-search-category-header">{{ t('search.tokens') }}</div>
            <v-list dense class="transparent pa-0">
              <v-list-item
                v-for="(result, idx) in tokenResults"
                :key="result.id"
                :class="{ 'global-search-item-active': selectedIndex === getGlobalIndex('token', idx) }"
                class="global-search-item"
                @click="navigateTo(result)"
                @mouseenter="selectedIndex = getGlobalIndex('token', idx)"
              >
                <v-list-item-avatar size="28" class="mr-2">
                  <v-img v-if="result.icon && !result.icon.startsWith('mdi-')" :src="result.icon" />
                  <v-icon v-else small>{{ result.icon || 'mdi-circle' }}</v-icon>
                </v-list-item-avatar>
                <v-list-item-content>
                  <v-list-item-title class="text-body-2">{{ result.title }}</v-list-item-title>
                  <v-list-item-subtitle class="text-caption">{{ result.subtitle }}</v-list-item-subtitle>
                </v-list-item-content>
              </v-list-item>
            </v-list>
          </div>

          <!-- Transactions -->
          <div v-if="transactionResults.length > 0">
            <div class="global-search-category-header">{{ t('search.transactions') }}</div>
            <v-list dense class="transparent pa-0">
              <v-list-item
                v-for="(result, idx) in transactionResults"
                :key="result.id"
                :class="{ 'global-search-item-active': selectedIndex === getGlobalIndex('transaction', idx) }"
                class="global-search-item"
                @click="navigateTo(result)"
                @mouseenter="selectedIndex = getGlobalIndex('transaction', idx)"
              >
                <v-list-item-avatar size="28" class="mr-2">
                  <v-icon small>{{ result.icon }}</v-icon>
                </v-list-item-avatar>
                <v-list-item-content>
                  <v-list-item-title class="text-body-2 monospace">{{ result.title }}</v-list-item-title>
                  <v-list-item-subtitle class="text-caption">{{ result.subtitle }}</v-list-item-subtitle>
                </v-list-item-content>
              </v-list-item>
            </v-list>
          </div>

          <!-- Stake Pools -->
          <div v-if="poolResults.length > 0">
            <div class="global-search-category-header">{{ t('search.stakePools') }}</div>
            <v-list dense class="transparent pa-0">
              <v-list-item
                v-for="(result, idx) in poolResults"
                :key="result.id"
                :class="{ 'global-search-item-active': selectedIndex === getGlobalIndex('pool', idx) }"
                class="global-search-item"
                @click="navigateTo(result)"
                @mouseenter="selectedIndex = getGlobalIndex('pool', idx)"
              >
                <v-list-item-avatar size="28" class="mr-2">
                  <v-icon small>{{ result.icon }}</v-icon>
                </v-list-item-avatar>
                <v-list-item-content>
                  <v-list-item-title class="text-body-2">{{ result.title }}</v-list-item-title>
                  <v-list-item-subtitle class="text-caption">{{ result.subtitle }}</v-list-item-subtitle>
                </v-list-item-content>
              </v-list-item>
            </v-list>
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
import { useGlobalSearch, type SearchResult } from '@/shared/composables/useGlobalSearch';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();
const { isOpen, query, results, close } = useGlobalSearch();

const vmProxy = getCurrentInstance()?.proxy as any;
const searchInput = ref<any>(null);
const selectedIndex = ref(0);

// Filtered results by type
const tokenResults = computed(() => results.value.filter(r => r.type === 'token'));
const transactionResults = computed(() => results.value.filter(r => r.type === 'transaction'));
const poolResults = computed(() => results.value.filter(r => r.type === 'pool'));

// Flat list for keyboard navigation
const flatResults = computed(() => [
  ...tokenResults.value,
  ...transactionResults.value,
  ...poolResults.value,
]);

// Get global index for a result by type and local index
function getGlobalIndex(type: string, localIdx: number): number {
  let offset = 0;
  if (type === 'transaction') offset = tokenResults.value.length;
  if (type === 'pool') offset = tokenResults.value.length + transactionResults.value.length;
  return offset + localIdx;
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
  if (result.route && vmProxy?.$router) {
    vmProxy.$router.push(result.route).catch(() => {
      // Navigation duplicate or cancelled — ignore
    });
  }
  close();
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
