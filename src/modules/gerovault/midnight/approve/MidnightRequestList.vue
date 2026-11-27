<template>
  <!-- Placeholder from the scaffolding: the open requests and the approvals collected. Hosted by the vault screen; renders nothing yet. -->
  <div hidden data-test="gvm-hosted-placeholder" />
</template>

<script setup lang="ts">
import type { MidnightVaultHostedProps } from '@/modules/gerovault/midnight/contracts';

defineOptions({ name: 'MidnightRequestList' });
defineProps<MidnightVaultHostedProps>();
</script>
