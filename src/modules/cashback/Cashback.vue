<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <v-card class="transparent" flat>
          <v-card-title class="justify-center text-center" style="font-size: 32px">
            {{ $t('cashback.title') }}
          </v-card-title>
          <v-card-subtitle class="justify-center text-center py-0" style="font-size: 11px">
            {{ $t('common.poweredBy') }} <v-btn color="primary" class="px-0 mx-0" :ripple="false" style="min-width: 20px ;text-transform: capitalize; letter-spacing: normal;" text href="https://bringweb3.io/" target="_blank">
            <v-img class="bring-web3-logo" max-height="36" height="36" width="40" :src="assets.bringWhite" contain :alt="$t('cashback.bringLogo')" />
          </v-btn>
          </v-card-subtitle>
          <v-card-subtitle class="justify-center text-center pt-2" style="font-size: 16px">
            {{ $t('cashback.payAndReceive') }}
          </v-card-subtitle>
          <v-card-subtitle class="justify-center text-center pt-2 pb-8">
            <v-btn small outlined rounded color="primary" @click="isHowItWorksDialogOpen = true">
              {{ $t('cashback.howItWorks') }}
            </v-btn>
          </v-card-subtitle>
          <v-card-text>
            <div class="card-text">
              <div class="main-content">
                <div class="left-section">
                  <v-list-item two-line dense style="width: min-content; min-width: 250px">
                    <v-list-item-avatar size="40" tile>
                      <v-img :src="assets.giftSvg" contain></v-img>
                    </v-list-item-avatar>
                    <v-list-item-content>
                      <v-list-item-title style="font-size: 14px">
                        {{ $t('cashback.readyToClaim') }}
                      </v-list-item-title>
                      <v-list-item-subtitle style="display: flex; align-items: center;">
                        <div class="highlight-text">{{ filters.toCurrency(eligible ? (eligible.tokenAmount * 1000000) : 0, false, 2, "", (eligible ? " "+eligible.tokenSymbol : ""), false, 6) }}</div>
                        <span class="ml-4" style="font-size: 14px; color: var(--g-text-2)!important;">{{ filters.toCurrency(eligible ? convertFiat(Number(eligible.totalEstimatedUsd)) : 0, false, 2, getCurrencySymbol(), '', false, 0) }}</span>
                      </v-list-item-subtitle>
                    </v-list-item-content>
                  </v-list-item>
                </div>
                <div class="right-section">
                  <v-list-item two-line dense style="width: min-content; min-width: 250px">
                    <v-list-item-avatar size="40" tile>
                      <v-img :src="assets.pendingSvg" contain></v-img>
                    </v-list-item-avatar>
                    <v-list-item-content>
                      <v-list-item-title style="font-size: 14px">
                        {{ $t('cashback.pendingRewards') }}
                      </v-list-item-title>
                      <v-list-item-subtitle style="display: flex; align-items: center;">
                        <div class="secondary-text">{{ filters.toCurrency(pending ? (pending.tokenAmount * 1000000) : 0, false, 2, "", (pending ? " "+pending.tokenSymbol : ""), false, 6) }}</div>
                        <span class="ml-4" style="font-size: 14px; color: var(--g-text-2)!important;">{{ filters.toCurrency(pending ? convertFiat(pending.totalEstimatedUsd) : 0, false, 2, getCurrencySymbol(), '', false, 0) }}</span>
                      </v-list-item-subtitle>
                    </v-list-item-content>
                  </v-list-item>
                </div>
                <v-btn elevation="0" height="50" color="var(--g-surface)" @click="isRewardsDialogOpen = true" :disabled="!supported">
                  <div class="btn-content">
                    <div :class="supported ? 'btn-text' : 'btn-text-disabled'">{{ $t('cashback.viewRewards') }}</div>
                  </div>
                </v-btn>
              </div>
            </div>
            <v-row class="mt-4">
              <v-col cols="12" xl="6" lg="6" md="6" style="align-content: center;">
                <v-chip-group v-if="chipLoading" column>
                  <v-skeleton-loader
                    type="chip"
                    v-for="i in 10"
                    :key="'chip-'+i"
                    class="ma-1"
                  >
                  </v-skeleton-loader>
                </v-chip-group>
                <v-chip-group v-else v-model="selectedCategoryIndex" column active-class="geroButton" >
                  <v-chip class="ma-1" style="border: 1px solid var(--g-hairline-2); background-color: var(--g-raised)!important;" v-for="item in categories?.items" :key="item.id">
                    {{ item.name }}
                  </v-chip>
                </v-chip-group>
              </v-col>
              <v-col cols="12" xl="2" lg="2" md="2">
              </v-col>
              <v-col cols="12" xl="4" lg="4" md="4">
                <v-autocomplete
                  v-if="supported"
                  flat
                  v-model="model"
                  :items="searchTerms"
                  :loading="isLoading2"
                  :label="$t('cashback.brandProductDestination')"
                  outlined
                  class="cashback-search"
                  solo
                  dense
                  prepend-inner-icon="mdi-magnify"
                  clearable
                  hide-details
                  hide-no-data
                  hide-selected
                  style="border-radius: var(--g-r-sheet)"
                  :filter="customAutoCompleteFilter"
                  attach
                >
                </v-autocomplete>
                <div class="pt-4" v-if="totalItems > 0">
                  {{ totalItems }} {{ $t('cashback.dealsFound') }}
                </div>
              </v-col>
            </v-row>
            <v-row class="mt-4" v-show="!isLoading">
              <v-col cols="12" md="3" style="border-radius: var(--g-r-sheet)" v-for="retailer in deals" :key="retailer.id">
                <v-card class="pa-4 fill-height" flat style="background-color: var(--g-raised)!important; border-radius: var(--g-r-sheet); text-align: center;" color="primary" @click.stop="openRetailerDialog(retailer)">
                  <v-avatar :color="retailer.backgroundColor ? retailer.backgroundColor : '#fff'" size="80" v-if="retailer.iconPath && !imageErrors[retailer.id]">
                    <v-img :src="retailer.img" contain style="margin: auto;" eager @error="onImageError(retailer.id)">
                      <template v-slot:placeholder>
                        <v-row
                            class="fill-height ma-0"
                            align="center"
                            justify="center"
                        >
                          <v-progress-circular
                              indeterminate
                              color="primary"
                          ></v-progress-circular>
                        </v-row>
                      </template>
                    </v-img>
                  </v-avatar>
                  <v-avatar v-else color="var(--g-raised)" size="80">
                    <span class="retailer-initials">{{ getInitials(retailer.name) }}</span>
                  </v-avatar>
                  <v-card-title class="justify-center px-0" style="word-break: break-word;">{{retailer.section ?  (retailer.name + " > " + retailer.section) : retailer.name}}</v-card-title>
                  <v-card-subtitle class="px-0 pb-0" style="word-break: break-word; color: var(--g-accent)">
                    <v-chip small :class="Number(retailer.maxCashback) >= 4 ? 'geroButton' : 'transparent'" :style="Number(retailer.maxCashback) >= 4 ? {color: 'var(--g-on-grad)'} : {color:'var(--g-accent)'}">Up to {{ Number(retailer.maxCashback).toFixed(2) }}{{retailer.cashbackSymbol}} Cashback</v-chip>
                  </v-card-subtitle>
                </v-card>
              </v-col>
            </v-row>
            <v-row class="mt-4" v-show="isLoading && supported">
              <v-col cols="12" md="3" style="border-radius: var(--g-r-sheet)" v-for="i in 12" :key="i">
                <v-skeleton-loader
                  height="183"
                  type="image"
                ></v-skeleton-loader>
              </v-col>
            </v-row>
          </v-card-text>

          <v-card-actions ref="intersectionTarget" class="justify-center text-center" style="flex-direction: column;">
            <v-card-title>
              {{ supported ? '' : 'Unfortunately, Cashback isn\'t supported in your Country yet.'}}
              {{ loadingMore ? "Loading ..." : "" }}
            </v-card-title>
          </v-card-actions>
          <ViewRewardsDialog :isOpen="isRewardsDialogOpen" @close="isRewardsDialogOpen = false"></ViewRewardsDialog>
          <RetailerDialog :isOpen="isRetailerDialogOpen" @close="closeRetailerDialog" :retailer="retailer" :retailer-terms-base-path="retailerTermsBasePath" :search-term="searchTerm"></RetailerDialog>
          <HowItWorksDialog :isOpen="isHowItWorksDialogOpen" @close="isHowItWorksDialogOpen = false"></HowItWorksDialog>
        </v-card>
      </v-col>
    </v-row>
  </v-layout>
</template>
<script setup lang="ts">
import { computed, ref, watch, onMounted, toRefs, getCurrentInstance } from 'vue';
import { useIntersectionObserver } from '@vueuse/core';
import ViewRewardsDialog from '@/modules/cashback/dialogs/ViewRewardsDialog.vue';
import filters from "@/shared/utils/filters";
import RetailerDialog from '@/modules/cashback/dialogs/RetailerDialog.vue';
import HowItWorksDialog from '@/modules/cashback/dialogs/HowItWorksDialog.vue';
import { bringStore } from '@/stores/bringStore';
import cashbackApi from '@/api/cashback-api';
import assets from '@/utils/assets';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { getInitials } from '@/shared/utils/formatters';

const { bringCache } = toRefs(bringStore);
const { convertFiat, getCurrencySymbol } = useCurrencyConverter();
const instance = getCurrentInstance();

const isIntersecting = ref(false);
const selectedCategoryIndex = ref(0);
const intersectionTarget = ref<Element>();
const searchTerms = ref([]);
const model = ref<string>("");
const categories = ref({
  items: []
});
const chipLoading = ref(false);
const isLoading = ref(false);
const isLoading2 = ref(false);
const loadingMore = ref(false);
const retailers = ref(null);
const nextPage = ref(null);
const isRewardsDialogOpen = ref(false);
const isRetailerDialogOpen = ref(false);
const isHowItWorksDialogOpen = ref(false);
const retailer = ref(null);
const generalTermsUrl = ref(null);
const retailerTermsBasePath = ref(null);
const totalItems = ref(null);
const supported = ref(true);
const searchTerm = ref<string>('');
const imageErrors = ref<Record<string, boolean>>({});

const onImageError = (retailerId: string) => {
  imageErrors.value = { ...imageErrors.value, [retailerId]: true };
};

const selectedCategory = computed(() => {
  return categories.value.items[selectedCategoryIndex.value];
});

const eligible = computed(() => {
  if (bringCache.value && bringCache.value?.data?.eligible?.length > 0) {
    return bringCache.value.data.eligible[0];
  }
  return undefined;
});

const pending = computed(() => {
  if (bringCache.value && bringCache.value?.data?.totalPendings?.length > 0) {
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

watch(isIntersecting, async (val) => {
  if (val) {
    if (nextPage.value) {
      loadingMore.value = true;
      const retailersData = await cashbackApi.retailers(selectedCategory.value?.id, model.value, nextPage.value);
      retailers.value = {...retailers.value, ...retailersData.items.reduce((obj, item) => Object.assign(obj, { [item.id]: {...item,img: retailersData.retailerIconBasePath+item.iconPath+retailersData.iconQueryParam} }), {}) };
      nextPage.value = retailersData.nextPageNumber;
      loadingMore.value = false;
    }
  }
});

watch(model, async (val: string) => {
  isLoading.value = true;
  imageErrors.value = {};
  if (val) {
    selectedCategoryIndex.value = null;
    const retailersData = await cashbackApi.retailers(null, val);
    retailers.value = retailersData.items.reduce((obj, item) => Object.assign(obj, { [item.id]: {...item,img: retailersData.retailerIconBasePath+item.iconPath+retailersData.iconQueryParam} }), {});
    nextPage.value = retailersData.nextPageNumber;
    totalItems.value = retailersData.totalItems;
  }
  searchTerm.value = val;
  isLoading.value = false;
});

watch(selectedCategory, async () => {
  model.value = "";
  imageErrors.value = {};
  if (selectedCategory.value) {
    const retailersData = await cashbackApi.retailers(selectedCategory.value.id);
    retailers.value = retailersData.items.reduce((obj, item) => Object.assign(obj, { [item.id]: {...item,img: retailersData.retailerIconBasePath+item.iconPath+retailersData.iconQueryParam} }), {});
    nextPage.value = retailersData.nextPageNumber;
    generalTermsUrl.value = retailersData.generalTermsUrl;
    retailerTermsBasePath.value = retailersData.retailerTermsBasePath;
    totalItems.value = retailersData.totalItems;
    isLoading.value = false;
  }
});

// Set up intersection observer using VueUse
useIntersectionObserver(intersectionTarget, ([{ isIntersecting: intersecting }]) => {
  isIntersecting.value = intersecting;
});

const openRetailerDialog = (retailerData: any) => {
  retailer.value = retailerData;
  isRetailerDialogOpen.value = true;
};

const closeRetailerDialog = () => {
  isRetailerDialogOpen.value = false;
  retailer.value = null;
};

const customAutoCompleteFilter = (item: string, queryText: string) => {
  if (!queryText) {
    return false;
  }
  return item.toLowerCase().startsWith(queryText.toLowerCase());
};

onMounted(async () => {
  chipLoading.value = true;
  isLoading.value = true;
  try {
    const isAvailable = await cashbackApi.checkAvailability();
    if (isAvailable) {
      const res = await cashbackApi.categoriesSearch();
      categories.value.items = [{ iconSvg: "", id: null, name: "All Categories"}];
      categories.value.items.push(...res.categories.items);
      searchTerms.value = res.searchTerms.items;
      chipLoading.value = false;
    }
  } catch (e) {
    supported.value = false;
    chipLoading.value = false;
    isLoading.value = false;
  }
});

// Handle ?store=<name> deep-link from Global Search
watch(
  () => instance?.proxy?.$route?.query?.store,
  async (storeName) => {
    if (!storeName || typeof storeName !== 'string') return;
    try {
      const retailersData = await cashbackApi.retailers(null, storeName);
      const items = retailersData?.items || [];
      if (items.length > 0) {
        const match = items.find((r: any) => r.name?.toLowerCase() === storeName.toLowerCase()) || items[0];
        const retailerObj = {
          ...match,
          img: retailersData.retailerIconBasePath + match.iconPath + retailersData.iconQueryParam
        };
        retailerTermsBasePath.value = retailersData.retailerTermsBasePath;
        openRetailerDialog(retailerObj);
      }
    } catch (e) {
      console.warn('Failed to open store from deep-link:', e);
    }
  },
  { immediate: true }
);
</script>
<style scoped>
.card-text {
  margin: auto;
  width: max-content;
  height: 114px;
  padding: 24px;
  background-color: var(--g-raised);
  border-radius: var(--g-r-card);
  border: 1px solid var(--g-hairline-3);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 24px;
}

.main-content {
  display: flex;
  justify-content: flex-start;
  align-items: center;
}

.left-section, .right-section {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: flex-start;
}

.header {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 12px;
}

.avatar-bg {
  background: var(--g-raised);
}

.header-text {
  color: var(--g-text-1);
  font-size: 24px;
  font-weight: 600;
  line-height: 24px;
  word-wrap: break-word;
}

.amount-section {
  align-self: stretch;
  height: 76px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
}

.amount {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 16px;
}

.highlight-text {
  align-self: stretch;
  color: var(--g-accent);
  font-size: 24px;
  font-weight: 600;
  line-height: 38px;
  word-wrap: break-word;
}

.usd-amount {
  height: 38px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  gap: 16px;
}

.usd-text {
  align-self: stretch;
  text-align: center;
  color: var(--g-text-3);
  font-size: 16px;
  font-weight: 600;
  line-height: 38px;
  word-wrap: break-word;
}

.btn-bg {
  background: var(--g-raised);
}

.btn-content {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  gap: 16px;
}

.btn-text {
  text-transform: capitalize;
  align-self: stretch;
  color: var(--g-accent);
  font-size: 14px;
  font-weight: 600;
  line-height: 38px;
  word-wrap: break-word;
}

.btn-text-disabled {
  text-transform: capitalize;
  align-self: stretch;
  color: var(--g-accent);
  filter: grayscale(0.9);
  font-size: 32px;
  font-weight: 600;
  line-height: 38px;
  word-wrap: break-word;
}

.icon-bg {
  width: 48px;
  height: 48px;
  padding: 12px;
  background: var(--g-raised);
  border-radius: var(--g-r-pill);
  display: flex;
  justify-content: center;
  align-items: center;
}

.icon-container {
  width: 24px;
  height: 24px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: flex-start;
}

.secondary-text {
  align-self: stretch;
  color: var(--g-text-3);
  font-size: 32px;
  font-weight: 600;
  line-height: 38px;
  word-wrap: break-word;
}

.usd-secondary-text {
  align-self: stretch;
  text-align: center;
  color: var(--g-text-3);
  font-size: 16px;
  font-weight: 600;
  line-height: 38px;
  word-wrap: break-word;
}

.theme--dark.v-chip--active:hover::before, .theme--dark.v-chip--active::before {
   opacity: 0;
}

.retailer-initials {
  font-size: 24px;
  font-weight: 600;
  color: var(--g-text-3);
  user-select: none;
}

.bring-web3-logo {
  margin-bottom: 2px;
  opacity: 0.8;
  transition: opacity 0.3s ease;
}

.bring-web3-logo:hover {
  opacity: 1;
}
</style>
