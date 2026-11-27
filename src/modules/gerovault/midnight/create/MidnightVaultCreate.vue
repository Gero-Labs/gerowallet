<template>
  <!-- Placeholder from the scaffolding: the create flow, with the verification ceremony and the deploy progress. This folder's screen replaces this file. -->
  <section class="glass-panel" data-test="gvm-placeholder">
    <EmptyState icon="mdi-shield-plus-outline" :message="$t('common.comingSoon')" />
  </section>
</template>

<script setup lang="ts">
import EmptyState from '@/shared/components/feedback/EmptyState.vue';

defineOptions({ name: 'MidnightVaultCreate' });
</script>
