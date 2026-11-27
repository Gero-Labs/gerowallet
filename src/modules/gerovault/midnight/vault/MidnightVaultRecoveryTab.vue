<template>
  <!-- Placeholder from the scaffolding: the Recovery tab, which shows the recovery screens' panel. This folder's screen replaces this file. -->
  <MidnightRecoveryPanel v-if="walletId !== undefined" :wallet-id="walletId" :vault-id="vaultId" />
</template>

<script setup lang="ts">
import MidnightRecoveryPanel from '@/modules/gerovault/midnight/recovery/MidnightRecoveryPanel.vue';
import { useMidnightVaultRoute } from './vaultRoute';

defineOptions({ name: 'MidnightVaultRecoveryTab' });

const { walletId, vaultId } = useMidnightVaultRoute();
</script>
