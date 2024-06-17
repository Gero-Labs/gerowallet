<template>
  <v-card outlined>
    <v-card-title>Staking</v-card-title>
    <v-card-text class="pa-0">
      <v-layout column>
        <v-row no-gutters style="background-color: #161B26" class="py-4">
          <v-col cols="6" class="px-4">
            <span>Staked to Pool:</span>
            <h2 style="color: white" v-if="pool">{{ `[${pool.ticker}] ${pool.name}` }}</h2>
          </v-col>
          <v-col cols="3" class="px-4">
            <span>Total ADA:</span>
            <h2 style="color: white" v-if="loggedWallet">{{ account.controlled_amount | toAda(false, 2, loggedWallet.network !== Network.MAINNET) }}</h2>
          </v-col>
          <v-col cols="3" class="px-4">
            <span>Rewards</span>
            <h2 style="color: white">{{ account.withdrawable_amount | toAda }}</h2>
          </v-col>
        </v-row>
        <v-row no-gutters class="pt-2">
          <v-col cols="6" class="px-4">
            <div>
              <v-btn icon small v-if="pool?.homepage" :href="pool?.homepage" target="_blank">
                <v-icon small>
                  mdi-web
                </v-icon>
              </v-btn>
              <v-btn icon small v-if="poolExtendedInfo?.info?.social?.facebook_handle" :href="'https://www.facebook.com/'+poolExtendedInfo?.info?.social?.facebook_handle" target="_blank">
                <v-icon small>
                  mdi-facebook
                </v-icon>
              </v-btn>
              <v-btn icon small v-if="poolExtendedInfo?.info?.social?.twitter_handle" :href="'https://x.com/'+poolExtendedInfo?.info?.social?.twitter_handle" target="_blank">
                <v-avatar tile size="14">
                  <v-img :src="require('@/assets/svg/x.svg')" alt="x"></v-img>
                </v-avatar>
              </v-btn>
              <v-btn icon small v-if="poolExtendedInfo?.info?.social?.youtube_handle" :href="'https://youtube.com/'+poolExtendedInfo?.info?.social?.youtube_handle" target="_blank">
                <v-icon small>
                  mdi-youtube
                </v-icon>
              </v-btn>
              <v-btn icon small v-if="poolExtendedInfo?.info?.social?.discord_handle" :href="'https://discord.gg/'+poolExtendedInfo?.info?.social?.discord_handle" target="_blank">
                <v-icon small>
                  mdi-discord
                </v-icon>
              </v-btn>
              <v-btn icon small v-if="poolExtendedInfo?.info?.social?.telegram_handle" :href="'https://t.me/'+poolExtendedInfo?.info?.social?.telegram_handle" target="_blank">
                <v-avatar tile size="14">
                  <v-img :src="require('@/assets/svg/telegram.svg')" alt="x"></v-img>
                </v-avatar>
              </v-btn>
            </div>
            <h3>Pool Id</h3>
            <div style="display: flex;align-items: center;">
              <span style="color: white; text-overflow: ellipsis; overflow: hidden;white-space: nowrap;display: flow;">{{ account.pool_id }}</span>
              <copy-button :value="account.pool_id" x-small></copy-button>
            </div>
            <div class="d-flex justify-lg-space-around pt-4">
              <v-btn large
                     style="text-transform: capitalize; background: linear-gradient(45deg, #00c7f3, #00ffd1); color: black">
                Withdraw<br>Rewards
              </v-btn>
              <v-btn large style="text-transform: capitalize;" outlined color="#F97066">Unstake<br>From Pool</v-btn>
            </div>
          </v-col>
          <v-col cols="6" class="px-4">
            <RewardsChart :chart-data="rewardsChartData"></RewardsChart>
          </v-col>
        </v-row>
        <v-row no-gutters class="pt-4">
          <v-col cols="12">
            <v-data-table :items="rewardsData" :headers="stakingHeaders" class="transparent"
                          :hide-default-footer="!(rewardsData?.length > 0)"
                          :sort-by.sync="sortBy"
                          :sort-desc.sync="sortDesc" dense
                          :items-per-page="5"
            >
              <template v-slot:[`item.pool_id`]="{ item }">
                <v-list-item two-line>
                  <v-list-item-avatar size="40">
                    <v-img :src="resolvePoolIcon(item.pool_id)" :alt="item.pool_id+ ' Icon'"></v-img>
                  </v-list-item-avatar>
                  <v-list-item-content>
                    <v-list-item-title>{{ resolvePoolName(item.pool_id) }}</v-list-item-title>
                    <v-list-item-subtitle style="display: -webkit-box; -webkit-line-clamp: 1;-webkit-box-orient: vertical;overflow: hidden;text-overflow: ellipsis;white-space: normal;">
                      {{ resolvePoolDescription(item.pool_id) }}
                    </v-list-item-subtitle>
                  </v-list-item-content>
                </v-list-item>
              </template>
              <template v-slot:[`item.amount`]="{ item }">
                <span v-if="isNumeric(item.amount)"
                      :style="isNaN(change(item)) || change(item) === Infinity || change(item) === 0 ? {color: '#A3A3A3' } : change(item) >= 0 ? { color: '#47CD89'} : { color: '#F97066'}">{{
                    item.amount | toAda
                  }}</span>
                <span v-else>{{ item.amount }}</span>
              </template>
              <template v-slot:[`item.change`]="{ item }">
                <v-avatar tile size="20">
                  <v-img
                      :src="isNaN(change(item)) || change(item) === Infinity || change(item) === 0 ? require('@/assets/svg/arrow-right.svg') : change(item) >= 0 ? require('@/assets/svg/trend-up-01.svg') : require('@/assets/svg/trend-down-01.svg')"
                      alt="trend"></v-img>
                </v-avatar>&nbsp;
                <span :style="isNaN(change(item)) || change(item) === Infinity || change(item) === 0 ? {color: '#A3A3A3' } : change(item) >= 0 ? { color: '#47CD89'} : { color: '#F97066'}">
                  {{ isNaN(change(item)) || change(item) === Infinity ? '0%' : filters.toAda(change(item), false) }}</span>
              </template>
              <template v-slot:[`item.date`]="{ item }">
                <v-list-item two-line class="px-0">
                  <v-list-item-content>
                    <v-list-item-title>{{ item.date }}</v-list-item-title>
                    <v-list-item-subtitle>{{ item.time }}</v-list-item-subtitle>
                  </v-list-item-content>
                </v-list-item>
              </template>
            </v-data-table>
          </v-col>
        </v-row>
      </v-layout>
    </v-card-text>
  </v-card>
</template>
<script>
import RewardsChart from './RewardsChart.vue';
import filters from "@/shared/utils/filters";
import {useStore} from "@/store";
import CopyButton from "@/shared/components/CopyButton.vue";
import {Network} from "@/models/types";
import {mapState} from "pinia";

export default {
  components: {CopyButton, RewardsChart},
  props: {
    account: {
      type: Object,
    },
    chartData: {
      type: Object,
      default: () => {
      },
    },
    project: {
      type: Object,
      default: () => {
      },
    },
  },
  computed: {
    filters() {
      return filters
    },
    ...mapState(useStore, ['rewards','loggedWallet','pools']),
    Network() {
      return Network
    },
    pool() {
      if (this.pools) {
        return this.pools.find(pool => pool.pool_id_bech32 === this.account.pool_id)
      }
      return null
    },
    poolExtendedInfo() {
      if (this.pool) {
        return JSON.parse(this.pool.pool_extended_info)
      }
      return null
    },
    rewardsData() {
      if (this.rewards && !this.hideZero) {
        let rewardsCopy = JSON.parse(JSON.stringify(this.rewards)).sort((a,b) => a.epoch - b.epoch)
        if (rewardsCopy.length > 0) {
          const min = rewardsCopy[0].epoch
          for (let i = 0 ; i < rewardsCopy.length ; i ++) {
            if (rewardsCopy[i] && rewardsCopy[i].epoch === i) continue;
            rewardsCopy.splice(i, 0, Object.assign({}, rewardsCopy[i - 1], { epoch: i, amount: '0'}))
          }
          return rewardsCopy.slice(min)
        }
      }
      return this.rewards
    },
    rewardsChartData() {
      const obj = {}
      if (this.rewardsData) {
        this.rewardsData.slice(-10).forEach(value => {
          obj[value.epoch] = Number(value.amount) / 1000000
        })
      }
      return obj
    },
  },
  data() {
    return {
      hideZero: false,
      sortBy: 'epoch',
      sortDesc: true,
      stakingHeaders: [
        {text: 'Pool Name', align: 'start', sortable: true, value: 'pool_id'},
        {text: 'Epoch', align: 'start', sortable: true, value: 'epoch', width: 88},
        {text: 'Reward', align: 'start', sortable: true, value: 'amount', width: 100},
        {text: 'Change', align: 'start', sortable: true, value: 'change', width: 120},
      ],
      blockchainDB: undefined
    }
  },
  filters,
  methods: {
    change(item) {
      const index = this.rewardsData.indexOf(item)
      if (this.rewardsData[index-1]) {
        let previous = this.rewardsData[index-1]
        if (previous) {
          if (previous.amount === 0) {
            return 0
          }
          return Number(item.amount) - Number(previous.amount)
        }
      }
      return 0
    },
    resolvePoolIcon(poolId) {
      const pool = this.pools.find(pool => pool.pool_id_bech32 === poolId)
      if (pool) {
        return JSON.parse(pool.pool_extended_info).info.url_png_icon_64x64
      }
      return ''
    },
    resolvePoolName(poolId) {
      const pool = this.pools.find(pool => pool.pool_id_bech32 === poolId)
      if (pool) {
        return `[${pool.ticker}] ${pool.name}`
      }
      return 'N/A'
    },
    resolvePoolDescription(poolId) {
      const pool = this.pools.find(pool => pool.pool_id_bech32 === poolId)
      if (pool) {
        return pool.description
      }
      return ''
    },
    isNumeric(n) {
      return !isNaN(parseFloat(n)) && isFinite(n);
    }
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
