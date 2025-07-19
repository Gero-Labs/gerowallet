<template>
  <div v-if="currentTrack" class="text-center">
    <v-btn :x-small="xSmall" :small="small" :x-large="xLarge" text icon color="primary" @click="MusicStore.toggleShuffle" :plain="!context.isShuffle">
      <v-icon :x-small="xSmall" :small="small" :x-large="xLarge">
        mdi-shuffle
      </v-icon>
    </v-btn>
    <v-btn :x-small="xSmall" :small="small" :large="large" :x-large="xLarge" text icon color="primary" @click="MusicStore.prevTrack">
      <v-icon :x-small="xSmall" :small="small" :large="large" :x-large="xLarge">
        mdi-skip-previous
      </v-icon>
    </v-btn>
    <v-btn :x-small="xSmall" :small="small" :large="large" :x-large="xLarge" text icon color="primary" @click="MusicStore.togglePlayPause">
      <v-icon :x-small="xSmall" :small="small" :large="large" :x-large="xLarge">
        {{ context.isPlaying ? 'mdi-pause-circle' : 'mdi-play-circle'}}
      </v-icon>
    </v-btn>
    <v-btn :x-small="xSmall" :small="small" :large="large" :x-large="xLarge" text icon color="primary" @click="MusicStore.nextTrack">
      <v-icon :x-small="xSmall" :small="small" :large="large" :x-large="xLarge">
        mdi-skip-next
      </v-icon>
    </v-btn>
    <v-btn :x-small="xSmall" :small="small" :x-large="xLarge" text icon color="primary" :plain="!context.isRepeat" @click="MusicStore.toggleRepeat">
      <v-icon :x-small="xSmall" :small="small" :x-large="xLarge">
        mdi-repeat
      </v-icon>
    </v-btn>
  </div>
</template>
<script setup lang="ts">
import { toRefs, computed } from 'vue';
import MusicStore, { musicStore } from '@/plugins/musicStore';

const props = defineProps({
  xSmall: {
    type: Boolean,
    required: false,
    default: false,
  },
  small: {
    type: Boolean,
    required: false,
    default: false,
  },
  large: {
    type: Boolean,
    required: false,
    default: false,
  },
  xLarge: {
    type: Boolean,
    required: false,
    default: false,
  },
})

const { context, musicPlaylist } = toRefs(musicStore)

const currentTrack = computed(() => {
  if (musicPlaylist.value) {
    return musicPlaylist.value[context.value.currentIndex]
  }
  return undefined
});
</script>
