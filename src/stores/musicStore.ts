import { plainStoreSnapshot } from '@/stores/serialization';
import { effectScope, markRaw, reactive, toRaw, watch } from 'vue';
import { Howl } from 'howler';
import { resolveIcon } from '@/shared/utils/resolver';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { walletStore } from '@/stores/walletStore';

export interface MusicTrack {
  id: string;
  artist: string;
  title: string;
  img?: string;
  url: string;
  mediaType: string;
  metadata?: Record<string, unknown>;
  name: string;
  display: boolean;
  category?: string;
}

export interface MusicContext {
  img?: string;
  isPlaying: boolean;
  isRepeat: boolean;
  isShuffle: boolean;
  currentIndex: number;
  audio?: Howl;
  paused: boolean;
  volume: number;
  position: number;
  seek: number;
  duration?: number;
  minimized: boolean;
  shown: boolean;
}

export interface MusicStore {
  musicPlaylist: MusicTrack[] | undefined;
  context: MusicContext;
}

// Create observable state
export const musicStore = reactive<MusicStore>({
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

const STORE_NAME = 'musicStore';
const context = getContextType();

// Function to clear music store data immediately
function clearMusicStoreImmediately() {

  // Stop any playing audio
  if (musicStore.context.audio && typeof musicStore.context.audio.stop === 'function') {
    musicStore.context.audio.stop();
  }
  if (musicStore.context.audio && typeof musicStore.context.audio.unload === 'function') {
    musicStore.context.audio.unload();
  }

  // Clear the store data immediately (this will trigger UI updates)
  musicStore.musicPlaylist = undefined;
  musicStore.context = {
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
  };
}

// One watcher belongs to this context's store module, not to each UI mount.
// Clear synchronously so the previous wallet cannot play between a switch and
// Vue's next render. HMR disposes the scope rather than accumulating watchers.
const walletScope = effectScope(true);
walletScope.run(() => {
  watch(() => walletStore.loggedWallet?.id ?? null, (walletId, previousId) => {
    if (previousId != null && walletId !== previousId) clearMusicStoreImmediately();
  }, { flush: 'sync' });
});
let unsubscribe: (() => void) | undefined;
if (import.meta.hot) import.meta.hot.dispose(() => {
  walletScope.stop();
  unsubscribe?.();
  clearMusicStoreImmediately();
});

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  // Browser context: Subscribe to updates from background
  unsubscribe = storeMessaging.subscribe(STORE_NAME, (updates: Partial<MusicStore>) => {

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in musicStore) {
        // Special handling for context to preserve audio instance
        if (key === 'context' && musicStore.context.audio) {
          const audioInstance = musicStore.context.audio;
          musicStore.context = { ...musicStore.context, ...updates.context, audio: audioInstance };
        } else {
          (musicStore as unknown as Record<string, unknown>)[key] = updates[key as keyof MusicStore];
        }
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      // Don't restore audio-specific states that can't be serialized
      const storedData = result[STORE_NAME] as Partial<MusicStore>;
      if (storedData.context) {
        storedData.context.audio = undefined;
        storedData.context.isPlaying = false;
        storedData.context.seek = 0;
      }
      Object.assign(musicStore, storedData);
    }
  });
}

/**
 * Serialize context for storage/messaging (exclude non-serializable fields)
 */
function serializeContext(ctx: MusicContext): Omit<MusicContext, 'audio'> {
  const { audio: _audio, ...serializableContext } = ctx;
  return serializableContext;
}

/**
 * Broadcast updates from background context
 */
function broadcastFromBackground(updates: Partial<MusicStore>) {
  if (context === 'background') {
    // Serialize context if present
    const serializedUpdates = { ...updates };
    if (serializedUpdates.context) {
      serializedUpdates.context = serializeContext(serializedUpdates.context);
    }

    // Broadcast to all connected browser contexts
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, serializedUpdates);

    // Also persist to storage as fallback
    chrome.storage.local.get(STORE_NAME, (result) => {
      const current = (result[STORE_NAME] as Partial<MusicStore> | undefined) || {
        musicPlaylist: undefined,
        context: {
          img: undefined,
          isPlaying: false,
          isRepeat: false,
          isShuffle: false,
          currentIndex: 0,
          paused: true,
          volume: 100,
          position: 0,
          seek: 0,
          duration: undefined,
          minimized: false,
          shown: false,
        }
      };
      chrome.storage.local.set(plainStoreSnapshot({
        [STORE_NAME]: { ...current, ...serializedUpdates }
      }));
    });
  }
}

const MusicStoreModule = {
  resolveMusicPlaylist(resolvedCollections) {
    const mediaNFTs = []
    resolvedCollections.forEach(collection => {
      collection.items.forEach(nft => {
        try {
          if (nft.onchain_metadata && nft.onchain_metadata.files && Array.isArray(nft.onchain_metadata.files) && nft.onchain_metadata.files.some(file => file.mediaType?.includes('audio'))) {
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
            const getArtists = (artists: unknown) => {
              if (artists !== undefined && Array.isArray(artists)) {
                return artists.join(', ');
              }
              return typeof artists === 'string' ? artists : undefined;
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
        .filter(nft => nft.mediaType?.includes('audio'))
    )
  },

  setMusicPlaylist(musicPlaylist: MusicTrack[]) {
    musicStore.musicPlaylist = musicPlaylist;
    broadcastFromBackground({ musicPlaylist });
  },

  setContext(context: MusicContext) {
    if (context.audio) context.audio = markRaw(toRaw(context.audio));
    musicStore.context = context;
    broadcastFromBackground({ context: serializeContext(context) });
  },

  setMinimized() {
    musicStore.context.minimized = true;
    broadcastFromBackground({ context: serializeContext(musicStore.context) });
  },

  setMaximized() {
    musicStore.context.minimized = false;
    broadcastFromBackground({ context: serializeContext(musicStore.context) });
  },

  setMediaPlayerShown(value) {
    musicStore.context.shown = value;
    broadcastFromBackground({ context: serializeContext(musicStore.context) });
  },

  setTrack(index) {
    musicStore.context.currentIndex = index;
    if (musicStore.context.isPlaying) {
      MusicStoreModule.playTrack();
    } else {
      musicStore.context.seek = 0;
      MusicStoreModule.initializeSound();
    }
    broadcastFromBackground({ context: serializeContext(musicStore.context) });
  },

  initializeSound() {
    if (musicStore.context.audio && typeof musicStore.context.audio.stop === 'function') {
      musicStore.context.audio.stop();
    }
    if (musicStore.context.audio && typeof musicStore.context.audio.unload === 'function') {
      musicStore.context.audio.unload();
    }
    if (musicStore.musicPlaylist) {
      const current = musicStore.musicPlaylist[musicStore.context.currentIndex];
      if (!current) return;
      musicStore.context.audio = markRaw(new Howl({
        src: [current.url],
        onend: () => {
          musicStore.context.isPlaying = false;
          if (musicStore.context.isRepeat) {
            musicStore.context.audio?.play();
          } else {
            MusicStoreModule.nextTrack();
          }
        },
        onplay: () => {
          musicStore.context.isPlaying = true;
          musicStore.context.duration = musicStore.context.audio?.duration();
          requestAnimationFrame(MusicStoreModule.step);
        },
        onpause: () => {
          musicStore.context.isPlaying = false;
        },
        onstop: () => {
          musicStore.context.isPlaying = false;
        },
        format: current.mediaType,
        html5: true,
      }));
    }
  },


  step() {
    const sound = musicStore.context.audio;

    if (!sound || typeof sound.seek !== 'function' || typeof sound.playing !== 'function') {
      return;
    }

    musicStore.context.seek = Math.round(sound.seek()) || 0;

    if (sound.playing()) {
      requestAnimationFrame(MusicStoreModule.step);
    }
  },

  nextTrack() {
    if (!musicStore.musicPlaylist?.length) return;
    const wasPlaying = musicStore.context.isPlaying;
    console.log('nextTrack called, wasPlaying:', wasPlaying);

    if (musicStore.context.audio && typeof musicStore.context.audio.stop === 'function') {
      musicStore.context.audio.stop();
    }

    if (musicStore.context.isShuffle) {
      musicStore.context.currentIndex = Math.floor(Math.random() * musicStore.musicPlaylist.length);
    } else {
      musicStore.context.currentIndex = (musicStore.context.currentIndex + 1) % musicStore.musicPlaylist.length;
    }

    console.log('New track index:', musicStore.context.currentIndex);

    if (wasPlaying) {
      console.log('Calling playTrack because music was playing');
      MusicStoreModule.playTrack();
    } else {
      console.log('Calling initializeSound because music was paused');
      MusicStoreModule.initializeSound();
    }

    broadcastFromBackground({ context: serializeContext(musicStore.context) });
  },

  prevTrack() {
    if (!musicStore.musicPlaylist?.length) return;
    const wasPlaying = musicStore.context.isPlaying;

    if (musicStore.context.audio && typeof musicStore.context.audio.stop === 'function') {
      musicStore.context.audio.stop();
    }

    musicStore.context.currentIndex = (musicStore.context.currentIndex - 1 + musicStore.musicPlaylist.length) % musicStore.musicPlaylist.length;

    if (wasPlaying) {
      MusicStoreModule.playTrack();
    } else {
      MusicStoreModule.initializeSound();
    }

    broadcastFromBackground({ context: serializeContext(musicStore.context) });
  },

  toggleRepeat() {
    musicStore.context.isRepeat = !musicStore.context.isRepeat;
    broadcastFromBackground({ context: serializeContext(musicStore.context) });
  },

  toggleShuffle() {
    musicStore.context.isShuffle = !musicStore.context.isShuffle;
    broadcastFromBackground({ context: serializeContext(musicStore.context) });
  },

  playTrack() {
    console.log('playTrack called, current index:', musicStore.context.currentIndex);
    MusicStoreModule.initializeSound();
    if (musicStore.musicPlaylist && musicStore.musicPlaylist[musicStore.context.currentIndex] && musicStore.musicPlaylist[musicStore.context.currentIndex].mediaType.includes('audio')) {
      console.log('Playing track:', musicStore.musicPlaylist[musicStore.context.currentIndex].title);
      musicStore.context.audio?.play();
      musicStore.context.isPlaying = true;
      broadcastFromBackground({ context: serializeContext(musicStore.context) });
    } else {
      console.log('Cannot play track - no audio or invalid track');
    }
  },

  togglePlayPause() {
    if (!musicStore.musicPlaylist || !musicStore.musicPlaylist[musicStore.context.currentIndex]) {
      console.warn('No track selected');
      return;
    }

    if (!musicStore.context.audio || typeof musicStore.context.audio.pause !== 'function' || typeof musicStore.context.audio.play !== 'function') {
      console.log('Initializing audio for current track');
      MusicStoreModule.initializeSound();
    }

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

    broadcastFromBackground({ context: serializeContext(musicStore.context) });
  },

  setVolume(val) {
    if (musicStore.context.audio) {
      musicStore.context.volume = val;
      musicStore.context.audio.volume(val / 100);
    }
    broadcastFromBackground({ context: serializeContext(musicStore.context) });
  },

  async logout() {
    console.log('MusicStore: Logout Called');

    // Stop any playing audio
    if (musicStore.context.audio && typeof musicStore.context.audio.stop === 'function') {
      musicStore.context.audio.stop();
    }
    if (musicStore.context.audio && typeof musicStore.context.audio.unload === 'function') {
      musicStore.context.audio.unload();
    }

    // Clear the store data
    const clearedState: MusicStore = {
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
    };

    Object.assign(musicStore, clearedState);
    broadcastFromBackground(clearedState);

    // Clear from Chrome storage to prevent rehydration with old data
    if (chrome?.storage?.local) {
      try {
        await chrome.storage.local.remove(STORE_NAME);
      } catch (error) {
        console.error('MusicStore: Failed to clear from Chrome storage:', error);
      }
    }
  },

  // Expose the observable state
  state: musicStore,

  // Utility method to get current state snapshot
  getSnapshot(): MusicStore {
    return {
      musicPlaylist: musicStore.musicPlaylist,
      context: serializeContext(musicStore.context)
    };
  },

  // Utility method to reset state
  reset() {
    return this.logout();
  },

  // Utility method to check if player has playlist
  hasPlaylist(): boolean {
    return musicStore.musicPlaylist !== undefined && musicStore.musicPlaylist?.length > 0;
  },

  // Utility method to get current track
  getCurrentTrack(): MusicTrack | null {
    if (!musicStore.musicPlaylist || musicStore.context.currentIndex >= musicStore.musicPlaylist.length) {
      return null;
    }
    return musicStore.musicPlaylist[musicStore.context.currentIndex];
  },

  // Utility method to get playlist length
  getPlaylistLength(): number {
    return musicStore.musicPlaylist?.length || 0;
  }
};

export default MusicStoreModule;
