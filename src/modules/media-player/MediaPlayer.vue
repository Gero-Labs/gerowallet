<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-0">
        <v-card flat outlined class="liquid-glass" style="min-height: calc(100vh - 80px);">
          <v-row no-gutters v-if="musicPlaylist?.length > 0" style="min-height: calc(-80px + 100vh)">
            <v-col cols="12" xl="6" lg="6" style="align-content: center;">
              <v-card flat class="pa-4 transparent" v-if="currentTrack" style="box-shadow: none!important;">
                <v-card-text style="height: 433px; max-height: 433px;">
                  <video ref="videoPlayer" :loop="context?.isRepeat" playsinline :controls="currentTrack.mediaType.includes('video')" :src="currentTrack.url" style="height: 400px; max-height: 400px;" :poster="currentTrack.mediaType.includes('video') ? '' : currentTrack.img"  />
                </v-card-text>
                <v-card-title class="justify-center" style="word-break: break-word">
                  {{`${currentTrack.artist} - ${currentTrack.title}` }}
                </v-card-title>
                <div class="text-center justify-center" v-if="!currentTrack.mediaType.includes('video')" >
                  <PlayerControls large />
                  <PlayerPlayback style="align-self: center;" />
                </div>
              </v-card>
            </v-col>
            <v-col cols="12" xl="6" lg="6">
              <v-card flat class="transparent" style="box-shadow: none!important;">
                <v-card-title>
                  <v-spacer></v-spacer>
                  <v-text-field
                    flat
                    v-model="search"
                    :search-input.sync="search"
                    placeholder="Search"
                    outlined
                    solo
                    dense
                    prepend-inner-icon="mdi-magnify"
                    clearable
                    hide-details
                    style="max-width: 390px"
                  >
                  </v-text-field>
                </v-card-title>
                <v-card-text style="overflow-y: auto; max-height: calc(100vh - 168px);; text-align: left;">
                  <v-list nav dense style="width: 100%" class="transparent py-0">
                    <!-- Iterate over grouped playlist -->
                    <template v-for="(group, category) in groupedPlaylist">
                      <!-- Sticky header for each category -->
                      <v-subheader :key="category" class="sticky-header">{{ category }}</v-subheader>
                      <!-- Iterate over tracks in each category -->
                      <v-list-item
                        v-for="(track, index) in group"
                        :key="`${category}-${index}`"
                        @click="selectTrack(track)"
                        :class="{ 'current-playing': isCurrentTrack(track) }"
                      >
                          <v-list-item-avatar>
                            <v-img :src="track.img" contain></v-img>
                          </v-list-item-avatar>
                          <v-list-item-content>
                            <v-list-item-title>{{ track.title }}</v-list-item-title>
                            <v-list-item-subtitle>{{ track.artist }}</v-list-item-subtitle>
                          </v-list-item-content>
                          <v-spacer></v-spacer>
                          <v-icon v-if="isCurrentTrack(track)" color="primary" small>
                            {{ context?.isPlaying ? 'mdi-volume-high' : 'mdi-pause' }}
                          </v-icon>
                        </v-list-item>
                      </template>
                  </v-list>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </v-card>
      </v-col>
    </v-row>
  </v-layout>
</template>
<script setup lang="ts">
import { ref, computed, watch, toRefs } from 'vue';
import PlayerPlayback from "@/modules/media-player/components/PlayerPlayback.vue";
import PlayerControls from "@/modules/media-player/components/PlayerControls.vue";
import MusicStore, { musicStore } from '@/stores/musicStore';

const { musicPlaylist, context } = toRefs(musicStore);

const search = ref('');
const trackDuration = ref(0);
const currentlyPlaying = ref(false);
const currentlyStopped = ref(false);
const currentTime = ref(0);
const currentProgressBar = ref(0);
const checkingCurrentPositionInTrack = ref(null);
const imageFile = ref("");
const track = ref(null);

const fancyTimeFormat = (s: number) => {
  return (s - (s %= 60)) / 60 + (9 < s ? ":" : ":0") + s.toFixed(0);
};

const numbersFilter = (value: number): string => {
  const number = value + 1;
  if (number < 10) {
    return "0" + number + ".";
  }
  return number + ".";
};

const currentTrack = computed(() => {
  if (musicPlaylist.value && context.value) {
    return musicPlaylist.value[context.value.currentIndex];
  }
  return undefined;
});

const playlist = computed(() => {
  if (!musicPlaylist.value) return [];
  if (search.value) {
    return musicPlaylist.value.filter(track =>
      track.artist.toLowerCase().includes(search.value.toLowerCase()) ||
      track.title.toLowerCase().includes(search.value.toLowerCase())
    );
  }
  return musicPlaylist.value;
});

const groupedPlaylist = computed(() => {
  // Group tracks by category
  const grouped = playlist.value.reduce((acc, track) => {
    if (!acc[track.category]) {
      acc[track.category] = [];
    }
    acc[track.category].push(track);
    return acc;
  }, {});
  return grouped;
});

const selectTrack = (track: any) => {
  if (track && musicPlaylist.value) {
    const index = musicPlaylist.value.indexOf(track);
    // Store the current playing state
    const wasPlaying = context.value?.isPlaying;
    MusicStore.setTrack(index);
    // If music was playing, explicitly start the new track
    if (wasPlaying) {
      setTimeout(() => MusicStore.playTrack(), 50); // Small delay to ensure audio is initialized
    }
  }
};

const calculateIndex = (index: number, category: string) => {
  // Calculate global index based on the category and track index
  const categoryStartIndex = Object.keys(groupedPlaylist.value).reduce((acc, key) => {
    if (key === category) return acc;
    return acc + groupedPlaylist.value[key].length;
  }, 0);
  return numbersFilter(categoryStartIndex + index);
};

const isCurrentTrack = (track: any) => {
  if (!currentTrack.value || !musicPlaylist.value) return false;

  // Find the index of this track in the full playlist
  const trackIndex = musicPlaylist.value.findIndex(t =>
    t.url === track.url && t.title === track.title && t.artist === track.artist
  );

  return trackIndex === context.value.currentIndex;
};

</script>
<style lang="scss" scoped>
.video-container {
  position: relative;
  width: 90%;
  max-width: 1000px;
  display: flex;
  justify-content: center;
  margin-inline: auto;
  background-color: black;
}

.video-container.theater,
.video-container.full-screen {
  max-width: initial;
  width: 100%;
}

.video-container.theater {
  max-height: 90vh;
}

.video-container.full-screen {
  max-height: 100vh;
}

video {
  width: 100%;
}

.video-controls-container {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  color: white;
  z-index: 100;
  opacity: 0;
  transition: opacity 150ms ease-in-out;
}

.video-controls-container::before {
  content: "";
  position: absolute;
  bottom: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, .75), transparent);
  width: 100%;
  aspect-ratio: 6 / 1;
  z-index: -1;
  pointer-events: none;
}

.video-container:hover .video-controls-container,
.video-container:focus-within .video-controls-container,
.video-container.paused .video-controls-container {
  opacity: 1;
}

.video-controls-container .controls {
  display: flex;
  gap: .5rem;
  padding: .25rem;
  align-items: center;
}

.video-controls-container .controls button {
  background: none;
  border: none;
  color: inherit;
  padding: 0;
  height: 30px;
  width: 30px;
  font-size: 1.1rem;
  cursor: pointer;
  opacity: .85;
  transition: opacity 150ms ease-in-out;
}

.video-controls-container .controls button:hover {
  opacity: 1;
}

.video-container.paused .pause-icon {
  display: none;
}

.video-container:not(.paused) .play-icon {
  display: none;
}

.video-container.theater .tall {
  display: none;
}

.video-container:not(.theater) .wide {
  display: none;
}

.video-container.full-screen .open {
  display: none;
}

.video-container:not(.full-screen) .close {
  display: none;
}

.volume-high-icon,
.volume-low-icon,
.volume-muted-icon {
  display: none;
}

.volume-container {
  display: flex;
  align-items: center;
}

.volume-slider {
  width: 0;
  transform-origin: left;
  transform: scaleX(0);
  transition: width 150ms ease-in-out, transform 150ms ease-in-out;
}

.volume-container:hover .volume-slider,
.volume-slider:focus-within {
  width: 100px;
  transform: scaleX(1);
}

.duration-container {
  display: flex;
  align-items: center;
  gap: .25rem;
  flex-grow: 1;
}

.video-container.captions .captions-btn {
  border-bottom: 3px solid red;
}

.video-controls-container .controls button.wide-btn {
  width: 50px;
}

.timeline-container {
  height: 7px;
  margin-inline: .5rem;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.timeline {
  background-color: rgba(100, 100, 100, .5);
  height: 3px;
  width: 100%;
  position: relative
}

.timeline::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  right: calc(100% - var(--preview-position) * 100%);
  background-color: rgb(150, 150, 150);
  display: none;
}

.timeline::after {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  right: calc(100% - var(--progress-position) * 100%);
  background-color: red;
}

.timeline .thumb-indicator {
  --scale: 0;
  position: absolute;
  transform: translateX(-50%) scale(var(--scale));
  height: 200%;
  top: -50%;
  left: calc(var(--progress-position) * 100%);
  background-color: red;
  border-radius: 50%;
  transition: transform 150ms ease-in-out;
  aspect-ratio: 1 / 1;
}

.timeline .preview-img {
  position: absolute;
  height: 80px;
  aspect-ratio: 16 / 9;
  top: -1rem;
  transform: translate(-50%, -100%);
  left: calc(var(--preview-position) * 100%);
  border-radius: .25rem;
  border: 2px solid white;
  display: none;
}

.thumbnail-img {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  display: none;
}

.video-container.scrubbing .thumbnail-img {
  display: block;
}

.video-container.scrubbing .preview-img,
.timeline-container:hover .preview-img {
  display: block;
}

.video-container.scrubbing .timeline::before,
.timeline-container:hover .timeline::before {
  display: block;
}

.video-container.scrubbing .thumb-indicator,
.timeline-container:hover .thumb-indicator {
  --scale: 1;
}

.video-container.scrubbing .timeline,
.timeline-container:hover .timeline {
  height: 100%;
}

.sticky-header {
  position: -webkit-sticky; /* For Safari */
  position: sticky;
  top: 0;
  color: white;
  background-color: #1E1E1E; /* Adjust as needed */
  z-index: 1; /* Make sure it stays above other content */
  padding-top: 8px; /* Adjust padding as needed */
  padding-bottom: 8px;
  border-top-right-radius: 8px;
  border-top-left-radius: 8px;
}

.current-playing {
  background-color: rgba(0, 199, 243, 0.1) !important;
  border-left: 3px solid #00c7f3 !important;
}

.current-playing .v-list-item__title {
  color: #00c7f3 !important;
  font-weight: 600 !important;
}
</style>
