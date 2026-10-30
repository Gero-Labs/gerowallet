// The two legacy marketplace contracts whose stuck listings and offers the wallet can cancel
// for their owner (NFT rescue, Cardano mainnet only).
//
// Both are Plutus V2 scripts. A legacy UTxO is spent with the contract's cancel redeemer
// and the owner's signature, using the contract's reference script instead of carrying the
// script in the transaction. The wallet checks every cancel transaction Nexus builds against
// these values, so a wrong hash or reference makes it accept or refuse the wrong
// transaction: treat a change to this file like a change to cip113Deployments.ts and review
// it against the chain.
//
// Datum layouts (the owner is a payment key hash, 28 bytes):
//   legacy_v3: Constr 0 [payouts: List, owner: Bytes28]
//   legacy_v2: Constr 0 [owner: Bytes28, payouts: List]
// A UTxO at either contract may carry its datum inline or as a datum hash.

export type LegacyContract = 'legacy_v3' | 'legacy_v2';

export interface LegacyScript {
  /** The script hash: the payment credential of every UTxO at the contract. */
  scriptHash: string;
  /** `txHash#index` of the UTxO whose reference script holds the contract. */
  referenceScript: string;
  /** CBOR hex of the contract's cancel redeemer data. */
  cancelRedeemerCbor: string;
}

export const LEGACY_SCRIPTS: Record<LegacyContract, LegacyScript> = {
  legacy_v3: {
    scriptHash: 'c727443d77df6cff95dca383994f4c3024d03ff56b02ecc22b0f3f65',
    referenceScript: '1693c508b6132e89b932754d657d28b24068ff5ff1715fec36c010d4d6470b3d#0',
    // Constr 1 []
    cancelRedeemerCbor: 'd87a80',
  },
  legacy_v2: {
    scriptHash: '9068a7a3f008803edac87af1619860f2cdcde40c26987325ace138ad',
    referenceScript: '9a32459bd4ef6bbafdeb8cf3b909d0e3e2ec806e4cc6268529280b0fc1d06f5b#0',
    // Constr 0 []
    cancelRedeemerCbor: 'd87980',
  },
};

/** Most legacy UTxOs one cancel transaction may spend. */
export const LEGACY_CANCEL_MAX = 10;

/** Largest fee, in lovelace, the verifier accepts on a cancel transaction (2 ADA). */
export const LEGACY_CANCEL_MAX_FEE = 2_000_000n;

/** Largest total collateral, in lovelace, the verifier accepts on a cancel transaction (5 ADA). */
export const LEGACY_CANCEL_MAX_COLLATERAL = 5_000_000n;

/**
 * Hardware wallets (`WalletType` values: 'Ledger', 'Trezor', 'Keystone') that may sign a
 * legacy cancel. EMPTY until each device has signed a real rescue on mainnet: a passing spec
 * is not a device run. The worker's prepare and the rescue button both read this list, so
 * empty is exactly the software-only behaviour. Any other value in it is ignored.
 */
export const LEGACY_RESCUE_HARDWARE_WALLET_TYPES: readonly string[] = [];

const HARDWARE_WALLET_TYPES: readonly string[] = ['Ledger', 'Trezor', 'Keystone'];

/** Whether the rescue may ask this hardware wallet type to sign. False for every software type. */
export function isLegacyRescueHardware(
  walletType: string | null | undefined,
  allowed: readonly string[] = LEGACY_RESCUE_HARDWARE_WALLET_TYPES,
): boolean {
  return typeof walletType === 'string' && HARDWARE_WALLET_TYPES.includes(walletType) && allowed.includes(walletType);
}
