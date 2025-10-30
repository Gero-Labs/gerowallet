<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <v-card class="transparent" flat>
          <v-card-title class="justify-center text-center" style="font-size: 32px"> {{ $t('blog.title') }} </v-card-title>
          <v-card-text class="pb-0">
            <v-row>
              <v-col cols="12" xl="8" lg="8" md="8"> </v-col>
              <v-col cols="12" xl="4" lg="4" md="4">
                <v-text-field
                  class="blog-search"
                  v-model="search"
                  clearable
                  hide-details
                  solo
                  dense
                  prepend-inner-icon="mdi-magnify"
                  :label="$t('blog.search')"
                  outlined
                ></v-text-field>
              </v-col>
              <v-col cols="12">
                <!-- Error message -->
                <v-alert v-if="error" type="error" dismissible class="mb-4" @input="error = null">
                  {{ error }}
                </v-alert>

                <v-card
                  flat
                  :loading="isLoading"
                  class="transparent"
                  style="box-shadow: none !important; backdrop-filter: unset !important"
                >
                  <v-card-text class="pa-0">
                    <v-row>
                      <v-col cols="12" v-for="post in blogPosts" :key="post.id">
                        <v-card outlined :href="`https://www.gerowallet.io/post/${post.slug}`" target="_blank">
                          <v-card-text class="pa-0 text-center justify-center">
                            <v-row no-gutters>
                              <v-col
                                cols="3"
                                :style="{
                                  height: '200px',
                                  background: 'url(' + getImage(post) + ')',
                                  backgroundSize: 'cover',
                                  backgroundPosition: 'center',
                                }"
                              >
                              </v-col>
                              <v-col cols="9">
                                <v-card flat class="d-flex row fill-height" style="margin: 0">
                                  <v-card-text class="px-6 grow pb-0">
                                    <v-card-subtitle class="py-0 text-left" style="color: white; font-size: 12px">
                                      {{
                                        `${new Date(post.lastPublishedDate).toLocaleDateString()} • ${
                                          post.minutesToRead
                                        } ${$t('blog.minRead')}`
                                      }}
                                    </v-card-subtitle>
                                    <v-card-title style="word-break: break-word; color: white" class="text-left">
                                      {{ post.title }}
                                    </v-card-title>
                                    <v-card-subtitle style="word-break: break-word" class="text-left pb-0">
                                      {{ post.excerpt }}
                                    </v-card-subtitle>
                                  </v-card-text>
                                  <v-card-actions class="px-6" style="width: 100%">
                                    <div style="width: 100%; display: flex; align-items: center">
                                      {{ `${post.metrics.views} ${$t('blog.views')}` }}
                                      <v-spacer></v-spacer>
                                      <div>
                                        {{ `${post.metrics.likes} ` }}
                                        <v-icon>mdi-heart-outline</v-icon>
                                      </div>
                                    </div>
                                  </v-card-actions>
                                </v-card>
                              </v-col>
                            </v-row>
                          </v-card-text>
                        </v-card>
                      </v-col>
                    </v-row>
                  </v-card-text>
                </v-card>
              </v-col>
            </v-row>
          </v-card-text>
          <v-card-actions class="text-center justify-center pb-4" style="flex-flow: column">
            <div
              ref="sentinel"
              v-if="hasMorePosts && !search.trim()"
              style="height: 20px; width: 100%; background: transparent"
            ></div>
            <v-progress-circular
              indeterminate
              v-show="loadingMore && hasMorePosts"
              color="primary"
              size="24"
            ></v-progress-circular>
            <div
              v-if="!hasMorePosts && !search.trim() && Object.keys(posts).length > 0"
              class="text-caption text--secondary mt-2"
            >
              No more posts to load
            </div>
            <div v-if="search.trim() && blogPosts.length === 0" class="text-caption text--secondary mt-2">
              No posts found matching "{{ search }}"
            </div>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-layout>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from 'vue';
import { useIntersectionObserver } from '@vueuse/core';
import wixApi from '@/api/wix.api';

interface BlogPost {
  id: string;
  title: string;
  excerpt: string;
  slug: string;
  lastPublishedDate: string;
  minutesToRead: number;
  coverMedia?: {
    image?: {
      url: string;
    };
  };
  media?: {
    wixMedia?: {
      image?: {
        url: string;
      };
    };
    embedMedia?: {
      thumbnail?: {
        url: string;
      };
    };
  };
  metrics: {
    views: number;
    likes: number;
  };
}

const sentinel = ref<HTMLElement | null>(null);
const isIntersecting = ref<boolean>(false);
const loadingMore = ref<boolean>(false);
const isLoading = ref<boolean>(false);
const posts = ref<Record<string, BlogPost>>({});
const search = ref<string>('');
const hasMorePosts = ref<boolean>(true);
const error = ref<string | null>(null);
const currentPageSize = ref<number>(10);

const { stop } = useIntersectionObserver(
  sentinel,
  ([entry]) => {
    isIntersecting.value = entry.isIntersecting;
  },
  {
    threshold: 0.1,
    rootMargin: '50px',
  }
);

const loadPosts = async (isInitial = false) => {
  if (loadingMore.value && !isInitial) return;

  loadingMore.value = true;
  error.value = null;

  try {
    let response: any;

    if (isInitial) {
      currentPageSize.value = 10;
      response = await wixApi.getBlogPosts(currentPageSize.value);
    } else {
      currentPageSize.value += 10;
      response = await wixApi.getBlogPosts(currentPageSize.value);
    }

    if (response.status !== 200) {
      error.value = 'Failed to load blog posts. Please try again.';
      return;
    }

    const allPosts = response.data.posts || [];

    if (allPosts.length === 0) {
      hasMorePosts.value = false;
      return;
    }

    if (allPosts.length < currentPageSize.value) {
      hasMorePosts.value = false;
    }

    const postsMap = allPosts.reduce(function (map, el) {
      map[el.id] = el;
      return map;
    }, {});

    // Load metrics for all posts
    const statsPromises = [];
    Object.values(postsMap).forEach((post: any) => {
      statsPromises.push(
        wixApi
          .getPostMetrics(post.id)
          .then(res => {
            postsMap[post.id].metrics = res.data.metrics;
          })
          .catch(() => {
            postsMap[post.id].metrics = { views: 0, likes: 0 };
          })
      );
    });

    if (statsPromises.length > 0) {
      await Promise.all(statsPromises);
    }

    posts.value = postsMap;
  } catch (e) {
    error.value = 'Failed to load blog posts. Please check your connection and try again.';
    hasMorePosts.value = false;
  } finally {
    loadingMore.value = false;
  }
};

const getImage = (post: BlogPost): string | undefined => {
  if (post.coverMedia?.image) {
    return post.coverMedia.image.url;
  } else if (post.media) {
    if (post.media.wixMedia) {
      return post.media.wixMedia.image?.url;
    } else if (post.media.embedMedia) {
      return post.media.embedMedia.thumbnail?.url;
    }
  }
  return undefined;
};

const blogPosts = computed((): BlogPost[] => {
  const allPosts = Object.values(posts.value);

  if (search.value && search.value.trim()) {
    const searchTerm = search.value.toLowerCase().trim();
    return allPosts.filter(
      (post: BlogPost) =>
        post.title.toLowerCase().includes(searchTerm) || post.excerpt.toLowerCase().includes(searchTerm)
    );
  }

  return allPosts;
});

watch(isIntersecting, async val => {
  if (val && hasMorePosts.value && !loadingMore.value && !search.value.trim()) {
    await loadPosts(false);
  }
});

// Fallback scroll handler
const handleScroll = () => {
  if (!hasMorePosts.value || loadingMore.value || search.value.trim()) return;

  const windowHeight = window.innerHeight;
  const documentHeight = document.documentElement.scrollHeight;
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrolledToBottom = scrollTop + windowHeight >= documentHeight - 200;

  if (scrolledToBottom) {
    loadPosts(false);
  }
};

// Watch search to reset infinite scroll when searching
watch(search, (newVal, oldVal) => {
  if (!newVal.trim() && oldVal && oldVal.trim()) {
    // Search cleared, reset page size and reload
    currentPageSize.value = 10;
    hasMorePosts.value = true;
  }
});

onMounted(async () => {
  try {
    isLoading.value = true;
    await loadPosts(true);

    // Add scroll listener as fallback
    window.addEventListener('scroll', handleScroll, { passive: true });
  } catch (e) {
    // Handle error silently or show user-friendly message
  } finally {
    isLoading.value = false;
  }
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
  stop();
});
</script>
<style lang="scss">
.blog-search.theme--dark.v-text-field--solo > .v-input__control > .v-input__slot {
  background-color: var(--v-cardBackground-base) !important;
}
</style>
