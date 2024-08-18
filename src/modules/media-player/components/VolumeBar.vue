<template>
  <div class="volume-bar">
    <v-slider
      style="width: 150px"
      v-model="volume"
      @click:prepend="onButtonClick"
      :prepend-icon="volumeIcon"
      v-on:drag-start="onDragStart"
      v-on:callback="onSliderChange"
      v-on:drag-end="onDragEnd"
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
import { useStore } from '@/store';

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
    ...mapState(useStore, ['context']),
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
    ...mapActions(useStore, ['setVolume']),
    onButtonClick() {
      if (this.volume > 0) {
        this.tmpVolume = this.volume;
        this.volume = 0;
      } else {
        this.volume = this.tmpVolume;
      }
      this.setVolume(this.volume);
    },
    onDragStart({ currentValue }) {
      this.dragStartVolume = currentValue;
    },
    onDragEnd({ currentValue }) {
      this.setVolume(currentValue);
    },
    onSliderChange(currentValue) {
      const diff = Math.abs(this.dragStartVolume - currentValue);
      if (diff >= 10) {
        this.dragStartVolume = currentValue;
        this.setVolume(currentValue);
      }
    }
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
