import { describe, expect, it } from 'vitest';
import { Blockchain, Network } from '@/models/types';
import { isOnRemovedNetwork, isOnSupportedNetwork, supportedWallets } from './supportedWallet';

// A record left in gero-db by a chain the build has since dropped. The literal
// is the point: no `Blockchain` member names it any more.
const RETIRED = { id: 9, name: 'Old', chain: 'Apex Fusion Prime', network: 'Mainnet' };
const CARDANO = { id: 1, name: 'Main', chain: Blockchain.CARDANO, network: Network.MAINNET };
const BITCOIN = { id: 2, name: 'BTC', chain: Blockchain.BITCOIN, network: Network.TESTNET };
const MIDNIGHT = { id: 3, name: 'Night', chain: Blockchain.MIDNIGHT, network: Network.PREPROD };

describe('isOnSupportedNetwork', () => {
  it('accepts every chain the build has', () => {
    for (const wallet of [CARDANO, BITCOIN, MIDNIGHT]) expect(isOnSupportedNetwork(wallet), wallet.chain).toBe(true);
  });

  it('refuses a record of a chain the build no longer has', () => {
    expect(isOnSupportedNetwork(RETIRED)).toBe(false);
    expect(isOnSupportedNetwork({ chain: 'Apex Fusion Vector', network: 'Mainnet' })).toBe(false);
  });

  it('refuses a known chain on a network it does not have, and a record naming none', () => {
    expect(isOnSupportedNetwork({ chain: Blockchain.MIDNIGHT, network: Network.PREVIEW })).toBe(false);
    expect(isOnSupportedNetwork({ chain: Blockchain.CARDANO })).toBe(false);
    expect(isOnSupportedNetwork({})).toBe(false);
    expect(isOnSupportedNetwork(null)).toBe(false);
    expect(isOnSupportedNetwork(undefined)).toBe(false);
  });
});

describe('isOnRemovedNetwork', () => {
  it('is true only for a record that names a chain and network the build lacks', () => {
    expect(isOnRemovedNetwork(RETIRED)).toBe(true);
    for (const wallet of [CARDANO, BITCOIN, MIDNIGHT]) expect(isOnRemovedNetwork(wallet), wallet.chain).toBe(false);
  });

  it('does not judge a record missing its chain or network', () => {
    // A login request carrying only an id says nothing about the network: the
    // stored record is what the worker judges.
    expect(isOnRemovedNetwork({})).toBe(false);
    expect(isOnRemovedNetwork({ chain: 'Apex Fusion Prime' })).toBe(false);
    expect(isOnRemovedNetwork({ network: 'Mainnet' })).toBe(false);
    expect(isOnRemovedNetwork(null)).toBe(false);
    expect(isOnRemovedNetwork(undefined)).toBe(false);
  });
});

describe('supportedWallets', () => {
  it('drops the records the build cannot open, from a list or an id-keyed map', () => {
    expect(supportedWallets([CARDANO, RETIRED, BITCOIN])).toEqual([CARDANO, BITCOIN]);
    expect(supportedWallets({ 1: CARDANO, 9: RETIRED, 3: MIDNIGHT })).toEqual([CARDANO, MIDNIGHT]);
  });

  it('answers an empty list for no wallets at all', () => {
    expect(supportedWallets(null)).toEqual([]);
    expect(supportedWallets(undefined)).toEqual([]);
    expect(supportedWallets({})).toEqual([]);
  });
});
