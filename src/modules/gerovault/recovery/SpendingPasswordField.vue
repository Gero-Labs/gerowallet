<template>
  <!-- Asked only when this wallet's vault keys need the spending password to be derived. -->
  <v-text-field
    :model-value="modelValue"
    type="password"
    :label="$t('wallet.spendingPassword')"
    :hint="$t('gerovault.detail.recovery.passwordHint')"
    persistent-hint
    variant="outlined"
    density="compact"
    autocomplete="current-password"
    :error="error"
    data-test="recovery-spending-password"
    @update:model-value="$emit('update:modelValue', String($event ?? ''))"
  />
</template>

<script setup lang="ts">
defineOptions({ name: 'SpendingPasswordField' });

defineProps<{ modelValue: string; error?: boolean }>();
defineEmits<{ (e: 'update:modelValue', value: string): void }>();
</script>
