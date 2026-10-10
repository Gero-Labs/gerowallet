<template>
  <li>
    <button type="button" class="whelp-row" :data-answer-id="answer.id" @click="$emit('open', answer)">
      <span class="whelp-row__copy">
        <!-- Bundled answers are written in English whatever the app language is. -->
        <span class="whelp-row__title" lang="en">{{ answer.title }}</span>
        <span class="t-caption">{{ t('help.topic.' + answer.topic) }}</span>
      </span>
      <v-icon size="16" color="var(--g-text-3)">mdi-chevron-right</v-icon>
    </button>
  </li>
</template>

<script setup lang="ts">
import type { HelpAnswer } from '@/modules/help/helpContent';
import { useTranslation } from '@/shared/composables/useTranslation';

defineProps<{ answer: HelpAnswer }>();
defineEmits<{ (e: 'open', answer: HelpAnswer): void }>();

const { t } = useTranslation();
</script>

<style scoped>
.whelp-row {
  /* The phone sheet sets --whelp-row-min-h / --whelp-row-pad-y for its 52px rows. */
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  width: 100%;
  min-height: var(--whelp-row-min-h, 0);
  box-sizing: border-box;
  padding: var(--whelp-row-pad-y, 10px) var(--g-s-3);
  border: 0;
  border-radius: var(--g-r-control);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease);
}
.whelp-row:hover { background-color: rgba(255, 255, 255, 0.04); }

.whelp-row__copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.whelp-row__title {
  color: var(--g-text-1);
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}
</style>
