<template>
  <!-- Placeholder from the scaffolding: the owners' cancel of a pending recovery. This folder's screen replaces this file. -->
  <section class="glass-panel" data-test="gvm-placeholder">
    <EmptyState icon="mdi-shield-alert-outline" :message="$t('common.comingSoon')" />
  </section>
</template>

<script setup lang="ts">
import EmptyState from '@/shared/components/feedback/EmptyState.vue';

defineOptions({ name: 'MidnightCancelRecovery' });
</script>
