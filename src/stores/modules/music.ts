import { Howl } from 'howler';
import { getArtists } from '@/shared/utils/converter';
import { defineStore } from 'pinia';

const baseUrl = import.meta.env['VITE_BACKEND_URL'];

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

  }
});
