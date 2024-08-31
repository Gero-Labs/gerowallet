<template>
  <v-card flat outlined max-width="400" class="mx-auto" style="background-color: #191919!important;">
    <v-card-text class="pa-0">
      <v-card flat class="transparent">
        <v-card-title>
          <v-btn-toggle mandatory active-class="highlight" v-model="swapType">
            <v-btn small color="black" :value="0" rounded class="capitalize">
              Swap
            </v-btn>
            <v-btn small color="black" :value="1" rounded class="capitalize" disabled>
              Limit
            </v-btn>
            <v-btn small color="black" :value="2" rounded class="capitalize" disabled>
              DCA
            </v-btn>
          </v-btn-toggle>
          <v-spacer></v-spacer>
          <v-btn icon small>
            <v-icon small>mdi-reload</v-icon>
          </v-btn>
          <v-btn-toggle v-model="settingsToggle">
            <v-btn small rounded :value="true">
              <v-icon color="red" small v-if="slippage === 'unlimited'">mdi-infinity</v-icon>
              <span v-else>{{ slippageDisplay }}</span>
              <v-icon small class="ml-1">mdi-cog</v-icon>
            </v-btn>
          </v-btn-toggle>
        </v-card-title>
        <v-card-text class="pb-0">
          <TokenSelector
            v-model="selectedTokenA"
            :available="availableTokens"
            :index="0"
            title="Selling"
            titleColor="#FDA29B"
            :price="getPrice(selectedTokenA)"
            @change="tokenAQuantityChange"
          />
          <v-btn outlined icon color="#00DFF3" class="mt-2 z-index-5" @click="switchPair">
            <v-icon color="#00DFF3">mdi-chevron-double-down</v-icon>
          </v-btn>
          <TokenSelector
            v-model="selectedTokenB"
            :available="availableTokens"
            :index="0"
            title="Buying"
            titleColor="#75E0A7"
            background-color="transparent"
            :max-button-enabled="false"
            class="mt-n4"
            :price="getPrice(selectedTokenB)"
            :price-impact="calculateWeightedPriceImpact"
            @change="tokenBQuantityChange"
          />
          <div class="text-left" v-if="price_ba" style="display: flex;">
            <v-btn text plain class="px-0 no-opacity" :ripple="false" @click="pairPriceToggle = !pairPriceToggle" style="letter-spacing: normal">
              <v-avatar
                color="primary"
                :style="{ animationDuration: '1.5s' }"
                class="mr-1 v-avatar--metronome"
                size="12"
              />
              {{ pairPrice }}
            </v-btn>
            <v-spacer></v-spacer>
            <v-btn text plain color="primary" class="px-0 no-opacity" :ripple="false" @click="swapOverviewToggle = true" style="letter-spacing: normal">
              Details
              <v-icon small class="ml-1">mdi-chevron-down</v-icon>
            </v-btn>
          </div>
          <div class="text-left" v-else>
            <v-progress-circular indeterminate size="20" class="ma-2"></v-progress-circular>
          </div>
        </v-card-text>
        <SwapOverviewOverlay ref="swap" @excludedChange="excludedChange" v-model="swapOverviewToggle" :token-a="selectedTokenA" :token-b="selectedTokenB" :slippage="slippage" :estimation="estimation" style="border-radius: 10px" class="ma-2 mb-0" />
      </v-card>
    </v-card-text>
    <v-card-actions class="mx-2 pt-0 mb-2">
      <v-btn color="primary" large block rounded class="rounded-10" :disabled="isSwapDisabled || loading" @click="prepareSwap" :loading="loading">{{ isInsufficientBalance ? 'Insufficient Balance' : 'Swap' }}</v-btn>
    </v-card-actions>
    <SettingsOverlay ref="settings" v-model="settingsToggle" @setSlippage="setSlippage" />
  </v-card>
</template>
<script>
import TokenSelector from '@/shared/components/TokenSelector.vue';
import SettingsOverlay from '@/modules/swap/components/SettingsOverlay.vue';
import SwapOverviewOverlay from '@/modules/swap/components/SwapOverviewOverlay.vue';
import { mapActions, mapState } from 'pinia';
import { dexHunterStore } from '@/store/modules/dexhunter';
import { appWallet, useStore } from '@/store';
import filters from '@/shared/utils/filters';
import networks, { cardanoLogo } from '@/shared/utils/networks';
import debounce from 'lodash/debounce';
import { Transaction, TransactionWitnessSet } from '@emurgo/cardano-serialization-lib-browser';
import snackbar from '@/plugins/snackbar';

export default {
  name: 'SwapWidget',
  components: { SwapOverviewOverlay, SettingsOverlay, TokenSelector },
  computed: {
    ...mapState(dexHunterStore, ['dexHunterTokens']),
    ...mapState(useStore, ['loggedWallet', 'resolvedAssets', 'pinnedTokens', 'price', 'baseAddress']),
    isSwapDisabled() {
      const quantityA = this.selectedTokenA.quantity.replaceAll(',','')
      const quantityB = this.selectedTokenB.quantity.replaceAll(',', '')
      return quantityA === '0' || quantityB === '0' || isNaN(Number(quantityA)) || isNaN(Number(quantityB)) || this.isInsufficientBalance
    },
    isInsufficientBalance() {
      const quantityA = this.selectedTokenA.quantity.replaceAll(',','')
      const b = filters.toCurrency(this.selectedTokenA.balance, false, this.selectedTokenA.decimals, '', '', false, this.selectedTokenA.decimals).replaceAll(',', '')
      const balanceA = Number(b)
      return Number(quantityA) > balanceA
    },
    tokens() {
      return (
        this.resolvedAssets?.map(token => ({
          name: token.metadata.name,
          ticker: token.metadata.ticker,
          img: token.img,
          balance: token.quantity,
          decimals: token.metadata.decimals,
          unit: token.unit,
          quantity: '0',
        })) || []
      );
    },
    nativeToken() {
      const currencyTicker = networks.resolveCurrencyTicker(appWallet?.chain, appWallet?.network);
      const token = this.resolvedAssets?.find(token => token.ticker === currencyTicker);
      return token
        ? {
          name: token.metadata.name,
          ticker: token.metadata.ticker,
          img: token.img,
          balance: token.quantity,
          decimals: token.metadata.decimals,
          unit: token.unit,
          quantity: '0',
          verified: true,
        }
        : {
          name: 'Cardano',
          ticker: 'ADA',
          img: cardanoLogo,
          balance: 0,
          quantity: '0',
          decimals: 6,
          unit: '',
          verified: true,
        };
    },
    availableTokens() {
      if (!this.dexHunterTokens) {
        return [];
      }

      const resolvedAssets = this.tokens;
      const native = resolvedAssets?.find(t => t.unit === this.nativeToken.unit);

      const nativeToken = { ...this.nativeToken }; // avoid modifying original state

      if (native) {
        nativeToken.balance = native.balance;
      }

      const availableTokens = Object.values(this.dexHunterTokens)
        .map(token => {
          const found = resolvedAssets?.find(t => t.unit === token['unit']);
          const res = {
            ...token,
            balance: found ? found.balance : 0,
          };
          if (found && this.selectedTokenB.unit === found.unit) {
            this.selectedTokenB.balance = res.balance
          }
          return res
        })
        .sort((a, b) => {
          const isPinnedA = this.pinnedTokens.includes(a['unit']);
          const isPinnedB = this.pinnedTokens.includes(b['unit']);

          // Prioritize pinned tokens
          if (isPinnedA && !isPinnedB) return -1;
          if (!isPinnedA && isPinnedB) return 1;

          // If both are pinned, sort by name
          if (isPinnedA && isPinnedB) {
            return a['name'].localeCompare(b['name']);
          }

          // If none are pinned, sort by balance in descending order
          return b.balance - a.balance;
        });

      return [nativeToken, ...availableTokens];
    },
    calculateWeightedPriceImpact() {
      let totalAmount = 0;
      let totalWeightedImpact = 0;
      if (!this.splits) {
        return 0
      }
      this.splits.forEach(({ price_impact, amount_in }) => {
        totalAmount += amount_in;
        totalWeightedImpact += price_impact * amount_in;
      });

      if (totalAmount === 0) {
        return 0;
      }

      return Number(totalWeightedImpact / totalAmount);
    },
    slippageDisplay() {
      return this.slippage === 'auto' ? 'AUTO' : `${this.slippage}%`;
    },
    pairPrice() {
      const tokenA = this.selectedTokenA.ticker;
      const tokenB = this.selectedTokenB.ticker === 'ADA' ? tokenA : this.selectedTokenB.ticker;
      if (!this.pairPriceToggle) {
        return `1 ${tokenB} = ${this.price_ba?.toFixed(7)} ADA`;
      } else {
        return `1 ADA = ${this.price_ab?.toFixed(7)} ${tokenB}`;
      }
    },
  },
  watch: {
    'selectedTokenA.ticker': {
      async handler(newVal, oldVal) {
        if (this.isUpdating) return; // Prevent recursive updates
        this.isUpdating = true; // Set flag to prevent mutual watcher trigger

        if (newVal === 'ADA') {
          // If selectedTokenA is changed to ADA, set selectedTokenB to last non-ADA tokenB if exists
          if (this.lastNonADATokenB) {
            this.selectedTokenB = this.availableTokens.find(token => token['ticker'] === this.lastNonADATokenB.ticker);
          } else {
            this.selectedTokenB = this.availableTokens.find(token => token['ticker'] === oldVal);
          }
        } else {
          // Store the last non-ADA token for selectedTokenA
          this.lastNonADATokenA = { ...this.selectedTokenA };
          // Set selectedTokenB to ADA
          this.selectedTokenB = this.availableTokens.find(token => token['ticker'] === 'ADA');
        }

        // Estimate prices after updating tokens
        await this.estimate(this.selectedTokenA.unit, this.selectedTokenB.unit, 1, false);
        this.isUpdating = false; // Reset flag
      },
    },
    'selectedTokenB.ticker': {
      async handler(newVal, oldVal) {
        if (this.isUpdating) return; // Prevent recursive updates
        this.isUpdating = true; // Set flag to prevent mutual watcher trigger
        if (newVal === 'ADA') {
          // If selectedTokenB is changed to ADA, set selectedTokenA to last non-ADA tokenA if exists
          if (this.lastNonADATokenA) {
            this.selectedTokenA = this.availableTokens.find(token => token.ticker === this.lastNonADATokenA.ticker);
          } else {
            this.selectedTokenA = this.availableTokens.find(token => token.ticker === oldVal);
          }
        } else {
          // Store the last non-ADA token for selectedTokenB
          this.lastNonADATokenB = { ...this.selectedTokenB };
          // If selectedTokenB is not ADA, keep selectedTokenA as ADA
          if (this.selectedTokenA.ticker !== 'ADA') {
            this.selectedTokenA = this.availableTokens.find(token => token['ticker'] === 'ADA');
          }
        }

        // Estimate prices after updating tokens
        await this.estimate(this.selectedTokenA.unit, this.selectedTokenB.unit, 1, false);
        this.isUpdating = false; // Reset flag
      },
    },
    availableTokens(newTokens) {
      // Handle updates when availableTokens change, e.g., update selected tokens
      if (newTokens.length) {
        const nativeToken = newTokens.find(token => token.ticker === 'ADA');
        if (nativeToken) {
          this.updateSelectedTokens(nativeToken);
        }
      }
    },
  },
  methods: {
    ...mapActions(dexHunterStore, ['loadTokens']),
    tokenAQuantityChange(val) {
      this.debouncedEstimateTokenA(val);
    },
    debouncedEstimateTokenA: debounce(function (val) {
      if (!val || val === 0) {
        this.selectedTokenB.quantity = '0'
      } else {
        this.estimate(this.selectedTokenA.unit, this.selectedTokenB.unit, val, true);
      }
      this.lastFunctionCalled = 'estimate';
    }, 300),
    tokenBQuantityChange(val) {
      this.debouncedEstimateTokenB(val);
    },
    debouncedEstimateTokenB: debounce(function (val) {
      if (!val || val === 0) {
        this.selectedTokenA.quantity = '0'
      } else {
        this.reverseEstimate(this.selectedTokenA.unit, this.selectedTokenB.unit, val, true)
      }
      this.lastFunctionCalled = 'reverseEstimate';
    }, 300),
    updateSelectedTokens(nativeToken) {
      // Ensure that selectedTokenA is updated correctly without direct mutation
      if (this.selectedTokenA.ticker === nativeToken.ticker) {
        this.selectedTokenA = { ...nativeToken }; // shallow copy, safe for primitive fields
      }
    },
    getPrice(token) {
      if (!token) return '';
      const multiplier = token.ticker === 'ADA' ? 1 : this.price_ba;

      return (Number(token.quantity.replaceAll(',', '')) * multiplier * this.price.lastPrice).toLocaleString();
    },
    setSlippage(val) {
      this.slippage = val;
    },
    switchPair() {
      this.selectedTokenA = this.selectedTokenB
    },
    async estimate(token_in, token_out, amount_in, update) {
      console.log('estimate')
      if (!appWallet) {
        return
      }
      if (!token_in && !token_out) {
        return
      }
      if (!amount_in) {
        this.total_output_without_slippage = 0
        return;
      } else if (isNaN(amount_in)) {
        return;
      }
      const slippage = this.slippage === 'unlimited' ? -1 : Number(this.slippage);
      const res = await appWallet.api.estimate(amount_in, token_in, token_out, slippage, this.blacklisted_dexes);
      this.price_ab = res.price_ab;
      this.price_ba = res.price_ba;
      if (update) {
        this.total_output_without_slippage = res.total_output_without_slippage
        this.splits = res.splits
        this.estimation = res
        this.selectedTokenB.quantity = filters.toCurrency(this.total_output_without_slippage, false, this.selectedTokenB.decimals, '', '', false, 0);
      }
    },
    async reverseEstimate(token_in, token_out, amount_out, update) {
      if (!appWallet) {
        return
      }
      if (!token_in && !token_out) {
        return
      }
      if (!amount_out) {
        this.total_input_without_slippage = 0
        return;
      } else if (isNaN(amount_out)) {
        return;
      }
      const slippage = this.slippage === 'unlimited' ? -1 : Number(this.slippage);
      const res = await appWallet.api.reverseEstimate(amount_out, token_in, token_out, slippage, this.blacklisted_dexes);
      this.price_ab = res.price_ab;
      this.price_ba = res.price_ba;
      if (update) {
        this.total_input_without_slippage = res.total_input_without_slippage
        this.splits = res.splits
        this.estimation = res
        this.selectedTokenA.quantity = filters.toCurrency(this.total_input_without_slippage, false, this.selectedTokenA.decimals, '', '', false, 0);
      }
    },
    async performPeriodicEstimate() {
      if (this.lastFunctionCalled === 'estimate') {
        const amount = Number(this.selectedTokenA.quantity.replaceAll(',', ''))
        if (amount === 0) {
          await this.estimate(this.selectedTokenA.unit, this.selectedTokenB.unit, 1, false);
        } else {
          await this.estimate(this.selectedTokenA.unit, this.selectedTokenB.unit, amount, true);
        }
      } else if (this.lastFunctionCalled === 'reverseEstimate') {
        const amount = Number(this.selectedTokenB.quantity.replaceAll(',', ''))
        if (amount === 0) {
          await this.reverseEstimate(this.selectedTokenA.unit, this.selectedTokenB.unit, 1, false);
        } else {
          await this.reverseEstimate(this.selectedTokenA.unit, this.selectedTokenB.unit, amount, true);
        }
      }
    },
    async prepareSwap() {
      this.loading = true
      const amount = Number(this.selectedTokenA['quantity'].replaceAll(',', ''))
      const slippage = this.slippage === 'unlimited' ? -1 : Number(this.slippage);
      try {
        const res = await appWallet.api.swap(amount, this.baseAddress, this.selectedTokenA['unit'], this.selectedTokenB['unit'], slippage)
        console.log(res)
        const x = await window.cardano.gerowallet.enable()
        console.log(x)
        const witness = await x.signTx(res.cbor, true)
        const tx = Transaction.from_hex(res.cbor)
        console.log(tx.to_json())
        console.log(witness)
        const signedTx = Transaction.new(
          tx.body(),
          TransactionWitnessSet.from_hex(witness),
          undefined // TODO Transaction metadata
        );
        try {
          console.log(signedTx)
          const txId = await appWallet.submitTx(signedTx.to_hex().toString());
          snackbar.fireSuccess(`Swap Order Transaction Submitted Successfully!`)
          console.log(txId)
        } catch (e) {
          console.log(e)
        }
      } catch (e) {
        console.log(e)
      }
      this.loading = false
    },
    async excludedChange(val) {
      this.blacklisted_dexes = val
      await this.performPeriodicEstimate()
    }
  },
  data() {
    return {
      isUpdating: false,
      isUpdatingQuantity: false,
      lastNonADATokenA: null, // Variable to keep track of the last non-ADA token for tokenA
      lastNonADATokenB: null, // Variable to keep track of the last non-ADA token for tokenB
      slippage: '2',
      settingsToggle: false,
      swapType: 0,
      selectedTokenA: {
        name: 'Cardano',
        ticker: 'ADA',
        img: cardanoLogo,
        fallback_img: "https://storage.googleapis.com/dexhunter-images/public/unverified.svg",
        balance: 0,
        quantity: '0',
        decimals: 6,
        unit: '',
        verified: true
      },
      selectedTokenB: {
        name: 'GERO',
        ticker: 'GERO',
        img: "https://storage.googleapis.com/dexhunter-images/tokens/10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b64745524f.webp",
        fallback_img: "https://storage.googleapis.com/dexhunter-images/public/unverified.svg",
        balance: 0,
        quantity: '0',
        decimals: 6,
        unit: '10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b64745524f',
        verified: true
      },
      price_ab: undefined,
      price_ba: undefined,
      total_output_without_slippage: 0,
      total_input_without_slippage: 0,
      estimation: {
        net_price_reverse: 0,
        total_output: 0,
        deposits: 0,
        batcher_fee: 0,
        partner_fee: 0,
      },
      splits: undefined,
      lastFunctionCalled: 'estimate', // Keep track of the last function called
      intervalId: null, // Store interval ID to clear it later,
      loading: false,
      swapOverviewToggle: false,
      pairPriceToggle: false,
      blacklisted_dexes: []
    };
  },
  async mounted() {
    await this.estimate(this.selectedTokenA.unit, this.selectedTokenB.unit, 1, false);
    this.intervalId = setInterval(this.performPeriodicEstimate, 10000); // Set interval to call estimate every 5 seconds
  },
  beforeUnmount() {
    clearInterval(this.intervalId); // Clear the interval on component unmount
  }
}
</script>
<style scoped>

</style>
