<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <div class="blog-page">
          <h1 class="t-title text-center blog-heading">{{ $t('blog.title') }}</h1>

          <div class="blog-toolbar">
            <v-text-field
              class="blog-search"
              v-model="search"
              clearable
              hide-details
              solo
              flat
              dense
              prepend-inner-icon="mdi-magnify"
              :label="$t('blog.search')"
              outlined
            ></v-text-field>
          </div>

          <ErrorState
            v-if="error"
            class="mt-6"
            :message="error"
            retryable
            @retry="() => loadPosts(true)"
          />

          <div v-else class="blog-list">
            <!-- Skeletons on first load -->
            <template v-if="isLoading && !posts.length">
              <div v-for="n in 4" :key="`sk-${n}`" class="blog-card blog-card--skeleton">
                <div class="blog-card__media g-skeleton"></div>
                <div class="blog-card__body">
                  <div class="g-skeleton skel-line" style="width: 30%"></div>
                  <div class="g-skeleton skel-line" style="width: 80%; height: 18px"></div>
                  <div class="g-skeleton skel-line" style="width: 100%"></div>
                  <div class="g-skeleton skel-line" style="width: 60%"></div>
                </div>
              </div>
            </template>

            <button
              v-for="post in visiblePosts"
              :key="post.id"
              type="button"
              class="blog-card"
              @click="openPost(post)"
            >
              <div
                class="blog-card__media"
                :style="post.image ? { backgroundImage: `url(${post.image})` } : null"
              >
                <v-icon v-if="!post.image" size="32" class="blog-card__media-fallback">mdi-newspaper-variant-outline</v-icon>
              </div>
              <div class="blog-card__body">
                <p class="t-caption g-num blog-card__meta">
                  {{ formatDate(post.publishDate) }} · {{ post.readingTime }} {{ $t('blog.minRead') }}
                </p>
                <h2 class="t-heading blog-card__title">{{ post.title }}</h2>
                <p class="t-body blog-card__excerpt">{{ post.excerpt }}</p>
                <span class="t-body-sm blog-card__cta">
                  {{ $t('blog.readArticle') }}
                  <v-icon size="16" class="blog-card__cta-icon">mdi-arrow-right</v-icon>
                </span>
              </div>
            </button>

            <p v-if="!isLoading && search.trim() && !visiblePosts.length" class="t-body-sm text-center blog-empty">
              {{ $t('blog.noPostsFound', { query: search }) }}
            </p>
            <p v-else-if="!isLoading && !posts.length" class="t-body-sm text-center blog-empty">
              {{ $t('blog.empty') }}
            </p>
          </div>

          <div class="blog-foot">
            <div ref="sentinel" v-if="hasMore && !search.trim()" class="blog-sentinel"></div>
            <v-progress-circular v-show="loadingMore && hasMore" indeterminate color="primary" size="24" />
            <p v-if="!hasMore && !search.trim() && posts.length" class="t-caption blog-foot__note">
              {{ $t('blog.noMorePosts') }}
            </p>
          </div>
        </div>
      </v-col>
    </v-row>
  </v-layout>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue';
import { useIntersectionObserver } from '@vueuse/core';
import { useRouter } from 'vue-router/composables';
import { getBlogPosts, type BlogPost } from '@/api/blog.api';
import { useTranslation } from '@/shared/composables/useTranslation';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';

const { t } = useTranslation();
const router = useRouter();

const posts = ref<BlogPost[]>([]);
const search = ref('');
const page = ref(0);
const hasMore = ref(true);
const isLoading = ref(false);
const loadingMore = ref(false);
const error = ref<string | null>(null);

const sentinel = ref<HTMLElement | null>(null);
const isIntersecting = ref(false);

const loadPosts = async (initial = false): Promise<void> => {
  if (loadingMore.value) return;
  if (initial) {
    posts.value = [];
    page.value = 0;
    hasMore.value = true;
  }
  loadingMore.value = true;
  if (initial) isLoading.value = true;
  error.value = null;
  try {
    const next = page.value + 1;
    const { posts: batch, hasMore: more } = await getBlogPosts(next, 10);
    posts.value = initial ? batch : [...posts.value, ...batch];
    page.value = next;
    hasMore.value = more;
  } catch (e) {
    error.value = t('blog.loadFailedConnection');
    hasMore.value = false;
  } finally {
    loadingMore.value = false;
    isLoading.value = false;
  }
};

const visiblePosts = computed<BlogPost[]>(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return posts.value;
  return posts.value.filter(
    (p) => p.title.toLowerCase().includes(term) || p.excerpt.toLowerCase().includes(term),
  );
});

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
};

const openPost = (post: BlogPost): void => {
  router.push({ name: 'blog-post', params: { slug: post.slug } }).catch(() => { /* duplicate nav */ });
};

useIntersectionObserver(sentinel, ([entry]) => { isIntersecting.value = entry.isIntersecting; }, {
  threshold: 0.1,
  rootMargin: '80px',
});

watch(isIntersecting, (v) => {
  if (v && hasMore.value && !loadingMore.value && !search.value.trim()) loadPosts(false);
});

onMounted(() => loadPosts(true));
onUnmounted(() => { /* observer stops with the component */ });
</script>

<style scoped>
.blog-page {
  max-width: var(--g-content-max);
  margin: 0 auto;
  padding: var(--g-s-4) var(--g-s-2) var(--g-s-6);
}
.blog-heading { margin-bottom: var(--g-s-5); }

.blog-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--g-s-4);
}
.blog-search {
  max-width: 320px;
  width: 100%;
}

.blog-list {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.blog-card {
  display: flex;
  text-align: left;
  width: 100%;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  overflow: hidden;
  cursor: pointer;
  transition: border-color var(--g-dur-fast) ease-out, background-color var(--g-dur-fast) ease-out;
}
.blog-card:hover { border-color: var(--g-hairline-3); background: var(--g-overlay); }
.blog-card:active { transform: translateY(1px); }
.blog-card--skeleton { cursor: default; }

.blog-card__media {
  flex: 0 0 200px;
  min-height: 160px;
  background-color: var(--g-surface);
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
}
.blog-card__media-fallback { color: var(--g-text-3); }

.blog-card__body {
  flex: 1 1 auto;
  padding: var(--g-s-4) var(--g-s-5);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  min-width: 0;
}
.blog-card__meta { margin: 0; }
.blog-card__title {
  margin: 0;
  word-break: break-word;
}
.blog-card__excerpt {
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.blog-card__cta {
  margin-top: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  color: var(--g-accent);
}
.blog-card__cta-icon { color: var(--g-accent); }

.blog-empty { color: var(--g-text-3); padding: var(--g-s-6) 0; }

.blog-foot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
  padding-top: var(--g-s-4);
}
.blog-sentinel { height: 20px; width: 100%; }
.blog-foot__note { color: var(--g-text-3); margin: 0; }

/* Skeleton shimmer itself is the shared .g-skeleton primitive (baseline.css). */
.skel-line { height: 12px; margin-bottom: var(--g-s-2); }

@media (max-width: 640px) {
  .blog-card { flex-direction: column; }
  .blog-card__media { flex-basis: 160px; width: 100%; }
}
</style>
