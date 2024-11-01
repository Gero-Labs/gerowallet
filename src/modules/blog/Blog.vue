<template>
  <v-card class="transparent" flat>
    <v-card-title class="justify-center text-center" style="font-size: 32px">
      Blog Posts
    </v-card-title>
    <v-card-text>
      <v-row>
        <v-col cols="12" xl="8" lg="8" md="8">

        </v-col>
        <v-col cols="12" xl="4" lg="4" md="4">
          <v-text-field v-model="search" clearable hide-details solo dense prepend-inner-icon="mdi-magnify" label="Search" outlined></v-text-field>
        </v-col>
        <v-col cols="12">
          <v-card flat :loading="isLoading" class="transparent">
            <v-card-text class="px-0">
              <v-row>
                <v-col cols="12" v-for="post in blogPosts" :key="post.id">
                  <v-card
                    outlined
                    :href="`https://www.gerowallet.io/post/${post.slug}`"
                    target="_blank"
                  >
                    <v-card-text class="pa-0 text-center justify-center" >
                      <v-row no-gutters>
                        <v-col cols="4" :style="{height: '300px', background: 'url('+getImage(post)+')', backgroundSize: 'cover', backgroundPosition: 'center' }">
                        </v-col>
                        <v-col cols="8">
                          <v-card flat class="d-flex row fill-height" style="margin: 0">
                            <v-card-text class="px-6 grow">
                              <v-card-title class="justify-center text-center pt-0">
                                <v-avatar size="48">
                                  <v-img :src="require('@/assets/svg/unknown-profile.svg')"></v-img>
                                </v-avatar>
                              </v-card-title>
                              <v-card-subtitle class="py-0" style="color: white; font-size: 12px">
                                {{members[post.memberId]?.profile.nickname}}
                              </v-card-subtitle>
                              <v-card-subtitle class="py-0" style="color: white; font-size: 12px">
                                {{`${new Date(post.lastPublishedDate).toLocaleDateString()} • ${post.minutesToRead} min read` }}
                              </v-card-subtitle>
                              <v-card-title style="word-break: break-word; color: white" class="text-left">
                                {{post.title}}
                              </v-card-title>
                              <v-card-subtitle  style="word-break: break-word" class="text-left">
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
    <v-card-actions v-intersect="onIntersect" class="text-center justify-center">
      <v-progress-circular indeterminate v-show="loadingMore" class="py-10"></v-progress-circular>
    </v-card-actions>
  </v-card>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import { useStore } from '@/store';

export default defineComponent({
  name: 'Blog',
  watch: {
    async isIntersecting(val) {
      if (val) {
        if (this.nextPage) {
          this.loadingMore = true
          await this.loadPosts()
          this.loadingMore = false
        }
      }
    }
  },
  computed: {
    blogPosts() {
      if (this.search) {
        return Object.values(this.posts).filter((post: any) => post.title.includes(this.search) || post.excerpt.includes(this.search))
      }
      return Object.values(this.posts)
    }
  },
  methods: {
    onIntersect(entries, observer) {
      this.isIntersecting = entries[0].isIntersecting
    },
    async loadPosts() {
      const members = new Set<string>()
      let response
      if (this.nextPage) {
        response = await this.api.getBlogPosts(10, this.nextPage)
      } else {
        response = await this.api.getBlogPosts(10)
      }
      const posts = response.posts.reduce(function(map, el) {
        map[el.id] = el
        return map;
      }, {})
      const statsPromises = []
      Object.values(posts).forEach((post: any) => {
        members.add(post.memberId)
        statsPromises.push(this.api.getPostMetrics(post.id).then(res => {
          posts[post.id].metrics = res.metrics
        }))
      })
      if (statsPromises.length > 0) {
        await Promise.all(statsPromises)
      }
      this.nextPage = response.metaData.cursor || null
      const membersPromises = []
      members.forEach((member: string) => {
        if (!this.members[member]) {
          membersPromises.push(this.api.getMember(member))
        }
      })
      if (membersPromises.length > 0) {
        const res = await Promise.all(membersPromises)
        this.members = res.reduce(function(map, el) {
          map[el.member.id] = el.member
          return map
        }, {})
      }
      this.posts = {
        ...this.posts,
        ...posts
      }
    },
    getImage(post) {
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
  },
  data() {
    return {
      isIntersecting: false,
      nextPage: null,
      loadingMore: false,
      isLoading: false,
      posts: {} as any,
      members: {},
      stats: {},
      api: undefined,
      search: '',
    }
  },
  async mounted() {
    try {
      this.api = useStore().getWallet.api
      this.isLoading = true
      await this.loadPosts()
    } catch (e) {
      console.error(e)
    } finally {
      this.isLoading = false
    }
  }
});
</script>
<style scoped>

</style>
