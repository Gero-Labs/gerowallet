// The wallet's own check of a legacy marketplace cancel Nexus built, before anything is
// signed (NFT rescue). Pure and fail closed: every rule below either holds or the cancel is
// refused with a LegacyCancelVerifyError naming the rule. Nothing Nexus says about the
// transaction is trusted; only the CBOR is read, against the items the wallet asked to cancel.
//
// What a cancel that passes can do to the wallet:
//  - spend exactly the requested legacy UTxOs, each with its contract's cancel redeemer and
//    its contract's pinned reference script, signed by exactly the items' owners, all keys
//    of this wallet;
//  - spend the wallet's own UTxOs to pay the fee;
//  - pay every output to one of the wallet's own addresses whose payment credential is one of
//    its own keys (never a script, however the address set came to hold one), every asset of
//    every cancelled item reaching the return address;
//  - pay a fee of at most LEGACY_CANCEL_MAX_FEE;
//  - if a script fails anyway, lose at most LEGACY_CANCEL_MAX_COLLATERAL of the wallet's own
//    collateral, or none when it is the Nexus pool UTxO Nexus said it lent.
// It cannot spend any other UTxO, mint, burn, certify, withdraw, vote, propose, donate,
// carry metadata, or pay anyone but the wallet. The datums the witness set carries for
// hash-datum inputs are not checked: the items carry no datum hash, and a missing or wrong
// datum makes the ledger refuse the transaction before anything moves.

import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { forEachAsset } from '@/api/nexusInputSelection';
import type { LegacyListingItem } from '@/api/legacy-listings-api';
import {
  LEGACY_CANCEL_MAX,
  LEGACY_CANCEL_MAX_COLLATERAL,
  LEGACY_CANCEL_MAX_FEE,
  LEGACY_SCRIPTS,
  type LegacyScript,
} from '@/utils/legacyMarketScripts';

export type LegacyCancelVerifyCode =
  | 'TX_ID'
  | 'NETWORK'
  | 'INPUTS'
  | 'REFERENCE_INPUTS'
  | 'REDEEMERS'
  | 'SIGNERS'
  | 'OUTPUTS'
  | 'FORBIDDEN_FIELD'
  | 'COLLATERAL'
  | 'FEE';

export class LegacyCancelVerifyError extends Error {
  constructor(readonly code: LegacyCancelVerifyCode, detail: string) {
    super(`Legacy cancel refused (${code}): ${detail}`);
    this.name = 'LegacyCancelVerifyError';
  }
}

export interface LegacyCancelVerifyContext {
  /** Must be mainnet: the legacy contracts exist nowhere else. */
  networkId: Cardano.NetworkId;
  /** The wallet's legacy items, by `txHash#outputIndex`, as the background looked them up. */
  items: ReadonlyMap<string, LegacyListingItem>;
  /** The wallet's own spendable UTxOs (fee inputs and own collateral must be among them). */
  ownUtxos: readonly Cardano.Utxo[];
  /** The wallet's own key addresses: every output must go to one. */
  ownAddresses: ReadonlySet<string>;
  /**
   * The wallet's own key hashes: every owner of a cancelled item must be one, and so must the
   * payment credential of every output and of the collateral return.
   */
  ownKeyHashes: ReadonlySet<string>;
  /** Where every asset of the cancelled items must arrive; one of `ownAddresses`. */
  returnAddress: string;
  /** `txHash#index` of the Nexus pool collateral, when Nexus said it lent one. */
  sponsoredCollateralRef?: string;
}

/** What the review screen shows, read from the verified transaction. */
export interface LegacyCancelSummary {
  txId: string;
  feeLovelace: string;
  /** The requested refs, in the order asked. */
  refs: string[];
  /** The requested items, in `refs` order. */
  items: LegacyListingItem[];
  /** Present only when the transaction's collateral is the lent Nexus pool UTxO. */
  sponsoredCollateralRef?: string;
}

const DECIMAL = /^[0-9]+$/;

const refOf = (input: { txId: string; index: number }) => `${input.txId}#${input.index}`;
const itemRefOf = (item: LegacyListingItem) => `${item.txHash}#${item.outputIndex}`;

/**
 * Check `txCbor` against the cancel of `refs` and return what it does, or throw
 * LegacyCancelVerifyError. `txHash` is the id Nexus reported; it must equal the id computed
 * here from the body's own bytes.
 */
export function verifyLegacyCancel(
  txCbor: string,
  txHash: string,
  refs: readonly string[],
  ctx: LegacyCancelVerifyContext,
): LegacyCancelSummary {
  let serialized: Serialization.Transaction;
  let tx: Cardano.Tx;
  let txId: string;
  try {
    serialized = Serialization.Transaction.fromCbor(HexBlob(txCbor));
    tx = serialized.toCore();
    txId = serialized.getId();
  } catch (e) {
    throw new LegacyCancelVerifyError('TX_ID', `unreadable transaction: ${(e as Error)?.message ?? e}`);
  }
  if (txId !== tx.id || txId !== String(txHash ?? '').toLowerCase()) {
    throw new LegacyCancelVerifyError('TX_ID', 'the transaction id does not match the one Nexus reported');
  }
  const body = tx.body;
  const items = requestedItems(refs, ctx.items);
  const requested = new Map(items.map((item) => [itemRefOf(item), item]));

  // Network.
  if (ctx.networkId !== Cardano.NetworkId.Mainnet) throw new LegacyCancelVerifyError('NETWORK', 'the legacy contracts are mainnet only');
  if (body.networkId !== undefined && body.networkId !== ctx.networkId) {
    throw new LegacyCancelVerifyError('NETWORK', 'body network id differs');
  }

  // Nothing but the cancel.
  checkForbiddenFields(tx);

  // Inputs: every requested legacy UTxO, and otherwise only the wallet's own.
  const inputRefs = new Set(body.inputs.map(refOf));
  if (inputRefs.size !== body.inputs.length) throw new LegacyCancelVerifyError('INPUTS', 'repeats an input');
  if (ctx.sponsoredCollateralRef && inputRefs.has(ctx.sponsoredCollateralRef)) {
    throw new LegacyCancelVerifyError('INPUTS', 'spends the lent pool collateral');
  }
  for (const ref of requested.keys()) {
    if (!inputRefs.has(ref)) throw new LegacyCancelVerifyError('INPUTS', `does not spend ${ref}`);
  }
  const ownByRef = new Map(ctx.ownUtxos.map((utxo) => [refOf(utxo[0]), utxo]));
  // OX Agent: Authorization prevented by ownership check - only requested legacy UTxOs and the wallet's own are spent
  for (const ref of inputRefs) {
    if (requested.has(ref)) continue;
    if (ctx.items.has(ref)) throw new LegacyCancelVerifyError('INPUTS', `spends ${ref}, a legacy UTxO that was not asked for`);
    if (!ownByRef.has(ref)) throw new LegacyCancelVerifyError('INPUTS', `spends ${ref}, which is not the wallet's`);
  }

  // Reference inputs: exactly the reference scripts of the contracts used.
  const scriptRefs = new Set(items.map((item) => scriptOf(item).referenceScript));
  const referenceInputs = (body.referenceInputs ?? []).map(refOf);
  if (
    new Set(referenceInputs).size !== referenceInputs.length
    || referenceInputs.length !== scriptRefs.size
    || referenceInputs.some((ref) => !scriptRefs.has(ref))
  ) {
    throw new LegacyCancelVerifyError('REFERENCE_INPUTS', 'is not exactly the reference scripts of the contracts used');
  }

  // Redeemers: one cancel per legacy input, nothing else.
  checkRedeemers(serialized, body.inputs, requested);

  // Required signers: exactly the items' owners, each a key of this wallet.
  const owners = new Set(items.map((item) => item.ownerPkh));
  const signers = (body.requiredExtraSignatures ?? []).map(String);
  if (new Set(signers).size !== signers.length || signers.length !== owners.size || signers.some((s) => !owners.has(s))) {
    throw new LegacyCancelVerifyError('SIGNERS', "must require exactly the items' owners");
  }
  // OX Agent: Authorization prevented by ownership check - every signing owner is a key of this wallet
  for (const owner of owners) {
    if (!ctx.ownKeyHashes.has(owner)) throw new LegacyCancelVerifyError('SIGNERS', 'an owner is not a key of this wallet');
  }

  // Outputs: plain payments to the wallet, every legacy asset to the return address.
  if (!ctx.ownAddresses.has(ctx.returnAddress)) throw new LegacyCancelVerifyError('OUTPUTS', "the return address is not the wallet's");
  const owed = new Map<string, bigint>();
  for (const item of items) {
    for (const { unit, quantity } of item.assets) owed.set(unit, (owed.get(unit) ?? 0n) + BigInt(quantity));
  }
  const returned = new Map<string, bigint>();
  for (const out of body.outputs) {
    const address = String(out.address);
    if (outputNetwork(address) !== ctx.networkId) throw new LegacyCancelVerifyError('NETWORK', 'pays an address of another network');
    // OX Agent: Authorization prevented by ownership check - every output pays one of the wallet's addresses, at one of its own keys
    if (!ctx.ownAddresses.has(address) || !paysOwnKey(address, ctx.ownKeyHashes)) {
      throw new LegacyCancelVerifyError('OUTPUTS', "pays an address that is not the wallet's");
    }
    if (out.datum !== undefined || out.datumHash !== undefined || out.scriptReference !== undefined) {
      throw new LegacyCancelVerifyError('OUTPUTS', 'an output carries a datum or a reference script');
    }
    if (address === ctx.returnAddress) forEachAsset(out, (unit, quantity) => returned.set(unit, (returned.get(unit) ?? 0n) + quantity));
  }
  for (const [unit, quantity] of owed) {
    if ((returned.get(unit) ?? 0n) < quantity) throw new LegacyCancelVerifyError('OUTPUTS', `does not return ${unit} to the wallet`);
  }

  // Fee.
  if (body.fee > LEGACY_CANCEL_MAX_FEE) throw new LegacyCancelVerifyError('FEE', 'is above the cap');

  // Collateral.
  const sponsored = checkCollateral(body, inputRefs, ownByRef, ctx);

  return {
    txId,
    feeLovelace: body.fee.toString(),
    refs: [...refs],
    items,
    ...(sponsored ? { sponsoredCollateralRef: ctx.sponsoredCollateralRef } : {}),
  };
}

/** The items for `refs`, in order: 1 to LEGACY_CANCEL_MAX distinct refs, each a known legacy item. */
function requestedItems(refs: readonly string[], known: ReadonlyMap<string, LegacyListingItem>): LegacyListingItem[] {
  if (!Array.isArray(refs) || refs.length === 0 || refs.length > LEGACY_CANCEL_MAX) {
    throw new LegacyCancelVerifyError('INPUTS', `must cancel 1 to ${LEGACY_CANCEL_MAX} legacy UTxOs`);
  }
  if (new Set(refs).size !== refs.length) throw new LegacyCancelVerifyError('INPUTS', 'asks for a UTxO twice');
  return refs.map((ref) => {
    const item = known.get(ref);
    if (!item || itemRefOf(item) !== ref || !scriptOf(item) || item.assets.some((asset) => !DECIMAL.test(asset.quantity))) {
      throw new LegacyCancelVerifyError('INPUTS', `${ref} is not a known legacy UTxO`);
    }
    return item;
  });
}

function scriptOf(item: LegacyListingItem): LegacyScript | undefined {
  return Object.prototype.hasOwnProperty.call(LEGACY_SCRIPTS, item.contract) ? LEGACY_SCRIPTS[item.contract] : undefined;
}

function checkForbiddenFields(tx: Cardano.Tx): void {
  const body = tx.body;
  const refuse = (detail: string) => {
    throw new LegacyCancelVerifyError('FORBIDDEN_FIELD', detail);
  };
  if (tx.isValid === false) refuse('marked invalid, which forfeits collateral');
  if (tx.auxiliaryData !== undefined || body.auxiliaryDataHash !== undefined) refuse('carries auxiliary data');
  if (body.mint?.size) refuse('mints or burns');
  if (body.certificates?.length) refuse('has certificates');
  if (body.withdrawals?.length) refuse('withdraws');
  if (body.votingProcedures?.length) refuse('votes');
  if (body.proposalProcedures?.length) refuse('proposes');
  if (body.donation !== undefined || body.treasuryValue !== undefined) refuse('touches the treasury');
  if (body.update !== undefined) refuse('updates protocol parameters');
  // Fields of later eras: none belongs in a cancel.
  if (body.guards?.length || body.directDeposits?.length || body.accountBalanceIntervals?.length || body.subTransactions?.length) {
    refuse('has fields a cancel never needs');
  }
}

/** The ledger's order of a transaction's inputs: by transaction id bytes, then output index. */
function compareInputs(a: Cardano.TxIn, b: Cardano.TxIn): number {
  const left = String(a.txId).toLowerCase();
  const right = String(b.txId).toLowerCase();
  if (left !== right) return left < right ? -1 : 1;
  return a.index - b.index;
}

/**
 * Exactly one redeemer per legacy input: purpose spend, at that input's index in the ledger's
 * sorted input order, with the contract's cancel data compared as the bytes the
 * transaction carries (never through a Core round-trip, which may re-encode them).
 */
function checkRedeemers(
  serialized: Serialization.Transaction,
  inputs: readonly Cardano.TxIn[],
  requested: ReadonlyMap<string, LegacyListingItem>,
): void {
  const cancelAt = new Map<bigint, string>();
  [...inputs].sort(compareInputs).forEach((input, index) => {
    const item = requested.get(refOf(input));
    if (item) cancelAt.set(BigInt(index), scriptOf(item).cancelRedeemerCbor);
  });
  const redeemers = serialized.witnessSet().redeemers()?.values() ?? [];
  if (redeemers.length !== cancelAt.size) throw new LegacyCancelVerifyError('REDEEMERS', 'needs exactly one redeemer per legacy input');
  const seen = new Set<bigint>();
  for (const redeemer of redeemers) {
    const index = redeemer.index();
    const cancel = cancelAt.get(index);
    if (redeemer.tag() !== Serialization.RedeemerTag.Spend || cancel === undefined || seen.has(index)) {
      throw new LegacyCancelVerifyError('REDEEMERS', 'a redeemer is not the spend of a legacy input');
    }
    seen.add(index);
    if (redeemer.data().toCbor() !== cancel) {
      throw new LegacyCancelVerifyError('REDEEMERS', "a legacy input is not spent with its contract's cancel redeemer");
    }
  }
}

/**
 * Exactly one collateral input: either the wallet's own ADA-only UTxO that the transaction
 * also spends, with any change going back to the wallet as plain ADA and at most
 * LEGACY_CANCEL_MAX_COLLATERAL forfeit; or the Nexus pool UTxO Nexus said it lent, which is
 * not the wallet's to lose. Returns true for the lent pool UTxO.
 */
function checkCollateral(
  body: Cardano.TxBody,
  inputRefs: ReadonlySet<string>,
  ownByRef: ReadonlyMap<string, Cardano.Utxo>,
  ctx: LegacyCancelVerifyContext,
): boolean {
  const collaterals = body.collaterals ?? [];
  if (collaterals.length !== 1) throw new LegacyCancelVerifyError('COLLATERAL', 'needs exactly one collateral input');
  const ref = refOf(collaterals[0]);
  const own = ownByRef.get(ref);
  if (own) {
    let assets = 0;
    forEachAsset(own[1], () => assets++);
    if (assets > 0 || !inputRefs.has(ref)) {
      throw new LegacyCancelVerifyError('COLLATERAL', 'own collateral must be an ADA-only input it spends');
    }
    const returned = body.collateralReturn;
    if (returned) {
      const address = String(returned.address);
      // OX Agent: Authorization prevented by ownership check - the collateral return pays one of the wallet's addresses, at one of its own keys
      if (!ctx.ownAddresses.has(address) || !paysOwnKey(address, ctx.ownKeyHashes)) {
        throw new LegacyCancelVerifyError('COLLATERAL', 'returns collateral elsewhere');
      }
      let returnedAssets = 0;
      forEachAsset(returned, () => returnedAssets++);
      if (returnedAssets > 0 || returned.datum !== undefined || returned.datumHash !== undefined || returned.scriptReference !== undefined) {
        throw new LegacyCancelVerifyError('COLLATERAL', 'the collateral return is not plain ADA');
      }
    }
    const atRisk = own[1].value.coins - (returned?.value.coins ?? 0n);
    if (atRisk < 0n || atRisk > LEGACY_CANCEL_MAX_COLLATERAL) {
      throw new LegacyCancelVerifyError('COLLATERAL', 'puts too much collateral at risk');
    }
    if (body.totalCollateral !== undefined && body.totalCollateral !== atRisk) {
      throw new LegacyCancelVerifyError('COLLATERAL', 'total collateral disagrees with the return');
    }
    return false;
  }
  if (ctx.sponsoredCollateralRef && ref === ctx.sponsoredCollateralRef && !inputRefs.has(ref)) return true;
  throw new LegacyCancelVerifyError('COLLATERAL', "the collateral is neither the wallet's nor the lent pool UTxO");
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
function paysOwnKey(address: string, ownKeyHashes: ReadonlySet<string>): boolean {
  try {
    const parsed = Cardano.Address.fromBech32(address);
    const credential = (parsed.asBase() ?? parsed.asEnterprise() ?? parsed.asPointer())?.getPaymentCredential();
    return credential?.type === Cardano.CredentialType.KeyHash && ownKeyHashes.has(String(credential.hash));
  } catch {
    return false;
  }
}

function outputNetwork(address: string): Cardano.NetworkId | null {
  try {
    return Cardano.Address.fromBech32(address).getNetworkId();
  } catch {
    return null;
  }
}
