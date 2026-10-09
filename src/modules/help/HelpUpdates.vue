<template>
  <section class="updates">
    <div class="updates-head">
      <div class="updates-head__copy">
        <h1 class="t-title">{{ t('help.updates') }}</h1>
        <p class="t-body">{{ t('help.updatesPage.subtitle') }}</p>
      </div>
      <IsoScene name="helpUpdates" class="updates-head__scene" />
    </div>

    <div class="updates-controls">
      <div role="group" :aria-label="t('help.sources')" class="source-pills">
        <HelpPill :pressed="source === 'all'" @click="select('all')">{{ sourceLabel('all') }}</HelpPill>
        <HelpPill
          v-for="choice in pills" :key="choice" :pressed="source === choice"
          :aria-label="pillLabel(choice)" @click="select(choice)"
        ><span v-if="stateOf(choice)" class="pill-dot" :class="{ 'pill-dot--stale': stateOf(choice) !== 'fresh' }" aria-hidden="true"></span>{{ sourceLabel(choice) }}</HelpPill>
      </div>
      <div v-if="staleStatus" class="updates-warning" role="status">
        <v-icon :size="18" color="var(--g-warning)" class="updates-warning__icon">mdi-clock-outline</v-icon>
        <p>{{ staleStatus }}</p>
      </div>
    </div>

    <p v-if="loading" class="t-body-sm updates-status" role="status">{{ t('help.loadingUpdates') }}</p>
    <p v-if="failed" class="t-body-sm updates-status" role="status">{{ t(page?.items.length ? 'help.cachedUpdates' : 'help.updatesUnavailable') }} <button type="button" class="updates-retry" @click="retry()">{{ t('help.retryContent') }}</button></p>
    <p v-if="source === 'bitcoin-news' || (source === 'ecosystem-news' && chain === 'bitcoin')" class="t-body-sm updates-status">{{ t('help.bitcoinScope') }}</p>

    <section v-if="items.length" class="glass-panel updates-list" :aria-label="sourceLabel(source)">
      <ul>
        <li v-for="item in items" :key="item.id">
          <!-- Both listeners: a plain link takes @click, router-link needs @click.native; either way the open is counted once. -->
          <component :is="rowTag(item)" class="update-row" v-bind="rowProps(item)" @click="openItem(item)" @click.native="openItem(item)">
            <HelpSourceBadge :source="item.source" class="update-icon" />
            <div class="update-body" :class="{ 'update-body--social': item.kind === 'social' }">
              <p class="t-caption g-num update-caption">{{ caption(item) }}</p>
              <template v-if="item.kind === 'social'">
                <p class="t-body update-social" :lang="item.locale">{{ item.text || item.summary || item.title }}</p>
                <img v-for="image in images(item)" :key="image.src" :src="image.src" :alt="image.alt" class="update-media" loading="lazy" />
              </template>
              <template v-else>
                <h2 class="update-title" :lang="item.locale">{{ item.title }}</h2>
                <p v-if="item.summary" class="t-body-sm update-summary" :lang="item.locale">{{ item.summary }}</p>
              </template>
              <p v-if="item.isLocaleFallback" class="t-caption">{{ t('help.englishFallback') }}</p>
            </div>
            <img v-if="item.kind === 'blog' && images(item)[0]" :src="images(item)[0].src" alt="" class="update-thumb" loading="lazy" />
            <v-icon v-if="linkOf(item)" :size="16" color="var(--g-text-3)" class="update-arrow">{{ isInternal(item) ? 'mdi-arrow-right' : 'mdi-arrow-top-right' }}</v-icon>
          </component>
        </li>
      </ul>
    </section>
    <p v-else-if="!loading && !failed && !legacyBlog" role="status" class="t-body updates-status">{{ t('help.noUpdates') }}</p>
    <div v-if="items.length && page?.nextCursor" class="updates-more">
      <GButton :disabled="loading" @click="loadMore()">{{ t('help.loadMoreUpdates') }}</GButton>
    </div>

    <Blog v-if="legacyBlog" />
    <aside v-if="!items.length && !loading && source !== 'gero-blog'" class="updates-originals">
      <p class="t-body-sm">{{ t('help.sourceIntro') }}</p>
      <div class="updates-originals__links">
        <GButton v-for="link in originals" :key="link.id" tier="tertiary" compact :href="link.url" target="_blank" rel="noopener noreferrer">
          {{ sourceLabel(link.id) }}
          <v-icon :size="16" class="updates-originals__icon">mdi-open-in-new</v-icon>
        </GButton>
      </div>
    </aside>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';
import i18n from '@/plugins/i18n';
import { helpLocale, type HelpSource, type HelpUpdate } from '@/api/help.api';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import Blog from '@/modules/blog/Blog.vue';
import { formatHelpDate } from './helpFormat';
import { updateImages, updateLink, updatePills, updateSource, type UpdatePillSource } from './helpUpdates';
import { staleStatusFor } from './helpUpdatesStatus';
import { useHelpTracking } from './useHelpTracking';
import { useHelpUpdates } from './useHelpUpdates';
import HelpPill from './HelpPill.vue';
import HelpSourceBadge from './HelpSourceBadge.vue';

const props = defineProps<{ chain: string }>();
const route = useRoute(), router = useRouter(), { t, tc } = useTranslation();
const { track, updateOpened } = useHelpTracking();
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

// A response about one source may omit the others, so the pills remember the last state seen for each.
const known = ref<Record<string, HelpSource>>({});
watch(() => page.value?.sources, sources => {
  if (sources?.length) known.value = { ...known.value, ...Object.fromEntries(sources.map(item => [item.source, item])) };
}, { immediate: true });
const pills = computed(() => updatePills(props.chain));
const stateOf = (value: string): HelpSource['status'] | null => known.value[value]?.status ?? null;
const pillLabel = (value: string): string | undefined => {
  const state = stateOf(value);
  return state ? t('help.updatesPage.pillLabel', { name: sourceLabel(value), state: t('help.sourceState.' + state) }) : undefined;
};
const staleStatus = computed(() => staleStatusFor(visibleSources.value, {
  name: sourceLabel, date, text: (key, params) => t('help.updatesPage.' + key, params), othersText: count => tc('help.updatesPage.othersFresh', count),
}));

function select(value: 'all' | UpdatePillSource): void {
  if (value !== source.value) track({ type: 'updates_filter', subject: value });
  void router.push({ path: '/help/updates', query: { ...route.query, source: value, chain: props.chain } }).catch(() => {});
}
function sourceLabel(value: string): string { return t('help.updateSource.' + value); }
function date(value?: string | null): string { return formatHelpDate(value, helpLocale(i18n.locale)) || t('help.dateUnknown'); }
function caption(item: HelpUpdate): string {
  const stale = known.value[item.source]?.status === 'stale' && item.kind !== 'social';
  return [sourceLabel(item.source), date(item.publishedAt), ...(stale ? [t('help.sourceState.stale')] : [])].join(' · ');
}
function images(item: HelpUpdate): { src: string; alt: string }[] { return updateImages(item, import.meta.env['VITE_BACKEND_URL']); }
const linkOf = (item: HelpUpdate): string | null => updateLink(item);
const isInternal = (item: HelpUpdate): boolean => item.kind === 'blog' && !!linkOf(item);
// Opening an item is counted by its source; an item without a safe link is inert and counts nothing.
function openItem(item: HelpUpdate): void {
  if (linkOf(item)) updateOpened(item.source);
}
// Blog posts open inside the wallet, originals in a new tab, and an item without a safe link stays readable but inert.
function rowTag(item: HelpUpdate): string { return !linkOf(item) ? 'article' : isInternal(item) ? 'router-link' : 'a'; }
function rowProps(item: HelpUpdate): Record<string, unknown> {
  const link = linkOf(item);
  if (!link) return {};
  return isInternal(item) ? { to: { path: link, query: { chain: props.chain } } } : { href: link, target: '_blank', rel: 'noopener noreferrer' };
}
</script>

<style scoped>
.updates { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.updates-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--g-s-3) var(--g-s-5); }
.updates-head__copy { flex: 1 1 360px; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.updates-head__copy h1, .updates-head__copy p { margin: 0; }
.updates-head__scene { flex: none; width: 216px; height: auto; display: block; margin: -12px 0; }

.updates-controls { display: flex; flex-direction: column; gap: var(--g-s-3); }
.source-pills { display: flex; flex-wrap: wrap; gap: var(--g-s-2); }
.pill-dot { width: 6px; height: 6px; border-radius: var(--g-r-pill); background: var(--g-success); }
.pill-dot--stale { background: var(--g-warning); }
.updates-warning {
  display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: var(--g-r-control);
  background: var(--g-warning-fill); border: 1px solid var(--g-warning-line);
}
.updates-warning__icon { flex: none; }
.updates-warning p { margin: 0; font-size: 13px; line-height: 1.45; color: var(--g-text-1); }

.updates-status { margin: 0; color: var(--g-text-2); }
.updates-retry { color: var(--g-accent); text-decoration: underline; text-underline-offset: 2px; }

.updates-list { padding: var(--g-s-2); }
.updates-list ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.updates-list li + li { border-top: 1px solid var(--g-hairline-1); }
.update-row {
  display: flex; align-items: flex-start; gap: var(--g-s-4); padding: var(--g-s-4); border-radius: var(--g-r-control);
  color: inherit; text-decoration: none; transition: background-color var(--g-dur-fast) var(--g-ease);
}
a.update-row:hover { background-color: rgba(255, 255, 255, 0.03); }
.update-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: var(--g-s-1); }
.update-body--social { gap: var(--g-s-2); }
.update-body p, .update-body h2 { margin: 0; }
.update-title { font-size: 15px; font-weight: 550; line-height: 1.4; color: var(--g-text-1); }
.update-summary {
  line-height: 1.5; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
}
.update-social { max-width: 72ch; line-height: 1.55; color: var(--g-text-1); white-space: pre-wrap; overflow-wrap: anywhere; }
.update-media {
  display: block; width: 100%; max-width: 560px; height: auto;
  border-radius: var(--g-r-control); border: 1px solid var(--g-hairline-1); box-sizing: border-box;
}
.update-thumb {
  flex: none; display: block; width: 168px; aspect-ratio: 16 / 9; object-fit: cover; object-position: left top;
  border-radius: var(--g-r-control); border: 1px solid var(--g-hairline-1); box-sizing: border-box;
}
.update-arrow { flex: none; margin-top: 2px; }

.updates-more { display: flex; justify-content: center; }
.updates-originals { display: flex; flex-direction: column; gap: var(--g-s-2); }
.updates-originals p { margin: 0; }
.updates-originals__links { display: flex; flex-wrap: wrap; gap: var(--g-s-1); margin-left: calc(-1 * var(--g-s-3)); }
.updates-originals__icon { margin-left: var(--g-s-1); }

@media (max-width: 640px) {
  .updates-head__scene { display: none; }
  .update-row .update-icon { display: none; }
  .update-thumb { width: 96px; }
}
</style>
