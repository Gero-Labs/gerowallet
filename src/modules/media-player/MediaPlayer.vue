<template>
  <v-card flat outlined>
    <v-row no-gutters>
      <v-col cols="12" xl="6" lg="6">
        <v-card flat class="pa-4 transparent">
          <v-card-text style="height: 433px; max-height: 433px;" >
            <video v-if="audioFile" ref="player" playsinline loop :src="audioFile" style="height: 400px; max-height: 400px;" :poster="imageFile"  @click="playAudio">

            </video>
          </v-card-text>
          <v-card-title class="justify-center" style="word-break: break-word" v-if="audioFile">
            {{`${track.artist} - ${track.title}` }}
          </v-card-title>
          <v-card-title class="justify-center" v-if="audioFile">
            <v-slider v-model="currentProgressBar" :min="1" :max="100" v-if="audioFile">
              <template v-slot:prepend>
                <span class="currentTime">{{ currentTime | fancyTimeFormat }}</span>
              </template>
              <template v-slot:append>
                <span class="totalTime"> {{ trackDuration | fancyTimeFormat }}</span>
              </template>
            </v-slider>
          </v-card-title>
          <div class="justify-center text-center">
            <v-btn outlined color="primary" class="mx-1" icon @click="currentSong--">
              <v-icon>
                mdi-skip-previous
              </v-icon>
            </v-btn>
            <v-btn outlined color="primary" class="mx-1" icon @click="playAudio">
              <v-icon>
                {{ currentlyPlaying ? 'mdi-pause' : 'mdi-play' }}
              </v-icon>
            </v-btn>
            <v-btn outlined color="primary" class="mx-1" icon @click="currentSong++">
              <v-icon>
                mdi-skip-next
              </v-icon>
            </v-btn>
          </div>
        </v-card>
      </v-col>
      <v-col cols="12" xl="6" lg="6">
        <v-card flat>
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
          <v-list nav dense style="width: 100%" class="transparent">
            <v-list-item-group v-model="currentSong">
              <v-list-item v-for="(track, index) in musicPlaylist" :key="index">
                <v-list-item-avatar>
                  <v-img :src="track.img" contain></v-img>
                </v-list-item-avatar>
                <v-list-item-action-text class="mr-4">
                  {{index | numbers}}
                </v-list-item-action-text>
                <v-list-item-content>
                  <v-list-item-title>{{ track.title }}</v-list-item-title>
                  <v-list-item-subtitle>{{ track.artist }}</v-list-item-subtitle>
                </v-list-item-content>
                <v-spacer></v-spacer>
              </v-list-item>
            </v-list-item-group>
          </v-list>
        </v-card>
      </v-col>
    </v-row>
  </v-card>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import { mapState } from 'pinia';
import { useStore } from '@/store';

const baseUrl = process.env['VUE_APP_BACKEND_URL'];

export default defineComponent({
  name: "MediaPlayer",
  filters: {
    fancyTimeFormat(s) {
      return (s - (s %= 60)) / 60 + (9 < s ? ":" : ":0") + s.toFixed(0);
    },
    numbers(value: number): string {
      const number = value + 1
      if (number < 10) {
        return "0" + number + "."
      }
      return number + "."
    },
  },
  watch: {
    currentSong(index) {
      this.changeSong(index)
    }
  },
  computed: {
    ...mapState(useStore, ['resolvedCollections']),
    musicPlaylist() {
      let mediaNFTs = []
      this.resolvedCollections.forEach(collection => {
        collection.items.forEach(nft => {
          if (nft.onchain_metadata && nft.onchain_metadata.files && nft.onchain_metadata.files.some(file => file.mediaType.includes('audio'))) {
            mediaNFTs.push(nft)
          }
        })
      })
      return mediaNFTs.map(nft => {
        return nft.onchain_metadata.files?.map(file => {
          const src = `${baseUrl}/api/ipfs/${file.src.replace('ipfs://', '')}`
          // const audio = new Audio(src)
          // const duration = await this.getAudioDuration(audio)
          // console.log(duration)
          return {
            artist: this.getArtists(nft.release?.artist) || nft.metadata?.name || nft.name,
            title: (file.song?.song_title || file.name || nft.name) + (file.mediaType?.includes('video') ? " (Video)" : ""),
            img: nft.img,
            url: src,
            mediaType: file.mediaType,
            metadata: nft.onchain_metadata,
            display: true
          }
        });
      }).flat()
        .filter(nft => nft.mediaType?.includes('audio') || nft.mediaType?.includes('video'))
    }
  },
  methods: {
    changeSong(index?) {
      if (index !== undefined) {
        this.stopAudio();
        this.currentSong = index;
      }
      console.log('cha')
      this.track = this.musicPlaylist[this.currentSong]
      this.audioFile = this.track.url;
      this.imageFile = this.track.img
      this.audio = new Audio(this.audioFile);
      const localThis = this;
      const audio = this.audio
      audio.addEventListener("loadedmetadata", function() {
        localThis.trackDuration = Math.round(audio.duration);
      });
      this.audio.addEventListener("ended", this.handleEnded);
      this.playAudio();
    },
    handleEnded() {
      if (this.currentSong + 1 == this.musicPlaylist.length) {
        this.stopAudio();
        this.currentlyPlaying = false;
        this.currentlyStopped = true;
      } else {
        this.currentlyPlaying = false;
        this.currentSong++;
      }
    },
    playAudio() {
      if (this.currentlyStopped == true && this.currentSong + 1 == this.musicPlaylist.length) {
        this.currentSong = 0;
        this.changeSong();
      }
      if (!this.currentlyPlaying) {
        this.getCurrentTimeEverySecond(true);
        this.currentlyPlaying = true;
        this.audio.play();
      } else {
        this.stopAudio();
      }
      this.currentlyStopped = false;
    },
    stopAudio() {
      console.log('pause')
      if (this.audio) {
        this.audio.pause();
      }
      this.currentTime = 0;
      this.currentlyPlaying = false;
      this.pausedMusic();
    },
    getCurrentTimeEverySecond: function(startStop) {
      const localThis = this;
      this.checkingCurrentPositionInTrack = setTimeout(
        function() {
          localThis.currentTime = localThis.audio.currentTime;
          localThis.currentProgressBar = localThis.audio.currentTime / localThis.trackDuration * 100;
          localThis.getCurrentTimeEverySecond(true);
        }.bind(this),
        1000
      );
    },
    pausedMusic: function() {
      clearTimeout(this.checkingCurrentPositionInTrack);
    },
    getArtists(artists) {
      if (artists !== undefined && Array.isArray(artists)) {
        return artists.join(', ');
      }
      return artists;
    },
  },
  data: () => ({
    audio: null,
    search: '',
    selected: null,
    trackDuration: 0,
    currentlyPlaying: false,
    currentlyStopped: false,
    currentTime: 0,
    currentSong: -1,
    currentProgressBar: 0,
    checkingCurrentPositionInTrack: null,
    audioFile: "",
    imageFile: "",
    track: null
  })
})
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
</style>
