<template>
  <v-card flat outlined class="fill-height liquid-glass" :loading="loadingTxs || poolLoading">
    <v-card-title>
      <router-link
        to="/staking"
        style="text-decoration: auto; color: white;"
      >{{ $t('staking.staking') }}</router-link>
    </v-card-title>
    <v-card-text class="pa-0">
      <v-layout column>
        <v-row no-gutters class="staking2-header-row py-2">
          <v-col cols="6" class="px-2 text-center">
            <span>{{ $t('staking.delegatingTo') }}</span>
            <div v-if="currentPool" class="d-flex align-center justify-center">
              <v-avatar size="28" class="mr-2">
                <v-img :src="JSON.parse(currentPool?.pool_extended_info)?.info?.url_png_icon_64x64" alt="pool logo" contain/>
              </v-avatar>
              <h3 class="staking2-pool-title">{{ `${currentPool.ticker}` }}</h3>
              <v-menu
                v-model="socialMenuOpen"
                offset-y
                :close-on-content-click="false"
                max-width="250"
                eager
                transition="fade-transition"
                :content-class="'social-menu-content'"
                nudge-bottom="8"
              >
                <template v-slot:activator="{ on, attrs }">
                  <v-btn icon small v-bind="attrs" v-on="on" class="ml-1 staking2-social-btn">
                    <v-icon small color="white">mdi-share-variant</v-icon>
                  </v-btn>
                </template>

                <v-card class="social-dropdown-card">
                  <v-card-title class="py-2 px-3">
                    <span class="subtitle-2">{{ $t('staking.poolLinks') }}</span>
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
                        <v-list-item-title class="social-link-text">{{ $t('staking.website') }}</v-list-item-title>
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
                        <v-list-item-title class="social-link-text">{{ $t('staking.facebook') }}</v-list-item-title>
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
                        <v-list-item-title class="social-link-text">{{ $t('staking.youtube') }}</v-list-item-title>
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
                        <v-list-item-title class="social-link-text">{{ $t('staking.discord') }}</v-list-item-title>
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
                        <v-list-item-title class="social-link-text">{{ $t('staking.telegram') }}</v-list-item-title>
                      </v-list-item-content>
                    </v-list-item>
                  </v-list>
                </v-card>
              </v-menu>
            </div>
          </v-col>
          <v-col cols="3" class="px-2 text-center">
            <span>{{ $t('common.total') }}</span>
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
            <span>{{ $t('staking.rewards') }}</span>
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
                <h4>{{ $t('staking.ros') }}</h4>
                <span class="staking2-stat-value">{{
                  currentPool?.ros ? currentPool.ros.toFixed(2) + '%' : '0%'
                }}</span>
              </v-col>
              <v-col cols="4" class="staking2-stat-col" v-if="currentPool">
                <h4>{{ $t('staking.pledge') }}</h4>
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
                <h4>{{ $t('staking.fees') }}</h4>
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
                <h4 class="staking2-saturation-title">{{ $t('staking.saturation') }}</h4>
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
              <span v-else>{{ $t('staking.noRewardsYet') }}</span>
            </v-card-text>
            <div class="staking2-chart-container" v-else>
              <RewardsChart :chart-data="rewardsChartData" class="staking2-chart"></RewardsChart>
            </div>
          </v-col>
        </v-row>

        <!-- Action Buttons Row -->
        <v-row no-gutters class="px-4 pb-3 pt-2 staking-action-buttons">
          <v-col cols="6">
            <v-btn
              elevation="2"
              small
              color="error"
              @click="unstake"
              block
              outlined
            >
              <span class="staking2-unstake-text">{{ $t('staking.unstake') }}</span>
            </v-btn>
          </v-col>
          <v-col cols="6" class="pl-3">
            <v-tooltip top content-class="custom-tooltip" v-if="account && Number(account.withdrawable_amount) > 0 && !account?.drep_id && !isApex" max-width="250">
              <template v-slot:activator="{ on, attrs }">
                <v-btn
                  elevation="2"
                  small
                  color="warning"
                  @click="withdraw"
                  block
                  v-bind="attrs"
                  v-on="on"
                >
                  {{ $t('staking.withdraw') }}
                </v-btn>
              </template>
              <span>DRep delegation required to withdraw rewards. Visit the Governance tab to delegate.</span>
            </v-tooltip>
            <v-btn
              v-else-if="account && Number(account?.withdrawable_amount) > 0"
              elevation="2"
              small
              color="#1a1a1a"
              @click="withdraw"
              block
              :class="isApex ? 'apexButton' : 'geroButton'"
            >
              {{ $t('staking.withdraw') }}
            </v-btn>
            <v-btn
              v-else
              elevation="2"
              small
              color="#1a1a1a"
              disabled
              block
              class="staking2-no-rewards-btn">
              <span class="staking2-no-rewards-text">{{ $t('staking.noRewards') }}</span>
            </v-btn>
          </v-col>
        </v-row>
      </v-layout>
    </v-card-text>
    <UnstakeDialog :is-open="unstakeDialog" @close="closeUnstakeDialog" :tx="unstakeTxData"></UnstakeDialog>
    <WithdrawalDialog :is-open="withdrawalDialog" @close="closeWithdrawalDialog" :tx="withdrawalTxData"></WithdrawalDialog>
  </v-card>
</template>
<script setup lang="ts">
import { toRefs, computed, ref, watch, onMounted } from 'vue';
import RewardsChart from './RewardsChart.vue';
import filters from '@/shared/utils/filters';
import UnstakeDialog from '@/modules/staking/dialogs/UnstakeDialog.vue';
import WithdrawalDialog from '@/modules/staking/dialogs/WithdrawalDialog.vue';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { loadingState } from '@/stores/loading';
import stakingStoreActions from '@/stores/stakingStore';
import { Blockchain } from '@/models/types';
import { useUnstake } from '@/shared/composables/useUnstake';
import { useWithdrawal } from '@/shared/composables/useWithdrawal';

// Use the unstake and withdrawal composables
const { txData: unstakeTxData, unstakeDialog, unstake, closeUnstakeDialog } = useUnstake();
const { txData: withdrawalTxData, withdrawalDialog, withdraw, closeWithdrawalDialog } = useWithdrawal();

const { loggedWallet, rewards, account } = toRefs(walletStore);
const { loadingTxs } = toRefs(loadingState);
const { currentPool, poolLoading } = toRefs(stakingStoreActions.state);

const hideZero = ref<boolean>(false);
const socialMenuOpen = ref<boolean>(false);

const isApex = computed(() => {
  return loggedWallet.value?.chain === Blockchain.APEX_PRIME ||
    loggedWallet.value?.chain === Blockchain.APEX_VECTOR;
});

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
  background: linear-gradient(135deg, rgba(12, 14, 18, 0.98), rgba(22, 27, 38, 0.96)) !important;
  backdrop-filter: blur(12px) saturate(1.5) !important;
  -webkit-backdrop-filter: blur(12px) saturate(1.5) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6),
              0 2px 8px rgba(0, 0, 0, 0.4),
              inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  position: relative !important;
  z-index: 1 !important;
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
  font-size: 28px;
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
  width: 100%;
}

.staking2-no-rewards {
  font-size: 20px;
}

.staking2-chart-container {
  height: 150px;
}

.staking2-chart {
  height: 100%;
  width: 100%;
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
