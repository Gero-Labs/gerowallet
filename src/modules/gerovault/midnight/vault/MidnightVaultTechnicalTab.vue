<template>
  <!-- Placeholder from the scaffolding: the Technical tab: contract, build, verifier keys, committee and the last state read. This folder's screen replaces this file. -->
  <section class="glass-panel" data-test="gvm-placeholder">
    <EmptyState icon="mdi-cog-outline" :message="$t('common.comingSoon')" />
  </section>
</template>

<script setup lang="ts">
import EmptyState from '@/shared/components/feedback/EmptyState.vue';

defineOptions({ name: 'MidnightVaultTechnicalTab' });
</script>
