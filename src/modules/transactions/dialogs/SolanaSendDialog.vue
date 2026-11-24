<template>
  <BaseDialog
    size="sm"
    :isOpen="props.modelValue"
    :title="props.nftMint ? t('solana.nft.sendTitle') : t('solana.sendTitle')"
    :subtitle="props.nftMint ? t('solana.nft.sendSubtitle') : t('solana.sendSubtitle', { currency: ticker })"
    :img="assts.sendSvg"
    img-color="var(--g-text-1)"
    :min-height="0"
    :scrollable="true"
    :loading="busy"
    :persistent="true"
    @close="closeDialog"
  >
    <v-card-text class="px-5 pt-1 pb-5">
      <SolanaSendForm :open="props.modelValue" :nft-mint="props.nftMint" @close="closeDialog()" @busy="busy = $event" />
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
// The dashboard's SOL send: SolanaSendForm in a dialog (the side panel hosts the same
// form in SolanaSendSheet).
import { computed, ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import SolanaSendForm from '@/modules/transactions/components/SolanaSendForm.vue';
import assts from '@/utils/assets';
import networks from '@/utils/networks';

/** `nftMint`: send that NFT (from its detail), with the asset and amount fixed. */
const props = defineProps<{ modelValue: boolean; nftMint?: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const { t } = useTranslation();
const busy = ref(false);
const ticker = computed(() => networks.resolveCurrencyTicker(walletStore.loggedWallet?.chain, walletStore.loggedWallet?.network));

function closeDialog(): void {
  emit('update:modelValue', false);
}
</script>
