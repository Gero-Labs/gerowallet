<template>
  <span class="fi" :class="countryClass" aria-hidden="true" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import 'flag-icons/css/flag-icons.min.css';

const props = defineProps<{ iso: string }>();
const countryClass = computed(() => /^[a-z]{2}$/i.test(props.iso) ? `fi-${props.iso.toLowerCase()}` : '');
</script>
