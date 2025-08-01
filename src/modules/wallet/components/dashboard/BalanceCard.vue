<template>
  <v-card class="balance-card" outlined>
    <div class="card-content">
      <div class="card-header">
        <h3 class="card-title" :class="{ 'gero-title': isGero }">{{ title }}</h3>
      </div>
      <div class="card-values">
        <div class="primary-value">{{ primaryValue }}</div>
        <div class="secondary-value">{{ secondaryValue }}</div>
      </div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
interface Props {
  title: string;
  primaryValue: string;
  secondaryValue: string;
  isGero?: boolean;
}

defineProps<Props>();
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.balance-card {
  background: $background-card; 
  border: 1px solid $border-secondary;
  border-radius: $border-radius-md;
  padding: $spacing-lg;

  .card-content {
    display: flex;
    flex-direction: column;
    gap: $spacing-sm;
  }

  .card-header {
    display: flex;
  }

  .card-title {
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    font-size: $font-size-sm;
    line-height: 1.43;
    color: $text-muted;
    margin: 0;

    &.gero-title {
      color: $primary-cyan;
    }
  }

  .card-values {
    display: flex;
    flex-direction: column;
    gap: $spacing-sm;
  }

  .primary-value {
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    font-size: 30px;
    line-height: 1.27;
    color: $text-primary;
  }

  .secondary-value {
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    font-size: $font-size-sm;
    line-height: 1.14;
    color: $text-muted;
  }
}
</style>
