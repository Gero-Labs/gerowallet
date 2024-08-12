<template>
  <v-card outlined flat>
    <player-controls-bars
      :loop="loop"
      :shuffle="shuffle"
      :progress="progress"
      :trackInfo="getTrackInfo"
      @playtrack="play"
      @pausetrack="pause"
      @stoptrack="stop"
      @skiptrack="skip"
      @toggleloop="toggleLoop"
      @toggleshuffle="toggleShuffle"
      @updateseek="setSeek">
    </player-controls-bars>
    <v-card flat class="transparent">
      <v-card-title>
        Your Collection
        <v-spacer></v-spacer>
        <v-text-field
          clearable
          solo
          outlined
          dense
          flat
          prepend-inner-icon="mdi-magnify"
          placeholder="Quick search"
          v-model="searchString"
          hide-details
          @input="searchPlaylist">
        </v-text-field>
      </v-card-title>
      <v-card-actions class="pa-0">
        <v-list nav dense style="width: 100%" class="transparent">
          <v-list-item-group v-model="selected">
            <v-list-item
              v-for="(track, index) in playlist"
              :key="track.title"
              v-show="track.display" @click="selectTrack(track)" >
              <v-list-item-content @dblclick="play">
                <v-list-item-title>{{ index | numbers }} {{ track.artist }} - {{ track.title }}</v-list-item-title>
              </v-list-item-content>
              <v-spacer></v-spacer>
              {{ track.howl.duration() | minutes }}
            </v-list-item>
          </v-list-item-group>
        </v-list>
      </v-card-actions>
    </v-card>

    <v-card flat class="transparent">
      {{mediaNFTs}}
    </v-card>
  </v-card>
</template>

<script>
import {Howl} from 'howler';
import PlayerControlsBars from './components/PlayerControlsBars.vue'
import filters from '@/shared/utils/filters';
import { mapState } from 'pinia';
import { useStore } from '@/store';

const baseUrl = process.env['VUE_APP_BACKEND_URL'];

export default {
  components: {
    PlayerControlsBars
  },
  filters,
  data () {
    return {
      selectedTrack: null,
      index: 0,
      playing: false,
      loop: false,
      shuffle: false,
      seek: 0,
      selected: 0,
      searchString: ""
    }
  },
  computed: {
    ...mapState(useStore, ['resolvedCollections']),
    playlist() {
      let mediaNFTs = []
      this.resolvedCollections.forEach(collection => {
        collection.items.forEach(nft => {
          if (nft.onchain_metadata && nft.onchain_metadata.files && nft.onchain_metadata.files.some(file => file.mediaType.includes('audio'))) {
            mediaNFTs.push(nft)
          }
        })
      })
      const audioFiles = mediaNFTs.map(nft => {
        return nft.onchain_metadata.files?.map(file => {
        const src = `${baseUrl}/api/ipfs/${file.src.replace('ipfs://', '')}`
        return {
          artist: this.getArtists(nft.release?.artist) || nft.metadata?.name || nft.name,
          title: (file.song?.song_title || file.name || nft.name) + (file.mediaType.includes('video') ? " (Video)" : ""),
          img: nft.img,
          src,
          mediaType: file.mediaType,
          metadata: nft.onchain_metadata,
          howl: new Howl({
            src: [src],
            format: [file.mediaType.replace("audio/","")],
            onend: () => {
              if (this.loop) {
                this.play(this.index)
              } else {
                this.skip('next')
              }
            }
          }),
          display: true
        }});
      }).flat()
        .filter(nft => nft.mediaType.includes('audio'))
      return audioFiles
    },
    currentTrack () {
      return this.playlist[this.index]
    },
    progress () {
      if (this.currentTrack.howl.duration() === 0) return 0
      return this.seek / this.currentTrack.howl.duration()
    },
    getTrackInfo () {
      let artist = this.currentTrack.artist,
        title = this.currentTrack.title,
        seek = this.seek,
        duration = this.currentTrack.howl.duration()
      return {
        artist,
        title,
        seek,
        duration,
      }
    }
  },
  watch: {
    playing(playing) {
      this.seek = this.currentTrack.howl.seek()
      let updateSeek
      if (playing) {
        updateSeek = setInterval(() => {
          this.seek = this.currentTrack.howl.seek()
        }, 250)
      } else {
        clearInterval(updateSeek)
      }
    },
  },
  methods: {
    getArtists(artists) {
      if (artists !== undefined && Array.isArray(artists)) {
        return artists.join(', ');
      }
      return artists;
    },
    selectTrack(track) {
      console.log(track)
      this.selectedTrack = track
    },
    play (index) {
      let selectedTrackIndex = this.playlist.findIndex(track => track === this.selectedTrack)

      if (this.selectedTrack) {
        if (this.selectedTrack !== this.currentTrack) {
          this.stop()
        }
        index = selectedTrackIndex
      } else {
        index = this.index
      }

      let track = this.playlist[index].howl

      if (track.playing()) {
        return
      } else {
        track.play()
      }

      this.selectedTrack = this.playlist[index]
      this.playing = true
      this.index = index
    },
    pause () {
      this.currentTrack.howl.pause()
      this.playing = false
    },
    stop () {
      this.currentTrack.howl.stop()
      this.playing = false
    },
    skip (direction) {
      let index = 0,
        lastIndex = this.playlist.length - 1

      if (this.shuffle) {
        index = Math.round(Math.random() * lastIndex)
        while (index === this.index) {
          index = Math.round(Math.random() * lastIndex)
        }
      } else if (direction === "next") {
        index = this.index + 1
        if (index >= this.playlist.length) {
          index = 0
        }
      } else {
        index = this.index - 1
        if (index < 0) {
          index = this.playlist.length - 1
        }
      }

      this.skipTo(index)
    },
    skipTo (index) {
      if (this.currentTrack) {
        this.currentTrack.howl.stop()
      }

      this.play(index)
    },
    toggleLoop (value) {
      this.loop = value
    },
    toggleShuffle (value) {
      this.shuffle = value
    },
    setSeek (percents) {
      let track = this.currentTrack.howl

      if (track.playing()) {
        track.seek((track.duration() / 100) * percents)
      }
    },
    searchPlaylist () {
      this.playlist.forEach((track) => {
        if (this.searchString) {
          track.display = !(!track.title.toLowerCase().includes(this.searchString.toLowerCase()) && !track.artist.toLowerCase().includes(this.searchString.toLowerCase()));
        } else if (this.searchString === "" || this.searchString === null) {
          track.display = true
        }
      })
    }
  }
}
</script>
