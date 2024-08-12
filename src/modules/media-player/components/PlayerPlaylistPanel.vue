<template>
  <v-card flat class="transparent">
    <v-list dense>
      <v-list-item-group v-model="selected">
        <v-list-item
          v-for="(track, index) in playlist"
          :key="track.title"
          v-show="track.display">
          <v-list-item-content @click="selectTrack(track)" @dblclick="playTrack()">
            <v-list-item-title>{{ index | numbers }} {{ track.artist }} - {{ track.title }}</v-list-item-title>
          </v-list-item-content>
          <v-spacer></v-spacer>
          {{ track.howl.duration() | minutes }}
        </v-list-item>
      </v-list-item-group>
    </v-list>
  </v-card>
</template>

<script>
import filters from '@/shared/utils/filters';

export default {
  props: {
    playlist: Array,
    selectedTrack: Object
  },
  filters,
  methods: {
    selectTrack (track) {
      this.$emit('selecttrack', track)
    },
    playTrack(index) {
      this.$emit('playtrack', index)
    }
  }
}
</script>

<style scoped>

</style>
