<template>
  <v-card flat outlined class="fill-height liquid-glass cashback-card cashback-card-with-bg">
    <v-card-title>{{ $t('cashback.title') }}</v-card-title>
    <v-card-text class="pa-0" style="height: calc(100% - 64px); display: flex; flex-direction: column;">
      <div>
        <!-- Combined Ready to Claim and Pending Rewards Row -->
        <div class="cashback-combined-row cashback-rewards-section">
          <!-- Ready to Claim Section -->
          <div class="cashback-section">
            <v-list-item-avatar size="32" tile class="mr-2">
              <v-img :src="assets.giftSvg" contain></v-img>
            </v-list-item-avatar>
            <div class="cashback-content">
              <div class="cashback-title">{{ $t('cashback.claim') }}</div>
              <div class="cashback-amounts">
                <div class="highlight-text">{{ filters.toCurrency(eligible ? (eligible.tokenAmount * 1000000) : 0, false, 2, "₳", "", false, 6) }}</div>
              </div>
            </div>
          </div>

          <!-- Pending Rewards Section -->
          <div class="cashback-section">
            <v-list-item-avatar size="32" tile class="mr-2">
              <v-img :src="assets.pendingSvg" contain></v-img>
            </v-list-item-avatar>
            <div class="cashback-content">
              <div class="cashback-title">{{ $t('cashback.pending') }}</div>
              <div class="cashback-amounts">
                <div class="secondary-text">{{ filters.toCurrency(pending ? (pending.tokenAmount * 1000000) : 0, false, 2, "", (pending ? " "+pending.tokenSymbol : ""), false, 6) }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Sushi Train Deals Carousel - 2 Rows -->
        <div class="deals-carousel-container" v-if="randomDeals.length > 0">
          <!-- Top Row - Left to Right -->
          <div class="deals-carousel deals-carousel-ltr">
            <div
              v-for="(deal, index) in duplicatedTopRow"
              :key="`top-${deal.id}-${index}`"
              class="deal-card"
            >
              <div class="deal-avatar" :style="{ backgroundColor: deal.backgroundColor || '#fff' }">
                <img :src="deal.img" :alt="deal.name" />
              </div>
              <div class="deal-info">
                <div class="deal-name">{{ deal.name }}</div>
                <div class="deal-cashback">{{ deal.cashbackText || `${deal.cashbackPercentage}% ${$t('cashback.cashback')}` }}</div>
              </div>
            </div>
          </div>

          <!-- Bottom Row - Right to Left -->
          <div class="deals-carousel deals-carousel-rtl">
            <div
              v-for="(deal, index) in duplicatedBottomRow"
              :key="`bottom-${deal.id}-${index}`"
              class="deal-card"
            >
              <div class="deal-avatar" :style="{ backgroundColor: deal.backgroundColor || '#fff' }">
                <img :src="deal.img" :alt="deal.name" />
              </div>
              <div class="deal-info">
                <div class="deal-name">{{ deal.name }}</div>
                <div class="deal-cashback">{{ deal.cashbackText || `${deal.cashbackPercentage}% ${$t('cashback.cashback')}` }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Go Cashback Button -->
      <div class="cashback-button-container">
        <v-btn elevation="0" height="36" color="var(--g-surface)" @click="navigateToCashback" :disabled="!supported" block>
          <div :class="supported ? 'btn-text' : 'btn-text-disabled'">{{ $t('cashback.goCashback') }}</div>
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, toRefs, getCurrentInstance, ref, onMounted } from 'vue'
import filters from "@/shared/utils/filters"
import { bringStore } from '@/stores/bringStore'
import assets from '@/utils/assets'

const { bringCache } = toRefs(bringStore)

const vmProxy = getCurrentInstance()!.proxy as any

// Deals carousel state
const randomDeals = ref([])

const supported = computed(() => {
  // Add logic to check if cashback is supported in user's country
  // For now, default to true
  return true
})

// Split deals into top and bottom rows
const topRowDeals = computed(() => {
  return randomDeals.value.slice(0, 5)
})

const bottomRowDeals = computed(() => {
  return randomDeals.value.slice(5, 10)
})

// Create duplicated deals for seamless loop animation
const duplicatedTopRow = computed(() => {
  if (topRowDeals.value.length === 0) return []
  // Create just enough duplicates to ensure seamless looping without gaps
  return [...topRowDeals.value, ...topRowDeals.value]
})

const duplicatedBottomRow = computed(() => {
  if (bottomRowDeals.value.length === 0) return []
  // Create just enough duplicates to ensure seamless looping without gaps
  return [...bottomRowDeals.value, ...bottomRowDeals.value]
})

// Mock deals data (expanded to 20 for more variety)
const mockDeals = [
  { id: 1, name: 'Amazon', cashbackPercentage: 2, backgroundColor: '#ff9900', img: 'https://logo.clearbit.com/amazon.com' },
  { id: 2, name: 'eBay', cashbackPercentage: 3, backgroundColor: '#0064d2', img: 'https://logo.clearbit.com/ebay.com' },
  { id: 3, name: 'Nike', cashbackPercentage: 5, backgroundColor: '#000000', img: 'https://logo.clearbit.com/nike.com' },
  { id: 4, name: 'Walmart', cashbackPercentage: 1, backgroundColor: '#004c91', img: 'https://logo.clearbit.com/walmart.com' },
  { id: 5, name: 'Target', cashbackPercentage: 2, backgroundColor: '#cc0000', img: 'https://logo.clearbit.com/target.com' },
  { id: 6, name: 'Best Buy', cashbackPercentage: 4, backgroundColor: '#003b64', img: 'https://logo.clearbit.com/bestbuy.com' },
  { id: 7, name: 'Apple', cashbackPercentage: 1, backgroundColor: '#000000', img: 'https://logo.clearbit.com/apple.com' },
  { id: 8, name: 'Microsoft', cashbackPercentage: 3, backgroundColor: '#00bcf2', img: 'https://logo.clearbit.com/microsoft.com' },
  { id: 9, name: 'Home Depot', cashbackPercentage: 2, backgroundColor: '#f96302', img: 'https://logo.clearbit.com/homedepot.com' },
  { id: 10, name: 'Costco', cashbackPercentage: 2, backgroundColor: '#0064d2', img: 'https://logo.clearbit.com/costco.com' },
  { id: 11, name: 'Starbucks', cashbackPercentage: 3, backgroundColor: '#00704a', img: 'https://logo.clearbit.com/starbucks.com' },
  { id: 12, name: 'McDonald\'s', cashbackPercentage: 2, backgroundColor: '#ffcc00', img: 'https://logo.clearbit.com/mcdonalds.com' },
  { id: 13, name: 'Spotify', cashbackPercentage: 4, backgroundColor: '#1db954', img: 'https://logo.clearbit.com/spotify.com' },
  { id: 14, name: 'Netflix', cashbackPercentage: 1, backgroundColor: '#e50914', img: 'https://logo.clearbit.com/netflix.com' },
  { id: 15, name: 'Uber', cashbackPercentage: 3, backgroundColor: '#000000', img: 'https://logo.clearbit.com/uber.com' },
  { id: 16, name: 'Airbnb', cashbackPercentage: 5, backgroundColor: '#ff5a5f', img: 'https://logo.clearbit.com/airbnb.com' },
  { id: 17, name: 'Booking.com', cashbackPercentage: 2, backgroundColor: '#003580', img: 'https://logo.clearbit.com/booking.com' },
  { id: 18, name: 'Expedia', cashbackPercentage: 3, backgroundColor: '#ffc72c', img: 'https://logo.clearbit.com/expedia.com' },
  { id: 19, name: 'Hotels.com', cashbackPercentage: 4, backgroundColor: '#d32f2f', img: 'https://logo.clearbit.com/hotels.com' },
  { id: 20, name: 'Priceline', cashbackPercentage: 2, backgroundColor: '#0066cc', img: 'https://logo.clearbit.com/priceline.com' }
]

// Function to get 10 random deals
const getRandomDeals = () => {
  const shuffled = [...mockDeals].sort(() => 0.5 - Math.random())
  return shuffled.slice(0, 10)
}

// Initialize random deals on mount
onMounted(() => {
  randomDeals.value = getRandomDeals()
})

const eligible = computed(() => {
  if (bringCache.value && bringCache.value?.data?.eligible?.length > 0) {
    return bringCache.value.data.eligible[0]
  }
  return undefined
})

const pending = computed(() => {
  if (bringCache.value && bringCache.value?.data?.totalPendings?.length > 0) {
    return bringCache.value.data.totalPendings[0]
  }
  return undefined
})

const navigateToCashback = () => {
  vmProxy.$router.push('/cashback').then(() => {
    // Scroll to top of the page after navigation
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })
}
</script>

<style scoped>
.cashback-card {
  width: 100%;
}

.cashback-card-with-bg {
  position: relative;
  overflow: hidden;
}

.cashback-card-with-bg::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image: url('@/assets/cardanoBg.png') !important;
  background-size: auto !important;
  background-position: bottom left !important;
  background-repeat: no-repeat !important;
  opacity: 0.4;
  transform: scale(1.0) translateY(-50%);
  z-index: 1;
  pointer-events: none;
}

.cashback-card-with-bg::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.2);
  z-index: 2;
  pointer-events: none;
}

.cashback-card-with-bg .v-card__title,
.cashback-card-with-bg .v-card__text {
  position: relative;
  z-index: 3;
}


/* Sushi Train Deals Carousel */
.deals-carousel-container {
  margin: 24px 0;
  overflow: hidden;
  width: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  z-index: 3;
}

.deals-carousel {
  display: flex;
  gap: 16px;
  width: fit-content;
}

.deals-carousel-ltr {
  animation: sushi-train-ltr 60s linear infinite;
}

.deals-carousel-rtl {
  animation: sushi-train-rtl 55s linear infinite;
}

.deal-card {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  background: var(--g-raised) !important;
  border-radius: var(--g-r-control);
  padding: 12px 16px;
  min-width: 180px;
  border: 1px solid var(--g-hairline-3);
  isolation: isolate !important;
  position: relative;
  overflow: hidden;
}

.deal-avatar {
  width: 32px;
  height: 32px;
  border-radius: var(--g-r-chip);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  flex-shrink: 0;
}

.deal-avatar img {
  width: 20px;
  height: 20px;
  object-fit: contain;
  border-radius: var(--g-r-chip);
}

.deal-info {
  flex: 1;
  min-width: 0;
}

.deal-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
  margin-bottom: 2px;
}

.deal-cashback {
  font-size: 11px;
  color: var(--g-accent);
  font-weight: 500;
  line-height: 1.2;
}

@keyframes sushi-train-ltr {
  0% {
    transform: translateX(0%);
  }
  100% {
    transform: translateX(-50%);
  }
}

@keyframes sushi-train-rtl {
  0% {
    transform: translateX(-50%);
  }
  100% {
    transform: translateX(0%);
  }
}

.card-text-vertical {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cashback-combined-row {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  gap: 24px;
  width: 100%;
}

.cashback-rewards-section {
  background-color: var(--g-raised) !important;
  background-image: none !important;
  border-radius: 0 !important;
  position: relative !important;
  overflow: hidden !important;
  isolation: isolate !important;
  padding: 8px 14px !important;
  margin: 0 0 !important;
  width: 100% !important;
}

.cashback-section {
  display: flex;
  align-items: flex-start;
  min-width: 0;
}

.cashback-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cashback-title {
  font-size: 14px;
  color: var(--g-text-1);
  font-weight: 500;
}

.cashback-amounts {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.highlight-text {
  color: var(--g-accent);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
}

.secondary-text {
  color: var(--g-text-3);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
}


.btn-text,
.btn-text-disabled {
  text-transform: capitalize;
  background: linear-gradient(90deg, var(--g-grad-1), var(--g-grad-2));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 14px;
  font-weight: 600;
}

.btn-text-disabled {
  filter: grayscale(0.9);
}

.cashback-button-container {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 0 12px 12px 12px;
}
</style>
