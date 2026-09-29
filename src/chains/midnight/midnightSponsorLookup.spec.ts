import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  destination: vi.fn(),
  batch: vi.fn(),
  enumerate: vi.fn(),
  wallets: {} as Record<string, unknown>,
}));

vi.mock('@/api/midnight-api', async (importOriginal) => ({
  // Keep the real `DustDestinationUnsupportedError`: the lookup branches on `instanceof`.
  ...(await importOriginal<typeof import('@/api/midnight-api')>()),
  getMidnightApi: () => ({ getDustDestination: mocks.destination, getDustStatusBatch: mocks.batch }),
}));
vi.mock('@/shared/composables/useCardanoStakeEnumeration', () => ({
  enumerateCardanoStakeIdentities: mocks.enumerate,
}));
vi.mock('@/stores/geroStore', () => ({ geroStore: { get wallets() { return mocks.wallets; } } }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

import { Blockchain } from '@/models/types';
import { DustDestinationUnsupportedError } from '@/api/midnight-api';
import { loadSponsorCandidates } from './midnightSponsorLookup';

const NETWORK = 'Mainnet';
const SENDER = 1;
const DUST_A = 'mn_dust1wwm5tk7ufsg9drn9wtm8yjzcz9wqsj42m4jjuqufpurqp2rcf075xxue5e8';
const DUST_B = 'mn_dust1wwaytdqf2wqtz033qcryjkddpu6c43c9mffwq8fkgyknnnwmc7gn5hptr9w';

function midnightWallet(id: number, name: string, dust: string, network = NETWORK) {
  return { id, name, chain: Blockchain.MIDNIGHT, network, publicKey: JSON.stringify({ dust }) };
}
function destination(over: Record<string, unknown> = {}) {
  return {
    dustAddress: DUST_A, registered: true, nightBalance: '935253826', generationRate: '7731743379542',
    maxCapacity: '9000', currentCapacity: '4500',
    stakes: [
      { cardanoRewardAddress: 'stake1a', state: 'active' },
      { cardanoRewardAddress: 'stake1b', state: 'active' },
    ],
    ...over,
  };
}

beforeEach(() => {
  mocks.destination.mockReset();
  mocks.batch.mockReset();
  mocks.enumerate.mockReset();
  mocks.wallets = {
    1: midnightWallet(SENDER, 'Sender', 'mn_dust1sender'),
    2: midnightWallet(2, 'Alpha', DUST_A),
    3: midnightWallet(3, 'Beta', DUST_B),
  };
});

describe('loadSponsorCandidates — destination path', () => {
  it('asks about each candidate wallet\'s own dust address, never the sender\'s, and never enumerates stakes', async () => {
    mocks.destination.mockImplementation(async (dust: string) => destination({ dustAddress: dust }));

    const { candidates, lookupIncomplete } = await loadSponsorCandidates(SENDER, NETWORK);

    expect(mocks.destination.mock.calls.map((c) => c[0]).sort()).toEqual([DUST_A, DUST_B].sort());
    expect(mocks.enumerate).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(candidates.map((c) => c.walletId).sort()).toEqual([2, 3]);
    expect(lookupIncomplete).toBe(false);
  });

  it('counts the capacity once when two stakes feed one destination', async () => {
    mocks.destination.mockImplementation(async (dust: string) => destination({ dustAddress: dust }));

    const { candidates } = await loadSponsorCandidates(SENDER, NETWORK);

    const alpha = candidates.find((c) => c.walletId === 2)!;
    expect(alpha.state).toBe('ready');
    expect(alpha.capacity).toBe(4500n); // two active stakes, one destination: not 9000n
    expect(alpha.cap).toBe(9000n);
    expect(alpha.fundedBy).toEqual(['stake1a', 'stake1b']);
  });

  it('maps a not-yet-relayed destination to relaying and an empty one to unknown, ranked best first', async () => {
    mocks.destination.mockImplementation(async (dust: string) => (dust === DUST_A
      ? destination({ dustAddress: dust, registered: false, currentCapacity: '0', maxCapacity: '0',
        stakes: [{ cardanoRewardAddress: 'stake1a', state: 'relaying' }] })
      : destination({ dustAddress: dust, registered: false, currentCapacity: '0', maxCapacity: '0', stakes: [] })));

    const { candidates } = await loadSponsorCandidates(SENDER, NETWORK);

    expect(candidates.map((c) => [c.walletId, c.state])).toEqual([[2, 'relaying'], [3, 'unknown']]);
  });

  it('leaves a wallet whose lookup failed unknown, marks the result incomplete, and still resolves the others', async () => {
    mocks.destination.mockImplementation(async (dust: string) => {
      if (dust === DUST_B) throw JSON.stringify({ status: 503 });
      return destination({ dustAddress: dust });
    });

    const { candidates, lookupIncomplete } = await loadSponsorCandidates(SENDER, NETWORK);

    expect(candidates.find((c) => c.walletId === 2)!.state).toBe('ready');
    const beta = candidates.find((c) => c.walletId === 3)!;
    expect(beta.state).toBe('unknown'); // "not checked", never a confident zero
    expect(beta.capacity).toBeNull();
    expect(lookupIncomplete).toBe(true);
  });

  it('does not query wallets from another network or without a stored dust address', async () => {
    mocks.wallets = {
      1: midnightWallet(SENDER, 'Sender', 'mn_dust1sender'),
      2: midnightWallet(2, 'Alpha', DUST_A),
      4: midnightWallet(4, 'Preprod one', 'mn_dust_preprod1x', 'Preprod'),
      5: { id: 5, name: 'Old record', chain: Blockchain.MIDNIGHT, network: NETWORK, publicKey: '{}' },
    };
    mocks.destination.mockImplementation(async (dust: string) => destination({ dustAddress: dust }));

    const { candidates } = await loadSponsorCandidates(SENDER, NETWORK);

    expect(mocks.destination).toHaveBeenCalledTimes(1);
    expect(mocks.destination).toHaveBeenCalledWith(DUST_A);
    expect(candidates.map((c) => [c.walletId, c.state])).toEqual([[2, 'ready'], [5, 'unknown']]);
  });

  it('looks up more wallets than the concurrency limit', async () => {
    mocks.wallets = { 1: midnightWallet(SENDER, 'Sender', 'mn_dust1sender') };
    for (let id = 10; id < 18; id += 1) mocks.wallets[id] = midnightWallet(id, `W${id}`, `mn_dust1w${id}`);
    mocks.destination.mockImplementation(async (dust: string) => destination({ dustAddress: dust }));

    const { candidates } = await loadSponsorCandidates(SENDER, NETWORK);

    expect(mocks.destination).toHaveBeenCalledTimes(8);
    expect(candidates).toHaveLength(8);
    expect(candidates.every((c) => c.state === 'ready')).toBe(true);
  });

  it('returns nothing to look up when the profile has no other Midnight wallet', async () => {
    mocks.wallets = { 1: midnightWallet(SENDER, 'Sender', 'mn_dust1sender') };

    const result = await loadSponsorCandidates(SENDER, NETWORK);

    expect(result).toEqual({ candidates: [], lookupIncomplete: false });
    expect(mocks.destination).not.toHaveBeenCalled();
  });
});

describe('loadSponsorCandidates — fallback for a Nexus without dust/destination', () => {
  const row = (stake: string, dust: string, capacity: string) => ({
    cardanoRewardAddress: stake, dustAddress: dust, registered: true,
    currentCapacity: capacity, maxCapacity: '9000', registrationUtxoTxHash: 'tx',
  });

  it.each([404, 501])('falls back to the per-stake rows on %i and takes the capacity once', async (status) => {
    mocks.destination.mockRejectedValue(new DustDestinationUnsupportedError(status));
    mocks.enumerate.mockResolvedValue([{ stakeAddress: 'stake1a' }, { stakeAddress: 'stake1b' }]);
    mocks.batch.mockResolvedValue([row('stake1a', DUST_A, '4500'), row('stake1b', DUST_A, '4500')]);

    const { candidates, lookupIncomplete } = await loadSponsorCandidates(SENDER, NETWORK);

    const alpha = candidates.find((c) => c.walletId === 2)!;
    expect(alpha.state).toBe('ready');
    expect(alpha.capacity).toBe(4500n); // two rows for one address: not 9000n
    expect(alpha.cap).toBe(9000n);
    expect(candidates.find((c) => c.walletId === 3)!.state).toBe('unknown');
    expect(lookupIncomplete).toBe(false);
  });

  it('is incomplete, with every candidate unknown, when the profile has no stakes to enumerate', async () => {
    mocks.destination.mockRejectedValue(new DustDestinationUnsupportedError(404));
    mocks.enumerate.mockResolvedValue([]);

    const { candidates, lookupIncomplete } = await loadSponsorCandidates(SENDER, NETWORK);

    expect(candidates.map((c) => c.state)).toEqual(['unknown', 'unknown']);
    expect(lookupIncomplete).toBe(true);
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('stays unknown and incomplete when the fallback batch fails too', async () => {
    mocks.destination.mockRejectedValue(new DustDestinationUnsupportedError(501));
    mocks.enumerate.mockResolvedValue([{ stakeAddress: 'stake1a' }]);
    mocks.batch.mockRejectedValue(JSON.stringify({ status: 503 }));

    const { candidates, lookupIncomplete } = await loadSponsorCandidates(SENDER, NETWORK);

    expect(candidates.every((c) => c.state === 'unknown')).toBe(true);
    expect(lookupIncomplete).toBe(true);
  });
});
