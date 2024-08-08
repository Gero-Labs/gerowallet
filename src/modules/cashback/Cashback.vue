<template>
  <v-card class="transparent" flat>
    <v-card-title class="justify-center text-center" style="font-size: 32px">
      ADA Cashback
    </v-card-title>
    <v-card-subtitle class="justify-center text-center" style="font-size: 18px">
      Receive ADA when shopping online!
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
                <div class="highlight-text">A100.00</div>
              </div>
              <div class="usd-amount">
                <div class="usd-text">$1,280</div>
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
                <div class="secondary-text">A100.00</div>
              </div>
              <div class="usd-amount">
                <div class="usd-secondary-text">$1,280</div>
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
              v-for="i in 9"
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
        <v-col cols="12" xl="3" lg="3" md="3">
        </v-col>
        <v-col cols="12" xl="3" lg="3" md="3">
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
          <div class="pt-4" v-if="retailers.length > 0">
            {{ retailers.length }} Deals Found
          </div>
        </v-col>
      </v-row>
      <v-row class="mt-4" v-show="!isLoading">
        <v-col cols="12" md="3" style="border-radius: 16px" v-for="retailer in retailers" :key="retailer.id">
          <v-card class="pa-4 fill-height" flat outlined style="background-color: black!important; border-radius: 16px; text-align: center;" color="primary" @click.stop="openRetailerDialog(retailer)">
            <v-avatar color="white" size="80" v-if="retailer.img">
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
    <ViewRewardsDialog :isOpen="isRewardsDialogOpen" @close="isRewardsDialogOpen = false"></ViewRewardsDialog>
  </v-card>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import { appWallet } from '@/store';
import ViewRewardsDialog from '@/modules/cashback/dialogs/ViewRewardsDialog.vue';

export default defineComponent({
  name: 'Cashback.vue',
  components: { ViewRewardsDialog},
  computed: {
    terms() {
      return this.entries
    },
    selectedCategory() {
      return this.categories.items[this.selectedCategoryIndex]
    }
  },
  watch: {
    async model(val) {
      this.isLoading = true
      if (val) {
        const retailers = await appWallet.api.retailers(undefined, val)
        const retailerIconBasePath = retailers.retailerIconBasePath
        const iconQueryParam = retailers.iconQueryParam
        this.retailers = retailers.items.map(item => {
          item.img = retailerIconBasePath+item.iconPath+iconQueryParam
          return item
        })
      } else {
        const retailers = await appWallet.api.retailers(this.selectedCategory.id)
        const retailerIconBasePath = retailers.retailerIconBasePath
        const iconQueryParam = retailers.iconQueryParam
        this.retailers = retailers.items.map(item => {
          item.img = retailerIconBasePath+item.iconPath+iconQueryParam
          return item
        })
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
      const retailers = await appWallet.api.retailers(this.selectedCategory.id)
      const retailerIconBasePath = retailers.retailerIconBasePath
      const iconQueryParam = retailers.iconQueryParam
      this.retailers = retailers.items.map(item => {
        item.img = retailerIconBasePath+item.iconPath+iconQueryParam
        return item
      })
    }
  },
  methods: {
    openRetailerDialog(retailer) {
      console.log(retailer)
    },
    customAutoCompleteFilter(item, queryText) {
      if (!queryText) {
        return false
      }
      return item.toLowerCase().startsWith(queryText.toLowerCase())
    }
  },
  data() {
    return {
      selectedCategoryIndex: 0,
      entries: [],
      model: null,
      search: null,
      categories: {
        items: []
      },
      chipLoading: false,
      isLoading: false,
      retailers: [],
      isRewardsDialogOpen: false,
    }
  },
  async mounted() {
    this.chipLoading = true
    this.isLoading = true
    const isAvailable = await appWallet.api.checkAvailability()
    if (isAvailable) {
      this.categories = await appWallet.api.categories()
      this.chipLoading = false
      if (this.categories?.items.length > 0) {
        const retailers = await appWallet.api.retailers(this.selectedCategory.id)
        const retailerIconBasePath = retailers.retailerIconBasePath
        const iconQueryParam = retailers.iconQueryParam
        this.retailers = retailers.items.map(item => {
          item.img = retailerIconBasePath+item.iconPath+iconQueryParam
          return item
        })

        const generalTermsUrl = retailers.generalTermsUrl
        const retailerTermsBasePath = retailers.retailerTermsBasePath
        console.log(retailers)
      }
    }
    this.isLoading = false
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
