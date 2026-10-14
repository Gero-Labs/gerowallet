import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isProxy, reactive } from 'vue';

const mocks = vi.hoisted(() => ({ stop: vi.fn(), unload: vi.fn(), broadcast: vi.fn(), writes: [] as unknown[] }));
vi.mock('howler', () => ({ Howl: class {
  stop = mocks.stop;
  unload = mocks.unload;
} }));
vi.mock('@/shared/utils/resolver', () => ({ resolveIcon: (value: string) => value }));
vi.mock('@/utils/storageSync', () => ({ getContextType: () => 'background' }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: mocks.broadcast } }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({ loggedWallet: { id: 1 } }) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.writes.length = 0;
  vi.stubGlobal('chrome', { storage: { local: {
    get: (_key: string, callback: (items: object) => void) => callback({}),
    set: (items: unknown) => { mocks.writes.push(structuredClone(items)); },
    remove: async () => {},
  } } });
});
afterEach(() => vi.unstubAllGlobals());

describe('music store Vue3 lifetime', () => {
  it('keeps Howl raw and clears playback synchronously when the wallet changes', async () => {
    const { default: music, musicStore } = await import('./musicStore');
    const { walletStore } = await import('./walletStore');
    music.setMusicPlaylist([{ id: 'nft', artist: 'artist', title: 'title', url: 'https://example.test/audio', mediaType: 'audio/mpeg', name: 'track', display: true }]);
    music.initializeSound();
    const audio = musicStore.context.audio;
    expect(audio).toBeDefined();
    expect(isProxy(audio)).toBe(false);
    music.setContext(reactive({ ...musicStore.context, audio, isPlaying: true }));
    expect(musicStore.context.audio).toBe(audio);
    expect(mocks.writes).not.toHaveLength(0);
    for (const write of mocks.writes) expect(write).not.toHaveProperty('musicStore.context.audio');
    walletStore.loggedWallet.id = 2;
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.unload).toHaveBeenCalledTimes(1);
    expect(musicStore.musicPlaylist).toBeUndefined();
    expect(musicStore.context.audio).toBeUndefined();
    expect(musicStore.context.isPlaying).toBe(false);
    await music.logout();
  });
});
