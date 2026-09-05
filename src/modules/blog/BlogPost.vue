<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <article class="post-page">
          <button type="button" class="post-back t-body-sm" @click="goBack">
            <v-icon size="16" class="post-back__icon">mdi-arrow-left</v-icon>
            {{ $t('blog.backToBlog') }}
          </button>

          <!-- Loading -->
          <div v-if="loading" class="post-skeleton">
            <div class="g-skeleton skel-line" style="width: 40%; height: 14px"></div>
            <div class="g-skeleton skel-line" style="width: 90%; height: 30px; margin-top: 12px"></div>
            <div class="g-skeleton post-skeleton__hero"></div>
            <div class="g-skeleton skel-line" style="width: 100%"></div>
            <div class="g-skeleton skel-line" style="width: 95%"></div>
            <div class="g-skeleton skel-line" style="width: 70%"></div>
          </div>

          <ErrorState
            v-else-if="error"
            class="mt-6"
            :message="error"
            retryable
            @retry="load"
          />

          <p v-else-if="!post" class="t-body text-center post-missing">{{ $t('blog.postNotFound') }}</p>

          <template v-else>
            <p class="t-caption g-num post-meta">
              {{ formatDate(post.publishDate) }} · {{ post.readingTime }} {{ $t('blog.minRead') }}
            </p>
            <h1 class="t-display post-title">{{ post.title }}</h1>

            <!-- Gate on what actually renders. `image` and `heroImage` are separate
                 fields now, and the backend mirrors the two sizes independently, so a
                 post can carry a hero without a card thumbnail. -->
            <div
              v-if="heroImage"
              class="post-hero"
              :style="{ backgroundImage: `url(${heroImage})` }"
            ></div>

            <!-- Rich-text body. documentToHtmlString escapes all text and emits
                 only known tags; the content is authored by the Gero team via the
                 SEO control panel, so v-html here is trusted CMS output. -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="post-body g-longform" v-html="bodyHtml"></div>
          </template>
        </article>
      </v-col>
    </v-row>
  </v-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router/composables';
import { documentToHtmlString } from '@contentful/rich-text-html-renderer';
import { BLOCKS, INLINES } from '@contentful/rich-text-types';
import { getBlogPostBySlug, type BlogPost } from '@/api/blog.api';
import { useTranslation } from '@/shared/composables/useTranslation';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';

const props = defineProps<{ slug: string }>();

const { t } = useTranslation();
const router = useRouter();

const post = ref<BlogPost | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const load = async (): Promise<void> => {
  loading.value = true;
  error.value = null;
  try {
    post.value = await getBlogPostBySlug(props.slug);
  } catch (e) {
    error.value = t('blog.loadFailedConnection');
  } finally {
    loading.value = false;
  }
};

/** Escape a value for safe interpolation into a double-quoted HTML attribute. */
const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Allow only http(s) and mailto; everything else (javascript:, data:, ...) is rejected. */
const safeUrl = (raw: string): string | null => {
  const u = (raw || '').trim();
  return /^https?:\/\//i.test(u) || /^mailto:/i.test(u) ? u : null;
};

// Full-width hero. The backend sizes both variants, so take the one it marks as the hero and
// fall back to the card thumbnail. Do not derive it from `image` by dropping the query: the
// version that did meant every reader downloaded the untouched original, which is how the
// CMS asset-bandwidth allowance ran out.
const heroImage = computed(() => post.value?.heroImage ?? post.value?.image ?? '');

const bodyHtml = computed<string>(() => {
  const p = post.value;
  if (!p?.content) return '';
  // The CMS body almost always repeats the title as a leading H1 (verified: 19
  // of 20 posts). The page already renders the title, so drop a leading H1 to
  // avoid showing it twice.
  let doc = p.content;
  if (doc.content?.[0]?.nodeType === BLOCKS.HEADING_1) {
    doc = { ...doc, content: doc.content.slice(1) };
  }
  return documentToHtmlString(doc, {
    renderNode: {
      [BLOCKS.EMBEDDED_ASSET]: (node) => {
        const id = (node.data?.target as { sys?: { id?: string } })?.sys?.id;
        const asset = id ? p.assets[id] : undefined;
        if (!asset?.url || !(asset.contentType || '').startsWith('image/')) return '';
        // Only allow https image sources, and escape every interpolated value:
        // this is v-html, so an unescaped " in a URL/title would break out of
        // the attribute. Do not trust the CMS field to be attribute-safe.
        const src = safeUrl(asset.url);
        if (!src) return '';
        return `<img src="${escapeAttr(src)}" alt="${escapeAttr(asset.title || '')}" loading="lazy" />`;
      },
      [INLINES.HYPERLINK]: (node, next) => {
        const uri = (node.data?.uri as string) || '';
        const href = safeUrl(uri);
        const inner = next(node.content); // already-rendered, escaped HTML
        // A disallowed protocol (javascript:, data:, ...) renders as plain text,
        // never a clickable link.
        if (!href) return `<span>${inner}</span>`;
        return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
      },
    },
  });
});

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
};

const goBack = (): void => {
  router.push({ name: 'blog' }).catch(() => { /* duplicate nav */ });
};

watch(() => props.slug, load);
onMounted(load);
</script>

<style scoped>
.post-page {
  max-width: 760px;
  margin: 0 auto;
  padding: var(--g-s-4) var(--g-s-2) var(--g-s-6);
}

.post-back {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  background: transparent;
  color: var(--g-text-2);
  padding: var(--g-s-2) 0;
  margin-bottom: var(--g-s-3);
  cursor: pointer;
  transition: color var(--g-dur-fast) ease-out;
}
.post-back:hover { color: var(--g-text-1); }
.post-back__icon { color: currentColor; }

.post-meta { margin: 0 0 var(--g-s-2); }
.post-title { margin: 0 0 var(--g-s-4); word-break: break-word; }

.post-hero {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: var(--g-r-card);
  background-color: var(--g-surface);
  background-size: cover;
  background-position: center;
  border: 1px solid var(--g-hairline-1);
  margin-bottom: var(--g-s-5);
}
.post-missing { color: var(--g-text-3); padding: var(--g-s-6) 0; }

/* Skeleton shimmer is the shared .g-skeleton primitive (baseline.css). */
.skel-line { height: 12px; margin-bottom: var(--g-s-2); }
.post-skeleton__hero { width: 100%; height: 240px; margin: 20px 0; border-radius: var(--g-r-card); }
</style>

<!-- Unscoped: rich-text body is injected via v-html, so scoped [data-v] would
     never reach it. Kept narrow to .g-longform. -->
<style>
.g-longform {
  color: var(--g-text-2);
  font-size: 16px;
  line-height: 1.75;
}
.g-longform > *:first-child { margin-top: 0; }
/* A body H1 is unusual after the leading one is stripped; size it as a section head. */
.g-longform h1 { font-size: 24px; font-weight: 620; letter-spacing: -0.02em; color: var(--g-text-1); margin: 32px 0 12px; }
.g-longform h2 { font-size: 24px; font-weight: 620; letter-spacing: -0.02em; color: var(--g-text-1); margin: 32px 0 12px; }
.g-longform h3 { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; color: var(--g-text-1); margin: 24px 0 10px; }
.g-longform h4 { font-size: 16px; font-weight: 600; color: var(--g-text-1); margin: 20px 0 8px; }
.g-longform p { margin: 0 0 16px; }
.g-longform a { color: var(--g-accent); text-decoration: none; }
.g-longform a:hover { text-decoration: underline; }
.g-longform ul, .g-longform ol { margin: 0 0 16px; padding-left: 22px; }
.g-longform li { margin-bottom: 6px; }
.g-longform img { max-width: 100%; height: auto; border-radius: var(--g-r-card); margin: 20px 0; display: block; }
.g-longform blockquote {
  margin: 20px 0;
  padding: 4px 16px;
  border-left: 3px solid var(--g-accent);
  color: var(--g-text-1);
}
.g-longform hr { border: none; border-top: 1px solid var(--g-hairline-2); margin: 28px 0; }
.g-longform code {
  font-family: var(--g-font-mono);
  font-size: 13px;
  background: var(--g-raised);
  padding: 2px 6px;
  border-radius: var(--g-r-control);
}
.g-longform b, .g-longform strong { color: var(--g-text-1); font-weight: 600; }
</style>
