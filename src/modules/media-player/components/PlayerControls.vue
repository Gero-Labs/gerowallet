<template>
  <div v-if="currentTrack" class="text-center">
    <v-btn :x-small="xSmall" :small="small" :x-large="xLarge" text icon color="primary" @click="toggleShuffle">
      <v-icon :x-small="xSmall" :small="small" :x-large="xLarge">
        {{ context.isShuffle ? 'mdi-shuffle' : 'mdi-shuffle-disabled' }}
      </v-icon>
    </v-btn>
    <v-btn :x-small="xSmall" :small="small" :large="large" :x-large="xLarge" text icon color="primary" @click="prevTrack">
      <v-icon :x-small="xSmall" :small="small" :large="large" :x-large="xLarge">
        mdi-skip-previous
      </v-icon>
    </v-btn>
    <v-btn :x-small="xSmall" :small="small" :large="large" :x-large="xLarge" text icon color="primary" @click="togglePlayPause">
      <v-icon :x-small="xSmall" :small="small" :large="large" :x-large="xLarge">
        {{ context.isPlaying ? 'mdi-pause-circle' : 'mdi-play-circle'}}
      </v-icon>
    </v-btn>
    <v-btn :x-small="xSmall" :small="small" :large="large" :x-large="xLarge" text icon color="primary" @click="nextTrack">
      <v-icon :x-small="xSmall" :small="small" :large="large" :x-large="xLarge">
        mdi-skip-next
      </v-icon>
    </v-btn>
    <v-btn :x-small="xSmall" :small="small" :x-large="xLarge" text icon color="primary" @click="toggleRepeat">
      <v-icon :x-small="xSmall" :small="small" :x-large="xLarge">
        {{ context.isRepeat ? 'mdi-repeat' : 'mdi-repeat-off' }}
      </v-icon>
    </v-btn>
  </div>
</template>
<script>
import { mapActions, mapState } from 'pinia';
import { useStore } from '@/store';

export default {
  name: "PlayerControls",
  props: {
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
  },
  computed: {
    ...mapState(useStore, ['musicPlaylist', 'context']),
    currentTrack() {
      return this.musicPlaylist[this.context.currentIndex]
    }
  },
  methods: {
    ...mapActions(useStore, ['togglePlayPause', 'setTrack', 'nextTrack', 'prevTrack', 'toggleShuffle', 'toggleRepeat']),
    next() {
      // api.spotify.player.nextTrack();
    },
    prev() {
      // api.spotify.player.previousTrack();
    },
    pause() {
      // api.spotify.player.pause();
    },
    play() {
      if (this.context.paused) {
        // api.spotify.player.play();
      } else {
        // api.spotify.player.pause();
      }
    },
    shuffle() {
      // api.spotify.player.shuffle(this.context.shuffle);
    },
    repeat() {
      const states = ["off", "context", "track"];
      const repeatState = this.context.repeat_mode;
      let index = repeatState === 2 ? 0 : repeatState + 1;
      // api.spotify.player.repeat(states[index]);
    }
  }
};
</script>
