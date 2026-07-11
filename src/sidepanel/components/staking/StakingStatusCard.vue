<template>
  <div class="status-card">
    <!-- {{ $t('miniGero.stakepool') }} Row -->
    <div class="status-row">
      <div class="status-label">
        <v-icon small color="grey lighten-1" class="mr-1">mdi-server-network</v-icon>
        <span class="grey--text text--lighten-1 text-caption">{{ $t('miniGero.stakepool') }}</span>
      </div>
      <div class="status-value">
        <template v-if="pool">
          <span class="white--text text-body-2 font-weight-medium">[{{ pool.ticker }}] {{ pool.name }}</span>
        </template>
        <span v-else class="grey--text text-body-2">{{ $t('miniGero.notDelegated') }}</span>
      </div>
    </div>

    <!-- DRep Row -->
    <div class="status-row">
      <div class="status-label">
        <v-icon small color="grey lighten-1" class="mr-1">mdi-vote</v-icon>
        <span class="grey--text text--lighten-1 text-caption">{{ $t('miniGero.drep') }}</span>
      </div>
      <div class="status-value">
        <span class="white--text text-body-2 font-weight-medium">{{ delegatingTo }}</span>
      </div>
    </div>

    <!-- Rewards Row -->
    <div class="status-row rewards-row">
      <div class="status-label">
        <v-icon small color="grey lighten-1" class="mr-1">mdi-gift-outline</v-icon>
        <span class="grey--text text--lighten-1 text-caption">{{ $t('miniGero.rewards') }}</span>
      </div>
      <div class="status-value d-flex align-center">
        <span
          class="text-body-2 font-weight-medium"
          :class="hasRewards ? 'accent--text' : 'white--text'"
        >
          {{ formattedRewards }}
        </span>
        <v-btn
          v-if="hasRewards"
          x-small
          text
          :color="primaryColor"
          class="ml-2 text-none claim-btn"
          :loading="claimLoading"
          @click="$emit('claim')"
        >
          {{ $t('miniGero.claim') }}
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import stakingStoreActions from '@/stores/stakingStore';
import governanceStoreActions from '@/stores/governanceStore';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import { useChainContext } from '../../composables/useChainContext';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

defineProps<{
  claimLoading?: boolean;
}>();

defineEmits<{
  (e: 'claim'): void;
}>();

const { t } = useTranslation();
const { loggedWallet, account } = toRefs(walletStore);

const pool = computed(() => {
  if (stakingStoreActions.state.currentPool) {
    return stakingStoreActions.state.currentPool;
  }
  return null;
});

const currencySymbol = computed(() => {
  return networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network);
});

const hasRewards = computed(() => {
  return account.value?.withdrawable_amount && Number(account.value.withdrawable_amount) > 0;
});

const formattedRewards = computed(() => {
  if (!account.value?.withdrawable_amount) return `${currencySymbol.value}0`;
  return filters.toCurrency(
    account.value.withdrawable_amount,
    false,
    2,
    currencySymbol.value,
    '',
    false
  );
});

const delegatingTo = computed(() => {
  const currentDRep = governanceStoreActions.state.currentDRep;
  if (!currentDRep) return t('miniGero.notDelegated');
  if (currentDRep.drep_id === 'drep_always_abstain') return t('miniGero.abstain');
  if (currentDRep.drep_id === 'drep_always_no_confidence') return t('miniGero.noConfidence');

  const meta = currentDRep.metadata?.meta_json?.body?.givenName;
  if (meta) {
    return meta['@value'] || meta;
  }
  return filters.truncate(currentDRep.drep_id);
});
</script>

<style scoped>
.status-card {
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 12px 14px;
}

.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
}

.status-row + .status-row {
  border-top: 1px solid var(--g-hairline-1);
}

.status-label {
  display: flex;
  align-items: center;
  min-width: 100px;
}

.status-value {
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.claim-btn {
  min-width: 0 !important;
  padding: 0 6px !important;
  height: 22px !important;
  letter-spacing: 0;
}

.accent--text {
  color: var(--g-accent) !important;
}
</style>
