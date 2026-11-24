<template>
  <GButton tier="tertiary" compact data-test="dust-fee-recovery" @click="open = true">
    {{ t('midnight.manageDustRegistration') }}
  </GButton>
  <DustRegistrationDialog v-if="open" :is-open="true" recover-fee @close="open = false" />
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';

const DustRegistrationDialog = defineAsyncComponent(() => import('@/modules/dashboard/dialogs/DustRegistrationDialog.vue'));
const { t } = useTranslation();
const open = ref(false);
</script>
