// The background reads which ledger each Midnight chain runs; the extension
// pages show the same one (proof server command, port) from the store's mirror.
import { beforeEach, describe, expect, it } from 'vitest';
import { hydrateChainLedgers, midnightActions, midnightStore, receiveMidnightBroadcast } from './midnightStore';
import { forgetMidnightLedgersForTests, knownMidnightLedger } from '@/chains/midnight/midnightLedger';

beforeEach(() => {
  forgetMidnightLedgersForTests();
  midnightStore.chainLedgers = {};
});

describe('chain ledgers mirrored to the pages', () => {
  it('records each chain read in the store, keyed by network', () => {
    midnightActions.setChainProtocolVersion('Preprod', 2_001_100);
    midnightActions.setChainProtocolVersion('midnight-mainnet', 1_999_999);
    expect(midnightStore.chainLedgers).toEqual({ preprod: 2_001_100, mainnet: 1_999_999 });
  });

  it('a page adopts what the background broadcast, for its own display', () => {
    receiveMidnightBroadcast({ chainLedgers: { preprod: 2_001_100, mainnet: 1_999_999 } });
    expect(knownMidnightLedger('Preprod')).toBe(9);
    expect(knownMidnightLedger('Mainnet')).toBe(8);
  });

  it('drops malformed entries', () => {
    expect(hydrateChainLedgers({ preprod: 2_001_100, mainnet: '2000000', 'Bad Key': 1, preview: -1 })).toEqual({ preprod: 2_001_100 });
    expect(hydrateChainLedgers(null)).toEqual({});
  });

});
