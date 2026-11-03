import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import { cip68Label } from '@/shared/utils/resolver';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';
import type { NftMarketDeployment } from '@/utils/nftMarketDeployments';
import { canUseNftMarketWallet } from '@/utils/nftMarketGate';

/**
 * Whether Gero's NFT market is offered to the logged wallet: the `isNftMarketEnabled` flag
 * (UI-only, so the feature can ship dark), a network with a reviewed deployment
 * (`NFT_MARKET_ALLOWED_NETWORKS` plus a non-empty list: mainnet's is empty until the audit
 * closes), and a wallet the worker's prepare handlers would not refuse. The last part is
 * `canUseNftMarketWallet`, the one predicate the worker reads too: a password, PassKey or Google
 * Cardano wallet, or a hardware type listed in NFT_MARKET_HARDWARE_WALLET_TYPES (empty). Never a
 * watch wallet.
 *
 * Every surface that shows List, Edit price, Unlist, the "Listed" badge or the listed NFTs asks
 * this, so they agree with each other and with the worker. The signing refusals and the `listed`
 * partition do not: they apply whatever the flag says.
 */
export function nftMarketAvailable(): boolean {
  const wallet = walletStore.loggedWallet;
  if (!wallet || !featureFlagsStore.isNftMarketEnabled()) return false;
  return canUseNftMarketWallet(wallet.chain, wallet.type) && networks.isNftMarketSupported(wallet.chain, wallet.network);
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

/** policy id (28 bytes) then an asset name of up to 32 bytes, the same shape the worker takes. */
const UNIT = /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/;
const POLICY_HEX_LENGTH = 56;
/** CIP-68 user token: the only CIP-68 label an NFT is listed under. */
const CIP68_USER_TOKEN_LABEL = 222;

/**
 * Whether an asset can be listed at all: one of a kind (quantity 1), and for CIP-68 only its (222)
 * user token, never the (100) reference token or another label. The worker decides for real
 * (`checkListableUnit`, `findNft`); this only keeps the button off what it would refuse.
 */
export function isListableNft(asset: { unit?: string; quantity?: number | string | bigint } | null | undefined): boolean {
  const unit = typeof asset?.unit === 'string' ? asset.unit.toLowerCase() : '';
  if (!UNIT.test(unit)) return false;
  if (asset?.quantity !== undefined && Number(asset.quantity) !== 1) return false;
  const label = cip68Label(unit.slice(POLICY_HEX_LENGTH));
  return label === null || label === CIP68_USER_TOKEN_LABEL;
}

export interface NftMarketActions {
  list: boolean;
  reprice: boolean;
  unlist: boolean;
}

const NO_ACTIONS: NftMarketActions = { list: false, reprice: false, unlist: false };

/**
 * Which market actions an NFT's detail offers: List for one that can be listed and is not,
 * Edit price and Unlist for one the wallet has listed (`listing`, from `useMyListings().byUnit`).
 * Nothing at all where the market is not available.
 */
export function nftMarketActionsFor(
  asset: { unit?: string; quantity?: number | string | bigint } | null | undefined,
  listing: OwnListing | undefined,
): NftMarketActions {
  if (!nftMarketAvailable()) return NO_ACTIONS;
  if (listing) return { list: false, reprice: true, unlist: true };
  return { list: isListableNft(asset), reprice: false, unlist: false };
}
