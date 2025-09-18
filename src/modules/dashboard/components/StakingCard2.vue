<template>
  <v-card flat outlined class="fill-height liquid-glass" :loading="loadingTxs || poolLoading">
    <v-card-title>Staking</v-card-title>
    <v-card-text class="pa-0">
      <v-layout column>
        <v-row no-gutters class="staking2-header-row py-2">
          <v-col cols="6" class="px-2 text-center">
            <span>Delegating to</span>
            <div v-if="currentPool" class="d-flex align-center justify-center">
              <h3 class="staking2-pool-title">{{ `[${currentPool.ticker}] ${currentPool.name}` }}</h3>
              <v-menu v-model="socialMenuOpen" offset-y :close-on-content-click="false" max-width="250">
                <template v-slot:activator="{ on, attrs }">
                  <v-btn icon small v-bind="attrs" v-on="on" class="ml-2 staking2-social-btn">
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
                      v-if="currentPool?.homepage"
                      :href="currentPool.homepage"
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
                      :href="'https://www.facebook.com/' + poolExtendedInfo.info.social.facebook_handle"
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
                      :href="'https://x.com/' + poolExtendedInfo.info.social.twitter_handle"
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
                      :href="'https://youtube.com/' + poolExtendedInfo.info.social.youtube_handle"
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
                      :href="'https://discord.gg/' + poolExtendedInfo.info.social.discord_handle"
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
                      :href="'https://t.me/' + poolExtendedInfo.info.social.telegram_handle"
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
            <h4 class="staking2-amount-value" v-if="loggedWallet && account">
              {{
                filters.toCurrency(
                  account.controlled_amount,
                  false,
                  2,
                  networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                  '',
                  true
                )
              }}
            </h4>
          </v-col>
          <v-col cols="3" class="px-2 text-center">
            <span>Rewards</span>
            <h4 class="staking2-amount-value">
              {{
                filters.toCurrency(
                  account?.withdrawable_amount,
                  false,
                  2,
                  networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                )
              }}
            </h4>
          </v-col>
        </v-row>
        <v-row no-gutters class="pt-2">
          <v-col cols="6" class="px-4">
            <v-row no-gutters class="pt-2 pb-2">
              <v-col cols="4" class="staking2-stat-col">
                <h4>ROS</h4>
                <span class="staking2-stat-value">{{
                  currentPool?.ros ? currentPool.ros.toFixed(2) + '%' : '0%'
                }}</span>
              </v-col>
              <v-col cols="4" class="staking2-stat-col" v-if="currentPool">
                <h4>Pledge</h4>
                <div class="staking2-pledge-container">
                  <span class="staking2-pledge-text">{{
                    filters.toCurrency(
                      currentPool.pledge,
                      false,
                      1,
                      networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                      '',
                      true
                    )
                  }}</span>
                  <v-icon
                    x-small
                    :color="Number(currentPool.pledge) <= Number(currentPool.live_pledge) ? '#47cd89' : '#F97066'"
                    class="ml-1"
                  >
                    {{ Number(currentPool.pledge) <= Number(currentPool.live_pledge) ? 'mdi-check' : 'mdi-close' }}
                  </v-icon>
                </div>
              </v-col>
              <v-col cols="4" class="staking2-stat-col" v-if="loggedWallet && currentPool">
                <h4>Fees</h4>
                <span class="staking2-fees-text"
                  >{{ currentPool.margin + '%' }} /
                  {{
                    filters.toCurrency(
                      currentPool.fixed_cost,
                      false,
                      0,
                      networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                    )
                  }}</span
                >
              </v-col>
            </v-row>
          </v-col>
          <v-col cols="6" class="px-4">
            <div v-if="currentPool" class="staking2-saturation-container">
              <div class="staking2-saturation-header">
                <strong class="staking2-stake-amount">{{
                  filters.toCurrency(currentPool.active_stake, false, 1, '₳', '', true)
                }}</strong>
                <h4 class="staking2-saturation-title">Saturation</h4>
                <strong
                  v-if="Number(currentPool.active_stake) - Number(currentPool.live_stake) > 100000000"
                  class="staking2-stake-change-up"
                >
                  <v-icon x-small color="#47cd89" class="staking2-arrow-icon">mdi-arrow-up-bold</v-icon>
                  {{
                    filters.toCurrency(
                      Number(currentPool.active_stake) - Number(currentPool.live_stake),
                      false,
                      1,
                      networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                      '',
                      true
                    )
                  }}
                </strong>
                <strong
                  v-else-if="Number(currentPool.live_stake) - Number(currentPool.active_stake) > 100000000"
                  class="staking2-stake-change-down"
                >
                  <v-icon x-small color="#F97066" class="staking2-arrow-icon-down">mdi-arrow-down-bold</v-icon>
                  {{
                    filters.toCurrency(
                      Number(currentPool.live_stake) - Number(currentPool.active_stake),
                      false,
                      1,
                      networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                      '',
                      true
                    )
                  }}
                </strong>
                <span v-else class="staking2-placeholder">&nbsp;</span>
              </div>
              <div class="staking2-progress-container">
                <v-progress-linear
                  rounded
                  :color="filters.getColor(currentPool.live_saturation)"
                  height="16"
                  :value="currentPool.live_saturation"
                  striped
                  class="staking2-progress-bar"
                >
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
            <v-card-text
              v-if="!rewardsChartData || Object.values(rewardsChartData).length === 0"
              class="staking2-no-rewards text-center pa-4"
            >
              <v-progress-circular v-if="loadingTxs" :indeterminate="true"></v-progress-circular>
              <span v-else>No Rewards Yet</span>
            </v-card-text>
            <div class="staking2-chart-container" v-else>
              <RewardsChart :chart-data="rewardsChartData" class="staking2-chart"></RewardsChart>
            </div>
          </v-col>
        </v-row>

        <!-- Action Buttons Row -->
        <v-row no-gutters class="px-4 pb-3 pt-2 staking-action-buttons">
          <v-col cols="6">
            <v-btn elevation="2" height="36" color="#1a1a1a" @click="unstake" block class="staking2-unstake-btn">
              <span class="staking2-unstake-text">Unstake</span>
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
              class="staking2-withdraw-btn"
            >
              <span class="staking2-withdraw-text">Withdraw</span>
            </v-btn>
            <v-btn v-else elevation="2" height="36" color="#1a1a1a" disabled block class="staking2-no-rewards-btn">
              <span class="staking2-no-rewards-text">No Rewards</span>
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
import { computed, ref, toRefs, watch, onMounted } from 'vue';
import RewardsChart from './RewardsChart.vue';
import filters from '@/shared/utils/filters';
import UnstakeDialog from '@/modules/staking/dialogs/UnstakeDialog.vue';
import { Cardano } from '@cardano-sdk/core';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import WithdrawalDialog from '@/modules/staking/dialogs/WithdrawalDialog.vue';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { loadingState } from '@/stores/loading';
import stakingStoreActions from '@/stores/stakingStore';

const { loggedWallet, rewards, account, keys, utxos } = toRefs(walletStore);
const { tip, epochParams } = toRefs(networkStore);
const { loadingTxs } = toRefs(loadingState);
const { currentPool, poolLoading } = toRefs(stakingStoreActions.state);

const hideZero = ref<boolean>(false);
const unstakeDialog = ref<boolean>(false);
const withdrawalDialog = ref<boolean>(false);
const txData = ref<any>(undefined);
const socialMenuOpen = ref<boolean>(false);

const poolExtendedInfo = computed(() => {
  if (currentPool.value) {
    return JSON.parse(currentPool.value.pool_extended_info);
  }
  return null;
});

const rewardsData = computed(() => {
  if (rewards.value && !hideZero.value) {
    let rewardsCopy = JSON.parse(JSON.stringify(rewards.value));
    if (rewardsCopy.length > 0) {
      const min = rewardsCopy[0].epoch;
      for (let i = 0; i < rewardsCopy.length; i++) {
        if (rewardsCopy[i] && rewardsCopy[i].epoch === i) continue;
        rewardsCopy.splice(i, 0, Object.assign({}, rewardsCopy[i - 1], { epoch: i, amount: '0' }));
      }
      return rewardsCopy.slice(min);
    }
  }
  return rewards.value;
});

const rewardsChartData = computed(() => {
  const obj = {};
  if (rewardsData.value) {
    rewardsData.value.slice(-10).forEach(value => {
      obj[value.epoch] = Number(value.amount) / 1000000;
    });
  }
  return obj;
});

const withdraw = async () => {
  try {
    // Prepare withdrawals if there are any rewards
    const withdrawals: Cardano.Withdrawal[] = [];
    if (account.value?.withdrawable_amount && Number(account.value.withdrawable_amount) > 0) {
      withdrawals.push({
        stakeAddress: loggedWallet.value.stakeAddress,
        quantity: BigInt(account.value.withdrawable_amount),
      });
    }

    // Use the generic transaction builder for withdrawal-only transaction
    txData.value = await buildCardanoTransaction({
      withdrawals,
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value,
    });

    withdrawalDialog.value = true;
  } catch (error) {
    console.error('Error building withdrawal transaction:', error);
  }
};

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
      hash: keys.value.stake[0].cred,
    };

    // Use proper deposit from epoch parameters - ensure BigInt conversion
    const stakeKeyDepositLovelace = BigInt(epochParams.value.stakeKeyDeposit);

    // Create deregistration certificate
    const certificate: Cardano.Certificate = {
      __typename: Cardano.CertificateType.StakeDeregistration,
      stakeCredential,
    };
    certificates.push(certificate);

    // Prepare withdrawals if there are any rewards
    const withdrawals: Cardano.Withdrawal[] = [];
    if (account.value?.withdrawable_amount && Number(account.value.withdrawable_amount) > 0) {
      withdrawals.push({
        stakeAddress: loggedWallet.value.stakeAddress,
        quantity: BigInt(account.value.withdrawable_amount),
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
      implicitCoin: -stakeKeyDepositLovelace, // Deposit is returned
    });
    unstakeDialog.value = true;
  } catch (error) {
    console.error('Error building unstake transaction:', error);
    // You might want to show an error message to the user here
  }
};

const loadPoolData = async (poolId: string) => {
  if (poolId && loggedWallet.value) {
    try {
      stakingStoreActions.clearCurrentPool();
      await stakingStoreActions.loadPoolById(loggedWallet.value, poolId);
    } catch (error) {
      console.error('Error loading pool data:', error);
    }
  }
};

watch(
  () => account.value?.pool_id,
  async (newPoolId, oldPoolId) => {
    if (newPoolId && newPoolId !== oldPoolId) {
      await loadPoolData(newPoolId);
    }
  },
  { immediate: true }
);

onMounted(async () => {
  if (account.value?.pool_id) {
    await loadPoolData(account.value.pool_id);
  }
});
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

/* StakingCard2 specific styles */
.staking2-header-row {
  background-color: #161b26;
}

.staking2-pool-title {
  color: white;
  font-size: 16px;
  margin: 0;
}

.staking2-social-btn {
  margin-top: -2px;
}

.staking2-amount-value {
  color: white;
  font-size: 16px;
  margin: 4px 0;
}

.staking2-stat-col {
  display: block;
  text-align: center;
}

.staking2-stat-value {
  color: white;
  font-size: 13px;
}

.staking2-pledge-container {
  display: flex;
  align-items: center;
  justify-content: center;
}

.staking2-pledge-text {
  color: white;
  font-size: 12px;
}

.staking2-fees-text {
  font-size: 12px;
  color: white;
}

.staking2-saturation-container {
  padding-top: 8px;
}

.staking2-saturation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.staking2-stake-amount {
  font-size: 10px;
  color: white;
}

.staking2-saturation-title {
  margin: 0;
}

.staking2-stake-change-up {
  display: inline-flex;
  font-size: 10px;
  color: white;
  align-items: center;
}

.staking2-stake-change-down {
  display: inline-flex;
  font-size: 10px;
  color: white;
  align-items: center;
}

.staking2-arrow-icon {
  font-size: 10px;
}

.staking2-arrow-icon-down {
  font-size: 10px;
  line-height: 1.7;
}

.staking2-placeholder {
  font-size: 10px;
}

.staking2-progress-container {
  display: flex;
  justify-content: center;
}

.staking2-progress-bar {
  width: 90%;
}

.staking2-no-rewards {
  font-size: 20px;
}

.staking2-chart-container {
  height: 120px;
}

.staking2-chart {
  height: 100%;
  width: 100%;
}

/* Action buttons styles */
.staking2-unstake-btn {
  text-transform: capitalize;
}

.staking2-unstake-text {
  color: #f97066;
  font-weight: 600;
}

.staking2-withdraw-btn {
  text-transform: capitalize;
}

.staking2-withdraw-text {
  color: #47cd89;
  font-weight: 600;
}

.staking2-no-rewards-btn {
  text-transform: capitalize;
}

.staking2-no-rewards-text {
  color: #666;
  font-weight: 600;
}
</style>
