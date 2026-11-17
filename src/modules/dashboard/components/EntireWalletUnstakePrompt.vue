<template>
  <!-- Asked before "Send Entire Wallet" while the stake key is registered: the key
       deposit is in no UTxO, and rewards are only withdrawn by a send when
       auto-withdraw is on and the key is DRep-delegated. Whatever the send cannot
       carry stays behind, and only stopping staking (deregistration, which also
       claims the rewards) brings it back into the balance. -->
  <BaseDialog
    :isOpen="isOpen"
    :title="t('send.entireWalletUnstake.title')"
    :title-lines="2"
    :width="428"
    :min-height="0"
    :persistent="false"
    icon="mdi-lock-alert-outline"
    icon-color="warning"
    @close="emit('close')"
  >
    <v-card-text class="px-0 entire-wallet-unstake">
      <p class="t-body mb-3">{{ t('send.entireWalletUnstake.intro') }}</p>
      <dl class="entire-wallet-unstake__rows glass-tier mb-3">
        <div class="entire-wallet-unstake__row">
          <dt>{{ t('send.entireWalletUnstake.deposit') }}</dt>
          <dd class="g-num" data-testid="entire-wallet-unstake-deposit">{{ depositText }}</dd>
        </div>
        <div v-if="rewardsLeftLovelace > 0" class="entire-wallet-unstake__row">
          <dt>{{ t('send.entireWalletUnstake.rewards') }}</dt>
          <dd class="g-num" data-testid="entire-wallet-unstake-rewards">{{ rewardsLeftText }}</dd>
        </div>
      </dl>
      <p v-if="rewardsIncludedLovelace > 0" class="t-body-sm entire-wallet-unstake__hint mb-2">
        {{ t('send.entireWalletUnstake.rewardsIncluded', { amount: rewardsIncludedText }) }}
      </p>
      <p class="t-body-sm entire-wallet-unstake__hint mb-0">{{ t('send.entireWalletUnstake.hint') }}</p>
    </v-card-text>
    <v-card-actions class="px-0 pb-0 entire-wallet-unstake__actions">
      <GButton tier="primary" block data-testid="entire-wallet-unstake-first" @click="emit('unstake')">
        {{ t('send.entireWalletUnstake.unstakeFirst') }}
      </GButton>
      <GButton tier="tertiary" block data-testid="entire-wallet-send-anyway" @click="emit('continue')">
        {{ t('send.entireWalletUnstake.sendAnyway') }}
      </GButton>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import filters from '@/shared/utils/filters';
import { useTranslation } from '@/shared/composables/useTranslation';

const props = withDefaults(defineProps<{
  isOpen: boolean;
  /** The stake key deposit in lovelace. */
  depositLovelace: number;
  /** Rewards the send would NOT withdraw, in lovelace: they stay behind too. */
  rewardsLeftLovelace?: number;
  /** Rewards the send withdraws anyway (auto-withdraw), in lovelace. */
  rewardsIncludedLovelace?: number;
}>(), { rewardsLeftLovelace: 0, rewardsIncludedLovelace: 0 });

const emit = defineEmits<{
  (e: 'unstake'): void;
  (e: 'continue'): void;
  (e: 'close'): void;
}>();

const { t } = useTranslation();

const depositText = computed(() => filters.toCurrency(props.depositLovelace));
const rewardsLeftText = computed(() => filters.toCurrency(props.rewardsLeftLovelace));
const rewardsIncludedText = computed(() => filters.toCurrency(props.rewardsIncludedLovelace));
</script>

<style scoped>
.entire-wallet-unstake {
  position: relative;
  z-index: 1;
}
.entire-wallet-unstake__rows {
  margin: 0;
  padding: var(--g-s-2) var(--g-s-3);
  border-radius: var(--g-r-control);
}
.entire-wallet-unstake__row {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-1) 0;
}
.entire-wallet-unstake__row dt {
  color: var(--g-text-2);
}
.entire-wallet-unstake__row dd {
  margin: 0;
  color: var(--g-text-1);
  font-weight: 600;
}
.entire-wallet-unstake__hint {
  color: var(--g-text-2);
}
.entire-wallet-unstake__actions {
  flex-direction: column;
  gap: var(--g-s-2);
}
.entire-wallet-unstake__actions > .v-btn + .v-btn {
  margin-inline-start: 0;
}
</style>
