<template>
  <div class="player" :style="context.minimized ? { width: '232px', borderRight: '1px solid rgba(255, 255, 255, 0.15)', borderTopRightRadius: '30px' } : {  }">
    <div v-if="currentTrack" class="player__inner">
      <CurrentTrack class="player__left" />
      <div class="player__center" v-show="!context.minimized">
        <PlayerControls large v-show="!context.minimized" style="margin-left: -100px;" />
        <PlayerPlayback v-show="!context.minimized" />
      </div>

      <div style="flex: none; align-self: start;" v-show="!context.minimized">
        <v-btn icon x-small color="white" @click="MusicStore.setMinimized">
          <v-icon x-small>mdi-window-minimize</v-icon>
        </v-btn>
        <v-btn icon x-small color="white" class="mr-2" @click="MusicStore.setMediaPlayerShown(!context.shown)">
          <v-icon x-small>mdi-window-close</v-icon>
        </v-btn>
      </div>
      <div v-show="context.minimized" class="ml-2">
        <v-btn small icon text plain large color="white" @click="MusicStore.setMaximized">
          <v-icon small>
            mdi-chevron-double-right
          </v-icon>
        </v-btn>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { toRefs, computed } from 'vue';
import CurrentTrack from '@/modules/media-player/components/CurrentTrack.vue';
import PlayerControls from '@/modules/media-player/components/PlayerControls.vue';
import PlayerPlayback from '@/modules/media-player/components/PlayerPlayback.vue';
import MusicStore, { musicStore } from '@/stores/musicStore';

const { musicPlaylist, context } = toRefs(musicStore);

const currentTrack = computed(() => {
  return musicPlaylist.value[context.value.currentIndex]
});
</script>
<style scoped lang="sass">
.player
  position: fixed
  bottom: 0
  width: 100%
  height: 90px
  z-index: 2
  background-color: rgba(0, 0, 0, 0.4) !important
  backdrop-filter: blur(20px) saturate(1.8) !important
  -webkit-backdrop-filter: blur(20px) saturate(1.8) !important
  border-top: 1px solid rgba(255, 255, 255, 0.15) !important
  transition: width var(--g-dur-slow), border-color var(--g-dur-slow), border-width var(--g-dur-slow), border-radius var(--g-dur-slow)
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important
  isolation: isolate !important

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
