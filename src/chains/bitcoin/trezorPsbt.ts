/**
 * What Trezor Connect needs to sign a wallet's PSBT, and how its answer is read back
 * (issue 1325).
 *
 * `TrezorConnect.signTransaction` takes no PSBT: it takes the transaction's inputs and
 * outputs, each input with the full path of the key that spends it. The paths come
 * from the wallet's own addresses, derived from its account xpub. An output to one of
 * its change addresses is named by path too, so the device recognises it as change
 * rather than a payment. Connect fetches the previous transactions it needs itself.
 *
 * The device answers with the signed transaction. Once it is the approved one, its
 * signatures are copied into the PSBT the user approved.
 */

import * as bitcoin from 'bitcoinjs-lib';
import type { Params, SignTransaction } from '@trezor/connect';
import {
  bitcoinAccountPath,
  deriveBitcoinAddressSetFromXpubs,
  type BitcoinAddressTypeName,
  type BitcoinHardwareAccount,
} from './bitcoinKeyManager';
import { getBitcoinNetwork, spentAddress } from './bitcoinPsbtBuilder';
import { trezorCoin } from './bitcoinPaths';

export { parseBitcoinPsbt } from './bitcoinPsbtBuilder';

type TrezorInput = SignTransaction['inputs'][number];
type TrezorOutput = SignTransaction['outputs'][number];

/** The device's script types for the wallet's address type: spending from it, and paying change to it. */
const SCRIPT_TYPES = {
  legacy: { spend: 'SPENDADDRESS', change: 'PAYTOADDRESS' },
  segwit: { spend: 'SPENDWITNESS', change: 'PAYTOWITNESS' },
  taproot: { spend: 'SPENDTAPROOT', change: 'PAYTOTAPROOT' },
} as const satisfies Record<BitcoinAddressTypeName, object>;

/** The `TrezorConnect.signTransaction` request for `psbt`, which may spend only the account's own coins. */
export function trezorSignTransactionParams(psbt: bitcoin.Psbt, account: BitcoinHardwareAccount): Params<SignTransaction> {
  const addressType = (account.addressType || 'segwit') as BitcoinAddressTypeName;
  const scriptTypes = SCRIPT_TYPES[addressType];
  if (!scriptTypes) throw new Error(`Unknown address type: ${addressType}`);
  const network = getBitcoinNetwork(account.network);
  const accountPath = bitcoinAccountPath(account.network, addressType, account.accountIndex);
  const own = deriveBitcoinAddressSetFromXpubs({ [addressType]: account.xpub }, account.network).derivationMap;
  const pathOf = (address: string) => `${accountPath}/${own[address].chain}/${own[address].index}`;

  const inputs = psbt.txInputs.map((txInput, i): TrezorInput => {
    const address = spentAddress(psbt, i, network);
    if (!address || !own[address]) throw new Error(`Input ${i} does not spend a coin of this wallet, which Trezor cannot sign`);
    const { witnessUtxo, nonWitnessUtxo } = psbt.data.inputs[i];
    const amount = witnessUtxo?.value ?? bitcoin.Transaction.fromBuffer(nonWitnessUtxo!).outs[txInput.index].value;
    return {
      address_n: pathOf(address),
      prev_hash: Buffer.from(txInput.hash).reverse().toString('hex'),
      prev_index: txInput.index,
      amount: String(amount),
      sequence: txInput.sequence,
      script_type: scriptTypes.spend,
    };
  });

  const outputs = psbt.txOutputs.map(({ script, value, address }, i): TrezorOutput => {
    if (script[0] === bitcoin.opcodes['OP_RETURN']) {
      const [data] = bitcoin.payments.embed({ output: script }).data ?? [];
      return { script_type: 'PAYTOOPRETURN', amount: '0', op_return_data: data ? data.toString('hex') : '' };
    }
    if (!address) throw new Error(`Output ${i} pays a script Trezor cannot show`);
    if (own[address]?.chain === 1) return { address_n: pathOf(address), amount: String(value), script_type: scriptTypes.change };
    return { address, amount: String(value), script_type: 'PAYTOADDRESS' };
  });

  return {
    coin: trezorCoin(account.network),
    inputs,
    outputs,
    version: psbt.version,
    locktime: psbt.locktime,
    serialize: true,
  };
}

/**
 * Copies the signatures in the device's signed transaction into `psbt`, the one the
 * user approved, and returns it. Fails when the device signed another transaction or
 * left an input unsigned.
 */
export function mergeTrezorSignatures(psbt: bitcoin.Psbt, serializedTx: string): bitcoin.Psbt {
  const signed = bitcoin.Transaction.fromHex(serializedTx);
  const unsigned = signed.clone();
  unsigned.ins.forEach((input) => { input.script = Buffer.alloc(0); input.witness = []; });
  if (!unsigned.toBuffer().equals(psbt.data.globalMap.unsignedTx.toBuffer())) {
    throw new Error('Device response does not match the approved Bitcoin transaction');
  }
  signed.ins.forEach(({ witness, script }, i) => {
    // A Taproot key-path witness is the signature alone.
    if (witness.length === 1) {
      psbt.updateInput(i, { tapKeySig: witness[0] });
      return;
    }
    // A segwit witness, like a legacy scriptSig, is <signature> <pubkey>.
    const [signature, pubkey] = witness.length ? witness : (bitcoin.script.decompile(script) ?? []);
    if (!Buffer.isBuffer(signature) || !Buffer.isBuffer(pubkey)) throw new Error(`The Trezor did not sign input ${i}`);
    psbt.updateInput(i, { partialSig: [{ pubkey, signature }] });
  });
  return psbt;
}
