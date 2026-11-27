<template>
  <!-- Placeholder from the scaffolding: one request: its approvals, importing more, and the submit with proving progress. This folder's screen replaces this file. -->
  <section class="glass-panel" data-test="gvm-placeholder">
    <EmptyState icon="mdi-file-check-outline" :message="$t('common.comingSoon')" />
  </section>
</template>

<script setup lang="ts">
import EmptyState from '@/shared/components/feedback/EmptyState.vue';

defineOptions({ name: 'MidnightRequestDetail' });
</script>
