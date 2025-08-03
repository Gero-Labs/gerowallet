<template>
  <v-layout column>

    <!-- Show comprehensive empty state when wallet has no tokens -->
    <template v-if="isWalletEmpty">
      <v-row no-gutters>
        <v-col cols="12" class="pa-2">
          <EmptyStateHero
            :is-new-user="isNewUser"
            :show-tutorial="isNewUser"
            :should-backup="shouldBackup"
            @buy-crypto="handleBuyCrypto"
            @show-receive="handleShowReceive"
            @open-learn="handleOpenLearn"
            @start-tutorial="handleStartTutorial"
            @backup-wallet="handleBackupWallet"
          />
        </v-col>
      </v-row>
    </template>

    <!-- Regular dashboard content when wallet has tokens -->
    <template v-else>
    <!-- Combined row for Cardano with metrics + chart + carousel -->
    <v-row no-gutters v-if="loggedWallet?.network === Network.MAINNET && loggedWallet?.chain === Blockchain.CARDANO">
      <!-- Left side: Chart and Market Data stacked -->
      <v-col cols="12" xl="9" lg="9" md="12" sm="12">
        <!-- Chart row -->
        <v-row no-gutters>
          <v-col cols="12" class="pa-2">
            <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between liquid-glass">
              <v-card-text>
                <PortfolioChart
                  :chart-data="computeChartData.adaData"
                  :chart-data-usd="computeChartData.usdData"
                  :portfolio-value-ada="computedValues.totalValue"
                  :portfolio-value-usd="computedValues.totalValue * (price?.lastPrice || 0)"
                />
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <!-- Market Data Cards row -->
        <v-row no-gutters>
          <v-col cols="12" class="pa-2">
            <TokensMarketCards />
          </v-col>
        </v-row>
      </v-col>

      <!-- Right side: Carousel spanning full height -->
      <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2">
        <FeatureCarousel
          :model-value="currentCarouselIndex"
          @update:modelValue="currentCarouselIndex = $event"
          :items="carouselItems"
          :paused="carouselPaused"
          :is-loading="isLoading"
          :show-progress-bar="true"
          carousel-class="feature-carousel dashboard-card feature-card-full-height"
          @item-click="handleCarouselClick"
        />
      </v-col>
    </v-row>

    <!-- Separate chart row for non-Cardano wallets -->
    <v-row no-gutters v-if="loggedWallet?.network !== Network.MAINNET || loggedWallet?.chain !== Blockchain.CARDANO">
      <v-col cols="12" xl="9" lg="9" md="12" sm="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between liquid-glass">
          <v-card-text>
            <PortfolioChart
              :chart-data="computeChartData.adaData"
              :chart-data-usd="computeChartData.usdData"
              :portfolio-value-ada="computedValues.totalValue"
              :portfolio-value-usd="computedValues.totalValue * (price?.lastPrice || 0)"
            />
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

    <!-- Token Allocation Table and Swap Row -->
    <v-row no-gutters>
      <v-col cols="12" xl="9" lg="9" md="12" sm="12" class="pa-2">
        <TokenAllocationTable />
      </v-col>
      <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2">
        <SwapWidget />
      </v-col>
    </v-row>

    <!-- Transactions and Staking Row + Cashback Column -->
    <v-row no-gutters>
      <v-col cols="12" xl="4" lg="4" md="12" sm="12" class="pa-2">
        <TransactionsCard style="min-height: 396px;"></TransactionsCard>
      </v-col>
      <v-col cols="12" xl="5" lg="5" md="12" sm="12" class="pa-2" v-if="isStakingEnabled">
        <StakingCard2 v-if="account?.controlled_amount && account?.pool_id"></StakingCard2>
        <NoTokensCard v-else></NoTokensCard>
      </v-col>
      <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2">
        <CashbackCard></CashbackCard>
      </v-col>
    </v-row>

    <!-- Claim Dialog -->
    <ClaimDialog
      :show="showClaimDialog"
      @close="showClaimDialog = false"
    />

    </template>
  </v-layout>
</template>
<script setup lang="ts">
import { computed, toRefs, ref, getCurrentInstance } from 'vue';
import PortfolioChart from '../components/PortfolioChart.vue';
import NoTokensCard from '../components/NoTokensCard.vue';
import EmptyStateHero from '../components/EmptyStateHero.vue';
import { Blockchain, Network } from '@/models/types';
import AssetsPieChart from '@/modules/assets/components/AssetsPieChart.vue';
import TokenAllocationTable from '@/modules/assets/components/TokenAllocationTable.vue';
import StakingCard2 from '@/modules/dashboard/components/StakingCard2.vue';
import CashbackCard from '@/modules/dashboard/components/CashbackCard.vue';
import SwapCard from '@/modules/dashboard/components/SwapCard.vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import ClaimDialog from '@/modules/dashboard/dialogs/ClaimDialog.vue';
import FeatureCarousel, { type CarouselItem } from '@/modules/dashboard/components/FeatureCarousel.vue';
import TokensMarketCards from '@/modules/dashboard/components/TokensMarketCards.vue';
import { Cardano } from '@cardano-sdk/core';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { tapToolsStore } from '@/stores/tapToolsStore';
import { isWalletEmpty as checkWalletEmpty, isNewUser as checkNewUser } from '../utils/emptyStateConfigs';

// Import carousel assets
import assets from '@/utils/assets';
import SwapWidget from '@/modules/swap/components/SwapWidget.vue';

// Router (Vue 2 style)
const instance = getCurrentInstance();
const router = instance?.proxy.$router;

// Store refs
const { loggedWallet, transactions, account, tokens } = toRefs(walletStore);
const { price } = toRefs(networkStore);
const { portfolio, portfolioTrendedValue } = toRefs(tapToolsStore);
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

// Empty state computeds
const isWalletEmpty = computed(() => checkWalletEmpty(account.value, tokens.value));
const isNewUser = computed(() => checkNewUser(transactions.value, account.value));
const shouldBackup = computed(() => {
  // Access config directly from reactive store for better reactivity
  const config = walletStore.config;
  return config && 'backup' in config && !config.backup;
});
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

  // Fallback for chains without portfolio API support (like Apex)
  if (!portfolio.value && account.value) {
    if (account.value.controlled_amount && account.value.controlled_amount > 0) {
      // Handle native tokens: 'lovelace' for Cardano, empty string '' for Apex
      assetsValue += account.value.controlled_amount / 1000000 // Convert to main unit (ADA/APEX)
    }
    // Add other asset values if they have USD/ADA pricing data
  }

  const totalValue = assetsValue + collectibles + lpsValue
  return { totalValue, assetsValue, collectibles, lpsValue }
})

const computeChartData = computed(() => {
  // For Cardano mainnet, return ADA and USD data
  if (loggedWallet.value?.chain === Blockchain.CARDANO && loggedWallet.value?.network === Network.MAINNET) {
    return {
      adaData: Array.isArray(portfolioTrendedValue.value) ? portfolioTrendedValue.value : [],
      usdData: [],
    }
  }
  console.log('Computing chart data for non-Cardano wallet...');
  // For other chains, calculate from transactions
  let graphData = undefined
  let currentBalance = 0
  if (transactions.value) {
    graphData = []
    transactions.value.forEach(tx => {
      currentBalance += tx.ada
      graphData.push([tx.tx_timestamp * 1000, currentBalance / 1000000])
    })
  }
  return {
    adaData: graphData || [],
    usdData: [] // No historical USD data for non-mainnet
  }
});

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

// Empty state handlers
const handleBuyCrypto = () => {
  console.log('Opening buy crypto dialog - emitting to parent');
  instance?.proxy?.$emit('open-buy-dialog');
};

const handleShowReceive = () => {
  console.log('Opening receive dialog - emitting to parent');
  instance?.proxy?.$emit('open-receive-dialog');
};

const handleOpenLearn = () => {
  console.log('Opening learning resources...');
  // Could open a modal with tutorials or redirect to docs
  window.open('https://docs.gerowallet.io', '_blank');
};

const handleStartTutorial = () => {
  console.log('Starting interactive tutorial...');
  // Implement interactive tutorial
};

const handleBackupWallet = () => {
  console.log('Backup wallet button clicked - emitting to parent');
  // Emit event to parent component (ContentLayout) to open backup dialog
  instance?.proxy?.$emit('open-backup-dialog');
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

.carousel-wrapper {
  height: 100% !important;
}

.apex-carousel-wrapper {
  background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #2a2a2a 100%);
  height: 100% !important;
}

/* Mini card wrapper styles */
.mini-card-wrapper {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
}

.mini-card-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.05) 50%, rgba(0, 0, 0, 0.1) 100%);
  z-index: 1;
  pointer-events: none;
  border-radius: inherit;
}

.mini-card-wrapper .empty-state-mini {
  position: relative;
  z-index: 2;
  background: transparent !important;
}

.mini-card-wrapper .v-btn {
  position: relative;
  z-index: 10;
  pointer-events: auto;
}
</style>
