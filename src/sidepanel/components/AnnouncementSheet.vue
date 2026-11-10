<template>
  <BottomSheet :model-value="openId !== null" height="85%" @update:model-value="(isOpen) => { if (!isOpen) close(); }">
    <div class="announce-sheet">
      <div class="announce-sheet__head">
        <img v-if="showMark" :src="assets.geroNoText" alt="" class="announce-sheet__mark" />
        <v-icon v-else size="32" :color="headerIconColor" class="announce-sheet__mark">{{ headerIcon }}</v-icon>
        <div class="announce-sheet__titles">
          <div class="announce-sheet__title">{{ title }}</div>
          <AnnouncementMeta v-if="item" :item="item" />
        </div>
        <button type="button" class="announce-sheet__close" :aria-label="$t('common.close')" @click="close()">
          <v-icon size="18" color="var(--g-text-2)">mdi-close</v-icon>
        </button>
      </div>

      <p v-if="ended" class="announce-sheet__plain">{{ $t('announce.ended.body') }}</p>
      <template v-else-if="item && text">
        <AnnouncementImage v-if="hero" :sha256="hero.sha256" :width="hero.w" :height="hero.h" alt="" />
        <AnnouncementBody v-if="text.body" :markdown="text.body" :media="item.document.media" compact />
        <p v-else class="announce-sheet__plain">{{ text.summary }}</p>
      </template>
      <template v-else-if="loading">
        <div class="g-skeleton announce-sheet__skeleton"></div>
        <div class="g-skeleton announce-sheet__skeleton announce-sheet__skeleton--short"></div>
      </template>
    </div>

    <!-- The footer stays in reach of the thumb. An action that leaves the panel says so on its label. -->
    <template #footer>
      <div class="announce-sheet__foot">
        <GButton v-if="action" tier="primary" block @click="run()">
          {{ actionLabel }}
          <v-icon v-if="action.type === 'url'" size="16" class="ml-2">mdi-open-in-new</v-icon>
        </GButton>
        <GButton v-else tier="secondary" block @click="close()">{{ $t('common.close') }}</GButton>
        <AnnouncementSigned v-if="item" :tier="item.tier" compact class="announce-sheet__signed" />
      </div>
    </template>
  </BottomSheet>
</template>

<script setup lang="ts">
// The full announcement in Mini Gero: the dashboard dialog's content in the panel's bottom sheet,
// after the "Side panel sheet" artboard. Same composable, so the same rules for what is shown and
// where the action may lead; an action with no side-panel page opens the dashboard on it.
import BottomSheet from './BottomSheet.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import AnnouncementBody from '@/shared/components/announcements/AnnouncementBody.vue';
import AnnouncementImage from '@/shared/components/announcements/AnnouncementImage.vue';
import AnnouncementMeta from '@/shared/components/announcements/AnnouncementMeta.vue';
import AnnouncementSigned from '@/shared/components/announcements/AnnouncementSigned.vue';
import { useAnnouncementView } from '@/shared/components/announcements/useAnnouncementView';
import assets from '@/utils/assets';

const { openId, item, loading, ended, text, title, showMark, headerIcon, headerIconColor, hero, action, actionLabel, close, run } = useAnnouncementView('sidepanel');
</script>

<style scoped lang="scss">
.announce-sheet { display: flex; flex-direction: column; gap: var(--g-s-4); }
.announce-sheet__head { display: flex; align-items: flex-start; gap: var(--g-s-3); }
.announce-sheet__mark { width: 36px; height: 36px; flex-shrink: 0; object-fit: contain; }
.announce-sheet__titles { display: flex; flex-direction: column; gap: 6px; flex: 1 1 auto; min-width: 0; }
.announce-sheet__title { font-size: 16px; font-weight: 600; line-height: 1.3; color: var(--g-text-1); overflow-wrap: anywhere; }
/* 44px: the panel is used with a thumb as often as a pointer. */
.announce-sheet__close {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  margin: -8px -10px 0 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--g-r-control);
  background: none;
  cursor: pointer;
  &:hover { background: var(--g-hairline-1); }
}
.announce-sheet__plain { margin: 0; font-size: 14px; color: var(--g-text-2); }
.announce-sheet__skeleton { height: 14px; width: 90%; }
.announce-sheet__skeleton--short { width: 60%; }
.announce-sheet__foot { display: flex; flex-direction: column; gap: 10px; }
.announce-sheet__signed { justify-content: center; }
</style>
