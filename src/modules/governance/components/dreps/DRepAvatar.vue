<template>
  <span class="drep-avatar" :style="boxStyle" aria-hidden="true">
    <img
      v-if="src && !broken"
      class="drep-avatar__img"
      :src="src"
      alt=""
      referrerpolicy="no-referrer"
      loading="lazy"
      decoding="async"
      @error="broken = true"
    />
    <span v-else-if="initial" class="drep-avatar__initial" :style="initialStyle">{{ initial }}</span>
    <v-icon v-else :size="glyphSize" color="var(--g-text-3)">mdi-account-outline</v-icon>
  </span>
</template>

<script setup lang="ts">
/**
 * A DRep's published avatar, or a legible stand-in for it.
 *
 * Three facts drive this component:
 *
 *  1. The image URL comes out of CIP-119 metadata the DRep wrote, so it is
 *     third-party input. It is resolved through `toInAppUrl`, which allows only
 *     http(s) and maps IPFS onto gero-backend's proxy — an `ipfs://` avatar (the
 *     Cardano Foundation's among them) simply did not render before, because
 *     nothing in the browser resolves that scheme and the public gateways refuse
 *     cross-origin extension requests outright.
 *  2. A hosted image can 404, expire, or be pulled. `@error` swaps in the
 *     fallback rather than leaving the browser's broken-image glyph, which reads
 *     as a defect in the wallet rather than an absence upstream.
 *  3. The box is a FIXED square in every state. The image, the initial and the
 *     glyph all occupy exactly `size`, so nothing on the row moves when a slow
 *     avatar arrives or fails.
 *
 * Props are deliberately generic (a URL, a name, a size) so the directory, the
 * profile and the status hero can all mount it without agreeing on a record
 * shape between them.
 */
import { computed, ref, watch } from 'vue';
import { toInAppUrl } from '@/modules/governance/utils/govAnchor';

const props = defineProps({
  /** The raw `body.image.contentUrl` from CIP-119 metadata. http(s) or ipfs. */
  imageUrl: {
    type: String,
    default: null,
  },
  /** The DRep's published name. Its first character is the fallback. */
  name: {
    type: String,
    default: null,
  },
  /** Edge length in pixels. The box is square and never changes with content. */
  size: {
    type: [Number, String],
    default: 28,
  },
});

/** Flipped by the image's own error event; reset whenever the URL changes. */
const broken = ref(false);

const src = computed(() => toInAppUrl(props.imageUrl));

watch(src, () => {
  broken.value = false;
});

const pixels = computed(() => {
  const value = Number(props.size);
  return Number.isFinite(value) && value > 0 ? value : 28;
});

/**
 * Surrogate-safe: `String.prototype[0]` splits an astral character in half and
 * renders a replacement box, and DRep names do carry emoji.
 */
const initial = computed(() => {
  const name = String(props.name ?? '').trim();
  if (!name) return '';
  return (Array.from(name)[0] ?? '').toUpperCase();
});

const boxStyle = computed(() => ({
  width: `${pixels.value}px`,
  height: `${pixels.value}px`,
}));

/** The initial scales with the box so one component covers 28px and 56px alike. */
const initialStyle = computed(() => ({
  fontSize: `${Math.max(10, Math.round(pixels.value * 0.42))}px`,
}));

const glyphSize = computed(() => Math.max(12, Math.round(pixels.value * 0.55)));
</script>

<style scoped>
.drep-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  overflow: hidden;
  border-radius: var(--g-r-pill);
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-1);
}
.drep-avatar__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.drep-avatar__initial {
  color: var(--g-text-2);
  font-weight: 620;
  line-height: 1;
  font-family: var(--g-font-ui);
}
</style>
