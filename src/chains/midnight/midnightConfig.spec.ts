import { describe, expect, it } from 'vitest';
import { Network } from '@/models/types';
import { getMidnightEndpoints } from './midnightConfig';

describe('Midnight indexer endpoints', () => {
  it.each([
    [Network.MAINNET, 'mainnet'],
    [Network.PREPROD, 'preprod'],
  ])('routes %s wallet sync through the gero-sync relay', (network, slug) => {
    const endpoints = getMidnightEndpoints(network);
    expect(endpoints?.publicIndexerUrl).toBe(`https://sync.gerowallet.io/midnight/${slug}/graphql`);
    expect(endpoints?.publicIndexerWsUrl).toBe(`wss://sync.gerowallet.io/midnight/${slug}/graphql/ws`);
    expect(endpoints?.publicRpcUrl).toBeUndefined();
    expect(endpoints?.geroSyncWsUrl).toBe('wss://sync.gerowallet.io/ws/sync');
  });

  it('points no mainnet or preprod link at a retired Foundation host', () => {
    // rpc.<env>.midnight.network is on Midnight's retired list and the
    // preprod explorer link used to ride on it through polkadot.js.
    for (const network of [Network.MAINNET, Network.PREPROD]) {
      expect(JSON.stringify(getMidnightEndpoints(network))).not.toMatch(/midnight\.network/);
    }
  });

  it('ships no Blockfrost or Foundation Midnight endpoint for mainnet or preprod', () => {
    for (const network of [Network.MAINNET, Network.PREPROD]) {
      expect(JSON.stringify(getMidnightEndpoints(network))).not.toMatch(/blockfrost|project_id|midnight\.network\/api/);
    }
  });
});
