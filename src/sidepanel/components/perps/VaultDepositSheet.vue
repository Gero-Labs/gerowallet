<template>
  <BottomSheet
    :model-value="modelValue"
    :title="$t('vaults.depositTo', { name: vaultName })"
    height="auto"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- Account funding APIs cannot target a managed vault. Keep this route
         read-only until vault-specific transfers have a verified API contract. -->
    <div class="pa-4" role="status">
      <p class="t-heading mb-2">{{ $t('common.comingSoon') }}</p>
      <p class="t-body">{{ $t('vaults.transfersUnavailable') }}</p>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import BottomSheet from '@/sidepanel/components/BottomSheet.vue';

defineProps<{
  modelValue: boolean;
  vaultId: string;
  vaultName: string;
  currentValue?: string;
}>();

defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();
</script>
