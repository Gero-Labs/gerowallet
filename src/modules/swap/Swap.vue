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
    {{ selectedTokenB }}
    {{ availableTokens.find(token => token.ticker === 'GERO')}}
  </v-card>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import TokenSelector from '@/shared/components/TokenSelector.vue';
import SettingsOverlay from '@/modules/swap/components/SettingsOverlay.vue';
import { mapActions, mapState } from 'pinia';
import { appWallet, useStore } from '@/store';
import networks, { cardanoLogo, geroLogo } from '@/shared/utils/networks';
import { dexHunterStore } from '@/store/modules/dexhunter';

export default defineComponent({
  name: 'Swap',
  components: { SettingsOverlay, TokenSelector },
  data() {
    return {
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
    };
  },
  computed: {
    ...mapState(dexHunterStore, ['dexHunterTokens']),
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
          const found = resolvedAssets?.find(t => t.unit === token.unit);
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
          const isPinnedA = this.pinnedTokens.includes(a.unit);
          const isPinnedB = this.pinnedTokens.includes(b.unit);

          // Prioritize pinned tokens
          if (isPinnedA && !isPinnedB) return -1;
          if (!isPinnedA && isPinnedB) return 1;

          // If both are pinned, sort by name
          if (isPinnedA && isPinnedB) {
            return a.name.localeCompare(b.name);
          }

          // If none are pinned, sort by balance in descending order
          return b.balance - a.balance;
        });

      return [nativeToken, ...availableTokens];
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
    // selectedTokenA: {
    //   handler: 'updateTokenBQuantity',
    //   deep: true,
    // },
    selectedTokenB: {
      handler: 'updateTokenAQuantity',
      deep: true,
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
    updateSelectedTokens(nativeToken) {
      // Ensure that selectedTokenA is updated correctly without direct mutation
      if (this.selectedTokenA.ticker === nativeToken.ticker) {
        this.selectedTokenA = { ...nativeToken }; // shallow copy, safe for primitive fields
      }
    },
    getPrice(token) {
      if (!token) return '';
      const multiplier = token.ticker === 'ADA' ? 1 : this.price_ba;
      return (Number(token.quantity) * multiplier * this.price.lastPrice).toLocaleString();
    },
    setSlippage(val) {
      this.slippage = val;
    },
    switchPair() {
      // Create deep copies to avoid reference issues
      this.selectedTokenA = JSON.parse(JSON.stringify(this.selectedTokenB));
      this.selectedTokenB = JSON.parse(JSON.stringify(this.selectedTokenA));
    },
    async updateTokenBQuantity(val) {
      console.log(val)
      // if (!this.selectedTokenA || !this.price_ba) return;
      // this.selectedTokenB.quantity = String((Number(this.selectedTokenA.quantity) / this.price_ba).toFixed(2));
      // const res = await this.estimate(this.selectedTokenA.unit, this.selectedTokenB.unit, Number(this.selectedTokenA.quantity));
      // console.log(res)
    },
    async updateTokenAQuantity(val) {
      console.log(val)
      if (!this.selectedTokenB || !this.price_ba) return;
      this.selectedTokenA.quantity = String((Number(this.selectedTokenB.quantity) / this.price_ba).toFixed(2));
      await this.estimate(this.selectedTokenB.unit, this.selectedTokenA.unit, Number(this.selectedTokenB.quantity));
    },
    async estimate(token_in, token_out, amount_in) {
      if (!amount_in) return;
      const slippage = this.slippage === 'unlimited' ? -1 : Number(this.slippage);
      const res = await appWallet.api.estimate(amount_in, token_in, token_out, slippage);
      this.price_ab = res.price_ab;
      this.price_ba = res.price_ba;
    },
  },
  async mounted() {
    await this.estimate(this.selectedTokenA.unit, this.selectedTokenB.unit, 1);
  }
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
