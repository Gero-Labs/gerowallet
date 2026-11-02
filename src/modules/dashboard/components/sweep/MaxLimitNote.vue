<template>
  <!-- Recipients step, when Max cannot sweep (a hardware wallet, a remote-only policy, too
       many token holders): what Max sends and what stays behind for now. -->
  <section class="glass-tier max-limit-note" :aria-label="t('send.inputLimitMaxTitle', { amount })">
    <v-icon size="18" color="var(--g-info)" class="max-limit-note__icon" aria-hidden="true">mdi-information-outline</v-icon>
    <div class="max-limit-note__text">
      <p class="t-body-sm max-limit-note__title">{{ t('send.inputLimitMaxTitle', { amount }) }}</p>
      <p class="t-caption max-limit-note__body">{{ t('send.inputLimitMaxNote', { total, max, remaining }) }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';

defineProps<{
  /** What Max put on the recipient, formatted with its currency symbol. */
  amount: string;
  /** UTxOs the wallet holds. */
  total: number;
  /** UTxOs one transaction carries. */
  max: number;
  /** UTxOs that stay in the wallet this time. */
  remaining: number;
}>();

const { t } = useTranslation();
</script>

<style scoped>
.max-limit-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: var(--g-s-3) 14px;
  margin-top: var(--g-s-2);
  text-align: left;
}

.max-limit-note__icon {
  flex: none;
  margin-top: 1px;
}

.max-limit-note__text {
  min-width: 0;
}

.max-limit-note__title {
  margin: 0;
  color: var(--g-text-1);
  font-weight: 550;
}

.max-limit-note__body {
  margin: var(--g-s-1) 0 0;
  line-height: 1.5;
  color: var(--g-text-2);
}
</style>
