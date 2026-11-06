import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import { cip68Label } from '@/shared/utils/resolver';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';
import {
  CIP68_USER_TOKEN_LABEL,
  NFT_UNIT_PATTERN,
  isHardwareWalletType,
  POLICY_ID_HEX_LENGTH,
  type NftMarketDeployment,
} from '@/utils/nftMarketDeployments';
import { canUseNftMarketWallet } from '@/utils/nftMarketGate';

/**
 * Whether Gero's NFT market is offered to the logged wallet for NEW business: List, Edit price and
 * Buy. The `isNftMarketEnabled` flag (UI-only, so the feature can ship dark), a network with a
 * reviewed deployment (`NFT_MARKET_ALLOWED_NETWORKS` plus a non-empty list: mainnet's is empty
 * until the audit closes), and a wallet the worker's prepare handlers would not refuse. The last
 * part is `canUseNftMarketWallet`, the one predicate the worker reads too: a password, PassKey or
 * Google Cardano wallet, or a hardware type listed in NFT_MARKET_HARDWARE_WALLET_TYPES (empty).
 * Never a watch wallet.
 *
 * This is the part of the market the flag switches off. What the wallet already has in the market
 * is not: see `nftMarketListingsVisible` and `nftMarketCanUnlist`. The signing
 * refusals and the `listed` partition do not read the flag either: they apply whatever it says.
 */
export function nftMarketAvailable(): boolean {
  const wallet = walletStore.loggedWallet;
  if (!wallet || !featureFlagsStore.isNftMarketEnabled()) return false;
  return canUseNftMarketWallet(wallet.chain, wallet.type) && networks.isNftMarketSupported(wallet.chain, wallet.network);
}

/**
 * Whether the wallet's own listings are shown (marked "Listed", among its NFTs): a network with a
 * reviewed deployment, and NOTHING about the flag or the wallet's type. A listing locks the user's
 * NFT and deposit at the contract, so switching the market off must never make them invisible
 * (hiding locked assets with no way out is worse than a partial kill switch). The
 * wallet's `listedListings` are only ever the ones its own keys own, so a wallet with none has
 * nothing to show.
 */
export function nftMarketListingsVisible(): boolean {
  const wallet = walletStore.loggedWallet;
  if (!wallet) return false;
  return networks.isNftMarketSupported(wallet.chain, wallet.network);
}

/**
 * Whether Unlist is offered: a network with a reviewed deployment and a wallet the worker would
 * not refuse (`canUseNftMarketWallet`), and NOT the flag. A cancel only returns the user's own NFT
 * and deposit to their own address, so it stays reachable with the market switched off. The worker's cancel
 * prepare does not read the flag at all.
 */
export function nftMarketCanUnlist(): boolean {
  const wallet = walletStore.loggedWallet;
  if (!wallet) return false;
  return canUseNftMarketWallet(wallet.chain, wallet.type) && networks.isNftMarketSupported(wallet.chain, wallet.network);
}

/**
 * Whether the collection page may show Gero's open listings to the logged wallet: the flag and a
 * network with a reviewed deployment, and NOTHING about the wallet's type. Reading the market
 * needs no key, so a watch wallet or a hardware wallet no device has signed a market transaction
 * with can browse; whether it may BUY is `nftMarketAvailable()`.
 */
export function nftMarketBrowseAvailable(): boolean {
  const wallet = walletStore.loggedWallet;
  if (!wallet || !featureFlagsStore.isNftMarketEnabled()) return false;
  return networks.isNftMarketSupported(wallet.chain, wallet.network);
}

/** The deployment a NEW listing goes to: the newest version on the logged wallet's network, or null where there is none. */
export function nftMarketNewestDeployment(): NftMarketDeployment | null {
  const wallet = walletStore.loggedWallet;
  if (!wallet) return null;
  const deployments = networks.resolveNftMarketDeployments(wallet.chain, wallet.network);
  return deployments.length === 0 ? null : deployments.reduce((best, d) => (d.version > best.version ? d : best));
}

/** The deployment an existing listing sits at, by version, or null when this build does not configure it. */
export function nftMarketDeploymentFor(version: number): NftMarketDeployment | null {
  const wallet = walletStore.loggedWallet;
  if (!wallet) return null;
  return networks.resolveNftMarketDeployments(wallet.chain, wallet.network).find((d) => d.version === version) ?? null;
}

/**
 * Whether an asset can be listed at all: one of a kind (quantity 1), and for CIP-68 only its (222)
 * user token, never the (100) reference token or another label. The worker decides for real
 * (`checkListableUnit`, `findNft`); this only keeps the button off what it would refuse.
 */
export function isListableNft(asset: { unit?: string; quantity?: number | string | bigint } | null | undefined): boolean {
  const unit = typeof asset?.unit === 'string' ? asset.unit.toLowerCase() : '';
  if (!NFT_UNIT_PATTERN.test(unit)) return false;
  if (asset?.quantity !== undefined && Number(asset.quantity) !== 1) return false;
  const label = cip68Label(unit.slice(POLICY_ID_HEX_LENGTH));
  return label === null || label === CIP68_USER_TOKEN_LABEL;
}

/**
 * A hardware wallet on a network with a market: the one wallet that can have a listing (made by a
 * dApp) and no Unlist for it. A watch wallet signs nothing, so there is no "elsewhere" to point it to.
 */
function hardwareListingLocked(): boolean {
  const wallet = walletStore.loggedWallet;
  return !!wallet && isHardwareWalletType(wallet.type) && networks.isNftMarketSupported(wallet.chain, wallet.network);
}

export interface NftMarketActions {
  list: boolean;
  reprice: boolean;
  unlist: boolean;
  /**
   * The NFT is listed, and the wallet is a hardware wallet no device has signed a market
   * transaction with, so it has no Unlist here (a dApp can have made the listing: Gero's own List
   * is software-only too). The page says to unlist from the app that listed it, where Unlist would
   * be. Hardware signing stays off; this is copy only.
   */
  unlistElsewhere: boolean;
}

/**
 * Which market actions an NFT's detail offers: List for one that can be listed and is not, Edit
 * price and Unlist for one the wallet has listed (`listing`, from `useMyListings().byUnit`).
 * List and Edit price follow `nftMarketAvailable()` (the flag is theirs); Unlist follows
 * `nftMarketCanUnlist()` and stays with the flag off. A listing a hardware wallet
 * cannot unlist here gets `unlistElsewhere` instead: a locked NFT is never left with no word on
 * the way out.
 */
export function nftMarketActionsFor(
  asset: { unit?: string; quantity?: number | string | bigint } | null | undefined,
  listing: OwnListing | undefined,
): NftMarketActions {
  if (listing) {
    const unlist = nftMarketCanUnlist();
    return { list: false, reprice: nftMarketAvailable(), unlist, unlistElsewhere: !unlist && hardwareListingLocked() };
  }
  return { list: nftMarketAvailable() && isListableNft(asset), reprice: false, unlist: false, unlistElsewhere: false };
}
