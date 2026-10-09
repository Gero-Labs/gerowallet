<template>
  <div class="reader">
    <div class="reader-top">
      <nav :aria-label="t('help.reader.breadcrumb')">
        <ol class="crumbs">
          <li><router-link :to="answersTo()" class="crumb">{{ t('help.answers') }}</router-link></li>
          <template v-if="article">
            <li class="crumb-sep" aria-hidden="true">/</li>
            <li><router-link :to="destination('/help/topics/' + article.topic, basic ? { basic: '1' } : {})" class="crumb">{{ t('help.topic.' + article.topic) }}</router-link></li>
            <li class="crumb-sep" aria-hidden="true">/</li>
            <li class="crumb-current" aria-current="page" :lang="article.locale || 'en-US'">{{ article.title }}</li>
          </template>
        </ol>
      </nav>
      <HelpSearchForm variant="compact" input-id="help-reader-search" />
    </div>

    <HelpContentStatus :loading="loading" :failed="failed" :stale="stale" :has-remote="!!response" @retry="$emit('retry')" />

    <div v-if="article" class="reader-body">
      <article class="article">
        <header class="article-head">
          <div class="article-head__copy">
            <div class="article-chips">
              <HelpChip strong>{{ t(kindLabelKey(article)) }}</HelpChip>
              <HelpChip>{{ t('help.topic.' + article.topic) }}</HelpChip>
            </div>
            <h1 class="t-display article-title" :lang="article.locale || 'en-US'">{{ article.title }}</h1>
            <p v-if="response" class="t-body-lg article-summary" :lang="article.locale">{{ response.article.summary }}</p>
            <p v-if="verified" class="t-caption g-num article-verified">{{ verified }}</p>
            <p v-if="response?.isLocaleFallback" class="t-body-sm article-note">{{ t('help.englishFallback') }}</p>
          </div>
          <IsoScene :name="scene" class="article-scene" />
        </header>

        <p v-if="!applicable" class="article-note">{{ t('help.applicabilityBody') }} <button type="button" class="article-note__action" @click="selectChain('all')">{{ t('help.allChains') }}</button></p>

        <!-- The dedicated renderer escapes text and permits only mirrored images and safe links; ids are added to its output in an inert document. -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="response" class="g-prose article-body" :lang="article.locale" v-html="rendered.html"></div>
        <div v-else class="g-prose article-body"><p lang="en">{{ article.body }}</p></div>

        <div class="helpful">
          <span class="helpful-label">{{ t('help.reader.helpful') }}</span>
          <template v-if="!helpful">
            <GButton tier="secondary" compact @click="helpful = 'yes'">{{ t('common.yes') }}</GButton>
            <GButton tier="secondary" compact @click="helpful = 'no'">{{ t('common.no') }}</GButton>
          </template>
          <!-- Nothing is sent anywhere: this only acknowledges the click. -->
          <p class="helpful-result" role="status">{{ helpful ? t(helpful === 'yes' ? 'help.reader.helpfulYes' : 'help.reader.helpfulNo') : '' }}</p>
        </div>

        <section class="glass-panel end-support" aria-labelledby="help-reader-support-title">
          <IsoScene name="helpSupport" class="end-support__scene" />
          <div class="end-support__copy">
            <h2 id="help-reader-support-title" class="t-heading">{{ t('help.stillNeedHelp') }}</h2>
            <p class="t-body-sm">{{ t('help.supportSummary') }}</p>
          </div>
          <GButton tier="primary" @click="openSupport(article.id)">{{ t('help.aboutGuide') }}</GButton>
        </section>

        <section v-if="related.length" class="related" aria-labelledby="help-reader-related-title">
          <h2 id="help-reader-related-title" class="t-label">{{ t('help.related') }}</h2>
          <div class="related-grid">
            <router-link v-for="answer in related" :key="answer.id" :to="answerDestination(answer)" class="glass-tier related-tile">
              <span class="related-copy">
                <span class="related-title" :lang="answer.locale || 'en-US'">{{ answer.title }}</span>
                <span class="t-caption">{{ t('help.topic.' + answer.topic) }} · {{ t(kindLabelKey(answer)) }}</span>
              </span>
              <v-icon :size="18" color="var(--g-text-3)">mdi-arrow-right</v-icon>
            </router-link>
          </div>
        </section>
      </article>

      <aside class="glass-panel rail" :aria-label="t('help.reader.aboutGuide')">
        <nav v-if="rendered.headings.length >= 2" class="toc" aria-labelledby="help-reader-toc-title">
          <h2 id="help-reader-toc-title" class="t-label">{{ t('help.reader.onThisPage') }}</h2>
          <button
            v-for="heading in rendered.headings" :key="heading.id" type="button" class="toc-link"
            :aria-current="currentHeading === heading.id ? 'location' : undefined" @click="goTo(heading.id)"
          >{{ heading.text }}</button>
        </nav>
        <div v-if="rendered.headings.length >= 2" class="rail-rule"></div>
        <dl class="facts">
          <div class="fact">
            <dt class="t-label">{{ t('help.reader.appliesTo') }}</dt>
            <dd class="fact-value">{{ appliesTo }}</dd>
          </div>
          <div v-if="checkedVersion" class="fact">
            <dt class="t-label">{{ t('help.reader.checkedFor') }}</dt>
            <dd class="fact-value g-num">Gero {{ checkedVersion }}</dd>
            <dd v-if="checkedDate" class="t-caption g-num fact-date">{{ checkedDate }}</dd>
          </div>
        </dl>
      </aside>
    </div>
    <p v-else-if="!loading" role="status">{{ t('help.notFound') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import i18n from '@/plugins/i18n';
import { helpLocale, type HelpArticleResponse } from '@/api/help.api';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import { kindLabelKey, topics, type HelpAnswer } from './helpContent';
import { formatHelpDate } from './helpFormat';
import { useHelpNavigation } from './helpNavigation';
import { addHeadingIds } from './helpToc';
import { openSupport } from './supportIntent';
import HelpChip from './HelpChip.vue';
import HelpContentStatus from './HelpContentStatus.vue';
import HelpSearchForm from './HelpSearchForm.vue';

const props = defineProps<{
  article: HelpAnswer | undefined; response: HelpArticleResponse | null; html: string; related: HelpAnswer[];
  applicable: boolean; basic: boolean; loading: boolean; failed: boolean; stale: boolean;
}>();
defineEmits<{ (e: 'retry'): void }>();
const { t } = useTranslation();
const { answersTo, destination, answerDestination, selectChain } = useHelpNavigation();

const scene = computed(() => topics.find(topic => topic.id === props.article?.topic)?.scene ?? 'register');
const rendered = computed(() => addHeadingIds(props.html));
const checkedVersion = computed(() => props.response?.article.applicability.testedWalletVersion ?? '');
const checkedDate = computed(() => formatHelpDate(props.response?.article.lastVerifiedAt, helpLocale(i18n.locale)));
// The caption claims a verification, so it needs both the version and the date.
const verified = computed(() => checkedVersion.value && checkedDate.value ? t('help.verifiedVersion', { version: checkedVersion.value, date: checkedDate.value }) : '');
const chainNames: Record<string, string> = { cardano: 'Cardano', midnight: 'Midnight', bitcoin: 'Bitcoin' };
const appliesTo = computed(() => {
  const chains = props.article?.chains ?? [];
  return chains.length ? chains.map(chain => chainNames[chain] ?? chain).join(', ') : t('help.reader.allWallets');
});

const helpful = ref<'yes' | 'no' | null>(null);
watch(() => props.article?.id, () => { helpful.value = null; });

const currentHeading = ref('');
watch(() => rendered.value.headings, headings => { currentHeading.value = headings[0]?.id ?? ''; }, { immediate: true });
function goTo(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  currentHeading.value = id;
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  // Keyboard and screen-reader users land on the heading, not just near it.
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}
</script>

<style lang="scss" scoped>
$warning-icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3l9.5 17h-19z'/%3E%3Cpath d='M12 10v4M12 17.5v.01'/%3E%3C/svg%3E";

.reader { display: flex; flex-direction: column; gap: var(--g-s-5); }
.reader-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--g-s-3) var(--g-s-5); }
.crumbs { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--g-s-2); font-size: 13px; }
.crumb { color: var(--g-text-2); text-decoration: none; }
.crumb:hover { color: var(--g-text-1); text-decoration: underline; text-underline-offset: 3px; }
.crumb-sep { color: var(--g-text-3); }
.crumb-current { color: var(--g-text-1); font-weight: 500; }

.reader-body { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--g-s-6); }
.article { flex: 999 1 560px; min-width: 0; max-width: 760px; display: flex; flex-direction: column; gap: var(--g-s-5); }
.article-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--g-s-4) var(--g-s-5); }
.article-head__copy { flex: 1 1 360px; min-width: 0; display: flex; flex-direction: column; gap: var(--g-s-3); }
.article-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.article-title { margin: 0; line-height: 1.15; }
.article-summary { margin: 0; color: var(--g-text-2); font-weight: 400; line-height: 1.5; }
.article-verified { margin: 0; }
.article-note { margin: 0; color: var(--g-text-2); font-size: 13px; }
.article-note__action { color: var(--g-accent); text-decoration: underline; text-underline-offset: 2px; }
.article-scene { flex: none; width: 176px; max-width: 40%; height: auto; display: block; }

/* Rendered article HTML: section headings, prose, numbered steps as glass rows, blockquote as a warning callout. */
.article-body { max-width: none; }
.article-body :deep(h2) { margin: var(--g-s-5) 0 10px; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.3; color: var(--g-text-1); }
.article-body :deep(h3) { margin: var(--g-s-4) 0 var(--g-s-2); font-size: 16px; font-weight: 600; color: var(--g-text-1); }
.article-body :deep(h2:first-child), .article-body :deep(h3:first-child) { margin-top: 0; }
.article-body :deep(p), .article-body :deep(ul) { max-width: 72ch; }
.article-body :deep(img) { max-width: 100%; height: auto; border-radius: var(--g-r-control); border: 1px solid var(--g-hairline-1); box-sizing: border-box; }
.article-body :deep(ol) { list-style: none; counter-reset: step; display: flex; flex-direction: column; gap: var(--g-s-2); margin: 0 0 var(--g-s-3); padding: 0; }
.article-body :deep(ol > li) {
  @include g-glass-tier;
  counter-increment: step; display: flex; align-items: flex-start; gap: 14px; margin: 0; padding: 14px var(--g-s-4); color: var(--g-text-1);
}
/* The step number is an avatar-style badge, so it keeps the accepted solid fill (--g-raised). */
.article-body :deep(ol > li)::before {
  content: counter(step); flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: var(--g-r-pill); background: var(--g-raised); border: 1px solid var(--g-hairline-2);
  font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--g-text-1);
}
.article-body :deep(ol > li > p) { margin: 3px 0 0; max-width: none; font-size: 14px; line-height: 1.6; color: var(--g-text-1); }
.article-body :deep(blockquote) {
  display: grid; grid-template-columns: 20px minmax(0, 1fr); column-gap: var(--g-s-3); align-items: start;
  margin: 0 0 var(--g-s-3); padding: 14px var(--g-s-4); border-radius: var(--g-r-card);
  background: var(--g-warning-fill); border: 1px solid var(--g-warning-line);
  font-size: 14px; font-weight: 550; line-height: 1.5; color: var(--g-text-1);
}
.article-body :deep(blockquote > *) { grid-column: 2; margin: 0; max-width: none; color: inherit; }
.article-body :deep(blockquote)::before {
  content: ''; grid-column: 1; grid-row: 1; width: 20px; height: 20px; margin-top: 1px; background-color: var(--g-warning);
  -webkit-mask: url("#{$warning-icon}") center / contain no-repeat;
  mask: url("#{$warning-icon}") center / contain no-repeat;
}

.helpful { display: flex; flex-wrap: wrap; align-items: center; gap: var(--g-s-3); padding-top: 20px; border-top: 1px solid var(--g-hairline-1); }
.helpful-label { margin-right: auto; font-size: 14px; font-weight: 500; color: var(--g-text-1); }
.helpful-result { margin: 0; font-size: 14px; color: var(--g-text-2); }
.helpful-result:empty { display: none; }

.end-support { display: flex; flex-wrap: wrap; align-items: center; gap: var(--g-s-4); padding: 20px var(--g-s-5); }
.end-support__scene { flex: none; width: 132px; height: auto; margin: calc(-1 * var(--g-s-2)) 0; }
.end-support__copy { flex: 1 1 280px; min-width: 0; display: flex; flex-direction: column; gap: var(--g-s-1); }
.end-support__copy h2 { margin: 0; font-size: 18px; }
.end-support__copy p { margin: 0; line-height: 1.5; }

.related { display: flex; flex-direction: column; gap: var(--g-s-3); }
.related h2 { margin: 0; }
.related-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--g-s-3); }
.related-tile {
  display: flex; align-items: center; gap: var(--g-s-3); padding: 14px var(--g-s-4); text-decoration: none;
  transition: border-color var(--g-dur-fast) var(--g-ease), background-color var(--g-dur-fast) var(--g-ease);
  &:hover { @include g-glass-tier-hover; }
}
.related-copy { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.related-title { font-size: 14px; font-weight: 550; color: var(--g-text-1); }

.rail { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 20px; padding: 20px; }
.toc { display: flex; flex-direction: column; gap: 6px; }
.toc h2 { margin: 0 0 var(--g-s-1); }
.toc-link {
  display: flex; align-items: center; min-height: 32px; padding: 0; text-align: left;
  background: none; border: 0; cursor: pointer; font: inherit; font-size: 13.5px; color: var(--g-text-2);
  transition: color var(--g-dur-fast) var(--g-ease);
}
.toc-link:hover { color: var(--g-text-1); }
.toc-link[aria-current="location"] { font-weight: 550; color: var(--g-text-1); }
.rail-rule { height: 1px; background: var(--g-hairline-1); }
.facts { margin: 0; display: flex; flex-direction: column; gap: 14px; }
.fact { display: flex; flex-direction: column; gap: var(--g-s-1); }
.fact dt { margin: 0; }
.fact-value, .fact-date { margin: 0; }
.fact-value { font-size: 13.5px; color: var(--g-text-1); }

@media (max-width: 640px) {
  .article-head__copy { flex-basis: 100%; }
}
</style>
