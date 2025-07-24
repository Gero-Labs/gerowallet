<template>
  <v-layout column>
    <!-- Combined row for Cardano with metrics + chart + carousel -->
    <v-row no-gutters v-if="loggedWallet?.network === Network.MAINNET && loggedWallet?.chain === Blockchain.CARDANO">
      <!-- Left side: Metrics and Chart stacked -->
      <v-col cols="12" xl="9" lg="9" md="12" sm="12" class="pa-2">
        <!-- Metrics row -->
        <v-row no-gutters class="mb-2">
          <v-col cols="12" xl="4" md="4" sm="4" xs="6" class="pa-2">
            <v-card outlined>
              <v-card-subtitle class="pb-0">{{ `Portfolio`}}</v-card-subtitle>
              <v-card-title class="pt-0">{{ filters.toCurrency(computedValues.totalValue, false, 2, '₳', "", true, 0)}}</v-card-title>
              <v-card-subtitle v-if="price">{{ filters.toCurrency(Number(computedValues.totalValue) * price.lastPrice, false, 2, '$', '', true, 0)  }}</v-card-subtitle>
            </v-card>
          </v-col>
          <v-col cols="12" xl="4" md="4" sm="4" xs="6" class="pa-2">
            <v-card outlined>
              <v-card-subtitle class="pb-0">{{ `Assets`}}</v-card-subtitle>
              <v-card-title class="pt-0">{{ filters.toCurrency(computedValues.assetsValue, false, 2, '₳', "", true, 0) }}</v-card-title>
              <v-card-subtitle v-if="price">{{ filters.toCurrency(Number(computedValues.assetsValue) * price.lastPrice, false, 2, '$', '', true, 0)  }}</v-card-subtitle>
            </v-card>
          </v-col>
          <v-col cols="12" xl="4" md="4" sm="4" xs="6" class="pa-2">
            <v-card outlined>
              <v-card-subtitle class="pb-0">{{ `Collectibles`}}</v-card-subtitle>
              <v-card-title class="pt-0">{{ filters.toCurrency(computedValues.collectibles, false, 2, '₳', "", true, 0) }}</v-card-title>
              <v-card-subtitle v-if="price">{{ filters.toCurrency(Number(computedValues.collectibles) * price.lastPrice, false, 2, '$', '', true, 0)  }}</v-card-subtitle>
            </v-card>
          </v-col>
        </v-row>
        <!-- Chart row -->
        <v-row no-gutters>
          <v-col cols="12" class="pa-2">
            <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
              <v-card-text>
                <PortfolioChart :chart-data="computeChartData" />
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-col>
      
      <!-- Right side: Carousel spanning full height -->
      <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2">
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
                      <div class="debit-card-3d-wrapper" @mousemove="handleCardMouseMove" @mouseleave="handleCardMouseLeave" :style="debitCardStyle">
                        <img 
                          :src="item.cardImage" 
                          alt="Gero Debit Card" 
                          class="debit-card-floating"
                        />
                      </div>
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
    </v-row>
    
    <!-- Separate chart row for non-Cardano wallets -->
    <v-row no-gutters v-if="loggedWallet?.network !== Network.MAINNET || loggedWallet?.chain !== Blockchain.CARDANO">
      <v-col cols="12" xl="9" lg="9" md="12" sm="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
          <v-card-text>
            <PortfolioChart :chart-data="computeChartData" />
          </v-card-text>
        </v-card>
      </v-col>
      
      <!-- Apex Carousel Card -->
      <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2" v-if="loggedWallet?.chain === Blockchain.APEX_PRIME || loggedWallet?.chain === Blockchain.APEX_VECTOR">
        <div class="carousel-wrapper apex-carousel-wrapper" :class="{ 'carousel-behind-overlay': isLoading }" @mouseenter="pauseApexCarousel" @mouseleave="resumeApexCarousel">
          <v-carousel
            v-model="currentApexCarouselIndex"
            :cycle="!apexCarouselPaused"
            :interval="10000"
            height="100%"
            hide-delimiter-background
            show-arrows-on-hover
            class="feature-carousel dashboard-card feature-card-full-height apex-carousel"
          >
            <v-carousel-item
              v-for="(item, index) in apexCarouselItems"
              :key="index"
              :src="item.backgroundImage"
              :class="{ 'apex-welcome-background': item.id === 'apex-welcome' }"
              @click="!isLoading && handleCarouselClick(item)"
            >
              <div class="carousel-overlay apex-carousel-overlay">
                <div class="carousel-content-center">
                  <img 
                    :src="item.logo" 
                    :alt="item.logoAlt" 
                    class="carousel-logo apex-logo mb-3"
                  />
                  <div class="carousel-text apex-text">
                    <v-card-title class="pt-0 white--text text-center carousel-title-large">{{ item.title }}</v-card-title>
                    <v-card-subtitle class="pb-0 white--text text-center">{{ item.subtitle }}</v-card-subtitle>
                  </div>
                </div>
              </div>
            </v-carousel-item>
          </v-carousel>
        </div>
      </v-col>
    </v-row>
    
    <!-- Token Allocation Table -->
    <v-row no-gutters>
      <v-col cols="12" xl="12" lg="12" md="12" sm="12" class="pa-2">
        <TokenAllocationTable />
      </v-col>
    </v-row>
    
    <!-- Staking and Transactions Row -->
    <v-row no-gutters>
      <v-col cols="12" xl="8" lg="7" md="12" sm="12" class="pa-2" v-if="isStakingEnabled">
        <StakingCard2 v-if="account?.controlled_amount && account?.pool_id"></StakingCard2>
        <NoTokensCard v-else></NoTokensCard>
      </v-col>
      <v-col cols="12" xl="4" lg="5" md="12" sm="12" class="pa-2">
        <TransactionsCard></TransactionsCard>
      </v-col>
    </v-row>
    
    <!-- KaiserEx Token Reception -->
    <v-row no-gutters>
      <v-col cols="12" xl="12" lg="12" md="12" sm="12" class="pa-2">
        <v-card outlined>
          <v-card-title>KaiserEx Token Reception</v-card-title>
          <v-card-text>
            <v-btn color="primary" @click="receiveKaiserExToken" :loading="kaiserExLoading">
              Receive Token from KaiserEx
            </v-btn>
            <v-alert v-if="kaiserExMessage" :type="kaiserExMessage.type" class="mt-3">
              {{ kaiserExMessage.text }}
            </v-alert>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
    
    <!-- Claim Dialog -->
    <ClaimDialog
      :show="showClaimDialog"
      @close="showClaimDialog = false"
    />
  </v-layout>
</template>
<script setup lang="ts">
import { computed, toRefs, onMounted, ref, onUnmounted, getCurrentInstance } from 'vue';
import PortfolioChart from '../components/PortfolioChart.vue';
import NoTokensCard from '../components/NoTokensCard.vue';
import { Blockchain, Network } from '@/models/types';
import AssetsPieChart from '@/modules/assets/components/AssetsPieChart.vue';
import TokenAllocationTable from '@/modules/assets/components/TokenAllocationTable.vue';
import StakingCard2 from '@/modules/dashboard/components/StakingCard2.vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import ClaimDialog from '@/modules/dashboard/dialogs/ClaimDialog.vue';
import { Cardano } from '@cardano-sdk/core';
import { walletStore } from '@/stores/walletStore';
import filters from '@/shared/utils/filters';
import { networkStore } from '@/stores/networkStore';
import TapToolsStore, { tapToolsStore } from '@/stores/tapToolsStore';

// Import carousel assets
import midnightImage from '@/assets/midnightlogopng.png';
import midnightVideo from '@/assets/video/midnightBackground.mp4';
import logoStackedLight from '@/assets/logo-stacked-light.svg';
import apexBg from '@/assets/apexBg.png';
import apexImage from '@/assets/apex.png';
import apexSvg from '@/assets/svg/ap3x.svg';
import walletGeroApex from '@/assets/svg/walletGeroApex.svg';
import debitCardBgImage from '@/assets/debitcardbg.png';
import cashbackCarouselImage from '@/assets/cashbackcarousel.png';
import cashbackImage from '@/assets/cashback.png';
import debitCardImage from '@/assets/geroCard.png';
import geroDashboardApex from '@/assets/svg/gero_dashboard_apex.svg';

// Router (Vue 2 style)
const instance = getCurrentInstance();
const router = instance?.proxy.$router;

// Store refs
const { loggedWallet, transactions, account } = toRefs(walletStore);
const { price } = toRefs(networkStore);
const { portfolio, portfolioTrendedValue } = toRefs(tapToolsStore);

const kaiserExLoading = ref(false);
const kaiserExMessage = ref<{ type: string; text: string } | null>(null);
const showClaimDialog = ref(false);

// Carousel state
const currentCarouselIndex = ref(0);
const currentApexCarouselIndex = ref(0);
const carouselPaused = ref(false);
const apexCarouselPaused = ref(false);
const progressValue = ref(0);
const carouselInterval = ref<number | null>(null);
const isLoading = ref(false);

// 3D Card tilt effect
const debitCardStyle = ref<any>({});

// Carousel items for Cardano
const carouselItems = ref([
  {
    id: 'midnight-drop',
    title: 'Glacier Drop',
    subtitle: 'Claim $NIGHT tokens',
    logo: logoStackedLight,
    logoAlt: 'NIGHT Logo',
    backgroundImage: midnightImage,
    videoBackground: midnightVideo,
    action: 'openClaimDialog'
  },
  {
    id: 'gero-debit-card',
    title: 'Gero Card',
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
    subtitle: 'Pay online, and receive ADA Cashback! \n Click to see deals!',
    logo: logoStackedLight,
    logoAlt: 'Gero Logo',
    backgroundImage: cashbackCarouselImage,
    cardImage: cashbackImage,
    action: 'navigateToCashback'
  }
]);

// Carousel items for Apex
const apexCarouselItems = ref([
  {
    id: 'apex-welcome',
    title: 'Welcome to Apex Fusion',
    subtitle: 'Next-generation blockchain technology',
    logo: geroDashboardApex,
    logoAlt: 'Apex Fusion Logo',
    backgroundImage: apexBg,
    action: 'showApexWelcome'
  },
  {
    id: 'apex-wallet',
    title: 'Apex Wallet',
    subtitle: 'Secure decentralized storage',
    logo: walletGeroApex,
    logoAlt: 'Apex Wallet Logo',
    backgroundImage: apexImage,
    action: 'showApexWallet'
  },
  {
    id: 'apex-features',
    title: 'Apex Features',
    subtitle: 'Explore advanced capabilities',
    logo: apexSvg,
    logoAlt: 'Apex Features Logo',
    backgroundImage: apexBg,
    action: 'showApexFeatures'
  }
]);

const isStakingEnabled = computed(() => {
  if (loggedWallet.value?.baseAddress) {
    return Cardano.Address.fromBech32(loggedWallet.value.baseAddress).getType() !== Cardano.AddressType.EnterpriseScript
  }
  return false;
})

const computedValues = computed(() => {
  let assetsValue = 0
  if (portfolio.value?.positionsFt) {
    portfolio.value.positionsFt.forEach(position => {
      assetsValue += position.adaValue
    })
  }
  let collectibles = 0
  if (portfolio.value?.positionsNft) {
    portfolio.value.positionsNft.forEach(position => {
      collectibles += position.adaValue
    })
  }
  let lpsValue = 0
  if (portfolio.value?.positionsLp) {
    portfolio.value.positionsLp.forEach(position => {
      lpsValue += position.adaValue
    })
  }
  const totalValue = assetsValue + collectibles + lpsValue
  return { totalValue, assetsValue, collectibles, lpsValue }
})

const computeChartData = computed(() => {
  if (loggedWallet.value?.chain === Blockchain.CARDANO && loggedWallet.value?.network === Network.MAINNET) {
    return Array.isArray(portfolioTrendedValue.value) ? portfolioTrendedValue.value : []
  }
  let graphData = undefined
  let currentBalance = 0
  if (transactions.value) {
    graphData = []
    transactions.value.forEach(tx => {
      currentBalance += tx.ada
      graphData.push([tx.tx_timestamp * 1000, currentBalance / 1000000])
    })
  }
  return graphData || []
});

// Carousel methods
const pauseCarousel = () => {
  carouselPaused.value = true;
  if (carouselInterval.value) {
    clearInterval(carouselInterval.value);
    carouselInterval.value = null;
  }
};

const resumeCarousel = () => {
  carouselPaused.value = false;
  startProgressBar();
};

// Apex carousel methods
const pauseApexCarousel = () => {
  apexCarouselPaused.value = true;
};

const resumeApexCarousel = () => {
  apexCarouselPaused.value = false;
};

const startProgressBar = () => {
  if (carouselInterval.value) {
    clearInterval(carouselInterval.value);
  }
  
  progressValue.value = 0;
  const increment = 100 / 100; // 100 steps over 10 seconds
  
  carouselInterval.value = setInterval(() => {
    progressValue.value += increment;
    if (progressValue.value >= 100) {
      progressValue.value = 0;
    }
  }, 100) as unknown as number;
};

// 3D Card tilt effect handlers for debit card only
const handleCardMouseMove = (e: MouseEvent) => {
  const card = e.currentTarget as HTMLElement;
  const rect = card.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  // Calculate rotation values based on mouse position
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  
  // Maximum tilt angle in degrees - subtle effect
  const maxTilt = 15;
  
  // Calculate tilt based on distance from center (normalized to -1 to 1)
  // Inverted: card tilts toward mouse position
  const rotateX = ((y - centerY) / centerY) * maxTilt;
  const rotateY = -((x - centerX) / centerX) * maxTilt;
  
  // Create transform style with perspective
  debitCardStyle.value = {
    transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`
  };
};

const handleCardMouseLeave = () => {
  // Reset transform
  debitCardStyle.value = {
    transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)'
  };
};

const handleCarouselClick = (item: any) => {
  switch(item.action) {
    case 'openClaimDialog':
      openClaimDialog();
      break;
    case 'showUpdateInfo':
      showUpdateInfo();
      break;
    case 'showDebitCardInfo':
      showDebitCardInfo();
      break;
    case 'navigateToCashback':
      navigateToCashback();
      break;
    case 'showApexWelcome':
      showApexWelcome();
      break;
    case 'showApexWallet':
      showApexWallet();
      break;
    case 'showApexFeatures':
      showApexFeatures();
      break;
    default:
      console.log('Carousel item clicked:', item.id);
  }
};

const openClaimDialog = () => {
  console.log('Opening claim dialog...');
  showClaimDialog.value = true;
};

const showUpdateInfo = () => {
  console.log('Showing update info...');
  // Add your update info logic here
};

const showDebitCardInfo = () => {
  console.log('Showing debit card info...');
  // Add your debit card info logic here
};

const navigateToCashback = () => {
  // Only navigate if not already on the cashback page
  if (router && router.currentRoute.path !== '/cashback') {
    console.log('Navigating to cashback page...');
    router.push('/cashback');
  }
};

const showApexWelcome = () => {
  console.log('Welcome to Apex Fusion!');
  // Add your Apex welcome logic here
};

const showApexWallet = () => {
  console.log('Showing Apex Wallet info...');
  // Add your Apex wallet logic here
};

const showApexFeatures = () => {
  console.log('Showing Apex Features...');
  // Add your Apex features logic here
};

const loadKaiserExScript = () => {
  if ((window as any).KaiserEx) return;

  const KaiserEx: any = {};

  KaiserEx.baseUrl = 'https://api.dev.kaiserex.cybro.cz';

  KaiserEx.options = {
    width: 800,
    height: 600,
    asWindow: true,
  };

  KaiserEx.loginUrl = function(codeChallenge: string) {
    const params = new URLSearchParams({
      redirect: window.location.href,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });
    return this.baseUrl + '/login?' + params.toString();
  };

  KaiserEx.base64urlEncode = function (str: ArrayBuffer) {
    return btoa(String.fromCharCode(...new Uint8Array(str)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  };

  KaiserEx.generatePKCE = async function () {
    const codeVerifier = [...crypto.getRandomValues(new Uint8Array(64))]
      .map(x => ('0' + x.toString(16)).slice(-2)).join('');

    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const codeChallenge = this.base64urlEncode(hash);

    return { codeVerifier, codeChallenge };
  };

  KaiserEx.auth = async function (completeCallback?: any) {
    if (completeCallback) this.completeCallback = completeCallback;
    console.log('generatePKCE')
    const { codeVerifier, codeChallenge } = await this.generatePKCE();
    this.codeVerifier = codeVerifier;

    console.log('Code verifier:', codeVerifier);
    console.log('Code challenge:', codeChallenge);

    let url = this.loginUrl(codeChallenge);
    console.log('Generated URL:', url);

    if (this.options.asWindow) {
      this.KaiserExWindow = window.open(url, "oauthWindow", "width="+ this.options.width +",height="+ this.options.height);
    } else {
      this.KaiserExWindow = window.open(url, "oauthWindow");
    }

    window.addEventListener("message", this.oauthCodeMessageListener);

    // Note: Cannot set onclose due to cross-origin restrictions
    // The message listener will be cleaned up when the token is received
  };

  KaiserEx.oauthCodeMessageListener = async function(message: MessageEvent) {
    console.log('Received message:', message);
    if (message.origin !== KaiserEx.baseUrl) {
      return;
    }
    if (message.data.type === "OAUTH_CODE") {
      const code = message.data.code;
      if (KaiserEx.KaiserExWindow) {
        KaiserEx.KaiserExWindow.close();
      }
      window.removeEventListener("message", KaiserEx.oauthCodeMessageListener);
      KaiserEx.issueToken(code);
    }
  };

  KaiserEx.issueToken = function(code: string) {
    let data = {
      code,
      codeVerifier: KaiserEx.codeVerifier,
    };

    fetch(KaiserEx.baseUrl + '/api/token', {
      method: 'POST',
      body: JSON.stringify(data),
    })
      .then(response => response.json())
      .then(async (data) => {
        if (KaiserEx.completeCallback) {
          KaiserEx.completeCallback(data);
        }
      });
  };

  (window as any).KaiserEx = KaiserEx;
};

const receiveKaiserExToken = async () => {
  kaiserExLoading.value = true;
  kaiserExMessage.value = null;

  try {
    loadKaiserExScript();

    const kaiserEx = (window as any).KaiserEx;
    kaiserEx.completeCallback = (tokenData: any) => {
      kaiserExMessage.value = {
        type: 'success',
        text: `Token received successfully! Token: ${tokenData.access_token}`
      };
      kaiserExLoading.value = false;
    };

    await kaiserEx.auth();
  } catch (error) {
    kaiserExMessage.value = {
      type: 'error',
      text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
    kaiserExLoading.value = false;
  }
};

onMounted(() => {
  if (loggedWallet.value.stakeAddress) {
    TapToolsStore.loadPortfolio(loggedWallet.value.stakeAddress)
    TapToolsStore.loadPortfolioTrendedValue(loggedWallet.value.stakeAddress)
  }
  
  // Start carousel progress bar
  if (loggedWallet.value?.network === Network.MAINNET && loggedWallet.value?.chain === Blockchain.CARDANO) {
    startProgressBar();
  }
});

onUnmounted(() => {
  if (carouselInterval.value) {
    clearInterval(carouselInterval.value);
  }
});
</script>
<style scoped>
.transactions-table {
  :is(tbody) {
    cursor: pointer;
  }
}

.v-progress-linear__determinate {
  background: linear-gradient(90deg, #00c7f3, #00ffd1);
}

.v-data-table-header {
  background-color: rgb(22, 27, 38);
}

/* Carousel Styles */
.carousel-wrapper {
  position: relative;
  height: 100%;
  border-radius: 8px;
  overflow: hidden;
}

/* Center all v-card-title elements in carousel */
.carousel-wrapper .v-card__title {
  text-align: center !important;
  justify-content: center !important;
}

.carousel-extended-height {
  height: calc(200% + 16px); /* Double height plus gap between rows */
}

.carousel-behind-overlay {
  pointer-events: none;
}

.feature-card-full-height {
  height: 100% !important;
}

.feature-carousel .v-carousel__item {
  height: 100% !important;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  cursor: pointer;
  transition: all 0.3s ease;
}

/* Midnight Background Animation */
@keyframes gentleGrow {
  0% { transform: scale(1); }
  100% { transform: scale(1.08); }
}

/* Counter-animate the overlay to keep it static */
@keyframes counterGrow {
  0% { transform: scale(1); }
  100% { transform: scale(0.926); } /* 1 / 1.08 = 0.926 to counteract the 8% growth */
}

.midnight-background {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  overflow: hidden;
}

/* Target only the background image, keep overlay static */
.midnight-background .v-responsive__content {
  animation: gentleGrow 10s ease-in-out infinite alternate !important;
  transform-origin: center center !important;
}

/* Counter-animate the overlay to keep it static */
.midnight-background .carousel-overlay {
  animation: counterGrow 10s ease-in-out infinite alternate !important;
  transform-origin: center center !important;
}

.carousel-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}


.carousel-content {
  text-align: center;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.carousel-content-center {
  justify-content: center;
}

.carousel-content-top {
  justify-content: center;
  padding-top: 0;
}

.carousel-logo {
  height: 80px;
  width: auto;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.8));
}

.carousel-title-large {
  font-size: 1.75rem !important;
  font-weight: 600 !important;
  line-height: 1.2 !important;
}

.carousel-text-top {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding-top: 0;
  text-align: center;
}

/* Debit Card Styles */
.debit-card-container {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 0;
  height: auto;
  padding: 0px 0;
  perspective: 1000px;
}

/* Floating Animation */
@keyframes float {
  0%, 100% { transform: translateY(0px) rotateX(0deg); }
  50% { transform: translateY(-8px) rotateX(2deg); }
}

.debit-card-3d-wrapper {
  transform-style: preserve-3d;
  transition: transform 0.15s ease-out;
  will-change: transform;
  display: inline-block;
}

.debit-card-floating {
  max-width: 220px;
  max-height: 154px;
  object-fit: contain;
  border-radius: 8px;
  z-index: 2;
  position: relative;
  margin-top: 60px;
  cursor: pointer;
  display: block;
}

.debit-card-glow {
  display: none;
}

.debit-card-text {
  text-align: center;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  margin-top: -50px;
}

.debit-card-title {
  font-size: 1.1rem !important;
  font-weight: 600 !important;
  line-height: 1.2 !important;
  margin-bottom: 5px !important;
}

.debit-card-description {
  font-size: 0.8rem;
  line-height: 1.3;
  margin-bottom: 8px;
}

.debit-card-coming-soon {
  font-size: 0.75rem !important;
  opacity: 0.8;
}

/* Cashback Card Styles */
.cashback-card {
  height: 100%;
}

.cashback-container {
  margin-bottom: 0;
  height: auto;
  padding: 0px 0;
}

.cashback-floating {
  max-width: 275px;
  max-height: 192px;
  object-fit: contain;
  border-radius: 8px;
  z-index: 2;
  position: relative;
  margin-top: 20px;
  cursor: pointer;
  display: block;
  animation: float 4s ease-in-out infinite;
}

.cashback-text {
  text-align: center;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  margin-top: -50px;
}

.cashback-title {
  font-size: 1.1rem !important;
  font-weight: 600 !important;
  line-height: 1.2 !important;
  margin-bottom: 5px !important;
  text-align: center !important;
  width: 100% !important;
  display: block !important;
}

.cashback-subtitle {
  font-size: 0.8rem;
  line-height: 1.3;
  margin-bottom: 8px;
  text-align: center !important;
}

.cashback-cta {
  font-size: 0.75rem !important;
  opacity: 0.8;
  text-align: center !important;
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
  border-radius: 0 !important;
}

.carousel-progress-bar .v-progress-linear__determinate {
  background: linear-gradient(90deg, #00c7f3, #00ffd1) !important;
}

/* Apex Carousel Styles */
.apex-carousel-wrapper {
  background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #2a2a2a 100%);
}

.apex-welcome-background {
  background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #2a2a2a 100%);
}

.apex-carousel-overlay {
  /* No background overlay */
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

/* Enhanced Debit Card Hover Effects */
.feature-carousel:hover {
  transform: translateY(-4px) scale(1.02);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3), 0 0 20px rgba(0, 199, 243, 0.2);
}

.feature-carousel:active {
  transform: translateY(-2px) scale(1.01);
}

/* Enhanced Carousel Styles */
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

/* Apex Carousel Enhanced Styles */
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

.apex-welcome-background .v-responsive__content {
  animation: gentleGrow 10s ease-in-out infinite alternate !important;
  transform-origin: center center !important;
}

.apex-welcome-background .apex-carousel-overlay {
  animation: counterGrow 10s ease-in-out infinite alternate !important;
  transform-origin: center center !important;
}

/* Responsive Styles */
@media (max-width: 960px) {
  .carousel-logo {
    max-width: 60px;
    max-height: 45px;
  }
  
  .carousel-title-large {
    font-size: 1.2rem !important;
  }
  
  .debit-card-floating {
    max-width: 176px;
    max-height: 121px;
  }
  
  .debit-card-container {
    height: auto;
    padding: 15px 0;
  }
  
  .debit-card-title {
    font-size: 1rem !important;
  }
  
  .debit-card-description {
    font-size: 0.75rem;
  }
  
  .cashback-floating {
    max-width: 220px;
    max-height: 151px;
  }
  
  .cashback-container {
    height: auto;
    padding: 15px 0;
  }
}

@media (max-width: 600px) {
  .carousel-content {
    padding: 15px;
  }
  
  .carousel-logo {
    max-width: 50px;
    max-height: 40px;
  }
  
  .carousel-title-large {
    font-size: 1.1rem !important;
  }
  
  .debit-card-floating {
    max-width: 154px;
    max-height: 110px;
  }
  
  .debit-card-container {
    height: auto;
    padding: 10px 0;
  }
  
  .debit-card-title {
    font-size: 0.9rem !important;
  }
  
  .debit-card-description {
    font-size: 0.7rem;
  }
  
  .debit-card-coming-soon {
    font-size: 0.65rem !important;
  }
  
  .cashback-floating {
    max-width: 192px;
    max-height: 137px;
  }
  
  .cashback-container {
    height: auto;
    padding: 10px 0;
  }
}

</style>
