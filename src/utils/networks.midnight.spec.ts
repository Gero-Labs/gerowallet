import { describe, expect, it } from 'vitest';
import networks from '@/utils/networks';
import { Blockchain, Network } from '@/models/types';
import { getMidnightEndpoints } from '@/chains/midnight/midnightConfig';
import { midnightSdkNetworkId } from '@/chains/midnight/midnightSdkNetwork';

const midnight = () => networks.networks.filter((n) => n.blockchain === Blockchain.MIDNIGHT);

describe('the Midnight networks a wallet can be made on (issue 1453)', () => {
  it('are Preview, Preprod and Mainnet: Stagenet is no longer offered', () => {
    expect(midnight().map((n) => [n.network, n.title])).toEqual([
      [Network.PREVIEW, 'Midnight Preview'],
      [Network.PREPROD, 'Midnight Preprod'],
      [Network.MAINNET, 'Midnight Mainnet'],
    ]);
    expect(networks.resolveNetwork(Blockchain.MIDNIGHT, 'Stagenet')).toBeUndefined();
    expect(JSON.stringify(midnight())).not.toMatch(/stagenet/i);
  });

  it('Midnight Preview is a testnet with tNIGHT that sends, and no hardware wallet', () => {
    expect(networks.resolveNetwork(Blockchain.MIDNIGHT, Network.PREVIEW)).toMatchObject({
      networkId: 0, currencySymbol: 'tNIGHT', currencyTicker: 'tNIGHT', supportedHardware: false, transactionSupport: true,
    });
  });

  it('is a different entry from Cardano Preview, which is unchanged', () => {
    const cardano = networks.resolveNetwork(Blockchain.CARDANO, Network.PREVIEW);
    expect(cardano.title).toBe('Cardano Preview');
    expect(networks.resolveNetwork(Blockchain.MIDNIGHT, Network.PREVIEW)).not.toBe(cardano);
  });

  it('each has endpoints and an SDK network id, so no Midnight wallet is left without a chain', () => {
    for (const entry of midnight()) {
      const endpoints = getMidnightEndpoints(entry.network)!;
      expect(endpoints.network).toBe(entry.network);
      expect(midnightSdkNetworkId(entry.network)).toBe(endpoints.sdkNetworkId);
    }
  });
});
