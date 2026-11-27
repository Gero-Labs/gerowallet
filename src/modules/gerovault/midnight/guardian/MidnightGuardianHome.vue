<template>
  <!-- Placeholder from the scaffolding: guardian mode: the vaults this seed guards, its slot and check-ins. This folder's screen replaces this file. -->
  <section class="glass-panel" data-test="gvm-placeholder">
    <EmptyState icon="mdi-shield-account-outline" :message="$t('common.comingSoon')" />
  </section>
</template>

<script setup lang="ts">
import EmptyState from '@/shared/components/feedback/EmptyState.vue';

defineOptions({ name: 'MidnightGuardianHome' });
</script>
