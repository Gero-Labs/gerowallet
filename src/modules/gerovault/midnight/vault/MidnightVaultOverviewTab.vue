<template>
  <!-- Placeholder from the scaffolding: the Overview tab (balance, owners, actions, open requests). This folder's screen replaces this file. -->
  <div class="d-flex flex-column ga-4" data-test="gvm-placeholder">
    <section class="glass-panel">
      <EmptyState icon="mdi-shield-lock-outline" :message="$t('common.comingSoon')" />
    </section>
    <MidnightRequestList v-if="walletId !== undefined" :wallet-id="walletId" :vault-id="vaultId" />
  </div>
</template>

<script setup lang="ts">
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import MidnightRequestList from '@/modules/gerovault/midnight/approve/MidnightRequestList.vue';
import { useMidnightVaultRoute } from './vaultRoute';

defineOptions({ name: 'MidnightVaultOverviewTab' });

const { walletId, vaultId } = useMidnightVaultRoute();
</script>
