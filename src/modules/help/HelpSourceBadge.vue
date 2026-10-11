<template>
  <!-- An icon well (an avatar-style control), so it keeps the accepted solid fill (--g-raised). -->
  <span class="source-badge" aria-hidden="true">
    <img v-if="'mark' in icon" :src="icon.mark === 'nexus' ? nexusMark : geroMark" alt="" class="source-badge__mark" :class="'source-badge__mark--' + icon.mark" />
    <v-icon v-else :size="18" color="var(--g-text-2)">{{ icon.icon }}</v-icon>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import geroMark from '@/assets/svg/gero-notext.svg';
import nexusMark from '@/assets/svg/nexus.svg';
import { updateSourceIcon } from './helpUpdates';

const props = defineProps<{ source: string }>();
const icon = computed(() => updateSourceIcon(props.source));
</script>

<style scoped>
.source-badge {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: var(--source-badge-size, 36px); height: var(--source-badge-size, 36px);
  border-radius: var(--g-r-pill); background: var(--g-raised); border: 1px solid var(--g-hairline-2);
}
.source-badge__mark { display: block; height: 50%; width: auto; }
</style>
