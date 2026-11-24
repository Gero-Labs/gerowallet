<template>
  <v-alert v-if="visible" type="info" variant="tonal" density="compact" role="status" class="mt-2" data-test="dust-upgrade-notice">
    {{ t(network === 'preprod' ? 'midnight.dustUpgrade.nativeCleared' : 'midnight.dustUpgrade.cnightRefill') }}
    <GButton tier="tertiary" compact @click="visible = false">{{ t('midnight.pending.dismiss') }}</GButton>
  </v-alert>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { claimDustUpgradeNotice } from '@/chains/midnight/midnightDustUpgradeNotice';

const props = defineProps<{ network: 'preprod' | 'mainnet'; address: string }>();
const { t } = useTranslation();
const visible = ref(false);
watch(() => [props.network, props.address] as const, ([network, address]) => {
  visible.value = claimDustUpgradeNotice(network, address);
}, { immediate: true });
</script>
