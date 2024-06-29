<template>
  <v-card flat class="transparent">
    <v-card-text class="pa-0">
      <v-row no-gutters>
        <v-col cols="6" class="selectors-container px-2">
          <v-card flat outlined class="pa-2 fill-height" style="height: 487px; overflow: auto">
            <template v-for="index in selectedTokens?.length">
              <TokenSelector
                class="pb-1"
                v-model="selectedTokens[index-1]"
                :available="tokens"
                :index="index-1"
                :key="index"
                @remove="removeTokenSelector"
              ></TokenSelector>
            </template>
            <v-card-actions class="justify-center text-center">
              <v-btn text class="add-token-button" @click="addToken">
                <v-icon class="plus-icon" color="#00c7f3" small>mdi-plus</v-icon>
                Add token
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
        <v-col cols="6" class="collectibles px-2">
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
                        v-for="(item) in collection.items"
                        :key="item.name"
                        cols="12"
                        sm="3"
                        xs="12"
                        class="pa-1"
                      >
                        <v-item v-slot="{ active, toggle }" :value="item.name">
                          <div>
                            <v-hover>
                              <template v-slot:default="{ hover }">
                                <v-card
                                  flat
                                  class="justify-center text-center px-1 shadow collectible-item"
                                  :style="active ? { backgroundImage: `linear-gradient(#ffffff00, #000000b3), url(${item.img})`,border: '2px solid #00c7f3' } : { backgroundImage: `linear-gradient(#ffffff00, #000000b3), url(${item.img})`,border: '2px solid #00c7f300' }"
                                  @click="toggle"
                                >

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
                              <v-btn icon x-small>
                                <v-icon color="#00DFF3" x-small>mdi-minus-box-outline</v-icon>
                              </v-btn>
                              <input type="number" min="1" :max="item.quantity"  style="text-align:center; height:12px; color: white; width: 28px; font-size: 9px"/>
                              <v-btn icon x-small>
                                <v-icon color="#00DFF3" x-small>mdi-plus-box-outline</v-icon>
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
    <v-card-actions class="justify-center pt-4 pb-0">
      <v-btn text @click="$emit('prev')"><v-icon small>mdi-arrow-left</v-icon>&nbsp;Back</v-btn>
      <v-btn class="continue-button" @click="$emit('next')">Continue&nbsp;<v-icon small>mdi-arrow-right</v-icon></v-btn>
    </v-card-actions>
  </v-card>
</template>
<script>
import {mapState} from "pinia";
import {useStore} from "@/store";
import TokenSelector from '@/shared/components/TokenSelector.vue';

export default {
  components: { TokenSelector },
  props: {
    value: {
      type: Object
    },
  },
  name: "AssetsToSendStep",
  computed: {
    ...mapState(useStore, ['resolvedAssets', 'resolvedCollections']),
    tokens() {
      const tokens = this.resolvedAssets.map(token => {
        return {
          name: token.metadata.name,
          ticker: token.metadata.ticker,
          img: token.img,
          quantity: "0",
          balance: token.quantity,
          decimals: token.metadata.decimals
        }
      })
      tokens.sort((a,b) => a.ticker > b.ticker ? 1 : -1)
      return tokens
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
      console.log(collections)
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
      handler(newVal, oldVal) {
        this.$emit('input', {
          ...this.value,
          selectedTokens: newVal
        })
        if (newVal !== oldVal) {
          console.log(newVal)
        }
      },
      deep: true,
    }
  },
  methods: {
    addToken() {
      const existingTokens = this.selectedTokens.map(token => token.ticker)
      const missingTokens = this.tokens.filter(token => !existingTokens.includes(token.ticker))
      if (missingTokens?.length > 0) {
        this.selectedTokens.push(missingTokens[0])
      }
    },
    removeTokenSelector(index) {
      this.selectedTokens.splice(index,1)
    }
  },
  data() {
    return {
      selectedCollectibles: [],
      search: '',
      selectedTokens: undefined
    };
  },
  mounted() {
    console.log(this.value)
    this.selectedTokens = this.value.selectedTokens
  },
};
</script>

<style scoped>
.continue-button {
  background: linear-gradient(to right, #00c7f3, #00fad5);
  color: black;
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
  height: 68px;
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
  font-size: 9px;
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
