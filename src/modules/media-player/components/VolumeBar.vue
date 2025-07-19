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
<script setup lang="ts">
import { ref, computed, onMounted, toRefs } from 'vue';
import MusicStore, { musicStore } from '@/plugins/musicStore';

const { context } = toRefs(musicStore);

const volume = ref(0);
const tmpVolume = ref(0);

const volumeIcon = computed(() => {
  if (volume.value > 75) {
    return 'mdi-volume-high'
  } else if (volume.value > 25) {
    return 'mdi-volume-medium'
  } else if (volume.value > 0) {
    return 'mdi-volume-low'
  } else {
    return 'mdi-volume-mute'
  }
});

const onButtonClick = () => {
  if (volume.value > 0) {
    tmpVolume.value = volume.value;
    volume.value = 0;
  } else {
    volume.value = tmpVolume.value;
  }
  MusicStore.setVolume(volume.value);
};

const onDragEnd = () => {
  MusicStore.setVolume(volume.value);
};

onMounted(() => {
  volume.value = context.value.volume;
});
</script>

<style >
.v-slider--horizontal .v-slider__track-container {
  height: 4px!important;
}
</style>
