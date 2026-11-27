<template>
  <!-- Placeholder from the scaffolding: the vaults home (this seed's vaults, Create and Import). This folder's screen replaces this file. -->
  <div class="d-flex flex-column ga-4" data-test="gvm-placeholder">
    <section class="glass-panel">
      <EmptyState icon="mdi-shield-lock-outline" :message="$t('common.comingSoon')" />
    </section>
    <MidnightGuardianList v-if="walletId !== undefined" :wallet-id="walletId" />
  </div>
</template>

<script setup lang="ts">
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import MidnightGuardianList from '@/modules/gerovault/midnight/guardian/MidnightGuardianList.vue';
import { useMidnightVaultRoute } from './vaultRoute';

defineOptions({ name: 'MidnightVaultsHome' });

const { walletId } = useMidnightVaultRoute();
</script>
