<template>
  <section class="help-updates">
    <nav class="updates-filters" :aria-label="t('help.sources')">
      <router-link v-for="choice in updateSources" :key="choice" :to="selectSource(choice)" :aria-current="source === choice ? 'page' : undefined">{{ sourceLabel(choice) }}</router-link>
    </nav>
    <p v-if="loading" class="t-body-sm updates-status" role="status">{{ t('help.loadingUpdates') }}</p>
    <p v-if="failed" class="t-body-sm updates-status" role="status">{{ t(page?.items.length ? 'help.cachedUpdates' : 'help.updatesUnavailable') }} <button type="button" @click="retry()">{{ t('help.retryContent') }}</button></p>
    <details v-if="visibleSources.length" class="updates-freshness">
      <summary class="t-label">{{ t('help.sourceStatus') }} · {{ t('help.availableSources', { count: visibleSources.filter(s => s.status === 'fresh').length, total: visibleSources.length }) }}</summary>
      <ul><li v-for="item in visibleSources" :key="item.source" class="t-body-sm">
        <strong>{{ sourceLabel(item.source) }}</strong> · {{ t('help.sourceState.' + item.status) }}
        <span v-if="item.mode === 'manual'"> · {{ t('help.reviewedOn', { date: date(item.lastReviewedAt) }) }}</span>
        <span v-else-if="item.lastSuccessfulSyncAt"> · {{ t('help.checkedOn', { date: date(item.lastSuccessfulSyncAt) }) }}</span>
      </li></ul>
    </details>
    <p v-if="source === 'bitcoin-news' || (source === 'ecosystem-news' && chain === 'bitcoin')" class="t-body-sm updates-status">{{ t('help.bitcoinScope') }}</p>
    <div v-if="items.length" class="updates-list">
      <article v-for="item in items" :key="item.id" class="update-row">
        <div class="t-label update-meta"><span>{{ sourceLabel(item.source) }}</span><time v-if="item.publishedAt" :datetime="item.publishedAt">{{ date(item.publishedAt) }}</time><span v-else>{{ t('help.dateUnknown') }}</span></div>
        <div class="update-copy">
          <router-link v-if="item.kind === 'blog' && updateLink(item)" :to="{ path: updateLink(item), query: { chain } }" class="update-title"><h2 class="t-heading" :lang="item.locale">{{ item.title }}</h2></router-link>
          <a v-else-if="updateLink(item)" :href="updateLink(item)" target="_blank" rel="noopener noreferrer" class="update-title"><h2 class="t-heading" :lang="item.locale">{{ item.title }} <span aria-hidden="true">↗</span></h2></a>
          <h2 v-else class="t-heading" :lang="item.locale">{{ item.title }}</h2>
          <p class="t-body update-text" :lang="item.locale">{{ item.text || item.summary }}</p>
          <p v-if="item.isLocaleFallback" class="t-label">{{ t('help.englishFallback') }}</p>
          <div v-if="item.media.length" class="update-media"><img v-for="media in item.media.filter(m => image(m.url))" :key="media.url" :src="image(media.url)" :alt="media.alt" loading="lazy" /></div>
          <p class="t-label update-attribution">{{ item.publisher }}<span v-if="item.timestampStatus === 'x-snowflake'"> · {{ t('help.postDate') }}</span></p>
        </div>
      </article>
      <GButton v-if="page?.nextCursor" :disabled="loading" @click="loadMore()">{{ t('help.loadMoreUpdates') }}</GButton>
    </div>
    <p v-else-if="!loading && !failed && !legacyBlog" role="status" class="t-body updates-status">{{ t('help.noUpdates') }}</p>
    <Blog v-if="legacyBlog" />
    <aside v-if="!items.length && !loading && source !== 'gero-blog'" class="updates-originals">
      <p class="t-body-sm">{{ t('help.sourceIntro') }}</p>
      <a v-for="link in originals" :key="link.id" :href="link.url" target="_blank" rel="noopener noreferrer" class="t-label">{{ sourceLabel(link.id) }} ↗</a>
    </aside>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router/composables';
import i18n from '@/plugins/i18n';
import { helpLocale } from '@/api/help.api';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import Blog from '@/modules/blog/Blog.vue';
import { updateSources, updateSource, updateLink, updateImage } from './helpUpdates';
import { useHelpUpdates } from './useHelpUpdates';
const props = defineProps<{ chain: string }>();
const route = useRoute(), { t } = useTranslation();
const source = computed(() => updateSource(route.query.source));
const request = computed(() => ({ source: source.value, chain: props.chain, locale: helpLocale(i18n.locale) }));
const { page, loading, failed, retry, loadMore } = useHelpUpdates(request);
const items = computed(() => page.value?.items ?? []);
const legacyBlog = computed(() => source.value === 'gero-blog' && !loading.value && !items.value.length
  && (failed.value || page.value?.sources.some(item => item.source === 'gero-blog' && item.status === 'unavailable')));
const visibleSources = computed(() => page.value?.sources.filter(item => (source.value === 'all' || source.value === item.source || source.value === 'ecosystem-news' && item.source.endsWith('-news'))
  && (props.chain === 'all' || !item.source.endsWith('-news') || item.source === props.chain + '-news')) ?? []);
const originals = computed(() => [
  { id: 'cardano-news', url: 'https://cardano.org/news/' }, { id: 'midnight-news', url: 'https://midnight.network/blog' }, { id: 'bitcoin-news', url: 'https://bitcoincore.org/en/releases/' },
  { id: 'gero-x', url: 'https://x.com/GeroWallet' }, { id: 'nexus-x', url: 'https://x.com/NexusByGero' },
].filter(link => (props.chain === 'all' || !link.id.endsWith('-news') || link.id === props.chain + '-news')
  && (source.value === 'all' || source.value === link.id || source.value === 'ecosystem-news' && link.id.endsWith('-news'))));
function selectSource(value: string) { return { path: '/help/updates', query: { ...route.query, source: value, chain: props.chain } }; }
function sourceLabel(value: string): string { return t('help.updateSource.' + value); }
function date(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return t('help.dateUnknown');
  return new Intl.DateTimeFormat(helpLocale(i18n.locale), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}
function image(path: string): string | null { return updateImage(path, import.meta.env['VITE_BACKEND_URL']); }
</script>

<style scoped>
.updates-filters { display: flex; gap: var(--g-s-4); flex-wrap: wrap; padding: var(--g-s-5) 0; border-bottom: 1px solid var(--g-hairline-2); }
.updates-filters a { color: var(--g-text-2); text-decoration: none; font-size: 0.875rem; }
.updates-filters [aria-current="page"] { color: var(--g-accent); }
.updates-status { color: var(--g-text-2); padding: var(--g-s-4) 0; }
.updates-status button, .updates-originals a { color: var(--g-accent); }
.updates-freshness { padding: var(--g-s-4) 0; color: var(--g-text-2); }
.updates-freshness summary { cursor: pointer; }
.updates-freshness ul { margin-top: var(--g-s-3); }
.update-row { display: grid; grid-template-columns: 160px 1fr; gap: var(--g-s-6); padding: var(--g-s-6) 0; border-bottom: 1px solid var(--g-hairline-2); }
.update-meta { display: flex; flex-direction: column; gap: var(--g-s-3); color: var(--g-text-3); }
.update-meta > span:first-child { color: var(--g-accent); }
.update-copy { min-width: 0; }
.update-title { color: var(--g-text-1); text-decoration: none; }
.update-title:hover { color: var(--g-accent); }
.update-text { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--g-text-2); margin: var(--g-s-4) 0; }
.update-attribution { color: var(--g-text-3); margin-top: var(--g-s-4); }
.update-media { display: flex; flex-wrap: wrap; gap: var(--g-s-3); }
.update-media img { max-width: 100%; max-height: 360px; object-fit: contain; border-radius: var(--g-r-card); }
.updates-list > button { margin-top: var(--g-s-5); }
.updates-originals { border-top: 1px solid var(--g-hairline-2); padding: var(--g-s-5) 0; }
.updates-originals a { display: inline-block; margin: var(--g-s-3) var(--g-s-4) 0 0; }
@media (max-width: 760px) { .update-row { grid-template-columns: 1fr; gap: var(--g-s-3); } .update-meta { flex-direction: row; flex-wrap: wrap; } }
</style>
