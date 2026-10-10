<template>
  <HelpCard id="help-news-title" :title="t('help.ecosystem')" inset class="news">
    <template #action>
      <span v-if="hasSources" class="news-fresh"><span class="news-fresh__dot" :class="{ 'news-fresh__dot--stale': !fresh }" aria-hidden="true"></span>{{ t(fresh ? 'help.sourceState.fresh' : 'help.sourceState.stale') }}</span>
    </template>
    <HelpSceneFrame scene="helpUpdates" :scale="66" class="news-frame" />
    <ul v-if="items.length" class="news-list">
      <li v-for="item in items" :key="item.id">
        <component :is="updateLink(item) ? 'a' : 'div'" class="news-row" v-bind="rowAttrs(item)" @click="openItem(item)">
          <span class="news-copy">
            <span class="t-caption g-num">{{ t('help.updateSource.' + item.source) }} · {{ dateOf(item) }}</span>
            <span class="news-title" :lang="item.locale">{{ item.title }}</span>
          </span>
          <v-icon v-if="updateLink(item)" :size="16" color="var(--g-text-3)" class="news-arrow">mdi-arrow-top-right</v-icon>
        </component>
      </li>
    </ul>
    <p v-if="failed && items.length" class="t-caption news-saved" role="status"><v-icon :size="14" color="var(--g-warning)" class="news-saved__icon">mdi-alert-outline</v-icon>{{ t('help.cachedUpdates') }}</p>
    <p v-else-if="!items.length" class="t-body-sm news-status" role="status">{{ t(loading ? 'help.loadingUpdates' : failed ? 'help.updatesUnavailable' : 'help.noUpdates') }}</p>
    <GButton tier="tertiary" compact class="news-all" :to="updatesTo()" @click.native.capture="home('all_updates')">{{ t('help.updateSource.all') }}</GButton>
  </HelpCard>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import i18n from '@/plugins/i18n';
import { helpLocale, type HelpUpdate } from '@/api/help.api';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import { formatHelpDate } from '../helpFormat';
import { newsIsFresh, relevantNewsSources } from '../helpHome';
import { useHelpNavigation } from '../helpNavigation';
import { updateLink } from '../helpUpdates';
import { useHelpTracking } from '../useHelpTracking';
import { useHelpUpdates } from '../useHelpUpdates';
import HelpCard from './HelpCard.vue';
import HelpSceneFrame from './HelpSceneFrame.vue';

const { t } = useTranslation();
const { chain, updatesTo } = useHelpNavigation();
const { home, updateOpened } = useHelpTracking();
const request = computed(() => ({ source: 'ecosystem-news', chain: chain.value, locale: helpLocale(i18n.locale), limit: 3 }));
const { page, loading, failed } = useHelpUpdates(request);
const items = computed(() => page.value?.items ?? []);
const hasSources = computed(() => relevantNewsSources(page.value?.sources ?? [], chain.value).length > 0);
// A failed refresh leaves the last saved page on screen; its source states are as old as it is.
const fresh = computed(() => !failed.value && newsIsFresh(page.value?.sources ?? [], chain.value));
function dateOf(item: HelpUpdate): string { return formatHelpDate(item.publishedAt, helpLocale(i18n.locale)) || t('help.dateUnknown'); }
// Only a headline that opens its original counts; an inert row does nothing.
function openItem(item: HelpUpdate): void {
  if (!updateLink(item)) return;
  home('ecosystem_news');
  updateOpened(item.source);
}
// Original publishers open in a new tab; an item without a safe link stays readable but inert.
function rowAttrs(item: HelpUpdate): Record<string, string> {
  const href = updateLink(item);
  return href ? { href, target: '_blank', rel: 'noopener noreferrer' } : {};
}
</script>

<style scoped>
.news-fresh { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; color: var(--g-text-2); }
.news-fresh__dot { width: 6px; height: 6px; border-radius: var(--g-r-pill); background: var(--g-success); }
.news-fresh__dot--stale { background: var(--g-warning); }
.news-frame { margin: 0 var(--g-s-3); }
.news-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.news-row {
  display: flex; align-items: flex-start; gap: var(--g-s-3); padding: 10px var(--g-s-3); border-radius: var(--g-r-control); text-decoration: none;
  transition: background-color var(--g-dur-fast) var(--g-ease);
}
a.news-row:hover { background-color: rgba(255, 255, 255, 0.03); }
.news-copy { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
.news-title { font-size: 14px; font-weight: 500; line-height: 20px; color: var(--g-text-1); }
.news-arrow { flex: none; margin-top: 2px; }
.news-status { margin: 0 var(--g-s-3); }
.news-saved { display: flex; align-items: flex-start; gap: 6px; margin: 0 var(--g-s-3); }
.news-saved__icon { flex: none; margin-top: 1px; }
.news-all { align-self: flex-start; margin-top: auto; }
@media (max-width: 640px) {
  .news-all { margin-top: 0; }
}
</style>
