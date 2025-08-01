<template>
  <div v-if="currentTrack" class="current-track">
    <v-list-item  :three-line="context.minimized" :two-line="!context.minimized" class="pr-0">
      <v-list-item-avatar rounded size="56">
        <v-img
          class="current-track__img"
          :src="currentTrack.img"
          contain
        />
      </v-list-item-avatar>
      <v-list-item-content :class="context.minimized ? 'marquee' : ''" style="min-width: 100px;">
        <v-list-item-title :class="context.minimized ? 'marquee__item' : ''" style="text-overflow: unset;overflow: visible;">
            {{ currentTrack.title }}
        </v-list-item-title>
        <v-list-item-subtitle :class="context.minimized ? 'marquee__item' : ''" style="text-overflow: unset;overflow: visible;flex-basis: max-content; text-wrap: nowrap;">
          {{ currentTrack.artist }}
        </v-list-item-subtitle>
        <v-list-item-subtitle style="text-overflow: unset;overflow: visible;" v-show="context.minimized">
          <PlayerControls x-small></PlayerControls>
        </v-list-item-subtitle>
      </v-list-item-content>
    </v-list-item>
  </div>
</template>
<script setup lang="ts">
import { toRefs, computed, ref, onMounted } from 'vue';
import PlayerControls from '@/modules/media-player/components/PlayerControls.vue';
import { musicStore } from '@/stores/musicStore';

const { musicPlaylist, context } = toRefs(musicStore);

const currentTrackID = ref<string>('');

const currentTrack = computed(() => {
  return musicPlaylist.value[context.value.currentIndex]
});

onMounted(() => {
  currentTrackID.value = currentTrack.value.id;
})
</script>
<style>
.marquee {
  display: flex ;
  overflow: hidden ;
  white-space: nowrap ;
}
.marquee__item {
  animation-duration: 4s ;
  animation-iteration-count: infinite ;
  animation-name: marquee-content ;
  animation-timing-function: linear ;
}
.marquee:hover .marquee__item {
  animation-play-state: paused ;
}

/**
* BOTH of the marquee items are going to be translating left at the same time.
* And, once each of them has translated to -100%, they will both snap back into
* place, making it seem as if they are continuously scrolling.
*/
@keyframes marquee-content {
  from {
    transform: translateX( 0% );
  }
  to {
    transform: translateX( -100% );
  }
}
</style>
