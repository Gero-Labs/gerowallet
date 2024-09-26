import { Howl } from 'howler';
import { getArtists } from '@/shared/utils/converter';
import { defineStore } from 'pinia';

const baseUrl = process.env['VUE_APP_BACKEND_URL'];

export const musicStore = defineStore( 'musicStore', {
  persist: {
    paths: ['musicPlaylist']
  },
  state: () => ({
    musicPlaylist: undefined,
    context: {
      img: undefined,
      isPlaying: false,
      isRepeat: false,
      isShuffle: false,
      currentIndex: 0,
      audio: undefined,
      paused: true,
      volume: 100,
      position: 0,
      seek: 0,
      duration: undefined,
      minimized: false,
      shown: false,
    },
  }),
  actions: {
    resolveMusicPlaylist(resolvedCollections) {
      const mediaNFTs = []
      resolvedCollections.forEach(collection => {
        collection.items.forEach(nft => {
          if (nft.onchain_metadata && nft.onchain_metadata.files && nft.onchain_metadata.files.some(file => file.mediaType.includes('audio'))) { //|| file.mediaType.includes('video'))) {
            nft['collection'] = collection.name
            mediaNFTs.push(nft)
          }
        })
      })
      this.setMusicPlaylist(mediaNFTs.map(nft => {
        return nft.onchain_metadata.files?.filter(file => file.src)
          .map(file => {
            let src
            let fileSrc
            if (typeof file.src == 'string') {
              fileSrc = file.src
            } else if (Array.isArray(file.src)) {
              fileSrc = file.src.join('')
            }
            if (fileSrc.includes('ar://')) {
              src = `${baseUrl}/api/ar/${fileSrc.replace('ar://', '').replace('ar/', '')}`
            } else {
              src = `${baseUrl}/api/ipfs?path=${fileSrc.replace('ipfs://', '').replace('ipfs/', '')}`
            }
            return {
              id: nft.unit,
              artist: getArtists(nft.onchain_metadata.release?.artists) || nft.metadata?.name || nft.name,
              title: (file.song?.song_title || nft.name) + (file.mediaType?.includes('video') ? " (Video)" : ""),
              img: nft.img,
              url: src,
              mediaType: file.mediaType,
              metadata: nft.onchain_metadata,
              name: file.name || nft.name,
              display: true,
              category: nft.collection
            }
          });
      }).flat()
        .filter(nft => nft.mediaType?.includes('audio')) // || nft.mediaType?.includes('video'))
      )
    },
    setMusicPlaylist(musicPlaylist) {
      this.musicPlaylist = musicPlaylist
    },
    setMinimized() {
      this.context.minimized = true
    },
    setMaximized() {
      this.context.minimized = false
    },
    setMediaPlayerShown(value) {
      this.context.shown = value
    },
    setTrack(index) {
      this.context.currentIndex = index
      if (this.context.isPlaying) {
        this.playTrack()
      } else {
        this.context.seek = 0
        this.initializeSound();
      }
    },
    initializeSound() {
      if (this.context.audio) {
        this.context.audio.unload();
      }
      if (this.musicPlaylist) {
        const current = this.musicPlaylist[this.context.currentIndex]
        this.context.audio = new Howl({
          src: [current.url],
          onend: () => {
            if (this.context.isRepeat) {
              this.context.audio.play();
            } else {
              this.nextTrack(); // Automatically play the next track when the current one ends
            }
          },
          onplay: () => {
            // Display the duration.
            this.context.duration = this.context.audio.duration();

            // Start updating the progress of the track.
            requestAnimationFrame(this.step);

            // Start the wave animation if we have already loaded
            // wave.container.style.display = 'block';
            // bar.style.display = 'none';
            // pauseBtn.style.display = 'block';
          },
          format: current.mediaType,
          html5: true,
        });
      }
    },
    step() {
      // Get the Howl we want to manipulate.
      const sound = this.context.audio;

      // Determine our current seek position.
      this.context.seek = Math.round(sound.seek()) || 0;
      // progress.style.width = (((this.context.seek / sound.duration()) * 100) || 0) + '%';

      // If the sound is still playing, continue stepping.
      if (sound.playing()) {
        requestAnimationFrame(this.step);
      }
    },
    nextTrack() {
      if (this.context.isShuffle) {
        this.context.currentIndex = Math.floor(Math.random() * this.musicPlaylist.length);
      } else {
        this.context.currentIndex = (this.context.currentIndex + 1) % this.musicPlaylist.length;
      }
      this.playTrack();
    },
    prevTrack() {
      this.context.currentIndex = (this.context.currentIndex - 1 + this.musicPlaylist.length) % this.musicPlaylist.length;
      this.playTrack();
    },
    toggleRepeat() {
      this.context.isRepeat = !this.context.isRepeat;
    },
    toggleShuffle() {
      this.context.isShuffle = !this.context.isShuffle;
    },
    playTrack() {
      this.initializeSound();
      if (this.musicPlaylist[this.context.currentIndex].mediaType.includes('audio')) {
        this.context.audio.play();
        this.context.isPlaying = true;
      }
    },
    togglePlayPause() {
      if (!this.context.audio) {
        this.initializeSound()
      }
      if (this.context.isPlaying) {
        this.context.audio.pause();
        this.context.isPlaying = false;
      } else {
        this.context.audio.play();
        this.context.isPlaying = true;
      }
    },
    setVolume(val) {
      if (this.context.audio) {
        this.context.volume = val
        this.context.audio.volume(val / 100)
      }
    },
  }
});
