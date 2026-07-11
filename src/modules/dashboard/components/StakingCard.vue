<template>
  <v-card flat outlined class="liquid-glass" :loading="loadingTxs || poolLoading">
    <v-card-title>{{ $t('staking.title') }}</v-card-title>
    <v-card-text class="pa-0">
      <v-layout column>
        <v-row no-gutters>
          <v-col cols="5">
            <v-card outlined flat tile class="fill-height staking-left-card transparent">
              <v-card-title class="staking-card-title pa-2">
                <v-row no-gutters class="staking-info-row py-4">
                  <v-col cols="6" class="px-1 text-center">
                    <span class="staking-label">{{ $t('staking.delegatingTo') }}</span>
                    <h4 class="staking-value" v-if="pool">{{ `[${pool.ticker}] ${pool.name}` }}</h4>
                    <v-btn x-small text color="error" @click="unstake">{{ $t('staking.unstake') }}</v-btn>
                  </v-col>
                  <v-col cols="3" class="px-1 text-center">
                    <span class="staking-label">{{ $t('common.total') }}</span>
                    <h4 class="staking-value" v-if="loggedWallet && account">
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
                  <v-col cols="3" class="px-1 text-center">
                    <span class="staking-label">{{ $t('staking.rewards') }}</span>
                    <h4 class="staking-value" v-if="account">
                      {{
                        filters.toCurrency(
                          account.withdrawable_amount,
                          false,
                          2,
                          networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                          '',
                          true
                        )
                      }}
                    </h4>
                    <v-tooltip top v-if="Number(account?.withdrawable_amount) > 0 && !account?.drep_id && !isApex" max-width="250" content-class="custom-tooltip">
                      <template v-slot:activator="{ on, attrs }">
                        <v-btn x-small text color="warning" v-bind="attrs" v-on="on" @click="withdraw">
                          {{ $t('staking.withdraw') }}
                        </v-btn>
                      </template>
                      <span>{{ $t('staking.drepDelegationRequired') }}</span>
                    </v-tooltip>
                    <v-btn v-else-if="Number(account?.withdrawable_amount) > 0" x-small text color="primary" @click="withdraw">
                      {{ $t('staking.withdraw') }}
                    </v-btn>
                  </v-col>
                </v-row>
              </v-card-title>
              <v-card-text>
                <div>
                  <v-btn icon small v-if="pool?.homepage" :href="pool?.homepage" target="_blank">
                    <v-icon small> mdi-web </v-icon>
                  </v-btn>
                  <v-btn
                    icon
                    small
                    v-if="poolExtendedInfo?.info?.social?.facebook_handle"
                    :href="'https://www.facebook.com/' + poolExtendedInfo?.info?.social?.facebook_handle"
                    target="_blank"
                  >
                    <v-icon small> mdi-facebook </v-icon>
                  </v-btn>
                  <v-btn
                    icon
                    small
                    v-if="poolExtendedInfo?.info?.social?.twitter_handle"
                    :href="'https://x.com/' + poolExtendedInfo?.info?.social?.twitter_handle"
                    target="_blank"
                  >
                    <v-avatar tile size="14">
                      <v-img :src="assets.xSvg" alt="x"></v-img>
                    </v-avatar>
                  </v-btn>
                  <v-btn
                    icon
                    small
                    v-if="poolExtendedInfo?.info?.social?.youtube_handle"
                    :href="'https://youtube.com/' + poolExtendedInfo?.info?.social?.youtube_handle"
                    target="_blank"
                  >
                    <v-icon small> mdi-youtube </v-icon>
                  </v-btn>
                  <v-btn
                    icon
                    small
                    v-if="poolExtendedInfo?.info?.social?.discord_handle"
                    :href="'https://discord.gg/' + poolExtendedInfo?.info?.social?.discord_handle"
                    target="_blank"
                  >
                    <v-avatar tile size="14">
                      <v-img :src="assets.discordSvg" width="14" height="14" alt="discord" contain></v-img>
                    </v-avatar>
                  </v-btn>
                  <v-btn
                    icon
                    small
                    v-if="poolExtendedInfo?.info?.social?.telegram_handle"
                    :href="'https://t.me/' + poolExtendedInfo?.info?.social?.telegram_handle"
                    target="_blank"
                  >
                    <v-avatar tile size="14">
                      <v-img :src="assets.telegramSvg" alt="telegram"></v-img>
                    </v-avatar>
                  </v-btn>
                </div>
                <v-row no-gutters class="pt-2 pb-1">
                  <v-col cols="6" class="staking-detail-col" v-if="account">
                    <h5>{{ $t('staking.poolId') }}</h5>
                    <span class="staking-detail-value">{{ filters.truncate(account?.pool_id) }}</span>
                    <CopyButton :value="account?.pool_id" x-small></CopyButton>
                  </v-col>
                  <v-col cols="6" class="staking-detail-col">
                    <h5>{{ $t('staking.ros') }}</h5>
                    <span class="staking-detail-value">{{ pool?.ros ? pool.ros.toFixed(2) + '%' : '0%' }}</span>
                  </v-col>
                </v-row>
                <v-row no-gutters>
                  <v-col cols="6" class="staking-detail-col" v-if="loggedWallet && pool">
                    <h5>{{ $t('staking.fees') }}</h5>
                    <span class="staking-fees-text"
                      >{{ pool.margin + '%' }} /
                      {{
                        filters.toCurrency(
                          pool.fixed_cost,
                          false,
                          0,
                          networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                        )
                      }}</span
                    >
                  </v-col>
                  <v-col cols="6" class="staking-detail-col" v-if="pool">
                    <h5>{{ $t('staking.saturation') }}</h5>
                    <v-progress-linear
                      rounded
                      :color="filters.getColor(pool.live_saturation)"
                      height="16"
                      :value="pool.live_saturation"
                      striped
                    >
                      <template v-slot:default="{ value }">
                        <strong>{{ Math.ceil(value) }}%</strong>
                      </template>
                    </v-progress-linear>
                    <div class="staking-saturation-details">
                      <strong>{{
                        filters.toCurrency(
                          pool.active_stake,
                          false,
                          0,
                          networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                          '',
                          true
                        )
                      }}</strong>
                      <strong
                        v-if="Number(pool.active_stake) - Number(pool.live_stake) > 100000000"
                        class="staking-stake-change-up"
                      >
                        <v-icon x-small color="success" class="staking-stake-arrow">mdi-arrow-up-bold</v-icon>
                        {{
                          filters.toCurrency(
                            Number(pool.active_stake) - Number(pool.live_stake),
                            false,
                            1,
                            networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                            '',
                            true
                          )
                        }}
                      </strong>
                      <strong
                        v-else-if="Number(pool.live_stake) - Number(pool.active_stake) > 100000000"
                        class="staking-stake-change-down"
                      >
                        <v-icon x-small color="error" class="staking-stake-arrow-down">mdi-arrow-down-bold</v-icon>
                        {{
                          filters.toCurrency(
                            Number(pool.live_stake) - Number(pool.active_stake),
                            false,
                            1,
                            networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                            '',
                            true
                          )
                        }}
                      </strong>
                    </div>
                  </v-col>
                </v-row>
                <v-row no-gutters class="pt-2">
                  <v-col cols="12" class="staking-chart-col">
                    <div
                      class="staking-chart-container"
                      v-if="rewardsChartData && Object.values(rewardsChartData).length > 0"
                    >
                      <RewardsChart :chart-data="rewardsChartData"></RewardsChart>
                    </div>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="7">
            <v-card outlined flat tile class="fill-height staking-right-card transparent">
              <v-card-text class="pa-2">
                <v-card outlined flat style="background-color: transparent!important;">
                  <v-data-table
                    :items="rewardsData"
                    :headers="stakingHeaders"
                    class="transparent"
                    :hide-default-footer="!(rewardsData?.length > 0)"
                    :sort-by.sync="sortBy"
                    :sort-desc.sync="sortDesc"
                    dense
                    :items-per-page="5"
                    :header-props="{ 'sort-icon': 'mdi-menu-up' }"
                  >
                    <template v-slot:[`item.pool_id`]="{ item }">
                      <v-list-item two-line class="px-0">
                        <v-list-item-avatar size="32" v-if="resolvePoolIcon()">
                          <v-img :src="resolvePoolIcon()" :alt="item.pool_id + ' Icon'"></v-img>
                        </v-list-item-avatar>
                        <v-list-item-content>
                          <v-list-item-title class="rewards-pool-name">{{ resolvePoolName() }}</v-list-item-title>
                          <v-list-item-subtitle class="rewards-pool-description">
                            {{ resolvePoolDescription() }}
                          </v-list-item-subtitle>
                        </v-list-item-content>
                      </v-list-item>
                    </template>
                    <template v-slot:[`item.amount`]="{ item }">
                      <span
                        v-if="isNumeric(item.amount)"
                        :style="
                          isNaN(change(item)) || change(item) === Infinity || change(item) === 0
                            ? { color: 'var(--g-text-3)' }
                            : change(item) >= 0
                            ? { color: 'var(--g-success)' }
                            : { color: 'var(--g-error)' }
                        "
                      >
                        {{
                          filters.toCurrency(
                            item.amount,
                            false,
                            6,
                            networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                            '',
                            true
                          )
                        }}</span
                      >
                      <span v-else>{{ item.amount }}</span>
                    </template>
                    <template v-slot:[`item.change`]="{ item }">
                      <v-avatar tile size="20" class="mr-1">
                        <v-img
                          :src="
                            isNaN(change(item)) || change(item) === Infinity || change(item) === 0
                              ? assets.arrowRightSvg
                              : change(item) >= 0
                              ? assets.trendUpSvg
                              : assets.trendDownSvg
                          "
                          alt="trend"
                        ></v-img>
                      </v-avatar>
                      <span
                        :style="
                          isNaN(change(item)) || change(item) === Infinity || change(item) === 0
                            ? { color: 'var(--g-text-3)' }
                            : change(item) >= 0
                            ? { color: 'var(--g-success)' }
                            : { color: 'var(--g-error)' }
                        "
                      >
                        {{
                          isNaN(change(item)) || change(item) === Infinity
                            ? '0%'
                            : filters.toCurrency(
                                change(item),
                                false,
                                0,
                                networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                              )
                        }}
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
    <UnstakeDialog :is-open="unstakeDialog" @close="closeUnstakeDialog" :tx="unstakeTxData"></UnstakeDialog>
     <WithdrawalDialog :is-open="withdrawalDialog" @close="closeWithdrawalDialog" :tx="withdrawalTxData"
      :compensation-info="compensationInfo" :skip-compensation="skipCompensation"
      @update:skipCompensation="skipCompensation = $event"
    ></WithdrawalDialog>
  </v-card>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { useUnstake } from '@/shared/composables/useUnstake';
import { useWithdrawal } from '@/shared/composables/useWithdrawal';
import { toRefs, computed, ref, watch, onMounted } from 'vue';
import RewardsChart from './RewardsChart.vue';
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';
import UnstakeDialog from '@/modules/staking/dialogs/UnstakeDialog.vue';
import WithdrawalDialog from '@/modules/staking/dialogs/WithdrawalDialog.vue';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { loadingState } from '@/stores/loading';
import stakingStoreActions from '@/stores/stakingStore';
import { Blockchain } from '@/models/types';


const { t } = useTranslation();

// Use the unstake and withdrawal composables
const { txData: unstakeTxData, unstakeDialog, unstake, closeUnstakeDialog } = useUnstake();
const { txData: withdrawalTxData, withdrawalDialog, withdraw, closeWithdrawalDialog, skipCompensation, compensationInfo } = useWithdrawal();

const { loggedWallet, rewards, account } = toRefs(walletStore);
const { loadingTxs } = toRefs(loadingState);
const { currentPool, poolLoading } = toRefs(stakingStoreActions.state);

const hideZero = ref<boolean>(false);
const sortBy = ref<string>('epoch');
const sortDesc = ref<boolean>(true);
const stakingHeaders = ref([
  { text: String(t('staking.poolName')), align: 'start', sortable: true, value: 'pool_id' },
  { text: String(t('staking.epoch')), align: 'start', sortable: true, value: 'epoch', width: 88 },
  { text: String(t('staking.reward')), align: 'start', sortable: true, value: 'amount', width: 100 },
  { text: String(t('staking.change')), align: 'start', sortable: true, value: 'change', width: 120 },
]);

const isApex = computed(() => {
  return loggedWallet.value?.chain === Blockchain.APEX_PRIME ||
    loggedWallet.value?.chain === Blockchain.APEX_VECTOR;
});

const pool = computed(() => {
  if (currentPool.value) {
    return currentPool.value;
  }
  return null;
});

const poolExtendedInfo = computed(() => {
  if (pool.value) {
    return JSON.parse(pool.value.pool_extended_info);
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

const change = item => {
  const index = rewardsData.value.indexOf(item);
  if (rewardsData.value[index - 1]) {
    let previous = rewardsData.value[index - 1];
    if (previous) {
      if (previous.amount === 0) {
        return 0;
      }
      return Number(item.amount) - Number(previous.amount);
    }
  }
  return 0;
};

const resolvePoolIcon = () => {
  const pool = currentPool.value;
  if (pool) {
    return JSON.parse(pool.pool_extended_info)?.info?.url_png_icon_64x64;
  }
  return '';
};

const resolvePoolName = () => {
  const pool = currentPool.value;
  if (pool) {
    return `[${pool.ticker}] ${pool.name}`;
  }
  return 'N/A';
};

const resolvePoolDescription = () => {
  const pool = currentPool.value;
  if (pool) {
    return pool.description;
  }
  return '';
};

const isNumeric = n => {
  return !isNaN(parseFloat(n)) && isFinite(n);
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
  background: var(--g-accent);
}

/* StakingCard specific styles */
.staking-left-card {
  border-left-width: 0;
  border-bottom-width: 0;
}

.staking-right-card {
  border-left-width: 0;
  border-right-width: 0;
  border-bottom-width: 0;
}

.staking-card-title {
  font-size: 14px;
  line-height: 1.5;
}

.staking-info-row {
  background-color: var(--g-raised);
  border-radius: var(--g-r-control);
}

/* Field labels are the quiet tier; values are the bright answer. Everything
   was --g-text-1 before, which is why the card read as flat. */
.staking-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--g-text-3);
}

.staking-value {
  color: var(--g-text-1);
  font-weight: 620;
  font-variant-numeric: tabular-nums;
}

.staking-detail-col {
  display: block;
  text-align: center;
}

.staking-detail-value {
  color: var(--g-text-1);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.staking-fees-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-1);
  font-variant-numeric: tabular-nums;
}

.staking-saturation-details {
  font-size: 11px;
  text-align-last: justify;
  color: var(--g-text-2);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.staking-stake-change-up {
  display: inline-flex;
  font-size: 11px;
  font-weight: 600;
  color: var(--g-success);
}

.staking-stake-change-down {
  display: inline-flex;
  font-size: 11px;
  font-weight: 600;
  color: var(--g-error);
}

.staking-stake-arrow {
  font-size: 11px;
}

.staking-stake-arrow-down {
  font-size: 11px;
  line-height: 1.7;
}

.staking-chart-col {
  display: block;
  text-align: center;
}

.staking-chart-container {
  min-height: 155px;
}

/* Rewards table styles */
.rewards-pool-name {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
}

.rewards-pool-description {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
}
</style>
