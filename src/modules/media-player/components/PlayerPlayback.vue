<template>
  <div class="player-playback pb-3" v-if="context">
    <div class="player-playback__time">{{ formatTime(Math.round(context.seek)) }}</div>
    <div class="player-playback__progress-bar">
      <v-slider
        :value="Math.round(context.seek / context.duration * 100)"
        v-on:drag-start="onDragStart"
        v-on:callback="onProgressChange"
        v-on:drag-end="onDragEnd"
        :tooltip="false"
        :dot-size="15"
        :process-style="{ background: '#1db954' }"
        :bg-style="{ background: '#737575' }"
        hide-details
      />
    </div>
    <div class=" player-playback__time">{{ formatTime(Math.round(context.duration)) }}</div>
  </div>
</template>
<script>
import { mapState } from 'pinia';
import { useStore } from '@/store';
import filters from '@/shared/utils/filters';
import { formatTime } from '@/shared/utils/converter';
import { musicStore } from '@/store/modules/music';

export default {
  name: "player-player-playback",
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
    onDragStart({ currentValue }) {
      this.isDragStart = true;
    },

    onDragEnd({ currentValue }) {
      this.isDragStart = false;
      // api.spotify.player.seekToPosition(currentValue);
    },

    onProgressChange(currentValue) {
      if (!this.isDragStart) {
        this.isDragStart = false;
        // api.spotify.player.seekToPosition(currentValue);
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
