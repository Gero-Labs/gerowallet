// A second CIP-113 tripwire for the dApp-facing signing entry points, beside the refusal
// index (WalletBg.findProgrammableInputs). The index only knows programmable UTxOs that have
// synced; one created since the last sync is missing from it, so a transaction spending it
// would pass. But every CIP-113 transfer withdraws 0 from the network's
// `programmable_logic_global` script, and a programmable UTxO owned by a key can only be
// spent with that key as a required signer. A transaction doing both with one of this
// wallet's keys is moving this wallet's programmable tokens, synced or not.
//
// It can also refuse a dApp transaction that needs the wallet's key for another reason while
// moving someone else's programmable tokens (a claim, say). Until dApp CIP-113 transfers are
// supported (Stage 3), that is refused too.

import { Cardano } from '@cardano-sdk/core';

/** Whether `tx` withdraws one of `globalScriptHashes` and requires one of `ownKeyHashes` to sign. */
export function cip113TransferNeedsOwnKey(
  tx: Cardano.Tx,
  globalScriptHashes: ReadonlySet<string>,
  ownKeyHashes: ReadonlySet<string>,
): boolean {
  if (globalScriptHashes.size === 0 || ownKeyHashes.size === 0) return false;
  const signers = tx?.body?.requiredExtraSignatures ?? [];
  if (!signers.some((hash) => ownKeyHashes.has(String(hash)))) return false;
  return (tx?.body?.withdrawals ?? []).some((withdrawal) => {
    try {
      const credential = Cardano.Address.fromBech32(String(withdrawal.stakeAddress)).asReward()?.getPaymentCredential();
      return credential?.type === Cardano.CredentialType.ScriptHash && globalScriptHashes.has(credential.hash);
    } catch {
      return false;
    }
  });
}
