<template>
  <span class="fi" :class="[countryClass, { fis: square }]" aria-hidden="true" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import 'flag-icons/css/flag-icons.min.css';

const props = defineProps<{
  iso: string;
  /**
   * The 1:1 artwork, for a round avatar. The 4:3 flag is shrunk to the avatar's
   * width there and drawn short, so the circle cut it flat at top and bottom.
   */
  square?: boolean;
}>();
const countryClass = computed(() => /^[a-z]{2}$/i.test(props.iso) ? `fi-${props.iso.toLowerCase()}` : '');
</script>
