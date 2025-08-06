<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <v-card class="transparent" flat>
          <v-card-title class="justify-center text-center" style="font-size: 32px">
            Blog Posts
          </v-card-title>
          <v-card-text class="pb-0">
            <v-row>
              <v-col cols="12" xl="8" lg="8" md="8">

              </v-col>
              <v-col cols="12" xl="4" lg="4" md="4">
                <v-text-field class="blog-search" v-model="search" clearable hide-details solo dense prepend-inner-icon="mdi-magnify" label="Search" outlined></v-text-field>
              </v-col>
              <v-col cols="12">
                <v-card flat :loading="isLoading" class="transparent" style="box-shadow: none!important; backdrop-filter: unset!important;">
                  <v-card-text class="pa-0">
                    <v-row>
                      <v-col cols="12" v-for="post in blogPosts" :key="post.id">
                        <v-card
                          outlined
                          :href="`https://www.gerowallet.io/post/${post.slug}`"
                          target="_blank"
                        >
                          <v-card-text class="pa-0 text-center justify-center" >
                            <v-row no-gutters>
                              <v-col cols="3" :style="{height: '200px', background: 'url('+getImage(post)+')', backgroundSize: 'cover', backgroundPosition: 'center' }">
                              </v-col>
                              <v-col cols="9">
                                <v-card flat class="d-flex row fill-height" style="margin: 0">
                                  <v-card-text class="px-6 grow pb-0">
                                    <v-card-subtitle class="py-0 text-left" style="color: white; font-size: 12px">
                                      {{`${new Date(post.lastPublishedDate).toLocaleDateString()} • ${post.minutesToRead} min read` }}
                                    </v-card-subtitle>
                                    <v-card-title style="word-break: break-word; color: white" class="text-left">
                                      {{post.title}}
                                    </v-card-title>
                                    <v-card-subtitle  style="word-break: break-word" class="text-left pb-0">
                                      {{post.excerpt}}
                                    </v-card-subtitle>
                                  </v-card-text>
                                  <v-card-actions class="px-6" style="width: 100%">
                                    <div style="width: 100%; display: flex; align-items: center;">
                                      {{ `${post.metrics.views} views` }}
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
          <v-card-actions class="text-center justify-center pb-4" style="flex-flow: column;">
            <div ref="sentinel" style="height:1px; width:100%"></div>
            <v-progress-circular indeterminate v-show="loadingMore"></v-progress-circular>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-layout>
</template>
<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue';
import { useIntersectionObserver } from '@vueuse/core';
import wixApi from '@/api/wix.api';

const sentinel = ref<HTMLElement | null>(null);
const isIntersecting = ref<boolean>(false);
const nextPage = ref<string>('');
const loadingMore = ref<boolean>(false);
const isLoading = ref<boolean>(false);
const posts = ref<any>({});
const api = ref<any>(undefined);
const search = ref<string>('');

const { stop } = useIntersectionObserver(
  sentinel,
  ([entry]) => { isIntersecting.value = entry.isIntersecting; },
  { threshold: 0.1 },
);

const loadPosts = async () => {
  try {
    let response: any
    if (nextPage.value) {
      response = await wixApi.getBlogPosts(10, nextPage.value)
    } else {
      response = await wixApi.getBlogPosts(10)
    }
    if (response.status !== 200) {
      console.warn(response)
      return;
    }
    const postsMap = response.data.posts.reduce(function(map, el) {
      map[el.id] = el
      return map;
    }, {})
    const statsPromises = []
    Object.values(postsMap).forEach((post: any) => {
      statsPromises.push(wixApi.getPostMetrics(post.id).then(res => {
        postsMap[post.id].metrics = res.data.metrics
      }))
    })
    if (statsPromises.length > 0) {
      await Promise.all(statsPromises)
    }
    nextPage.value = response.data.metaData.cursor || null
    posts.value = {
      ...posts.value,
      ...postsMap
    }
  } catch (e) {
    console.error(e)
  }
}

const getImage = (post: any) => {
  if (post.coverMedia?.image) {
    return post.coverMedia?.image?.url
  } else if (post.media) {
    if (post.media.wixMedia) {
      return post.media.wixMedia?.image?.url
    } else if (post.media.embedMedia) {
      return post.media?.embedMedia?.thumbnail?.url
    }
  }
  return undefined
}

const blogPosts = computed(() => {
  if (search.value) {
    return Object.values(posts.value).filter((post: any) => post.title.toLowerCase().includes(search.value) || post.excerpt.toLowerCase().includes(search.value))
  }
  return Object.values(posts.value)
});

watch(isIntersecting, async val => {
  if (val && nextPage.value) {
    loadingMore.value = true;
    await loadPosts();
    loadingMore.value = false;
  }
});

onMounted(async () => {
  try {
    isLoading.value = true
    await loadPosts();
  } catch (e) {
    console.error(e)
  } finally {
    isLoading.value = false
  }
});
</script>
<style lang="scss">
.blog-search.theme--dark.v-text-field--solo > .v-input__control > .v-input__slot {
  background-color: var(--v-cardBackground-base) !important;
}
</style>
