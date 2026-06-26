<template>
  <div class="feed-page">
    <header class="feed-page__head">
      <h2 class="feed-page__title white--text">{{ $t('copilot.feedTitle') }}</h2>
      <div class="feed-page__actions">
        <v-btn
          icon
          small
          :disabled="feed.busy.value"
          @click="feed.refresh()"
        >
          <v-icon small color="white">mdi-refresh</v-icon>
        </v-btn>
      </div>
    </header>

    <p class="feed-page__disclaimer grey--text">{{ $t('copilot.feed.disclaimer') }}</p>

    <div v-if="items.length === 0" class="feed-page__empty grey--text">
      {{ $t('copilot.feed.empty') }}
    </div>
    <ul v-else class="feed-page__list">
      <li v-for="item in items" :key="item.id" class="feed-page__item">
        <span class="feed-page__time grey--text">{{ formatTime(item.ts) }}</span>
        <p class="feed-page__text white--text">{{ $t(item.textKey, item.params) }}</p>
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, onMounted } from 'vue';
import { copilotFeed } from '@/sidepanel/composables/useCopilotFeed';
import { copilotFeedStore } from '@/stores/copilotFeedStore';

export default defineComponent({
  name: 'FeedPage',
  setup() {
    const feed = copilotFeed;
    const items = computed(() => copilotFeedStore.items);

    function formatTime(ts: number): string {
      return new Date(ts).toLocaleTimeString();
    }

    onMounted(() => {
      feed.refresh();
    });

    return { feed, items, formatTime };
  },
});
</script>

<style scoped>
.feed-page {
  padding: 12px 16px;
}

.feed-page__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.feed-page__title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.feed-page__disclaimer {
  font-size: 10px;
  opacity: 0.5;
  margin: 2px 0 10px;
}

.feed-page__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.feed-page__item {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
}

.feed-page__time {
  font-size: 11px;
  opacity: 0.55;
}

.feed-page__text {
  margin: 2px 0 0;
  font-size: 13px;
}

.feed-page__empty {
  opacity: 0.6;
  text-align: center;
  padding: 28px 12px;
  font-size: 13px;
}
</style>
