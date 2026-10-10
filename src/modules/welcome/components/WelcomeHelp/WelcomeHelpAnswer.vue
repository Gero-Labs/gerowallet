<template>
  <div class="whelp-answer" :class="{ 'whelp-answer--phone': phone }" data-test="answer-view">
    <article class="whelp-answer__article" aria-labelledby="whelp-answer-title">
      <div class="whelp-answer__meta">
        <span v-if="setupOpen" class="t-label">{{ t('help.welcome.aboutStep') }}</span>
        <span class="whelp-chip">{{ t('help.topic.' + answer.topic) }}</span>
      </div>
      <!-- Bundled answers are written in English whatever the app language is. -->
      <h2 id="whelp-answer-title" ref="title" class="t-heading whelp-answer__title" tabindex="-1" lang="en">{{ answer.title }}</h2>
      <ol class="whelp-steps" lang="en" data-test="steps">
        <li v-for="(step, index) in steps" :key="index" class="whelp-step">
          <span class="whelp-step__number g-num" aria-hidden="true">{{ index + 1 }}</span>
          <p>{{ step }}</p>
        </li>
      </ol>
      <p v-if="setupOpen" class="t-caption whelp-answer__note" data-test="setup-caption">
        <v-icon size="14" color="currentColor">mdi-information-outline</v-icon>
        {{ t('help.welcome.setupCaption') }}
      </p>
    </article>

    <div class="whelp-feedback" data-test="feedback">
      <span class="whelp-feedback__question">{{ t('help.welcome.helpful') }}</span>
      <GButton tier="secondary" compact :aria-pressed="choice === 'yes' ? 'true' : 'false'" data-test="helpful-yes" @click="choose('yes')">{{ t('common.yes') }}</GButton>
      <GButton tier="secondary" compact :aria-pressed="choice === 'no' ? 'true' : 'false'" data-test="helpful-no" @click="choose('no')">{{ t('common.no') }}</GButton>
      <!-- Always mounted so the acknowledgement is announced when it appears. Only an anonymous count (answer id and Yes/No) is kept. -->
      <p class="whelp-feedback__status t-body-sm" :class="{ 'whelp-feedback__status--shown': choice }" role="status" data-test="feedback-status">{{ acknowledgement }}</p>
    </div>

    <section v-if="related.length" class="whelp-answer__related" aria-labelledby="whelp-related-title">
      <h3 id="whelp-related-title" class="t-label">{{ t(setupOpen ? 'help.welcome.moreStep' : 'help.welcome.related') }}</h3>
      <ul class="whelp-list">
        <WelcomeHelpRow v-for="item in related" :key="item.id" :answer="item" @open="$emit('open', $event)" />
      </ul>
    </section>

    <WelcomeHelpSupport :has-wallets="hasWallets" :compact="phone" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { trackHelp } from '@/modules/help/helpAnalytics';
import type { HelpAnswer } from '@/modules/help/helpContent';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import WelcomeHelpRow from './WelcomeHelpRow.vue';
import WelcomeHelpSupport from './WelcomeHelpSupport.vue';
import { answerSteps } from './welcomeHelpContent';

const props = defineProps<{
  answer: HelpAnswer;
  /** Other answers from the same state's lists. */
  related: HelpAnswer[];
  /** The Get Started step is open behind the panel. */
  setupOpen: boolean;
  hasWallets: boolean;
  phone?: boolean;
}>();
defineEmits<{ (e: 'open', answer: HelpAnswer): void }>();

const { t } = useTranslation();
const title = ref<HTMLElement | null>(null);
const choice = ref<'yes' | 'no' | null>(null);

const steps = computed(() => answerSteps(props.answer.body, props.setupOpen));
const acknowledgement = computed(() => choice.value === 'yes' ? t('help.welcome.thanksYes') : choice.value === 'no' ? t('help.welcome.thanksNo') : '');

function choose(value: 'yes' | 'no'): void {
  // The first answer on this view is the one counted; changing it afterwards only changes the highlight.
  if (!choice.value) trackHelp({ type: value === 'yes' ? 'article_helpful_yes' : 'article_helpful_no', subject: props.answer.id, surface: 'welcome', chain: 'all' });
  choice.value = value;
}

// Moving to a new view: put keyboard and screen-reader context on its heading.
onMounted(() => title.value?.focus({ preventScroll: true }));
</script>

<style scoped lang="scss">
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.whelp-answer {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.whelp-answer__article {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.whelp-answer__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-2);
}
/* Topic chip: a control-sized label, so a solid raised fill is the accepted exception to glass. */
.whelp-chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 var(--g-s-2);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-chip);
  background: var(--g-raised);
  color: var(--g-text-2);
  font-size: 12px;
  font-weight: 500;
}
.whelp-answer__title {
  margin: 0;
  line-height: 1.3;
}

.whelp-steps {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.whelp-step {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
}
/* Number badge: a small control-like marker, solid raised fill by the same exception. */
.whelp-step__number {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  color: var(--g-text-1);
  font-size: 12px;
  font-weight: 600;
}
.whelp-step p {
  margin: 2px 0 0;
  color: var(--g-text-1);
  font-size: 14px;
  line-height: 1.55;
}

.whelp-answer__note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
}

.whelp-feedback {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: var(--g-s-2);
  padding-top: 14px;
  border-top: 1px solid var(--g-hairline-1);
}
.whelp-feedback__question {
  margin-right: auto;
  color: var(--g-text-1);
  font-size: 13.5px;
  font-weight: 500;
}
.whelp-feedback .v-btn.g-btn.g-btn--secondary[aria-pressed='true'] {
  border-color: var(--g-accent);
}
.whelp-feedback__status {
  flex: 1 0 100%;
  margin: 0;
}
.whelp-feedback__status--shown { margin-top: 10px; }

.whelp-answer__related {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0 calc(-1 * var(--g-s-3));
}
.whelp-answer__related h3 {
  margin: 0;
  padding: 0 var(--g-s-3) 6px;
}
.whelp-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.whelp-answer--phone .v-btn.g-btn.g-btn--secondary:not(.v-btn--round) {
  height: 44px;
}
</style>
