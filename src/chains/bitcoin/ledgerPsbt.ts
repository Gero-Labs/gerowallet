/**
 * What the Ledger Bitcoin app needs to sign a wallet's PSBT, and how its answer is
 * read back (issue 1324).
 *
 * hw-app-btc's `signPsbtBuffer` signs the inputs the device recognises as the
 * account's own: by their BIP32 derivation, or, for a PSBT that names none (one a
 * dApp built), by looking each input's script up in the wallet's known addresses.
 * It answers with a PSBT v2, which bitcoinjs-lib cannot parse, so the device's
 * signatures are copied back into the PSBT the user approved.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { HDKey } from '@scure/bip32';
import type { AddressFormat } from '@ledgerhq/hw-app-btc/lib/getWalletPublicKey';
import type { KnownAddressDerivationsMap, SignPsbtBufferOptions } from '@ledgerhq/hw-app-btc/lib/signPsbt/types';
import { pathStringToArray } from '@ledgerhq/hw-app-btc/lib/bip32';
import { deserializePsbt } from '@ledgerhq/hw-app-btc/lib/signPsbt/parsePsbt';
import { bitcoinAccountPath, DEFAULT_BITCOIN_GAP_LIMIT } from './bitcoinKeyManager';
import { getBitcoinNetwork } from './bitcoinPsbtBuilder';

/** The Ledger Bitcoin account that signs: its xpub and where the device derives it. */
export interface LedgerBitcoinAccount {
  xpub: string;
  network: string;
  addressType?: string;
  accountIndex: number;
}

/** BIP174 PSBT_IN_PARTIAL_SIG: keyed by the signing public key. */
const PSBT_IN_PARTIAL_SIG = 0x02;

/** The device's name for the wallet's address type. */
export function ledgerAddressFormat(addressType = 'segwit'): AddressFormat {
  switch (addressType) {
    case 'legacy': return 'legacy';
    case 'taproot': return 'bech32m';
    case 'segwit': return 'bech32';
    default: throw new Error(`Unknown address type: ${addressType}`);
  }
}

/** The hash a script names its owner by, as hw-app-btc keys its address lookup. */
function scriptHash(pubkey: Buffer, addressType: string): Buffer {
  switch (addressType) {
    case 'legacy': return bitcoin.payments.p2pkh({ pubkey }).hash!;
    // A Taproot script names its tweaked output key, not a hash.
    case 'taproot': return bitcoin.payments.p2tr({ internalPubkey: pubkey.subarray(1, 33) }).pubkey!;
    case 'segwit': return bitcoin.payments.p2wpkh({ pubkey }).hash!;
    default: throw new Error(`Unknown address type: ${addressType}`);
  }
}

/**
 * The account's receive and change addresses the wallet watches, by the hash their
 * script names, each with its public key and full path.
 */
export function ledgerKnownAddressDerivations(
  account: LedgerBitcoinAccount,
  gapLimit: number = DEFAULT_BITCOIN_GAP_LIMIT,
): KnownAddressDerivationsMap {
  const addressType = account.addressType || 'segwit';
  const accountPath = pathStringToArray(bitcoinAccountPath(account.network, addressType, account.accountIndex));
  const accountNode = HDKey.fromExtendedKey(account.xpub);
  const known: KnownAddressDerivationsMap = new Map();
  for (const chain of [0, 1]) {
    for (let index = 0; index < gapLimit; index++) {
      const child = accountNode.derive(`m/${chain}/${index}`);
      if (!child.publicKey) throw new Error('Failed to derive public key');
      const pubkey = Buffer.from(child.publicKey);
      known.set(scriptHash(pubkey, addressType).toString('hex'), { pubkey, path: [...accountPath, chain, index] });
    }
  }
  return known;
}

/** The `signPsbtBuffer` options for the account: sign, never finalize. */
export function ledgerSignPsbtOptions(account: LedgerBitcoinAccount): SignPsbtBufferOptions {
  const addressType = account.addressType || 'segwit';
  return {
    finalizePsbt: false,
    accountPath: bitcoinAccountPath(account.network, addressType, account.accountIndex),
    addressFormat: ledgerAddressFormat(addressType),
    knownAddressDerivations: ledgerKnownAddressDerivations(account),
  };
}

/** A PSBT given as hex or base64. */
export function parseBitcoinPsbt(value: string, network: string): bitcoin.Psbt {
  const opts = { network: getBitcoinNetwork(network) };
  return /^[\da-f]+$/i.test(value) ? bitcoin.Psbt.fromHex(value, opts) : bitcoin.Psbt.fromBase64(value, opts);
}

/**
 * Copies the signatures in the device's signed PSBT (v0 or v2) into `psbt`, the one
 * the user approved, and returns it. Fails when the device signed nothing.
 */
export function mergeLedgerSignatures(psbt: bitcoin.Psbt, signedPsbt: Buffer): bitcoin.Psbt {
  const signed = deserializePsbt(signedPsbt);
  if (signed.getGlobalInputCount() !== psbt.inputCount) {
    throw new Error('Device response does not match the approved Bitcoin transaction');
  }
  let added = 0;
  psbt.data.inputs.forEach((input, i) => {
    const partialSig = signed.getInputKeyDatas(i, PSBT_IN_PARTIAL_SIG)
      .filter((pubkey) => !input.partialSig?.some((sig) => sig.pubkey.equals(pubkey)))
      .map((pubkey) => ({ pubkey, signature: signed.getInputPartialSig(i, pubkey)! }));
    const tapKeySig = input.tapKeySig ? undefined : signed.getInputTapKeySig(i);
    if (partialSig.length) psbt.updateInput(i, { partialSig });
    if (tapKeySig) psbt.updateInput(i, { tapKeySig });
    added += partialSig.length + (tapKeySig ? 1 : 0);
  });
  if (!added) throw new Error('The Ledger did not sign any input of this transaction');
  return psbt;
}
