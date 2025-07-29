<template>
  <v-card flat outlined class="fill-height liquid-glass" :loading="loadingTxs">
    <v-card-title>Staking</v-card-title>
    <v-card-text class="pa-0">
      <v-layout column>
        <v-row no-gutters style="background-color: #161B26" class="py-2">
          <v-col cols="6" class="px-2 text-center">
            <span>Delegating to</span>
            <div v-if="pool" class="d-flex align-center justify-center">
              <h3 style="color: white; font-size: 16px; margin: 0;">{{ `[${pool.ticker}] ${pool.name}` }}</h3>
              <v-menu
                v-model="socialMenuOpen"
                offset-y
                :close-on-content-click="false"
                max-width="250"
              >
                <template v-slot:activator="{ on, attrs }">
                  <v-btn
                    icon
                    small
                    v-bind="attrs"
                    v-on="on"
                    class="ml-2"
                    style="margin-top: -2px;"
                  >
                    <v-icon small color="white">mdi-share-variant</v-icon>
                  </v-btn>
                </template>
                
                <v-card class="social-dropdown-card">
                  <v-card-title class="py-2 px-3">
                    <span class="subtitle-2">Pool Links</span>
                  </v-card-title>
                  <v-divider></v-divider>
                  <v-list dense class="social-links-list">
                    <v-list-item
                      v-if="pool?.homepage"
                      :href="pool.homepage"
                      target="_blank"
                      class="social-link-item"
                    >
                      <v-list-item-icon class="mr-3">
                        <v-icon small>mdi-web</v-icon>
                      </v-list-item-icon>
                      <v-list-item-content>
                        <v-list-item-title class="social-link-text">Website</v-list-item-title>
                      </v-list-item-content>
                    </v-list-item>
                    
                    <v-list-item
                      v-if="poolExtendedInfo?.info?.social?.facebook_handle"
                      :href="'https://www.facebook.com/'+poolExtendedInfo.info.social.facebook_handle"
                      target="_blank"
                      class="social-link-item"
                    >
                      <v-list-item-icon class="mr-3">
                        <v-icon small>mdi-facebook</v-icon>
                      </v-list-item-icon>
                      <v-list-item-content>
                        <v-list-item-title class="social-link-text">Facebook</v-list-item-title>
                      </v-list-item-content>
                    </v-list-item>
                    
                    <v-list-item
                      v-if="poolExtendedInfo?.info?.social?.twitter_handle"
                      :href="'https://x.com/'+poolExtendedInfo.info.social.twitter_handle"
                      target="_blank"
                      class="social-link-item"
                    >
                      <v-list-item-icon class="mr-3">
                        <v-avatar tile size="16">
                          <v-img :src="assets.xSvg" alt="x"></v-img>
                        </v-avatar>
                      </v-list-item-icon>
                      <v-list-item-content>
                        <v-list-item-title class="social-link-text">X (Twitter)</v-list-item-title>
                      </v-list-item-content>
                    </v-list-item>
                    
                    <v-list-item
                      v-if="poolExtendedInfo?.info?.social?.youtube_handle"
                      :href="'https://youtube.com/'+poolExtendedInfo.info.social.youtube_handle"
                      target="_blank"
                      class="social-link-item"
                    >
                      <v-list-item-icon class="mr-3">
                        <v-icon small>mdi-youtube</v-icon>
                      </v-list-item-icon>
                      <v-list-item-content>
                        <v-list-item-title class="social-link-text">YouTube</v-list-item-title>
                      </v-list-item-content>
                    </v-list-item>
                    
                    <v-list-item
                      v-if="poolExtendedInfo?.info?.social?.discord_handle"
                      :href="'https://discord.gg/'+poolExtendedInfo.info.social.discord_handle"
                      target="_blank"
                      class="social-link-item"
                    >
                      <v-list-item-icon class="mr-3">
                        <v-avatar tile size="16">
                          <v-img :src="assets.discordSvg" alt="discord" contain></v-img>
                        </v-avatar>
                      </v-list-item-icon>
                      <v-list-item-content>
                        <v-list-item-title class="social-link-text">Discord</v-list-item-title>
                      </v-list-item-content>
                    </v-list-item>
                    
                    <v-list-item
                      v-if="poolExtendedInfo?.info?.social?.telegram_handle"
                      :href="'https://t.me/'+poolExtendedInfo.info.social.telegram_handle"
                      target="_blank"
                      class="social-link-item"
                    >
                      <v-list-item-icon class="mr-3">
                        <v-avatar tile size="16">
                          <v-img :src="assets.telegramSvg" alt="telegram"></v-img>
                        </v-avatar>
                      </v-list-item-icon>
                      <v-list-item-content>
                        <v-list-item-title class="social-link-text">Telegram</v-list-item-title>
                      </v-list-item-content>
                    </v-list-item>
                  </v-list>
                </v-card>
              </v-menu>
            </div>
          </v-col>
          <v-col cols="3" class="px-2 text-center">
            <span>Total</span>
            <h4 style="color: white; font-size: 16px; margin: 4px 0;" v-if="loggedWallet && account">{{ filters.toCurrency(account.controlled_amount, false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}</h4>
          </v-col>
          <v-col cols="3" class="px-2 text-center">
            <span>Rewards</span>
            <h4 style="color: white; font-size: 16px; margin: 4px 0;">{{ filters.toCurrency(account?.withdrawable_amount, false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</h4>
          </v-col>
        </v-row>
        <v-row no-gutters class="pt-2">
          <v-col cols="6" class="px-4">
            <v-row no-gutters class="pt-2 pb-2">
              <v-col cols="4" style="display: block;text-align: center;">
                <h4>ROS</h4>
                <span style="color: white; font-size: 13px;">{{ pool?.ros ? pool.ros.toFixed(2)+'%' : '0%' }}</span>
              </v-col>
              <v-col cols="4" style="display: block;text-align: center;" v-if="pool">
                <h4>Pledge</h4>
                <div style="display: flex; align-items: center; justify-content: center;">
                  <span style="color: white; font-size: 12px;">{{ filters.toCurrency(pool.pledge, false, 1, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}</span>
                  <v-icon x-small :color="Number(pool.pledge) <= Number(pool.live_pledge) ? '#47cd89' : '#F97066'" class="ml-1">
                    {{ Number(pool.pledge) <= Number(pool.live_pledge) ? 'mdi-check' : 'mdi-close' }}
                  </v-icon>
                </div>
              </v-col>
              <v-col cols="4" style="display: block;text-align: center;" v-if="loggedWallet && pool">
                <h4>Fees</h4>
                <span style="font-size: 12px; color: white">{{ pool.margin + '%' }} / {{ filters.toCurrency(pool.fixed_cost, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</span>
              </v-col>
            </v-row>
          </v-col>
          <v-col cols="6" class="px-4">
            <div v-if="pool" style="padding-top: 8px;">
              <div class="d-flex align-items-center justify-space-between" style="margin-bottom: 4px;">
                <strong style="font-size: 10px; color: white;">{{ filters.toCurrency(pool.active_stake, false, 1, '₳', '', true) }}</strong>
                <h4 style="margin: 0;">Saturation</h4>
                <strong v-if="Number(pool.active_stake) - Number(pool.live_stake) > 100000000" style="display: inline-flex; font-size: 10px; color: white; align-items: center;">
                  <v-icon x-small color="#47cd89" style="font-size: 10px">mdi-arrow-up-bold</v-icon>
                  {{ filters.toCurrency(Number(pool.active_stake) - Number(pool.live_stake), false, 1, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}
                </strong>
                <strong v-else-if="Number(pool.live_stake) - Number(pool.active_stake) > 100000000" style="display: inline-flex; font-size: 10px; color: white; align-items: center;">
                  <v-icon x-small color="#F97066" style="font-size: 10px; line-height: 1.7;">mdi-arrow-down-bold</v-icon>
                  {{ filters.toCurrency(Number(pool.live_stake) - Number(pool.active_stake), false, 1, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}
                </strong>
                <span v-else style="font-size: 10px;">&nbsp;</span>
              </div>
              <div style="display: flex; justify-content: center;">
                <v-progress-linear rounded :color="filters.getColor(pool.live_saturation)" height="16" :value="pool.live_saturation" striped style="width: 90%;">
                  <template v-slot:default="{ value }">
                    <strong>{{ Math.ceil(value) }}%</strong>
                  </template>
                </v-progress-linear>
              </div>
            </div>
          </v-col>
        </v-row>
        
        <!-- Reward History Chart Row - Full Width -->
        <v-row no-gutters class="px-4 pb-2">
          <v-col cols="12">
            <v-card-text v-if="!rewardsChartData || Object.values(rewardsChartData).length === 0" style="font-size: 20px;" class="text-center pa-4">
              <v-progress-circular v-if="loadingTxs" :indeterminate="true"></v-progress-circular>
              <span v-else>No Rewards Yet</span>
            </v-card-text>
            <div style="height: 120px;" v-else>
              <RewardsChart :chart-data="rewardsChartData" style="height: 100%; width: 100%;"></RewardsChart>
            </div>
          </v-col>
        </v-row>
        
        <!-- Action Buttons Row -->
        <v-row no-gutters class="px-4 pb-3 pt-2 staking-action-buttons">
          <v-col cols="6">
            <v-btn 
              elevation="2" 
              height="36" 
              color="#1a1a1a" 
              @click="unstake" 
              block
              style="text-transform: capitalize;"
            >
              <span style="color: #F97066; font-weight: 600;">Unstake</span>
            </v-btn>
          </v-col>
          <v-col cols="6" class="pl-3">
            <v-btn 
              v-if="account?.withdrawable_amount > 0"
              elevation="2" 
              height="36" 
              color="#1a1a1a" 
              @click="withdraw" 
              block
              style="text-transform: capitalize;"
            >
              <span style="color: #47CD89; font-weight: 600;">Withdraw</span>
            </v-btn>
            <v-btn 
              v-else
              elevation="2" 
              height="36" 
              color="#1a1a1a" 
              disabled
              block
              style="text-transform: capitalize;"
            >
              <span style="color: #666; font-weight: 600;">No Rewards</span>
            </v-btn>
          </v-col>
        </v-row>
      </v-layout>
    </v-card-text>
    <UnstakeDialog :is-open="unstakeDialog" @close="unstakeDialog = false" :tx="txData"></UnstakeDialog>
    <WithdrawalDialog :is-open="withdrawalDialog" @close="withdrawalDialog = false" :tx="txData"></WithdrawalDialog>
  </v-card>
</template>
<script setup lang="ts">
import { toRefs, computed } from 'vue'
import RewardsChart from './RewardsChart.vue';
import filters from "@/shared/utils/filters";
import CopyButton from "@/shared/components/CopyButton.vue";
import UnstakeDialog from '@/modules/staking/dialogs/UnstakeDialog.vue';
import {
  Certificate, Credential, Ed25519KeyHash,
  StakeDeregistration,
  Transaction, TransactionUnspentOutputs, TransactionWitnessSet,
} from '@emurgo/cardano-serialization-lib-browser';
import { toUTxO2 } from '@/shared/utils/converter';
import { buildTx } from '@/shared/utils/builder';
import WithdrawalDialog from "@/modules/staking/dialogs/WithdrawalDialog.vue";
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { loadingState } from '@/stores/loading';

const { loggedWallet, rewards, account, keys, utxos } = toRefs(walletStore)
const { pools, tip, epochParams } = toRefs(networkStore)
const { loadingTxs } = toRefs(loadingState)

const hideZero = ref<boolean>(false);
const unstakeDialog = ref<boolean>(false);
const withdrawalDialog = ref<boolean>(false);
const txData = ref<any>(undefined);
const socialMenuOpen = ref<boolean>(false);

const pool = computed(() => {
  if (pools.value) {
    return pools.value[account.value?.pool_id]
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

const withdraw = () => {
  const withdrawals = []
  if (account.value?.withdrawable_amount && Number(account.value.withdrawable_amount) > 0) {
    withdrawals.push({
      address: loggedWallet.value.stakeAddress,
      amount: account.value.withdrawable_amount
    })
  }
  const transactionUnspentOutputs = TransactionUnspentOutputs.new();
  utxos.value.forEach((utxo) => transactionUnspentOutputs.add(toUTxO2(utxo)));
  const txBody = buildTx(epochParams.value, undefined, transactionUnspentOutputs, tip.value.slot, loggedWallet.value.baseAddress, [], withdrawals)
  txData.value = Transaction.new(txBody, TransactionWitnessSet.new())
  console.log(txBody.to_json())
  withdrawalDialog.value = true
}

const unstake = () => {
  const certificates = [];
  if (account.value?.active) {
    // DeRegistration Certificate
    const deRegistrationCertificate = Certificate.new_stake_deregistration(StakeDeregistration.new(Credential.from_keyhash(Ed25519KeyHash.from_hex(keys.value.stake[0].cred))))
    certificates.push(deRegistrationCertificate);
    // Withdrawals
    const withdrawals = []
    if (account.value?.withdrawable_amount && Number(account.value.withdrawable_amount) > 0) {
      withdrawals.push({
        address: loggedWallet.value.stakeAddress,
        amount: account.value.withdrawable_amount
      })
    }
    const transactionUnspentOutputs = TransactionUnspentOutputs.new();
    utxos.value?.forEach((utxo) => transactionUnspentOutputs.add(toUTxO2(utxo)));
    const txBody = buildTx(epochParams.value, undefined, transactionUnspentOutputs, tip.value.slot, loggedWallet.value.baseAddress, certificates, withdrawals)
    txData.value = Transaction.new(txBody, TransactionWitnessSet.new())
    console.log(txBody.to_json())
    unstakeDialog.value = true
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

</script>
<style scoped>
.v-progress-linear__determinate {
  background: linear-gradient(90deg, #00c7f3, #00ffd1);
}


.staking-action-buttons {
  position: absolute;
  bottom: 0;
  width: 100%;
  left: 0;
}

/* Social Dropdown Liquid Glass Effect */
.social-dropdown-card {
  background-color: rgba(0, 0, 0, 0.4) !important;
  backdrop-filter: blur(20px) saturate(1.8) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.8) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  isolation: isolate !important;
}

.social-links-list {
  background: transparent !important;
}

.social-link-item {
  border-radius: 8px !important;
  margin: 2px 6px !important;
  transition: all 0.2s ease !important;
}

.social-link-item:hover {
  background-color: rgba(255, 255, 255, 0.1) !important;
  transform: translateY(-1px);
}

.social-link-text {
  color: #ffffff !important;
  font-size: 14px !important;
  font-weight: 500 !important;
}
</style>
