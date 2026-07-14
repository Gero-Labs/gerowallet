<template>
  <div class="feed-page">
    <!-- First run: the stepped wizard. Once onboarded: the feed + gear. -->
    <FeedOnboarding v-if="!settings.onboarded" @done="onOnboardingDone" />

    <template v-else>
      <header class="feed-page__head">
        <h2 class="feed-page__title">{{ $t('copilot.feedTitle') }}</h2>
        <div class="feed-page__actions">
          <v-btn icon small @click="settingsOpen = true">
            <v-icon small color="var(--g-text-1)">mdi-cog-outline</v-icon>
          </v-btn>
          <v-btn icon small :disabled="feed.busy.value" @click="feed.refresh()">
            <v-icon small color="var(--g-text-1)">mdi-refresh</v-icon>
          </v-btn>
        </div>
      </header>

      <p class="feed-page__disclaimer">{{ $t('copilot.feed.disclaimer') }}</p>

      <div v-if="items.length === 0" class="feed-page__empty">
        {{ $t('copilot.feed.empty') }}
      </div>
      <ul v-else class="feed-page__list">
        <li v-for="item in items" :key="item.id" class="feed-page__item">
          <span class="feed-page__time">{{ formatTime(item.ts) }}</span>
          <p class="feed-page__text">{{ $t(item.textKey, item.params) }}</p>
        </li>
      </ul>
    </template>

    <FeedSettingsSheet v-model="settingsOpen" />
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, onMounted } from 'vue';
import { copilotFeed } from '@/sidepanel/composables/useCopilotFeed';
import { copilotFeedSettings } from '@/sidepanel/composables/useCopilotFeedSettings';
import { copilotFeedStore } from '@/stores/copilotFeedStore';
import FeedOnboarding from '@/sidepanel/components/copilot/FeedOnboarding.vue';
import FeedSettingsSheet from '@/sidepanel/components/copilot/FeedSettingsSheet.vue';

export default defineComponent({
  name: 'FeedPage',
  components: { FeedOnboarding, FeedSettingsSheet },
  setup() {
    const feed = copilotFeed;
    const settings = copilotFeedSettings;
    const items = computed(() => copilotFeedStore.items);
    const settingsOpen = ref(false);

    function formatTime(ts: number): string {
      return new Date(ts).toLocaleTimeString();
    }

    // Onboarding completes -> mark done and run the first detection so the user
    // sees items immediately (onMounted already ran while the wizard was showing).
    function onOnboardingDone() {
      settings.completeOnboarding();
      feed.refresh();
    }

    onMounted(() => {
      if (settings.onboarded) feed.refresh();
    });

    return { feed, settings, items, settingsOpen, formatTime, onOnboardingDone };
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
  color: var(--g-text-1);
}

.feed-page__actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.feed-page__disclaimer {
  font-size: 11px;
  opacity: 0.5;
  margin: 2px 0 10px;
  color: var(--g-text-3);
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
  border-radius: var(--g-r-card);
  background: var(--g-surface);
}

.feed-page__time {
  font-size: 11px;
  opacity: 0.55;
  color: var(--g-text-3);
}

.feed-page__text {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--g-text-1);
}

.feed-page__empty {
  opacity: 0.6;
  text-align: center;
  padding: 28px 12px;
  font-size: 13px;
  color: var(--g-text-3);
}
</style>
