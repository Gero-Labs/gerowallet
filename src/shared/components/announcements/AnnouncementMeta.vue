<template>
  <span class="announce-meta">
    <span class="announce-chip">{{ $t(`announce.kind.${item.document.kind}`) }}</span>
    <span v-if="tone !== 'neutral'" class="announce-chip" :class="`announce-chip--${tone}`">{{ $t(`announce.severity.${item.document.severity}`) }}</span>
    <span class="announce-meta__date">{{ date }}</span>
  </span>
</template>

<script setup lang="ts">
// The line under an announcement's title: what kind it is, how serious (in words, unless it is
// plain information), and when Gero signed it.
import { computed } from 'vue';
import type { StoredAnnouncement } from '@/stores/announcementsStore';
import { announcementDate, toneOf } from './announcementView';

const props = defineProps<{ item: StoredAnnouncement }>();
const tone = computed(() => toneOf(props.item));
const date = computed(() => announcementDate(props.item.document.ts, props.item.document.kind === 'service'));
</script>

<style scoped lang="scss">
.announce-meta { display: inline-flex; align-items: center; flex-wrap: wrap; gap: var(--g-s-2); color: var(--g-text-2); font-size: 12px; }
/* A chip is a control-sized label, not a surface: solid, so the word reads on any backdrop. */
.announce-chip {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--g-r-chip);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-2);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.announce-chip--warning { background: var(--g-warning-fill); border-color: var(--g-warning-line); color: var(--g-warning); }
.announce-chip--error { background: var(--g-error-fill); border-color: var(--g-error-line); color: var(--g-error); }
</style>
