<template>
  <v-layout column>
    <!-- Combined row for Cardano with metrics + chart + carousel -->
    <v-row no-gutters v-if="loggedWallet?.network === Network.MAINNET && loggedWallet?.chain === Blockchain.CARDANO">
      <!-- Left side: Metrics and Chart stacked -->
      <v-col cols="12" xl="9" lg="9" md="12" sm="12">
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
        <FeatureCarousel
          :model-value="currentCarouselIndex"
          @update:model-value="currentCarouselIndex = $event"
          :items="carouselItems"
          :paused="carouselPaused"
          :is-loading="isLoading"
          :show-progress-bar="true"
          carousel-class="feature-carousel dashboard-card feature-card-full-height"
          @item-click="handleCarouselClick"
          @mouse-enter="pauseCarousel"
          @mouse-leave="resumeCarousel"
        />
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
      <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2">
        <AssetsPieChart />
      </v-col>

      <!-- Apex Carousel Card -->
      <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2" v-if="loggedWallet?.chain === Blockchain.APEX_PRIME || loggedWallet?.chain === Blockchain.APEX_VECTOR">
        <FeatureCarousel
          :model-value="currentApexCarouselIndex"
          @update:model-value="currentApexCarouselIndex = $event"
          :items="apexCarouselItems"
          :paused="apexCarouselPaused"
          :is-loading="isLoading"
          :show-progress-bar="false"
          carousel-class="feature-carousel dashboard-card feature-card-full-height apex-carousel"
          wrapper-class="apex-carousel-wrapper"
          @item-click="handleCarouselClick"
          @mouse-enter="pauseApexCarousel"
          @mouse-leave="resumeApexCarousel"
        />
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
import { computed, toRefs, ref, getCurrentInstance } from 'vue';
import PortfolioChart from '../components/PortfolioChart.vue';
import NoTokensCard from '../components/NoTokensCard.vue';
import { Blockchain, Network } from '@/models/types';
import AssetsPieChart from '@/modules/assets/components/AssetsPieChart.vue';
import TokenAllocationTable from '@/modules/assets/components/TokenAllocationTable.vue';
import StakingCard2 from '@/modules/dashboard/components/StakingCard2.vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import ClaimDialog from '@/modules/dashboard/dialogs/ClaimDialog.vue';
import FeatureCarousel, { type CarouselItem } from '@/modules/dashboard/components/FeatureCarousel.vue';
import { Cardano } from '@cardano-sdk/core';
import { walletStore } from '@/stores/walletStore';
import filters from '@/shared/utils/filters';
import { networkStore } from '@/stores/networkStore';
import { tapToolsStore } from '@/stores/tapToolsStore';

// Import carousel assets
import assets from '@/utils/assets';

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
const isLoading = ref(false);

// Carousel items for Cardano
const carouselItems = ref<CarouselItem[]>([
  {
    id: 'midnight-drop',
    title: 'Glacier Drop',
    subtitle: 'Claim $NIGHT tokens',
    logo: assets.logoStackedLight,
    logoAlt: 'NIGHT Logo',
    backgroundImage: assets.midnightImage,
    action: 'openClaimDialog'
  },
  {
    id: 'gero-debit-card',
    title: 'Gero Card',
    subtitle: 'Top up ADA instantly! \n Coming soon',
    logo: assets.logoStackedLight,
    logoAlt: 'Gero Logo',
    backgroundImage: assets.debitCardBgImage,
    cardImage: assets.debitCardImage,
    action: 'showDebitCardInfo',
    type: 'debit-card' as const
  },
  {
    id: 'ada-cashback',
    title: 'ADA Cashback',
    subtitle: 'Pay online, and receive ADA Cashback! \n Click to see deals!',
    logo: assets.logoStackedLight,
    logoAlt: 'Gero Logo',
    backgroundImage: assets.cashbackCarouselImage,
    cardImage: assets.cashbackImage,
    action: 'navigateToCashback',
    type: 'ada-cashback' as const
  }
]);

// Carousel items for Apex
const apexCarouselItems = ref<CarouselItem[]>([
  {
    id: 'apex-welcome',
    title: 'Welcome to Apex Fusion',
    subtitle: 'Next-generation blockchain technology',
    logo: assets.geroDashboardApex,
    logoAlt: 'Apex Fusion Logo',
    backgroundImage: assets.apexBgDashboard,
    action: 'showApexWelcome'
  },
  {
    id: 'apex-wallet',
    title: 'Apex Wallet',
    subtitle: 'Secure decentralized storage',
    logo: assets.walletGeroApex,
    logoAlt: 'Apex Wallet Logo',
    backgroundImage: assets.apexImage,
    action: 'showApexWallet'
  },
  {
    id: 'apex-features',
    title: 'Apex Features',
    subtitle: 'Explore advanced capabilities',
    logo: assets.apexSvg,
    logoAlt: 'Apex Features Logo',
    backgroundImage: assets.apexBgDashboard,
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
};

const resumeCarousel = () => {
  carouselPaused.value = false;
};

// Apex carousel methods
const pauseApexCarousel = () => {
  apexCarouselPaused.value = true;
};

const resumeApexCarousel = () => {
  apexCarouselPaused.value = false;
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

/* Dashboard-specific styles */
.feature-card-full-height {
  height: 100% !important;
}

.apex-carousel-wrapper {
  background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #2a2a2a 100%);
}
</style>
