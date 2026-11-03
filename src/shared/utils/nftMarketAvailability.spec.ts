// Where the market's actions (List, Edit price, Unlist) are offered. One rule for every surface:
// the isNftMarketEnabled flag, a network with a reviewed deployment, and a wallet the worker's
// prepare handlers would not refuse (canUseNftMarketWallet), so a button never leads to a refusal
// the pages could have seen coming. A watch wallet never gets it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blockchain, Network, WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { isNftMarketHardware, NFT_MARKET_DEPLOYMENTS_PREPROD } from '@/utils/nftMarketDeployments';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import {
  isListableNft,
  nftMarketActionsFor,
  nftMarketAvailable,
  nftMarketDeploymentFor,
  nftMarketNewestDeployment,
} from './nftMarketAvailability';

// The hardware list ships empty; a test opens it by handing the real check another list.
vi.mock('@/utils/nftMarketDeployments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/nftMarketDeployments')>();
  return { ...actual, isNftMarketHardware: vi.fn(actual.isNftMarketHardware) };
});

const POLICY = 'ab'.repeat(28);
const UNIT = `${POLICY}4e4654`;
// CIP-67 prefixes: (100) reference token, (222) user token, (333) fungible token.
const CIP68_100 = `${POLICY}000643b0${'41'.repeat(4)}`;
const CIP68_222 = `${POLICY}000de140${'41'.repeat(4)}`;
const CIP68_333 = `${POLICY}0014df10${'41'.repeat(4)}`;

const wallet = (fields: Record<string, unknown> = {}) =>
  ({ id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal, ...fields }) as never;

const LISTING: OwnListing = {
  ref: `${'11'.repeat(32)}#0`,
  unit: UNIT,
  datum: { owner: 'aa'.repeat(28), sellerAddress: 'addr_test1seller', price: 120_000_000n, royalties: [], buyer: null },
  depositLovelace: '1500000',
  deploymentVersion: 1,
};

beforeEach(() => {
  walletStore.loggedWallet = wallet();
  featureFlagsStore.state.flags.isNftMarketEnabled = true;
});

afterEach(() => {
  featureFlagsStore.state.flags.isNftMarketEnabled = false;
  walletStore.loggedWallet = null;
  vi.mocked(isNftMarketHardware).mockReset();
  vi.mocked(isNftMarketHardware).mockImplementation((type, allowed = []) => typeof type === 'string' && allowed.includes(type));
});

describe('nftMarketAvailable', () => {
  it('is on for a software wallet on a network with a deployment, with the flag on', () => {
    expect(nftMarketAvailable()).toBe(true);
    walletStore.loggedWallet = wallet({ type: WalletType.Google });
    expect(nftMarketAvailable()).toBe(true);
  });

  it('is off while the flag is off, however everything else stands', () => {
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    expect(nftMarketAvailable()).toBe(false);
  });

  it('is off with no wallet logged in', () => {
    walletStore.loggedWallet = null;
    expect(nftMarketAvailable()).toBe(false);
  });

  it('is off on a network with no reviewed deployment: mainnet ships empty', () => {
    walletStore.loggedWallet = wallet({ network: Network.MAINNET });
    expect(nftMarketAvailable()).toBe(false);
    walletStore.loggedWallet = wallet({ network: Network.PREVIEW });
    expect(nftMarketAvailable()).toBe(false);
  });

  it('is off for a watch wallet', () => {
    walletStore.loggedWallet = wallet({ type: WalletType.Watch });
    expect(nftMarketAvailable()).toBe(false);
  });

  it('is off for any chain but Cardano', () => {
    for (const chain of [Blockchain.BITCOIN, Blockchain.MIDNIGHT, Blockchain.APEX_PRIME]) {
      walletStore.loggedWallet = wallet({ chain });
      expect(nftMarketAvailable(), chain).toBe(false);
    }
  });

  it('is off for every hardware wallet while NFT_MARKET_HARDWARE_WALLET_TYPES is empty', () => {
    for (const type of [WalletType.Ledger, WalletType.Trezor, WalletType.Keystone]) {
      walletStore.loggedWallet = wallet({ type });
      expect(nftMarketAvailable(), type).toBe(false);
    }
  });

  it('is on for a hardware wallet type once the worker lists it, and for no other', () => {
    vi.mocked(isNftMarketHardware).mockImplementation((type) => type === WalletType.Ledger);
    walletStore.loggedWallet = wallet({ type: WalletType.Ledger });
    expect(nftMarketAvailable()).toBe(true);
    walletStore.loggedWallet = wallet({ type: WalletType.Trezor });
    expect(nftMarketAvailable()).toBe(false);
  });
});

describe('isListableNft', () => {
  it('accepts a plain single NFT and the (222) user token of a CIP-68 NFT', () => {
    expect(isListableNft({ unit: UNIT, quantity: 1 })).toBe(true);
    expect(isListableNft({ unit: UNIT, quantity: '1' })).toBe(true);
    expect(isListableNft({ unit: UNIT })).toBe(true);
    expect(isListableNft({ unit: CIP68_222, quantity: 1 })).toBe(true);
  });

  it('refuses the (100) reference token and the other CIP-68 labels: the worker would', () => {
    expect(isListableNft({ unit: CIP68_100, quantity: 1 })).toBe(false);
    expect(isListableNft({ unit: CIP68_333, quantity: 1 })).toBe(false);
  });

  it('refuses anything held in a quantity other than one, and a unit that is not a policy and name', () => {
    expect(isListableNft({ unit: UNIT, quantity: 2 })).toBe(false);
    expect(isListableNft({ unit: UNIT, quantity: 0 })).toBe(false);
    for (const unit of ['lovelace', '', 'zz', POLICY.slice(2), undefined]) expect(isListableNft({ unit }), String(unit)).toBe(false);
  });
});

describe('nftMarketActionsFor', () => {
  it('offers List for an NFT that is not listed', () => {
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, undefined)).toEqual({ list: true, reprice: false, unlist: false });
  });

  it('offers Edit price and Unlist, not List, for an NFT that is listed', () => {
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, LISTING)).toEqual({ list: false, reprice: true, unlist: true });
  });

  it('offers nothing for something that cannot be listed and is not already', () => {
    expect(nftMarketActionsFor({ unit: CIP68_100, quantity: 1 }, undefined)).toEqual({ list: false, reprice: false, unlist: false });
  });

  it('offers nothing at all where the market is not available, a listing or not', () => {
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    const none = { list: false, reprice: false, unlist: false };
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, undefined)).toEqual(none);
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, LISTING)).toEqual(none);
    featureFlagsStore.state.flags.isNftMarketEnabled = true;
    walletStore.loggedWallet = wallet({ type: WalletType.Watch });
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, LISTING)).toEqual(none);
  });
});

describe('the deployments the sheets price against', () => {
  it('takes the newest deployment of the logged wallet\'s network for a new listing', () => {
    expect(nftMarketNewestDeployment()).toEqual(NFT_MARKET_DEPLOYMENTS_PREPROD[0]);
  });

  it('finds the deployment an existing listing sits at by its version', () => {
    expect(nftMarketDeploymentFor(1)).toEqual(NFT_MARKET_DEPLOYMENTS_PREPROD[0]);
    expect(nftMarketDeploymentFor(7)).toBeNull();
  });

  it('has none where the market is not supported', () => {
    walletStore.loggedWallet = wallet({ network: Network.MAINNET });
    expect(nftMarketNewestDeployment()).toBeNull();
    expect(nftMarketDeploymentFor(1)).toBeNull();
    walletStore.loggedWallet = null;
    expect(nftMarketNewestDeployment()).toBeNull();
  });
});
