<template>
  <div class="cashback-page">
    <!-- Header with back button -->
    <div class="cashback-header pa-4">
      <div class="d-flex align-center">
        <v-btn icon small class="mr-2" @click="$router.push('/')">
          <v-icon color="var(--g-text-1)">mdi-arrow-left</v-icon>
        </v-btn>
        <div>
          <div class="text-h6 white--text">{{ $t('miniGero.cashback') }}</div>
          <div class="text-caption grey--text">{{ $t('miniGero.cashbackPoweredBy') }}</div>
        </div>
      </div>
    </div>

    <!-- Rewards summary -->
    <div v-if="eligible || pending" class="rewards-summary mx-4 mb-3">
      <div v-if="eligible" class="reward-item">
        <v-icon small :color="primaryColor" class="mr-2">mdi-gift-outline</v-icon>
        <span class="text-caption white--text">Ready to claim:</span>
        <span class="text-caption accent-text ml-1 font-weight-bold">
          {{ formatReward(eligible) }}
        </span>
      </div>
      <div v-if="pending" class="reward-item">
        <v-icon small color="var(--g-text-3)" class="mr-2">mdi-clock-outline</v-icon>
        <span class="text-caption white--text">Pending:</span>
        <span class="text-caption grey--text ml-1">
          {{ formatReward(pending) }}
        </span>
      </div>
    </div>

    <!-- Search -->
    <div v-if="supported" class="px-4 pb-2">
      <v-text-field
        v-model="search"
        dense
        outlined
        hide-details
        :placeholder="$t('miniGero.cashbackSearch')"
        prepend-inner-icon="mdi-magnify"
        clearable
        class="cashback-search"
        dark
      />
    </div>

    <!-- Category filter (drag-to-scroll carousel) -->
    <div v-if="supported && categories.length > 0" class="category-filter px-4 pb-3">
      <div
        ref="filterScrollEl"
        class="filter-scroll"
        :class="{ 'filter-scroll--grabbing': isDragging }"
        @mousedown="onDragStart"
        @mousemove="onDragMove"
        @mouseup="onDragEnd"
        @mouseleave="onDragEnd"
      >
        <button
          v-for="(cat, i) in categories"
          :key="cat.id || i"
          class="filter-pill"
          :class="{ 'filter-pill--active': selectedCategory === i }"
          @click.prevent="onPillClick(i)"
        >
          {{ cat.name }}
        </button>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="isLoading" class="px-4">
      <v-skeleton-loader v-for="i in 6" :key="i" type="list-item-avatar-two-line" dark class="mb-2" />
    </div>

    <!-- Not supported -->
    <div v-else-if="!supported" class="empty-state">
      <v-icon size="48" color="var(--g-text-3)">mdi-earth-off</v-icon>
      <div class="text-body-2 grey--text mt-3 text-center">
        {{ $t('miniGero.cashbackNotAvailable') }}
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="deals.length === 0" class="empty-state">
      <v-icon size="48" color="var(--g-text-3)">mdi-tag-off-outline</v-icon>
      <div class="text-body-1 white--text mt-3">{{ $t('miniGero.noCashbackOffers') }}</div>
      <div class="text-caption grey--text mt-1">{{ $t('miniGero.noCashbackDesc') }}</div>
    </div>

    <!-- Deals list -->
    <div v-if="supported && deals.length > 0 && !isLoading" class="deals-list px-4">
      <div
        v-for="deal in deals"
        :key="deal.id"
        class="deal-item"
        @click="openDeal(deal)"
      >
        <v-avatar size="40" :color="deal.backgroundColor || '#fff'" class="deal-avatar mr-3">
          <v-img v-if="deal.img" :src="deal.img" contain />
          <v-icon v-else color="var(--g-text-3)">mdi-store</v-icon>
        </v-avatar>
        <div class="deal-info">
          <div class="white--text text-body-2 deal-name">
            {{ deal.section ? `${deal.name} > ${deal.section}` : deal.name }}
          </div>
          <div class="accent-text text-caption">
            Up to {{ Number(deal.maxCashback).toFixed(2) }}{{ deal.cashbackSymbol }} cashback
          </div>
        </div>
        <v-icon small color="var(--g-text-3)">mdi-chevron-right</v-icon>
      </div>
    </div>

    <!-- Infinite scroll sentinel + load more indicator -->
    <div v-if="supported && deals.length > 0 && nextPage" ref="sentinelEl" class="text-center py-3">
      <v-progress-circular v-if="loadingMore" indeterminate size="24" :color="primaryColor" />
    </div>

    <!-- Retailer Detail Bottom Sheet -->
    <BottomSheet
      v-model="showDealSheet"
      :title="selectedDeal ? selectedDeal.name : ''"
      height="70%"
      @close="showDealSheet = false"
    >
      <div v-if="selectedDeal" class="deal-detail">
        <!-- Retailer header -->
        <div class="deal-detail-header">
          <v-avatar size="56" :color="selectedDeal.backgroundColor || '#fff'" class="deal-detail-avatar mr-3">
            <v-img v-if="selectedDeal.img" :src="selectedDeal.img" contain />
            <v-icon v-else color="var(--g-text-3)" size="28">mdi-store</v-icon>
          </v-avatar>
          <div>
            <div class="white--text text-subtitle-1 font-weight-bold" style="line-height: 1.3">
              {{ selectedDeal.section ? `${selectedDeal.name} > ${selectedDeal.section}` : selectedDeal.name }}
            </div>
            <div class="accent-text text-body-2 mt-1">
              Up to {{ Number(selectedDeal.maxCashback).toFixed(0) }}{{ selectedDeal.cashbackSymbol }} Cashback
            </div>
          </div>
        </div>

        <!-- Terms -->
        <div class="deal-terms-section mt-4">
          <div class="text-caption white--text font-weight-bold mb-2">{{ $t('miniGero.cashbackTerms') }}</div>
          <div class="deal-terms-content">
            <div v-if="termsLoading" class="text-center py-4">
              <v-progress-circular indeterminate size="24" :color="primaryColor" width="2" />
            </div>
            <div v-else-if="termsContent" class="text-caption grey--text terms-text" v-html="renderedTerms" />
            <div v-else class="text-caption grey--text">{{ $t('miniGero.noTermsAvailable') }}</div>
          </div>
        </div>

        <!-- Start Shopping button -->
        <v-btn
          block
          class="start-shopping-btn mt-4"
          :loading="activating"
          :disabled="activating || !retailerUrl"
          @click="startShopping"
        >
          <v-icon left small>mdi-open-in-new</v-icon>
          {{ $t('miniGero.startShopping') }}
        </v-btn>
        <div class="text-caption grey--text text-center mt-2">
          {{ $t('miniGero.startShoppingTerms') }}
        </div>
      </div>
    </BottomSheet>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { bringStore } from '@/stores/bringStore';
import { walletStore } from '@/stores/walletStore';
import cashbackApi from '@/api/cashback-api';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import axios from 'axios';
import BottomSheet from '../components/BottomSheet.vue';
import { useChainContext } from '../composables/useChainContext';
import debounce from 'lodash/debounce';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const { bringCache } = toRefs(bringStore);
const { loggedWallet } = toRefs(walletStore);

const isLoading = ref(true);
const loadingMore = ref(false);
const supported = ref(true);
const categories = ref<any[]>([]);
const selectedCategory = ref(0);
const search = ref('');
const retailers = ref<any>(null);
const nextPage = ref<number | null>(null);
const sentinelEl = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
const retailerIconBasePath = ref('');
const iconQueryParam = ref('');
const retailerTermsBasePath = ref('');

// Drag-to-scroll carousel state
const filterScrollEl = ref<HTMLElement | null>(null);
const isDragging = ref(false);
const dragStartX = ref(0);
const scrollStartX = ref(0);
const dragMoved = ref(false);

function onDragStart(e: MouseEvent) {
  if (!filterScrollEl.value) return;
  isDragging.value = true;
  dragMoved.value = false;
  dragStartX.value = e.pageX;
  scrollStartX.value = filterScrollEl.value.scrollLeft;
}

function onDragMove(e: MouseEvent) {
  if (!isDragging.value || !filterScrollEl.value) return;
  const dx = e.pageX - dragStartX.value;
  if (Math.abs(dx) > 3) dragMoved.value = true;
  filterScrollEl.value.scrollLeft = scrollStartX.value - dx;
}

function onDragEnd() {
  isDragging.value = false;
}

function onPillClick(index: number) {
  // Ignore click if user was dragging
  if (dragMoved.value) return;
  selectCategory(index);
}

// Deal sheet state
const showDealSheet = ref(false);
const selectedDeal = ref<any>(null);
const termsLoading = ref(false);
const termsContent = ref('');
const activating = ref(false);
const retailerUrl = ref<string | null>(null);

const eligible = computed(() => {
  if (bringCache.value?.data?.eligible?.length > 0) {
    return bringCache.value.data.eligible[0];
  }
  return undefined;
});

const pending = computed(() => {
  if (bringCache.value?.data?.totalPendings?.length > 0) {
    return bringCache.value.data.totalPendings[0];
  }
  return undefined;
});

const deals = computed<any[]>(() => {
  if (retailers.value) {
    return Object.values(retailers.value);
  }
  return [];
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const renderedTerms = computed(() => {
  if (!termsContent.value) return '';
  // Sanitize first, then apply markdown → HTML: bold, newlines
  const safe = escapeHtml(termsContent.value);
  return safe
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--g-text-1)">$1</strong>')
    .replace(/\n/g, '<br>');
});

function formatReward(reward: any): string {
  if (!reward) return '';
  return filters.toCurrency(reward.tokenAmount * 1000000, false, 2, '', ` ${reward.tokenSymbol}`, false, 6);
}

function selectCategory(index: number) {
  if (selectedCategory.value === index) return;
  selectedCategory.value = index;
}

async function loadRetailers(categoryId: string | null, searchTerm?: string) {
  isLoading.value = true;
  try {
    const data = await cashbackApi.retailers(categoryId, searchTerm || undefined);
    retailers.value = data.items.reduce((obj: any, item: any) => {
      obj[item.id] = { ...item, img: data.retailerIconBasePath + item.iconPath + data.iconQueryParam };
      return obj;
    }, {});
    nextPage.value = data.nextPageNumber;
    retailerIconBasePath.value = data.retailerIconBasePath;
    iconQueryParam.value = data.iconQueryParam;
    if (data.retailerTermsBasePath) {
      retailerTermsBasePath.value = data.retailerTermsBasePath;
    }
  } catch (e) {
    console.warn('Failed to load retailers:', e);
  } finally {
    isLoading.value = false;
  }
}

async function loadMore() {
  if (loadingMore.value || !nextPage.value) return;
  loadingMore.value = true;
  try {
    const cat = categories.value[selectedCategory.value];
    const categoryId = cat ? cat.id : null;
    const data = await cashbackApi.retailers(categoryId, search.value || undefined, nextPage.value);
    const newItems = data.items.reduce((obj: any, item: any) => {
      obj[item.id] = { ...item, img: data.retailerIconBasePath + item.iconPath + data.iconQueryParam };
      return obj;
    }, {});
    retailers.value = { ...retailers.value, ...newItems };
    nextPage.value = data.nextPageNumber;
  } catch (e) {
    console.warn('Failed to load more retailers:', e);
  } finally {
    loadingMore.value = false;
  }
}

function setupObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  nextTick(() => {
    if (!sentinelEl.value) return;
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && nextPage.value && !loadingMore.value) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelEl.value);
  });
}

// Watch category changes
watch(selectedCategory, (idx) => {
  const cat = categories.value[idx];
  if (!cat) return;
  loadRetailers(cat.id, search.value);
});

// Debounced search
const debouncedSearch = debounce(() => {
  const cat = categories.value[selectedCategory.value];
  loadRetailers(cat ? cat.id : null, search.value);
}, 400);

watch(search, () => {
  debouncedSearch();
});

// Re-setup observer when deals or nextPage change
watch([deals, nextPage], () => {
  if (nextPage.value) {
    setupObserver();
  }
});

function openDeal(deal: any) {
  selectedDeal.value = deal;
  showDealSheet.value = true;
}

// When deal sheet opens, load terms and activate
watch(showDealSheet, async (val) => {
  if (val && selectedDeal.value) {
    termsContent.value = '';
    termsLoading.value = true;
    activating.value = true;
    retailerUrl.value = null;

    // Load terms and activate in parallel
    const promises: Promise<void>[] = [];

    // Load terms
    promises.push(
      (async () => {
        try {
          const basePath = retailerTermsBasePath.value || 'https://media.bringweb3.io/cashback-terms';
          if (selectedDeal.value.termsPath) {
            const response = await axios.get(basePath + selectedDeal.value.termsPath);
            termsContent.value = response.data;
          }
        } catch (e) {
          termsContent.value = '';
        } finally {
          termsLoading.value = false;
        }
      })()
    );

    // Activate deal to get tracking URL
    promises.push(
      (async () => {
        try {
          if (loggedWallet.value?.baseAddress) {
            const response = await cashbackApi.activate(
              selectedDeal.value.id,
              loggedWallet.value.baseAddress,
              networks.resolveCurrencyTicker(loggedWallet.value.chain, loggedWallet.value.network),
              ''
            );
            if (response.status) {
              retailerUrl.value = response.url;
            }
          }
        } catch (e) {
          console.warn('Failed to activate deal:', e);
        } finally {
          activating.value = false;
        }
      })()
    );

    await Promise.all(promises);
  }
});

function startShopping() {
  if (!retailerUrl.value || !selectedDeal.value) return;

  window.open(retailerUrl.value, '_blank');

  // Send analytics
  if (loggedWallet.value) {
    cashbackApi.analytics(
      selectedDeal.value.id,
      selectedDeal.value.name,
      loggedWallet.value.baseAddress,
      networks.resolveCurrencyTicker(loggedWallet.value.chain, loggedWallet.value.network),
      ''
    ).catch(() => {});
  }

  showDealSheet.value = false;
}

onBeforeUnmount(() => {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
});

onMounted(async () => {
  try {
    const isAvailable = await cashbackApi.checkAvailability();
    if (isAvailable) {
      const res = await cashbackApi.categoriesSearch();
      categories.value = [{ iconSvg: '', id: null, name: 'All' }];
      categories.value.push(...res.categories.items);

      // Load initial retailers ("All" category, id: null)
      await loadRetailers(null);
    } else {
      supported.value = false;
    }
  } catch (e) {
    supported.value = false;
  } finally {
    isLoading.value = false;
  }
});
</script>

<style scoped>
.cashback-page {
  min-height: 100%;
  padding-bottom: 64px;
}

.cashback-header {
  padding-bottom: 8px !important;
}

.rewards-summary {
  background: var(--g-raised);
  border-radius: var(--g-r-card);
  padding: 12px 16px;
  border: 1px solid var(--g-hairline-1);
}

.reward-item {
  display: flex;
  align-items: center;
  padding: 4px 0;
}

.accent-text {
  color: var(--g-accent);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
}

.cashback-search {
  border-radius: var(--g-r-control);
}

.cashback-search >>> .v-input__slot {
  background: var(--g-hairline-1) !important;
  border-color: var(--g-hairline-1) !important;
  min-height: 36px !important;
}

.cashback-search >>> .v-input__slot fieldset {
  border-color: var(--g-hairline-1) !important;
}

.category-filter {
  overflow: visible;
}

.filter-scroll {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
  -ms-overflow-style: none;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
}

.filter-scroll--grabbing {
  cursor: grabbing;
}

.filter-scroll::-webkit-scrollbar {
  display: none;
}

.filter-pill {
  flex-shrink: 0;
  padding: 6px 14px;
  border-radius: var(--g-r-pill);
  border: 1px solid var(--g-hairline-2);
  background: var(--g-hairline-1);
  color: var(--g-text-3);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--g-dur-fast) ease, background-color var(--g-dur-fast) ease, border-color var(--g-dur-fast) ease;
  outline: none;
}

.filter-pill:hover {
  background: var(--g-hairline-2);
  color: var(--g-text-2);
}

.filter-pill--active {
  background: linear-gradient(135deg, var(--g-grad-1), var(--g-grad-2));
  border-color: transparent;
  color: var(--g-on-grad);
  font-weight: 600;
}

.deals-list {
  padding-bottom: 16px;
}

.deal-item {
  display: flex;
  align-items: center;
  padding: 12px;
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  cursor: pointer;
  transition: background var(--g-dur-fast);
  margin-bottom: 6px;
}

.deal-item:hover {
  background: var(--g-hairline-2);
}

.deal-item:active {
  background: var(--g-hairline-3);
}

.deal-avatar {
  flex-shrink: 0;
  border-radius: var(--g-r-control) !important;
}

.deal-info {
  flex: 1;
  min-width: 0;
}

.deal-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Deal detail sheet */
.deal-detail-header {
  display: flex;
  align-items: center;
}

.deal-detail-avatar {
  flex-shrink: 0;
  border-radius: var(--g-r-card) !important;
}

.deal-terms-section {
  flex: 1;
  overflow: hidden;
}

.deal-terms-content {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 12px;
  max-height: 200px;
  overflow-y: auto;
}

.terms-text {
  line-height: 1.6;
  word-break: break-word;
}

.start-shopping-btn {
  background: linear-gradient(135deg, var(--g-grad-1), var(--g-grad-2)) !important;
  color: var(--g-on-grad) !important;
  font-weight: 600;
  text-transform: none;
  border-radius: var(--g-r-control);
  height: 44px !important;
}

.start-shopping-btn.v-btn--disabled {
  background: var(--g-raised) !important;
  color: var(--g-text-3) !important;
}
</style>
