<template>
  <!-- Bytes the worker fetched by hash and checked against the signed document. Never a remote URL. -->
  <img v-if="url" class="announce-image announce-image--loaded" :src="url" :alt="alt" :style="ratioStyle" />
  <div v-else-if="url === undefined" class="announce-image g-skeleton" :style="ratioStyle" aria-hidden="true"></div>
  <div v-else class="announce-image announce-image--missing" :style="ratioStyle" role="img" :aria-label="$t('announce.image.unavailable')">
    <v-icon size="24" color="var(--g-text-3)">mdi-image-off-outline</v-icon>
    <span>{{ $t('announce.image.unavailable') }}</span>
  </div>
</template>

<script setup lang="ts">
// One announcement image: a hero or a line of the body. The slot keeps its size in all three
// states (loading, shown, unavailable), so the text around it never jumps.
import { computed } from 'vue';
import { announcementsStore } from '@/stores/announcementsStore';

const props = defineProps<{ sha256: string; alt?: string; width?: number; height?: number }>();

const url = computed(() => announcementsStore.imageUrl(props.sha256));
/** The signed dimensions, so the slot has the image's shape before the bytes arrive. */
const ratioStyle = computed(() => (props.width && props.height ? { aspectRatio: `${props.width} / ${props.height}` } : undefined));
</script>

<style scoped lang="scss">
.announce-image {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: var(--g-r-card);
  border: 1px solid var(--g-hairline-1);
}
.announce-image--loaded { height: auto; object-fit: cover; }
/* A resting slot, not a surface: solid so the "unavailable" words read on any backdrop. */
.announce-image--missing {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-2);
  background: var(--g-raised);
  color: var(--g-text-3);
  font-size: 12px;
}
</style>
