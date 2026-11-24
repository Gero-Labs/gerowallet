<template>
  <v-card flat class="stk-root" :loading="loadingTxs || poolLoading">
    <v-row class="align-stretch" no-gutters >
      <!-- ═══ Delegation card ═══ -->
      <v-col cols="12" md="5" class="pa-3 d-flex">
        <div class="stk-card glass-panel">
          <!-- Header: identity -->
          <div class="stk-head">
            <div class="stk-avatar">
              <v-img v-if="resolvePoolIcon()" :src="resolvePoolIcon()" :alt="pool?.ticker" />
              <span v-else>{{ (pool?.ticker || 'G').charAt(0) }}</span>
            </div>
            <div class="stk-head-text">
              <!-- The card only mounts for delegating wallets (Staking.vue gates on
                   account.pool_id), so a null pool means the lookup is in flight
                   (or failed) — show a loading label, not "not delegating". -->
              <!-- The socials share the name's line, so the line below (status, pool ID,
                   copy, explorer) has the column's full width and nothing overlaps. -->
              <div class="stk-name-row">
                <div class="stk-pname">{{ pool ? `[${pool.ticker}] ${pool.name}` : $t('staking.loadingPool') }}</div>
                <div class="stk-socials">
                  <v-btn v-if="pool?.homepage" icon variant="text" size="x-small" class="stk-soc" :href="pool.homepage" target="_blank" :aria-label="$t('staking.website')">
                    <v-icon size="15">mdi-web</v-icon>
                  </v-btn>
                  <v-btn v-if="poolExtendedInfo?.info?.social?.twitter_handle" icon variant="text" size="x-small" class="stk-soc" :href="'https://x.com/' + poolExtendedInfo.info.social.twitter_handle" target="_blank" aria-label="X">
                    <v-avatar rounded="0" size="13"><v-img :src="assets.xSvg" alt="x" /></v-avatar>
                  </v-btn>
                  <v-btn v-if="poolExtendedInfo?.info?.social?.youtube_handle" icon variant="text" size="x-small" class="stk-soc" :href="'https://youtube.com/' + poolExtendedInfo.info.social.youtube_handle" target="_blank" aria-label="YouTube">
                    <v-icon size="15">mdi-youtube</v-icon>
                  </v-btn>
                  <v-btn v-if="poolExtendedInfo?.info?.social?.telegram_handle" icon variant="text" size="x-small" class="stk-soc" :href="'https://t.me/' + poolExtendedInfo.info.social.telegram_handle" target="_blank" aria-label="Telegram">
                    <v-avatar rounded="0" size="13"><v-img :src="assets.telegramSvg" alt="telegram" /></v-avatar>
                  </v-btn>
                </div>
              </div>
              <div class="stk-meta">
                <span v-if="pool" class="stk-pill"><span class="stk-dot"></span>{{ $t('staking.delegating') }}</span>
                <span v-if="account?.pool_id" class="stk-pid">{{ filters.truncate(account.pool_id) }}</span>
                <CopyButton v-if="account?.pool_id" :value="account.pool_id" x-small />
                <ExplorerLink type="pool" :id="account?.pool_id" x-small />
              </div>
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

          <!-- Compact inline details -->
          <div class="stk-strip" v-if="pool">
            <div class="stk-ditem" v-if="loggedWallet">
              <span class="stk-dk">{{ $t('staking.fees') }}</span>
              <span class="stk-dv tnum">{{ pool.margin }}% · {{ filters.toCurrency(pool.fixed_cost, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</span>
            </div>
            <div class="stk-ditem" v-if="loggedWallet">
              <span class="stk-dk">{{ $t('staking.pledge') }}</span>
              <span class="stk-dv tnum">{{ filters.toCurrency(pool.pledge, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}</span>
            </div>
            <div class="stk-ditem">
              <span class="stk-dk">{{ $t('staking.saturation') }}</span>
              <span class="stk-dv stk-sat-wrap">
                <span class="stk-sat"><i :class="Number(pool.live_saturation) >= 90 ? 'over' : 'ok'" :style="{ width: Math.min(Number(pool.live_saturation), 100) + '%' }"></i></span>
                <span class="tnum" :style="{ color: Number(pool.live_saturation) >= 90 ? 'var(--g-error)' : 'var(--g-success)' }">{{ Math.ceil(Number(pool.live_saturation)) }}%</span>
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="stk-acts">
            <v-btn
              class="geroButton stk-act stk-act--pri"
              variant="flat"
              :disabled="!(Number(account?.withdrawable_amount) > 0)"
              @click="withdraw"
            >{{ $t('staking.withdraw') }}</v-btn>
            <v-btn variant="outlined" class="stk-act stk-act--ghost" @click="unstake">{{ $t('staking.unstake') }}</v-btn>
          </div>
        </div>
      </v-col>

      <!-- ═══ Rewards history ═══ -->
      <v-col cols="12" md="7" class="pa-3 d-flex">
        <div class="stk-card glass-panel">
          <div class="stk-rhead">
            <div class="stk-label">{{ $t('staking.totalEarned') }}</div>
            <div class="stk-rtotal tnum">{{ filters.toCurrency(String(totalEarnedLovelace), false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}</div>
            <div class="stk-rsub" v-if="rewardsData && rewardsData.length">{{ $t('staking.acrossEpochs', { count: rewardsData.length }) }}</div>
          </div>

          <!-- When the next reward lands: the next epoch boundary, from the synced tip. -->
          <div v-if="nextRewards" class="stk-next" :title="$t('staking.nextRewardsEpoch', { next: nextRewards.payEpoch, earned: nextRewards.earnedEpoch })">
            <div class="stk-next-row">
              <v-icon size="14" class="stk-next-icon">mdi-timer-sand</v-icon>
              <span class="stk-next-text">{{ $t('staking.nextRewardsIn', { time: nextRewards.timeLeft }) }}</span>
              <span class="stk-next-epoch">{{ $t('staking.nextRewardsEpoch', { next: nextRewards.payEpoch, earned: nextRewards.earnedEpoch }) }}</span>
            </div>
            <div class="stk-next-track" role="progressbar" :aria-valuenow="Math.round(nextRewards.progress)" aria-valuemin="0" aria-valuemax="100">
              <i :style="{ width: nextRewards.progress + '%' }"></i>
            </div>
          </div>

          <div class="stk-chartwrap" v-if="Object.keys(rewardsChartData).length">
            <RewardsChart :chart-data="rewardsChartData" />
          </div>
          <div v-else class="stk-empty">{{ $t('staking.noRewardsYet') }}</div>
        </div>
      </v-col>
    </v-row>

    <UnstakeDialog :is-open="unstakeDialog" @close="closeUnstakeDialog" :tx="unstakeTxData"></UnstakeDialog>
    <!-- Two withdrawal surfaces, one open at a time.
         CIP-1694 blocks a bare withdrawal until the stake key has delegated its
         vote, and `useWithdrawal` raises `withdrawalBlocked` on that branch with
         NO transaction built. The old dialog has nothing to show in that state,
         so the gate takes over: it explains the rule and offers both ways out.
         The unblocked path is untouched. -->
    <WithdrawGateDialog :is-open="withdrawalBlocked" @close="closeWithdrawalDialog" />
    <WithdrawalDialog :is-open="withdrawalDialog && !withdrawalBlocked" @close="closeWithdrawalDialog" :tx="withdrawalTxData"
      :compensation-info="compensationInfo" :skip-compensation="skipCompensation"
      @update:skipCompensation="skipCompensation = $event"
    ></WithdrawalDialog>
  </v-card>
</template>
<script setup lang="ts">
import { useUnstake } from '@/shared/composables/useUnstake';
import { useWithdrawal } from '@/shared/composables/useWithdrawal';
import { toRefs, computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { networkStore, isBitcoinTip } from '@/stores/networkStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import { thirdPartyImageUrl } from '@/shared/utils/iconResolver';
import RewardsChart from './RewardsChart.vue';
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';
import ExplorerLink from '@/shared/components/ExplorerLink.vue';
import UnstakeDialog from '@/modules/staking/dialogs/UnstakeDialog.vue';
import WithdrawalDialog from '@/modules/staking/dialogs/WithdrawalDialog.vue';
import WithdrawGateDialog from '@/modules/governance/dialogs/WithdrawGateDialog.vue';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { loadingState } from '@/stores/loading';
import stakingStoreActions from '@/stores/stakingStore';

// Use the unstake and withdrawal composables
const { txData: unstakeTxData, unstakeDialog, unstake, closeUnstakeDialog } = useUnstake();
const { txData: withdrawalTxData, withdrawalDialog, withdrawalBlocked, withdraw, closeWithdrawalDialog, skipCompensation, compensationInfo } = useWithdrawal();

const { loggedWallet, rewards, account } = toRefs(walletStore);
const { loadingTxs } = toRefs(loadingState);
const { currentPool, poolLoading } = toRefs(stakingStoreActions.state);
const { t } = useTranslation();

// ── Next rewards: Cardano pays at each epoch boundary. An epoch's rewards land at the
// start of the epoch two later, so the next boundary (current + 1) pays for current − 1.
// Worked out from the synced tip, ticking each minute: no extra request.
const MAINNET_EPOCH_SLOTS = 432000;
const now = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { nowTimer = setInterval(() => { now.value = Date.now(); }, 60_000); });
onUnmounted(() => { if (nowTimer) clearInterval(nowTimer); });

const nextRewards = computed(() => {
  const tip = networkStore.tip;
  if (!tip || isBitcoinTip(tip) || !Number.isFinite(tip.epoch) || !Number.isFinite(tip.epoch_slot)) return null;
  const genesis = networkStore.genesis ?? {};
  const epochSlots = Number(genesis['epochlength']) || MAINNET_EPOCH_SLOTS;
  const slotSeconds = Number(genesis['slotlength']) || 1;
  const epochSeconds = epochSlots * slotSeconds;
  // The tip is a block's position; time has moved on since it was made.
  const sinceTip = tip.time ? Math.max(0, (now.value - tip.time) / 1000) : 0;
  const left = Math.max(0, (epochSlots - tip.epoch_slot) * slotSeconds - sinceTip);
  const days = Math.floor(left / 86400);
  const hours = Math.floor((left % 86400) / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  return {
    timeLeft: days > 0
      ? t('staking.durationDaysHours', { days, hours })
      : t('staking.durationHoursMinutes', { hours, minutes }),
    progress: Math.min(100, Math.max(0, (1 - left / epochSeconds) * 100)),
    payEpoch: tip.epoch + 1,
    earnedEpoch: tip.epoch - 1,
  };
});

const hideZero = ref<boolean>(false);

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

type RewardRow = { epoch: string | number; amount: string | number };

// { epoch: adaAmount } for the RewardsChart column chart (native hover tooltip).
const rewardsChartData = computed(() => {
  const obj: Record<string, number> = {};
  (rewardsData.value || []).slice(-24).forEach((v: RewardRow) => {
    obj[v.epoch] = Number(v.amount) / 1000000;
  });
  return obj;
});
const totalEarnedLovelace = computed(() => (rewardsData.value || []).reduce((s: number, r: RewardRow) => s + (Number(r.amount) || 0), 0));

const resolvePoolIcon = () => {
  const p = currentPool.value;
  const url = p ? JSON.parse(p.pool_extended_info)?.info?.url_png_icon_64x64 : '';
  // Through Gero's proxies, so the operator's host never sees who looks. This also
  // drops the placeholder text many pools leave ("http(s) url to pool icon; ...").
  return thirdPartyImageUrl(url) ?? '';
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
.stk-root {
  background: transparent !important;
}

/* Card boxes: surface comes from the shared .glass-panel material (same panel
   the portfolio hero cards carry); only layout here. */
/* Both cards fill their column, so the delegation and rewards cards share one height. */
.stk-card {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 16px;
}

/* ── Header ── */
.stk-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
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

/* Name and socials on one line: the name truncates, the socials keep their size. */
.stk-name-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  min-width: 0;
}

.stk-pname {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 650;
  line-height: 1.2;
  color: var(--g-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Wraps on a narrow card instead of running under its neighbours. */
.stk-meta {
  display: flex;
  flex-wrap: wrap;
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
  margin-bottom: 12px;
}

.stk-tile {
  /* Translucent raised tier over the glass card (nested tiers are tints,
     not opaque fills — matches the portfolio chart's control tracks). */
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  padding: 10px 12px;
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
  font-size: 19px;
  font-weight: 680;
  letter-spacing: -0.02em;
  line-height: 1;
  margin-top: 5px;
  color: var(--g-text-1);
}

.stk-tile-v.acc {
  color: var(--g-accent);
}

/* ── Compact inline details strip (no more spread key->value rows) ── */
.stk-strip {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  padding: 10px 2px 0;
  border-top: 1px solid var(--g-hairline-1);
}

.stk-ditem {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stk-dk {
  font-size: 10px;
  font-weight: 550;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--g-text-3);
}

.stk-dv {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-1);
}

.stk-sat-wrap {
  display: flex;
  align-items: center;
  gap: 7px;
}

.stk-sat {
  position: relative;
  height: 6px;
  width: 70px;
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
/* Pinned to the card's bottom edge, level with the rewards card beside it. */
.stk-acts {
  display: flex;
  gap: 8px;
  margin-top: auto;
  padding-top: 14px;
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

/* ── Rewards history: total + column chart (RewardsChart) ── */
.stk-rhead {
  margin-bottom: 4px;
}

.stk-rtotal {
  font-size: 22px;
  font-weight: 680;
  letter-spacing: -0.02em;
  color: var(--g-success);
  margin-top: 4px;
}

.stk-rsub {
  font-size: 12px;
  color: var(--g-text-3);
  margin-top: 2px;
}

/* Next rewards: countdown, the epoch it pays, and the current epoch's progress. */
.stk-next {
  margin: var(--g-s-2) 0 var(--g-s-1);
}

.stk-next-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--g-s-2);
  row-gap: 2px;
  font-size: 12px;
}

.stk-next-icon {
  color: var(--g-accent);
  align-self: center;
}

.stk-next-text {
  color: var(--g-text-1);
  font-weight: 550;
}

.stk-next-epoch {
  color: var(--g-text-3);
}

.stk-next-track {
  position: relative;
  height: 4px;
  margin-top: var(--g-s-1);
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
  overflow: hidden;
}

.stk-next-track i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: var(--g-r-pill);
  background: var(--g-accent);
}

.stk-chartwrap {
  margin-top: 10px;
}

.stk-empty {
  padding: 28px 0;
  text-align: center;
  font-size: 13px;
  color: var(--g-text-3);
}
</style>
