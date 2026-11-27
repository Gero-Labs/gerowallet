<template>
  <!-- Placeholder from the scaffolding: the vaults this seed guards, on the vaults home. Hosted by the vault screen; renders nothing yet. -->
  <div hidden data-test="gvm-hosted-placeholder" />
</template>

<script setup lang="ts">
import type { MidnightGuardianHostedProps } from '@/modules/gerovault/midnight/contracts';

defineOptions({ name: 'MidnightGuardianList' });
defineProps<MidnightGuardianHostedProps>();
</script>
