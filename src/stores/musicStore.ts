import Vue from 'vue';
import { getArtists } from '@/shared/utils/converter';
import { Howl } from 'howler';
import { resolveIcon } from '@/shared/utils/resolver';

export interface MusicStore {
  musicPlaylist: any;
  context: any;
}

export const musicStore = Vue.observable<MusicStore>({
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
  }
});

chrome.storage.local.get('musicStore', (res) => {
  if (res['musicStore']) {
    Object.assign(musicStore, res['musicStore']);
    // Reset audio-specific states that can't be restored from storage
    musicStore.context.audio = undefined;
    musicStore.context.isPlaying = false;
    musicStore.context.seek = 0;
  }
});

// Removed chrome.storage.onChanged listener to prevent data overwrite issues

function persist(patch: Partial<MusicStore>) {
  const next = { ...musicStore, ...patch };
  chrome.storage.local.set({ musicStore: next });
}

const MusicStoreModule = {
  resolveMusicPlaylist(resolvedCollections) {
    const mediaNFTs = []
    resolvedCollections.forEach(collection => {
      collection.items.forEach(nft => {
        try {
          if (nft.onchain_metadata && nft.onchain_metadata.files && Array.isArray(nft.onchain_metadata.files) && nft.onchain_metadata.files.some(file => file.mediaType?.includes('audio'))) { //|| file.mediaType.includes('video'))) {
            nft['collection'] = collection.name
            mediaNFTs.push(nft)
          }
        } catch (e) {
          console.log(e)
        }
      })
    })
    MusicStoreModule.setMusicPlaylist(mediaNFTs.map(nft => {
        return nft.onchain_metadata.files?.filter(file => file.src)
          .map(file => {
            let fileSrc
            if (typeof file.src == 'string') {
              fileSrc = file.src
            } else if (Array.isArray(file.src)) {
              fileSrc = file.src.join('')
            }
            return {
              id: nft.unit,
              artist: getArtists(nft.onchain_metadata.release?.artists) || nft.metadata?.name || nft.name,
              title: (file.song?.song_title || nft.name) + (file.mediaType?.includes('video') ? " (Video)" : ""),
              img: nft.img,
              url: resolveIcon(fileSrc),
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
    musicStore.musicPlaylist = musicPlaylist;
    persist({ musicPlaylist: musicPlaylist });
  },
  setMinimized() {
    musicStore.context.minimized = true
    persist({ context: musicStore.context })
  },
  setMaximized() {
    musicStore.context.minimized = false
    persist({ context: musicStore.context })
  },
  setMediaPlayerShown(value) {
    musicStore.context.shown = value
    persist({ context: musicStore.context })
  },
  setTrack(index) {
    musicStore.context.currentIndex = index
    if (musicStore.context.isPlaying) {
      MusicStoreModule.playTrack()
    } else {
      musicStore.context.seek = 0
      MusicStoreModule.initializeSound();
    }
  },
  initializeSound() {
    if (musicStore.context.audio && typeof musicStore.context.audio.stop === 'function') {
      musicStore.context.audio.stop();
    }
    if (musicStore.context.audio && typeof musicStore.context.audio.unload === 'function') {
      musicStore.context.audio.unload();
    }
    if (musicStore.musicPlaylist) {
      const current = musicStore.musicPlaylist[musicStore.context.currentIndex]
      musicStore.context.audio = new Howl({
        src: [current.url],
        onend: () => {
          musicStore.context.isPlaying = false;
          if (musicStore.context.isRepeat) {
            musicStore.context.audio.play();
          } else {
            MusicStoreModule.nextTrack(); // Automatically play the next track when the current one ends
          }
        },
        onplay: () => {
          // Sync the playing state
          musicStore.context.isPlaying = true;
          
          // Display the duration.
          musicStore.context.duration = musicStore.context.audio.duration();

          // Start updating the progress of the track.
          requestAnimationFrame(MusicStoreModule.step);

          // Start the wave animation if we have already loaded
          // wave.container.style.display = 'block';
          // bar.style.display = 'none';
          // pauseBtn.style.display = 'block';
        },
        onpause: () => {
          // Sync the playing state
          musicStore.context.isPlaying = false;
        },
        onstop: () => {
          // Sync the playing state
          musicStore.context.isPlaying = false;
        },
        format: current.mediaType,
        html5: true,
      });
    }
  },
  step() {
    // Get the Howl we want to manipulate.
    const sound = musicStore.context.audio;

    // Check if sound exists and has the required methods
    if (!sound || typeof sound.seek !== 'function' || typeof sound.playing !== 'function') {
      return;
    }

    // Determine our current seek position.
    musicStore.context.seek = Math.round(sound.seek()) || 0;
    // progress.style.width = (((musicStore.context.seek / sound.duration()) * 100) || 0) + '%';

    // If the sound is still playing, continue stepping.
    if (sound.playing()) {
      requestAnimationFrame(MusicStoreModule.step);
    }
  },
  nextTrack() {
    // Store if music was playing
    const wasPlaying = musicStore.context.isPlaying;
    console.log('nextTrack called, wasPlaying:', wasPlaying);
    
    // Stop current audio
    if (musicStore.context.audio && typeof musicStore.context.audio.stop === 'function') {
      musicStore.context.audio.stop();
    }
    
    if (musicStore.context.isShuffle) {
      musicStore.context.currentIndex = Math.floor(Math.random() * musicStore.musicPlaylist.length);
    } else {
      musicStore.context.currentIndex = (musicStore.context.currentIndex + 1) % musicStore.musicPlaylist.length;
    }
    
    console.log('New track index:', musicStore.context.currentIndex);
    
    // Always play the new track if music was playing
    if (wasPlaying) {
      console.log('Calling playTrack because music was playing');
      MusicStoreModule.playTrack();
    } else {
      console.log('Calling initializeSound because music was paused');
      // Just initialize without playing
      MusicStoreModule.initializeSound();
    }
  },
  prevTrack() {
    // Store if music was playing
    const wasPlaying = musicStore.context.isPlaying;
    
    // Stop current audio
    if (musicStore.context.audio && typeof musicStore.context.audio.stop === 'function') {
      musicStore.context.audio.stop();
    }
    
    musicStore.context.currentIndex = (musicStore.context.currentIndex - 1 + musicStore.musicPlaylist.length) % musicStore.musicPlaylist.length;
    
    // Always play the new track if music was playing
    if (wasPlaying) {
      MusicStoreModule.playTrack();
    } else {
      // Just initialize without playing
      MusicStoreModule.initializeSound();
    }
  },
  toggleRepeat() {
    musicStore.context.isRepeat = !musicStore.context.isRepeat;
  },
  toggleShuffle() {
    musicStore.context.isShuffle = !musicStore.context.isShuffle;
  },
  playTrack() {
    console.log('playTrack called, current index:', musicStore.context.currentIndex);
    MusicStoreModule.initializeSound();
    if (musicStore.musicPlaylist && musicStore.musicPlaylist[musicStore.context.currentIndex] && musicStore.musicPlaylist[musicStore.context.currentIndex].mediaType.includes('audio')) {
      console.log('Playing track:', musicStore.musicPlaylist[musicStore.context.currentIndex].title);
      musicStore.context.audio.play();
      musicStore.context.isPlaying = true;
    } else {
      console.log('Cannot play track - no audio or invalid track');
    }
  },
  togglePlayPause() {
    // Check if we have a playlist and current track
    if (!musicStore.musicPlaylist || !musicStore.musicPlaylist[musicStore.context.currentIndex]) {
      console.warn('No track selected');
      return;
    }
    
    // Initialize audio if it doesn't exist or isn't a proper Howl instance
    if (!musicStore.context.audio || typeof musicStore.context.audio.pause !== 'function' || typeof musicStore.context.audio.play !== 'function') {
      console.log('Initializing audio for current track');
      MusicStoreModule.initializeSound();
    }
    
    // Double check after initialization
    if (!musicStore.context.audio || typeof musicStore.context.audio.pause !== 'function' || typeof musicStore.context.audio.play !== 'function') {
      console.warn('Audio initialization failed');
      return;
    }
    
    if (musicStore.context.isPlaying) {
      musicStore.context.audio.pause();
      musicStore.context.isPlaying = false;
    } else {
      musicStore.context.audio.play();
      musicStore.context.isPlaying = true;
    }
  },
  setVolume(val) {
    if (musicStore.context.audio) {
      musicStore.context.volume = val
      musicStore.context.audio.volume(val / 100)
    }
  },
  state: musicStore
};

export default MusicStoreModule;
