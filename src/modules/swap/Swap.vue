<template>
  <v-card class="transparent" flat>
    <v-layout>
      <v-row>
        <v-col cols="12" xl="8" lg="8">
          <v-card flat outlined>
            <v-card-title>Swap</v-card-title>
            <v-card-text class="text-center justify-center">
              <v-card flat max-width="400" outlined class="mx-auto">
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
                  <v-btn icon small @click="refreshTokens">
                    <v-icon small>mdi-reload</v-icon>
                  </v-btn>
                  <v-btn-toggle v-model="settingsToggle">
                    <v-btn small rounded :value="true">
                      <v-icon color="red" small v-if="slippage === 'unlimited'">mdi-infinity</v-icon>
                      <span v-else>{{ slippageDisplay }}</span>
                      &nbsp;<v-icon small>mdi-cog</v-icon>
                    </v-btn>
                  </v-btn-toggle>
                </v-card-title>
                <v-card-text>
                  <TokenSelector
                    v-model="selectedTokenA"
                    :available="availableTokens"
                    :index="0"
                    title="Selling"
                    titleColor="#FDA29B"
                    :price="getPrice(selectedTokenA)"
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
                  />
                  <div class="text-left" v-if="price_ba">
                    <v-btn text plain class="px-0 no-opacity" :ripple="false">
                      <v-avatar
                        color="primary"
                        :style="{ animationDuration: '1.5s' }"
                        class="mr-1 v-avatar--metronome"
                        size="12"
                      />
                      {{ pairPrice }}
                    </v-btn>
                  </div>
                  <v-btn color="primary" large block rounded class="rounded-10">Swap</v-btn>
                </v-card-text>
                <SettingsOverlay ref="settings" v-model="settingsToggle" @setSlippage="setSlippage" />
              </v-card>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" xl="4" lg="4">
          <v-card flat outlined class="fill-height">
            <v-card-title>Pending Orders</v-card-title>
          </v-card>
        </v-col>
      </v-row>
    </v-layout>
  </v-card>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import TokenSelector from '@/shared/components/TokenSelector.vue';
import SettingsOverlay from '@/modules/swap/components/SettingsOverlay.vue';
import { mapState } from 'pinia';
import { appWallet, useStore } from '@/store';
import networks, { geroLogo } from '@/shared/utils/networks';

export default defineComponent({
  name: 'Swap',
  components: { SettingsOverlay, TokenSelector },
  data() {
    return {
      slippage: '2',
      settingsToggle: false,
      swapType: 0,
      selectedTokenA: undefined,
      selectedTokenB: {
        name: 'GERO',
        ticker: 'GERO',
        img: geroLogo,
        balance: 0,
        quantity: '0',
        decimals: 6,
        unit: '10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b64745524f',
      },
      availableTokens: [],
      price_ab: undefined,
      price_ba: undefined,
    };
  },
  computed: {
    ...mapState(useStore, ['resolvedAssets', 'pinnedTokens', 'price']),
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
        })).sort((a, b) => a.ticker.localeCompare(b.ticker)) || []
      );
    },
    nativeToken() {
      const currencyTicker = networks.resolveCurrencyTicker(appWallet.chain, appWallet.network);
      return this.tokens.find(token => token.ticker === currencyTicker);
    },
    slippageDisplay() {
      return this.slippage === 'auto' ? 'AUTO' : `${this.slippage}%`;
    },
    pairPrice() {
      const tokenA = this.selectedTokenA.ticker;
      const tokenB = this.selectedTokenB.ticker === 'ADA' ? tokenA : this.selectedTokenB.ticker;
      return `1 ${tokenB} = ${this.price_ba?.toFixed(7)} ${tokenA}`;
    },
  },
  watch: {
    selectedTokenA: {
      handler:'updateTokenBQuantity',
      deep: true
    },
    selectedTokenB: {
      handler: 'updateTokenAQuantity',
      deep: true,
    },
  },
  methods: {
    getPrice(token) {
      if (!token) return '';
      const multiplier = token.ticker === 'ADA' ? 1 : this.price_ba;
      return (Number(token.quantity) * multiplier * this.price.lastPrice).toLocaleString();
    },
    setSlippage(val) {
      this.slippage = val;
    },
    switchPair() {
      [this.selectedTokenA, this.selectedTokenB] = [this.selectedTokenB, this.selectedTokenA];
    },
    async refreshTokens() {
      const res = await appWallet.api.getAllTokens();
      const availableTokens = res.map(token => ({
        name: token.token_ascii,
        ticker: token.ticker,
        img: `https://storage.googleapis.com/dexhunter-images/tokens/${token.token_id}.webp`,
        decimals: Number(token.token_decimals),
        unit: token.token_id,
        balance: this.tokens.find(t => t.ticker === token.ticker)?.balance || 0,
        verified: token.is_verified,
      })).sort((a, b) => {
        return (this.pinnedTokens.includes(a.unit) ? -1 : 1) || a.name.localeCompare(b.name);
      });

      this.availableTokens = [this.nativeToken, ...availableTokens].filter(Boolean);
      const foundGEROAsset = this.availableTokens.find(token => token.ticker === 'GERO');
      if (foundGEROAsset) {
        foundGEROAsset.quantity = '0';
        this.selectedTokenB = foundGEROAsset;
      }
    },
    async updateTokenBQuantity() {
      console.log('')
      if (!this.selectedTokenA || !this.price_ba) return;
      this.selectedTokenB.quantity = String((Number(this.selectedTokenA.quantity) / this.price_ba).toFixed(2));
      await this.estimate(this.selectedTokenA.unit, this.selectedTokenB.unit, Number(this.selectedTokenA.quantity));
    },
    async updateTokenAQuantity() {
      console.log('')
      if (!this.selectedTokenB || !this.price_ba) return;
      this.selectedTokenA.quantity = String((Number(this.selectedTokenB.quantity) / this.price_ba).toFixed(2));
      await this.estimate(this.selectedTokenB.unit, this.selectedTokenA.unit, Number(this.selectedTokenB.quantity));
    },
    async estimate(token_in, token_out, amount_in) {
      if (!amount_in || amount_in === 0) return;
      const slippage = this.slippage === 'unlimited' ? -1 : Number(this.slippage);
      const res = await appWallet.api.estimate(amount_in, token_in, token_out, slippage);
      this.price_ab = res.price_ab;
      this.price_ba = res.price_ba;
    },
  },
  async mounted() {
    const currencyTicker = networks.resolveCurrencyTicker(appWallet.chain, appWallet.network);
    this.selectedTokenA = {
      ...this.tokens.find(token => token.ticker === currencyTicker),
      quantity: '0'
    }
    await this.refreshTokens();
  },
});
</script>
<style scoped>
.mt-2 {
  margin-top: 8px;
}

.z-index-5 {
  z-index: 5;
}

.mt-n4 {
  margin-top: -18px;
}

.rounded-10 {
  border-radius: 10px;
}

.centered-input.v-text-field.v-text-field--solo .v-input__control input {
  text-align: center;
  font-size: 14px;
  padding: 0;
}

.theme--dark.centered-input.v-text-field--solo > .v-input__control > .v-input__slot {
  background: transparent;
}

.text-white input {
  color: white !important;
}

.text-black input {
  color: black !important;
}

.text-white.opacity {
  opacity: 0.3;
}

.no-opacity.v-btn--plain:not(.v-btn--active):not(.v-btn--loading):not(:focus):not(:hover) .v-btn__content {
  opacity: 1;
}

@keyframes metronome-example {
  from {
    transform: scale(.5);
  }

  to {
    transform: scale(1);
  }
}

.v-avatar--metronome {
  animation-name: metronome-example;
  animation-iteration-count: infinite;
  animation-direction: alternate;
}
</style>
