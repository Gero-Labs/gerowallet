<template>
  <v-card class="transparent" flat>
    <v-card-title class="justify-center text-center" style="font-size: 32px">
      ADA Cashback
    </v-card-title>
    <v-card-subtitle class="justify-center text-center" style="font-size: 18px">
      Receive ADA when shopping online!
    </v-card-subtitle>
    <v-card-subtitle class="justify-center text-center pt-0">
      <v-btn class="geroButton" style="color:black!important" rounded color="primary" @click="isHowItWorksDialogOpen = true">
        How it works?
      </v-btn>
    </v-card-subtitle>
    <v-card-text>
      <div class="card-text">
        <div class="main-content">
          <div class="left-section">
            <div class="header">
              <v-avatar size="48" class="avatar-bg">
                <v-icon color="#00DFF3">mdi-gift-outline</v-icon>
              </v-avatar>
              <div class="header-text">Ready to Claim</div>
            </div>
            <div class="amount-section">
              <div class="amount">
                <div class="highlight-text">{{ eligible ? eligible.tokenAmount : 0 | toCurrency(false, 2, "", (eligible ? " "+eligible.tokenSymbol : ""), false) }}</div>
              </div>
              <div class="usd-amount">
                <div class="usd-text">{{ eligible ? eligible.totalEstimatedUsd : 0 | toCurrency(false, 2, '$', '', false) }}</div>
              </div>
            </div>
          </div>
          <v-btn outlined height="148" color="#00C7F3" class="btn-bg" @click="isRewardsDialogOpen = true">
            <div class="btn-content">
              <v-avatar size="56" class="avatar-bg">
                <v-icon color="white" style="font-size: 28px">mdi-gift-open-outline</v-icon>
              </v-avatar>
              <div class="btn-text">View Rewards</div>
            </div>
          </v-btn>
          <div class="right-section">
            <div class="header">
              <div class="icon-bg">
                <div class="icon-container">
                  <v-icon color="#A3A3A3">mdi-timer-sand</v-icon>
                </div>
              </div>
              <div class="header-text">Pending rewards</div>
            </div>
            <div class="amount-section">
              <div class="amount">
                <div class="secondary-text">{{ pending ? pending.tokenAmount : 0 | toCurrency(false, 2, "", (pending ? " "+pending.tokenSymbol : ""), false) }}</div>
              </div>
              <div class="usd-amount">
                <div class="usd-secondary-text">{{ pending ? pending.totalEstimatedUsd : 0 | toCurrency(false, 2, '$', '', false) }}</div>
              </div>
            </div>
          </div>
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
          <v-chip-group v-else v-model="selectedCategoryIndex" column mandatory active-class="primary--text" >
            <v-chip color="#CECFD2" class="ma-1" style="background-color: #333741!important;" outlined v-for="item in categories?.items" :key="item.id">
              {{ item.name }}
            </v-chip>
          </v-chip-group>
        </v-col>
        <v-col cols="12" xl="2" lg="2" md="2">
        </v-col>
        <v-col cols="12" xl="4" lg="4" md="4">
          <v-autocomplete
            flat
            v-model="model"
            :search-input.sync="search"
            :items="terms"
            :loading="isLoading"
            label="Brand, product, destination"
            outlined
            solo
            dense
            prepend-inner-icon="mdi-magnify"
            clearable
            hide-details
            hide-no-data
            hide-selected
            :filter="customAutoCompleteFilter"
            attach
          >
          </v-autocomplete>
          <div class="pt-4" v-if="totalItems > 0">
            {{ totalItems }} Deals Found
          </div>
        </v-col>
      </v-row>
      <v-row class="mt-4" v-show="!isLoading">
        <v-col cols="12" md="3" style="border-radius: 16px" v-for="retailer in deals" :key="retailer.id">
          <v-card class="pa-4 fill-height" flat outlined style="background-color: black!important; border-radius: 16px; text-align: center;" color="primary" @click.stop="openRetailerDialog(retailer)">
            <v-avatar :color="retailer.backgroundColor ? retailer.backgroundColor : '#fff'" size="80" v-if="retailer.img">
              <v-img :src="retailer.img" contain style="margin: auto;" eager></v-img>
            </v-avatar>
            <v-card-title class="justify-center px-0" style="word-break: break-word;">{{retailer.section ?  (retailer.name + " > " + retailer.section) : retailer.name}}</v-card-title>
            <v-card-subtitle class="px-0 pb-0" style="word-break: break-word; color: #00DFF3">Up to {{ Number(retailer.maxCashback).toFixed(0) }}{{retailer.cashbackSymbol}} Cashback</v-card-subtitle>
          </v-card>
        </v-col>
      </v-row>
      <v-row class="mt-4" v-show="isLoading">
        <v-col cols="12" md="3" style="border-radius: 16px" v-for="i in 12" :key="i">
          <v-skeleton-loader
            height="183"
            type="image"
          ></v-skeleton-loader>
        </v-col>
      </v-row>
    </v-card-text>
    <v-card-actions class="justify-center text-center" style="flex-direction: column;">
      <v-card-title>
        {{ loadingMore ? "Loading ..." : "" }}
      </v-card-title>
      <v-card-title style="font-size: 14px" v-intersect="onIntersect">
        Powered By&nbsp;<v-btn color="primary" class="px-0 mx-0" :ripple="false" style="min-width: 20px ;text-transform: capitalize; letter-spacing: normal;" text href="https://bringweb3.io/" target="_blank">Bring</v-btn>
      </v-card-title>
    </v-card-actions>
    <ViewRewardsDialog :isOpen="isRewardsDialogOpen" @close="isRewardsDialogOpen = false"></ViewRewardsDialog>
    <RetailerDialog :isOpen="isRetailerDialogOpen" @close="closeRetailerDialog" :retailer="retailer" :retailer-terms-base-path="retailerTermsBasePath"></RetailerDialog>
    <HowItWorksDialog :isOpen="isHowItWorksDialogOpen" @close="isHowItWorksDialogOpen = false"></HowItWorksDialog>
  </v-card>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import {appWallet, useStore} from '@/store';
import ViewRewardsDialog from '@/modules/cashback/dialogs/ViewRewardsDialog.vue';
import {mapState} from "pinia";
import filters from "@/shared/utils/filters";
import RetailerDialog from '@/modules/cashback/dialogs/RetailerDialog.vue';
import HowItWorksDialog from '@/modules/cashback/dialogs/HowItWorksDialog.vue';

export default defineComponent({
  name: 'Cashback.vue',
  components: { HowItWorksDialog, RetailerDialog, ViewRewardsDialog},
  computed: {
    ...mapState(useStore, ['bringCache']),
    terms() {
      return this.entries
    },
    selectedCategory() {
      return this.categories.items[this.selectedCategoryIndex]
    },
    eligible() {
      if (this.bringCache && this.bringCache?.data?.eligible?.length > 0) {
        return this.bringCache.data.eligible[0]
      }
      return undefined
    },
    pending() {
      if (this.bringCache && this.bringCache?.data?.totalPendings?.length > 0) {
        return this.bringCache.data.totalPendings[0]
      }
      return undefined
    },
    deals() {
      return Object.values(this.retailers)
    }
  },
  watch: {
    async isIntersecting(val) {
      if (val) {
        console.log(val)
        if (this.nextPage) {
          this.loadingMore = true
          const retailers = await appWallet.api.retailers(this.selectedCategory?.id, this.model, this.nextPage)
          this.retailers = {...this.retailers, ...retailers.items.reduce((obj, item) => Object.assign(obj, { [item.id]: {...item,img: retailers.retailerIconBasePath+item.iconPath+retailers.iconQueryParam} }), {}) }
          this.nextPage = retailers.nextPageNumber
          console.log(this.retailers)
          this.loadingMore = false
        }
      }
    },
    async model(val) {
      console.log(val)
      this.isLoading = true
      if (val) {
        const retailers = await appWallet.api.retailers(0, val)
        this.retailers = retailers.items.reduce((obj, item) => Object.assign(obj, { [item.id]: {...item,img: retailers.retailerIconBasePath+item.iconPath+retailers.iconQueryParam} }), {})
        this.nextPage = retailers.nextPageNumber
        this.totalItems = retailers.totalItems
      } else {
        const retailers = await appWallet.api.retailers(this.selectedCategory.id)
        this.retailers = retailers.items.reduce((obj, item) => Object.assign(obj, { [item.id]: {...item,img: retailers.retailerIconBasePath+item.iconPath+retailers.iconQueryParam} }), {})
        this.nextPage = retailers.nextPageNumber
        this.totalItems = retailers.totalItems
      }
      this.isLoading = false
    },
    search() {
      // Items have already been loaded
      if (this.terms.length > 0) return
      // Items have already been requested
      if (this.isLoading) return
      this.isLoading = true
      appWallet.api.searchTerms()
        .then(res => this.entries = res.items)
        .catch(err => console.log(err))
        .finally(() => this.isLoading = false)
    },
    async selectedCategory() {
      this.model = ""
      if (this.selectedCategory) {
        const retailers = await appWallet.api.retailers(this.selectedCategory.id)
        this.retailers = retailers.items.reduce((obj, item) => Object.assign(obj, { [item.id]: {...item,img: retailers.retailerIconBasePath+item.iconPath+retailers.iconQueryParam} }), {})
        console.log(retailers)
        this.nextPage = retailers.nextPageNumber
        this.generalTermsUrl = retailers.generalTermsUrl
        this.retailerTermsBasePath = retailers.retailerTermsBasePath
        this.totalItems = retailers.totalItems
        this.isLoading = false
      }
    }
  },
  methods: {
    onIntersect (entries, observer) {
      this.isIntersecting = entries[0].isIntersecting

    },
    openRetailerDialog(retailer) {
      this.retailer = retailer
      this.isRetailerDialogOpen = true
    },
    closeRetailerDialog() {
      this.isRetailerDialogOpen = false
      this.retailer = null
    },
    customAutoCompleteFilter(item, queryText) {
      if (!queryText) {
        return false
      }
      return item.toLowerCase().startsWith(queryText.toLowerCase())
    }
  },
  filters,
  data() {
    return {
      isIntersecting: false,
      selectedCategoryIndex: 0,
      entries: [],
      model: null,
      search: null,
      categories: {
        items: []
      },
      chipLoading: false,
      isLoading: false,
      loadingMore: false,
      retailers: {},
      nextPage: null,
      isRewardsDialogOpen: false,
      isRetailerDialogOpen: false,
      isHowItWorksDialogOpen: false,
      retailer: null,
      generalTermsUrl: null,
      retailerTermsBasePath: null,
      totalItems: null
    }
  },
  async mounted() {
    this.chipLoading = true
    this.isLoading = true
    const isAvailable = await appWallet.api.checkAvailability()
    if (isAvailable) {
      const cat = await appWallet.api.categories()
      this.categories.items = [{ iconSvg: "", id: 0, name: "All Categories"}]
      this.categories.items.push(...cat.items)
      this.chipLoading = false
    }
  },
});
</script>
<style scoped>
.card-text {
  width: 100%;
  height: 100%;
  padding: 24px;
  background: linear-gradient(90deg, rgb(0, 14, 17), rgb(0, 19, 16));
  border-radius: 12px;
  border: 1px solid #00DFF3;
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
  gap: 80px;
}

.left-section, .right-section {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 24px;
}

.header {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 12px;
}

.avatar-bg {
  background: linear-gradient(134deg, rgba(0, 199.26, 243, 0.25) 40%, rgba(0, 255, 209.10, 0.25) 100%);
}

.header-text {
  color: white;
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
  background: linear-gradient(to right, #00c7f3, #00fad5);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 30px;
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
  color: #A3A3A3;
  font-size: 16px;
  font-weight: 600;
  line-height: 38px;
  word-wrap: break-word;
}

.btn-bg {
  background: linear-gradient(112deg, rgba(255, 255, 255, 0.20) 0%, rgba(203.10, 203.10, 203.10, 0) 100%);
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
  background: linear-gradient(to right, #00c7f3, #00fad5);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 30px;
  font-weight: 600;
  line-height: 38px;
  word-wrap: break-word;
}

.icon-bg {
  width: 48px;
  height: 48px;
  padding: 12px;
  background: linear-gradient(134deg, rgba(183.73, 183.73, 183.73, 0.25) 40%, rgba(77.03, 77.03, 77.03, 0.25) 100%);
  border-radius: 9999px;
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
  color: #A3A3A3;
  font-size: 30px;
  font-weight: 600;
  line-height: 38px;
  word-wrap: break-word;
}

.usd-secondary-text {
  align-self: stretch;
  text-align: center;
  color: #737373;
  font-size: 16px;
  font-weight: 600;
  line-height: 38px;
  word-wrap: break-word;
}
</style>
