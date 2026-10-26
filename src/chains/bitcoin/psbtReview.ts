import { Psbt, Transaction, address as btcAddress, networks } from 'bitcoinjs-lib';
import { Network } from '@/models/types';

/**
 * What a dApp's PSBT does, for the approval screens: every output with whose
 * it is, what leaves the wallet and the fee. Display only: signing never reads
 * this.
 *
 * An output to an address the wallet does not recognise counts as leaving it,
 * so an incomplete address set can only overstate what the user pays.
 */

export type PsbtOutputOwner = 'external' | 'own' | 'change';

export interface PsbtReviewOutput {
  /** null for a data (OP_RETURN) or non-standard output. */
  address: string | null;
  /** Satoshis. */
  value: number;
  owner: PsbtOutputOwner;
}

export interface PsbtReview {
  inputCount: number;
  outputs: PsbtReviewOutput[];
  /** Satoshis paid to outputs that are not the wallet's. */
  sending: number;
  /**
   * Inputs minus outputs, in satoshis. null when an input does not carry the
   * output it spends, or when the known inputs cover less than the outputs (a
   * partial PSBT that others complete after this signature).
   */
  fee: number | null;
}

export interface OwnBitcoinAddresses {
  receive: ReadonlySet<string>;
  change: ReadonlySet<string>;
}

/** A PSBT as dApps send it: hex, or base64. */
export function parsePsbt(value: string): Psbt {
  return /^[\da-f]+$/i.test(value) ? Psbt.fromHex(value) : Psbt.fromBase64(value);
}

/** The value of the output input `index` spends, when the PSBT carries it. */
function inputValue(psbt: Psbt, index: number): number | null {
  const input = psbt.data.inputs[index];
  if (input.witnessUtxo) return input.witnessUtxo.value;
  if (input.nonWitnessUtxo) {
    const previous = Transaction.fromBuffer(input.nonWitnessUtxo);
    return previous.outs[psbt.txInputs[index].index]?.value ?? null;
  }
  return null;
}

export function reviewPsbt(value: string, network: string, own: OwnBitcoinAddresses): PsbtReview {
  const psbt = parsePsbt(value);
  // Bitcoin's testnet is testnet4, which shares testnet's address prefixes.
  const bitcoinNetwork = network === Network.TESTNET ? networks.testnet : networks.bitcoin;

  const outputs: PsbtReviewOutput[] = psbt.txOutputs.map((output) => {
    let address: string | null = null;
    try {
      address = btcAddress.fromOutputScript(output.script, bitcoinNetwork);
    } catch {
      // OP_RETURN or a script with no address form
    }
    const owner: PsbtOutputOwner = address && own.change.has(address)
      ? 'change'
      : address && own.receive.has(address) ? 'own' : 'external';
    return { address, value: output.value, owner };
  });

  const totalOut = outputs.reduce((sum, output) => sum + output.value, 0);
  const sending = outputs
    .filter((output) => output.owner === 'external')
    .reduce((sum, output) => sum + output.value, 0);

  const inputValues = psbt.txInputs.map((_input, index) => inputValue(psbt, index));
  const totalIn = inputValues.every((inValue): inValue is number => inValue !== null)
    ? inputValues.reduce((sum, inValue) => sum + inValue, 0)
    : null;
  const fee = totalIn !== null && totalIn >= totalOut ? totalIn - totalOut : null;

  return { inputCount: psbt.txInputs.length, outputs, sending, fee };
}
