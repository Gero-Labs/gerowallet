<template>
  <BaseDialog
    :isOpen="openId !== null"
    size="lg"
    :min-height="0"
    height="90vh"
    :title="title"
    :img="showMark ? assets.geroNoText : undefined"
    :icon="showMark ? undefined : headerIcon"
    :icon-color="headerIconColor"
    @close="close()"
  >
    <template v-if="item" #meta>
      <AnnouncementMeta :item="item" />
    </template>

    <!-- Focusable, and so the first thing the dialog's focus trap lands on. Without it the first
         focusable element is a link somewhere in the body, and the dialog opens scrolled down to
         it. It also lets the keyboard scroll a long announcement. -->
    <v-card-text class="announce-dialog__body" tabindex="0" role="region" :aria-label="title">
      <p v-if="ended" class="announce-dialog__ended">{{ $t('announce.ended.body') }}</p>
      <template v-else-if="item && text">
        <AnnouncementImage v-if="hero" :sha256="hero.sha256" :width="hero.w" :height="hero.h" alt="" />
        <AnnouncementBody v-if="text.body" :markdown="text.body" :media="item.document.media" />
        <!-- A headline has no body: its summary is all there is to read here. -->
        <p v-else class="announce-dialog__summary">{{ text.summary }}</p>
      </template>
      <template v-else-if="loading">
        <div class="g-skeleton announce-dialog__skeleton announce-dialog__skeleton--wide"></div>
        <div class="g-skeleton announce-dialog__skeleton"></div>
        <div class="g-skeleton announce-dialog__skeleton announce-dialog__skeleton--short"></div>
      </template>
    </v-card-text>

    <v-card-actions class="announce-dialog__foot">
      <div v-if="item" class="announce-dialog__provenance">
        <AnnouncementSigned />
        <!-- A link that leaves the wallet names where it goes before it is clicked. -->
        <span v-if="action && action.type === 'url'" class="announce-dialog__leaves">{{ $t('announce.action.opensHost', { host: action.host }) }}</span>
      </div>
      <div class="announce-dialog__buttons">
        <GButton tier="secondary" @click="close()">{{ $t('common.close') }}</GButton>
        <GButton v-if="action" tier="primary" @click="run()">
          {{ actionLabel }}
          <v-icon v-if="action.type === 'url'" size="16" class="ml-2">mdi-open-in-new</v-icon>
        </GButton>
      </div>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
// The full announcement on the dashboard, after the "Announcement dialog" artboards. Everything
// shown was signed by Gero and verified by the worker; the body is still rendered as untrusted
// markdown (AnnouncementBody) and the one action goes only where announcementView allows.
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import assets from '@/utils/assets';
import AnnouncementBody from './AnnouncementBody.vue';
import AnnouncementImage from './AnnouncementImage.vue';
import AnnouncementMeta from './AnnouncementMeta.vue';
import AnnouncementSigned from './AnnouncementSigned.vue';
import { useAnnouncementView } from './useAnnouncementView';

const { openId, item, loading, ended, text, title, showMark, headerIcon, headerIconColor, hero, action, actionLabel, close, run } = useAnnouncementView('dashboard');
</script>

<style scoped lang="scss">
.announce-dialog__body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-5);
  padding: var(--g-s-1) var(--g-s-5) 0;
}
.announce-dialog__ended,
.announce-dialog__summary { margin: 0; font-size: 14px; color: var(--g-text-2); }
.announce-dialog__skeleton { height: 14px; width: 84%; }
.announce-dialog__skeleton--wide { width: 100%; aspect-ratio: 16 / 9; height: auto; border-radius: var(--g-r-card); }
.announce-dialog__skeleton--short { width: 60%; }
.announce-dialog__foot {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--g-s-4);
  margin-top: var(--g-s-5);
  padding: var(--g-s-4) var(--g-s-5) var(--g-s-1);
  border-top: 1px solid var(--g-hairline-1);
}
.announce-dialog__provenance { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.announce-dialog__leaves { font-size: 12px; color: var(--g-text-2); }
.announce-dialog__buttons { display: flex; gap: var(--g-s-3); margin-left: auto; }
</style>
