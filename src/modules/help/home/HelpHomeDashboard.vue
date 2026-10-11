<template>
  <div class="hc-grid">
    <HelpHero class="hc-span-2" />
    <HelpSupportWidget class="hc-support" />
    <HelpContentStatus class="hc-status" :loading="loading" :failed="failed" :stale="stale" :has-remote="hasRemote" @retry="$emit('retry')" />
    <HelpMostViewed class="hc-tall" :items="viewed.items" :ranked="viewed.ranked" />
    <HelpLatestTutorial :tutorial="tutorial" />
    <HelpBlogCard />
    <HelpXCard />
    <HelpEcosystemNews />
    <HelpTopicsCard class="hc-span-3" :topics="topics" :basic="basic" />
  </div>
</template>

<script setup lang="ts">
import type { TopicEntry } from '../helpContent';
import type { LatestTutorial, MostViewed } from '../helpHome';
import HelpContentStatus from '../HelpContentStatus.vue';
import HelpBlogCard from './HelpBlogCard.vue';
import HelpEcosystemNews from './HelpEcosystemNews.vue';
import HelpHero from './HelpHero.vue';
import HelpLatestTutorial from './HelpLatestTutorial.vue';
import HelpMostViewed from './HelpMostViewed.vue';
import HelpSupportWidget from './HelpSupportWidget.vue';
import HelpTopicsCard from './HelpTopicsCard.vue';
import HelpXCard from './HelpXCard.vue';

defineProps<{
  topics: TopicEntry[]; viewed: MostViewed; tutorial: LatestTutorial | null; basic: boolean;
  loading: boolean; failed: boolean; stale: boolean; hasRemote: boolean;
}>();
defineEmits<{ (e: 'retry'): void }>();
</script>

<style scoped>
/* Three columns; auto-placement gives hero + support, a tall "most viewed" beside four cards, then topics. */
.hc-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--g-s-5); align-items: stretch; }
.hc-span-2 { grid-column: span 2; }
.hc-span-3 { grid-column: span 3; }
.hc-tall { grid-row: span 2; }
/* Loading / failed / stale lines take their own row directly under the hero, only while there is one to show. */
.hc-status { grid-column: 1 / -1; }
@media (max-width: 960px) {
  .hc-grid { grid-template-columns: minmax(0, 1fr); }
  .hc-span-2, .hc-span-3, .hc-tall, .hc-status { grid-column: auto; grid-row: auto; }
  .hc-support { order: 10; }
}
</style>
