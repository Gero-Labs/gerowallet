<template>
  <!-- Accepting a quarantined vault is the user's own statement that they agreed to join it: a
       package or a registration proves only that the keys build the vault (spec 6.8). -->
  <div class="candidate-accept" data-test="candidate-accept">
    <v-checkbox
      :model-value="agreed"
      density="compact"
      hide-details
      color="primary"
      :disabled="busy"
      data-test="candidate-accept-agree"
      @update:model-value="$emit('update:agreed', $event === true)"
    >
      <template #label>
        <span class="t-body-sm">{{ $t('gerovault.detail.candidate.agree') }}</span>
      </template>
    </v-checkbox>
    <div class="candidate-accept__actions">
      <slot name="secondary" />
      <GButton tier="primary" :disabled="!agreed || busy" :loading="busy" data-test="candidate-accept-button" @click="$emit('accept')">
        {{ $t('gerovault.detail.candidate.accept') }}
      </GButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import GButton from '@/shared/components/GButton/GButton.vue';

defineOptions({ name: 'CandidateAcceptPanel' });

defineProps<{ agreed: boolean; busy?: boolean }>();
defineEmits<{ (e: 'update:agreed', value: boolean): void; (e: 'accept'): void }>();
</script>

<style scoped>
.candidate-accept {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
.candidate-accept__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--g-s-3);
}
</style>
