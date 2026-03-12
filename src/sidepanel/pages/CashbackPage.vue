<template>
  <div class="cashback-page">
    <!-- Header -->
    <div class="cashback-header pa-4">
      <div class="text-h6 white--text">{{ $t('miniGero.cashback') }}</div>
      <div class="text-caption grey--text">{{ $t('miniGero.cashbackPoweredBy') }}</div>
    </div>

    <!-- Rewards summary -->
    <div v-if="eligible || pending" class="rewards-summary mx-4 mb-3">
      <div v-if="eligible" class="reward-item">
        <v-icon small color="#00c7f3" class="mr-2">mdi-gift-outline</v-icon>
        <span class="text-caption white--text">Ready to claim:</span>
        <span class="text-caption accent-text ml-1 font-weight-bold">
          {{ formatReward(eligible) }}
        </span>
      </div>
      <div v-if="pending" class="reward-item">
        <v-icon small color="#888" class="mr-2">mdi-clock-outline</v-icon>
        <span class="text-caption white--text">Pending:</span>
        <span class="text-caption grey--text ml-1">
          {{ formatReward(pending) }}
        </span>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="isLoading" class="px-4">
      <v-skeleton-loader v-for="i in 6" :key="i" type="list-item-avatar-two-line" dark class="mb-2" />
    </div>

    <!-- Not supported -->
    <div v-else-if="!supported" class="empty-state">
      <v-icon size="48" color="#2a2a2a">mdi-earth-off</v-icon>
      <div class="text-body-2 grey--text mt-3 text-center">
        Cashback isn't available in your country yet.
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="deals.length === 0" class="empty-state">
      <v-icon size="48" color="#2a2a2a">mdi-tag-off-outline</v-icon>
      <div class="text-body-1 white--text mt-3">{{ $t('miniGero.noCashbackOffers') }}</div>
      <div class="text-caption grey--text mt-1">{{ $t('miniGero.noCashbackDesc') }}</div>
    </div>

    <!-- Category chips -->
    <div v-if="supported && categories.length > 0" class="category-chips px-4 pb-2">
      <div class="chips-scroll">
        <v-chip
          v-for="(cat, i) in categories"
          :key="cat.id || i"
          small
          :class="selectedCategory === i ? 'active-chip' : 'inactive-chip'"
          @click="selectCategory(i)"
        >
          {{ cat.name }}
        </v-chip>
      </div>
    </div>

    <!-- Deals list -->
    <div v-if="supported && deals.length > 0" class="deals-list px-4">
      <div
        v-for="deal in deals"
        :key="deal.id"
        class="deal-item"
        @click="openDeal(deal)"
      >
        <v-avatar size="40" :color="deal.backgroundColor || '#fff'" class="deal-avatar mr-3">
          <v-img v-if="deal.img" :src="deal.img" contain />
          <v-icon v-else color="#888">mdi-store</v-icon>
        </v-avatar>
        <div class="deal-info">
          <div class="white--text text-body-2 deal-name">
            {{ deal.section ? `${deal.name} > ${deal.section}` : deal.name }}
          </div>
          <div class="accent-text text-caption">
            Up to {{ Number(deal.maxCashback).toFixed(2) }}{{ deal.cashbackSymbol }} cashback
          </div>
        </div>
        <v-icon small color="#444">mdi-chevron-right</v-icon>
      </div>
    </div>

    <!-- Load more indicator -->
    <div v-if="loadingMore" class="text-center py-3">
      <v-progress-circular indeterminate size="24" color="#00c7f3" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, onMounted, watch } from 'vue';
import { bringStore } from '@/stores/bringStore';
import cashbackApi from '@/api/cashback-api';
import filters from '@/shared/utils/filters';

const { bringCache } = toRefs(bringStore);

const isLoading = ref(true);
const loadingMore = ref(false);
const supported = ref(true);
const categories = ref<any[]>([]);
const selectedCategory = ref(0);
const retailers = ref<any>(null);
const nextPage = ref<string | null>(null);
const retailerIconBasePath = ref('');
const iconQueryParam = ref('');

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

function formatReward(reward: any): string {
  if (!reward) return '';
  return filters.toCurrency(reward.tokenAmount * 1000000, false, 2, '', ` ${reward.tokenSymbol}`, false, 6);
}

function selectCategory(index: number) {
  selectedCategory.value = index;
}

// Watch category changes
watch(selectedCategory, async (idx) => {
  const cat = categories.value[idx];
  if (!cat) return;
  isLoading.value = true;
  try {
    const data = await cashbackApi.retailers(cat.id);
    retailers.value = data.items.reduce((obj: any, item: any) => {
      obj[item.id] = { ...item, img: data.retailerIconBasePath + item.iconPath + data.iconQueryParam };
      return obj;
    }, {});
    nextPage.value = data.nextPageNumber;
    retailerIconBasePath.value = data.retailerIconBasePath;
    iconQueryParam.value = data.iconQueryParam;
  } catch (e) {
    console.warn('Failed to load retailers:', e);
  } finally {
    isLoading.value = false;
  }
});

function openDeal(deal: any) {
  // Open the retailer's cashback link in a new tab
  if (deal.trackingUrl) {
    window.open(deal.trackingUrl, '_blank');
  } else if (deal.url) {
    window.open(deal.url, '_blank');
  }
}

onMounted(async () => {
  try {
    const isAvailable = await cashbackApi.checkAvailability();
    if (isAvailable) {
      const res = await cashbackApi.categoriesSearch();
      categories.value = [{ iconSvg: '', id: null, name: 'All' }];
      categories.value.push(...res.categories.items);
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
}

.cashback-header {
  padding-bottom: 8px !important;
}

.rewards-summary {
  background: #141414;
  border-radius: 12px;
  padding: 12px 16px;
  border: 1px solid #2a2a2a;
}

.reward-item {
  display: flex;
  align-items: center;
  padding: 4px 0;
}

.accent-text {
  color: #00c7f3;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
}

.category-chips {
  overflow: hidden;
}

.chips-scroll {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.chips-scroll::-webkit-scrollbar {
  display: none;
}

.active-chip {
  background: linear-gradient(135deg, #00c7f3, #00fad5) !important;
  color: black !important;
  font-weight: 600;
}

.inactive-chip {
  background: #1a1a1a !important;
  border: 1px solid #2a2a2a !important;
  color: #888 !important;
}

.deals-list {
  padding-bottom: 16px;
}

.deal-item {
  display: flex;
  align-items: center;
  padding: 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 4px;
}

.deal-item:hover {
  background: #141414;
}

.deal-item:active {
  background: #1a1a1a;
}

.deal-avatar {
  flex-shrink: 0;
  border-radius: 10px !important;
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
</style>
