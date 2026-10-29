// The wallet's own check of a CIP-113 transfer Nexus built, before anything is signed
// (design §3). Pure and fail closed: every rule below either holds or the transfer is
// refused with a Cip113VerifyError naming the rule. Nothing Nexus says about the
// transaction is trusted; only the CBOR is read.
//
// What a transfer that passes can do to the wallet:
//  - send exactly `quantity` of the one token, with at most CIP113_MAX_OUTPUT_LOVELACE of ADA,
//    to the recipient's programmable address (worked out here from the address as typed);
//  - keep the rest of those tokens at the same owner's programmable address, with at most
//    CIP113_MAX_OUTPUT_LOVELACE of ADA locked beside them;
//  - pay a fee of at most CIP113_MAX_FEE;
//  - if a script fails anyway, lose at most CIP113_MAX_COLLATERAL_AT_RISK of collateral;
//  - return everything else to the wallet's own key addresses.
// It cannot spend any other UTxO, mint, burn, certify, vote, propose, donate, run a
// transfer-logic script that is not a reviewed template, or be signed by any key but the
// tokens' owner and the payment keys of the wallet's own fee inputs.

import { Cardano, Serialization } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { forEachAsset } from '@/api/nexusInputSelection';
import { applyDataParams, extractDataParams, plutusV3Hash } from '@/chrome/cip113Uplc';
import type { Cip113InputSelection } from '@/chrome/cip113SelectInputs';
import {
  CIP113_TRANSFER_LOGIC_TEMPLATES,
  type Cip113TransferLogicModule,
} from '@/utils/cip113TransferLogic';

/** Highest fee the wallet signs for a transfer (2 ADA; a one-input transfer costs about 0.35). */
export const CIP113_MAX_FEE = 2_000_000n;
/** Most ADA on each programmable output (min-UTxO is about 1.24 ADA today). */
export const CIP113_MAX_OUTPUT_LOVELACE = 2_000_000n;
/** Most collateral that is forfeit if a script fails: 150% of the highest fee. */
export const CIP113_MAX_COLLATERAL_AT_RISK = 3_000_000n;
/** Longest validity window, in slots (one hour on every network Send runs on). */
export const CIP113_MAX_VALIDITY_SLOTS = 3600;
/** Largest inline datum on a programmable output, as the protocol params allow. */
export const CIP113_MAX_DATUM_BYTES = 1024;

export type Cip113VerifyRule =
  | 'TX_ID'
  | 'ENVELOPE'
  | 'NETWORK'
  | 'BODY'
  | 'INPUTS'
  | 'WITHDRAWALS'
  | 'LOGIC'
  | 'SIGNERS'
  | 'RECIPIENT'
  | 'OUTPUTS'
  | 'FEE'
  | 'COLLATERAL';

export class Cip113VerifyError extends Error {
  constructor(readonly rule: Cip113VerifyRule, detail: string) {
    super(`CIP-113 transfer refused (${rule}): ${detail}`);
    this.name = 'Cip113VerifyError';
  }
}

/** What the user asked for. */
export interface Cip113TransferIntent {
  unit: string;
  quantity: bigint;
  /** The recipient as typed (an ADA Handle already resolved by the page). */
  recipientAddress: string;
}

export interface Cip113VerifyContext {
  networkId: Cardano.NetworkId;
  /** The network's PLG and core transfer stake scripts. */
  globalScriptHashes: ReadonlySet<string>;
  transferScriptHashes: ReadonlySet<string>;
  /** The programmable UTxOs the background chose to spend. */
  selection: Cip113InputSelection;
  /** The wallet's own spendable UTxOs (fee inputs and collateral must be among them). */
  ownUtxos: readonly Cardano.Utxo[];
  /** The wallet's own key addresses: change and every non-recipient output must go to one. */
  ownAddresses: ReadonlySet<string>;
  /** The wallet's own key hashes (payment, change and stake). */
  ownKeyHashes: ReadonlySet<string>;
  /** `txHash#index` of the Nexus pool collateral, when Nexus said it lent one. */
  sponsoredCollateralRef?: string;
}

export type Cip113RecipientOwnerType = 'stake_key' | 'payment_key' | 'as_given';

/** What the review screen shows, read from the verified transaction. */
export interface Cip113TransferSummary {
  txId: string;
  unit: string;
  quantity: string;
  recipientAddress: string;
  recipientProgrammableAddress: string;
  recipientOwner: { type: Cip113RecipientOwnerType; hash: string };
  /** ADA that travels with the tokens to the recipient, paid by the sender. */
  lovelaceToRecipient: string;
  /** The sender's programmable address keeping the rest of the tokens, if any are left. */
  changeProgrammableAddress?: string;
  lovelaceToChange?: string;
  fee: string;
  /** The wallet's own collateral forfeit if a script fails; '0' with Nexus pool collateral. */
  collateralAtRisk: string;
  sponsoredCollateralRef?: string;
  moduleId: Cip113TransferLogicModule;
  transferLogicHash: string;
  validityStart: number;
  validityEnd: number;
}

const refOf = (input: { txId: string; index: number }) => `${input.txId}#${input.index}`;

/**
 * Check `txCbor` against `intent` and return what it does, or throw Cip113VerifyError.
 * `nexusTxHash` is the id Nexus reported; it must equal the id computed here, which is the
 * one the signing allowance is granted for.
 */
export function verifyCip113Transfer(
  txCbor: string,
  nexusTxHash: string,
  intent: Cip113TransferIntent,
  ctx: Cip113VerifyContext,
): Cip113TransferSummary {
  let tx: Cardano.Tx;
  let txId: string;
  try {
    const serialized = Serialization.Transaction.fromCbor(HexBlob(txCbor));
    tx = serialized.toCore();
    txId = serialized.getId();
  } catch (e) {
    throw new Cip113VerifyError('TX_ID', `unreadable transaction: ${(e as Error)?.message ?? e}`);
  }
  if (txId !== tx.id || txId !== String(nexusTxHash ?? '').toLowerCase()) {
    throw new Cip113VerifyError('TX_ID', 'the transaction id does not match the one Nexus reported');
  }
  const body = tx.body;
  const selectionRefs = new Set(ctx.selection.utxos.map(([txIn]) => refOf(txIn)));
  const ownByRef = new Map(ctx.ownUtxos.map((utxo) => [refOf(utxo[0]), utxo]));

  // Envelope.
  if (tx.isValid === false) throw new Cip113VerifyError('ENVELOPE', 'marked invalid, which forfeits collateral');
  if (tx.auxiliaryData || body.auxiliaryDataHash) throw new Cip113VerifyError('ENVELOPE', 'carries auxiliary data');
  const start = body.validityInterval?.invalidBefore;
  const end = body.validityInterval?.invalidHereafter;
  if (start === undefined || end === undefined || end <= start || end - start > CIP113_MAX_VALIDITY_SLOTS) {
    throw new Cip113VerifyError('ENVELOPE', 'needs a validity window of at most one hour');
  }

  // Network.
  if (body.networkId !== undefined && body.networkId !== ctx.networkId) {
    throw new Cip113VerifyError('NETWORK', 'body network id differs');
  }

  // Nothing in the body but the transfer.
  if (body.certificates?.length) throw new Cip113VerifyError('BODY', 'has certificates');
  if (body.mint?.size) throw new Cip113VerifyError('BODY', 'mints or burns');
  if (body.votingProcedures?.length) throw new Cip113VerifyError('BODY', 'votes');
  if (body.proposalProcedures?.length) throw new Cip113VerifyError('BODY', 'proposes');
  if (body.donation !== undefined || body.treasuryValue !== undefined) throw new Cip113VerifyError('BODY', 'touches the treasury');
  if ((body as { update?: unknown }).update !== undefined) throw new Cip113VerifyError('BODY', 'updates protocol parameters');

  // Inputs: every chosen programmable UTxO, and otherwise only the wallet's own.
  const inputRefs = new Set(body.inputs.map(refOf));
  if (inputRefs.size !== body.inputs.length) throw new Cip113VerifyError('INPUTS', 'repeats an input');
  for (const ref of selectionRefs) {
    if (!inputRefs.has(ref)) throw new Cip113VerifyError('INPUTS', `does not spend ${ref}`);
  }
  for (const ref of inputRefs) {
    if (!selectionRefs.has(ref) && !ownByRef.has(ref)) throw new Cip113VerifyError('INPUTS', `spends ${ref}, which is not the wallet's`);
  }

  // Withdrawals: exactly PLG, the core transfer and one logic script, all scripts, all 0.
  const withdrawn = (body.withdrawals ?? []).map((w) => {
    if (w.quantity !== 0n) throw new Cip113VerifyError('WITHDRAWALS', 'withdraws rewards');
    const credential = rewardCredential(w.stakeAddress, ctx.networkId);
    if (!credential || credential.type !== Cardano.CredentialType.ScriptHash) {
      throw new Cip113VerifyError('WITHDRAWALS', 'withdraws from a key credential or another network');
    }
    return credential.hash as string;
  });
  const globals = withdrawn.filter((h) => ctx.globalScriptHashes.has(h));
  const transfers = withdrawn.filter((h) => ctx.transferScriptHashes.has(h));
  const logic = withdrawn.filter((h) => !ctx.globalScriptHashes.has(h) && !ctx.transferScriptHashes.has(h));
  if (withdrawn.length !== 3 || globals.length !== 1 || transfers.length !== 1 || logic.length !== 1) {
    throw new Cip113VerifyError('WITHDRAWALS', 'is not exactly the global, transfer and one logic withdrawal');
  }
  const { moduleId } = checkLogicScript(tx, logic[0], ctx.selection.baseScriptHash);

  // Required signers: the tokens' owner, and it is one of the wallet's keys.
  const signers = body.requiredExtraSignatures ?? [];
  if (signers.length !== 1 || signers[0] !== ctx.selection.ownerKeyHash || !ctx.ownKeyHashes.has(ctx.selection.ownerKeyHash)) {
    throw new Cip113VerifyError('SIGNERS', "must require exactly the tokens' owner, a key of this wallet");
  }

  // Outputs.
  const recipient = resolveRecipient(intent.recipientAddress, ctx.selection.baseScriptHash, ctx.networkId);
  if (recipient.programmableAddress === ctx.selection.address) {
    throw new Cip113VerifyError('RECIPIENT', 'sends to the same programmable address it spends from');
  }
  const change = ctx.selection.total - intent.quantity;
  if (intent.quantity <= 0n || change < 0n) throw new Cip113VerifyError('OUTPUTS', 'the selection does not cover the amount');
  let recipientOutput: Cardano.TxOut | undefined;
  let changeOutput: Cardano.TxOut | undefined;
  for (const out of body.outputs) {
    const address = String(out.address);
    if (outputNetwork(address) !== ctx.networkId) throw new Cip113VerifyError('NETWORK', 'pays an address of another network');
    if (address === recipient.programmableAddress) {
      if (recipientOutput) throw new Cip113VerifyError('OUTPUTS', 'pays the recipient twice');
      recipientOutput = out;
      checkProgrammableOutput(out, intent.unit, intent.quantity);
    } else if (address === ctx.selection.address) {
      if (changeOutput) throw new Cip113VerifyError('OUTPUTS', 'returns tokens to the owner twice');
      changeOutput = out;
      checkProgrammableOutput(out, intent.unit, change);
    } else if (ctx.ownAddresses.has(address)) {
      if (out.scriptReference) throw new Cip113VerifyError('OUTPUTS', 'puts a reference script on a wallet output');
      forEachAsset(out, (unit) => {
        if (unit === intent.unit) throw new Cip113VerifyError('OUTPUTS', 'moves the token to a key address');
      });
    } else {
      throw new Cip113VerifyError('OUTPUTS', 'pays an address that is neither the recipient nor the wallet');
    }
  }
  if (!recipientOutput) throw new Cip113VerifyError('OUTPUTS', 'does not pay the recipient');
  if (change > 0n && !changeOutput) throw new Cip113VerifyError('OUTPUTS', 'does not return the rest of the tokens');
  if (change === 0n && changeOutput) throw new Cip113VerifyError('OUTPUTS', 'returns tokens that were all sent');

  // Fee.
  if (body.fee > CIP113_MAX_FEE) throw new Cip113VerifyError('FEE', 'is above the cap');

  // Collateral.
  const collateralAtRisk = checkCollateral(body, inputRefs, ownByRef, ctx);

  return {
    txId,
    unit: intent.unit,
    quantity: intent.quantity.toString(),
    recipientAddress: intent.recipientAddress,
    recipientProgrammableAddress: recipient.programmableAddress,
    recipientOwner: { type: recipient.type, hash: recipient.ownerHash },
    lovelaceToRecipient: recipientOutput.value.coins.toString(),
    ...(changeOutput ? {
      changeProgrammableAddress: ctx.selection.address,
      lovelaceToChange: changeOutput.value.coins.toString(),
    } : {}),
    fee: body.fee.toString(),
    collateralAtRisk: collateralAtRisk.toString(),
    ...(ctx.sponsoredCollateralRef && collateralAtRisk === 0n ? { sponsoredCollateralRef: ctx.sponsoredCollateralRef } : {}),
    moduleId,
    transferLogicHash: logic[0],
    validityStart: start,
    validityEnd: end,
  };
}

/**
 * The logic script must be the transaction's one witness script, hash to the logic
 * withdrawal, and be a reviewed template: as is, or with exactly its parameters applied,
 * for freeze-and-seize the first being this deployment's PLB as a Script credential.
 */
function checkLogicScript(tx: Cardano.Tx, logicHash: string, baseScriptHash: string): { moduleId: Cip113TransferLogicModule } {
  const scripts = tx.witness.scripts ?? [];
  const [script] = scripts;
  if (
    scripts.length !== 1
    || script.__type !== Cardano.ScriptType.Plutus
    || script.version !== Cardano.PlutusLanguageVersion.V3
  ) {
    throw new Cip113VerifyError('LOGIC', 'needs exactly one PlutusV3 witness script');
  }
  const bytes = hexToBytes(script.bytes);
  if (plutusV3Hash(bytes) !== logicHash) throw new Cip113VerifyError('LOGIC', 'the witness script is not the logic withdrawn');

  for (const template of CIP113_TRANSFER_LOGIC_TEMPLATES) {
    const code = hexToBytes(template.compiledCode);
    if (template.parameters.length === 0) {
      if (bytesToHex(code) === script.bytes && plutusV3Hash(code) === template.hash) return { moduleId: template.moduleId };
      continue;
    }
    let params: Uint8Array[];
    try {
      params = extractDataParams(bytes, code, template.parameters.length);
    } catch {
      continue;
    }
    if (template.moduleId === 'freeze-and-seize' && isScriptCredential(params[0], baseScriptHash) && isPolicyId(params[1])) {
      const reapplied = applyDataParams(code, params);
      if (bytesToHex(reapplied) === script.bytes && plutusV3Hash(reapplied) === logicHash) return { moduleId: template.moduleId };
    }
  }
  throw new Cip113VerifyError('LOGIC', 'the transfer logic is not a reviewed template for this deployment');
}

/** `Constr 1 [B hash]`: Credential `Script(hash)`, in either list encoding. */
function isScriptCredential(cbor: Uint8Array, hash: string): boolean {
  try {
    const data = Serialization.PlutusData.fromCbor(HexBlob(bytesToHex(cbor))).toCore() as Cardano.ConstrPlutusData;
    const items = data?.fields?.items ?? [];
    return data.constructor === 1n && items.length === 1 && items[0] instanceof Uint8Array && bytesToHex(items[0]) === hash;
  } catch {
    return false;
  }
}

/** A 28-byte bytestring. */
function isPolicyId(cbor: Uint8Array): boolean {
  try {
    const data = Serialization.PlutusData.fromCbor(HexBlob(bytesToHex(cbor))).toCore();
    return data instanceof Uint8Array && data.length === 28;
  } catch {
    return false;
  }
}

/** A programmable output: exactly `quantity` of the token, bounded ADA, a small inline datum. */
function checkProgrammableOutput(out: Cardano.TxOut, unit: string, quantity: bigint): void {
  let held = 0n;
  let others = 0;
  forEachAsset(out, (u, q) => {
    if (u === unit) held += q;
    else others++;
  });
  if (others > 0 || held !== quantity) throw new Cip113VerifyError('OUTPUTS', 'a programmable output holds the wrong tokens');
  if (out.value.coins > CIP113_MAX_OUTPUT_LOVELACE) throw new Cip113VerifyError('OUTPUTS', 'a programmable output locks too much ADA');
  if (out.datumHash || out.scriptReference || !out.datum) {
    throw new Cip113VerifyError('OUTPUTS', 'a programmable output needs an inline datum and nothing else');
  }
  if (Serialization.PlutusData.fromCore(out.datum).toCbor().length / 2 > CIP113_MAX_DATUM_BYTES) {
    throw new Cip113VerifyError('OUTPUTS', 'a programmable output carries too large a datum');
  }
}

/**
 * At most one collateral input: either the wallet's own ADA-only UTxO that the transaction
 * also spends, with the change going back to the wallet and at most
 * CIP113_MAX_COLLATERAL_AT_RISK forfeit; or the Nexus pool UTxO Nexus said it lent, which is
 * not the wallet's to lose. Returns the wallet's ADA at risk.
 */
function checkCollateral(
  body: Cardano.TxBody,
  inputRefs: ReadonlySet<string>,
  ownByRef: ReadonlyMap<string, Cardano.Utxo>,
  ctx: Cip113VerifyContext,
): bigint {
  const collaterals = body.collaterals ?? [];
  if (collaterals.length !== 1) throw new Cip113VerifyError('COLLATERAL', 'needs exactly one collateral input');
  const ref = refOf(collaterals[0]);
  const own = ownByRef.get(ref);
  if (own) {
    let assets = 0;
    forEachAsset(own[1], () => assets++);
    if (assets > 0 || !inputRefs.has(ref)) throw new Cip113VerifyError('COLLATERAL', 'own collateral must be an ADA-only input it spends');
    const returned = body.collateralReturn;
    if (returned) {
      if (!ctx.ownAddresses.has(String(returned.address))) throw new Cip113VerifyError('COLLATERAL', 'returns collateral elsewhere');
      let returnedAssets = 0;
      forEachAsset(returned, () => returnedAssets++);
      if (returnedAssets > 0 || returned.datum || returned.datumHash || returned.scriptReference) {
        throw new Cip113VerifyError('COLLATERAL', 'the collateral return is not plain ADA');
      }
    }
    const atRisk = own[1].value.coins - (returned?.value.coins ?? 0n);
    if (atRisk < 0n || atRisk > CIP113_MAX_COLLATERAL_AT_RISK) throw new Cip113VerifyError('COLLATERAL', 'puts too much collateral at risk');
    if (body.totalCollateral !== undefined && body.totalCollateral !== atRisk) {
      throw new Cip113VerifyError('COLLATERAL', 'total collateral disagrees with the return');
    }
    return atRisk;
  }
  if (ctx.sponsoredCollateralRef && ref === ctx.sponsoredCollateralRef && !inputRefs.has(ref)) return 0n;
  throw new Cip113VerifyError('COLLATERAL', 'the collateral is neither the wallet\'s nor the lent pool UTxO');
}

/**
 * Where the recipient's tokens go (decision 2, the same rules as Nexus's
 * RecipientOwnerResolver): a base address's stake key; an enterprise address's payment key;
 * a programmable address of this deployment as given. Anything else is refused.
 */
export function resolveRecipient(
  recipientAddress: string,
  baseScriptHash: string,
  networkId: Cardano.NetworkId,
): { programmableAddress: string; type: Cip113RecipientOwnerType; ownerHash: string } {
  let address: Cardano.Address | null = null;
  try {
    address = Cardano.Address.fromBech32(String(recipientAddress ?? '').trim());
  } catch {
    address = null;
  }
  if (!address) throw new Cip113VerifyError('RECIPIENT', 'is not a Shelley address');
  if (address.getNetworkId() !== networkId) throw new Cip113VerifyError('RECIPIENT', 'is on another network');
  const base = address.asBase();
  if (base) {
    const payment = base.getPaymentCredential();
    const stake = base.getStakeCredential();
    if (stake.type !== Cardano.CredentialType.KeyHash) throw new Cip113VerifyError('RECIPIENT', 'has a script stake credential');
    if (payment.type === Cardano.CredentialType.ScriptHash && payment.hash === baseScriptHash) {
      return { programmableAddress: base.toAddress().toBech32(), type: 'as_given', ownerHash: stake.hash };
    }
    return { programmableAddress: programmableAddress(baseScriptHash, stake.hash, networkId), type: 'stake_key', ownerHash: stake.hash };
  }
  const enterprise = address.asEnterprise();
  if (enterprise) {
    const payment = enterprise.getPaymentCredential();
    if (payment.type !== Cardano.CredentialType.KeyHash) throw new Cip113VerifyError('RECIPIENT', 'is a script address with no key');
    return { programmableAddress: programmableAddress(baseScriptHash, payment.hash, networkId), type: 'payment_key', ownerHash: payment.hash };
  }
  throw new Cip113VerifyError('RECIPIENT', 'must be a base or enterprise address');
}

/** `PLB ‖ VerificationKey(owner)`. */
export function programmableAddress(baseScriptHash: string, ownerKeyHash: string, networkId: Cardano.NetworkId): string {
  return Cardano.BaseAddress.fromCredentials(
    networkId,
    { hash: Hash28ByteBase16(baseScriptHash), type: Cardano.CredentialType.ScriptHash },
    { hash: Hash28ByteBase16(ownerKeyHash), type: Cardano.CredentialType.KeyHash },
  ).toAddress().toBech32();
}

function rewardCredential(stakeAddress: string, networkId: Cardano.NetworkId): Cardano.Credential | null {
  try {
    const address = Cardano.Address.fromBech32(String(stakeAddress));
    if (address.getNetworkId() !== networkId) return null;
    return address.asReward()?.getPaymentCredential() ?? null;
  } catch {
    return null;
  }
}

function outputNetwork(address: string): Cardano.NetworkId | null {
  try {
    return Cardano.Address.fromBech32(address).getNetworkId();
  } catch {
    return null;
  }
}
