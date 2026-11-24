// Issue 1453: Midnight Preview syncs over gero-sync under `midnight-preview`, and
// nothing the retired Stagenet left (a sync identity, a frame) is taken for it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ connect: vi.fn(), resubscribe: vi.fn() }));
vi.mock('@/services/websocket.service', () => ({ default: { connect: h.connect, close: vi.fn(), resubscribe: h.resubscribe } }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ getLatestBlock: async () => ({ height: 10, hash: 'ab'.repeat(32), time: 1_788_996_846 }) }) }));

import service from '@/services/midnight-sync.service';
import { hydrateChainIdentity } from '@/stores/midnightStore';
import { clearMidnightNetworkCheckpoints, parseMidnightSyncIdentity } from '@/chains/midnight/midnightSyncGeneration';
import { Network } from '@/models/types';

const GENESIS = `0x${'cd'.repeat(32)}`;
const frame = (network: string) => ({ midnight_network: network, midnight_chain_generation: 1, midnight_genesis_hash: GENESIS });

beforeEach(() => {
  // start() also reads the chain's ledger and write status: never over the network here.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
  service.stop();
  h.connect.mockClear();
});
afterEach(() => { service.stop(); vi.unstubAllGlobals(); });

describe('Midnight Preview over gero-sync', () => {
  it.each([
    [Network.PREVIEW, 'midnight-preview'],
    [Network.PREPROD, 'midnight-preprod'],
    [Network.MAINNET, 'midnight-mainnet'],
  ])('subscribes a %s wallet as %s', (network, slug) => {
    service.start(network, { unshielded: 'mn_addr_preview1test', shielded: '', dust: '' });
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(h.connect.mock.lastCall!.slice(0, 3)).toEqual(['MIDNIGHT', slug, 'mn_addr_preview1test']);
  });

  it('reads a Preview frame\'s chain identity, and no Stagenet one', () => {
    expect(parseMidnightSyncIdentity(frame('midnight-preview'), 'midnight-preview'))
      .toEqual({ network: 'midnight-preview', generation: 1, genesisHash: GENESIS });
    expect(parseMidnightSyncIdentity(frame('midnight-stagenet'), 'midnight-stagenet')).toBeNull();
    // A frame of another network is never this one's.
    expect(parseMidnightSyncIdentity(frame('midnight-preprod'), 'midnight-preview')).toBeNull();
  });

  it('drops a stored Stagenet sync identity, so the first Preview frame starts a fresh chain', () => {
    expect(hydrateChainIdentity({ network: 'midnight-preview', generation: 2, genesisHash: GENESIS }))
      .toEqual({ network: 'midnight-preview', generation: 2, genesisHash: GENESIS });
    expect(hydrateChainIdentity({ network: 'midnight-stagenet', generation: 2, genesisHash: GENESIS })).toBeNull();
  });

  it('clears the checkpoints of Preview, and of Stagenet for the move, but of no unknown network', async () => {
    await expect(clearMidnightNetworkCheckpoints('midnight-preview')).resolves.toBeUndefined();
    await expect(clearMidnightNetworkCheckpoints('midnight-stagenet')).resolves.toBeUndefined();
    await expect(clearMidnightNetworkCheckpoints('midnight-devnet')).rejects.toThrow('Invalid Midnight reset network');
  });
});
