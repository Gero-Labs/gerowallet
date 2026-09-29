// Static on purpose: both contexts already load the SDK, so a dynamic import buys no code
// splitting, and in the worker's single-chunk bundle it made rollup read the SDK namespaces
// before declaring them, which the bundle TDZ guard rejects (scripts/check-bundle-tdz.mjs).
import { Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';

/**
 * Merge a second witness set into the user's: the signatures of both, everything else
 * (bootstrap, scripts, redeemers, datums) from the user's. Used when Nexus co-signs a
 * collateral input it lent from its pool (the worker's SIGN_TX loop and the swap widget's
 * hardware-wallet paths).
 */
export async function mergeWitnessSets(userWitnessCbor: string, extraWitnessCbor: string): Promise<string> {
  const userCore = Serialization.TransactionWitnessSet.fromCbor(HexBlob(userWitnessCbor)).toCore();
  const extraCore = Serialization.TransactionWitnessSet.fromCbor(HexBlob(extraWitnessCbor)).toCore();

  const merged = {
    signatures: new Map([
      ...(userCore.signatures?.entries() || []),
      ...(extraCore.signatures?.entries() || []),
    ]),
    ...(userCore.bootstrap && { bootstrap: userCore.bootstrap }),
    ...(userCore.scripts && { scripts: userCore.scripts }),
    ...(userCore.redeemers && { redeemers: userCore.redeemers }),
    ...(userCore.datums && { datums: userCore.datums }),
  };

  return Serialization.TransactionWitnessSet.fromCore(merged).toCbor();
}
