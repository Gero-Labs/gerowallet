<template>
  <!-- Placeholder from the scaffolding: the vault screen (header, status chips, tabs). This folder's screen replaces this file. -->
  <div class="d-flex flex-column ga-4" data-test="gvm-vault-screen">
    <template v-if="walletId !== undefined">
      <MidnightRecoveryAlert :wallet-id="walletId" :vault-id="vaultId" />
      <MidnightMoveBanner :wallet-id="walletId" :vault-id="vaultId" />
    </template>
    <router-view />
  </div>
</template>

<script setup lang="ts">
import MidnightMoveBanner from '@/modules/gerovault/midnight/recovery/MidnightMoveBanner.vue';
import MidnightRecoveryAlert from '@/modules/gerovault/midnight/recovery/MidnightRecoveryAlert.vue';
import { useMidnightVaultRoute } from './vaultRoute';

defineOptions({ name: 'MidnightVaultScreen' });

const { walletId, vaultId } = useMidnightVaultRoute();
</script>
