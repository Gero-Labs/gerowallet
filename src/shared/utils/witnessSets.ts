/**
 * Merge a second witness set into the user's: the signatures of both, everything else
 * (bootstrap, scripts, redeemers, datums) from the user's. Used when Nexus co-signs a
 * collateral input it lent from its pool (the worker's SIGN_TX loop and the swap widget's
 * hardware-wallet paths). Lazy SDK imports keep this cheap to load in either context.
 */
export async function mergeWitnessSets(userWitnessCbor: string, extraWitnessCbor: string): Promise<string> {
  const { Serialization } = await import('@cardano-sdk/core');
  const { HexBlob } = await import('@cardano-sdk/util');

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
