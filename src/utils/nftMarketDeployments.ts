import { Network } from '@/models/types';

// Gero's NFT market: the reviewed listing-contract deployments, the limits every market
// transaction is held to, and the build-time network gate.
//
// A deployment is a trust anchor. `scriptHash` decides which UTxOs the wallet treats as Gero
// listings (and so as the user's own, offered for cancel, kept out of the spendable balance);
// `referenceScript` and `feeAddress` decide what a built buy or cancel may spend and pay. The
// contract does not check its own parameters (docs/rules.md): a bad parameter set is a bad
// script hash, and a bad script hash is never put into the wallet. Treat a PR touching this
// file like a change to the scam blacklist, at the same bar as cip113Deployments.ts.
//
// One array per network. An EMPTY array means the market is unsupported on that network and
// everything fails closed. A superseded deployment stays listed until its listings drain, and
// new listings use the newest: `networks.resolveNftMarketDeployments()` returns the newest
// version first.
//
// Format: `scriptHash` is blake2b-224 (56 lowercase hex characters, no 0x prefix),
// `referenceScript` is `<tx hash, 64 lowercase hex>#<output index>`, `feeAddress` is a bech32
// base address of the deployment's own network. `networks.ts` re-validates the shape of every
// entry at module scope, plus the contract's parameter review rules (`0 < feeBps <= 1000`,
// `minFeeLovelace >= 0`, `maxFeeLovelace` null or at least the minimum), and drops an entry
// that fails any of them.
//
// KEEP THE PROVENANCE IN STEP WITH THE VALUE. A hash swapped without updating its out-ref,
// parameters and source commit leaves this file asserting provenance for a deployment it no
// longer lists, and the provenance is the only check there is.

/** One deployment of the listing contract: the script applied to its fee parameters. */
export interface NftMarketDeployment {
  /** Deployment number, 1 for the first. The newest version takes new listings. */
  version: number;
  /** blake2b-224 of the applied Plutus V3 script (56 lowercase hex). */
  scriptHash: string;
  /** Out-ref of the UTxO holding the reference script, `<tx hash>#<index>`. */
  referenceScript: string;
  /** The fee address the contract pays fees to, compared as a full address on chain. */
  feeAddress: string;
  /** Fee in basis points of the price. */
  feeBps: number;
  /** Fee floor in lovelace. */
  minFeeLovelace: bigint;
  /** Fee cap in lovelace, or null for none. */
  maxFeeLovelace: bigint | null;
  /** Commit of Gero-Labs/gero-market-contracts the script was built from. */
  sourceCommit: string;
}

/**
 * Mainnet: EMPTY. Stays empty until the audit closes and the mainnet deployment has been
 * reviewed (spec 9). Putting a deployment here is not enough on its own to bring the market up:
 * NFT_MARKET_ALLOWED_NETWORKS and the `isNftMarketEnabled` flag are separate gates.
 */
export const NFT_MARKET_DEPLOYMENTS_MAINNET: readonly NftMarketDeployment[] = [];

/**
 * Preprod v1 (parameters 100 bps, 1.5 ADA minimum, 5 ADA cap, Plutus V3).
 *
 * Verified from `deployments/preprod-v1/deployment.json` in Gero-Labs/gero-market-contracts
 * (main `26fff54`), which records:
 *  - reference script on chain at `3a67a8ea84fba06cd3ab80e0d03cc12406a2e3b60ae0dba59475a852f7ca4eea#0`:
 *    the bytes read back through Koios `utxo_info` (extended) equal the build's `script.json`
 *    (1978 bytes), and blake2b-224 over `0x03` and those bytes is the script hash above;
 *  - the on-chain script is the unapplied `listing.listing.spend` validator of `plutus.json`
 *    applied to exactly the fee address, 100, 1500000 and `Some 5000000`;
 *  - the applied hash was checked by two independent tools, Aiken `apply-params` and Lucid
 *    Evolution `verify-params`, which give the same hash;
 *  - compiled with Aiken `v1.1.24`, stdlib `v4.0.0`, from source commit `2b36ccf3d1f82bd93422ddc939b9f788b3c7de86`.
 *
 * The fee address is a base address with a script payment part (a 2-of-3 native script, valid
 * after slot 1) and a key stake part, per docs/rules.md.
 */
export const NFT_MARKET_DEPLOYMENTS_PREPROD: readonly NftMarketDeployment[] = [
  {
    version: 1,
    scriptHash: '558802cc2e2f21e4e13662cdf73f979ce0140e7dbd7ce13911a9063d',
    referenceScript: '3a67a8ea84fba06cd3ab80e0d03cc12406a2e3b60ae0dba59475a852f7ca4eea#0',
    feeAddress: 'addr_test1zqr6j3esncsqm3r79m050wysn2xz634pqtpln8xsnnngup00zdhpv57vpc7kafrx54kk2lwr45mug3qfsewgp5cdqwusxeyzuc',
    feeBps: 100,
    minFeeLovelace: 1_500_000n,
    maxFeeLovelace: 5_000_000n,
    sourceCommit: '2b36ccf3d1f82bd93422ddc939b9f788b3c7de86',
  },
];

/**
 * Networks where the market may run at all. Together with the deployment lists above this is
 * the whole build-time gate: both must pass, and the `isNftMarketEnabled` flag is a third,
 * UI-only gate on top.
 *
 * Why this exists rather than relying on an empty list: otherwise recording a deployment would
 * by itself bring that network live on the next build. Keeping the allowlist separate means
 * enabling a network is always a deliberate change here, reviewed together with its list.
 *
 * Mainnet and preprod are allowlisted in every build (the wallet has no build-mode gate).
 * Mainnet stays dark through its EMPTY deployment list and the flag; preprod carries v1, so a
 * production user on preprod can use the preprod market (test ADA only).
 */
export const NFT_MARKET_ALLOWED_NETWORKS: readonly string[] = [Network.MAINNET, Network.PREPROD];

// Wallet limits. Every market transaction is checked against these before it is signed (the
// worker verifies what Nexus built; it never trusts the builder's numbers).

/** Lowest list price the wallet offers, in lovelace (5 ADA). */
export const MIN_LIST_PRICE = 5_000_000n;

/**
 * Highest list price the wallet accepts, in lovelace: the whole ADA supply (45 billion ADA). Above
 * it a price is a typo, and the worker refuses it before anything is built.
 */
export const MAX_LIST_PRICE = 45_000_000_000_000_000n;

/** Policy id length in hex characters (28 bytes). */
export const POLICY_ID_HEX_LENGTH = 56;

/** An NFT unit as the market takes it: the policy id (28 bytes) then an asset name of up to 32 bytes, lower-case hex. */
export const NFT_UNIT_PATTERN = /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/;

/** CIP-68 user token: the only CIP-68 label an NFT is listed, bought or moved under. */
export const CIP68_USER_TOKEN_LABEL = 222;

/** Least the seller must receive after fee and royalties, in lovelace (1.5 ADA). */
export const MIN_SELLER_SHARE = 1_500_000n;

/** Most royalty payees a listing may carry. */
export const MAX_ROYALTIES = 3;

/**
 * Royalty rate (a fraction of the price) above which the seller must confirm explicitly:
 * 0.1 is 10%.
 */
export const ROYALTY_RATE_CAP = 0.1;

/** Most deposit (the listing UTxO's own lovelace) a listing may lock, in lovelace (5 ADA). */
export const MAX_LISTING_DEPOSIT = 5_000_000n;

/** Highest network fee the wallet accepts on a market transaction, in lovelace (2 ADA). */
export const NFT_MARKET_MAX_FEE_LOVELACE = 2_000_000n;

/**
 * Most collateral a market transaction may put at risk, in lovelace (5 ADA). A transaction that
 * fails script validation forfeits its collateral, which bounds the loss if a builder lies.
 */
export const NFT_MARKET_MAX_COLLATERAL_LOVELACE = 5_000_000n;

/** Longest validity window a market transaction may carry, in slots (one hour). */
export const NFT_MARKET_MAX_VALIDITY_SLOTS = 3600;

/**
 * Hardware wallets (`WalletType` values: 'Ledger', 'Trezor', 'Keystone') that may sign a
 * market transaction. EMPTY, so software wallets only, until each device has signed a real
 * preprod list, cancel and buy: a passing spec is not a device run. Any other value in it is
 * ignored.
 */
export const NFT_MARKET_HARDWARE_WALLET_TYPES: readonly string[] = [];

const HARDWARE_WALLET_TYPES: readonly string[] = ['Ledger', 'Trezor', 'Keystone'];

/** Whether the market may ask this hardware wallet type to sign. False for every software type. */
export function isNftMarketHardware(
  walletType: string | null | undefined,
  allowed: readonly string[] = NFT_MARKET_HARDWARE_WALLET_TYPES,
): boolean {
  return typeof walletType === 'string' && HARDWARE_WALLET_TYPES.includes(walletType) && allowed.includes(walletType);
}
