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
              <v-card
                outlined
                class="row no-gutters fill-height d-flex justify-space-between align-content-space-between liquid-glass"
              >
                <v-card-text>
                  <PortfolioChart
                    :chart-data="computeChartData.adaData"
                    :chart-data-usd="computeChartData.usdData"
                    :chart-data-eur="computeChartData.eurData"
                    :portfolio-value-ada="currentPortfolioValues.ada"
                    :portfolio-value-usd="currentPortfolioValues.usd"
                    :portfolio-value-eur="currentPortfolioValues.eur"
                    :loading="portfolioLoading"
                    :progressive-loading="true"
                    :first-loaded-currency="firstLoadedCurrency"
                    @refresh="refreshPortfolioChart"
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
          <v-card
            outlined
            class="row no-gutters fill-height d-flex justify-space-between align-content-space-between liquid-glass"
          >
            <v-card-text>
              <PortfolioChart
                :chart-data="computeChartData.adaData"
                :chart-data-usd="computeChartData.usdData"
                :chart-data-eur="computeChartData.eurData"
                :portfolio-value-ada="currentPortfolioValues.ada"
                :portfolio-value-usd="currentPortfolioValues.usd"
                :portfolio-value-eur="currentPortfolioValues.eur"
                :loading="portfolioLoading"
                :progressive-loading="true"
                :first-loaded-currency="firstLoadedCurrency"
                @refresh="refreshPortfolioChart"
              />
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Apex Carousel Card -->
        <v-col
          cols="12"
          xl="3"
          lg="3"
          md="12"
          sm="12"
          class="pa-2"
          v-if="loggedWallet?.chain === Blockchain.APEX_PRIME && loggedWallet?.network === Network.MAINNET"
        >
          <FeatureCarousel
            :model-value="currentApexCarouselIndex"
            @update:model-value="currentApexCarouselIndex = $event"
            :items="apexCarouselItems"
            :paused="apexCarouselPaused"
            :is-loading="isLoading"
            carousel-class="feature-carousel dashboard-card feature-card-full-height apex-carousel"
            wrapper-class="apex-carousel-wrapper"
            @item-click="handleCarouselClick"
            @mouse-enter="pauseApexCarousel"
            @mouse-leave="resumeApexCarousel"
          />
        </v-col>
        <v-col
          cols="12"
          xl="3"
          lg="3"
          md="12"
          sm="12"
          class="pa-2"
          v-else-if="loggedWallet?.network === Network.PREPROD"
        >
          <AssetsPieChart />
        </v-col>
      </v-row>

      <!-- Token Allocation Table Row -->
      <v-row no-gutters>
        <v-col cols="12" class="pa-2">
          <TokenAllocationTable />
        </v-col>
      </v-row>

      <!-- Transactions and Staking Row + Swap Widget Column -->
      <v-row no-gutters>
        <v-col cols="12" :xl="isSwapEnabled ? 4 : 6" :lg="isSwapEnabled ? 4 : 6" md="6" sm="12" class="pa-2">
          <TransactionsCard style="min-height: 426px"></TransactionsCard>
        </v-col>
        <v-col
          cols="12"
          :xl="isSwapEnabled ? 5 : 6"
          :lg="isSwapEnabled ? 5 : 6"
          md="6"
          sm="12"
          class="pa-2"
          v-if="isStakingEnabled"
        >
          <StakingCard2 style="min-height: 426px" v-if="account?.controlled_amount && account?.pool_id"></StakingCard2>
          <NoTokensCard v-else></NoTokensCard>
        </v-col>
        <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2" v-if="isSwapEnabled">
          <SwapWidget class="fill-height" />
        </v-col>
        <!-- <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2">
        <CashbackCard></CashbackCard>
      </v-col> -->
      </v-row>

      <!-- KaiserEx Token Reception -->
      <!--      <v-row no-gutters>-->
      <!--        <v-col cols="12" xl="12" lg="12" md="12" sm="12" class="pa-2">-->
      <!--          <v-card outlined class="liquid-glass">-->
      <!--            <v-card-title>KaiserEx Token Reception</v-card-title>-->
      <!--            <v-card-text>-->
      <!--              <v-btn color="primary" @click="handleReceiveKaiserExToken" :loading="kaiserExLoading">-->
      <!--                Receive Token from KaiserEx-->
      <!--              </v-btn>-->
      <!--              <v-alert v-if="kaiserExMessage" :type="kaiserExMessage.type" class="mt-3">-->
      <!--                {{ kaiserExMessage.text }}-->
      <!--              </v-alert>-->
      <!--            </v-card-text>-->
      <!--          </v-card>-->
      <!--        </v-col>-->
      <!--      </v-row>-->
    </template>
  </v-layout>
</template>
<script setup lang="ts">
import { computed, toRefs, ref, getCurrentInstance, watch } from 'vue';
import PortfolioChart from '../components/PortfolioChart.vue';
import NoTokensCard from '../components/NoTokensCard.vue';
import EmptyStateHero from '../components/EmptyStateHero.vue';
import { Blockchain, Network } from '@/models/types';
import AssetsPieChart from '@/modules/assets/components/AssetsPieChart.vue';
import TokenAllocationTable from '@/modules/assets/components/TokenAllocationTable.vue';
import StakingCard2 from '@/modules/dashboard/components/StakingCard2.vue';
// import CashbackCard from '@/modules/dashboard/components/CashbackCard.vue';
// import SwapCard from '@/modules/dashboard/components/SwapCard.vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import FeatureCarousel, { type CarouselItem } from '@/modules/dashboard/components/FeatureCarousel.vue';
import TokensMarketCards from '@/modules/dashboard/components/TokensMarketCards.vue';
import { Cardano } from '@cardano-sdk/core';
import { walletStore } from '@/stores/walletStore';
import cardStore from '@/stores/modules/card';
import { networkStore } from '@/stores/networkStore';
import { tapToolsStore } from '@/stores/tapToolsStore';
import { isNewUser as checkNewUser } from '../utils/emptyStateConfigs';

import { usePortfolioData } from '@/shared/composables/usePortfolioData';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
// Import carousel assets
import assets from '@/utils/assets';
import SwapWidget from '@/modules/swap/components/SwapWidget.vue';
import networks from '@/utils/networks';
import { getBalance } from '@/chrome/serialization';
// import { receiveKaiserExToken } from '@/services/kaiserEx.service';

// Router (Vue 2 style)
const instance = getCurrentInstance();

// Store refs
const { loggedWallet, transactions, account, utxos, collateral } = toRefs(walletStore);
const { price } = toRefs(networkStore);
const { portfolio } = toRefs(tapToolsStore);
const { usdToEurRate, loadExchangeRate } = useCurrencyConverter();

// Load exchange rate immediately on component mount
loadExchangeRate();

// const kaiserExLoading = ref(false);
// const kaiserExMessage = ref<{ type: string; text: string } | null>(null);

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
    action: 'openMidnightClaimLink',
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
    type: 'debit-card' as const,
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
    type: 'ada-cashback' as const,
  },
]);

// Carousel items for Apex
const apexCarouselItems = ref<CarouselItem[]>([
  {
    id: 'apex-welcome',
    title: 'Apex Fusion',
    subtitle: 'Next-generation blockchain technology',
    logo: assets.geroDashboardApex,
    logoAlt: 'Apex Fusion Logo',
    backgroundImage: assets.apexBgDashboard,
    action: 'showApexWelcome',
  },
  // {
  //   id: 'apex-wallet',
  //   title: 'Apex Wallet',
  //   subtitle: 'Secure decentralized storage',
  //   logo: assets.walletGeroApex,
  //   logoAlt: 'Apex Wallet Logo',
  //   backgroundImage: assets.apexImage,
  //   action: 'showApexWallet',
  // },
  // {
  //   id: 'apex-features',
  //   title: 'Apex Features',
  //   subtitle: 'Explore advanced capabilities',
  //   logo: assets.apexSvg,
  //   logoAlt: 'Apex Features Logo',
  //   backgroundImage: assets.apexBgDashboard,
  //   action: 'showApexFeatures',
  // },
]);

const isStakingEnabled = computed(() => {
  if (loggedWallet.value?.baseAddress) {
    return (
      Cardano.Address.fromBech32(loggedWallet.value.baseAddress).getType() !== Cardano.AddressType.EnterpriseScript
    );
  }
  return false;
});

const isSwapEnabled = computed(() => {
  return networks.resolveSwapSupport(loggedWallet.value?.chain, loggedWallet.value?.network);
});

// Empty state computed
const isWalletEmpty = computed(() => !account.value || account.value?.controlled_amount === 0);
const isNewUser = computed(() => checkNewUser(transactions.value, account.value));
const shouldBackup = computed(() => {
  // Access config directly from the reactive store for better reactivity
  const config = walletStore.config;
  return config && 'backup' in config && !config.backup;
});

const computedValues = computed(() => {
  let assetsValue = 0;
  if (portfolio.value?.positionsFt) {
    portfolio.value.positionsFt.forEach(position => {
      assetsValue += position.adaValue;
    });
  }
  let collectibles = 0;
  if (portfolio.value?.positionsNft) {
    portfolio.value.positionsNft.forEach(position => {
      collectibles += position.adaValue;
    });
  }
  let lpsValue = 0;
  if (portfolio.value?.positionsLp) {
    portfolio.value.positionsLp.forEach(position => {
      lpsValue += position.adaValue;
    });
  }

  // Fallback for chains without portfolio API support (like Apex)
  if (account.value) {
    if (account.value.controlled_amount && account.value.controlled_amount > 0) {
      // Handle native tokens: 'lovelace' for Cardano, empty string '' for Apex
      assetsValue += account.value.controlled_amount / 1000000; // Convert to main unit (ADA/APEX)
    }
    // Add other asset values if they have USD/ADA pricing data
  }
  let totalValue;
  if (portfolio.value?.adaValue) {
    totalValue = portfolio.value.adaValue;
  } else {
    totalValue = Number(getBalance(utxos.value, collateral.value).coin().toString()) / 1000000;
  }
  return { totalValue, assetsValue, collectibles, lpsValue };
});

// Initialize portfolio data composable with a 4-hour cache
const portfolioComposable = usePortfolioData({
  cacheTimeMs: 4 * 60 * 60 * 1000, // 4 hours
  enableCache: true,
});

const {
  adaData: adaChartData,
  usdData: usdChartData,
  eurData: eurChartData,
  isLoading: portfolioLoading,
  loadDataProgressively,
  refreshPortfolioData,
  getCacheStats,
  getCacheStatus,
  firstLoadedCurrency,
  latestPortfolioValues,
} = portfolioComposable;

// Cache current timestamp to avoid computed recalculation
const currentTimestamp = ref(Date.now());

const computeChartData = computed(() => {
  // For Cardano mainnet, return ADA and USD data
  if (loggedWallet.value?.chain === Blockchain.CARDANO && loggedWallet.value?.network === Network.MAINNET) {
    return {
      adaData: adaChartData.value,
      usdData: usdChartData.value,
      eurData: eurChartData.value,
    };
  }
  // For other chains, calculate from transactions
  let graphData = undefined;
  let usdData = undefined;
  let eurData = undefined;

  if (transactions.value && transactions.value.length > 0) {
    graphData = [];
    usdData = [];
    eurData = [];

    // Sort transactions by timestamp in ascending order (oldest first)
    const sortedTransactions = [...transactions.value].sort((a, b) => a.tx_timestamp - b.tx_timestamp);

    // Use cached current time instead of Date.now() to avoid constant reactivity
    const now = currentTimestamp.value;
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;

    // Get first transaction timestamp
    const firstTxTimestamp = sortedTransactions[0].tx_timestamp * 1000;

    // Always start from one year ago with zero balance
    graphData.push([oneYearAgo, 0]);
    usdData.push([oneYearAgo, 0]);
    eurData.push([oneYearAgo, 0]);

    // If first transaction is after one year ago, fill the gap with points every week
    // This ensures the line is visible on all time scales (12M, 3M, 30D, 7D, 1D)
    if (firstTxTimestamp > oneYearAgo) {
      const weekInMs = 7 * 24 * 60 * 60 * 1000; // 1 week
      let currentTime = oneYearAgo + weekInMs;

      // Add a point every week from year ago until first transaction
      while (currentTime < firstTxTimestamp) {
        graphData.push([currentTime, 0]);
        usdData.push([currentTime, 0]);
        eurData.push([currentTime, 0]); // EUR is also 0 when balance is 0
        currentTime += weekInMs;
      }

      // Add a point just before the first transaction (1 second before) for smooth transition
      graphData.push([firstTxTimestamp - 1000, 0]);
      usdData.push([firstTxTimestamp - 1000, 0]);
      eurData.push([firstTxTimestamp - 1000, 0]); // EUR is also 0 when balance is 0
    }

    // Process all transactions
    let currentBalance = 0;
    sortedTransactions.forEach(tx => {
      currentBalance += tx.ada;
      const balanceInAda = currentBalance / 1000000;
      const timestamp = tx.tx_timestamp * 1000;

      graphData.push([timestamp, balanceInAda]);
      const balanceInUsd = balanceInAda * (price.value?.lastPrice || 0);
      usdData.push([timestamp, balanceInUsd]);
      eurData.push([timestamp, balanceInUsd * usdToEurRate.value]);
    });

    // Fill gap from last transaction to now with weekly points
    const lastTxTimestamp = sortedTransactions[sortedTransactions.length - 1].tx_timestamp * 1000;
    const lastBalance = currentBalance / 1000000;

    if (now - lastTxTimestamp > 7 * 24 * 60 * 60 * 1000) {
      const weekInMs = 7 * 24 * 60 * 60 * 1000;
      let currentTime = lastTxTimestamp + weekInMs;

      // Add a point every week from last transaction until now
      while (currentTime < now) {
        graphData.push([currentTime, lastBalance]);
        const balanceUsd = lastBalance * (price.value?.lastPrice || 0);
        usdData.push([currentTime, balanceUsd]);
        eurData.push([currentTime, balanceUsd * usdToEurRate.value]);
        currentTime += weekInMs;
      }
    }

    // Add current point with last known balance
    graphData.push([now, lastBalance]);
    const currentBalanceUsd = lastBalance * (price.value?.lastPrice || 0);
    usdData.push([now, currentBalanceUsd]);
    eurData.push([now, currentBalanceUsd * usdToEurRate.value]);
  }
  return {
    adaData: graphData || [],
    usdData: usdData || [],
    eurData: eurData || [],
  };
});

// Extract current portfolio values from API (latest epoch time from TapTools)
const currentPortfolioValues = computed(() => {
  // For Cardano mainnet, prioritize API values from TapTools
  if (loggedWallet.value?.chain === Blockchain.CARDANO && loggedWallet.value?.network === Network.MAINNET) {
    // Use API values if available (from chart data), otherwise fallback
    return {
      ada: latestPortfolioValues.value.ada !== null ? latestPortfolioValues.value.ada : computedValues.value.totalValue,
      usd: latestPortfolioValues.value.usd !== null ? latestPortfolioValues.value.usd : (computedValues.value.totalValue * (price.value?.lastPrice || 0)),
      eur: latestPortfolioValues.value.eur !== null ? latestPortfolioValues.value.eur : (computedValues.value.totalValue * (price.value?.lastPrice || 0)),
    };
  }

  // For other chains/networks (including Apex), use calculated values from transactions
  const totalValueUsd = computedValues.value.totalValue * (price.value?.lastPrice || 0);
  return {
    ada: computedValues.value.totalValue,
    usd: totalValueUsd,
    eur: totalValueUsd * usdToEurRate.value,
  };
});

// Apex carousel methods
const pauseApexCarousel = () => {
  apexCarouselPaused.value = true;
};

const resumeApexCarousel = () => {
  apexCarouselPaused.value = false;
};

const handleCarouselClick = (item: any) => {
  switch (item.action) {
    case 'openMidnightClaimLink':
      window.open('https://claim.midnight.gd/', '_blank');
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
  }
};

const showUpdateInfo = () => {
  // Add your update info logic here
};

const showDebitCardInfo = () => {
  // Add your debit card info logic here
};

const navigateToCashback = () => {
  // Only navigate if not already on the cashback page
  const proxy = instance?.proxy as any;
  if (proxy && proxy.$router && proxy.$route.path !== '/cashback') {
    proxy.$router.push('/cashback');
  }
};

const showApexWelcome = () => {
  // Add your Apex welcome logic here
};

const showApexWallet = () => {
  // Add your Apex wallet logic here
};

const showApexFeatures = () => {
  // Add your Apex features logic here
};

// const handleReceiveKaiserExToken = async () => {
//   kaiserExLoading.value = true;
//   kaiserExMessage.value = null;
//
//   try {
//     await receiveKaiserExToken(tokenData => {
//       kaiserExMessage.value = {
//         type: 'success',
//         text: `Token received successfully! Token: ${tokenData.access_token}`,
//       };
//       kaiserExLoading.value = false;
//     });
//   } catch (error) {
//     kaiserExMessage.value = {
//       type: 'error',
//       text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
//     };
//     kaiserExLoading.value = false;
//   } finally {
//     // Always ensure loading state is cleared, even if popup was manually closed
//     setTimeout(() => {
//       kaiserExLoading.value = false;
//     }, 1000);
//   }
// };

// Empty state handlers
const handleBuyCrypto = () => {
  instance?.proxy?.$emit('open-buy-dialog');
};

const handleShowReceive = () => {
  instance?.proxy?.$emit('open-receive-dialog');
};

const handleOpenLearn = () => {
  // Could open a modal with tutorials or redirect to docs
  window.open('https://docs.gerowallet.io', '_blank');
};

const handleStartTutorial = () => {
  // Implement interactive tutorial
};

const handleBackupWallet = () => {
  // Emit event to parent component (ContentLayout) to open backup dialog
  instance?.proxy?.$emit('open-backup-dialog');
};

// Portfolio data loading is now handled by usePortfolioData composable
const isApex = computed(() => {
  return loggedWallet.value?.chain === Blockchain.APEX_PRIME || loggedWallet.value?.chain === Blockchain.APEX_VECTOR;
});
// Utility function to refresh portfolio data
const refreshPortfolioChart = async () => {
  const address = loggedWallet.value?.baseAddress;
  if (address && !isApex.value) {
    await refreshPortfolioData(address);
  }
};

// Utility function to get cache information (for debugging)
const getPortfolioCacheInfo = async () => {
  const address = loggedWallet.value?.baseAddress;
  if (!address || isApex.value) {
    return null;
  }

  const stats = await getCacheStats();
  const status = await getCacheStatus(address);

  return { stats, status };
};

// Expose functions for potential use
defineExpose({
  refreshPortfolioChart,
  getPortfolioCacheInfo,
});
// Update timestamp when transactions change
watch(
  () => transactions.value?.length,
  () => {
    // Update timestamp only when transactions actually change
    currentTimestamp.value = Date.now();
  }
);

// Watch for wallet changes to reload portfolio data with parallel loading
watch(
  () => loggedWallet.value?.baseAddress,
  async (newAddress, oldAddress) => {
    if (newAddress && newAddress !== oldAddress) {
      // Update timestamp on wallet change
      currentTimestamp.value = Date.now();
      
      if (!isApex.value) {
        try {
          if (
            account &&
            Number(account.value?.controlled_amount) > 0 &&
            loggedWallet.value?.chain === Blockchain.CARDANO &&
            loggedWallet.value?.network === Network.MAINNET
          ) {
            // Start parallel loading immediately (don't await - let it run in the background)
            loadDataProgressively(newAddress).catch(error => {
              console.warn('Portfolio data loading failed:', error);
            });
          }
        } catch (error) {
          console.warn('Failed to start portfolio data loading:', error);
        }
      }
    }
  },
  { immediate: true } // Load data on mount
);
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
  max-height: 246px;
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
