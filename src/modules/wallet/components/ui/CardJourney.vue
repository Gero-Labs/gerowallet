<template>
  <CardSteps :steps="steps" :current="current" :label="t('card.journeyLabel')" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import CardSteps from './CardSteps.vue';

/** 0 register, 1 verify identity, 2 order, 3 activate, 4 spend. */
defineProps<{ current: number }>();

const { t } = useTranslation();

const steps = computed(() => [
  t('card.registerOnKaiserex'),
  t('card.journeyVerify'),
  t('card.journeyOrder'),
  t('card.journeyActivate'),
  t('card.journeySpend'),
]);
</script>
