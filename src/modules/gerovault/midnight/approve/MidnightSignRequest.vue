<template>
  <!-- Placeholder from the scaffolding: an owner opens a request file, reviews it on the approval sheet and signs. This folder's screen replaces this file. -->
  <section class="glass-panel" data-test="gvm-placeholder">
    <EmptyState icon="mdi-file-sign" :message="$t('common.comingSoon')" />
  </section>
</template>

<script setup lang="ts">
import EmptyState from '@/shared/components/feedback/EmptyState.vue';

defineOptions({ name: 'MidnightSignRequest' });
</script>
