import { Keys, purpose } from '@/models/types';
import {
  CardanoSignature, CardanoSignDataSignature,
  Curve,
  KeystoneSDK,
  UR,
  UREncoder,
} from '@keystonehq/keystone-sdk';
import { CryptoKeypath, DerivationAlgorithm, PathComponent } from '@keystonehq/bc-ur-registry-cardano';
import { Options } from 'qr-code-styling/lib/types';
import logo128Url from '@/assets/img/bkp/logo128.png';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { createBuilderWithSigStructure, createCoseKeyHex, toHexArray, buildAndSignData } from '@/shared/utils/converter';
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { debugLog } from '@/utils/debug';

const sdk: KeystoneSDK = new KeystoneSDK();

/**
 * Parses a BIP32 path string into an array of indices and hardened flags
 * @param pathStr - BIP32 path string (e.g., "m/1852'/1815'/0'/0/0")
 * @returns Array of { index: number, hardened: boolean }
 */
const parsePathString = (pathStr: string): Array<{ index: number; hardened: boolean }> => {
  // Remove 'm/' prefix if present
  const cleanPath = pathStr.startsWith('m/') ? pathStr.slice(2) : pathStr;

  // Split path into components
  const pathParts = cleanPath.split('/').filter(p => p.length > 0);

  return pathParts.map((part) => {
    // Check if hardened (ends with ')
    const hardened = part.endsWith("'");
    const indexStr = hardened ? part.slice(0, -1) : part;
    const index = parseInt(indexStr, 10);

    return { index, hardened };
  });
};

/**
 * Creates a CryptoKeypath object from a BIP32 path string
 * @param pathStr - BIP32 path string (e.g., "m/1852'/1815'/0'/0/0")
 * @param xfp - Master fingerprint as hex string
 * @returns CryptoKeypath object
 */
const createCryptoKeypath = (pathStr: string, xfp: string): CryptoKeypath => {
  const parsedPath = parsePathString(pathStr);
  const components: PathComponent[] = [];

  parsedPath.forEach(({ index, hardened }) => {
    components.push(new PathComponent({ index, hardened }));
  });

  // Convert xfp hex string to Buffer (4 bytes)
  const sourceFingerprint = xfp ? Buffer.from(xfp, 'hex') : undefined;

  return new CryptoKeypath(components, sourceFingerprint);
};

export const getKeystonePublicKeyUR = (accPurpose = purpose.hdwallet, accIndex = 0): Options => {
  const ur: UR = sdk.generateKeyDerivationCall({ schemas: [ { path: `m/${accPurpose}'/1815'/${accIndex}'`, curve: Curve.ed25519, algo: DerivationAlgorithm.bip32ed25519 } ], origin: 'gerowallet' })
  return qrCodeOptions(UREncoder.encodeSinglePart(ur), 190)
}

export const parseSignature = (ur: UR): CardanoSignature => {
  return sdk.cardano.parseSignature(ur);
}

/**
 * Creates a Keystone CIP-8 data signing request using COSE Signature1 structure
 * @param address - The Cardano address that will sign the data (bech32)
 * @param payloadHex - The hex-encoded message payload to sign
 * @param xfp - Extended fingerprint from wallet
 * @param xpub - Extended public key (64 bytes hex)
 * @param addressPath - Derivation path for the signing address
 * @returns Object with UR for QR code generation, builder to reuse when parsing response, and addressBytes
 */
export const createKeystoneDataSignRequest = (address: string, payloadHex: string, xfp: string, xpub: string, addressPath: string): { ur: UR; builder; addressBytes: Uint8Array } => {
  // Decode address to get raw bytes - handle both hex and bech32 formats
  let addressBytes: Uint8Array;
  if (address.startsWith('addr') || address.startsWith('stake')) {
    addressBytes = toHexArray(Cardano.Address.fromBech32(address).toBytes());
  } else {
    addressBytes = toHexArray(Cardano.Address.fromBytes(address).toBytes());
  }

  // Create COSE Sign1 builder and extract Sig_structure bytes (all CSL operations in converter.ts)
  const { builder, sigStrucBytes } = createBuilderWithSigStructure(addressBytes, payloadHex);

  const signDataRequest = {
    requestId: crypto.randomUUID().toString(),
    path: addressPath,
    xfp,
    xpub: xpub.substring(0, 64),
    payload: sigStrucBytes,
    origin: 'gerowallet'
  };

  return {
    ur: sdk.cardano.generateSignDataRequest(signDataRequest),
    builder,
    addressBytes
  };
}

/**
 * Parses a Keystone CIP-8 data signature response and builds COSE structures
 * @param ur - The UR object from Keystone scanner
 * @param builder - The builder object created during the signing request (opaque)
 * @param addressBytes - The address bytes (for COSE_Key construction)
 * @returns Object with COSE_Sign1 signature and COSE_Key in hex format
 */
export const parseDataSignature = (ur: UR, builder, addressBytes: Uint8Array): { signature: string; key: string } => {
  const keystoneSign: CardanoSignDataSignature = sdk.cardano.parseSignDataSignature(ur);

  // Build COSE_Sign1 using the builder with Keystone's raw signature (frees builder internally)
  const signatureHex = buildAndSignData(builder, toHexArray(keystoneSign.signature), undefined);

  // Build COSE_Key from address bytes and public key (all CSL operations in converter.ts)
  const keyHex = createCoseKeyHex(addressBytes, keystoneSign.publicKey);

  return {
    signature: signatureHex,
    key: keyHex
  };
}

/**
 * Helper function to get owned keypaths and addresses for hash-based signing
 */
const getOwnedKeyAddressList = (xfp: string, keys: Keys, tx: Serialization.Transaction, utxos: Cardano.Utxo[]) => {
  const ownedKeypathList: CryptoKeypath[] = [];
  const ownedAddressList: string[] = [];
  const addedPaths = new Set<string>(); // Track added paths to avoid duplicates

  const inputs = tx.body().inputs().values();

  inputs.forEach((input: Serialization.TransactionInput) => {
    const inputTxHash = input.transactionId();
    const inputTxIndex = input.index();

    const utxo = utxos.find((utxo: Cardano.Utxo) => {
      const [txIn, _txOut] = utxo;
      return inputTxHash === txIn.txId && Number(inputTxIndex) === txIn.index;
    });

    if (utxo) {
      const [txIn, txOut] = utxo;
      const address = txIn.address || txOut.address;
      const foundKey = keys.payment.find(k => k.address === address)
                    || keys.change.find(k => k.address === address);

      if (foundKey && !addedPaths.has(foundKey.path)) {
        ownedKeypathList.push(createCryptoKeypath(foundKey.path, xfp));
        ownedAddressList.push(foundKey.address);
        addedPaths.add(foundKey.path);
      }
    }
  });

  // Also check for stake key if there are certificates or withdrawals
  const txCore = tx.toCore();
  if ((txCore.body.certificates && txCore.body.certificates.length > 0) ||
      (txCore.body.withdrawals && txCore.body.withdrawals.length > 0)) {
    const stakeKey = keys.stake[0];
    if (stakeKey && !addedPaths.has(stakeKey.path)) {
      ownedKeypathList.push(createCryptoKeypath(stakeKey.path, xfp));
      ownedAddressList.push(stakeKey.address);
      addedPaths.add(stakeKey.path);
    }
  }

  return { ownedKeypathList, ownedAddressList };
};

export interface KeystoneSignRequestResponse {
  ur: UR,
  useHash: boolean,
  txHash?: string
}

/**
 * Creates a Keystone signing request from a transaction
 * @param tx - The transaction to sign (Serialization.Transaction)
 * @param walletData - Wallet data containing xfp and stakeAddress
 * @param utxos - Array of UTXOs for input resolution
 * @param keys - keys mapping for derivation paths
 * @returns UR object with type and cbor properties for QR code generation
 */
export const createKeystoneSignRequest = (tx: Serialization.Transaction, walletData, utxos: Cardano.Utxo[], keys: Keys): KeystoneSignRequestResponse => {
  const getOwnedUtxos = (txInputs: readonly Serialization.TransactionInput[], xfp: string) => {
    const keystoneUtxos = [];
    const extraSigners = [];

    txInputs.forEach((input: Serialization.TransactionInput) => {
      const inputTxHash = input.transactionId();
      const inputTxIndex = input.index();

      const utxo = utxos.find((utxo: Cardano.Utxo) => {
        // Cardano.Utxo is [TxIn, TxOut]
        const [txIn, _txOut] = utxo;
        const hashMatch = inputTxHash === txIn.txId;
        const indexMatch = Number(inputTxIndex) === txIn.index;  // Convert BigInt to Number
        return hashMatch && indexMatch;
      });

      if (utxo) {
        const [txIn, txOut] = utxo;
        const address = txIn.address || txOut.address;
        const foundKey = keys.payment.find(k => k.address === address)
                      || keys.change.find(k => k.address === address);

        keystoneUtxos.push({
          transactionHash: txIn.txId,
          index: txIn.index,
          amount: String(txOut.value.coins), // Convert BigInt to string
          xfp,
          hdPath: foundKey?.path || '',
          address,
        });
      }
    });

    // Convert Serialization.Transaction to Core Cardano.Tx to get proper certificate types
    const txCore = tx.toCore();

    // Check for required signers (used by DEX transactions and other contracts)
    const requiredSigners = txCore.body.requiredExtraSignatures;
    if (requiredSigners && requiredSigners.length > 0) {
      debugLog('[Keystone] Found required signers:', requiredSigners.length);

      // For each required signer, check if it's our stake key
      requiredSigners.forEach((keyHash: Ed25519KeyHashHex) => {
        debugLog('[Keystone] Required signer key hash:', keyHash);

        // Check if this matches our stake key hash
        const stakeKey = keys.stake[0];
        if (stakeKey) {
          // We need to compare the key hash from the transaction with our stake key hash
          // The stake key path is typically m/1852'/1815'/0'/2/0
          extraSigners.push({
            keyHash: keyHash,
            xfp,
            keyPath: stakeKey.path
          });
          debugLog('[Keystone] Added stake key to extraSigners:', stakeKey.path);
        }
      });
    }

    // Also check for certificates and withdrawals (for staking operations)
    if ((txCore.body.certificates && txCore.body.certificates.length > 0) || (txCore.body.withdrawals && txCore.body.withdrawals.length > 0)) {
      const credsNeeded = new Set<Cardano.Credential>();
      if (txCore.body.certificates) {
        txCore.body.certificates.forEach((cert: Cardano.Certificate) => {
          // Check if certificate has stakeCredential property (all stake-related certs do)
          if ('stakeCredential' in cert && cert.stakeCredential) {
            credsNeeded.add(cert.stakeCredential);
          }
        })
      }
      if (txCore.body.withdrawals && txCore.body.withdrawals.length > 0) {
        txCore.body.withdrawals.forEach((withdrawal: Cardano.Withdrawal) => {
          if (withdrawal.stakeAddress === walletData.stakeAddress) {
            const keyAddress = Cardano.Address.fromBech32(walletData.stakeAddress);
            credsNeeded.add(Cardano.BaseAddress.fromAddress(keyAddress).getStakeCredential())
          }
        })
      }
      credsNeeded.forEach((cred) => {
        extraSigners.push({
          keyHash: cred.hash,
          xfp,
          keyPath: keys.stake[0]?.path || ''
        });
      })
    }
    return {keystoneUtxos, extraSigners}
  }

  const xfp = walletData.xfp ?? "";
  const txCborHex = tx.toCbor();
  const cborBuffer = Buffer.from(txCborHex, 'hex');

  // Check if we should sign the hash or full transaction (for multi-sig/script transactions)
  const useHash = sdk.cardano.checkNeedSignTxHash(cborBuffer);
  debugLog('[Keystone] checkNeedSignTxHash:', useHash);

  if (useHash) {
    // Hash-based signing (for transactions with existing witnesses/scripts)
    // Compute transaction hash from transaction body
    const txCore = tx.toCore();
    const txHash = txCore.id; // Transaction ID is the hash

    debugLog('[Keystone] Using hash-based signing for transaction:', txHash);

    const { ownedKeypathList, ownedAddressList } = getOwnedKeyAddressList(xfp, keys, tx, utxos);

    debugLog('[Keystone] Owned keypaths:', ownedKeypathList.length);
    debugLog('[Keystone] Owned addresses:', ownedAddressList);

    return {
      ur: sdk.cardano.generateSignTxHashRequest(
        txHash,
        ownedKeypathList,
        ownedAddressList,
        'gerowallet',
        crypto.randomUUID()
      ),
      useHash: true,
      txHash
    };
  } else {
    // Full CBOR signing (normal transactions)
    debugLog('[Keystone] Using full CBOR signing');
    const res = getOwnedUtxos(tx.body().inputs().values(), xfp);
    // Create sign request object following Keystone demo pattern
    const cardanoSignRequest = {
      requestId: crypto.randomUUID(),
      signData: cborBuffer,
      utxos: res.keystoneUtxos,
      extraSigners: res.extraSigners,
      origin: 'gerowallet'
    };
    debugLog('[Keystone] Sign request:', cardanoSignRequest);
    // Generate UR using SDK wrapper (as shown in Keystone demo)
    return {
      ur: sdk.cardano.generateSignRequest(cardanoSignRequest),
      useHash: false,
      txHash: null
    };
  }
}


export const qrCodeOptions = (encodedUR: string, size: number): Options => {
  return {
    width: size,
    height: size,
    data: encodedUR,
    image: logo128Url,
    type: 'svg',
    margin: 0,
    qrOptions: {
      typeNumber: 0,
      mode: 'Byte',
      errorCorrectionLevel: 'Q'
    },
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: 0.1,
      margin: 6,
      crossOrigin: 'anonymous',
    },
    dotsOptions: {
      // color: '#41b583',
      // gradient: {
      //   type: 'linear', // 'radial'
      //   rotation: 0,
      //   colorStops: [{ offset: 0, color: '#00c7f3' }, { offset: 1, color: '#00ffd1' }],
      // },
      type: 'rounded',
    },
    backgroundOptions: {
      color: '#ffffff',
    },
    cornersSquareOptions: {
      color: '#35495E',
      type: 'extra-rounded',
    },
    cornersDotOptions: {
      type: 'dot',
      // gradient: {
      //   type: 'linear', // 'radial'
      //   rotation: 180,
      //   colorStops: [{ offset: 0, color: '#00c7f3' }, { offset: 1, color: '#00ffd1' }],
      // },
    }
  }
}

// ============================================================================
// BITCOIN KEYSTONE INTEGRATION
// ============================================================================

/**
 * Generate QR code for Bitcoin account sync (xpub derivation request)
 * @param addressType - Bitcoin address type ('legacy', 'segwit', 'taproot')
 * @param accountIndex - Account index (default 0)
 * @returns QR code options for displaying sync request
 */
export const generateBitcoinSyncQR = (addressType: string = 'segwit', accountIndex: number = 0): Options => {
  // Determine derivation path based on address type
  let purpose: number;
  switch (addressType) {
    case 'legacy':
      purpose = 44; // BIP44
      break;
    case 'taproot':
      purpose = 86; // BIP86
      break;
    case 'segwit':
    default:
      purpose = 84; // BIP84
      break;
  }

  const path = `m/${purpose}'/0'/${accountIndex}'`;

  // Generate key derivation request for Bitcoin (secp256k1 curve)
  const ur: UR = sdk.generateKeyDerivationCall({
    schemas: [{
      path,
      curve: Curve.secp256k1, // Bitcoin uses secp256k1, not ed25519
      algo: DerivationAlgorithm.slip10 // SLIP-0010 for secp256k1
    }],
    origin: 'gerowallet'
  });

  return qrCodeOptions(UREncoder.encodeSinglePart(ur), 190);
};

/**
 * Parse Bitcoin account info from scanned QR code
 * @param ur - UR from scanned QR code
 * @returns Object containing xpub, master fingerprint, and path
 */
export const parseBitcoinAccount = (ur: UR): {
  xpub: string;
  xfp: string;
  path: string;
  publicKey: string;
  chainCode: string;
} => {
  // Parse the crypto-hdkey UR
  const cryptoHDKey = (sdk as any).bitcoin.parseCryptoHDKey(ur);

  return {
    xpub: cryptoHDKey.getBip32Key(), // Base58 encoded xpub
    xfp: cryptoHDKey.getOrigin()?.getSourceFingerprint()?.toString('hex') || '',
    path: cryptoHDKey.getOrigin()?.getPath() || '',
    publicKey: cryptoHDKey.getKey().toString('hex'),
    chainCode: cryptoHDKey.getChainCode()?.toString('hex') || '',
  };
};

/**
 * Generate QR code for Bitcoin PSBT signing request
 * @param psbtHex - Unsigned PSBT in hex format
 * @param requestId - Unique request ID (UUID)
 * @returns QR code options for displaying signing request
 */
export const generateBitcoinPSBTQR = (psbtHex: string, _requestId: string = crypto.randomUUID()): Options => {
  // Convert PSBT hex to Buffer
  const psbtBuffer = Buffer.from(psbtHex, 'hex');

  // Generate crypto-psbt UR
  const ur: UR = (sdk as any).bitcoin.generatePSBT(psbtBuffer);

  return qrCodeOptions(UREncoder.encodeSinglePart(ur), 190);
};

/**
 * Parse signed Bitcoin PSBT from scanned QR code
 * @param ur - UR from scanned QR code
 * @returns Signed PSBT in hex format
 */
export const parseBitcoinSignature = (ur: UR): string => {
  // Parse the signed crypto-psbt UR
  const signedPsbt = (sdk as any).bitcoin.parsePSBT(ur);

  // Return signed PSBT as hex
  return signedPsbt.toHex();
};
