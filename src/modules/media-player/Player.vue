<template>
  <div class="player" :style="context.minimized ? { width: '232px', borderRight: '1px solid #444444', borderTopRightRadius: '30px' } : {  }">
    <div v-if="currentTrack" class="player__inner">
      <CurrentTrack class="player__left" />
      <div class="player__center" v-show="!context.minimized">
        <PlayerControls large v-show="!context.minimized" />
        <PlayerPlayback v-show="!context.minimized" />
      </div>

      <div class="player__right" style="place-content: center;" v-show="!context.minimized">
        <!--        <DevicePicker />-->
        <VolumeBar />
      </div>
      <div style="flex: none; align-self: start;" v-show="!context.minimized">
        <v-btn icon x-small color="white" @click="setMinimized">
          <v-icon x-small>mdi-window-minimize</v-icon>
        </v-btn>
        <v-btn icon x-small color="white" class="mr-2" @click="setMediaPlayerShown(!context.shown)">
          <v-icon x-small>mdi-window-close</v-icon>
        </v-btn>
      </div>
      <div v-show="context.minimized" class="ml-2">
        <v-btn small icon text plain large color="white" @click="setMaximized">
          <v-icon small>
            mdi-chevron-double-right
          </v-icon>
        </v-btn>
      </div>
    </div>
  </div>
</template>
<script>
import VolumeBar from '@/modules/media-player/components/VolumeBar.vue';
import CurrentTrack from '@/modules/media-player/components/CurrentTrack.vue';
import PlayerControls from '@/modules/media-player/components/PlayerControls.vue';
import PlayerPlayback from '@/modules/media-player/components/PlayerPlayback.vue';
// import DevicePicker from '@/modules/media-player/components/DevicePicker.vue';
import { mapActions, mapState } from 'pinia';
import { useStore } from '@/store';
import { musicStore } from '@/store/modules/music';

export default {
  name: "player",
  components: {
    VolumeBar,
    CurrentTrack,
    PlayerControls,
    PlayerPlayback,
    // DevicePicker
  },
  computed: {
    ...mapState(musicStore, ['musicPlaylist', 'context']),
    currentTrack() {
      return this.musicPlaylist[this.context.currentIndex]
    }
  },
  methods: {
    ...mapActions(musicStore, ['setMinimized', 'setMaximized', 'setMediaPlayerShown']),
  }
};
</script>
<style scoped lang="sass">
.player
  position: fixed
  bottom: 0
  width: 100%
  height: 90px
  z-index: 2
  background: #0f0f0f
  border-top: 1px solid #444444
  transition: all 0.3s
  box-shadow: rgba(0, 0, 0, 0.1) 0 4px 12px

  &__inner
    justify-content: space-between
    display: flex
    align-items: center
    height: 100%

  &__left
    width: 30%
    min-width: 180px

  &__right
    display: flex
    width: 30%
    min-width: 180px

    .device-picker
      margin: 2px 5px 0 auto

    .volume-bar
      margin: 0 15px 0 5px

  &__center
    width: 100%
    text-align: -webkit-center
    overflow-x: hidden
</style>
