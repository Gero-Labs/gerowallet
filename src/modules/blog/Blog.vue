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
          <v-text-field hide-details solo dense prepend-inner-icon="mdi-magnify" label="Search" outlined></v-text-field>
        </v-col>
        <v-col cols="12" v-for="post in posts" :key="post.id">
          <v-card
            outlined
            @click="selectPost(post)"
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
                      <v-card-title style="word-break: break-word" class="justify-center text-center">
                        {{post.title}}
                      </v-card-title>
                      <v-divider></v-divider>
                    </v-card-text>
                    <v-card-actions class="d-flex column px-6" style="width: 100%">
                      <div style="width: 100%; display: flex; align-items: center;">
                        {{ `${post.metrics.views} views` }}
                        <v-spacer></v-spacer>
                        <div>
                          {{ `${post.metrics.likes} ` }}
                          <v-btn icon>
                            <v-icon>mdi-heart</v-icon>
                          </v-btn>
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
  methods: {
    onIntersect(entries, observer) {
      this.isIntersecting = entries[0].isIntersecting
    },
    async loadPosts() {
      const members = new Set<string>()
      let response
      if (this.nextPage) {
        response = await this.api.getBlogPosts(3, this.nextPage)
      } else {
        response = await this.api.getBlogPosts(3)
      }
      const posts = response.posts.reduce(function(map, el) {
        console.log(map)
        map[el.id] = el
        return map;
      }, {})
      const statsPromises = []
      Object.values(posts).forEach((post: any) => {
        members.add(post.memberId)
        statsPromises.push(this.api.getPostMetrics(post.id).then(res => {
          console.log(res)
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
    selectPost(post) {
      console.log(post);
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
      posts: [],
      members: {},
      stats: {},
      api: undefined,
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
