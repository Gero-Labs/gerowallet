<template>
  <!-- The markup is a compile-time constant from isoScenes.ts (no user data), so v-html is safe. -->
  <svg
    class="g-iso"
    :viewBox="scene.viewBox"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    focusable="false"
    v-html="markup"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import cardArtwork from '@/assets/front_card_no_mcx2.png';
import { ISO_SCENES, type IsoSceneName } from './isoScenes';

const props = withDefaults(defineProps<{
  name: IsoSceneName;
  /** Accessible name. Omit for decorative scenes, which are then hidden from assistive tech. */
  label?: string;
  /** Use the scene's moving drawing, when it has one. Ignored under reduced motion. */
  animated?: boolean;
}>(), { label: undefined, animated: false });

// Gradient ids are document-global, so every instance needs its own.
const uid = `g-iso-${Math.random().toString(36).slice(2, 10)}`;

// SVG (SMIL) motion is not covered by the global reduced-motion CSS, so it is opted out here.
const reducedMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const scene = computed(() => ISO_SCENES[props.name]);
const markup = computed(() => {
  const source = props.animated && !reducedMotion && scene.value.live ? scene.value.live : scene.value.body;
  return source.split('__UID__').join(uid).split('__CARD_IMG__').join(cardArtwork);
});
</script>
