<template>
  <!-- Placeholder from the scaffolding: a deposit from this wallet, a contract call. This folder's screen replaces this file. -->
  <section class="glass-panel" data-test="gvm-placeholder">
    <EmptyState icon="mdi-tray-arrow-down" :message="$t('common.comingSoon')" />
  </section>
</template>

<script setup lang="ts">
import EmptyState from '@/shared/components/feedback/EmptyState.vue';

defineOptions({ name: 'MidnightVaultDeposit' });
</script>
