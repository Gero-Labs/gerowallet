<template>
  <HelpCard id="help-blog-title" :title="t('help.home.fromBlog')" class="blog">
    <template #action><GButton tier="tertiary" compact :to="updatesTo('gero-blog')">{{ t('help.home.allPosts') }}</GButton></template>
    <template v-if="item">
      <img v-if="thumbnail" :src="thumbnail" alt="" class="blog-thumb" loading="lazy" />
      <h3 class="t-heading blog-title" :lang="item.locale">
        <router-link v-if="link" :to="{ path: link, query: { chain } }" class="blog-link">{{ item.title }}</router-link>
        <template v-else>{{ item.title }}</template>
      </h3>
      <p class="t-body blog-text" :lang="item.locale">{{ item.summary || item.text }}</p>
      <p class="t-caption g-num blog-foot">{{ caption }}</p>
    </template>
    <p v-else class="t-body-sm blog-status" role="status">{{ t(loading ? 'help.loadingUpdates' : failed ? 'help.updatesUnavailable' : 'help.noUpdates') }}</p>
  </HelpCard>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import i18n from '@/plugins/i18n';
import { helpLocale } from '@/api/help.api';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import { formatHelpDate } from '../helpFormat';
import { useHelpNavigation } from '../helpNavigation';
import { updateImages, updateLink } from '../helpUpdates';
import { useHelpUpdates } from '../useHelpUpdates';
import HelpCard from './HelpCard.vue';

const { t } = useTranslation();
const { chain, updatesTo } = useHelpNavigation();
// Only the newest post is shown, so only one is requested.
const request = computed(() => ({ source: 'gero-blog', chain: chain.value, locale: helpLocale(i18n.locale), limit: 1 }));
const { page, loading, failed } = useHelpUpdates(request);
const item = computed(() => page.value?.items[0] ?? null);
const link = computed(() => item.value ? updateLink(item.value) : null);
const thumbnail = computed(() => item.value ? updateImages(item.value, import.meta.env['VITE_BACKEND_URL'])[0]?.src ?? null : null);
const caption = computed(() => {
  const post = item.value;
  if (!post) return '';
  const date = formatHelpDate(post.publishedAt, helpLocale(i18n.locale)) || t('help.dateUnknown');
  return `${post.publisher || t('help.updateSource.' + post.source)} · ${date}`;
});
</script>

<style scoped>
.blog-thumb {
  display: block; width: 100%; aspect-ratio: 2 / 1; object-fit: cover; object-position: left top;
  border-radius: var(--g-r-control); border: 1px solid var(--g-hairline-1); box-sizing: border-box;
}
.blog-title { margin: var(--g-s-1) 0 0; font-size: 18px; line-height: 1.35; }
.blog-link { color: var(--g-text-1); text-decoration: none; }
.blog-link:hover { color: var(--g-text-1); text-decoration: underline; text-underline-offset: 3px; }
.blog-text { margin: 0; line-height: 1.55; }
.blog-foot { margin: auto 0 0; padding-top: var(--g-s-1); }
.blog-status { margin: 0; }
@media (max-width: 640px) {
  .blog-text { font-size: 13px; }
  .blog-foot { margin-top: 0; padding-top: 0; }
}
</style>
