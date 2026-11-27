<template>
  <!-- Placeholder from the scaffolding: the Recovery tab: guardians, settings, a pending recovery and its cancel, health. Hosted by the vault screen; renders nothing yet. -->
  <div hidden data-test="gvm-hosted-placeholder" />
</template>

<script setup lang="ts">
import type { MidnightVaultHostedProps } from '@/modules/gerovault/midnight/contracts';

defineOptions({ name: 'MidnightRecoveryPanel' });
defineProps<MidnightVaultHostedProps>();
</script>
