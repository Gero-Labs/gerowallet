<template>
  <div>
    <v-progress-linear height="40" v-model="trackProgress"  @click="updateSeek($event)">
      <template v-slot:default="{  }">
        <div class="px-2" style="width: 100%; display: inline-flex; align-items: center;">
          <h2>{{ trackInfo.artist }} - {{ trackInfo.title }}</h2>
          <v-spacer></v-spacer>
          <h3>{{ trackInfo.seek | minutes }}/{{ trackInfo.duration | minutes }}</h3>
        </div>
      </template>
    </v-progress-linear>
    <v-toolbar flat height=90>
      <v-btn text icon @click="toggleMute">
        <template v-if="!this.muted">
          <v-icon v-if="this.volume >= 0.5">mdi-volume-high</v-icon>
          <v-icon v-else-if="this.volume > 0">mdi-volume-medium</v-icon>
          <v-icon v-else>mdi-volume-off</v-icon>
        </template>
        <v-icon v-show="this.muted">mdi-volume-off</v-icon>
      </v-btn>
      <v-slider v-model="volume" @input="updateVolume(volume)" max="1" step="0.1" hide-details style="max-width: 100px"></v-slider>
      {{ this.volume * 100 + '%' }}
      <v-spacer></v-spacer>
      <v-btn class="mx-1" outlined fab small color="primary" @click="skipTrack('prev')">
        <v-icon>mdi-skip-previous</v-icon>
      </v-btn>
      <v-btn class="mx-1" outlined fab small color="primary" @click="stopTrack">
        <v-icon>mdi-stop</v-icon>
      </v-btn>
      <v-btn class="mx-1" outlined fab color="primary" @click="playTrack">
        <v-icon large>mdi-play</v-icon>
      </v-btn>
      <v-btn class="mx-1" outlined fab small color="primary" @click="pauseTrack">
        <v-icon>mdi-pause</v-icon>
      </v-btn>
      <v-btn class="mx-1" outlined fab small color="primary" @click="skipTrack('next')">
        <v-icon>mdi-skip-next</v-icon>
      </v-btn>
      <v-spacer></v-spacer>
      <v-btn text icon @click="toggleLoop">
        <v-icon :color="this.loop ? 'primary' : 'blue-grey'">mdi-repeat-once</v-icon>
      </v-btn>
      <v-btn text icon @click="toggleShuffle">
        <v-icon :color="this.shuffle ? 'primary' : 'blue-grey'">mdi-shuffle</v-icon>
      </v-btn>
    </v-toolbar>
  </div>
</template>

<script>
import { Howler } from 'howler';
import filters from '@/shared/utils/filters';

export default {
  props: {
    loop: Boolean,
    shuffle: Boolean,
    progress: Number,
    trackInfo: Object
  },
  filters,
  data () {
    return {
      volume: 0.5,
      muted: false
    }
  },
  computed: {
    trackProgress () {
      return this.progress * 100
    },
  },
  created: function () {
    Howler.volume(this.volume)
  },
  methods: {
    playTrack(index) {
      this.$emit('playtrack', index)
    },
    pauseTrack() {
      this.$emit('pausetrack')
    },
    stopTrack() {
      this.$emit('stoptrack')
    },
    skipTrack (direction) {
      this.$emit('skiptrack', direction)
    },
    updateVolume (volume) {
      Howler.volume(volume)
    },
    toggleMute () {
      Howler.mute(!this.muted)
      this.muted = !this.muted
    },
    toggleLoop () {
      this.$emit('toggleloop', !this.loop)
    },
    toggleShuffle () {
      this.$emit('toggleshuffle', !this.shuffle)
    },
    updateSeek (event) {
      let el = document.querySelector(".progress-linear__bar"),
        mousePos = event.offsetX,
        elWidth = el.clientWidth,
        percents = (mousePos / elWidth) * 100
      this.$emit('updateseek', percents)
    }
  }
}
</script>
