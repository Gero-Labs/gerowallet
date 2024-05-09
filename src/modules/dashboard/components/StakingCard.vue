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
            <h2 style="color: white">₳42.0k</h2>
          </v-col>
          <v-col cols="3" class="px-4">
            <span>Rewards</span>
            <h2 style="color: white">₳1,068</h2>
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
            <span style="color: white">pool12yscr8j3zs34ewxrwlk0p2w5uvgcnrzywpp78ddjsj8kx...</span>
            <div class="d-flex justify-lg-space-around pt-4">
              <v-btn large style="text-transform: capitalize; background: linear-gradient(45deg, #00c7f3, #00ffd1); color: black">Withdraw<br>Rewards</v-btn>
              <v-btn large style="text-transform: capitalize;" outlined color="#F97066">Unstake<br>From Pool</v-btn>
            </div>
          </v-col>
          <v-col cols="6" class="px-4">
            <RewardsChart :chart-data="rewardsData"></RewardsChart>
          </v-col>
        </v-row>
        <v-row no-gutters>
          <v-col cols="12" xl="4" lg="12" md="12" v-for="(epochRewards, index) in rewards" :key="index" class="px-3 py-2">
            <v-card outlined color="#84CAFF" style="border-radius: 12px">
              <v-card-subtitle class="pb-0">{{ 'Epoch '+epochRewards.epoch+' '+(index === 0 ? '(Current)' : (index === 1 ? '(Next)' : '' ))}}</v-card-subtitle>
              <v-card-title class="pt-0">[GERO] Gero Pool</v-card-title>
              <v-card-text>
                <v-row no-gutters>
                  <v-col cols="5">
                    <span style="font-size: 14px; color: white">Saturation</span>
                  </v-col>
                  <v-col cols="7">
                    <v-progress-linear height="22" rounded :value="(epochRewards.saturation * 100)" color="#333741">
                      <span>{{ (epochRewards.saturation * 100) + '%'}}</span>
                    </v-progress-linear>
                  </v-col>
                </v-row>
                <v-row no-gutters>
                  <v-col cols="5">
                    <span style="font-size: 14px; color: white">Pledge</span>
                  </v-col>
                  <v-col cols="7">
                    <v-chip x-small color="#085D3A" style="border: 1px solid #75E0A7; color: #75E0A7; ">
                      {{ epochRewards.pledge | toAda  }}
                    </v-chip>
                  </v-col>
                </v-row>
                <v-row no-gutters>
                  <v-col cols="5">
                    <span style="font-size: 14px; color: white">ROS</span>
                  </v-col>
                  <v-col cols="7">
                    <span style="font-size: 14px; color: white">{{ (epochRewards.ros * 100) + '%' }}</span>
                  </v-col>
                </v-row>
                <v-row no-gutters>
                  <v-col cols="5">
                    <span style="font-size: 14px; color: white">Fees</span>
                  </v-col>
                  <v-col cols="7">
                    <span style="font-size: 14px; color: white">{{ epochRewards.margin_fee +'% / ₳' + epochRewards.fixed_fee  }}</span>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
        <v-row no-gutters class="pt-4">
          <v-col cols="12">
            <v-data-table :items="rewardsHistory" :headers="stakingHeaders" class="transparent" hide-default-footer>
              <template v-slot:[`item.pool_name`]="{ item }">
                <v-avatar size="40">
                  <v-img :src="resolvePoolIcon(item.pool_id)" :alt="item.pool_name+ 'Icon'"></v-img>
                </v-avatar>&nbsp;
                <span>{{item.pool_name}}</span>
              </template>
              <template v-slot:[`item.reward`]="{ item }">
                <span v-if="isNumeric(item.reward)" :style="item.change >= 0 ? { color: '#47CD89'} : { color: '#F97066'}">{{ item.reward | toAda() }}</span>
                <span v-else>{{item.reward}}</span>
              </template>
              <template v-slot:[`item.change`]="{ item }">
                <v-avatar tile size="20">
                  <v-img :src="item.change >= 0 ? require('@/assets/svg/trend-up-01.svg') : require('@/assets/svg/trend-down-01.svg')" alt="trend"></v-img>
                </v-avatar>&nbsp;
                <span :style="item.change >= 0 ? { color: '#47CD89'} : { color: '#F97066'}">{{ Math.abs(item.change * 100) + '%' }}</span>
              </template>
              <template v-slot:[`item.date`]="{ item }">
                <v-list-item two-line class="px-0">
                  <v-list-item-content>
                    <v-list-item-title>{{item.date}}</v-list-item-title>
                    <v-list-item-subtitle>{{item.time}}</v-list-item-subtitle>
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

export default {
  components: {RewardsChart},
  props: {
    chartData: {
      type: Object,
      default: () => {},
    },
    project: {
      type: Object,
      default: () => {},
    },
  },
  data() {
    return {
      rewardsData: {},
      rewards: [
      { poolName: '[GERO] Gero Pool', epoch: '474', saturation: 0.2, pledge: 47000000000, ros: 0.05, fixed_fee: 340, margin_fee: 0 },
      { poolName: '[GERO] Gero Pool', epoch: '475', saturation: 0.2, pledge: 47000000000, ros: 0.05, fixed_fee: 340, margin_fee: 0 },
      { poolName: '[GERO] Gero Pool', epoch: '476', saturation: 0.2, pledge: 47000000000, ros: 0.05, fixed_fee: 340, margin_fee: 0 },
    ],
    stakingHeaders: [
      {text: 'Pool Name', align: 'start', sortable: true, value: 'pool_name'},
      {text: 'Epoch', align: 'start', sortable: true, value: 'epoch', width: 88},
      {text: 'Reward', align: 'start', sortable: true, value: 'reward', width: 100},
      {text: 'Change', align: 'start', sortable: true, value: 'change', width: 100},
      {text: 'Date', align: 'start', sortable: true, value: 'date', width: 30},
    ],
    rewardsHistory: [
      {pool_id: 'asdsa', pool_name: '[GERO] Gero Pool', epoch: '476', reward: '8000540', change: -0.2, date: '05/04/2024', time: '11:44 PM'},
      {pool_id: 'asdsa', pool_name: '[GERO] Gero Pool', epoch: '476', reward: 'Delegated', change: 0, date: '10/04/2024', time: '12:44 AM'}
      ],
    }
  },
  filters,
  methods: {
    resolvePoolIcon(poolId) {
      if (poolId === 'asdsa') {
        return require('@/assets/svg/gero.svg')
      }
      return ''
    },
    isNumeric(n) {
      return !isNaN(parseFloat(n)) && isFinite(n);
    }
  },
  async mounted() {
    this.rewardsData = {
      '463': 7,
      '464': 10.2,
      '465': 3.9,
      '466': 8,
      '467': 3.5,
      '468': 9.4,
      '469': 7,
      '470': 10,
      '471': 7,
      '472': 9,
      '473': 10.5,
      '474': 6
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