<template>
  <div class="announce-body" :class="{ 'announce-body--compact': compact }">
    <template v-for="(segment, i) in segments" :key="i">
      <!-- v-html is safe here and ONLY here: each prose segment goes through renderMarkdown, which
           HTML-escapes all input before it renders a small markdown subset, writes no <img>, and
           links only the destinations bodyLinkAllowed accepts (Gero's own sites). Images never
           pass through it: splitBody lifted them out, and AnnouncementImage draws them. -->
      <div v-if="segment.kind === 'prose'" class="g-prose announce-body__prose" :class="{ 'g-prose--compact': compact }" v-html="html[i]"></div>
      <AnnouncementImage v-else :sha256="segment.sha256" :alt="segment.alt" :width="sizes[segment.sha256]?.w" :height="sizes[segment.sha256]?.h" />
    </template>
  </div>
</template>

<script setup lang="ts">
// The body of an announcement: prose and the images between it. The text was signed by Gero and
// verified by the worker; it is still rendered as untrusted markdown, so a compromised signing key
// could at worst show words, never markup, a remote image or a link off Gero's sites.
import { computed } from 'vue';
import { bodyLinkAllowed, splitBody } from '@/services/announcements/announcementBody';
import type { AnnouncementMedia } from '@/services/announcements/announcementRules';
import { renderMarkdown } from '@/shared/utils/renderMarkdown';
import AnnouncementImage from './AnnouncementImage.vue';

const props = defineProps<{ markdown: string; media: AnnouncementMedia[]; compact?: boolean }>();

const segments = computed(() => splitBody(props.markdown, props.media));
const html = computed(() => segments.value.map((s) => (s.kind === 'prose' ? renderMarkdown(s.markdown, { emphasis: true, linkAllowed: bodyLinkAllowed }) : '')));
const sizes = computed(() => Object.fromEntries(props.media.map((m) => [m.sha256, { w: m.w, h: m.h }])) as Record<string, { w: number; h: number } | undefined>);
</script>

<style scoped lang="scss">
.announce-body { display: flex; flex-direction: column; gap: var(--g-s-5); }
.announce-body--compact { gap: var(--g-s-4); }
/* The dialog and the sheet set the measure; the prose fills it. */
.announce-body .announce-body__prose { max-width: none; }
</style>
