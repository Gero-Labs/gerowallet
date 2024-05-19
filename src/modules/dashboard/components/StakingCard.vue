<template>
  <v-card outlined>
    <v-card-title>Staking</v-card-title>
    <v-card-text class="pa-0">
      <v-layout column>
        <v-row no-gutters style="background-color: #161B26" class="py-4">
          <v-col cols="6" class="px-4">
            <span>Staked to Pool:</span>
            <h2 style="color: white">[GERO] Gero Pool</h2>
          </v-col>
          <v-col cols="3" class="px-4">
            <span>Total ADA:</span>
            <h2 style="color: white">{{ account.controlled_amount | toAda }}</h2>
          </v-col>
          <v-col cols="3" class="px-4">
            <span>Rewards</span>
            <h2 style="color: white">{{ account.withdrawable_amount | toAda }}</h2>
          </v-col>
        </v-row>
        <v-row no-gutters class="pt-2">
          <v-col cols="6" class="px-4">
            <div>
              <v-btn icon small>
                <v-icon small>
                  mdi-facebook
                </v-icon>
              </v-btn>
              <v-btn icon small>
                <v-avatar tile size="14">
                  <v-img :src="require('@/assets/svg/x.svg')" alt="x"></v-img>
                </v-avatar>
              </v-btn>
              <v-btn icon small>
                <v-icon small>
                  mdi-youtube
                </v-icon>
              </v-btn>
              <v-btn icon small>
                <v-icon small>
                  mdi-discord
                </v-icon>
              </v-btn>
              <v-btn icon small>
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
<!--        <v-row no-gutters>-->
<!--          <v-col cols="12" xl="4" lg="12" md="12" v-for="(epochRewards, index) in rewards2" :key="index"-->
<!--                 class="px-3 py-2">-->
<!--            <v-card outlined color="#84CAFF" style="border-radius: 12px">-->
<!--              <v-card-subtitle class="pb-0">-->
<!--                {{ 'Epoch ' + epochRewards.epoch + ' ' + (index === 0 ? '(Current)' : (index === 1 ? '(Next)' : '')) }}-->
<!--              </v-card-subtitle>-->
<!--              <v-card-title class="pt-0">[GERO] Gero Pool</v-card-title>-->
<!--              <v-card-text>-->
<!--                <v-row no-gutters>-->
<!--                  <v-col cols="5">-->
<!--                    <span style="font-size: 14px; color: white">Saturation</span>-->
<!--                  </v-col>-->
<!--                  <v-col cols="7">-->
<!--                    <v-progress-linear height="22" rounded :value="(epochRewards.saturation * 100)" color="#333741">-->
<!--                      <span>{{ (epochRewards.saturation * 100) + '%' }}</span>-->
<!--                    </v-progress-linear>-->
<!--                  </v-col>-->
<!--                </v-row>-->
<!--                <v-row no-gutters>-->
<!--                  <v-col cols="5">-->
<!--                    <span style="font-size: 14px; color: white">Pledge</span>-->
<!--                  </v-col>-->
<!--                  <v-col cols="7">-->
<!--                    <v-chip x-small color="#085D3A" style="border: 1px solid #75E0A7; color: #75E0A7; ">-->
<!--                      {{ epochRewards.pledge | toAda }}-->
<!--                    </v-chip>-->
<!--                  </v-col>-->
<!--                </v-row>-->
<!--                <v-row no-gutters>-->
<!--                  <v-col cols="5">-->
<!--                    <span style="font-size: 14px; color: white">ROS</span>-->
<!--                  </v-col>-->
<!--                  <v-col cols="7">-->
<!--                    <span style="font-size: 14px; color: white">{{ (epochRewards.ros * 100) + '%' }}</span>-->
<!--                  </v-col>-->
<!--                </v-row>-->
<!--                <v-row no-gutters>-->
<!--                  <v-col cols="5">-->
<!--                    <span style="font-size: 14px; color: white">Fees</span>-->
<!--                  </v-col>-->
<!--                  <v-col cols="7">-->
<!--                    <span style="font-size: 14px; color: white">{{-->
<!--                        epochRewards.margin_fee + '% / ₳' + epochRewards.fixed_fee-->
<!--                      }}</span>-->
<!--                  </v-col>-->
<!--                </v-row>-->
<!--              </v-card-text>-->
<!--            </v-card>-->
<!--          </v-col>-->
<!--        </v-row>-->
        <v-row no-gutters class="pt-4">
          <v-col cols="12">
            <v-data-table :items="rewardsData" :headers="stakingHeaders" class="transparent"
                          :hide-default-footer="!(rewardsData?.length > 0)"
                          :sort-by.sync="sortBy"
                          :sort-desc.sync="sortDesc"
            >
              <template v-slot:[`item.pool_id`]="{ item }">
                <v-avatar size="40">
                  <v-img :src="resolvePoolIcon(item.pool_id)" :alt="item.pool_id+ ' Icon'"></v-img>
                </v-avatar>&nbsp;
                <span>{{ resolvePoolName(item.pool_id) }}</span>
              </template>
              <template v-slot:[`item.amount`]="{ item }">
                <span v-if="isNumeric(item.amount)"
                      :style="item.change >= 0 ? { color: '#47CD89'} : { color: '#F97066'}">{{
                    item.amount | toAda
                  }}</span>
                <span v-else>{{ item.amount }}</span>
              </template>
              <template v-slot:[`item.change`]="{ item }">
                <v-avatar tile size="20">
                  <v-img
                      :src="change(item) >= 0 ? require('@/assets/svg/trend-up-01.svg') : require('@/assets/svg/trend-down-01.svg')"
                      alt="trend"></v-img>
                </v-avatar>&nbsp;
                <span :style="change(item) >= 0 ? { color: '#47CD89'} : { color: '#F97066'}">{{
                    Math.abs(change(item) * 100).toFixed(0) + '%'
                  }}</span>
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
import {mapState} from "pinia";
import {useStore} from "@/store";
import CopyButton from "@/shared/components/CopyButton.vue";
import {useObservable} from "@vueuse/rxjs";
import {liveQuery} from "dexie";

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
      rewards: [],
      rewards2: [
        {
          poolName: '[GERO] Gero Pool',
          epoch: '474',
          saturation: 0.2,
          pledge: 47000000000,
          ros: 0.05,
          fixed_fee: 340,
          margin_fee: 0
        },
        {
          poolName: '[GERO] Gero Pool',
          epoch: '475',
          saturation: 0.2,
          pledge: 47000000000,
          ros: 0.05,
          fixed_fee: 340,
          margin_fee: 0
        },
        {
          poolName: '[GERO] Gero Pool',
          epoch: '476',
          saturation: 0.2,
          pledge: 47000000000,
          ros: 0.05,
          fixed_fee: 340,
          margin_fee: 0
        },
      ],
      stakingHeaders: [
        {text: 'Pool Name', align: 'start', sortable: true, value: 'pool_id'},
        {text: 'Epoch', align: 'start', sortable: true, value: 'epoch', width: 88},
        {text: 'Reward', align: 'start', sortable: true, value: 'amount', width: 100},
        {text: 'Change', align: 'start', sortable: true, value: 'change', width: 100},
      ],
    }
  },
  filters,
  methods: {
    change(item) {
      const index = this.rewardsData.indexOf(item)
      if (this.rewardsData[index-1]) {
        let previous = this.rewardsData[index-1]
        if (previous) {
          return (Number(item.amount) - Number(previous.amount))/previous.amount
        }
      }
      return 0
    },
    resolvePoolIcon(poolId) {
      if (poolId === 'pool12yscr8j3zs34ewxrwlk0p2w5uvgcnrzywpp78ddjsj8kxd530f9') {
        return require('@/assets/svg/gero.svg')
      }
      return ''
    },
    resolvePoolName(poolId) {
      if (poolId === 'pool12yscr8j3zs34ewxrwlk0p2w5uvgcnrzywpp78ddjsj8kxd530f9') {
        return "[GERO] Gero Pool"
      }
      return ''
    },
    isNumeric(n) {
      return !isNaN(parseFloat(n)) && isFinite(n);
    }
  },
  async created() {
    this.wallet = useStore().getWallet
    const db = await this.wallet.getDb()
    this.rewards = useObservable(liveQuery(() => {
      return  db.table('rewards').orderBy("epoch").toArray()
    }))
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
