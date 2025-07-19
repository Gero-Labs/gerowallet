<template>
  <v-layout column>
    <v-row no-gutters>
      <v-col cols="12" xl="9" lg="9" md="12" sm="12" class="pa-2">
        <v-row no-gutters class="fill-height">
          <!-- Portfolio Chart -->
          <v-col cols="12" class="mb-2">
            <v-card outlined class="fill-height dashboard-card-radius">
              <v-card-text>
                <PortfolioChart :chart-data="computeChartData" :portfolio-value-ada="computedValues.totalValue" :portfolio-value-usd="computedValues.totalValue * (price?.lastPrice || 0)"></PortfolioChart>
              </v-card-text>
            </v-card>
          </v-col>
          <!-- Market-style cards for owned tokens -->
          <v-col cols="12" class="pt-0" v-if="loggedWallet?.chain !== Blockchain.APEX_PRIME && loggedWallet?.chain !== Blockchain.APEX_VECTOR">
            <OwnedTokensMarketCards />
          </v-col>
        </v-row>
      </v-col>
      <!-- Midnight Carousel Card -->
      <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2" v-if="loggedWallet?.network === Network.MAINNET && loggedWallet?.chain === Blockchain.CARDANO">
        <div class="carousel-wrapper" :class="{ 'carousel-behind-overlay': isLoading }" @mouseenter="pauseCarousel" @mouseleave="resumeCarousel">
          <v-carousel
            v-model="currentCarouselIndex"
            :cycle="!carouselPaused"
            :interval="10000"
            height="100%"
            hide-delimiter-background
            show-arrows-on-hover
            class="feature-carousel dashboard-card feature-card-full-height"
          >
            <v-carousel-item
              v-for="(item, index) in carouselItems"
              :key="index"
              :src="item.backgroundImage"
              :class="{ 'midnight-background': item.id === 'midnight-drop' }"
              @click="!isLoading && handleCarouselClick(item)"
            >
              <div class="carousel-overlay" :class="{ 
                'carousel-overlay-transparent': item.id === 'gero-debit-card',
                'carousel-overlay-darkened': item.id === 'ada-cashback'
              }">
                <div class="carousel-content" :class="{ 'carousel-content-top': item.id === 'gero-debit-card' || item.id === 'ada-cashback' }">
                  <div v-if="item.id === 'gero-debit-card'" class="carousel-text-top">
                    <div class="debit-card-container">
                      <img 
                        :src="item.cardImage" 
                        alt="Gero Debit Card" 
                        class="debit-card-floating"
                      />
                      <div class="debit-card-glow"></div>
                    </div>
                    <div class="debit-card-text">
                      <v-card-title class="pt-0 pb-0 white--text text-center debit-card-title" style="margin-bottom: 0;">{{ item.title }}</v-card-title>
                      <div class="debit-card-description white--text text-center mb-2">
                        Top up and pay with ADA
                      </div>
                      <v-card-subtitle class="pb-0 white--text text-center debit-card-coming-soon">Coming soon</v-card-subtitle>
                    </div>
                  </div>
                  <div v-else-if="item.id === 'ada-cashback'" class="carousel-text-top cashback-card">
                    <div class="debit-card-container cashback-container">
                      <img 
                        :src="item.cardImage" 
                        alt="ADA Cashback" 
                        class="debit-card-floating cashback-floating"
                      />
                      <div class="debit-card-glow"></div>
                    </div>
                    <div class="debit-card-text cashback-text">
                      <v-card-title class="pt-0 pb-0 white--text text-center debit-card-title cashback-title" style="margin-bottom: 0;">{{ item.title }}</v-card-title>
                      <div class="debit-card-description white--text text-center mb-2 cashback-subtitle">
                        {{ item.subtitle.split('\n')[0] }}
                      </div>
                      <v-card-subtitle class="pb-0 white--text text-center debit-card-coming-soon cashback-cta">
                        {{ item.subtitle.split('\n')[1] }}
                      </v-card-subtitle>
                    </div>
                  </div>
                  <div v-else class="carousel-content-center">
                    <img 
                      :src="item.logo" 
                      :alt="item.logoAlt" 
                      class="carousel-logo mb-3"
                    />
                    <div class="carousel-text">
                      <v-card-title class="pt-0 white--text text-center carousel-title-large">{{ item.title }}</v-card-title>
                      <v-card-subtitle class="pb-0 white--text text-center">{{ item.subtitle }}</v-card-subtitle>
                    </div>
                  </div>
                </div>
              </div>
            </v-carousel-item>
          </v-carousel>
          
          <!-- Custom Progress Bar -->
          <div class="carousel-progress-container">
            <v-progress-linear
              :value="progressValue"
              color="primary"
              height="3"
              class="carousel-progress-bar"
            ></v-progress-linear>
          </div>
        </div>
      </v-col>
      
      <!-- Apex Carousel Card -->
      <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2" v-if="loggedWallet?.chain === Blockchain.APEX_PRIME || loggedWallet?.chain === Blockchain.APEX_VECTOR">
        <div class="carousel-wrapper apex-carousel-wrapper" :class="{ 'carousel-behind-overlay': isLoading }">
          <v-carousel
            v-model="currentApexCarouselIndex"
            :cycle="false"
            height="100%"
            hide-delimiter-background
            hide-delimiters
            hide-navigation
            class="feature-carousel dashboard-card feature-card-full-height apex-carousel"
          >
            <v-carousel-item
              v-for="(item, index) in apexCarouselItems"
              :key="index"
              :src="item.backgroundImage"
              :class="{ 'apex-welcome-background': item.id === 'apex-welcome' }"
            >
              <div class="carousel-overlay apex-carousel-overlay">
                <div class="carousel-content-center">
                  <img 
                    :src="item.logo" 
                    :alt="item.logoAlt" 
                    class="carousel-logo apex-logo mb-3"
                  />
                  <div class="carousel-text apex-text">
                    <div class="apex-title-container">
                      <div class="apex-title-line-1">Welcome to</div>
                      <div class="apex-title-line-2">Apex Fusion</div>
                    </div>
                  </div>
                </div>
              </div>
            </v-carousel-item>
          </v-carousel>
        </div>
      </v-col>
      
      <v-col cols="12" xl="12" lg="12" md="12" sm="12" class="pa-2">
        <TokenAllocationTable></TokenAllocationTable>
      </v-col>
      <v-col cols="12" xl="8" lg="7" md="12" sm="12" class="pa-2" v-if="isStakingEnabled">
        <StakingCard2 v-if="account?.controlled_amount && account?.pool_id"></StakingCard2>
        <NoTokensCard v-else></NoTokensCard>
      </v-col>
      <v-col cols="12" xl="4" lg="5" md="12" sm="12" class="pa-2">
        <TransactionsCard></TransactionsCard>
      </v-col>
    </v-row>
    
    <!-- Claim Dialog -->
    <ClaimDialog
      :show="showClaimDialog"
      @close="showClaimDialog = false"
    />
  </v-layout>
</template>
<script>
import PortfolioChart from '../components/PortfolioChart.vue';
import filters from '@/shared/utils/filters';
import NoTokensCard from '../components/NoTokensCard.vue';
import { useStore } from '@/stores';
import { Blockchain, Network } from '@/models/types';
import {mapState} from "pinia";
import TokenAllocationTable from '@/modules/assets/components/TokenAllocationTable.vue';
import StakingCard2 from '@/modules/dashboard/components/StakingCard2.vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import ClaimDialog from '@/modules/dashboard/dialogs/ClaimDialog.vue';
import OwnedTokensMarketCards from '@/modules/dashboard/components/OwnedTokensMarketCards.vue';
import { walletConfigStore } from '@/stores/modules/walletConfig';
import networks from '@/utils/networks';
import { tapToolsStore } from '@/stores/modules/tapTools';
import { Cardano } from '@cardano-sdk/core';
import midnightImage from '@/assets/Midnight.png';
import cardSoonImage from '@/assets/card-soon.png';
import debitCardImage from '@/assets/debitcard.png';
import debitCardBgImage from '@/assets/debitcardbg.png';
import cashbackImage from '@/assets/cashback.png';
import cashbackCarouselImage from '@/assets/cashbackcarousel.png';
import logoStackedLight from '@/assets/logo-stacked-light.svg';
import apexBg from '@/assets/apexBg.png';
import geroDashboardApex from '@/assets/svg/gero_dashboard_apex.svg';

export default {
  name: 'dashboard',
  components: {
    TransactionsCard, StakingCard2, TokenAllocationTable,
    PortfolioChart, NoTokensCard, ClaimDialog, OwnedTokensMarketCards },
  computed: {
    isStakingEnabled() {
      if (this.baseAddress) {
        return Cardano.Address.fromBech32(this.baseAddress).getType() !== Cardano.AddressType.EnterpriseScript
      }
      return false;
    },
    Blockchain() {
      return Blockchain
    },
    computedValues() {
      let assetsValue = 0
      if (this.portfolio?.positionsFt) {
        this.portfolio.positionsFt.forEach(position => {
          assetsValue += position.adaValue
        })
      }
      let collectibles = 0
      if (this.portfolio?.positionsNft) {
        this.portfolio.positionsNft.forEach(position => {
          collectibles += position.adaValue
        })
      }
      let lpsValue = 0
      if (this.portfolio?.positionsLp) {
        this.portfolio.positionsLp.forEach(position => {
          lpsValue += position.adaValue
        })
      }
      
      // Fallback for chains without portfolio API support (like Apex)
      if (!this.portfolio && this.resolvedAssets) {
        this.resolvedAssets.forEach(asset => {
          if (asset.quantity && asset.quantity > 0) {
            // Handle native tokens: 'lovelace' for Cardano, empty string '' for Apex
            if (asset.unit === 'lovelace' || asset.unit === '') {
              assetsValue += asset.quantity / 1000000 // Convert to main unit (ADA/APEX)
            }
            // Add other asset values if they have USD/ADA pricing data
          }
        })
      }
      
      const totalValue = assetsValue + collectibles + lpsValue
      return { totalValue, assetsValue, collectibles, lpsValue }
    },
    networks() {
      return networks
    },
    Network() {
      return Network
    },
    ...mapState(useStore, ['calculatedTransactions', 'getPools', 'loggedWallet', 'loadingTxs', 'price', 'baseAddress', 'resolvedAssets']),
    ...mapState(walletConfigStore, ['account']),
    ...mapState(tapToolsStore, ['portfolio', 'portfolioTrendedValue']),
    isLoading() {
      return this.loadingTxs || !this.loggedWallet
    },
    computeChartData() {
      if (this.loggedWallet?.chain === Blockchain.CARDANO && this.loggedWallet?.network === Network.MAINNET) {
        return this.portfolioTrendedValue || []
      }
      
      let graphData = []
      let currentBalance = 0
      
      if (this.calculatedTransactions && this.calculatedTransactions.length > 0) {
        this.calculatedTransactions.forEach(tx => {
          currentBalance += tx.ada
          graphData.push([tx.tx_timestamp * 1000, currentBalance / 1000000])
        })
      } else {
        // Fallback: create a single data point with current time and zero balance
        // This ensures the chart shows even with no transaction history
        // Add wallet ID to timestamp to make each wallet's data unique
        const now = new Date().getTime()
        const walletIdOffset = this.loggedWallet?.id ? String(this.loggedWallet.id).charCodeAt(0) : 0
        const uniqueTimestamp = now + walletIdOffset
        graphData.push([uniqueTimestamp, 0])
      }
      
      return graphData
    },
  },
  filters,
  data() {
    return {
      wallet: undefined,
      store: useStore,
      filters,
      activities: [],
      transactions: undefined,
      txIos: undefined,
      blockchainDB: undefined,
      showClaimDialog: false,
      currentCarouselIndex: 0,
      currentApexCarouselIndex: 0,
      progressValue: 0,
      progressInterval: null,
      carouselPaused: false,
      carouselItems: [
        {
          id: 'midnight-drop',
          title: 'Glacier Drop',
          subtitle: 'Claim $NIGHT tokens',
          logo: logoStackedLight,
          logoAlt: 'NIGHT Logo',
          backgroundImage: midnightImage,
          action: 'openClaimDialog'
        },
        {
          id: 'gero-debit-card',
          title: 'Gero Debit Card',
          subtitle: 'Top up ADA instantly! \n Coming soon',
          logo: logoStackedLight,
          logoAlt: 'Gero Logo',
          backgroundImage: debitCardBgImage,
          cardImage: debitCardImage,
          action: 'showDebitCardInfo'
        },
        {
          id: 'ada-cashback',
          title: 'ADA Cashback',
          subtitle: 'Pay with any credit card online, and receive ADA Cashback! \n Click to see deals!',
          logo: logoStackedLight,
          logoAlt: 'Gero Logo',
          backgroundImage: cashbackCarouselImage,
          cardImage: cashbackImage,
          action: 'navigateToCashback'
        }
      ],
      apexCarouselItems: [
        {
          id: 'apex-welcome',
          title: 'Welcome to Apex Fusion',
          logo: geroDashboardApex,
          logoAlt: 'Apex Fusion Logo',
          backgroundImage: apexBg,
          action: 'showApexWelcome'
        }
      ]
    }
  },
  methods: {
    openClaimDialog() {
      console.log('Opening claim dialog...');
      this.showClaimDialog = true;
      console.log('showClaimDialog set to:', this.showClaimDialog);
    },
    startProgressTracking() {
      this.progressValue = 0;
      this.progressInterval = setInterval(() => {
        this.progressValue += 1; // Increment by 1% every 100ms for 10 second cycle
        if (this.progressValue >= 100) {
          this.progressValue = 0; // Reset when cycle completes
        }
      }, 100); // 100ms intervals for smooth progress
    },
    stopProgressTracking() {
      if (this.progressInterval) {
        clearInterval(this.progressInterval);
        this.progressInterval = null;
      }
    },
    resetProgress() {
      this.progressValue = 0;
    },
    handleCarouselClick(item) {
      switch(item.action) {
        case 'openClaimDialog':
          this.openClaimDialog();
          break;
        case 'showUpdateInfo':
          this.showUpdateInfo();
          break;
        case 'showDebitCardInfo':
          this.showDebitCardInfo();
          break;
        case 'navigateToCashback':
          this.navigateToCashback();
          break;
        case 'showApexWelcome':
          this.showApexWelcome();
          break;
        default:
          console.log('Carousel item clicked:', item.id);
      }
    },
    showUpdateInfo() {
      console.log('Showing update info...');
      // Add your update info logic here
    },
    showDebitCardInfo() {
      console.log('Showing debit card info...');
      // Add your debit card info logic here
    },
    navigateToCashback() {
      // Only navigate if not already on the cashback page
      if (this.$route.path !== '/cashback') {
        this.$router.push('/cashback');
      }
    },
    showApexWelcome() {
      console.log('Welcome to Apex Fusion!');
      // Add your Apex welcome logic here
    },
    pauseCarousel() {
      this.carouselPaused = true;
      this.stopProgressTracking();
    },
    resumeCarousel() {
      this.carouselPaused = false;
      // Resume progress tracking from current value instead of restarting
      this.resumeProgressTracking();
    },
    resumeProgressTracking() {
      // Continue from current progress value
      this.progressInterval = setInterval(() => {
        this.progressValue += 1;
        if (this.progressValue >= 100) {
          this.progressValue = 0;
        }
      }, 100);
    }
  },
  watch: {
    currentCarouselIndex() {
      // Reset progress when slide changes (user interaction or auto-advance)
      this.resetProgress();
    }
  },
  mounted() {
    // Ensure progressValue is reactive
    this.$set(this, 'progressValue', 0);
    // Start progress tracking when component mounts
    this.startProgressTracking();
  },
  beforeDestroy() {
    // Clean up interval when component is destroyed
    this.stopProgressTracking();
  }
}
</script>
<style>
.transactions-table {
  :is(tbody) {
    cursor: pointer;
  }
}

.v-progress-linear__determinate {
  background: linear-gradient(90deg, var(--primary-color, #00c7f3), var(--secondary-color, #00ffd1));
}

.v-data-table-header {
  background-color: rgb(22, 27, 38);
}

.dashboard-card {
  height: 120px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.night-logo-card {
  height: 60px;
  width: auto;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.8));
}

.claim-text-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1;
  min-width: 0;
}

.claim-text-content .v-card__subtitle {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 1rem !important;
  line-height: 1.2 !important;
}

.claim-text-content .v-card__title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 1.2rem !important;
  line-height: 1.2 !important;
}

.midnight-claim-card {
  height: 100%;
  transition: all 0.3s ease-in-out;
  overflow: hidden;
  position: relative;
  border-radius: 8px !important;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}

.midnight-claim-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.4),
    transparent
  );
  transition: left 0.5s ease-in-out;
  z-index: 1;
}

.midnight-claim-card:hover::before {
  left: 100%;
}

.midnight-claim-card:hover {
  transform: translateY(-4px) scale(1.02);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3), 0 0 20px rgba(0, 199, 243, 0.2);
}

.midnight-overlay {
  background: rgba(0, 0, 0, 0.5);
  padding: 16px;
  border-radius: 4px;
  height: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  position: relative;
  z-index: 2;
  transition: all 0.3s ease-in-out;
}

.midnight-overlay-centered {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
}

.midnight-content-centered {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.night-logo-card-centered {
  height: 80px;
  width: auto;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.8));
}

.claim-text-content-centered {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.midnight-claim-card:hover .midnight-overlay {
  background: rgba(0, 0, 0, 0.3);
}

.midnight-claim-card .white--text {
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
  transition: all 0.3s ease-in-out;
}

.midnight-claim-card:hover .white--text {
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.8), 0 2px 4px rgba(0, 0, 0, 0.8);
}

.midnight-claim-card:active {
  transform: translateY(-2px) scale(1.01);
}

.dashboard-card-radius {
  border-radius: 8px !important;
}

.feature-card-full-height {
  height: calc(100% - 8px);
}

/* Carousel Styles */
.carousel-wrapper {
  position: relative;
  height: 100%;
}

.carousel-behind-overlay {
  z-index: 1 !important;
  pointer-events: none;
}

.carousel-behind-overlay .feature-carousel {
  opacity: 0.8;
}

.carousel-behind-overlay .carousel-progress-container {
  z-index: 2;
}

.feature-carousel {
  border-radius: 8px !important;
  transition: all 0.3s ease-in-out;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06) !important;
  backdrop-filter: blur(10px) saturate(110%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 
    0 4px 16px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}


.feature-carousel:hover {
  transform: translateY(-4px) scale(1.02);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3), 0 0 20px rgba(0, 199, 243, 0.2);
}

.feature-carousel:active {
  transform: translateY(-2px) scale(1.01);
}

/* Progress Bar Styles */
.carousel-progress-container {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
}

.carousel-progress-bar {
  opacity: 0.7;
  border-radius: 0;
}

.carousel-progress-bar .v-progress-linear__determinate {
  background: linear-gradient(90deg, #00c7f3, #00ffd1) !important;
}

.carousel-overlay {
  background: rgba(0, 0, 0, 0.5);
  padding: 16px;
  border-radius: 4px;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  position: relative;
  z-index: 2;
  transition: all 0.3s ease-in-out;
}

.carousel-overlay-transparent {
  background: transparent !important;
}

.carousel-overlay-darkened {
  background: rgba(0, 0, 0, 0.25) !important;
}

.carousel-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.carousel-content-top {
  justify-content: center !important;
  align-items: center !important;
  width: 100%;
}

.carousel-content-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.carousel-text-top {
  text-align: center;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.debit-card-title {
  font-size: 1.75rem !important;
  font-weight: 600 !important;
  line-height: 1.2 !important;
}

.debit-card-description {
  font-size: 0.95rem !important;
  font-weight: 400 !important;
  line-height: 1.3 !important;
  opacity: 0.9;
}

.debit-card-coming-soon {
  font-size: 0.9rem !important;
  font-weight: 500 !important;
  opacity: 0.8;
  font-style: italic;
}

.cashback-title {
  text-align: center !important;
  justify-content: center !important;
  display: flex !important;
}

.cashback-subtitle {
  text-align: center !important;
  width: 100%;
  margin: 0 auto;
}

/* Debit Card Hover Effects */
.debit-card-container {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 20px;
  perspective: 1000px;
}

.debit-card-floating {
  width: 250px;
  height: auto;
  border-radius: 12px;
  transform-style: preserve-3d;
  filter: drop-shadow(0 10px 20px rgba(0, 199, 243, 0.3));
  position: relative;
  z-index: 2;
}

/* Specific adjustments for cashback card */
.cashback-card {
  margin-top: -15px;
}

.cashback-floating {
  width: 230px;
}

.cashback-container {
  margin-bottom: 15px;
}

.cashback-text {
  margin-top: -5px;
}

.cashback-cta {
  font-size: 0.9rem !important;
  font-weight: 500 !important;
  opacity: 0.8;
  font-style: italic;
  color: #00c7f3 !important;
}

.debit-card-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 275px;
  height: 175px;
  background: radial-gradient(ellipse, rgba(0, 199, 243, 0.3) 0%, transparent 70%);
  transform: translate(-50%, -50%);
  border-radius: 50%;
  opacity: 0;
  z-index: 1;
}

.debit-card-text {
  transform: translateY(0);
}

/* Floating Animation */
@keyframes float {
  0%, 100% { transform: translateY(0px) rotateX(0deg); }
  50% { transform: translateY(-8px) rotateX(2deg); }
}

.debit-card-floating {
  animation: float 4s ease-in-out infinite;
}

/* Midnight Background Animation */
@keyframes gentleGrow {
  0% { transform: scale(1); }
  100% { transform: scale(1.08); }
}

/* Target only the background image, keep overlay static */
.midnight-background {
  overflow: hidden;
}

.midnight-background .v-responsive__content {
  animation: gentleGrow 10s ease-in-out infinite alternate !important;
  transform-origin: center center !important;
}

/* Counter-animate the overlay to keep it static */
.midnight-background .carousel-overlay {
  animation: counterGrow 10s ease-in-out infinite alternate !important;
  transform-origin: center center !important;
}

@keyframes counterGrow {
  0% { transform: scale(1); }
  100% { transform: scale(0.926); } /* 1 / 1.08 = 0.926 to counteract the 8% growth */
}

.carousel-logo {
  height: 80px;
  width: auto;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.8));
}

.carousel-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.carousel-title-large {
  font-size: 1.75rem !important;
  font-weight: 600 !important;
  line-height: 1.2 !important;
}

/* Apex Carousel Specific Styles */
.apex-carousel-wrapper {
  position: relative;
  height: 100%;
}

.apex-carousel {
  border-radius: 8px !important;
  transition: all 0.3s ease-in-out;
  overflow: hidden;
  background: rgba(220, 117, 62, 0.06) !important;
  backdrop-filter: blur(10px) saturate(110%);
  border: 1px solid rgba(220, 117, 62, 0.12);
  box-shadow: 
    0 4px 16px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(220, 117, 62, 0.08);
}

.apex-carousel:hover {
  transform: translateY(-4px) scale(1.02);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3), 0 0 20px rgba(220, 117, 62, 0.2);
}

.apex-carousel-overlay {
  background: rgba(0, 0, 0, 0.4);
  padding: 16px;
  border-radius: 4px;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  position: relative;
  z-index: 2;
  transition: all 0.3s ease-in-out;
}

.apex-welcome-background {
  overflow: hidden;
}

.apex-welcome-background .v-responsive__content {
  animation: gentleGrow 10s ease-in-out infinite alternate !important;
  transform-origin: center center !important;
}

.apex-welcome-background .apex-carousel-overlay {
  animation: counterGrow 10s ease-in-out infinite alternate !important;
  transform-origin: center center !important;
}

.apex-logo {
  height: 90px;
  width: auto;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 10px rgba(220, 117, 62, 0.3));
}

.apex-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.apex-title-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.apex-title-line-1 {
  font-size: 1.4rem !important;
  font-weight: 400 !important;
  line-height: 1.1 !important;
  color: #ffffff !important;
  opacity: 0.9;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
  margin-bottom: 2px;
}

.apex-title-line-2 {
  font-size: 2rem !important;
  font-weight: 700 !important;
  line-height: 1.1 !important;
  color: #ffffff !important;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8), 0 0 10px rgba(220, 117, 62, 0.4);
}

</style>
