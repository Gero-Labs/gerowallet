// Where the market's actions (List, Edit price, Unlist) are offered. One rule for every surface:
// the isNftMarketEnabled flag, a network with a reviewed deployment, and a wallet the worker's
// prepare handlers would not refuse (canUseNftMarketWallet), so a button never leads to a refusal
// the pages could have seen coming. A watch wallet never gets it.
//
// The flag is a partial kill switch: it hides List, Edit price and Buy, but the
// wallet's existing listings stay visible and Unlist stays reachable, because a listing locks the
// user's NFT and deposit and a cancel only returns them to the user's own address.
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
  nftMarketBrowseAvailable,
  nftMarketBrowsePolicy,
  nftMarketCanUnlist,
  nftMarketDeploymentFor,
  nftMarketListingsVisible,
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

describe('nftMarketBrowseAvailable', () => {
  it('is on for any wallet on a network with a deployment, with the flag on: reading the market needs no key', () => {
    for (const type of [WalletType.Normal, WalletType.Google, WalletType.Watch, WalletType.Ledger, WalletType.Trezor, WalletType.Keystone]) {
      walletStore.loggedWallet = wallet({ type });
      expect(nftMarketBrowseAvailable(), type).toBe(true);
    }
  });

  it('is off while the flag is off, with no wallet, and on a network with no reviewed deployment', () => {
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    expect(nftMarketBrowseAvailable()).toBe(false);
    featureFlagsStore.state.flags.isNftMarketEnabled = true;
    walletStore.loggedWallet = null;
    expect(nftMarketBrowseAvailable()).toBe(false);
    for (const network of [Network.MAINNET, Network.PREVIEW]) {
      walletStore.loggedWallet = wallet({ network });
      expect(nftMarketBrowseAvailable(), network).toBe(false);
    }
  });

  it('is off for any chain but Cardano', () => {
    for (const chain of [Blockchain.BITCOIN, Blockchain.MIDNIGHT, Blockchain.APEX_PRIME]) {
      walletStore.loggedWallet = wallet({ chain });
      expect(nftMarketBrowseAvailable(), chain).toBe(false);
    }
  });

  it('is wider than buying: a watch wallet browses but is not offered Buy', () => {
    walletStore.loggedWallet = wallet({ type: WalletType.Watch });
    expect(nftMarketBrowseAvailable()).toBe(true);
    expect(nftMarketAvailable()).toBe(false);
  });
});

describe('nftMarketBrowsePolicy', () => {
  it('reads the collection from a pasted policy ID', () => {
    expect(nftMarketBrowsePolicy(POLICY)).toBe(POLICY);
  });

  it('reads the collection from a pasted NFT unit: the policy ID is its first 56 characters', () => {
    expect(nftMarketBrowsePolicy(UNIT)).toBe(POLICY);
    expect(nftMarketBrowsePolicy(CIP68_222)).toBe(POLICY);
  });

  it('takes a paste as it comes: surrounding spaces and upper case', () => {
    expect(nftMarketBrowsePolicy(`  ${UNIT.toUpperCase()}\n`)).toBe(POLICY);
  });

  it('reads nothing from text that is not a policy ID or an NFT unit', () => {
    for (const text of ['', 'cool cats', POLICY.slice(0, 55), `${POLICY}4`, `${POLICY}${'41'.repeat(33)}`, `${POLICY.slice(0, 54)}zz`, `${POLICY} 4e4654`]) {
      expect(nftMarketBrowsePolicy(text), text).toBeNull();
    }
  });

  it('reads nothing where the market cannot be browsed: flag off, or a network with no reviewed deployment', () => {
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    expect(nftMarketBrowsePolicy(POLICY)).toBeNull();
    featureFlagsStore.state.flags.isNftMarketEnabled = true;
    walletStore.loggedWallet = wallet({ network: Network.MAINNET });
    expect(nftMarketBrowsePolicy(POLICY)).toBeNull();
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
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, undefined)).toEqual({ list: true, reprice: false, unlist: false, unlistElsewhere: false });
  });

  it('offers Edit price and Unlist, not List, for an NFT that is listed', () => {
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, LISTING)).toEqual({ list: false, reprice: true, unlist: true, unlistElsewhere: false });
  });

  it('offers nothing for something that cannot be listed and is not already', () => {
    expect(nftMarketActionsFor({ unit: CIP68_100, quantity: 1 }, undefined)).toEqual({ list: false, reprice: false, unlist: false, unlistElsewhere: false });
  });

  it('offers nothing for an NFT that is not listed while the market is off', () => {
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, undefined)).toEqual({ list: false, reprice: false, unlist: false, unlistElsewhere: false });
  });

  it('with the market off, a listed NFT keeps Unlist and loses Edit price', () => {
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, LISTING)).toEqual({ list: false, reprice: false, unlist: true, unlistElsewhere: false });
  });

  it('offers a watch wallet nothing, a listing or not: the worker would refuse it', () => {
    walletStore.loggedWallet = wallet({ type: WalletType.Watch });
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, LISTING)).toEqual({ list: false, reprice: false, unlist: false, unlistElsewhere: false });
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, undefined)).toEqual({ list: false, reprice: false, unlist: false, unlistElsewhere: false });
  });

  it('offers nothing on a network with no reviewed deployment, flag on or off', () => {
    walletStore.loggedWallet = wallet({ network: Network.MAINNET });
    for (const flag of [true, false]) {
      featureFlagsStore.state.flags.isNftMarketEnabled = flag;
      expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, LISTING), String(flag)).toEqual({ list: false, reprice: false, unlist: false, unlistElsewhere: false });
    }
  });
});

// A hardware wallet no device has signed a market transaction with cannot unlist (the worker's cancel
// is software-only until then), yet a dApp can have listed its NFT: the user is told where to go.
describe('nftMarketActionsFor: a listing a hardware wallet cannot unlist here', () => {
  const NONE = { list: false, reprice: false, unlist: false };

  it.each([WalletType.Ledger, WalletType.Trezor, WalletType.Keystone])('%s: no Unlist, and a note to use the app that listed it', (type) => {
    walletStore.loggedWallet = wallet({ type });
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, LISTING)).toEqual({ ...NONE, unlistElsewhere: true });
  });

  it('the market flag has no say: the listing is locked whether the market is on or off', () => {
    walletStore.loggedWallet = wallet({ type: WalletType.Ledger });
    for (const flag of [true, false]) {
      featureFlagsStore.state.flags.isNftMarketEnabled = flag;
      expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, LISTING), String(flag)).toEqual({ ...NONE, unlistElsewhere: true });
    }
  });

  it('is gone once the worker lists the device: Unlist is offered instead', () => {
    vi.mocked(isNftMarketHardware).mockImplementation((type) => type === WalletType.Ledger);
    walletStore.loggedWallet = wallet({ type: WalletType.Ledger });
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, LISTING)).toEqual({ list: false, reprice: true, unlist: true, unlistElsewhere: false });
    // Another device that is not listed still gets the note.
    walletStore.loggedWallet = wallet({ type: WalletType.Trezor });
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, LISTING).unlistElsewhere).toBe(true);
  });

  it('is only for a listing: an NFT that is not listed has nothing to unlist', () => {
    walletStore.loggedWallet = wallet({ type: WalletType.Ledger });
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, undefined)).toEqual({ ...NONE, unlistElsewhere: false });
  });

  it('is not said to a software wallet (it unlists here), a watch wallet (it signs nothing), or off a network with a market', () => {
    for (const type of [WalletType.Normal, WalletType.Google, WalletType.Watch]) {
      walletStore.loggedWallet = wallet({ type });
      expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, LISTING).unlistElsewhere, type).toBe(false);
    }
    walletStore.loggedWallet = wallet({ type: WalletType.Ledger, network: Network.MAINNET });
    expect(nftMarketActionsFor({ unit: UNIT, quantity: 1 }, LISTING)).toEqual({ ...NONE, unlistElsewhere: false });
  });
});

describe('the wallet\'s own listings with the market switched off', () => {
  it('stay visible: only a network with a market matters, not the flag or the wallet type', () => {
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    expect(nftMarketListingsVisible()).toBe(true);
    walletStore.loggedWallet = wallet({ type: WalletType.Ledger });
    expect(nftMarketListingsVisible()).toBe(true);
  });

  it('are not shown where the network has no market, or with no wallet', () => {
    walletStore.loggedWallet = wallet({ network: Network.MAINNET });
    expect(nftMarketListingsVisible()).toBe(false);
    walletStore.loggedWallet = null;
    expect(nftMarketListingsVisible()).toBe(false);
  });

  it('can be unlisted by any wallet the worker would let sign, flag on or off', () => {
    for (const flag of [true, false]) {
      featureFlagsStore.state.flags.isNftMarketEnabled = flag;
      expect(nftMarketCanUnlist(), String(flag)).toBe(true);
    }
  });

  it('cannot be unlisted by a wallet the worker would refuse, or where the network has no market', () => {
    for (const type of [WalletType.Watch, WalletType.Ledger, WalletType.Trezor, WalletType.Keystone]) {
      walletStore.loggedWallet = wallet({ type });
      expect(nftMarketCanUnlist(), type).toBe(false);
    }
    walletStore.loggedWallet = wallet({ network: Network.MAINNET });
    expect(nftMarketCanUnlist()).toBe(false);
    walletStore.loggedWallet = wallet({ chain: Blockchain.BITCOIN });
    expect(nftMarketCanUnlist()).toBe(false);
    walletStore.loggedWallet = null;
    expect(nftMarketCanUnlist()).toBe(false);
  });

  it('can be unlisted by a hardware wallet type once the worker lists it', () => {
    vi.mocked(isNftMarketHardware).mockImplementation((type) => type === WalletType.Ledger);
    walletStore.loggedWallet = wallet({ type: WalletType.Ledger });
    expect(nftMarketCanUnlist()).toBe(true);
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
