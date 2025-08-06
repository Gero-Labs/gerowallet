<template>
  <v-card flat outlined class="liquid-glass" :loading="loadingTxs">
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
                    <h4 style="color: white" v-if="loggedWallet && account">{{ filters.toCurrency(account.controlled_amount, false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}</h4>
                  </v-col>
                  <v-col cols="3" class="px-1 text-center">
                    <span style="font-size: 12px">Rewards</span>
                    <h4 style="color: white" v-if="account">{{ filters.toCurrency(account.withdrawable_amount, false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}</h4>
                    <v-btn v-if="account?.withdrawable_amount > 0" x-small text color="primary" @click="withdraw">
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
                      <v-img :src="assets.xSvg" alt="x"></v-img>
                    </v-avatar>
                  </v-btn>
                  <v-btn icon small v-if="poolExtendedInfo?.info?.social?.youtube_handle" :href="'https://youtube.com/'+poolExtendedInfo?.info?.social?.youtube_handle" target="_blank">
                    <v-icon small>
                      mdi-youtube
                    </v-icon>
                  </v-btn>
                  <v-btn icon small v-if="poolExtendedInfo?.info?.social?.discord_handle" :href="'https://discord.gg/'+poolExtendedInfo?.info?.social?.discord_handle" target="_blank">
                    <v-avatar tile size="14">
                      <v-img :src="assets.discordSvg" width="14" height="14" alt="discord" contain></v-img>
                    </v-avatar>
                  </v-btn>
                  <v-btn icon small v-if="poolExtendedInfo?.info?.social?.telegram_handle" :href="'https://t.me/'+poolExtendedInfo?.info?.social?.telegram_handle" target="_blank">
                    <v-avatar tile size="14">
                      <v-img :src="assets.telegramSvg" alt="telegram"></v-img>
                    </v-avatar>
                  </v-btn>
                </div>
                <v-row no-gutters class="pt-2 pb-1">
                  <v-col cols="6" style="display: block;text-align: center;" v-if="account">
                    <h5>Pool Id</h5>
                    <span style="color: white;">{{ filters.truncate(account?.pool_id) }}</span>
                    <CopyButton :value="account?.pool_id" x-small></CopyButton>
                  </v-col>
                  <v-col cols="6" style="display: block;text-align: center;">
                    <h5>ROS</h5>
                    <span style="color: white;">{{ pool?.ros ? pool.ros.toFixed(2)+'%' : '0%' }}</span>
                  </v-col>
                </v-row>
                <v-row no-gutters>
                  <v-col cols="6" style="display: block;text-align: center;" v-if="loggedWallet && pool">
                    <h5>Fees</h5>
                    <span style="font-size: 14px; color: white">{{ pool.margin + '%' }} / {{ filters.toCurrency(pool.fixed_cost, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</span>
                  </v-col>
                  <v-col cols="6" style="display: block;text-align: center;" v-if="pool">
                    <h5>Saturation</h5>
                    <v-progress-linear rounded :color="filters.getColor(pool.live_saturation)" height="16" :value="pool.live_saturation" striped>
                      <template v-slot:default="{ value }">
                        <strong>{{ Math.ceil(value) }}%</strong>
                      </template>
                    </v-progress-linear>
                    <div class="justify-space-between d-flex align-items-center" style="font-size: 10px; text-align-last: justify; color: white">
                      <strong>{{ filters.toCurrency(pool.active_stake, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}</strong>
                      <strong v-if="Number(pool.active_stake) - Number(pool.live_stake) > 100000000" style="display: inline-flex; font-size: 10px; color: white">
                        <v-icon x-small color="#47cd89" style="font-size: 10px">mdi-arrow-up-bold</v-icon>
                        {{ filters.toCurrency(Number(pool.active_stake) - Number(pool.live_stake), false, 1, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}
                      </strong>
                      <strong v-else-if="Number(pool.live_stake) - Number(pool.active_stake) > 100000000" style="display: inline-flex; font-size: 10px; color: white">
                        <v-icon x-small color="#F97066" style="font-size: 10px; line-height: 1.7;">mdi-arrow-down-bold</v-icon>
                        {{ filters.toCurrency(Number(pool.live_stake) - Number(pool.active_stake), false, 1, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}
                      </strong>
                    </div>
                  </v-col>
                </v-row>
                <v-row no-gutters class="pt-2">
                  <v-col cols="12" style="display: block;text-align: center;">
                    <div style="min-height: 155px" v-if="rewardsChartData && Object.values(rewardsChartData).length > 0">
                      <RewardsChart :chart-data="rewardsChartData"></RewardsChart>
                    </div>
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
                        <v-list-item-avatar size="32" v-if="resolvePoolIcon(item.pool_id)">
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
                      :style="isNaN(change(item)) || change(item) === Infinity || change(item) === 0 ? {color: '#A3A3A3' } : change(item) >= 0 ? { color: '#47CD89'} : { color: '#F97066'}">
                  {{ filters.toCurrency(item.amount, false, 6, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}</span>
                      <span v-else>{{ item.amount }}</span>
                    </template>
                    <template v-slot:[`item.change`]="{ item }">
                      <v-avatar tile size="20" class="mr-1">
                        <v-img
                          :src="isNaN(change(item)) || change(item) === Infinity || change(item) === 0 ? assets.arrowRightSvg : change(item) >= 0 ? assets.trendUpSvg : assets.trendDownSvg"
                          alt="trend"></v-img>
                      </v-avatar>
                      <span :style="isNaN(change(item)) || change(item) === Infinity || change(item) === 0 ? {color: '#A3A3A3' } : change(item) >= 0 ? { color: '#47CD89'} : { color: '#F97066'}">
                        {{ isNaN(change(item)) || change(item) === Infinity ? '0%' : filters.toCurrency(change(item), false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}
                      </span>
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
<script setup lang="ts">
import { toRefs, computed, ref } from 'vue'
import RewardsChart from './RewardsChart.vue';
import filters from "@/shared/utils/filters";
import CopyButton from "@/shared/components/CopyButton.vue";
import UnstakeDialog from '@/modules/staking/dialogs/UnstakeDialog.vue';
import { Cardano } from '@cardano-sdk/core';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import WithdrawalDialog from "@/modules/staking/dialogs/WithdrawalDialog.vue";
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { loadingState } from '@/stores/loading';

const props = defineProps({
  chartData: Object,
  project: Object,
})

const { loggedWallet, rewards, account, keys, utxos } = toRefs(walletStore)
const { pools, tip, epochParams } = toRefs(networkStore)
const { loadingTxs } = toRefs(loadingState)

const hideZero = ref<boolean>(false);
const sortBy = ref<string>('epoch');
const sortDesc = ref<boolean>(true);
const stakingHeaders = ref<any>([
  {text: 'Pool Name', align: 'start', sortable: true, value: 'pool_id'},
  {text: 'Epoch', align: 'start', sortable: true, value: 'epoch', width: 88},
  {text: 'Reward', align: 'start', sortable: true, value: 'amount', width: 100},
  {text: 'Change', align: 'start', sortable: true, value: 'change', width: 120},
])
const unstakeDialog = ref<boolean>(false);
const withdrawalDialog = ref<boolean>(false);
const txData = ref<any>(undefined);

const pool = computed(() => {
  if (pools.value) {
    return pools.value[account.value.pool_id]
  }
  return null
})

const poolExtendedInfo = computed(() => {
  if (pool.value) {
    return JSON.parse(pool.value.pool_extended_info)
  }
  return null
})

const rewardsData = computed(() => {
  console.log(rewards.value)
  if (rewards.value && !hideZero.value) {
    let rewardsCopy = JSON.parse(JSON.stringify(rewards.value))
    if (rewardsCopy.length > 0) {
      const min = rewardsCopy[0].epoch
      for (let i = 0 ; i < rewardsCopy.length ; i ++) {
        if (rewardsCopy[i] && rewardsCopy[i].epoch === i) continue;
        rewardsCopy.splice(i, 0, Object.assign({}, rewardsCopy[i - 1], { epoch: i, amount: '0'}))
      }
      return rewardsCopy.slice(min)
    }
  }
  return rewards.value
})

const rewardsChartData = computed(() => {
  const obj = {}
  if (rewardsData.value) {
    rewardsData.value.slice(-10).forEach(value => {
      obj[value.epoch] = Number(value.amount) / 1000000
    })
  }
  return obj
})

const withdraw = async () => {
  try {
    // Prepare withdrawals if there are any rewards
    const withdrawals = [];
    if (account.value?.withdrawable_amount && Number(account.value.withdrawable_amount) > 0) {
      withdrawals.push({
        address: loggedWallet.value.stakeAddress,
        amount: account.value.withdrawable_amount.toString()
      });
    }

    // Use the generic transaction builder for withdrawal-only transaction
    txData.value = await buildCardanoTransaction({
      withdrawals,
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value
    });

    withdrawalDialog.value = true;
  } catch (error) {
    console.error('Error building withdrawal transaction:', error);
  }
}

const unstake = async () => {
  try {
    // Check if we have epoch parameters
    if (!epochParams.value) {
      throw new Error('Epoch parameters not available');
    }

    // Check if stake key is registered
    if (!account.value?.active) {
      throw new Error('Cannot unstake: stake key is not registered');
    }

    const certificates: Cardano.Certificate[] = [];

    // Create stake credential from the key hash
    const stakeCredential: Cardano.Credential = {
      type: Cardano.CredentialType.KeyHash,
      hash: keys.value.stake[0].cred
    };

    // Use proper deposit from epoch parameters - ensure BigInt conversion
    const stakeKeyDepositLovelace = BigInt(epochParams.value.stakeKeyDeposit);

    // Create deregistration certificate
    const certificate: Cardano.Certificate = {
      __typename: Cardano.CertificateType.StakeDeregistration,
      stakeCredential,
      deposit: stakeKeyDepositLovelace
    };
    certificates.push(certificate);

    // Prepare withdrawals if there are any rewards
    const withdrawals = [];
    if (account.value?.withdrawable_amount && Number(account.value.withdrawable_amount) > 0) {
      withdrawals.push({
        address: loggedWallet.value.stakeAddress,
        amount: account.value.withdrawable_amount.toString()
      });
    }

    // Use the generic transaction builder
    // For unstaking, deposit is returned (negative implicit coin)
    txData.value = await buildCardanoTransaction({
      certificates,
      withdrawals,
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value,
      implicitCoin: -stakeKeyDepositLovelace // Deposit is returned
    });
    unstakeDialog.value = true;

  } catch (error) {
    console.error('Error building unstake transaction:', error);
    // You might want to show an error message to the user here
  }
}

const change = (item) => {
  const index = rewardsData.value.indexOf(item)
  if (rewardsData.value[index-1]) {
    let previous = rewardsData.value[index-1]
    if (previous) {
      if (previous.amount === 0) {
        return 0
      }
      return Number(item.amount) - Number(previous.amount)
    }
  }
  return 0
}

const resolvePoolIcon = (poolId) => {
  const pool = pools.value[poolId]
  if (pool) {
    return JSON.parse(pool.pool_extended_info)?.info?.url_png_icon_64x64
  }
  return ''
}

const resolvePoolName = (poolId) => {
  const pool = pools.value[poolId]
  if (pool) {
    return `[${pool.ticker}] ${pool.name}`
  }
  return 'N/A'
}

const resolvePoolDescription = (poolId) => {
  const pool = pools.value[poolId]
  if (pool) {
    return pool.description
  }
  return ''
}

const isNumeric = (n) => {
  return !isNaN(parseFloat(n)) && isFinite(n);
}
</script>
<style scoped>
.v-progress-linear__determinate {
  background: linear-gradient(90deg, #00c7f3, #00ffd1);
}

.v-data-table-header {
  background-color: rgb(22, 27, 38);
}
</style>
