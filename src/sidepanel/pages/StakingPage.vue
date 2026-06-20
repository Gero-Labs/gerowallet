<template>
  <div class="mini-page staking-page">
    <!-- Segment Toggle -->
    <div class="segment-toggle-wrapper">
      <v-btn-toggle
        v-model="activeTab"
        mandatory
        class="segment-toggle"
        dense
        rounded
      >
        <v-btn
          small
          :class="{ 'segment-active': activeTab === 0 }"
          class="segment-btn text-none"
        >
          <v-icon small class="mr-1">mdi-server-network</v-icon>
          {{ isApex ? $t('miniGero.delegation') : $t('miniGero.stakepool') }}
        </v-btn>
        <v-btn
          small
          :class="{ 'segment-active': activeTab === 1 }"
          class="segment-btn text-none"
        >
          <v-icon small class="mr-1">{{ isApex ? 'mdi-trophy-outline' : 'mdi-vote' }}</v-icon>
          {{ isApex ? $t('miniGero.rewards') : $t('miniGero.governance') }}
        </v-btn>
      </v-btn-toggle>
    </div>

    <!-- Status Card (always visible) -->
    <StakingStatusCard
      :claim-loading="claimLoading"
      class="mb-3"
      @claim="handleClaim"
    />

    <!-- Active View -->
    <PoolListView v-if="activeTab === 0" />
    <RewardsView v-else-if="isApex" />
    <GovernanceView v-else />

    <!-- Claim Rewards Bottom Sheet -->
    <BottomSheet
      v-model="showClaimSheet"
      :title="$t('miniGero.claimRewards')"
      height="35%"
    >
      <div class="claim-confirm">
        <div class="claim-info-card">
          <div class="d-flex justify-space-between mb-2">
            <span class="text-caption grey--text">{{ $t('miniGero.claimableRewards') }}</span>
            <span class="text-body-2 font-weight-bold" style="color: var(--chain-primary);">{{ formattedRewards }}</span>
          </div>
          <div v-if="claimGatedByDRep" class="drep-warning">
            <v-icon small color="warning" class="mr-1">mdi-alert-outline</v-icon>
            <span class="text-caption warning--text">{{ $t('miniGero.drepRequired') }}</span>
          </div>
        </div>

        <v-btn
          block
          class="mt-4 claim-btn"
          :loading="claimLoading"
          :disabled="claimGatedByDRep"
          @click="confirmClaim"
        >
          {{ claimGatedByDRep ? $t('miniGero.delegateDRepFirst') : $t('miniGero.confirmWithdrawal') }}
        </v-btn>

        <v-btn
          v-if="claimGatedByDRep"
          block
          text
          small
          :color="primaryColor"
          class="mt-2 text-none"
          @click="goToGovernance"
        >
          {{ $t('miniGero.goToGovernance') }}
        </v-btn>
      </div>
    </BottomSheet>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, watch, onMounted } from 'vue';
import { walletStore } from '@/stores/walletStore';
import stakingStoreActions from '@/stores/stakingStore';
import governanceStoreActions from '@/stores/governanceStore';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import StakingStatusCard from '../components/staking/StakingStatusCard.vue';
import PoolListView from '../components/staking/PoolListView.vue';
import GovernanceView from '../components/staking/GovernanceView.vue';
import RewardsView from '../components/staking/RewardsView.vue';
import BottomSheet from '../components/BottomSheet.vue';
import { useChainContext } from '../composables/useChainContext';

const activeTab = ref(0);
const showClaimSheet = ref(false);
const claimLoading = ref(false);

const { isApex, themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);
const { loggedWallet, account } = toRefs(walletStore);

const currencySymbol = computed(() => {
  return networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network);
});

const formattedRewards = computed(() => {
  if (!account.value?.withdrawable_amount) return `${currencySymbol.value}0`;
  return filters.toCurrency(
    account.value.withdrawable_amount,
    false,
    6,
    currencySymbol.value
  );
});

const hasDRepDelegation = computed(() => {
  return !!account.value?.drep_id;
});

// DRep delegation is a Cardano Conway-era requirement for reward withdrawal.
// Apex has no governance/DRep layer, so its claim flow is never DRep-gated.
const claimGatedByDRep = computed(() => !isApex.value && !hasDRepDelegation.value);

const handleClaim = () => {
  showClaimSheet.value = true;
};

const confirmClaim = async () => {
  claimLoading.value = true;
  try {
    // Open full dashboard for withdrawal signing
    const optionsUrl = chrome.runtime.getURL('index.html#/staking');
    chrome.tabs.create({ url: optionsUrl });
    showClaimSheet.value = false;
  } catch (err) {
    console.error('Error initiating claim:', err);
  } finally {
    claimLoading.value = false;
  }
};

const goToGovernance = () => {
  showClaimSheet.value = false;
  activeTab.value = 1;
};

// Load current pool data on mount
onMounted(async () => {
  if (account.value?.pool_id && loggedWallet.value) {
    stakingStoreActions.clearCurrentPool();
    await stakingStoreActions.loadPoolById(loggedWallet.value, account.value.pool_id);
  }

  if (account.value?.drep_id && loggedWallet.value) {
    await governanceStoreActions.loadDRepById(loggedWallet.value, account.value.drep_id);
  }
});

// Reload pool data when account changes
watch(
  () => account.value?.pool_id,
  async (newPoolId) => {
    if (newPoolId && loggedWallet.value) {
      stakingStoreActions.clearCurrentPool();
      await stakingStoreActions.loadPoolById(loggedWallet.value, newPoolId);
    }
  }
);

watch(
  () => account.value?.drep_id,
  async (newDRepId) => {
    if (newDRepId && loggedWallet.value) {
      await governanceStoreActions.loadDRepById(loggedWallet.value, newDRepId);
    }
  }
);
</script>

<style scoped>
.staking-page {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.segment-toggle-wrapper {
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}

.segment-toggle {
  background: rgba(255, 255, 255, 0.04) !important;
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px !important;
  width: 100%;
}

.segment-btn {
  flex: 1 !important;
  background: transparent !important;
  color: #888 !important;
  border: none !important;
  font-size: 13px !important;
  letter-spacing: 0 !important;
  height: 36px !important;
}

.segment-active {
  background: linear-gradient(135deg, color-mix(in srgb, var(--chain-gradient1) 15%, transparent), color-mix(in srgb, var(--chain-gradient2) 10%, transparent)) !important;
  color: var(--chain-primary) !important;
}

/* Claim confirmation */
.claim-info-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 14px;
}

.drep-warning {
  display: flex;
  align-items: center;
  margin-top: 8px;
  padding: 8px;
  background: rgba(255, 152, 0, 0.1);
  border-radius: 8px;
}

.claim-btn {
  background: linear-gradient(135deg, var(--chain-gradient1), var(--chain-gradient2)) !important;
  color: #000 !important;
  font-weight: 600;
  text-transform: none;
  border-radius: 10px;
  height: 44px !important;
}

.claim-btn.v-btn--disabled {
  background: #333 !important;
  color: #666 !important;
}
</style>
