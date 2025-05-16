<template>
  <div class="volume-bar">
    <v-slider
      style="width: 100px"
      v-model="volume"
      @click:prepend="onButtonClick"
      :prepend-icon="volumeIcon"
      @end="onDragEnd"
      :tooltip="false"
      track-fill-color="primary"
      track-color="#737575"
      hide-details
    >
    </v-slider>
  </div>
</template>
<script>
import {mapActions, mapState} from 'pinia';
import { musicStore } from '@/stores/modules/music';

export default {
  name: "volume-bar",
  data() {
    return {
      volume: 0,
      tmpVolume: 0,
      dragStartVolume: 0
    };
  },
  computed: {
    ...mapState(musicStore, ['context']),
    volumeIcon() {
      if (this.volume > 75) {
        return 'mdi-volume-high'
      } else if (this.volume > 25) {
        return 'mdi-volume-medium'
      } else if (this.volume > 0) {
        return 'mdi-volume-low'
      } else {
        return 'mdi-volume-mute'
      }
    },
  },
  methods: {
    ...mapActions(musicStore, ['setVolume']),
    onButtonClick() {
      if (this.volume > 0) {
        this.tmpVolume = this.volume;
        this.volume = 0;
      } else {
        this.volume = this.tmpVolume;
      }
      this.setVolume(this.volume);
    },
    onDragEnd() {
      this.setVolume(this.volume);
    },
  },
  mounted() {
    this.volume = this.context.volume;
  }
};
</script>

<style >
.v-slider--horizontal .v-slider__track-container {
  height: 4px!important;
}
</style>
