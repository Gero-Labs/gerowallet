<template>
  <!-- A nested glass frame that gives an isometric scene a 2:1 stage. -->
  <div class="glass-tier scene-frame">
    <IsoScene :name="scene" class="scene-frame__scene" :style="{ width: scale + '%' }" />
  </div>
</template>

<script setup lang="ts">
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import type { IsoSceneName } from '@/shared/components/iso/isoScenes';

withDefaults(defineProps<{ scene: IsoSceneName; scale?: number }>(), { scale: 62 });
</script>

<style scoped>
.scene-frame { display: flex; align-items: center; justify-content: center; aspect-ratio: 2 / 1; border-radius: var(--g-r-control); overflow: hidden; }
.scene-frame__scene { display: block; height: auto; }
</style>
