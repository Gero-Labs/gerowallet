import { describe, expect, it } from 'vitest';
import { Network } from '@/models/types';
import {
  MIDNIGHT_PREVIEW_FAUCET_URL,
  cardanoTwinNetwork,
  getMidnightEndpoints,
  nexusMidnightPathFor,
} from './midnightConfig';
import { CNIGHT_ASSETS, cnightUnit } from '@/shared/utils/cnightAssets';
import { DUST_MAPPING_VALIDATOR } from '@/shared/utils/dustMappingValidator';

describe('Midnight indexer endpoints', () => {
  it.each([
    [Network.MAINNET, 'mainnet'],
    [Network.PREPROD, 'preprod'],
    [Network.PREVIEW, 'preview'],
  ])('routes %s wallet sync through the gero-sync relay', (network, slug) => {
    const endpoints = getMidnightEndpoints(network);
    expect(endpoints?.publicIndexerUrl).toBe(`https://sync.gerowallet.io/midnight/${slug}/graphql`);
    expect(endpoints?.publicIndexerWsUrl).toBe(`wss://sync.gerowallet.io/midnight/${slug}/graphql/ws`);
    expect(endpoints?.publicRpcUrl).toBeUndefined();
    expect(endpoints?.geroSyncWsUrl).toBe('wss://sync.gerowallet.io/ws/sync');
  });

  it('points no link at a retired Foundation host', () => {
    // rpc.<env>.midnight.network is on Midnight's retired list and the
    // preprod explorer link used to ride on it through polkadot.js.
    for (const network of [Network.MAINNET, Network.PREPROD, Network.PREVIEW]) {
      expect(JSON.stringify(getMidnightEndpoints(network))).not.toMatch(/midnight\.network/);
    }
  });

  it('ships no Blockfrost or Foundation Midnight endpoint on any network', () => {
    for (const network of [Network.MAINNET, Network.PREPROD, Network.PREVIEW]) {
      expect(JSON.stringify(getMidnightEndpoints(network))).not.toMatch(/blockfrost|project_id|midnight\.network\/api/);
    }
  });
});

describe('Midnight Preview (issue 1453)', () => {
  it('is reached through Nexus under midnight-preview, with the SDK network id preview', () => {
    const preview = getMidnightEndpoints(Network.PREVIEW)!;
    expect(preview.network).toBe(Network.PREVIEW);
    expect(preview.sdkNetworkId).toBe('preview');
    expect(preview.nexusBaseUrl).toBe(getMidnightEndpoints(Network.PREPROD)!.nexusBaseUrl);
    expect(nexusMidnightPathFor(Network.PREVIEW, 'dust/status'))
      .toBe(`${preview.nexusBaseUrl}/api/midnight/midnight-preview/dust/status`);
    expect(nexusMidnightPathFor(Network.PREVIEW, '/status'))
      .toBe(`${preview.nexusBaseUrl}/api/midnight/midnight-preview/status`);
  });

  it('proves on the testnet zkPaaS, from the ledger 9 local server, and lists the Preview faucet and explorer', () => {
    const preview = getMidnightEndpoints(Network.PREVIEW)!;
    expect(preview.zkpaasProofServerUrl).toBe('https://starter.arkhia.io/midnight/zkpaas/testnet');
    expect(preview.zkpaasProofServerUrl).toBe(getMidnightEndpoints(Network.PREPROD)!.zkpaasProofServerUrl);
    expect(preview.faucetUrl).toBe(MIDNIGHT_PREVIEW_FAUCET_URL);
    expect(preview.blockExplorerUrl).toBe('https://preview.midnightexplorer.com');
    expect(preview.defaultProofServerUrl).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it('has no Stagenet entry any more, and talks to no Stagenet host', () => {
    expect(getMidnightEndpoints('Stagenet')).toBeUndefined();
    expect(() => nexusMidnightPathFor('Stagenet', 'status')).toThrow('Unknown Midnight network: Stagenet');
    for (const network of [Network.MAINNET, Network.PREPROD, Network.PREVIEW]) {
      expect(JSON.stringify(getMidnightEndpoints(network))).not.toMatch(/stagenet|shielded\.tools/i);
    }
  });
});

describe('the Cardano twin of a Midnight network (cNIGHT and DUST registration)', () => {
  it.each([
    [Network.MAINNET, Network.MAINNET],
    [Network.PREPROD, Network.PREPROD],
    [Network.PREVIEW, Network.PREVIEW],
  ])('Midnight %s pairs with Cardano %s', (midnight, cardano) => {
    expect(cardanoTwinNetwork(midnight)).toBe(cardano);
  });

  it('Preview has the cNIGHT policy and the DUST mapping validator of Cardano preview', () => {
    const twin = cardanoTwinNetwork(Network.PREVIEW);
    expect(CNIGHT_ASSETS[twin]).toEqual({ policyId: 'd2dbff622e509dda256fedbd31ef6e9fd98ed49ad91d5c0e07f68af1', assetNameHex: '' });
    expect(DUST_MAPPING_VALIDATOR[twin]).toEqual({
      scriptHash: '7e69087d98fac5869eac14e13dfb6f98228c41e638aa2a59d1f85e9c',
      address: 'addr_test1wplxjzranravtp574s2wz00md7vz9rzpucu252je68u9a8qzjheng',
    });
  });

  it('fails closed for a network with no Cardano twin: no cNIGHT, no validator', () => {
    for (const network of ['Stagenet', 'Undeployed', '']) {
      expect(cnightUnit(cardanoTwinNetwork(network))).toBe('');
      expect(DUST_MAPPING_VALIDATOR[cardanoTwinNetwork(network)]).toBeUndefined();
    }
  });
});
