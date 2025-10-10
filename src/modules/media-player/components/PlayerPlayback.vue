<template>
  <div class="player-playback pb-3" v-if="context">
    <div style="display: flex; width: 100%; justify-content: center;">
      <div class="player-playback__time">{{ formatTime(Math.round(context.seek)) }}</div>
      <div class="player-playback__progress-bar">
        <v-slider
          :value="Math.round(context.seek / context.duration * 100)"
          @change="onProgressChange"
          :tooltip="false"
          :dot-size="15"
          :process-style="{ background: '#1db954' }"
          :bg-style="{ background: '#737575' }"
          hide-details
        />
      </div>
      <div class=" player-playback__time">{{ formatTime(Math.round(context.duration)) }}</div>
    </div>
    <VolumeBar />
  </div>
</template>
<script setup lang="ts">
import { computed, ref, toRefs } from 'vue';
import filters from '@/shared/utils/filters';
import { formatTime } from '@/shared/utils/converter';
import { musicStore } from '@/stores/musicStore';
import VolumeBar from '@/modules/media-player/components/VolumeBar.vue';

const { musicPlaylist, context } = toRefs(musicStore);

const progress = ref(0);
const progressInterval = ref(null);
const isDragStart = ref(false);

const currentTrack = computed(() => {
  if (musicPlaylist.value && context.value) {
    return musicPlaylist.value[context.value.currentIndex];
  }
  return undefined;
});

const onProgressChange = (currentValue: number) => {
  // Calculate the new seek position in seconds based on the slider value.
  const newSeekPosition = (currentValue / 100) * context.value.duration;

  // Set the new seek position in the Howl instance.
  if (context.value.audio) {
    context.value.audio.seek(newSeekPosition);
    context.value.seek = newSeekPosition; // Update the seek position in the context.
  }
};
</script>

<style lang="sass">

.player-playback
  display: flex
  width: 100%
  justify-content: center

  &__time
    align-content: center
    font-size: 14px
    min-width: 40px

  &__progress-bar
    width: 100%
    max-width: 400px
</style>
