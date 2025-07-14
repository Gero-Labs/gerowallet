<template>
  <v-layout column>
    <v-row no-gutters v-if="loggedWallet?.network === Network.MAINNET && loggedWallet?.chain === Blockchain.CARDANO">
      <v-col cols="12" xl="3" md="3" sm="3" xs="6" class="pa-2">
        <v-card outlined class="dashboard-card">
          <v-card-subtitle class="pb-0">{{ `Portfolio`}}</v-card-subtitle>
          <v-card-title class="pt-0">{{ computedValues.totalValue | toCurrency(false, 2, '₳', "", true, 0)}}</v-card-title>
          <v-card-subtitle>{{ Number(computedValues.totalValue) * price.lastPrice | toCurrency(false, 2, '$', '', true, 0)  }}</v-card-subtitle>
        </v-card>
      </v-col>
      <v-col cols="12" xl="3" md="3" sm="3" xs="6" class="pa-2">
        <v-card outlined class="dashboard-card">
          <v-card-subtitle class="pb-0">{{ `Assets`}}</v-card-subtitle>
          <v-card-title class="pt-0">{{computedValues.assetsValue | toCurrency(false, 2, '₳', "", true, 0) }}</v-card-title>
          <v-card-subtitle>{{ Number(computedValues.assetsValue) * price.lastPrice | toCurrency(false, 2, '$', '', true, 0)  }}</v-card-subtitle>
        </v-card>
      </v-col>
      <v-col cols="12" xl="3" md="3" sm="3" xs="6" class="pa-2">
        <v-card outlined class="dashboard-card">
          <v-card-subtitle class="pb-0">{{ `Collectibles`}}</v-card-subtitle>
          <v-card-title class="pt-0">{{computedValues.collectibles | toCurrency(false, 2, '₳', "", true, 0) }}</v-card-title>
          <v-card-subtitle>{{ Number(computedValues.collectibles) * price.lastPrice | toCurrency(false, 2, '$', '', true, 0)  }}</v-card-subtitle>
        </v-card>
      </v-col>
      <v-col cols="12" xl="3" md="3" sm="3" xs="6" class="pa-2">
        <v-card 
          outlined 
          class="midnight-claim-card dashboard-card" 
          @click="openClaimDialog"
          :style="{ 
            backgroundImage: 'url(' + require('@/assets/Midnight.png') + ')',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            cursor: 'pointer',
            position: 'relative'
          }"
        >
          <div class="midnight-overlay" @click="openClaimDialog">
            <img 
              :src="require('@/assets/logo-stacked-light.svg')" 
              alt="NIGHT Logo" 
              class="night-logo-card mr-3"
            />
            <div class="claim-text-content">
              <v-card-subtitle class="pb-0 white--text">{{ `Midnight Glacier Drop`}}</v-card-subtitle>
              <v-card-title class="pt-0 white--text">{{ `Claim $NIGHT token`}}</v-card-title>
            </div>
          </div>
        </v-card>
      </v-col>
    </v-row>
    <v-row no-gutters>
      <v-col cols="12" xl="9" lg="9" md="12" sm="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
          <v-card-text>
            <PortfolioChart :chart-data="computeChartData" :loading="loadingChart"></PortfolioChart>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2">
        <AssetsPieChart></AssetsPieChart>
      </v-col>
<!--      <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2">-->
<!--        <QuickActions></QuickActions>-->
<!--      </v-col>-->
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
import AssetsPieChart from '@/modules/assets/components/AssetsPieChart.vue';
import TokenAllocationTable from '@/modules/assets/components/TokenAllocationTable.vue';
import StakingCard2 from '@/modules/dashboard/components/StakingCard2.vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import ClaimDialog from '@/modules/dashboard/dialogs/ClaimDialog.vue';
import { walletConfigStore } from '@/stores/modules/walletConfig';
import networks from '@/utils/networks';
import { tapToolsStore } from '@/stores/modules/tapTools';
import { Cardano } from '@cardano-sdk/core';

export default {
  name: 'dashboard',
  components: {
    AssetsPieChart,
    TransactionsCard, StakingCard2, TokenAllocationTable,
    PortfolioChart, NoTokensCard, ClaimDialog },
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
      const totalValue = assetsValue + collectibles + lpsValue
      return { totalValue, assetsValue, collectibles, lpsValue }
    },
    networks() {
      return networks
    },
    Network() {
      return Network
    },
    ...mapState(useStore, ['calculatedTransactions', 'getPools', 'loggedWallet', 'loadingTxs', 'price', 'baseAddress']),
    ...mapState(walletConfigStore, ['account']),
    ...mapState(tapToolsStore, ['portfolio', 'portfolioTrendedValue']),
    computeChartData() {
      if (this.loggedWallet?.chain === Blockchain.CARDANO && this.loggedWallet?.network === Network.MAINNET) {
        return this.portfolioTrendedValue
      }
      let graphData = undefined
      let currentBalance = 0
      if (this.calculatedTransactions) {
        graphData = []
        this.calculatedTransactions.forEach(tx => {
          currentBalance += tx.ada
          graphData.push([tx.tx_timestamp * 1000, currentBalance / 1000000])
        })
      }
      return graphData
    },
  },
  filters,
  data: () => ({
    wallet: undefined,
    store: useStore,
    filters,
    activities: [],
    loadingChart: true,
    transactions: undefined,
    txIos: undefined,
    blockchainDB: undefined,
    showClaimDialog: false
  }),
  methods: {
    openClaimDialog() {
      console.log('Opening claim dialog...');
      this.showClaimDialog = true;
      console.log('showClaimDialog set to:', this.showClaimDialog);
    }
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
  background: linear-gradient(90deg, #00c7f3, #00ffd1);
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
</style>
