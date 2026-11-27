<template>
  <BaseDialog
    size="sm"
    :isOpen="props.modelValue"
    :title="title"
    :subtitle="subtitle"
    :min-height="0"
    :scrollable="true"
    :loading="busy"
    :persistent="true"
    @close="closeDialog"
  >
    <v-card-text class="px-5 pt-1 pb-5">
      <SolanaStakeForm
        :open="props.modelValue"
        :action="props.action"
        :account="props.account"
        :validators="props.validators"
        :validators-failed="props.validatorsFailed"
        :info="props.info"
        @close="closeDialog()"
        @busy="busy = $event"
        @done="emit('done')"
      />
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
// The dashboard's Solana Stake / Unstake / Withdraw: SolanaStakeForm in a dialog.
import { computed, ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import SolanaStakeForm from '@/modules/transactions/components/SolanaStakeForm.vue';
import networks from '@/utils/networks';
import type { SolanaStakeAction } from '@/chains/solana/solanaStakeTransfer';
import type { SolanaStakeAccount, SolanaStakeInfo, SolanaValidator } from '@/chains/solana/solanaStaking';

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

function closeDialog(): void {
  emit('update:modelValue', false);
}
</script>
