<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <v-card outlined>
          <v-card-title class="pa-0">
            <v-list-item two-line>
              <v-list-item-content>
                <v-list-item-title>
                  Available Stake Pools
                </v-list-item-title>
                <v-list-item-subtitle>
                  Earn rewards by staking your Ap3x tokens with Apex Fusion's extensive network of stake pools.
                </v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action style="align-items: center;" class="ma-0" v-if="geroPoolExists">
                <v-card-title style="color: #00DFF3; font-size: 18px" v-if="geroPoolExists">
                  Consider supporting us
                </v-card-title>
                <v-card-subtitle>
                  <v-btn small
                         style="text-transform: capitalize; background: linear-gradient(45deg, #00c7f3, #00ffd1); color: black">
                    Stake with GERO
                  </v-btn>
                </v-card-subtitle>
              </v-list-item-action>
            </v-list-item>
          </v-card-title>
          <v-card-subtitle class="pt-5">
            <v-text-field
              v-model="search"
              clearable
              outlined
              dense
              label="Search by pool name or ticker"
              prepend-inner-icon="mdi-magnify"
              hide-details
            >
            </v-text-field>
          </v-card-subtitle>
          <v-card-text class="py-0">
            <v-row no-gutters>
              <v-col cols="12" xl="3" lg="4" md="6" sm="12" v-for="(pool, index) in pagedPools" :key="index"
                     class="px-2 py-2">
                <v-hover
                  v-slot="{ hover }"
                >
                  <v-card
                    outlined
                    :color="hover ? '#FFFFFF' : '#84CAFF'"
                    style="border-radius: 12px"
                    @click="stake"
                    class="fill-height"
                  >
                    <v-list-item v-if="pool">
                      <v-list-item-content class="pb-0">
                        <v-list-item-title>
                          {{`[${pool.ticker}] ${pool.name}` }}
                        </v-list-item-title>
                        <v-list-item-subtitle>
                          <v-btn icon x-small v-if="pool?.homepage" :href="pool?.homepage" target="_blank">
                            <v-icon small>
                              mdi-web
                            </v-icon>
                          </v-btn>
                          <v-btn icon x-small v-if="poolExtendedInfo(pool)?.info?.social?.facebook_handle" :href="'https://www.facebook.com/'+poolExtendedInfo?.info?.social?.facebook_handle" target="_blank">
                            <v-icon small>
                              mdi-facebook
                            </v-icon>
                          </v-btn>
                          <v-btn icon x-small v-if="poolExtendedInfo(pool)?.info?.social?.twitter_handle" :href="'https://x.com/'+poolExtendedInfo?.info?.social?.twitter_handle" target="_blank">
                            <v-avatar tile size="14">
                              <v-img :src="require('@/assets/svg/x.svg')" alt="x"></v-img>
                            </v-avatar>
                          </v-btn>
                          <v-btn icon x-small v-if="poolExtendedInfo(pool)?.info?.social?.youtube_handle" :href="'https://youtube.com/'+poolExtendedInfo?.info?.social?.youtube_handle" target="_blank">
                            <v-icon small>
                              mdi-youtube
                            </v-icon>
                          </v-btn>
                          <v-btn icon x-small v-if="poolExtendedInfo(pool)?.info?.social?.discord_handle" :href="'https://discord.gg/'+poolExtendedInfo?.info?.social?.discord_handle" target="_blank">
                            <v-icon small>
                              mdi-discord
                            </v-icon>
                          </v-btn>
                          <v-btn icon x-small v-if="poolExtendedInfo(pool)?.info?.social?.telegram_handle" :href="'https://t.me/'+poolExtendedInfo?.info?.social?.telegram_handle" target="_blank">
                            <v-avatar tile size="14">
                              <v-img :src="require('@/assets/svg/telegram.svg')" alt="x"></v-img>
                            </v-avatar>
                          </v-btn>
                        </v-list-item-subtitle>
                      </v-list-item-content>
                      <v-list-item-avatar class="ma-0" size="32" v-if="poolExtendedInfo(pool)?.info?.url_png_icon_64x64">
                        <v-img :src="poolExtendedInfo(pool).info.url_png_icon_64x64"></v-img>
                      </v-list-item-avatar>
                    </v-list-item>
                    <v-card-text class="pt-0">
                      <v-row no-gutters>
                        <v-col cols="5">
                          <span style="font-size: 14px; color: white">Saturation</span>
                        </v-col>
                        <v-col cols="7">
                          <v-progress-linear height="20" rounded :value="pool.live_saturation" color="#333741">
                            <span>{{ pool.live_saturation + '%' }}</span>
                          </v-progress-linear>
                        </v-col>
                      </v-row>
                      <v-row no-gutters>
                        <v-col cols="5">
                          <span style="font-size: 14px; color: white">Pledge</span>
                        </v-col>
                        <v-col cols="7">
                          <v-chip x-small color="#085D3A" style="border: 1px solid #75E0A7; color: #75E0A7; ">
                            {{ pool.pledge | toAda(false, 0, loggedWallet.network !== Network.MAINNET) }}
                          </v-chip>
                        </v-col>
                      </v-row>
                      <v-row no-gutters>
                        <v-col cols="5">
                          <span style="font-size: 14px; color: white">ROS</span>
                        </v-col>
                        <v-col cols="7">
                          <span style="font-size: 14px; color: white">{{ (pool.ros).toFixed(2) + '%' }}</span>
                        </v-col>
                      </v-row>
                      <v-row no-gutters>
                        <v-col cols="5">
                          <span style="font-size: 14px; color: white">Fees</span>
                        </v-col>
                        <v-col cols="7">
                          <span style="font-size: 14px; color: white">{{pool.margin + '%'}} / {{pool.fixed_cost | toAda(false, 0, loggedWallet.network !== Network.MAINNET) }}
                          </span>
                        </v-col>
                      </v-row>
                    </v-card-text>
                  </v-card>
                </v-hover>
              </v-col>
            </v-row>
          </v-card-text>
          <v-card-actions style="justify-content: center;">
            <v-pagination style="max-width: 400px" :total-visible="10" circle class="pagination mb-2" v-model="page" :length="numPages"></v-pagination>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-layout>
</template>
<script>
import filters from "@/shared/utils/filters";
import {useStore} from "@/store";
import {useObservable} from "@vueuse/rxjs";
import {liveQuery} from "dexie";
import {mapState} from "pinia";
import {Blockchain, Network} from "@/models/types";

export default {
  name: 'Staking',
  components: {},
  computed: {
    Network() {
      return Network
    },
    geroPoolExists() {
      return (this.loggedWallet.chain === Blockchain.CARDANO && this.loggedWallet.network === Network.MAINNET) ||
        (this.loggedWallet.chain === Blockchain.APEX_PRIME && this.loggedWallet.network === Network.TESTNET)
    },
    ...mapState(useStore, ['getPools', 'loggedWallet']),
    pools() {
      return this.getPools
    },
    numPages() {
      // calculate the number of pages we have
      return Math.ceil(this.stakePools.length / this.pageSize);
    },
    stakePools() {
      if (this.pools) {
        let filteredPools = this.pools.filter(pool =>  pool.pool_status === 'registered')
        if (this.search) {
          filteredPools = filteredPools.filter(pool => (pool.ticker && pool.ticker.toLowerCase().includes(this.search.toLowerCase())) || (pool.name && pool.name.toLowerCase().includes(this.search.toLowerCase())))
          console.log(filteredPools)
        }
        return filteredPools
      }
      return []
    },
    pagedPools() {
      // get the start index for your paged result set.
      // The page number starts at 1 so the active item in the pagination is displayed properly.
      // However for our calculation the page number must start at (n-1)
      const startIndex = (this.page - 1) * this.pageSize;

      // create a copy of your assets list so we don't modify the original data set
      const data = [...this.stakePools];

      // only return the data for the current page using splice
      return data.splice(startIndex, this.pageSize);
    }
  },
  watch: {
    search(val) {
      if (val) {
        this.page = 1
      }
    }
  },
  methods: {
    stake() {

    },
    poolExtendedInfo(pool) {
      if (pool && pool.pool_extended_info) {
        return JSON.parse(pool.pool_extended_info);
      }
      return undefined
    }
  },
  filters,
  data: () => ({
    wallet: undefined,
    store: useStore,
    filters,
    blockchainDB: undefined,
    page: 1,
    pageSize: 12,
    search: '',
  }),
  async mounted() {
    this.wallet = useStore().getWallet
  }
}
</script>
<style>
.v-progress-linear__determinate {
  background: linear-gradient(90deg, #00c7f3, #00ffd1);
}

.v-data-table-header {
  background-color: rgb(22, 27, 38);
}
</style>
