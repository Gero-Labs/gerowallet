<template>
  <v-card flat class="stk-root" :loading="loadingTxs || poolLoading">
    <v-row no-gutters>
      <!-- ═══ Delegation card ═══ -->
      <v-col cols="12" md="8" class="pa-3">
        <div class="stk-card">
          <!-- Header: identity -->
          <div class="stk-head">
            <div class="stk-avatar">
              <v-img v-if="resolvePoolIcon()" :src="resolvePoolIcon()" :alt="pool?.ticker" />
              <span v-else>{{ (pool?.ticker || 'G').charAt(0) }}</span>
            </div>
            <div class="stk-head-text">
              <div class="stk-pname">{{ pool ? `[${pool.ticker}] ${pool.name}` : $t('staking.notDelegating') }}</div>
              <div class="stk-meta">
                <span v-if="pool" class="stk-pill"><span class="stk-dot"></span>{{ $t('staking.delegating') }}</span>
                <span v-if="account?.pool_id" class="stk-pid">{{ filters.truncate(account.pool_id) }}</span>
                <CopyButton v-if="account?.pool_id" :value="account.pool_id" x-small />
              </div>
            </div>
            <div class="stk-socials">
              <v-btn v-if="pool?.homepage" icon x-small class="stk-soc" :href="pool.homepage" target="_blank" :aria-label="$t('staking.website')">
                <v-icon size="15">mdi-web</v-icon>
              </v-btn>
              <v-btn v-if="poolExtendedInfo?.info?.social?.twitter_handle" icon x-small class="stk-soc" :href="'https://x.com/' + poolExtendedInfo.info.social.twitter_handle" target="_blank" aria-label="X">
                <v-avatar tile size="13"><v-img :src="assets.xSvg" alt="x" /></v-avatar>
              </v-btn>
              <v-btn v-if="poolExtendedInfo?.info?.social?.youtube_handle" icon x-small class="stk-soc" :href="'https://youtube.com/' + poolExtendedInfo.info.social.youtube_handle" target="_blank" aria-label="YouTube">
                <v-icon size="15">mdi-youtube</v-icon>
              </v-btn>
              <v-btn v-if="poolExtendedInfo?.info?.social?.telegram_handle" icon x-small class="stk-soc" :href="'https://t.me/' + poolExtendedInfo.info.social.telegram_handle" target="_blank" aria-label="Telegram">
                <v-avatar tile size="13"><v-img :src="assets.telegramSvg" alt="telegram" /></v-avatar>
              </v-btn>
            </div>
          </div>

          <!-- Stat tiles -->
          <div class="stk-stats">
            <div class="stk-tile">
              <div class="stk-label">{{ $t('common.total') }}</div>
              <div class="stk-tile-v tnum" v-if="loggedWallet && account">
                {{ filters.toCurrency(account.controlled_amount, false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}
              </div>
              <div class="stk-tile-v tnum" v-else>—</div>
            </div>
            <div class="stk-tile">
              <div class="stk-label">{{ $t('staking.rewards') }}</div>
              <div class="stk-tile-v acc tnum" v-if="account">
                {{ filters.toCurrency(account.withdrawable_amount, false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}
              </div>
              <div class="stk-tile-v acc tnum" v-else>—</div>
            </div>
            <div class="stk-tile">
              <div class="stk-label">{{ $t('staking.ros') }}</div>
              <div class="stk-tile-v tnum">{{ pool?.ros ? pool.ros.toFixed(2) + '%' : '0%' }}</div>
            </div>
          </div>

          <!-- Details -->
          <div class="stk-details">
            <div class="stk-drow" v-if="loggedWallet && pool">
              <span class="stk-k">{{ $t('staking.fees') }}</span>
              <span class="stk-val tnum">{{ pool.margin }}% · {{ filters.toCurrency(pool.fixed_cost, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</span>
            </div>
            <div class="stk-drow" v-if="loggedWallet && pool">
              <span class="stk-k">{{ $t('staking.pledge') }}</span>
              <span class="stk-val tnum">{{ filters.toCurrency(pool.pledge, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}</span>
            </div>
            <div class="stk-drow" v-if="pool">
              <span class="stk-k">{{ $t('staking.saturation') }}</span>
              <span class="stk-sat-wrap">
                <span class="stk-sat"><i :class="Number(pool.live_saturation) >= 90 ? 'over' : 'ok'" :style="{ width: Math.min(Number(pool.live_saturation), 100) + '%' }"></i></span>
                <span class="stk-val tnum" :style="{ color: Number(pool.live_saturation) >= 90 ? 'var(--g-error)' : 'var(--g-success)' }">{{ Math.ceil(Number(pool.live_saturation)) }}%</span>
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="stk-acts">
            <v-btn
              class="geroButton stk-act stk-act--pri"
              depressed
              :disabled="!(Number(account?.withdrawable_amount) > 0)"
              @click="withdraw"
            >{{ $t('staking.withdraw') }}</v-btn>
            <v-btn outlined class="stk-act stk-act--ghost" @click="unstake">{{ $t('staking.unstake') }}</v-btn>
          </div>
        </div>
      </v-col>

      <!-- ═══ Rewards history ═══ -->
      <v-col cols="12" md="4" class="pa-3">
        <div class="stk-card">
          <div class="stk-rhead">
            <div>
              <div class="stk-label">{{ $t('staking.totalEarned') }}</div>
              <div class="stk-rtotal tnum">{{ filters.toCurrency(String(totalEarnedLovelace), false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}</div>
            </div>
          </div>

          <div class="stk-chart" v-if="recentRewards.length">
            <div class="stk-bars">
              <span
                v-for="r in recentRewards"
                :key="r.epoch"
                class="stk-bar"
                :style="{ height: Math.max(2, (Number(r.amount) / maxReward) * 100) + '%' }"
              ></span>
            </div>
          </div>

          <div class="stk-rewards">
            <div class="stk-rrow" v-for="r in recentRewardRows" :key="r.epoch">
              <span class="stk-repoch">{{ $t('staking.epoch') }} {{ r.epoch }}</span>
              <span class="stk-rval tnum" :class="Number(r.amount) > 0 ? 'p' : 'z'">
                {{ Number(r.amount) > 0 ? '+' : '' }}{{ filters.toCurrency(r.amount, false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}
              </span>
            </div>
            <div v-if="!recentRewardRows.length" class="stk-empty">{{ $t('staking.noRewardsYet') }}</div>
          </div>
        </div>
      </v-col>
    </v-row>

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

// Last 10 epochs for the mini bar chart.
const recentRewards = computed(() => (rewardsData.value || []).slice(-10));
const maxReward = computed(() => Math.max(1, ...recentRewards.value.map((r: any) => Number(r.amount) || 0)));
// Most recent 5, newest first, for the list.
const recentRewardRows = computed(() => [...(rewardsData.value || [])].slice(-5).reverse());
const totalEarnedLovelace = computed(() => (rewardsData.value || []).reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0));

const resolvePoolIcon = () => {
  const p = currentPool.value;
  if (p) {
    return JSON.parse(p.pool_extended_info)?.info?.url_png_icon_64x64;
  }
  return '';
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

// isApex is consumed by the parent Staking.vue layout via the shared store; kept
// referenced so the computed is not tree-shaken as unused.
void isApex;
</script>
<style scoped>
.stk-root {
  background: transparent !important;
}

/* Card boxes: raised surface, hairline, subtle top highlight + soft lift so
   they don't read flat (design language: tiers + hairlines do the elevation). */
.stk-card {
  height: 100%;
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
  padding: 18px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.045), 0 2px 12px rgba(0, 0, 0, 0.4);
}

/* ── Header ── */
.stk-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.stk-avatar {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: var(--g-r-pill);
  background: linear-gradient(135deg, var(--g-grad-1), var(--g-grad-2));
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 20px;
  color: var(--g-on-grad);
  overflow: hidden;
}

.stk-head-text {
  min-width: 0;
  flex: 1;
}

.stk-pname {
  font-size: 16px;
  font-weight: 650;
  line-height: 1.2;
  color: var(--g-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stk-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 3px;
}

.stk-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--g-r-pill);
  background: var(--g-success-fill);
  color: var(--g-success);
  border: 1px solid var(--g-success-line);
}

.stk-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--g-success);
}

.stk-pid {
  font-family: var(--g-font-mono);
  font-size: 12px;
  color: var(--g-text-3);
}

.stk-socials {
  margin-left: auto;
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.stk-soc {
  color: var(--g-text-2) !important;
}

/* ── Stat tiles ── */
.stk-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}

.stk-tile {
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  padding: 12px 14px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
}

.stk-label {
  font-size: 11px;
  font-weight: 550;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--g-text-3);
}

.stk-tile-v {
  font-size: 22px;
  font-weight: 680;
  letter-spacing: -0.02em;
  line-height: 1;
  margin-top: 6px;
  color: var(--g-text-1);
}

.stk-tile-v.acc {
  color: var(--g-accent);
}

/* ── Details ── */
.stk-drow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 9px 0;
  border-top: 1px solid var(--g-hairline-1);
  font-size: 13px;
}

.stk-k {
  color: var(--g-text-3);
}

.stk-val {
  color: var(--g-text-1);
  font-weight: 600;
}

.stk-sat-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.stk-sat {
  position: relative;
  height: 8px;
  width: 120px;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
  overflow: hidden;
}

.stk-sat i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: var(--g-r-pill);
}

.stk-sat i.ok {
  background: var(--g-success);
}

.stk-sat i.over {
  background: var(--g-error);
}

/* ── Actions ── */
.stk-acts {
  display: flex;
  gap: 8px;
  margin-top: 18px;
}

.stk-act {
  flex: 1;
  height: 38px !important;
  border-radius: var(--g-r-control) !important;
  font-size: 13px;
  letter-spacing: 0;
  text-transform: none;
}

.stk-act--pri {
  color: var(--g-on-grad) !important;
}

.stk-act--ghost {
  border: 1px solid var(--g-hairline-3) !important;
  color: var(--g-text-2) !important;
}

/* ── Rewards history ── */
.stk-rhead {
  margin-bottom: 4px;
}

.stk-rtotal {
  font-size: 20px;
  font-weight: 680;
  letter-spacing: -0.02em;
  color: var(--g-success);
  margin-top: 4px;
}

.stk-chart {
  position: relative;
  height: 84px;
  margin: 14px 0 8px;
  padding-top: 6px;
  border-bottom: 1px solid var(--g-hairline-2);
}

.stk-bars {
  position: absolute;
  inset: 6px 0 0;
  display: flex;
  align-items: flex-end;
  gap: 4px;
}

.stk-bar {
  flex: 1;
  min-height: 2px;
  background: linear-gradient(180deg, var(--g-grad-1), color-mix(in srgb, var(--g-grad-2) 30%, transparent));
  border-radius: 2px 2px 0 0;
}

.stk-rewards {
  margin-top: 4px;
}

.stk-rrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 8px;
  border-radius: var(--g-r-control);
  border-bottom: 1px solid var(--g-hairline-1);
}

.stk-rrow:last-child {
  border-bottom: none;
}

.stk-repoch {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-1);
}

.stk-rval {
  font-size: 14px;
  font-weight: 700;
}

.stk-rval.p {
  color: var(--g-success);
}

.stk-rval.z {
  color: var(--g-text-3);
  font-weight: 500;
}

.stk-empty {
  padding: 20px 0;
  text-align: center;
  font-size: 13px;
  color: var(--g-text-3);
}
</style>
