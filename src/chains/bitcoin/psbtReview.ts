/**
 * What a dApp's PSBT does to the wallet, decoded once and shared by the
 * approval views (popup and side panel) and the background signer: the user
 * reviews exactly the inputs the signer will sign, and both refuse the same
 * PSBTs.
 *
 * Signing semantics (Unisat `signPsbt`): with `toSignInputs`, only the listed
 * inputs are signed and each one must spend from the wallet; without it, every
 * input that spends from the wallet is signed.
 *
 * An OUTPUT is the wallet's only when its address derives from the wallet's own
 * account xpub (`derived`). Synced data (UTxO addresses, keys a sync named)
 * never makes one: a sync server that listed an attacker's address would
 * otherwise turn a payment to it into "your wallet" on the review.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { getBitcoinNetwork, spentAddress } from './bitcoinPsbtBuilder';
import { deriveBitcoinAddressSetFromXpubs, type BitcoinAddressTypeName } from './bitcoinKeyManager';

/** SIGHASH_DEFAULT (Taproot) and SIGHASH_ALL: the only sighash types the wallet signs with. */
const ALLOWED_SIGHASH_TYPES: ReadonlySet<number> = new Set([
  bitcoin.Transaction.SIGHASH_DEFAULT,
  bitcoin.Transaction.SIGHASH_ALL,
]);

export interface PsbtReviewInput {
  index: number;
  /** The address the input spends from, when its script is a standard one. */
  address: string | null;
  /** Satoshis, or null when the PSBT carries no previous-output data for it. */
  valueSats: bigint | null;
  own: boolean;
  willSign: boolean;
}

export interface PsbtReviewOutput {
  index: number;
  /** Null for a script with no address form (e.g. OP_RETURN). */
  address: string | null;
  valueSats: bigint;
  own: boolean;
  /** One of the wallet's own change addresses (the account's internal chain). */
  change: boolean;
}

/** The account's own addresses, derived from its xpub: the only addresses that make an output the wallet's. */
export interface BitcoinDerivedAddresses {
  receive: ReadonlySet<string>;
  change: ReadonlySet<string>;
}

export type PsbtReviewProblem =
  | { code: 'unparseable' }
  | { code: 'invalidToSignInputs' }
  | { code: 'badIndex'; index: number }
  | { code: 'notOwn'; index: number }
  | { code: 'addressMismatch'; index: number }
  | { code: 'unsupportedSighash'; index: number }
  | { code: 'missingValue'; index: number }
  | { code: 'valueMismatch'; index: number }
  | { code: 'nothingToSign' };

export interface PsbtReview {
  inputs: PsbtReviewInput[];
  outputs: PsbtReviewOutput[];
  /** The inputs the wallet signs, in order. */
  signIndices: number[];
  /** Total of the wallet's inputs that get signed. */
  spentSats: bigint;
  /** Total of the outputs that pay the wallet. */
  receivedSats: bigint;
  /** What leaves the wallet: spent minus received (negative when the wallet gains). */
  netSats: bigint;
  /** Inputs minus outputs, or null when an input's value is unknown. */
  feeSats: bigint | null;
  /** Anything here means the wallet must not sign. */
  problems: PsbtReviewProblem[];
}

export interface PsbtReviewContext {
  /** 'Mainnet' | 'Testnet' — as the wallet record stores it. */
  network: string;
  /** Every address of the wallet. */
  ownAddresses: Iterable<string>;
  /** The wallet's UTxOs: an own input's value is taken from here when present. */
  ownUtxos?: ReadonlyArray<{ txHash: string; index: number; value: bigint | number | string }>;
  /** The request's signing options: Unisat `{ toSignInputs }`, or a bare list (WalletConnect `signInputs`). */
  signOptions?: unknown;
  /** The account's derived addresses (bitcoinDerivedAddresses). Without them no output counts as the wallet's. */
  derived?: BitcoinDerivedAddresses;
}

export function parsePsbt(psbt: string, network: string): bitcoin.Psbt {
  const bitcoinNetwork = getBitcoinNetwork(network);
  return /^[\da-f]+$/i.test(psbt)
    ? bitcoin.Psbt.fromHex(psbt, { network: bitcoinNetwork })
    : bitcoin.Psbt.fromBase64(psbt, { network: bitcoinNetwork });
}

/**
 * The receive and change addresses the account's xpub derives (the set the
 * signer has keys for). Empty without a usable xpub.
 */
export function bitcoinDerivedAddresses(
  accountXpub: string | undefined,
  addressType: string | undefined,
  network: string,
): BitcoinDerivedAddresses {
  const receive = new Set<string>();
  const change = new Set<string>();
  if (accountXpub) {
    try {
      const type = (addressType || 'segwit').toLowerCase() as BitcoinAddressTypeName;
      const { derivationMap } = deriveBitcoinAddressSetFromXpubs({ [type]: accountXpub }, network);
      for (const [address, info] of Object.entries(derivationMap)) (info.chain === 1 ? change : receive).add(address);
    } catch {
      // not an account xpub: nothing derives
    }
  }
  return { receive, change };
}

/**
 * Every address the wallet's account may spend from: the receive and change
 * addresses the signer derives keys for, plus the addresses of its synced UTxOs.
 * For INPUTS only; outputs count as the wallet's through `derived` alone.
 */
export function bitcoinOwnAddresses(
  accountXpub: string | undefined,
  addressType: string | undefined,
  network: string,
  utxos: ReadonlyArray<{ address?: string }> = [],
): Set<string> {
  const own = new Set<string>();
  if (accountXpub) {
    const type = (addressType || 'segwit').toLowerCase() as BitcoinAddressTypeName;
    for (const address of deriveBitcoinAddressSetFromXpubs({ [type]: accountXpub }, network).addresses) own.add(address);
  }
  for (const utxo of utxos) if (utxo.address) own.add(utxo.address);
  return own;
}

/** The `toSignInputs` list from a request's options, `undefined` when it names none. */
function toSignInputsOf(options: unknown): unknown[] | 'invalid' | undefined {
  if (Array.isArray(options)) return options;
  if (options === undefined || options === null || typeof options !== 'object') return undefined;
  const list = (options as { toSignInputs?: unknown }).toSignInputs;
  if (list === undefined || list === null) return undefined;
  return Array.isArray(list) ? list : 'invalid';
}

function txidOf(psbt: bitcoin.Psbt, i: number): string {
  return Buffer.from(psbt.txInputs[i].hash).reverse().toString('hex');
}

/** The input's value from the PSBT's own previous-output data. */
function psbtInputValue(psbt: bitcoin.Psbt, i: number): bigint | null {
  const input = psbt.data.inputs[i];
  if (input.witnessUtxo) return BigInt(input.witnessUtxo.value);
  if (input.nonWitnessUtxo) {
    try {
      const prev = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
      // Only a previous transaction that hashes to the outpoint says anything.
      if (!prev.getHash().equals(psbt.txInputs[i].hash)) return null;
      const out = prev.outs[psbt.txInputs[i].index];
      return out ? BigInt(out.value) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function outputAddress(script: Buffer, network: bitcoin.Network): string | null {
  try {
    return bitcoin.address.fromOutputScript(script, network);
  } catch {
    return null;
  }
}

export function reviewBitcoinPsbt(psbtOrHex: string | bitcoin.Psbt, ctx: PsbtReviewContext): PsbtReview {
  const empty: PsbtReview = {
    inputs: [], outputs: [], signIndices: [], spentSats: 0n, receivedSats: 0n, netSats: 0n, feeSats: null, problems: [],
  };
  let psbt: bitcoin.Psbt;
  try {
    psbt = typeof psbtOrHex === 'string' ? parsePsbt(psbtOrHex, ctx.network) : psbtOrHex;
  } catch {
    return { ...empty, problems: [{ code: 'unparseable' }] };
  }
  const network = getBitcoinNetwork(ctx.network);
  const own = new Set(ctx.ownAddresses);
  const walletUtxos = new Map<string, bigint>();
  for (const utxo of ctx.ownUtxos ?? []) walletUtxos.set(`${utxo.txHash}:${utxo.index}`, BigInt(String(utxo.value)));
  const problems: PsbtReviewProblem[] = [];

  const inputs: PsbtReviewInput[] = psbt.data.inputs.map((_, i) => {
    const address = spentAddress(psbt, i, network) ?? null;
    const walletValue = walletUtxos.get(`${txidOf(psbt, i)}:${psbt.txInputs[i].index}`);
    return {
      index: i,
      address,
      valueSats: psbtInputValue(psbt, i),
      own: walletValue !== undefined || (address !== null && own.has(address)),
      willSign: false,
    };
  });

  const requested = toSignInputsOf(ctx.signOptions);
  let signIndices: number[];
  if (requested === 'invalid') {
    problems.push({ code: 'invalidToSignInputs' });
    signIndices = [];
  } else if (requested === undefined) {
    signIndices = inputs.filter((input) => input.own).map((input) => input.index);
  } else {
    const chosen = new Set<number>();
    for (const entry of requested) {
      const { index, address, sighashTypes } = (entry ?? {}) as { index?: unknown; address?: unknown; sighashTypes?: unknown };
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= inputs.length) {
        problems.push({ code: 'badIndex', index: typeof index === 'number' ? index : -1 });
        continue;
      }
      if (!inputs[index].own) {
        problems.push({ code: 'notOwn', index });
        continue;
      }
      if (address !== undefined && address !== inputs[index].address) {
        problems.push({ code: 'addressMismatch', index });
        continue;
      }
      if (sighashTypes !== undefined
        && (!Array.isArray(sighashTypes) || sighashTypes.some((t) => typeof t !== 'number' || !ALLOWED_SIGHASH_TYPES.has(t)))) {
        problems.push({ code: 'unsupportedSighash', index });
        continue;
      }
      chosen.add(index);
    }
    signIndices = [...chosen].sort((a, b) => a - b);
  }

  for (const i of signIndices) {
    const input = inputs[i];
    input.willSign = true;
    const declared = psbt.data.inputs[i].sighashType;
    if (declared !== undefined && !ALLOWED_SIGHASH_TYPES.has(declared)) problems.push({ code: 'unsupportedSighash', index: i });
    const walletValue = walletUtxos.get(`${txidOf(psbt, i)}:${psbt.txInputs[i].index}`);
    if (input.valueSats === null) {
      problems.push({ code: 'missingValue', index: i });
    } else if (walletValue !== undefined && walletValue !== input.valueSats) {
      problems.push({ code: 'valueMismatch', index: i });
    }
  }
  if (signIndices.length === 0 && !problems.length) problems.push({ code: 'nothingToSign' });

  const derived = ctx.derived ?? { receive: new Set<string>(), change: new Set<string>() };
  const outputs: PsbtReviewOutput[] = psbt.txOutputs.map((out, i) => {
    const address = outputAddress(out.script, network);
    const change = address !== null && derived.change.has(address);
    return { index: i, address, valueSats: BigInt(out.value), own: change || (address !== null && derived.receive.has(address)), change };
  });

  const spentSats = inputs.filter((input) => input.willSign).reduce((sum, input) => sum + (input.valueSats ?? 0n), 0n);
  const receivedSats = outputs.filter((out) => out.own).reduce((sum, out) => sum + out.valueSats, 0n);
  const totalOut = outputs.reduce((sum, out) => sum + out.valueSats, 0n);
  const feeSats = inputs.every((input) => input.valueSats !== null)
    ? inputs.reduce((sum, input) => sum + (input.valueSats as bigint), 0n) - totalOut
    : null;

  return { inputs, outputs, signIndices, spentSats, receivedSats, netSats: spentSats - receivedSats, feeSats, problems };
}

/** A sentence for a review problem; the views translate the same codes. */
export function describePsbtProblem(problem: PsbtReviewProblem): string {
  switch (problem.code) {
    case 'unparseable': return 'The PSBT could not be decoded';
    case 'invalidToSignInputs': return 'toSignInputs must be a list';
    case 'badIndex': return `toSignInputs names input ${problem.index}, which the PSBT does not have`;
    case 'notOwn': return `Input ${problem.index} does not spend from this wallet`;
    case 'addressMismatch': return `toSignInputs names another address for input ${problem.index}`;
    case 'unsupportedSighash': return `Input ${problem.index} asks for a sighash type other than ALL`;
    case 'missingValue': return `Input ${problem.index} carries no previous-output value`;
    case 'valueMismatch': return `Input ${problem.index} states a value that differs from the wallet's coin`;
    case 'nothingToSign': return 'No input of this PSBT spends from this wallet';
  }
}

/** Throws when the wallet must not sign this PSBT. */
export function assertPsbtSignable(review: PsbtReview): void {
  if (review.problems.length) throw new Error(describePsbtProblem(review.problems[0]));
}
