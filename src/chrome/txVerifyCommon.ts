// The checks every wallet-side verifier of a Nexus-built Plutus transaction makes the same way:
// read the transaction and its id, refuse the body fields nothing here ever needs, sort inputs as
// the ledger does, and hold the collateral to the wallet's own ADA-only UTxO (or the pool UTxO
// Nexus said it lent). Moved out of legacyCancelVerify.ts so the NFT market's verifiers
// (nftMarket/verifyListing.ts and the ones after it) apply the same rules; behaviour and messages
// are unchanged. Pure; every refusal goes through the caller's `refuse`, which throws the
// caller's own error type, so a rule name means the same thing in both families.

import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { forEachAsset } from '@/api/nexusInputSelection';

/** The rule names these helpers refuse with; every caller's error code set includes all three. */
export type CommonVerifyRule = 'TX_ID' | 'FORBIDDEN_FIELD' | 'COLLATERAL';

/** Throws the caller's error. Typed as a value so control-flow analysis sees it never returns. */
export type Refuse = (rule: CommonVerifyRule, detail: string) => never;

/** `txHash#index` of an input, a reference input or a collateral input. */
export const refOf = (input: { txId: string; index: number }): string => `${input.txId}#${input.index}`;

/**
 * Parse `txCbor`. The id computed here from the body's own bytes must equal both the id the
 * Core conversion reports and `txHash`, the one Nexus said.
 */
export function readTransaction(
  txCbor: string,
  txHash: string,
  refuse: Refuse,
): { serialized: Serialization.Transaction; tx: Cardano.Tx; txId: string } {
  let serialized: Serialization.Transaction;
  let tx: Cardano.Tx;
  let txId: string;
  try {
    serialized = Serialization.Transaction.fromCbor(HexBlob(txCbor));
    tx = serialized.toCore();
    txId = serialized.getId();
  } catch (e) {
    return refuse('TX_ID', `unreadable transaction: ${(e as Error)?.message ?? e}`);
  }
  if (txId !== tx.id || txId !== String(txHash ?? '').toLowerCase()) {
    return refuse('TX_ID', 'the transaction id does not match the one Nexus reported');
  }
  return { serialized, tx, txId };
}

/**
 * Refuse every body or envelope field a market transaction never uses: an invalid flag (which
 * forfeits collateral), auxiliary data, mint or burn, certificates, withdrawals, votes,
 * proposals, treasury fields, a protocol-parameter update and the fields of later eras.
 * `what` names the transaction in the message ("a cancel never needs").
 */
export function checkForbiddenFields(tx: Cardano.Tx, refuse: Refuse, what: string): void {
  const body = tx.body;
  const refuseField = (detail: string): never => refuse('FORBIDDEN_FIELD', detail);
  if (tx.isValid === false) refuseField('marked invalid, which forfeits collateral');
  if (tx.auxiliaryData !== undefined || body.auxiliaryDataHash !== undefined) refuseField('carries auxiliary data');
  if (body.mint?.size) refuseField('mints or burns');
  if (body.certificates?.length) refuseField('has certificates');
  if (body.withdrawals?.length) refuseField('withdraws');
  if (body.votingProcedures?.length) refuseField('votes');
  if (body.proposalProcedures?.length) refuseField('proposes');
  if (body.donation !== undefined || body.treasuryValue !== undefined) refuseField('touches the treasury');
  if (body.update !== undefined) refuseField('updates protocol parameters');
  // Fields of later eras: none belongs here.
  if (body.guards?.length || body.directDeposits?.length || body.accountBalanceIntervals?.length || body.subTransactions?.length) {
    refuseField(`has fields a ${what} never needs`);
  }
}

/** The ledger's order of a transaction's inputs: by transaction id bytes, then output index. */
export function compareInputs(a: Cardano.TxIn, b: Cardano.TxIn): number {
  const left = String(a.txId).toLowerCase();
  const right = String(b.txId).toLowerCase();
  if (left !== right) return left < right ? -1 : 1;
  return a.index - b.index;
}

export interface CollateralRules {
  /** The wallet's own key addresses: a collateral return must go to one. */
  ownAddresses: ReadonlySet<string>;
  /** The wallet's own key hashes: a collateral return must pay one of them. */
  ownKeyHashes: ReadonlySet<string>;
  /** `txHash#index` of the Nexus pool collateral, when Nexus said it lent one. */
  sponsoredCollateralRef?: string;
  /** Most of the wallet's own ADA that may be forfeit if a script fails. */
  maxAtRiskLovelace: bigint;
}

/**
 * Exactly one collateral input: either the wallet's own ADA-only UTxO that the transaction
 * also spends, with any change going back to the wallet as plain ADA and at most
 * `maxAtRiskLovelace` forfeit; or the Nexus pool UTxO Nexus said it lent, which is not the
 * wallet's to lose. Returns true for the lent pool UTxO.
 */
export function checkCollateral(
  body: Cardano.TxBody,
  inputRefs: ReadonlySet<string>,
  ownByRef: ReadonlyMap<string, Cardano.Utxo>,
  rules: CollateralRules,
  refuse: Refuse,
): boolean {
  const collaterals = body.collaterals ?? [];
  if (collaterals.length !== 1) return refuse('COLLATERAL', 'needs exactly one collateral input');
  const ref = refOf(collaterals[0]);
  const own = ownByRef.get(ref);
  if (own) {
    let assets = 0;
    forEachAsset(own[1], () => assets++);
    if (assets > 0 || !inputRefs.has(ref)) {
      return refuse('COLLATERAL', 'own collateral must be an ADA-only input it spends');
    }
    const returned = body.collateralReturn;
    if (returned) {
      const address = String(returned.address);
      // OX Agent: Authorization prevented by ownership check - the collateral return pays one of the wallet's addresses, at one of its own keys
      if (!rules.ownAddresses.has(address) || !paysOwnKey(address, rules.ownKeyHashes)) {
        return refuse('COLLATERAL', 'returns collateral elsewhere');
      }
      let returnedAssets = 0;
      forEachAsset(returned, () => returnedAssets++);
      if (returnedAssets > 0 || returned.datum !== undefined || returned.datumHash !== undefined || returned.scriptReference !== undefined) {
        return refuse('COLLATERAL', 'the collateral return is not plain ADA');
      }
    }
    const atRisk = own[1].value.coins - (returned?.value.coins ?? 0n);
    if (atRisk < 0n || atRisk > rules.maxAtRiskLovelace) {
      return refuse('COLLATERAL', 'puts too much collateral at risk');
    }
    if (body.totalCollateral !== undefined && body.totalCollateral !== atRisk) {
      return refuse('COLLATERAL', 'total collateral disagrees with the return');
    }
    return false;
  }
  if (rules.sponsoredCollateralRef && ref === rules.sponsoredCollateralRef && !inputRefs.has(ref)) return true;
  return refuse('COLLATERAL', "the collateral is neither the wallet's nor the lent pool UTxO");
}

/**
 * Whether `address` pays a key of this wallet: its payment credential (base, enterprise or
 * pointer address) is a key hash among `ownKeyHashes`. A script credential, an address with no
 * payment credential and one that cannot be read do not.
 *
 * A second guard only: callers first require the exact address in `ownAddresses`, which pins the
 * stake part. Pointer addresses are accepted on purpose (they carry a payment key credential);
 * `cip113VerifyTransfer.ts` reads base and enterprise only because it resolves a recipient's owner.
 */
export function paysOwnKey(address: string, ownKeyHashes: ReadonlySet<string>): boolean {
  try {
    const parsed = Cardano.Address.fromBech32(address);
    const credential = (parsed.asBase() ?? parsed.asEnterprise() ?? parsed.asPointer())?.getPaymentCredential();
    return credential?.type === Cardano.CredentialType.KeyHash && ownKeyHashes.has(String(credential.hash));
  } catch {
    return false;
  }
}

/** The network id an address is for, or null when it cannot be read. */
export function outputNetwork(address: string): Cardano.NetworkId | null {
  try {
    return Cardano.Address.fromBech32(address).getNetworkId();
  } catch {
    return null;
  }
}
