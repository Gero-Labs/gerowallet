<template>
  <div v-if="currentTrack" class="text-center">
    <v-btn :size="modeSize" :variant="context.isShuffle ? 'text' : 'plain'" icon color="primary" @click="MusicStore.toggleShuffle">
      <v-icon :size="iconSizes[modeSize]">
        mdi-shuffle
      </v-icon>
    </v-btn>
    <v-btn :size="transportSize" variant="text" icon color="primary" @click="MusicStore.prevTrack">
      <v-icon :size="iconSizes[transportSize]">
        mdi-skip-previous
      </v-icon>
    </v-btn>
    <v-btn :size="transportSize" variant="text" icon color="primary" @click="MusicStore.togglePlayPause">
      <v-icon :size="iconSizes[transportSize]">
        {{ context.isPlaying ? 'mdi-pause-circle' : 'mdi-play-circle'}}
      </v-icon>
    </v-btn>
    <v-btn :size="transportSize" variant="text" icon color="primary" @click="MusicStore.nextTrack">
      <v-icon :size="iconSizes[transportSize]">
        mdi-skip-next
      </v-icon>
    </v-btn>
    <v-btn :size="modeSize" :variant="context.isRepeat ? 'text' : 'plain'" icon color="primary" @click="MusicStore.toggleRepeat">
      <v-icon :size="iconSizes[modeSize]">
        mdi-repeat
      </v-icon>
    </v-btn>
  </div>
</template>
<script setup lang="ts">
import { toRefs, computed } from 'vue';
import MusicStore, { musicStore } from '@/stores/musicStore';

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

const modeSize = computed(() => props.xSmall ? 'x-small' : props.small ? 'small' : props.xLarge ? 'x-large' : 'default');
const transportSize = computed(() => props.xSmall ? 'x-small' : props.small ? 'small' : props.large ? 'large' : modeSize.value);
const iconSizes = { 'x-small': 12, small: 16, default: 24, large: 36, 'x-large': 40 };

const { context, musicPlaylist } = toRefs(musicStore)

const currentTrack = computed(() => {
  if (musicPlaylist.value) {
    return musicPlaylist.value[context.value.currentIndex]
  }
  return undefined
});
</script>
