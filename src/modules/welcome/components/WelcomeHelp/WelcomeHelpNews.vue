<template>
  <!-- Hidden while loading, on failure and when the blog has nothing to show. -->
  <section v-if="post && !suppressed" class="whelp-news" aria-labelledby="whelp-news-title" data-test="whats-new">
    <h3 id="whelp-news-title" class="t-label">{{ t('help.welcome.whatsNew') }}</h3>
    <a class="whelp-news__row" :href="`#${post.path}`" target="_blank" rel="noopener" @click.prevent="$emit('open', post.path)">
      <img v-if="post.image" class="whelp-news__thumb" :src="post.image" alt="" width="80" height="45" loading="lazy" />
      <span class="whelp-news__copy">
        <span class="whelp-news__title" :lang="post.locale">{{ post.title }}</span>
        <span class="t-caption g-num">{{ meta }}</span>
      </span>
    </a>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import i18n from '@/plugins/i18n';
import { getHelpUpdates, helpLocale } from '@/api/help.api';
import { updateImage, updateLink } from '@/modules/help/helpUpdates';
import { useTranslation } from '@/shared/composables/useTranslation';

defineProps<{
  /** Kept mounted (so the post is fetched once) but not shown, e.g. while searching. */
  suppressed?: boolean;
}>();
defineEmits<{ (e: 'open', path: string): void }>();

interface NewsPost { title: string; locale: string; path: string; image: string | null; publishedAt: string | null }

const { t } = useTranslation();
const post = ref<NewsPost | null>(null);
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());

const meta = computed(() => {
  const published = post.value?.publishedAt;
  if (!published || !Number.isFinite(Date.parse(published))) return t('help.updateSource.gero-blog');
  const date = new Intl.DateTimeFormat(helpLocale(i18n.locale), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(published));
  return t('help.welcome.blogMeta', { date });
});

async function load(): Promise<void> {
  try {
    const page = await getHelpUpdates({ source: 'gero-blog', chain: 'all', locale: helpLocale(i18n.locale) }, controller.signal);
    const item = page.items?.[0];
    const path = item ? updateLink(item) : null;
    if (controller.signal.aborted || !item || !path) return;
    const image = item.media?.map(media => updateImage(media.url, import.meta.env['VITE_BACKEND_URL'])).find(Boolean) ?? null;
    post.value = { title: item.title, locale: item.locale, path, image, publishedAt: item.publishedAt };
  } catch {
    // The blog is a nicety on this screen: any failure leaves the section out.
  }
}
void load();
</script>

<style scoped>
.whelp-news {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.whelp-news h3 {
  margin: 0;
  padding: var(--g-s-1) var(--g-s-3) 6px;
}
.whelp-news__row {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-2) var(--g-s-3);
  border-radius: var(--g-r-control);
  text-decoration: none;
  transition: background-color var(--g-dur-fast) var(--g-ease);
}
.whelp-news__row:hover { background-color: rgba(255, 255, 255, 0.04); }

/* Image frame: the thumbnail is content, so the hairline keeps its edge on dark imagery. */
.whelp-news__thumb {
  flex: none;
  display: block;
  width: 80px;
  height: 45px;
  object-fit: cover;
  object-position: left top;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-chip);
}
.whelp-news__copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.whelp-news__title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--g-text-1);
  font-size: 13.5px;
  font-weight: 500;
  line-height: 18px;
}
</style>
