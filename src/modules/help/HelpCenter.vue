<template>
  <main class="help-center" :class="'help-center--' + layout">
    <HelpHomeDashboard
      v-if="view === 'home'" :topics="index" :viewed="viewed" :tutorial="tutorial" :basic="basicCatalog"
      :loading="loading" :failed="failed" :stale="stale" :has-remote="!!remoteArticle" @retry="retry()"
    />

    <HelpReader
      v-else-if="view === 'article'" :article="article" :response="remoteArticle" :html="articleHtml" :related="related"
      :applicable="articleApplies" :basic="basicCatalog" :loading="loading" :failed="failed" :stale="stale" @retry="retry()"
    />

    <HelpUpdates v-else-if="view === 'updates'" :chain="chain" />

    <template v-else>
      <header class="results-head"><h1 class="t-title">{{ heading }}</h1></header>
      <div class="results-tools">
        <HelpSearchForm variant="compact" input-id="help-query" />
        <HelpChainPills />
      </div>
      <HelpContentStatus :loading="loading" :failed="failed" :stale="stale" :has-remote="!!remoteArticle" @retry="retry()" />

      <section v-if="view === 'topic' && selectedTopic && selectedTopic.demoted" class="help-applicability glass-panel">
        <p class="t-label">{{ t('help.' + selectedTopic.reason) }}</p>
        <h2 class="t-heading">{{ t('help.applicabilityTitle') }}</h2>
        <p>{{ t('help.applicabilityBody') }}</p>
        <GButton compact @click="selectChain('all')">{{ t('help.allChains') }}</GButton>
      </section>

      <section class="glass-panel results" aria-labelledby="help-results-count">
        <p id="help-results-count" class="t-label results-count">{{ remoteResultsActive ? t('help.matchCount', { count: remoteTotal, shown: filteredRemoteResults.length }) : tc('help.count', results.length, { count: results.length }) }}</p>
        <template v-if="remoteResultsActive">
          <router-link v-for="answer in filteredRemoteResults" :key="answer.source + ':' + answer.id" :to="remoteDestination(answer)" class="result-row">
            <span class="t-caption">{{ t(answer.source === 'gero-blog' ? 'help.blog' : 'help.topic.' + answer.topic) }}</span>
            <strong class="result-title" :lang="answer.locale">{{ answer.title }}</strong>
            <span v-if="answer.snippet || answer.summary" class="t-body-sm" :lang="answer.locale">{{ answer.snippet || answer.summary }}</span>
            <span v-if="answer.isLocaleFallback" class="t-caption">{{ t('help.englishFallback') }}</span>
          </router-link>
          <GButton v-if="nextCursor" class="results-more" :disabled="loading" @click="loadMore()">{{ t('help.loadMore') }}</GButton>
        </template>
        <template v-else>
          <router-link v-for="answer in results" :key="answer.id" :to="answerDestination(answer)" class="result-row">
            <span class="t-caption">{{ t('help.topic.' + answer.topic) }}</span>
            <strong class="result-title" lang="en">{{ answer.title }}</strong>
            <span class="t-body-sm" lang="en">{{ answer.body }}</span>
          </router-link>
        </template>
        <div v-if="!loading && !(remoteResultsActive ? filteredRemoteResults.length : results.length)" class="help-empty" role="status"><h2 class="t-heading">{{ t('help.noResults') }}</h2><p>{{ t('help.noResultsBody') }}</p><GButton @click="selectChain('all')">{{ t('help.allChains') }}</GButton></div>
      </section>

      <aside class="help-support-stamp">
        <span class="t-label">{{ t('help.supportLabel') }}</span>
        <div><h2 class="t-heading">{{ t('help.stillNeedHelp') }}</h2><p class="t-body-sm">{{ t('help.supportSummary') }}</p></div>
        <GButton @click="openSupport()">{{ t('help.contact') }}</GButton>
      </aside>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import i18n from '@/plugins/i18n';
import { helpLocale, type HelpResult } from '@/api/help.api';
import { useRoute, useRouter } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import networks from '@/utils/networks';
import { isHelpReady } from '@/modules/navigation/helpAccess';
import HelpChainPills from './HelpChainPills.vue';
import HelpContentStatus from './HelpContentStatus.vue';
import HelpReader from './HelpReader.vue';
import HelpSearchForm from './HelpSearchForm.vue';
import HelpUpdates from './HelpUpdates.vue';
import HelpHomeDashboard from './home/HelpHomeDashboard.vue';
import { answers, applies, asAnswer, featuredAnswers, parseHelpChain, searchAnswers, topicIndex, walletHelpChain } from './helpContent';
import { latestTutorial, mostViewed } from './helpHome';
import { useHelpNavigation } from './helpNavigation';
import { helpSearchIntent } from './helpSearchIntent';
import { openSupport } from './supportIntent';
import { useHelpContent } from './useHelpContent';
import { useHelpTracking } from './useHelpTracking';
import { renderHelpArticle } from './helpRichText';

const { t, tc } = useTranslation();
const route = useRoute();
const router = useRouter();
const { chain, destination, answerDestination, selectChain } = useHelpNavigation();
const { track } = useHelpTracking();
const view = computed(() => route.path.startsWith('/help/articles/') ? 'article' : route.path.startsWith('/help/topics/') ? 'topic' : route.path === '/help/search' ? 'search' : route.path === '/help/updates' ? 'updates' : 'home');
// Home is a dashboard; the reader and updates pages share a tighter top gutter, and results follow them.
const layout = computed(() => view.value === 'home' ? 'home' : view.value === 'article' ? 'reader' : view.value === 'updates' ? 'updates' : 'results');
const request = computed(() => ({ view: view.value, locale: helpLocale(i18n.locale), chain: chain.value,
  topic: route.params.topic || '', slug: route.params.slug || '', q: typeof route.query.q === 'string' ? route.query.q : '', basic: route.query.basic === '1' }));
const { home: remoteHome, article: remoteArticle, results: remoteResults, total: remoteTotal, nextCursor, loading, failed, resolved, stale, loadMore, retry } = useHelpContent(request);
const remoteCatalog = computed(() => remoteHome.value?.topics.flatMap(topic => topic.articles.map(asAnswer)) ?? []);
const basicCatalog = computed(() => request.value.basic || remoteCatalog.value.length === 0);
const catalog = computed(() => basicCatalog.value ? answers : remoteCatalog.value);
// Record the initial wallet default in the URL before an in-place lock can
// remove wallet context. Explicit selections always win after unlock.
watch(() => route.fullPath, () => {
  if (!parseHelpChain(route.query.chain) && isHelpReady(walletStore)) {
    void router.replace({ path: route.path, query: { ...route.query, chain: chain.value } }).catch(() => {});
  }
}, { immediate: true });
const context = computed(() => ({
  chain: chain.value,
  features: featureFlagsStore.state.isInitialized ? {
    isGeroCardEnabled: featureFlagsStore.isGeroCardEnabled(),
    isRealFiEnabled: featureFlagsStore.isRealFiEnabled(),
    isBitcoinEnabled: featureFlagsStore.isBitcoinEnabled(),
  } : {},
  cardSupported: isHelpReady(walletStore) && walletHelpChain(walletStore.loggedWallet?.chain) === chain.value
    ? !!networks.resolveGeroCardSupport(walletStore.loggedWallet.chain, walletStore.loggedWallet.network) : undefined,
  network: isHelpReady(walletStore) && walletHelpChain(walletStore.loggedWallet?.chain) === chain.value ? walletStore.loggedWallet?.network : undefined,
  walletType: isHelpReady(walletStore) && walletHelpChain(walletStore.loggedWallet?.chain) === chain.value ? walletStore.loggedWallet?.type : undefined,
}));
const index = computed(() => topicIndex(context.value, catalog.value));
const selectedTopic = computed(() => index.value.find(topic => topic.id === route.params.topic));
const article = computed(() => remoteArticle.value ? asAnswer(remoteArticle.value.article) : request.value.basic || failed.value || !resolved.value
  ? answers.find(answer => answer.id === route.params.slug) : undefined);
const articleHtml = computed(() => remoteArticle.value ? renderHelpArticle(remoteArticle.value.article, import.meta.env['VITE_BACKEND_URL']) : '');
const articleApplies = computed(() => !!article.value && applies(article.value, context.value));
const featured = computed(() => (basicCatalog.value ? featuredAnswers(chain.value)
  : (chain.value === 'all' ? remoteHome.value?.publicFeaturedArticles : remoteHome.value?.walletFeaturedArticles[chain.value])?.map(asAnswer) ?? []).filter(answer => applies(answer, context.value)));
const viewed = computed(() => mostViewed({ home: remoteHome.value, basic: basicCatalog.value, featured: featured.value, catalog: catalog.value, context: context.value }));
const tutorial = computed(() => latestTutorial({ home: remoteHome.value, basic: basicCatalog.value, context: context.value }));
const related = computed(() => catalog.value.filter(answer => answer.id !== article.value?.id && applies(answer, context.value)
  && (remoteArticle.value ? remoteArticle.value.article.relatedArticleIds.includes(answer.id) : answer.topic === article.value?.topic)).slice(0, 3));
const remoteResultsActive = computed(() => resolved.value && !request.value.basic);
const filteredRemoteResults = computed(() => remoteResults.value.filter(answer => applies(asAnswer(answer), context.value)));
const heading = computed(() => selectedTopic.value ? t('help.topic.' + selectedTopic.value.id) : t('help.answers'));
const results = computed(() => searchAnswers(view.value === 'search' && typeof route.query.q === 'string' ? route.query.q : '', context.value, route.params.topic));
// A submitted search is counted once its outcome is known: the published results, or the bundled ones when
// the service is unreachable. Only "results" or "empty" is recorded, never the words that were typed.
const searchOutcome = computed<'results' | 'empty' | null>(() => {
  const submitted = helpSearchIntent.pending;
  if (submitted === null || view.value !== 'search' || request.value.q !== submitted) return null;
  if (loading.value || !(request.value.basic || resolved.value || failed.value)) return null;
  return (remoteResultsActive.value ? filteredRemoteResults.value.length : results.value.length) > 0 ? 'results' : 'empty';
});
watch(searchOutcome, outcome => {
  if (!outcome) return;
  helpSearchIntent.pending = null;
  track({ type: 'search', subject: outcome });
}, { immediate: true });
onBeforeUnmount(() => { helpSearchIntent.pending = null; });
function remoteDestination(answer: HelpResult) {
  const type = answer.destination?.type ?? (answer.source === 'gero-blog' ? 'blog' : 'help-article');
  return destination((type === 'blog' ? '/blog/' : '/help/articles/') + encodeURIComponent(answer.destination?.slug || answer.slug), { basic: '' });
}
</script>

<style scoped>
.help-center { display: flex; flex-direction: column; gap: var(--g-s-5); box-sizing: border-box; max-width: var(--g-content-max); margin: 0 auto; padding: var(--g-s-5) var(--g-s-6) 56px; color: var(--g-text-1); }
.help-center--home { display: block; padding-top: var(--g-s-6); }
.help-center--updates { gap: 0; }

/* Search and topic results are not drawn: they reuse the Most viewed row language inside one glass panel. */
.results-head h1 { margin: 0; }
.results-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--g-s-3) var(--g-s-5); }
.results { display: flex; flex-direction: column; padding: var(--g-s-3); }
.results-count { margin: 0; padding: var(--g-s-3) var(--g-s-3) var(--g-s-2); }
.result-row {
  display: flex; flex-direction: column; gap: 2px; padding: var(--g-s-3); border-radius: var(--g-r-control); color: var(--g-text-1); text-decoration: none;
  transition: background-color var(--g-dur-fast) var(--g-ease);
}
.result-row:hover { background-color: rgba(255, 255, 255, 0.03); }
.result-title { font-size: 14px; font-weight: 500; line-height: 20px; }
.results-more { align-self: center; margin: var(--g-s-3) 0; }
.help-empty { padding: var(--g-s-5) var(--g-s-3); }
.help-empty h2 { margin: 0 0 var(--g-s-2); }
.help-empty p { margin: 0 0 var(--g-s-4); color: var(--g-text-2); }
.help-applicability { padding: var(--g-s-5); }
.help-applicability h2, .help-applicability p { margin-bottom: var(--g-s-3); }
.help-applicability p { color: var(--g-text-2); }

.help-support-stamp { display: flex; align-items: center; flex-wrap: wrap; gap: var(--g-s-4); border: 1px solid var(--g-hairline-3); border-radius: var(--g-r-card); padding: var(--g-s-4) var(--g-s-5); }
.help-support-stamp > .t-label { color: var(--g-accent); }
.help-support-stamp > div { flex: 1; min-width: 200px; }
.help-support-stamp h2 { margin: 0; }
.help-support-stamp p { margin: var(--g-s-1) 0 0; color: var(--g-text-2); }

@media (max-width: 640px) {
  .help-center { padding: 20px var(--g-s-4) 40px; }
}
</style>
