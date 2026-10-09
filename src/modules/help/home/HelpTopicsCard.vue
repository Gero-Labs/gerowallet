<template>
  <HelpCard id="help-topics-title" :title="t('help.topics')" class="topics">
    <template #action><GButton tier="tertiary" compact :to="answersTo()" @click="home('all_answers')">{{ t('help.answers') }}</GButton></template>
    <div class="topics-grid">
      <router-link
        v-for="topic in topics" :key="topic.id" :to="destination('/help/topics/' + topic.id, basic ? { basic: '1' } : {})"
        class="glass-tier topic-tile" :class="{ 'topic-tile--muted': topic.demoted }" @click.native="home('topic')"
      >
        <span class="topic-copy">
          <span class="topic-title">{{ t('help.topic.' + topic.id) }}</span>
          <span class="t-body-sm topic-desc">{{ t('help.description.' + topic.id) }}</span>
          <span class="t-caption g-num">{{ topic.demoted ? t('help.' + topic.reason) : tc('help.count', topic.count, { count: topic.count }) }}</span>
        </span>
        <IsoScene :name="topic.scene" class="topic-scene" />
      </router-link>
    </div>
  </HelpCard>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import type { TopicEntry } from '../helpContent';
import { useHelpNavigation } from '../helpNavigation';
import { useHelpTracking } from '../useHelpTracking';
import HelpCard from './HelpCard.vue';

defineProps<{ topics: TopicEntry[]; basic: boolean }>();
const { t, tc } = useTranslation();
const { answersTo, destination } = useHelpNavigation();
const { home } = useHelpTracking();
</script>

<style lang="scss" scoped>
.topics { gap: var(--g-s-4); }
.topics-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--g-s-3); }
.topic-tile {
  display: flex; align-items: center; gap: var(--g-s-3); min-width: 0; padding: var(--g-s-4) var(--g-s-3) var(--g-s-4) var(--g-s-4); text-decoration: none;
  transition: border-color var(--g-dur-fast) var(--g-ease), background-color var(--g-dur-fast) var(--g-ease);
  &:hover { @include g-glass-tier-hover; }
}
.topic-copy { flex: 1 1 auto; display: flex; flex-direction: column; gap: var(--g-s-1); min-width: 0; }
.topic-title { font-size: 15px; font-weight: 550; color: var(--g-text-1); }
.topic-desc { line-height: 1.45; }
.topic-scene { flex: none; width: 112px; height: auto; display: block; transition: transform var(--g-dur-fast) var(--g-ease); }
.topic-tile:hover .topic-scene { transform: translateY(-3px); }
/* A demoted topic stays reachable but recedes: muted title, half-strength scene, reason instead of a count. */
.topic-tile--muted .topic-title { color: var(--g-text-2); }
.topic-tile--muted .topic-scene { opacity: 0.5; }
@media (max-width: 960px) {
  .topics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .topics-grid { gap: var(--g-s-2); }
  .topic-tile { flex-direction: column; align-items: flex-start; gap: var(--g-s-2); padding: var(--g-s-3) 14px 14px; }
  .topic-scene { order: -1; align-self: center; }
  .topic-desc { display: none; }
  .topic-title { font-size: 14px; line-height: 1.3; }
}
@media (prefers-reduced-motion: reduce) {
  .topic-tile:hover .topic-scene { transform: none; }
}
</style>
