<template>
  <!-- Placeholder from the scaffolding: the History tab: the contract's actions from the indexer. This folder's screen replaces this file. -->
  <section class="glass-panel" data-test="gvm-placeholder">
    <EmptyState icon="mdi-history" :message="$t('common.comingSoon')" />
  </section>
</template>

<script setup lang="ts">
import EmptyState from '@/shared/components/feedback/EmptyState.vue';

defineOptions({ name: 'MidnightVaultHistoryTab' });
</script>
