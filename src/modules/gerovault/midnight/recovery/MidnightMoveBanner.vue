<template>
  <!-- Placeholder from the scaffolding: the banner of a temporary vault until its funds have moved. Hosted by the vault screen; renders nothing yet. -->
  <div hidden data-test="gvm-hosted-placeholder" />
</template>

<script setup lang="ts">
import type { MidnightVaultHostedProps } from '@/modules/gerovault/midnight/contracts';

defineOptions({ name: 'MidnightMoveBanner' });
defineProps<MidnightVaultHostedProps>();
</script>
