<template>
  <v-layout column>
    <v-row no-gutters v-if="loggedWallet?.network === Network.MAINNET && loggedWallet?.chain === Blockchain.CARDANO">
      <v-col cols="12" xl="3" md="3" sm="3" xs="6" class="pa-2">
        <v-card outlined>
          <v-card-subtitle class="pb-0">{{ `Portfolio`}}</v-card-subtitle>
          <v-card-title class="pt-0">{{ filters.toCurrency(computedValues.totalValue, false, 2, '₳', "", true, 0)}}</v-card-title>
          <v-card-subtitle v-if="price">{{ filters.toCurrency(Number(computedValues.totalValue) * price.lastPrice, false, 2, '$', '', true, 0)  }}</v-card-subtitle>
        </v-card>
      </v-col>
      <v-col cols="12" xl="3" md="3" sm="3" xs="6" class="pa-2">
        <v-card outlined>
          <v-card-subtitle class="pb-0">{{ `Assets`}}</v-card-subtitle>
          <v-card-title class="pt-0">{{ filters.toCurrency(computedValues.assetsValue, false, 2, '₳', "", true, 0) }}</v-card-title>
          <v-card-subtitle v-if="price">{{ filters.toCurrency(Number(computedValues.assetsValue) * price.lastPrice, false, 2, '$', '', true, 0)  }}</v-card-subtitle>
        </v-card>
      </v-col>
      <v-col cols="12" xl="3" md="3" sm="3" xs="6" class="pa-2">
        <v-card outlined>
          <v-card-subtitle class="pb-0">{{ `Collectibles`}}</v-card-subtitle>
          <v-card-title class="pt-0">{{ filters.toCurrency(computedValues.collectibles, false, 2, '₳', "", true, 0) }}</v-card-title>
          <v-card-subtitle v-if="price">{{ filters.toCurrency(Number(computedValues.collectibles) * price.lastPrice, false, 2, '$', '', true, 0)  }}</v-card-subtitle>
        </v-card>
      </v-col>
      <v-col cols="12" xl="3" md="3" sm="3" xs="6" class="pa-2">
        <v-card outlined>
          <v-card-subtitle class="pb-0">{{ `Liquidity`}}</v-card-subtitle>
          <v-card-title class="pt-0">{{ filters.toCurrency(computedValues.lpsValue, false, 2, '₳', "", true, 0) }}</v-card-title>
          <v-card-subtitle v-if="price">{{ filters.toCurrency(Number(computedValues.lpsValue) * price.lastPrice, false, 2, '$', '', true, 0)  }}</v-card-subtitle>
        </v-card>
      </v-col>
    </v-row>
    <v-row no-gutters>
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
      <v-col cols="12" xl="12" lg="12" md="12" sm="12" class="pa-2">
        <TokenAllocationTable />
      </v-col>
      <v-col cols="12" xl="8" lg="7" md="12" sm="12" class="pa-2" v-if="isStakingEnabled">
        <StakingCard2 v-if="account?.controlled_amount && account?.pool_id"></StakingCard2>
        <NoTokensCard v-else></NoTokensCard>
      </v-col>
      <v-col cols="12" xl="4" lg="5" md="12" sm="12" class="pa-2">
        <TransactionsCard></TransactionsCard>
      </v-col>
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
  </v-layout>
</template>
<script setup lang="ts">
import { computed, toRefs, onMounted, ref } from 'vue';
import PortfolioChart from '../components/PortfolioChart.vue';
import NoTokensCard from '../components/NoTokensCard.vue';
import { Blockchain, Network } from '@/models/types';
import AssetsPieChart from '@/modules/assets/components/AssetsPieChart.vue';
import TokenAllocationTable from '@/modules/assets/components/TokenAllocationTable.vue';
import StakingCard2 from '@/modules/dashboard/components/StakingCard2.vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import { Cardano } from '@cardano-sdk/core';
import { walletStore } from '@/stores/walletStore';
import filters from '@/shared/utils/filters';
import { networkStore } from '@/stores/networkStore';
import TapToolsStore, { tapToolsStore } from '@/stores/tapToolsStore';

const { loggedWallet, transactions, account } = toRefs(walletStore);
const { price } = toRefs(networkStore);
const { portfolio, portfolioTrendedValue } = toRefs(tapToolsStore);

const kaiserExLoading = ref(false);
const kaiserExMessage = ref<{ type: string; text: string } | null>(null);

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
})
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
</style>
