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
<script>
import { mapState } from 'pinia';
import { useStore } from '@/store';
import filters from '@/shared/utils/filters';
import { formatTime } from '@/shared/utils/converter';
import { musicStore } from '@/store/modules/music';
import VolumeBar from '@/modules/media-player/components/VolumeBar.vue';

export default {
  name: "player-player-playback",
  components: { VolumeBar },
  data() {
    return {
      progress: 0,
      progressInterval: null,
      isDragStart: false,
    };
  },
  filters,
  computed: {
    ...mapState(musicStore, ['musicPlaylist', 'context']),
    currentTrack() {
      return this.musicPlaylist[this.context.currentIndex]
    }
  },
  methods: {
    formatTime,
    onProgressChange(currentValue) {
      // Calculate the new seek position in seconds based on the slider value.
      const newSeekPosition = (currentValue / 100) * this.context.duration;

      // Set the new seek position in the Howl instance.
      if (this.context.audio) {
        this.context.audio.seek(newSeekPosition);
        this.context.seek = newSeekPosition; // Update the seek position in the context.
      }
    }
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
