/**
 * Bitcoin Transaction Signer
 *
 * Signs Bitcoin PSBTs using private keys for software wallets.
 * Supports:
 * - Password-encrypted wallets
 * - PRF-encrypted wallets
 * - BIP32 key derivation (secp256k1)
 * - SegWit (P2WPKH) signing
 * - Multi-input signing
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { HDKey } from '@scure/bip32';
import * as bip39 from 'bip39';
import { decryptWithPassword } from '@/shared/utils/crypto';
import { getBitcoinNetwork } from './bitcoinPsbtBuilder';
import type { ISignedTx } from '@/chains/common/interfaces';

// Initialize ECC library for bitcoinjs-lib
bitcoin.initEccLib(ecc);

/**
 * Bitcoin derivation paths
 */
const BITCOIN_DERIVATION_PATHS = {
  BIP44_LEGACY: 44,    // P2PKH (1...)
  BIP84_SEGWIT: 84,    // P2WPKH (bc1q...) - DEFAULT
  BIP86_TAPROOT: 86,   // P2TR (bc1p...)
};

/**
 * Get BIP32 derivation purpose based on address type
 */
function getDerivationPurpose(addressType: string): number {
  switch (addressType.toLowerCase()) {
    case 'legacy':
      return BITCOIN_DERIVATION_PATHS.BIP44_LEGACY;
    case 'taproot':
      return BITCOIN_DERIVATION_PATHS.BIP86_TAPROOT;
    case 'segwit':
    default:
      return BITCOIN_DERIVATION_PATHS.BIP84_SEGWIT;
  }
}

/**
 * Derive Bitcoin root key from mnemonic
 */
function deriveBitcoinRootKey(mnemonic: string): HDKey {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  return HDKey.fromMasterSeed(seed);
}

/**
 * Derive Bitcoin account key from mnemonic
 * Path: m/purpose'/coin'/account'
 */
function deriveAccountKey(
  mnemonic: string,
  network: string,
  addressType: string = 'segwit',
  accountIndex: number = 0
): HDKey {
  const rootKey = deriveBitcoinRootKey(mnemonic);
  const purpose = getDerivationPurpose(addressType);
  const coinType = network.toLowerCase() === 'mainnet' ? 0 : 1; // 0 for mainnet, 1 for testnet

  // Derive account key: m/purpose'/coinType'/account'
  const path = `m/${purpose}'/${coinType}'/${accountIndex}'`;
  return rootKey.derive(path);
}

/**
 * Derive signing key for a specific address index
 * Path: m/purpose'/coin'/account'/chain/index
 */
function deriveSigningKey(
  accountKey: HDKey,
  chain: number = 0,  // 0 = external (receive), 1 = internal (change)
  index: number = 0
): HDKey {
  const path = `m/${chain}/${index}`;
  return accountKey.derive(path);
}

/**
 * Sign PSBT with private key (software wallet)
 *
 * @param psbt PSBT to sign (hex or base64 string, or PSBT object)
 * @param mnemonic BIP39 mnemonic phrase
 * @param network Bitcoin network (Mainnet/Testnet)
 * @param addressType Address type (segwit/legacy/taproot)
 * @param accountIndex BIP32 account index (default: 0)
 * @returns Signed PSBT
 */
export function signPsbtWithMnemonic(
  psbt: string | bitcoin.Psbt,
  mnemonic: string,
  network: string,
  addressType: string = 'segwit',
  accountIndex: number = 0
): bitcoin.Psbt {
  const bitcoinNetwork = getBitcoinNetwork(network);

  // Parse PSBT if string
  let psbtObj: bitcoin.Psbt;
  if (typeof psbt === 'string') {
    try {
      // Try hex first
      psbtObj = bitcoin.Psbt.fromHex(psbt, { network: bitcoinNetwork });
    } catch {
      // Try base64
      psbtObj = bitcoin.Psbt.fromBase64(psbt, { network: bitcoinNetwork });
    }
  } else {
    psbtObj = psbt;
  }

  // Derive account key
  const accountKey = deriveAccountKey(mnemonic, network, addressType, accountIndex);

  // Sign all inputs
  const inputCount = psbtObj.data.inputs.length;

  for (let i = 0; i < inputCount; i++) {
    try {
      // Derive signing key using bip32Derivation metadata if available,
      // otherwise fall back to external chain (0) with index 0
      let chain = 0;
      let index = 0;
      const bip32Deriv = psbtObj.data.inputs[i].bip32Derivation;
      if (bip32Deriv && bip32Deriv.length > 0) {
        // Parse chain and index from the path (e.g. "m/0/3" or "m/1/7")
        const pathParts = bip32Deriv[0].path.split('/');
        if (pathParts.length >= 3) {
          chain = parseInt(pathParts[pathParts.length - 2], 10);
          index = parseInt(pathParts[pathParts.length - 1], 10);
        }
      }
      const signingKey = deriveSigningKey(accountKey, chain, index);

      // Create signer object compatible with bitcoinjs-lib
      const signer = {
        publicKey: Buffer.from(signingKey.publicKey!),
        sign: (hash: Buffer) => {
          return Buffer.from(ecc.sign(hash, signingKey.privateKey!));
        },
      };

      // Sign input with private key
      psbtObj.signInput(i, signer);

      // Validate signature — bitcoinjs-lib calls validator(pubkey, msghash, sig)
      // but tiny-secp256k1 expects verify(hash, pubkey, sig), so wrap to reorder args
      try {
        const isValid = psbtObj.validateSignaturesOfInput(i, (pubkey, msghash, sig) =>
          ecc.verify(msghash, pubkey, sig)
        );
        if (!isValid) {
          console.warn(`Warning: Signature validation failed for input ${i}`);
        }
      } catch (validationError) {
        // Validation failure is non-fatal — the input was already signed
        console.warn(`Signature validation threw for input ${i}:`, validationError);
      }
    } catch (error) {
      console.error(`Failed to sign input ${i}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to sign input ${i}: ${errorMessage}`);
    }
  }

  return psbtObj;
}

/**
 * Sign PSBT and finalize to create broadcast-ready transaction
 *
 * @param psbt PSBT to sign
 * @param mnemonic BIP39 mnemonic phrase
 * @param network Bitcoin network
 * @param addressType Address type
 * @param accountIndex Account index
 * @returns Signed transaction with hex and txid
 */
export function signAndFinalizePsbt(
  psbt: string | bitcoin.Psbt,
  mnemonic: string,
  network: string,
  addressType: string = 'segwit',
  accountIndex: number = 0
): ISignedTx {
  // Sign PSBT
  const signedPsbt = signPsbtWithMnemonic(psbt, mnemonic, network, addressType, accountIndex);

  // Finalize all inputs (add witness data)
  signedPsbt.finalizeAllInputs();

  // Extract final transaction
  const tx = signedPsbt.extractTransaction();
  const txHex = tx.toHex();
  const txId = tx.getId();

  return {
    raw: {
      psbt: signedPsbt,
      tx,
    },
    id: txId,
    hex: txHex,
  };
}

/**
 * Sign PSBT with encrypted private key (password-based)
 *
 * @param psbt PSBT to sign
 * @param encryptedMnemonic Encrypted mnemonic phrase
 * @param password Wallet password
 * @param network Bitcoin network
 * @param addressType Address type
 * @param accountIndex Account index
 * @returns Signed PSBT
 */
export function signPsbtWithPassword(
  psbt: string | bitcoin.Psbt,
  encryptedMnemonic: string,
  password: string,
  network: string,
  addressType: string = 'segwit',
  accountIndex: number = 0
): bitcoin.Psbt {
  try {
    // Decrypt mnemonic with password
    const decryptedBuffer = decryptWithPassword(password, encryptedMnemonic);
    const mnemonic = Buffer.from(decryptedBuffer).toString('utf8');

    // Validate mnemonic
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase after decryption');
    }

    // Sign PSBT with decrypted mnemonic
    return signPsbtWithMnemonic(psbt, mnemonic, network, addressType, accountIndex);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Invalid mnemonic')) {
      throw error;
    }
    throw new Error('Failed to decrypt mnemonic. Incorrect password?');
  }
}

/**
 * Sign PSBT with PRF-encrypted mnemonic
 *
 * @param psbt PSBT to sign
 * @param prfEncryptedMnemonic PRF-encrypted mnemonic phrase (hex)
 * @param prfSecret PRF output bytes (from WebAuthn)
 * @param credentialId Base64-encoded credential ID (must match encryption)
 * @param walletId Wallet ID for key derivation (must match encryption)
 * @param network Bitcoin network
 * @param addressType Address type
 * @param accountIndex Account index
 * @returns Signed PSBT
 */
export async function signPsbtWithPrf(
  psbt: string | bitcoin.Psbt,
  prfEncryptedMnemonic: string,
  prfSecret: Uint8Array,
  credentialId: string,
  walletId: string,
  network: string,
  addressType: string = 'segwit',
  accountIndex: number = 0
): Promise<bitcoin.Psbt> {
  // Import PRF decryption utility
  const { decryptMnemonicWithPrfOutput } = await import('@/shared/utils/webauthn-prf');

  try {
    // Decrypt mnemonic with PRF output
    const mnemonic = await decryptMnemonicWithPrfOutput(prfEncryptedMnemonic, prfSecret, credentialId, walletId);

    // Validate mnemonic
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase after PRF decryption');
    }

    // Sign PSBT with decrypted mnemonic
    return signPsbtWithMnemonic(psbt, mnemonic, network, addressType, accountIndex);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Invalid mnemonic')) {
      throw error;
    }
    throw new Error('Failed to decrypt mnemonic with PRF secret');
  }
}

/**
 * Verify PSBT signatures without finalizing
 *
 * @param psbt Signed PSBT
 * @returns Validation result for each input
 */
export function verifyPsbtSignatures(psbt: bitcoin.Psbt): {
  allValid: boolean;
  inputResults: Array<{ index: number; valid: boolean }>;
} {
  const inputCount = psbt.data.inputs.length;
  const results: Array<{ index: number; valid: boolean }> = [];
  let allValid = true;

  for (let i = 0; i < inputCount; i++) {
    try {
      const isValid = psbt.validateSignaturesOfInput(i, ecc.verifySchnorr || ecc.verify);
      results.push({ index: i, valid: isValid });

      if (!isValid) {
        allValid = false;
      }
    } catch (error) {
      console.error(`Failed to validate input ${i}:`, error);
      results.push({ index: i, valid: false });
      allValid = false;
    }
  }

  return { allValid, inputResults: results };
}

/**
 * Extract transaction details from signed PSBT
 *
 * @param signedPsbt Finalized PSBT
 * @returns Transaction details
 */
export function extractSignedTransaction(signedPsbt: bitcoin.Psbt): {
  txId: string;
  txHex: string;
  size: number;
  weight: number;
  vsize: number;
} {
  const tx = signedPsbt.extractTransaction();

  return {
    txId: tx.getId(),
    txHex: tx.toHex(),
    size: tx.byteLength(),
    weight: tx.weight(),
    vsize: tx.virtualSize(),
  };
}

/**
 * Sign multiple PSBTs in batch (for multi-transaction operations)
 *
 * @param psbts Array of PSBTs to sign
 * @param mnemonic BIP39 mnemonic phrase
 * @param network Bitcoin network
 * @param addressType Address type
 * @param accountIndex Account index
 * @returns Array of signed PSBTs
 */
export function signMultiplePsbts(
  psbts: Array<string | bitcoin.Psbt>,
  mnemonic: string,
  network: string,
  addressType: string = 'segwit',
  accountIndex: number = 0
): bitcoin.Psbt[] {
  return psbts.map((psbt, index) => {
    try {
      return signPsbtWithMnemonic(psbt, mnemonic, network, addressType, accountIndex);
    } catch (error) {
      console.error(`Failed to sign PSBT ${index}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to sign PSBT ${index}: ${errorMessage}`);
    }
  });
}

/**
 * Check if PSBT is fully signed and ready for finalization
 *
 * @param psbt PSBT to check
 * @returns True if all inputs are signed
 */
export function isPsbtFullySigned(psbt: bitcoin.Psbt): boolean {
  const inputCount = psbt.data.inputs.length;

  for (let i = 0; i < inputCount; i++) {
    const input = psbt.data.inputs[i];

    // Check if input has signatures
    const hasPartialSigs = input.partialSig && input.partialSig.length > 0;
    const hasFinalScriptSig = input.finalScriptSig && input.finalScriptSig.length > 0;
    const hasFinalScriptWitness = input.finalScriptWitness && input.finalScriptWitness.length > 0;

    if (!hasPartialSigs && !hasFinalScriptSig && !hasFinalScriptWitness) {
      return false; // Input not signed
    }
  }

  return true;
}
