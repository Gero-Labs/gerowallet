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
import { forEachAsset } from '@/api/nexusInputSelection';
import type { LegacyListingItem } from '@/api/legacy-listings-api';
import {
  checkCollateral,
  checkForbiddenFields,
  compareInputs,
  outputNetwork,
  paysOwnKey,
  readTransaction,
  refOf,
} from '@/chrome/txVerifyCommon';
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

/**
 * The shared checks (txVerifyCommon.ts and `checkLegacySpend` below) refuse through this, so their
 * rules throw this error. A declaration, so control-flow analysis sees it never returns.
 */
function refuse(code: LegacyCancelVerifyCode, detail: string): never {
  throw new LegacyCancelVerifyError(code, detail);
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
  const { serialized, tx, txId } = readTransaction(txCbor, txHash, refuse);
  const body = tx.body;
  const items = requestedItems(refs, ctx.items, refuse);

  // Network.
  if (ctx.networkId !== Cardano.NetworkId.Mainnet) throw new LegacyCancelVerifyError('NETWORK', 'the legacy contracts are mainnet only');
  if (body.networkId !== undefined && body.networkId !== ctx.networkId) {
    throw new LegacyCancelVerifyError('NETWORK', 'body network id differs');
  }

  // Nothing but the cancel.
  checkForbiddenFields(tx, refuse, 'cancel');

  // Inputs, reference inputs, redeemers and required signers: the legacy spend itself.
  const { inputRefs, ownByRef } = checkLegacySpend(serialized, tx, items, ctx, refuse);

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
  const sponsored = checkCollateral(body, inputRefs, ownByRef, {
    ownAddresses: ctx.ownAddresses,
    ownKeyHashes: ctx.ownKeyHashes,
    sponsoredCollateralRef: ctx.sponsoredCollateralRef,
    maxAtRiskLovelace: LEGACY_CANCEL_MAX_COLLATERAL,
  }, refuse);

  return {
    txId,
    feeLovelace: body.fee.toString(),
    refs: [...refs],
    items,
    ...(sponsored ? { sponsoredCollateralRef: ctx.sponsoredCollateralRef } : {}),
  };
}

/** The rules the legacy spend checks refuse with; both the cancel's and the market's error codes cover them. */
export type LegacySpendRule = 'INPUTS' | 'REFERENCE_INPUTS' | 'REDEEMERS' | 'SIGNERS';

/** Throws the caller's error. Typed as a value so control-flow analysis sees it never returns. */
export type RefuseLegacySpend = (rule: LegacySpendRule, detail: string) => never;

/**
 * The items for `refs`, in order: 1 to LEGACY_CANCEL_MAX distinct refs, each a known legacy item.
 * Exported so the market's migrate (one listing at a time) resolves its item the same way.
 */
export function requestedItems(
  refs: readonly string[],
  known: ReadonlyMap<string, LegacyListingItem>,
  refuse: RefuseLegacySpend,
): LegacyListingItem[] {
  if (!Array.isArray(refs) || refs.length === 0 || refs.length > LEGACY_CANCEL_MAX) {
    return refuse('INPUTS', `must cancel 1 to ${LEGACY_CANCEL_MAX} legacy UTxOs`);
  }
  if (new Set(refs).size !== refs.length) return refuse('INPUTS', 'asks for a UTxO twice');
  return refs.map((ref) => {
    const item = known.get(ref);
    if (!item || itemRefOf(item) !== ref || !scriptOf(item) || item.assets.some((asset) => !DECIMAL.test(asset.quantity))) {
      return refuse('INPUTS', `${ref} is not a known legacy UTxO`);
    }
    return item;
  });
}

function scriptOf(item: LegacyListingItem): LegacyScript | undefined {
  return Object.prototype.hasOwnProperty.call(LEGACY_SCRIPTS, item.contract) ? LEGACY_SCRIPTS[item.contract] : undefined;
}

/** What `checkLegacySpend` reads from the wallet's side. */
export type LegacySpendContext = Pick<LegacyCancelVerifyContext, 'items' | 'ownUtxos' | 'ownKeyHashes' | 'sponsoredCollateralRef'>;

/** What the later checks (outputs, fee, collateral) need from the verified spend. */
export interface LegacySpend {
  /** Every input of the transaction, `txHash#index`. */
  inputRefs: ReadonlySet<string>;
  /** The wallet's own spendable UTxOs, by `txHash#index`. */
  ownByRef: ReadonlyMap<string, Cardano.Utxo>;
}

/**
 * The part of a legacy transaction that spends the `items`, whatever it then does with their
 * value: the inputs are exactly those items plus the wallet's own UTxOs; the reference inputs are
 * exactly the reference scripts of the contracts used; one cancel redeemer per legacy input and
 * nothing else; the required signers are exactly the items' owners, each a key of this wallet.
 * Shared by the rescue's cancel (every item's value returns to the wallet) and the market's
 * migrate (the NFT goes into a Gero listing), so both hold the legacy side to the same rules.
 */
export function checkLegacySpend(
  serialized: Serialization.Transaction,
  tx: Cardano.Tx,
  items: readonly LegacyListingItem[],
  ctx: LegacySpendContext,
  refuse: RefuseLegacySpend,
): LegacySpend {
  const body = tx.body;
  const requested = new Map(items.map((item) => [itemRefOf(item), item]));

  // Inputs: every requested legacy UTxO, and otherwise only the wallet's own.
  const inputRefs = new Set(body.inputs.map(refOf));
  if (inputRefs.size !== body.inputs.length) refuse('INPUTS', 'repeats an input');
  if (ctx.sponsoredCollateralRef && inputRefs.has(ctx.sponsoredCollateralRef)) {
    refuse('INPUTS', 'spends the lent pool collateral');
  }
  for (const ref of requested.keys()) {
    if (!inputRefs.has(ref)) refuse('INPUTS', `does not spend ${ref}`);
  }
  const ownByRef = new Map(ctx.ownUtxos.map((utxo) => [refOf(utxo[0]), utxo]));
  // OX Agent: Authorization prevented by ownership check - only requested legacy UTxOs and the wallet's own are spent
  for (const ref of inputRefs) {
    if (requested.has(ref)) continue;
    if (ctx.items.has(ref)) refuse('INPUTS', `spends ${ref}, a legacy UTxO that was not asked for`);
    if (!ownByRef.has(ref)) refuse('INPUTS', `spends ${ref}, which is not the wallet's`);
  }

  // Reference inputs: exactly the reference scripts of the contracts used.
  const scriptRefs = new Set(items.map((item) => scriptOf(item).referenceScript));
  const referenceInputs = (body.referenceInputs ?? []).map(refOf);
  if (
    new Set(referenceInputs).size !== referenceInputs.length
    || referenceInputs.length !== scriptRefs.size
    || referenceInputs.some((ref) => !scriptRefs.has(ref))
  ) {
    refuse('REFERENCE_INPUTS', 'is not exactly the reference scripts of the contracts used');
  }

  // Redeemers: one cancel per legacy input, nothing else.
  checkRedeemers(serialized, body.inputs, requested, refuse);

  // Required signers: exactly the items' owners, each a key of this wallet.
  const owners = new Set(items.map((item) => item.ownerPkh));
  const signers = (body.requiredExtraSignatures ?? []).map(String);
  if (new Set(signers).size !== signers.length || signers.length !== owners.size || signers.some((s) => !owners.has(s))) {
    refuse('SIGNERS', "must require exactly the items' owners");
  }
  // OX Agent: Authorization prevented by ownership check - every signing owner is a key of this wallet
  for (const owner of owners) {
    if (!ctx.ownKeyHashes.has(owner)) refuse('SIGNERS', 'an owner is not a key of this wallet');
  }

  return { inputRefs, ownByRef };
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
  refuse: RefuseLegacySpend,
): void {
  const cancelAt = new Map<bigint, string>();
  [...inputs].sort(compareInputs).forEach((input, index) => {
    const item = requested.get(refOf(input));
    if (item) cancelAt.set(BigInt(index), scriptOf(item).cancelRedeemerCbor);
  });
  const redeemers = serialized.witnessSet().redeemers()?.values() ?? [];
  if (redeemers.length !== cancelAt.size) refuse('REDEEMERS', 'needs exactly one redeemer per legacy input');
  const seen = new Set<bigint>();
  for (const redeemer of redeemers) {
    const index = redeemer.index();
    const cancel = cancelAt.get(index);
    if (redeemer.tag() !== Serialization.RedeemerTag.Spend || cancel === undefined || seen.has(index)) {
      refuse('REDEEMERS', 'a redeemer is not the spend of a legacy input');
    }
    seen.add(index);
    if (redeemer.data().toCbor() !== cancel) {
      refuse('REDEEMERS', "a legacy input is not spent with its contract's cancel redeemer");
    }
  }
}
