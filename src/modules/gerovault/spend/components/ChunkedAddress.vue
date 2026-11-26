<template>
  <!-- The complete address, monospaced, in groups of five characters. Never shortened. -->
  <div class="chunked-address">
    <span class="g-mono t-body-sm chunked-address__text" :aria-label="address">
      <span v-for="(chunk, i) in chunks" :key="i" class="chunked-address__chunk" aria-hidden="true">{{ chunk }}</span>
    </span>
    <CopyButton :value="address" x-small />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CopyButton from '@/shared/components/CopyButton.vue';

const props = defineProps<{ address: string }>();

const chunks = computed(() => props.address.match(/.{1,5}/g) ?? []);
</script>

<style scoped>
.chunked-address {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-1);
  min-width: 0;
}
.chunked-address__text {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--g-s-2);
  row-gap: var(--g-s-1);
  min-width: 0;
  color: var(--g-text-1);
  user-select: all;
}
.chunked-address__chunk {
  white-space: nowrap;
}
</style>
