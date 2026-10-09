<template>
  <HelpCard id="help-tutorial-title" :title="t('help.home.latestTutorial')" class="tutorial">
    <template #action><GButton tier="tertiary" compact :to="answersTo()" @click="home('all_tutorials')">{{ t('help.home.allTutorials') }}</GButton></template>
    <template v-if="tutorial">
      <HelpSceneFrame scene="helpTutorial" :scale="62" />
      <div v-if="tutorial.remote" class="tutorial-chips">
        <HelpChip strong>{{ t(kindLabelKey(tutorial.answer)) }}</HelpChip>
        <HelpChip>{{ t('help.topic.' + tutorial.answer.topic) }}</HelpChip>
      </div>
      <h3 class="t-heading tutorial-title" :lang="tutorial.answer.locale || 'en-US'">
        <router-link :to="answerDestination(tutorial.answer)" class="tutorial-link" @click.native="home('latest_tutorial')">{{ tutorial.answer.title }}</router-link>
      </h3>
      <p class="t-body tutorial-text" :lang="tutorial.answer.locale || 'en-US'">{{ tutorial.answer.body }}</p>
      <p v-if="verified" class="t-caption g-num tutorial-foot">{{ verified }}</p>
    </template>
  </HelpCard>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import i18n from '@/plugins/i18n';
import { helpLocale } from '@/api/help.api';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import { kindLabelKey } from '../helpContent';
import { formatHelpDate } from '../helpFormat';
import type { LatestTutorial } from '../helpHome';
import { useHelpNavigation } from '../helpNavigation';
import { useHelpTracking } from '../useHelpTracking';
import HelpChip from '../HelpChip.vue';
import HelpCard from './HelpCard.vue';
import HelpSceneFrame from './HelpSceneFrame.vue';

const props = defineProps<{ tutorial: LatestTutorial | null }>();
const { t } = useTranslation();
const { answersTo, answerDestination } = useHelpNavigation();
const { home } = useHelpTracking();
// The checked-for caption claims a verification, so it needs a published article that carries one.
const verified = computed(() => {
  const answer = props.tutorial?.answer;
  const date = formatHelpDate(answer?.lastVerifiedAt, helpLocale(i18n.locale));
  return props.tutorial?.remote && answer?.testedWalletVersion && date ? t('help.verifiedVersion', { version: answer.testedWalletVersion, date }) : '';
});
</script>

<style scoped>
.tutorial-chips { display: flex; flex-wrap: wrap; gap: 6px; padding-top: var(--g-s-1); }
.tutorial-title { margin: 0; font-size: 18px; line-height: 1.35; }
.tutorial-link { color: var(--g-text-1); text-decoration: none; }
.tutorial-link:hover { color: var(--g-text-1); text-decoration: underline; text-underline-offset: 3px; }
.tutorial-text { margin: 0; line-height: 1.55; }
.tutorial-foot { margin: auto 0 0; padding-top: var(--g-s-1); }
@media (max-width: 640px) {
  .tutorial-title { margin-top: var(--g-s-1); }
  .tutorial-text { font-size: 13px; }
}
</style>
