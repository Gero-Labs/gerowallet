<template>
  <!-- Placeholder from the scaffolding: guardian enrolment: the card, the code check and the backup. This folder's screen replaces this file. -->
  <section class="glass-panel" data-test="gvm-placeholder">
    <EmptyState icon="mdi-account-plus-outline" :message="$t('common.comingSoon')" />
  </section>
</template>

<script setup lang="ts">
import EmptyState from '@/shared/components/feedback/EmptyState.vue';

defineOptions({ name: 'MidnightGuardianEnrol' });
</script>
