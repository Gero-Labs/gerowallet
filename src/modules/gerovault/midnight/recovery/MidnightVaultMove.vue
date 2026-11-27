<template>
  <!-- Placeholder from the scaffolding: the checklist after a recovery and the guided move to a new vault. This folder's screen replaces this file. -->
  <section class="glass-panel" data-test="gvm-placeholder">
    <EmptyState icon="mdi-swap-horizontal" :message="$t('common.comingSoon')" />
  </section>
</template>

<script setup lang="ts">
import EmptyState from '@/shared/components/feedback/EmptyState.vue';

defineOptions({ name: 'MidnightVaultMove' });
</script>
