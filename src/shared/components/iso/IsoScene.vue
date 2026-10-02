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
import { ISO_SCENES, type IsoSceneName } from './isoScenes';

const props = defineProps<{
  name: IsoSceneName;
  /** Accessible name. Omit for decorative scenes, which are then hidden from assistive tech. */
  label?: string;
}>();

// Gradient ids are document-global, so every instance needs its own.
const uid = `g-iso-${Math.random().toString(36).slice(2, 10)}`;

const scene = computed(() => ISO_SCENES[props.name]);
const markup = computed(() => scene.value.body.split('__UID__').join(uid));
</script>
