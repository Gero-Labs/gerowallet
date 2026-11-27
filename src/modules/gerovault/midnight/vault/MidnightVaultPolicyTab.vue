<template>
  <!-- Placeholder from the scaffolding: the Policy tab: whitelist, delegates and a pending policy change. This folder's screen replaces this file. -->
  <section class="glass-panel" data-test="gvm-placeholder">
    <EmptyState icon="mdi-account-group-outline" :message="$t('common.comingSoon')" />
  </section>
</template>

<script setup lang="ts">
import EmptyState from '@/shared/components/feedback/EmptyState.vue';

defineOptions({ name: 'MidnightVaultPolicyTab' });
</script>
