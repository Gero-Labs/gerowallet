<template>
  <v-tooltip bottom open-delay="300" content-class="custom-tooltip">
    <template v-slot:activator="{ on, attrs }">
      <v-chip
        v-bind="attrs"
        v-on="on"
        :x-small="size === 'small'"
        :small="size === 'default'"
        :color="chipColor"
        :text-color="textColor"
        outlined
        class="font-weight-bold"
      >
        {{ rating || $t('market.na') }}
      </v-chip>
    </template>
    <span>{{ $t('market.riskTooltip') }}</span>
  </v-tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  rating: string | null;
  size?: 'small' | 'default';
}>(), {
  size: 'small',
});

const chipColor = computed(() => {
  if (!props.rating) return 'grey';
  switch (props.rating) {
    case 'AAA':
    case 'AA':
      return '#4caf50';
    case 'A':
    case 'BBB':
      return '#8bc34a';
    case 'BB':
    case 'B':
      return '#ffc107';
    case 'CCC':
    case 'CC':
      return '#ff9800';
    case 'C':
    case 'D':
      return '#f44336';
    default:
      return 'grey';
  }
});

const textColor = computed(() => {
  if (!props.rating) return 'grey';
  switch (props.rating) {
    case 'BB':
    case 'B':
      return '#795548';
    default:
      return chipColor.value;
  }
});
</script>
