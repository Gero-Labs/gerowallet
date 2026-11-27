<template>
  <!-- Placeholder from the scaffolding: importing a vault by file or by contract address, and a restored package's review. This folder's screen replaces this file. -->
  <section class="glass-panel" data-test="gvm-placeholder">
    <EmptyState icon="mdi-tray-arrow-down" :message="$t('common.comingSoon')" />
  </section>
</template>

<script setup lang="ts">
import EmptyState from '@/shared/components/feedback/EmptyState.vue';

defineOptions({ name: 'MidnightVaultImport' });
</script>
