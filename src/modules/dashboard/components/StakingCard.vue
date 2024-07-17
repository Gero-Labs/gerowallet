<template>
  <v-card outlined :loading="loadingTxs">
    <v-card-title>Staking</v-card-title>
    <v-card-text class="pa-0">
      <v-layout column>
        <v-row no-gutters>
          <v-col cols="5">
            <v-card outlined flat tile class="fill-height" style="border-left-width: 0; border-bottom-width: 0">
              <v-card-title style="font-size: 14px; line-height: 1.5" class="pa-2">
                <v-row no-gutters style="background-color: #161B26; border-radius: 8px" class="py-4" >
                  <v-col cols="6" class="px-1 text-center">
                    <span style="font-size: 12px">Delegating to</span>
                    <h4 style="color: white" v-if="pool">{{ `[${pool.ticker}] ${pool.name}` }}</h4>
                    <v-btn x-small text color="#F97066" @click="unstake">Unstake</v-btn>
                  </v-col>
                  <v-col cols="3" class="px-1 text-center">
                    <span style="font-size: 12px">Total</span>
                    <h4 style="color: white" v-if="loggedWallet">{{ accountInfo.controlled_amount | toCurrency(false, 2, networks.resolveCurrencySymbol(loggedWallet.chain, loggedWallet.network), true)
                      }}</h4>
                  </v-col>
                  <v-col cols="3" class="px-1 text-center">
                    <span style="font-size: 12px">Rewards</span>
                    <h4 style="color: white">{{ accountInfo.withdrawable_amount | toCurrency }}</h4>
                    <v-btn v-if="accountInfo.withdrawable_amount > 0" x-small text color="primary" @click="withdraw">
                      Withdraw
                    </v-btn>
                  </v-col>
                </v-row>
              </v-card-title>
              <v-card-text>
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
                <v-row no-gutters class="pt-2 pb-1">
                  <v-col cols="6" style="display: block;text-align: center;">
                    <h5>Pool Id</h5>
                    <span style="color: white;">{{ accountInfo.pool_id | truncate }}</span>
                    <copy-button :value="accountInfo.pool_id" x-small></copy-button>
                  </v-col>
                  <v-col cols="6" style="display: block;text-align: center;">
                    <h5>ROS</h5>
                    <span style="color: white;">{{ pool?.ros ? pool.ros.toFixed(2)+'%' : '0%' }}</span>
                  </v-col>
                </v-row>
                <v-row no-gutters>
                  <v-col cols="6" style="display: block;text-align: center;" v-if="loggedWallet && pool">
                    <h5>Fees</h5>
                    <span style="font-size: 14px; color: white">{{ pool.margin + '%' }} / {{ pool.fixed_cost | toCurrency(false, 0, loggedWallet.network !== Network.MAINNET ? 't₳' : '₳') }}</span>
                  </v-col>
                  <v-col cols="6" style="display: block;text-align: center;" v-if="pool">
                    <h5>Saturation</h5>
                    <v-progress-linear rounded :color="getColor(pool.live_saturation)" height="16" :value="pool.live_saturation" striped>
                      <template v-slot:default="{ value }">
                        <strong>{{ Math.ceil(value) }}%</strong>
                      </template>
                    </v-progress-linear>
                    <div class="justify-space-between d-flex align-items-center" style="font-size: 10px; text-align-last: justify; color: white">
                      <strong>{{ pool.active_stake | toCurrency(false, 1, '₳', true) }}</strong>
                      <strong v-if="Number(pool.active_stake) - Number(pool.live_stake) > 100000000" style="display: inline-flex; font-size: 10px; color: white">
                        <v-icon x-small color="#47cd89" style="font-size: 10px">mdi-arrow-up-bold</v-icon>
                        {{ Number(pool.active_stake) - Number(pool.live_stake) | toCurrency(false, 1, '₳', true) }}
                      </strong>
                      <strong v-else-if="Number(pool.live_stake) - Number(pool.active_stake) > 100000000" style="display: inline-flex; font-size: 10px; color: white">
                        <v-icon x-small color="#F97066" style="font-size: 10px; line-height: 1.7;">mdi-arrow-down-bold</v-icon>
                        {{ Number(pool.live_stake) - Number(pool.active_stake) | toCurrency(false, 1, '₳', true) }}
                      </strong>
                    </div>
                  </v-col>
                </v-row>
                <v-row no-gutters class="pt-2">
                  <v-col cols="12" style="display: block;text-align: center;">
                    <RewardsChart :chart-data="rewardsChartData"></RewardsChart>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="7">
            <v-card outlined flat tile class="fill-height" style="border-left-width: 0; border-right-width: 0; border-bottom-width: 0">
              <v-card-text class="pa-2">
                <v-card outlined flat>
                  <v-data-table :items="rewardsData" :headers="stakingHeaders" class="transparent"
                                :hide-default-footer="!(rewardsData?.length > 0)"
                                :sort-by.sync="sortBy"
                                :sort-desc.sync="sortDesc"
                                dense
                                :items-per-page="5"
                                :header-props="{ 'sort-icon': 'mdi-menu-up' }"
                  >
                    <template v-slot:[`item.pool_id`]="{ item }">
                      <v-list-item two-line class="px-0">
                        <v-list-item-avatar size="32">
                          <v-img :src="resolvePoolIcon(item.pool_id)" :alt="item.pool_id+ ' Icon'"></v-img>
                        </v-list-item-avatar>
                        <v-list-item-content>
                          <v-list-item-title style="display: -webkit-box; -webkit-line-clamp: 1;-webkit-box-orient: vertical;overflow: hidden;text-overflow: ellipsis;white-space: normal;">{{ resolvePoolName(item.pool_id) }}</v-list-item-title>
                          <v-list-item-subtitle style="display: -webkit-box; -webkit-line-clamp: 1;-webkit-box-orient: vertical;overflow: hidden;text-overflow: ellipsis;white-space: normal;">
                            {{ resolvePoolDescription(item.pool_id) }}
                          </v-list-item-subtitle>
                        </v-list-item-content>
                      </v-list-item>
                    </template>
                    <template v-slot:[`item.amount`]="{ item }">
                <span v-if="isNumeric(item.amount)"
                      :style="isNaN(change(item)) || change(item) === Infinity || change(item) === 0 ? {color: '#A3A3A3' } : change(item) >= 0 ? { color: '#47CD89'} : { color: '#F97066'}">{{
                    item.amount | toCurrency
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
                  {{ isNaN(change(item)) || change(item) === Infinity ? '0%' : filters.toCurrency(change(item), false)
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
                </v-card>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-layout>
    </v-card-text>
    <UnstakeDialog :is-open="unstakeDialog" @close="unstakeDialog = false" :tx="txData"></UnstakeDialog>
    <WithdrawalDialog :is-open="withdrawalDialog" @close="withdrawalDialog = false" :tx="txData"></WithdrawalDialog>
  </v-card>
</template>
<script>
import RewardsChart from './RewardsChart.vue';
import filters from "@/shared/utils/filters";
import { appWallet, useStore } from '@/store';
import CopyButton from "@/shared/components/CopyButton.vue";
import {Network} from "@/models/types";
import {mapState} from "pinia";
import UnstakeDialog from '@/modules/staking/dialogs/UnstakeDialog.vue';
import {
  Certificate, Ed25519KeyHash,
  StakeCredential,
  StakeDelegation, StakeDeregistration,
  StakeRegistration, Transaction, TransactionUnspentOutputs, TransactionWitnessSet,
} from '@emurgo/cardano-serialization-lib-browser';
import { getColor, toUTxO } from '@/shared/utils/converter';
import { buildTx } from '@/shared/utils/builder';
import WithdrawalDialog from "@/modules/staking/dialogs/WithdrawalDialog.vue";
import networks from '@/shared/utils/networks';

export default {
  components: {WithdrawalDialog, UnstakeDialog, CopyButton, RewardsChart},
  props: {
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
    ...mapState(useStore, ['rewards','loggedWallet','pools', 'loadingTxs', 'accountInfo', 'utxos', 'latestTip', 'baseAddress', 'stakeAddress']),
    Network() {
      return Network
    },
    pool() {
      if (this.pools) {
        return this.pools.find(pool => pool.pool_id_bech32 === this.accountInfo.pool_id)
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
      networks,
      hideZero: false,
      sortBy: 'epoch',
      sortDesc: true,
      stakingHeaders: [
        {text: 'Pool Name', align: 'start', sortable: true, value: 'pool_id'},
        {text: 'Epoch', align: 'start', sortable: true, value: 'epoch', width: 88},
        {text: 'Reward', align: 'start', sortable: true, value: 'amount', width: 100},
        {text: 'Change', align: 'start', sortable: true, value: 'change', width: 120},
      ],
      blockchainDB: undefined,
      unstakeDialog: false,
      withdrawalDialog: false,
      txData: undefined,
    }
  },
  filters,
  methods: {
    getColor,
    withdraw() {
      // Withdrawals
      const withdrawals = []
      if (this.accountInfo?.withdrawable_amount && Number(this.accountInfo.withdrawable_amount) > 0) {
        withdrawals.push({
          address: this.stakeAddress,
          amount: this.accountInfo.withdrawable_amount
        })
      }
      const transactionUnspentOutputs = TransactionUnspentOutputs.new();
      this.utxos.forEach((utxo) => transactionUnspentOutputs.add(toUTxO(utxo)));
      const txBody = buildTx(this.loggedWallet, undefined, transactionUnspentOutputs, this.latestTip.slot, this.baseAddress, [], withdrawals)
      this.txData = Transaction.new(txBody, TransactionWitnessSet.new())
      console.log(txBody.to_json())
      console.log(this.txData)
      this.withdrawalDialog = true
    },
    unstake() {
      console.log('test')
      const certificates = [];
      if (this.accountInfo?.active) {
        // DeRegistration Certificate
        const deRegistrationCertificate = Certificate.new_stake_deregistration(StakeDeregistration.new(StakeCredential.from_keyhash(appWallet.stakeKey().hash())))
        certificates.push(deRegistrationCertificate);
        // Withdrawals
        const withdrawals = []
        if (this.accountInfo?.withdrawable_amount && Number(this.accountInfo.withdrawable_amount) > 0) {
          withdrawals.push({
            address: this.stakeAddress,
            amount: this.accountInfo.withdrawable_amount
          })
        }
        // if (this.accountInfo)
        const transactionUnspentOutputs = TransactionUnspentOutputs.new();
        this.utxos.forEach((utxo) => transactionUnspentOutputs.add(toUTxO(utxo)));
        const txBody = buildTx(this.loggedWallet, undefined, transactionUnspentOutputs, this.latestTip.slot, this.baseAddress, certificates, withdrawals)
        this.txData = Transaction.new(txBody, TransactionWitnessSet.new())
        console.log(txBody.to_json())
        console.log(this.txData)
        this.unstakeDialog = true
      }
    },
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
