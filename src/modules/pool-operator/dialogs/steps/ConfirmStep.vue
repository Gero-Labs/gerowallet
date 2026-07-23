<template>
  <div class="wizard-step text-center">
    <v-icon size="48" color="success" class="mb-2">mdi-check-circle-outline</v-icon>
    <h3 class="t-heading mb-1">{{ $t('poolOperator.setupComplete') }}</h3>
    <p class="text-body-2 grey--text mb-4">{{ $t('poolOperator.reviewSetup') }}</p>

    <div class="text-left mb-4">
      <div class="text-caption grey--text">{{ $t('poolOperator.poolIdDerived') }}</div>
      <div class="monospace-text text-body-2 mb-2">{{ poolId }}</div>
      <div class="text-caption grey--text">{{ $t('poolOperator.vrfKeyHash') }}</div>
      <div class="monospace-text text-body-2">{{ vrfKeyHash }}</div>
    </div>

    <v-btn color="primary" block @click="$emit('finish')">{{ $t('poolOperator.completeSetup') }}</v-btn>
  </div>
</template>

<script setup lang="ts">
defineProps<{ poolId: string | null; vrfKeyHash: string | null }>();
defineEmits(['finish']);
</script>
