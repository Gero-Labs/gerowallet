<template>
  <v-card flat class="transparent">
    <v-card-text class="pa-0">
      <v-row no-gutters>
        <v-col :cols="collections?.length > 0 ? 6 : 12" class="selectors-container px-2" :style="collections?.length > 0 ? {} : {alignItems: 'center'}">
          <v-card flat outlined class="pa-2 fill-height transparent" style="height: 487px; overflow: auto; max-width: 350px;" >
            <TokenSelector
              v-for="(token, index) in tokenModel"
              :key="index"
              class="pb-1"
              v-model="tokenModel[index]"
              :available="getAvailableTokens(index)"
              :index="index"
              @remove="removeTokenSelector"
              :price="getPrice(token)"
              :minimum="index === 0 && value ? value.minAda : 0"
              :ada-shortage="index === 0 && value ? value.adaShortage : 0"
              @setMax="setMax"
              :token-lock="index === 0"
            ></TokenSelector>
            <v-card-actions class="justify-center text-center" v-if="missingTokens?.length > 0">
              <v-btn text class="add-token-button" @click="addToken">
                <v-icon class="plus-icon" color="#00c7f3" small>mdi-plus</v-icon>
                Add token
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
        <v-col cols="6" class="collectibles px-2" v-if="collections?.length > 0">
          <v-card flat outlined>
            <v-card-title class="justify-center">Choose Collectibles</v-card-title>
            <v-card-subtitle class="pb-0">
              <v-text-field
                v-model="search"
                placeholder="Search for collectibles"
                outlined
                dense
                hide-details
                class="mb-4"
              ></v-text-field>
            </v-card-subtitle>
            <v-card-text style="overflow-y: auto; height: 382px; text-align: left;">
              <v-item-group v-model="selectedCollectibles" multiple>
                <template v-for="(collection, index) in collections">
                  <div v-if="collection.items" :key="`collection_${index}`">
                    <span style="font-size: 10px">{{ `${collection.name} (${collection.items.length})`  }}</span>
                    <v-row :key="index" no-gutters>
                      <v-col
                        v-for="(item, itemIndex) in collection.items"
                        :key="`${item.name}_${itemIndex}`"
                        cols="12"
                        sm="4"
                        xs="12"
                        class="pa-1"
                      >
                        <v-item v-slot="{ active, toggle }" :value="item">
                          <div>
                            <v-hover>
                              <template v-slot:default="{ hover }">
                                <v-card
                                  flat
                                  class="justify-center text-center px-1 shadow collectible-item"
                                  :style="active ? { backgroundImage: `linear-gradient(#ffffff00, #000000b3), url(${item.img})`,border: '2px solid #00c7f3' } : { backgroundImage: `linear-gradient(#ffffff00, #000000b3), url(${item.img})`,border: '2px solid #00c7f300' }"
                                  @click="toggle"
                                >
                                  <div style="top: 0; position: absolute; display: flex" v-if="item.isScam">

                                    <v-chip x-small color="#F97066" class="px-2">
                                      <v-icon color="white" x-small style="margin-right: 3px">
                                        mdi-alert-decagram
                                      </v-icon>Scam Token
                                    </v-chip>
                                  </div>
                                  <div class="collectible-text-container">
                                    <span class="collectible-text">{{ item.name }}</span>
                                  </div>
                                  <v-scroll-y-transition>
                                    <v-avatar color="#00c7f3" v-if="active" size="14" style="position: absolute; right: 4px; top: 4px;">
                                      <v-icon color="black" x-small>
                                        mdi-check-bold
                                      </v-icon>
                                    </v-avatar>
                                  </v-scroll-y-transition>
                                  <v-overlay
                                    v-if="hover"
                                    absolute
                                    color="#ffffff"
                                  >
                                  </v-overlay>
                                </v-card>
                              </template>
                            </v-hover>
                            <div style="display: inline-flex; place-items: center;" v-if="item.quantity > 1 && active">
                              <v-btn icon x-small @click="decreaseQuantityToSend(item)">
                                <v-icon color="#00DFF3" small>mdi-minus-box-outline</v-icon>
                              </v-btn>
                              <input v-model="item.toSendQuantity" type="number" :min="1" :max="item.quantity" style="text-align:center; height:16px; color: white; width: 54px; font-size: 10px"/>
                              <v-btn icon x-small @click="increaseQuantityToSend(item)">
                                <v-icon color="#00DFF3" small>mdi-plus-box-outline</v-icon>
                              </v-btn>
                            </div>
                          </div>
                        </v-item>
                      </v-col>
                    </v-row>
                    <v-divider></v-divider>
                  </div>
                </template>
              </v-item-group>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>
<script>
import {mapState} from "pinia";
import { appWallet, useStore } from '@/stores';
import TokenSelector from '@/shared/components/TokenSelector.vue';
import networks from '@/utils/networks';

export default {
  components: { TokenSelector },
  props: {
    value: {
      type: Object
    },
    tokens: {
      type: Array
    }
  },
  name: "AssetsToSendStep",
  computed: {
    ...mapState(useStore, ['loggedWallet', 'resolvedAssets', 'resolvedCollections', 'pinnedTokens', 'price']),
    missingTokens() {
      const existingTokens = this.selectedTokens.map(token => token?.ticker)
      return this.tokens.filter(token => !existingTokens.includes(token.ticker))
    },
    tokenModel: {
      get() {
        // Use the parent's value as the source of truth.
        return this.value?.selectedTokens || [];
      },
      set(newTokens) {
        // Emit an update only if the new tokens differ from the current ones.
        // (Optionally, you can add a deep comparison check here.)
        this.$emit('input', {
          ...this.value,
          selectedTokens: newTokens,
          selectedCollectibles: this.selectedCollectibles,
        });
      },
    },
    collections() {
      let collections = structuredClone(this.resolvedCollections)
      if (this.search) {
        collections = collections.map(collection => {
          return {
            ...collection,
            items: collection.items.filter(item => item.name.toLowerCase().includes(this.search.toLowerCase()))

          }
        }).filter(collection => collection.items.length > 0)
      }
      if (collections) {
        return collections.map(collection => {
          collection.items.map(item => {
            if (item['toSendQuantity'] === undefined) {
              item['toSendQuantity'] = 1
            }
            return item
          })
          return collection
        })
      }
      return collections
    }
  },
  watch: {
    value: {
      handler(newVal, oldVal) {
        if (newVal !== oldVal) {
          this.selectedTokens = newVal.selectedTokens
        }
      },
      deep: true
    },
    selectedTokens: {
      handler(newVal) {
        this.$emit('input', {
          ...this.value,
          selectedTokens: newVal,
          selectedCollectibles: this.selectedCollectibles,
        })
      },
      deep: true,
    },
    selectedCollectibles: {
      handler(newVal) {
        newVal.forEach(collectible => {
          if (collectible.toSendQuantity > collectible.quantity) {
            collectible.toSendQuantity = collectible.quantity
          } else if (collectible.toSendQuantity < 1) {
            collectible.toSendQuantity = 1
          }
        })
        console.log(newVal)
        this.$emit('input', {
          ...this.value,
          selectedTokens: this.selectedTokens,
          selectedCollectibles: newVal,
        })
      },
      deep: true,
    },
  },
  methods: {
    getAvailableTokens(currentIndex) {
      const currentSelected = this.tokenModel[currentIndex];
      // Collect tickers that have been selected in other selectors
      const selectedTickers = this.tokenModel
        .filter((token, index) => index !== currentIndex && token)
        .map(token => token.ticker);

      return this.tokens.filter(token => {
        // Always include the token already selected in the current selector.
        if (currentSelected && token.ticker === currentSelected.ticker) {
          return true;
        }
        // Otherwise, include tokens not selected elsewhere.
        return !selectedTickers.includes(token.ticker);
      });
    },
    getPrice(token) {
      if (!token) return '';
      let price = this.price.lastPrice
      const nativeTicker = networks.resolveCurrencyTicker(this.loggedWallet?.chain, this.loggedWallet?.network)
      if (token.ticker !== nativeTicker) {
        price = token.last_price;
      }
      return (Number(token.quantity) * price).toLocaleString('en-US');
    },
    decreaseQuantityToSend(item) {
      if (item.toSendQuantity > 1) {
        item.toSendQuantity--
      }
    },
    increaseQuantityToSend(item) {
      console.log('test')
      if (item.toSendQuantity < item.quantity) {
        item.toSendQuantity++
      }
    },
    removeTokenSelector(index) {
      const updatedTokens = [...this.tokenModel];
      updatedTokens.splice(index, 1);
      this.tokenModel = updatedTokens;
    },
    addToken() {
      const existingTickers = this.tokenModel.map(token => token?.ticker);
      const missing = this.tokens.filter(token => !existingTickers.includes(token.ticker));
      if (missing.length > 0) {
        this.tokenModel = [...this.tokenModel, missing[0]];
      }
    },
    setMax(index) {
      this.$emit('setMax', index)
    }
  },
  data() {
    return {
      selectedCollectibles: [],
      search: '',
      selectedTokens: []
    };
  },
  mounted() {
    const currencyTicker = networks.resolveCurrencyTicker(appWallet?.chain, appWallet?.network)
    console.log(this.tokens)
    const foundAsset = this.tokens.find(token => token.ticker === currencyTicker)
    if (foundAsset) {
      foundAsset.verified = true
      this.selectedTokens = [foundAsset]
    }
  },
};
</script>

<style scoped>
.continue-button {
  background: linear-gradient(to right, #00c7f3, #00fad5);
  color: black;

  &:disabled {
    opacity: 0.5;
    color: black!important;
  }

}

.sections-container {
  display: flex;
  gap: 40px;
  height: 400px;
  margin-bottom: 50px;
}

.selectors-container {
  display: flex;
  flex-direction: column;

  .add-token-button {
    width: fit-content;
    align-self: center;

    .plus-icon {
      border: 2px solid #00c7f3;
      border-radius: 5px;
      margin-right: 10px;
    }
  }
}
.collectibles-collection {
  margin-top: 20px;

  .collectible-items {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: space-between;
  }
}
.collectible-item {
  height: 102px;
  background-position: center;
  align-content: end;
  background-size: cover;
}

.collectible-text-container {
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: normal;
}
.collectible-text {
  font-size: 11px;
  font-weight: 500;
  text-align: center;
  line-height: 1.00;
  letter-spacing: -0.7px;
  display: block;
}
/* Chrome, Safari, Edge, Opera */
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Firefox */
input[type=number] {
  -moz-appearance: textfield;
}
</style>
