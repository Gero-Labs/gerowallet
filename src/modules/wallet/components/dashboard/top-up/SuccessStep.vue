<template>
  <div class="success-step">
    <!-- Success Icon -->
    <div class="success-icon">
      <v-icon color="#47CD89" size="24">mdi-check-circle</v-icon>
    </div>

    <!-- Title and Subtitle -->
    <div class="header-text">
      <h2 class="modal-title">Top-up Success</h2>
      <p class="modal-subtitle">Your balance has been updated and is ready to use</p>
      <p class="transaction-id">
        Transaction ID:
        <a :href="`https://cexplorer.io/tx/${transactionId}`" target="_blank"
          >#{{ transactionId.slice(0, 8) }}...{{ transactionId.slice(-8) }}</a
        >
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
// Props
interface Props {
  transactionId?: string;
}

withDefaults(defineProps<Props>(), {
  transactionId: '20023952',
});

// Emits
const emit = defineEmits<{
  (e: 'back-to-account'): void;
}>();
</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.success-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  padding: $spacing-2xl $spacing-2xl $spacing-md;
}

.success-icon {
  width: 48px;
  height: 48px;
  background: $background-secondary;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-sm;
  width: 100%;
}

.modal-title {
  @include heading-style($font-size-2xl);
  color: $text-primary;
  margin: 0;
  line-height: 1.17;
  text-align: center;
  font-weight: 600;
  font-size: 24px;
}

.modal-subtitle {
  @include body-text($font-size-base);
  color: $text-secondary;
  margin: 0;
  line-height: 1.5;
  text-align: center;
  font-size: 16px;
}

.transaction-id {
  font-family: Inter;
  font-weight: 600;
  font-size: 16px;
  line-height: 1.25;
  color: #cecfd2;
  margin: 0;
  text-align: center;
}
</style>
