<template>
  <BottomSheet
    :model-value="modelValue"
    :title="title"
    height="92%"
    :persistent="busy"
    :close-disabled="busy"
    @update:model-value="onUpdate"
  >
    <div class="solana-stake-sheet">
      <p class="t-caption solana-stake-sheet__subtitle">{{ subtitle }}</p>
      <SolanaStakeForm
        :open="modelValue"
        :action="action"
        :account="account"
        :validators="validators"
        :validators-failed="validatorsFailed"
        :info="info"
        in-panel
        @close="onUpdate(false)"
        @busy="busy = $event"
        @done="emit('done')"
      />
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import BottomSheet from '../BottomSheet.vue';
import SolanaStakeForm from '@/modules/transactions/components/SolanaStakeForm.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';
import type { SolanaStakeAction } from '@/chains/solana/solanaStakeTransfer';
import type { SolanaStakeAccount, SolanaStakeInfo, SolanaValidator } from '@/chains/solana/solanaStaking';

/** Side panel host for Stake / Unstake / Withdraw: the dashboard dialog's form in a sheet. */
const props = defineProps<{
  modelValue: boolean;
  action: SolanaStakeAction;
  account?: SolanaStakeAccount | null;
  validators: SolanaValidator[] | null;
  validatorsFailed?: boolean;
  info: SolanaStakeInfo | null;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'done'): void;
}>();

const { t } = useTranslation();
const busy = ref(false);
const ticker = computed(() => networks.resolveCurrencyTicker(walletStore.loggedWallet?.chain, walletStore.loggedWallet?.network));
const title = computed(() => (props.action === 'stake'
  ? t('solana.staking.stakeTitle', { ticker: ticker.value })
  : t(`solana.staking.${props.action}`)));
const subtitle = computed(() => t(`solana.staking.${props.action}Subtitle`, { ticker: ticker.value }));

function onUpdate(value: boolean): void {
  // Held while a PassKey ceremony, a device or the action itself is in flight.
  if (!value && busy.value) return;
  emit('update:modelValue', value);
}
</script>

<style scoped lang="scss">
.solana-stake-sheet {
  padding: 0 var(--g-s-4) var(--g-s-4);
}

.solana-stake-sheet__subtitle {
  margin: 0 0 var(--g-s-3);
  color: var(--g-text-2);
}
</style>
