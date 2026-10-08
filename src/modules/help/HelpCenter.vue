<template>
  <main class="help-center">
    <nav class="help-tabs" :aria-label="t('help.title')">
      <router-link :to="destination('/help')" :aria-current="view === 'home' ? 'page' : undefined">{{ t('help.overview') }}</router-link>
      <router-link :to="destination('/help/search', { basic: '' })" :aria-current="view === 'search' || view === 'topic' ? 'page' : undefined">{{ t('help.answers') }}</router-link>
      <router-link :to="destination('/help/updates')" :aria-current="view === 'updates' ? 'page' : undefined">{{ t('help.updates') }}</router-link>
      <button type="button" @click="openSupport()">{{ t('help.contact') }}</button>
    </nav>

    <section v-if="view === 'home'" class="help-hero">
      <div>
        <p class="t-label help-kicker">{{ t('help.manual') }}</p>
        <h1>{{ t('help.hero') }}</h1>
        <p class="t-body-lg help-lede">{{ t('help.subtitle') }}</p>
      </div>
      <IsoScene name="helpHero" class="help-hero-scene" animated />
    </section>
    <div v-else class="help-page-heading">
      <router-link :to="destination('/help')" class="t-label">{{ t('help.back') }}</router-link>
      <h1 v-if="view !== 'article'">{{ heading }}</h1>
    </div>

    <div class="help-tools">
      <form class="help-search" role="search" @submit.prevent="search">
        <label class="sr-only" for="help-query">{{ t('help.search') }}</label>
        <input id="help-query" v-model="query" type="search" :placeholder="t('help.search')" autocomplete="off" />
        <button type="submit" :aria-label="t('help.search')"><v-icon color="var(--g-accent)">mdi-arrow-right</v-icon></button>
      </form>
      <label class="help-chain t-label">{{ t('help.chain') }}
        <select :value="chain" @change="selectChain($event.target.value)">
          <option value="all">{{ t('help.allChains') }}</option>
          <option value="cardano">Cardano</option><option value="midnight">Midnight</option><option value="bitcoin">Bitcoin</option>
        </select>
      </label>
    </div>

    <p v-if="loading" class="help-content-status t-body-sm" role="status">{{ t('help.loadingContent') }}</p>
    <p v-else-if="failed" class="help-content-status t-body-sm" role="status">{{ t(remoteArticle ? 'help.staleContent' : 'help.basicFallback') }} <button type="button" @click="retry()">{{ t('help.retryContent') }}</button></p>
    <p v-else-if="stale" class="help-content-status t-body-sm" role="status">{{ t('help.staleContent') }}</p>

    <template v-if="view === 'home'">
      <div class="help-section-label"><span class="t-label">01 / {{ t('help.topics') }}</span><span class="t-label">06</span></div>
      <div class="help-index">
        <router-link v-for="topic in index" :key="topic.id" :to="destination('/help/topics/' + topic.id, basicCatalog ? { basic: '1' } : {})" class="help-topic" :class="{ 'help-topic--muted': topic.demoted }">
          <span class="help-number">{{ String(topic.index).padStart(2, '0') }}</span>
          <div><h2 class="t-heading">{{ t('help.topic.' + topic.id) }}</h2><p class="t-body-sm">{{ t('help.description.' + topic.id) }}</p><span class="t-label">{{ topic.demoted ? t('help.' + topic.reason) : t('help.count', { count: topic.count }) }}</span></div>
          <IsoScene :name="topic.scene" class="help-topic-scene" />
        </router-link>
      </div>
      <div class="help-section-label"><span class="t-label">02 / {{ t('help.startHere') }}</span></div>
      <div class="help-ledger">
        <router-link v-for="answer in featured" :key="answer.id" :to="answerDestination(answer)" class="help-answer-row">
          <span class="t-label">{{ t(answer.remote ? 'help.guide' : 'help.quickAnswer') }}</span><strong :lang="answer.locale || 'en-US'">{{ answer.title }}</strong><span class="t-label">{{ answer.locale || 'en-US' }} ↗</span>
        </router-link>
      </div>
      <template v-if="remoteHome?.updatePreviews?.length">
        <div class="help-section-label"><span class="t-label">03 / {{ t('help.latestUpdates') }}</span></div>
        <router-link v-for="update in remoteHome.updatePreviews" :key="update.id" :to="destination('/help/updates', { source: update.source })" class="help-answer-row">
          <span class="t-label">{{ t('help.updateSource.' + update.source) }}</span><strong :lang="update.locale">{{ update.title }}</strong><span aria-hidden="true">↗</span>
        </router-link>
      </template>
    </template>

    <section v-else-if="view === 'topic' && selectedTopic && selectedTopic.demoted" class="help-applicability glass-panel">
      <p class="t-label">{{ t('help.' + selectedTopic.reason) }}</p>
      <h2 class="t-heading">{{ t('help.applicabilityTitle') }}</h2>
      <p>{{ t('help.applicabilityBody') }}</p>
      <GButton compact @click="selectChain('all')">{{ t('help.allChains') }}</GButton>
    </section>

    <section v-else-if="view === 'article'" class="help-reader">
      <template v-if="article">
        <div class="help-section-label"><span class="t-label">{{ t(remoteArticle ? 'help.guide' : 'help.quickAnswer') }} / {{ article.locale || 'en-US' }}</span></div>
        <h1 :lang="article.locale || 'en-US'">{{ article.title }}</h1>
        <p v-if="remoteArticle?.isLocaleFallback" class="t-body-sm">{{ t('help.englishFallback') }}</p>
        <p v-if="remoteArticle" class="t-label">{{ t('help.verifiedVersion', { version: remoteArticle.article.applicability.testedWalletVersion, date: verifiedDate }) }}</p>
        <p v-if="!articleApplies" class="help-applicability-note">{{ t('help.applicabilityBody') }} <button @click="selectChain('all')">{{ t('help.allChains') }}</button></p>
        <!-- The dedicated renderer escapes text and permits only mirrored images and safe links. -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="remoteArticle" class="help-rich-text t-body-lg" :lang="article.locale" v-html="articleHtml"></div>
        <p v-else class="help-answer-body" lang="en">{{ article.body }}</p>
        <GButton @click="openSupport(article.id)">{{ t('help.aboutGuide') }}</GButton>
        <div class="help-section-label"><span class="t-label">{{ t('help.related') }}</span></div>
        <router-link v-for="answer in related" :key="answer.id" :to="answerDestination(answer)" class="help-answer-row"><strong :lang="answer.locale || 'en-US'">{{ answer.title }}</strong><span aria-hidden="true">↗</span></router-link>
      </template>
      <p v-else-if="!loading" role="status">{{ t('help.notFound') }}</p>
    </section>

    <HelpUpdates v-else-if="view === 'updates'" :chain="chain" />

    <section v-else class="help-ledger">
      <p class="t-label">{{ remoteResultsActive ? t('help.matchCount', { count: remoteTotal, shown: filteredRemoteResults.length }) : t('help.count', { count: results.length }) }}</p>
      <template v-if="remoteResultsActive">
        <router-link v-for="answer in filteredRemoteResults" :key="answer.source + ':' + answer.id" :to="remoteDestination(answer)" class="help-answer-row">
          <span class="t-label">{{ t(answer.source === 'gero-blog' ? 'help.blog' : 'help.topic.' + answer.topic) }}</span>
          <div class="help-result-copy"><strong :lang="answer.locale">{{ answer.title }}</strong><p class="t-body-sm" :lang="answer.locale">{{ answer.snippet || answer.summary }}</p><span v-if="answer.isLocaleFallback" class="t-label">{{ t('help.englishFallback') }}</span></div><span class="t-label">{{ answer.locale }} ↗</span>
        </router-link>
        <GButton v-if="nextCursor" :disabled="loading" @click="loadMore()">{{ t('help.loadMore') }}</GButton>
      </template>
      <template v-else>
        <router-link v-for="answer in results" :key="answer.id" :to="answerDestination(answer)" class="help-answer-row"><span class="t-label">{{ t('help.topic.' + answer.topic) }}</span><strong lang="en">{{ answer.title }}</strong><span aria-hidden="true">↗</span></router-link>
      </template>
      <div v-if="!loading && !(remoteResultsActive ? filteredRemoteResults.length : results.length)" class="help-empty" role="status"><h2 class="t-heading">{{ t('help.noResults') }}</h2><p>{{ t('help.noResultsBody') }}</p><GButton @click="selectChain('all')">{{ t('help.allChains') }}</GButton></div>
    </section>

    <aside class="help-support-stamp">
      <span class="t-label">{{ t('help.supportLabel') }}</span>
      <div><h2 class="t-heading">{{ t('help.stillNeedHelp') }}</h2><p class="t-body-sm">{{ t('help.supportSummary') }}</p></div>
      <GButton @click="openSupport(article?.id)">{{ t('help.contact') }}</GButton>
    </aside>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import i18n from '@/plugins/i18n';
import { helpLocale, type HelpArticleSummary, type HelpResult } from '@/api/help.api';
import { useRoute, useRouter } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import HelpUpdates from './HelpUpdates.vue';
import networks from '@/utils/networks';
import { isHelpReady } from '@/modules/navigation/helpAccess';
import { answers, applies, featuredAnswers, parseHelpChain, searchAnswers, topicIndex, walletHelpChain, type HelpAnswer } from './helpContent';
import { openSupport } from './supportIntent';
import { useHelpContent } from './useHelpContent';
import { renderHelpArticle } from './helpRichText';

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const query = ref(typeof route.query.q === 'string' ? route.query.q : '');
watch(() => route.query.q, value => { query.value = typeof value === 'string' ? value : ''; });
const chain = computed(() => parseHelpChain(route.query.chain) ?? (isHelpReady(walletStore) ? walletHelpChain(walletStore.loggedWallet?.chain) : 'all'));
const view = computed(() => route.path.startsWith('/help/articles/') ? 'article' : route.path.startsWith('/help/topics/') ? 'topic' : route.path === '/help/search' ? 'search' : route.path === '/help/updates' ? 'updates' : 'home');
const request = computed(() => ({ view: view.value, locale: helpLocale(i18n.locale), chain: chain.value,
  topic: route.params.topic || '', slug: route.params.slug || '', q: typeof route.query.q === 'string' ? route.query.q : '', basic: route.query.basic === '1' }));
const { home: remoteHome, article: remoteArticle, results: remoteResults, total: remoteTotal, nextCursor, loading, failed, resolved, stale, loadMore, retry } = useHelpContent(request);
function asAnswer(value: HelpArticleSummary): HelpAnswer {
  return { id: value.id, slug: value.slug, topic: value.topic, title: value.title, body: value.summary,
    chains: value.applicability.chains, requiredFeatures: value.applicability.requiredFeatures,
    networks: value.applicability.networks, walletTypes: value.applicability.walletTypes, keywords: [], locale: value.locale, remote: true };
}
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
const verifiedDate = computed(() => remoteArticle.value?.article.lastVerifiedAt?.slice(0, 10) ?? '');
const articleApplies = computed(() => !!article.value && applies(article.value, context.value));
const featured = computed(() => (basicCatalog.value ? featuredAnswers(chain.value)
  : (chain.value === 'all' ? remoteHome.value?.publicFeaturedArticles : remoteHome.value?.walletFeaturedArticles[chain.value])?.map(asAnswer) ?? []).filter(answer => applies(answer, context.value)));
const related = computed(() => catalog.value.filter(answer => answer.id !== article.value?.id && applies(answer, context.value)
  && (remoteArticle.value ? remoteArticle.value.article.relatedArticleIds.includes(answer.id) : answer.topic === article.value?.topic)).slice(0, 3));
const remoteResultsActive = computed(() => resolved.value && !request.value.basic);
const filteredRemoteResults = computed(() => remoteResults.value.filter(answer => applies(asAnswer(answer), context.value)));
const heading = computed(() => view.value === 'updates' ? t('help.updates') : selectedTopic.value ? t('help.topic.' + selectedTopic.value.id) : t('help.answers'));
const results = computed(() => searchAnswers(view.value === 'search' && typeof route.query.q === 'string' ? route.query.q : '', context.value, route.params.topic));
function destination(path: string, extra: Record<string, string> = {}) {
  const query = { ...route.query };
  Object.assign(query, { chain: chain.value, ...extra });
  if (path === '/help') { delete query.q; delete query.source; delete query.basic; }
  return { path, query };
}
function answerDestination(answer: HelpAnswer) { return destination('/help/articles/' + (answer.slug || answer.id), { basic: answer.remote ? '' : '1' }); }
function remoteDestination(answer: HelpResult) {
  const type = answer.destination?.type ?? (answer.source === 'gero-blog' ? 'blog' : 'help-article');
  return destination((type === 'blog' ? '/blog/' : '/help/articles/') + encodeURIComponent(answer.destination?.slug || answer.slug), { basic: '' });
}
function selectChain(value: string): void {
  if (!parseHelpChain(value)) return;
  void router.replace(destination(route.path, { chain: value })).catch(() => {});
}
function search(): void {
  void router.push(destination('/help/search', { q: query.value.trim().slice(0, 200), basic: '' })).catch(() => {});
}
</script>

<style scoped>
.help-center { max-width: 1160px; margin: 0 auto; padding: var(--g-s-6); color: var(--g-text-1); }
.help-tabs { display: flex; align-items: center; flex-wrap: wrap; gap: var(--g-s-5); padding: var(--g-s-4) 0; border-bottom: 1px solid var(--g-hairline-2); }
.help-tabs a, .help-tabs button { color: var(--g-text-2); text-decoration: none; font-size: 0.875rem; }
.help-tabs [aria-current="page"] { color: var(--g-accent); }
.help-tabs button { margin-left: auto; }
.help-hero { display: grid; grid-template-columns: 1.1fr 1fr; align-items: center; gap: var(--g-s-6); padding: var(--g-s-6) 0; }
.help-hero h1, .help-page-heading h1, .help-reader h1 { font-size: clamp(28px, 2.5vw, 36px); font-weight: 600; letter-spacing: -0.04em; line-height: 1.1; max-width: 760px; margin: var(--g-s-4) 0; }
.help-kicker, .help-number { color: var(--g-accent); }
.help-lede, .help-topic p { color: var(--g-text-2); }
.help-hero-scene { width: 100%; max-height: 270px; }
.help-page-heading { padding-top: var(--g-s-6); }
.help-page-heading a { color: var(--g-text-2); }
.help-tools { display: flex; gap: var(--g-s-5); align-items: center; flex-wrap: wrap; padding: var(--g-s-4) 0; border-bottom: 1px solid var(--g-hairline-3); }
.help-search { display: flex; flex: 1; min-width: 200px; align-items: center; }
.help-search input { color: var(--g-text-1); flex: 1; min-width: 0; padding: var(--g-s-3) 0; font-size: 1.125rem; }
.help-search input::placeholder { color: var(--g-text-3); }
.help-chain { display: flex; align-items: center; gap: var(--g-s-3); }
.help-chain select { color: var(--g-text-1); background: var(--g-surface); border: 1px solid var(--g-hairline-3); padding: var(--g-s-2); border-radius: var(--g-r-control); }
.help-section-label { display: flex; justify-content: space-between; color: var(--g-text-2); padding: var(--g-s-6) 0 var(--g-s-3); }
.help-index { display: grid; grid-template-columns: 1fr 1fr; column-gap: var(--g-s-6); }
.help-topic { display: grid; grid-template-columns: 28px 1fr 116px; align-items: center; gap: var(--g-s-3); color: var(--g-text-1); text-decoration: none; border-top: 1px solid var(--g-hairline-2); padding: var(--g-s-5) 0; }
.help-topic:hover { border-top-color: var(--g-accent); }
.help-topic p { margin: var(--g-s-2) 0; }
.help-topic .t-label { color: var(--g-text-3); }
.help-topic--muted { color: var(--g-text-2); }
.help-topic--muted .help-topic-scene { opacity: 0.5; }
.help-number { align-self: start; font-family: var(--g-font-mono); font-size: 0.75rem; padding-top: var(--g-s-1); }
.help-topic-scene { width: 116px; max-height: 110px; transition: transform var(--g-dur-fast) ease; }
.help-topic:hover .help-topic-scene { transform: translateY(-3px); }
.help-answer-row { display: flex; align-items: center; gap: var(--g-s-5); padding: var(--g-s-5) 0; border-top: 1px solid var(--g-hairline-1); color: var(--g-text-1); text-decoration: none; }
.help-answer-row strong { flex: 1; font-weight: 500; }
.help-answer-row .t-label { color: var(--g-text-2); min-width: 100px; }
.help-answer-row:hover strong { color: var(--g-accent); }
.help-reader { max-width: 780px; margin: 0 auto; }
.help-content-status { color: var(--g-text-2); padding-top: var(--g-s-4); }
.help-content-status button { color: var(--g-accent); text-decoration: underline; }
.help-result-copy { flex: 1; }
.help-result-copy p { color: var(--g-text-2); margin: var(--g-s-2) 0 0; }
.help-rich-text { color: var(--g-text-2); line-height: 1.8; padding: var(--g-s-5) 0; }
.help-rich-text :deep(img) { max-width: 100%; height: auto; border-radius: var(--g-r-card); }
.help-rich-text :deep(a) { color: var(--g-accent); }
.help-rich-text :deep(h2), .help-rich-text :deep(h3) { color: var(--g-text-1); margin: var(--g-s-5) 0 var(--g-s-3); }
.help-answer-body { font-size: 1.125rem; line-height: 1.8; padding: var(--g-s-5) 0; color: var(--g-text-2); }
.help-applicability { margin: var(--g-s-6) 0; padding: var(--g-s-6); }
.help-applicability h2, .help-applicability p { margin-bottom: var(--g-s-4); }
.help-applicability-note { padding-top: var(--g-s-5); color: var(--g-text-2); }
.help-applicability-note button { color: var(--g-accent); text-decoration: underline; }
.help-empty { padding: var(--g-s-6) 0; }
.help-support-stamp { display: flex; align-items: center; flex-wrap: wrap; gap: var(--g-s-5); border: 1px solid var(--g-hairline-3); padding: var(--g-s-5); margin-top: var(--g-s-6); }
.help-support-stamp > .t-label { color: var(--g-accent); }
.help-support-stamp > div { flex: 1; min-width: 200px; }
.help-support-stamp p { margin: var(--g-s-2) 0 0; color: var(--g-text-2); }
.help-center :focus-visible { outline: 2px solid var(--g-accent); outline-offset: 4px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (max-width: 760px) {
  .help-center { padding: var(--g-s-4); }
  .help-index { grid-template-columns: 1fr; }
  .help-hero { grid-template-columns: 1fr; gap: 0; }
  .help-hero-scene { max-height: 200px; }
  .help-answer-row { gap: var(--g-s-3); }
  .help-answer-row .t-label { min-width: 0; }
}
@media (prefers-reduced-motion: reduce) { .help-topic-scene { transition: none; } .help-topic:hover .help-topic-scene { transform: none; } }
</style>
