<template>
  <HelpCard id="help-viewed-title" :title="t(ranked ? 'help.home.mostViewed' : 'help.startHere')" inset class="viewed">
    <template #action><GButton tier="tertiary" compact :to="answersTo()">{{ t('help.home.allAnswers') }}</GButton></template>
    <ol class="viewed-list">
      <li v-for="(answer, index) in items" :key="answer.id">
        <router-link :to="answerDestination(answer)" class="viewed-row">
          <span class="g-num viewed-num">{{ index + 1 }}</span>
          <span class="viewed-copy">
            <span class="viewed-title" :lang="answer.locale || 'en-US'">{{ answer.title }}</span>
            <span class="t-caption">{{ t('help.topic.' + answer.topic) }}</span>
          </span>
        </router-link>
      </li>
    </ol>
    <p v-if="ranked" class="t-caption viewed-note">{{ t('help.home.mostViewedNote') }}</p>
  </HelpCard>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import type { HelpAnswer } from '../helpContent';
import { useHelpNavigation } from '../helpNavigation';
import HelpCard from './HelpCard.vue';

defineProps<{ items: HelpAnswer[]; ranked: boolean }>();
const { t } = useTranslation();
const { answersTo, answerDestination } = useHelpNavigation();
</script>

<style scoped>
.viewed { --card-pad-bottom: var(--g-s-4); }
.viewed-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.viewed-row {
  display: flex; align-items: flex-start; gap: 14px; padding: var(--g-s-3); border-radius: var(--g-r-control); text-decoration: none;
  transition: background-color var(--g-dur-fast) var(--g-ease);
}
.viewed-row:hover { background-color: rgba(255, 255, 255, 0.03); }
.viewed-num { flex: none; width: 20px; font-size: 13px; font-weight: 550; line-height: 20px; color: var(--g-text-3); }
.viewed-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.viewed-title { font-size: 14px; font-weight: 500; line-height: 20px; color: var(--g-text-1); }
.viewed-note { margin: auto var(--g-s-3) 0; padding-top: var(--g-s-3); border-top: 1px solid var(--g-hairline-1); }
@media (max-width: 640px) {
  /* A phone shows the first four rows only. */
  .viewed-list li:nth-child(n+5) { display: none; }
  .viewed-row { gap: var(--g-s-3); }
  .viewed-num { width: 16px; }
}
</style>
