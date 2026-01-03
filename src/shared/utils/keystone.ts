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
 * Following Eternl's pattern for Keystone integration
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

export const getKeystonePublicKeyUR = (accPurpose = purpose.hdwallet, accIndex = 0): any => {
  const ur: UR = sdk.generateKeyDerivationCall({ schemas: [ { path: `m/${accPurpose}'/1815'/${accIndex}'`, curve: Curve.ed25519, algo: DerivationAlgorithm.bip32ed25519 } ], origin: 'gerowallet' })
  return qrCodeOptions(UREncoder.encodeSinglePart(ur), 190)
}

export const parseSignature = (ur: UR): CardanoSignature => {
  console.log('[Keystone parseSignature] UR object details:');
  console.log('[Keystone parseSignature] - type:', ur.type);
  console.log('[Keystone parseSignature] - cbor exists:', !!ur.cbor);
  console.log('[Keystone parseSignature] - cbor length:', ur.cbor?.length);
  console.log('[Keystone parseSignature] - cbor hex (first 100 chars):', ur.cbor?.toString('hex').substring(0, 100));

  const result = sdk.cardano.parseSignature(ur);

  console.log('[Keystone parseSignature] SDK result:');
  console.log('[Keystone parseSignature] - requestId:', result.requestId);
  console.log('[Keystone parseSignature] - witnessSet length:', result.witnessSet?.length);
  console.log('[Keystone parseSignature] - witnessSet (first 100 chars):', result.witnessSet?.substring(0, 100));

  return result;
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
export const createKeystoneDataSignRequest = (address: string, payloadHex: string, xfp: string, xpub: string, addressPath: string): { ur: UR; builder: any; addressBytes: Uint8Array } => {
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
 * Following Eternl's pattern: reuse the builder from the signing request
 * @param ur - The UR object from Keystone scanner
 * @param builder - The builder object created during the signing request (opaque)
 * @param addressBytes - The address bytes (for COSE_Key construction)
 * @returns Object with COSE_Sign1 signature and COSE_Key in hex format
 */
export const parseDataSignature = (ur: UR, builder: any, addressBytes: Uint8Array): { signature: string; key: string } => {
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
 * Following Eternl's pattern
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

/**
 * Creates a Keystone signing request from a transaction
 * @param tx - The transaction to sign (Serialization.Transaction)
 * @param walletData - Wallet data containing xfp and stakeAddress
 * @param utxos - Array of UTXOs for input resolution
 * @param keys - keys mapping for derivation paths
 * @returns UR object with type and cbor properties for QR code generation
 */
export const createKeystoneSignRequest = (tx: Serialization.Transaction, walletData, utxos: Cardano.Utxo[], keys: Keys): any => {
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
    /**
     * request {
     * "origin":"eternl",
     * "requestId":"d68225ab-d424-452e-8f44-39c693d7abbb",
     * "signData":{
     *   "type":"Buffer",
     *   "data":[132,165,0,217,1,2,129,130,88,32,141,171,220,209,37,130,245,221,209,217,178,152,41,79,89,30,228,17,125,187,140,2,148,44,62,215,130,3,99,137,59,114,1,1,130,163,0,88,57,17,195,226,140,54,195,68,115,21,186,90,86,243,61,166,166,221,193,119,10,135,106,141,159,12,179,169,124,76,143,115,110,228,159,57,101,210,131,224,216,208,252,249,224,35,158,59,6,168,199,241,188,2,228,70,201,104,1,26,0,193,201,96,2,130,1,216,24,89,1,48,216,121,159,216,121,159,88,28,204,149,67,16,137,214,180,110,251,64,120,102,122,41,198,44,238,234,131,166,134,21,254,236,143,108,210,44,255,216,121,159,216,121,159,88,28,204,149,67,16,137,214,180,110,251,64,120,102,122,41,198,44,238,234,131,166,134,21,254,236,143,108,210,44,255,216,121,159,216,121,159,216,121,159,88,28,143,115,110,228,159,57,101,210,131,224,216,208,252,249,224,35,158,59,6,168,199,241,188,2,228,70,201,104,255,255,255,255,216,121,128,216,121,159,216,121,159,88,28,204,149,67,16,137,214,180,110,251,64,120,102,122,41,198,44,238,234,131,166,134,21,254,236,143,108,210,44,255,216,121,159,216,121,159,216,121,159,88,28,143,115,110,228,159,57,101,210,131,224,216,208,252,249,224,35,158,59,6,168,199,241,188,2,228,70,201,104,255,255,255,255,216,121,128,216,121,159,88,28,245,128,140,44,153,13,134,218,84,191,201,125,137,206,230,239,162,12,216,70,22,22,53,148,120,217,107,76,88,32,122,199,46,168,208,219,253,86,91,66,65,85,63,95,154,137,130,76,48,201,184,113,182,18,207,160,15,46,158,36,215,173,255,216,121,159,216,122,128,216,121,159,26,0,152,150,128,255,26,191,27,11,25,216,121,128,255,26,0,10,174,96,216,122,128,255,130,88,57,1,204,149,67,16,137,214,180,110,251,64,120,102,122,41,198,44,238,234,131,166,134,21,254,236,143,108,210,44,143,115,110,228,159,57,101,210,131,224,216,208,252,249,224,35,158,59,6,168,199,241,188,2,228,70,201,104,26,147,114,59,229,2,26,0,3,94,137,3,26,10,123,17,77,7,88,32,57,165,71,10,124,64,192,68,129,182,38,205,76,22,250,250,18,130,178,15,144,209,128,171,18,239,148,116,112,190,120,150,160,245,161,25,2,162,162,105,101,120,116,114,97,68,97,116,97,140,120,64,123,34,115,101,110,100,101,114,34,58,123,34,36,97,100,100,114,101,115,115,34,58,34,97,100,100,114,49,113,56,120,102,50,115,99,115,51,56,116,116,103,109,104,109,103,112,117,120,118,55,51,102,99,99,107,119,97,54,53,114,53,54,114,112,120,64,116,108,104,118,51,97,107,100,121,116,121,48,119,100,104,119,102,56,101,101,118,104,102,103,56,99,120,99,54,114,55,48,110,99,112,114,110,99,97,115,100,50,120,56,55,120,55,113,57,101,122,120,101,57,53,113,51,55,112,107,97,110,34,125,120,64,44,34,111,114,100,101,114,79,112,116,105,111,110,115,34,58,91,123,34,115,111,117,114,99,101,34,58,34,77,105,110,115,119,97,112,86,50,34,44,34,97,115,115,101,116,73,110,34,58,123,34,36,97,115,115,101,116,34,58,34,108,111,118,101,120,64,108,97,99,101,34,125,44,34,97,115,115,101,116,79,117,116,34,58,123,34,36,97,115,115,101,116,34,58,34,49,48,97,52,57,98,57,57,54,101,50,52,48,50,50,54,57,97,102,53,53,51,97,56,97,57,54,102,98,56,101,98,57,48,100,120,64,55,57,101,57,101,99,97,55,57,101,50,98,52,50,50,51,48,53,55,98,54,46,52,55,52,53,53,50,52,102,34,125,44,34,97,109,111,117,110,116,73,110,34,58,123,34,36,98,105,103,105,110,116,34,58,34,49,48,48,48,48,48,48,48,120,64,34,125,44,34,109,105,110,105,109,117,109,82,101,99,101,105,118,101,100,34,58,123,34,36,98,105,103,105,110,116,34,58,34,51,50,48,54,50,50,48,53,54,57,34,125,44,34,100,101,120,70,101,101,34,58,123,34,36,98,105,103,105,110,116,120,64,34,58,34,55,48,48,48,48,48,34,125,44,34,100,101,112,111,115,105,116,34,58,123,34,36,98,105,103,105,110,116,34,58,34,50,48,48,48,48,48,48,34,125,44,34,118,101,114,115,105,111,110,34,58,34,68,69,88,95,86,50,34,44,34,120,64,116,121,112,101,34,58,48,44,34,109,105,110,105,109,117,109,65,109,111,117,110,116,79,117,116,34,58,123,34,36,98,105,103,105,110,116,34,58,34,51,50,48,54,50,50,48,53,54,57,34,125,44,34,100,105,114,101,99,116,105,111,110,34,58,120,64,49,44,34,107,105,108,108,79,110,70,97,105,108,101,100,34,58,102,97,108,115,101,44,34,105,115,76,105,109,105,116,79,114,100,101,114,34,58,102,97,108,115,101,44,34,108,112,65,115,115,101,116,34,58,123,34,36,97,115,115,101,116,34,58,120,64,34,102,53,56,48,56,99,50,99,57,57,48,100,56,54,100,97,53,52,98,102,99,57,55,100,56,57,99,101,101,54,101,102,97,50,48,99,100,56,52,54,49,54,49,54,51,53,57,52,55,56,100,57,54,98,52,99,46,55,97,99,55,50,101,120,64,97,56,100,48,100,98,102,100,53,54,53,98,52,50,52,49,53,53,51,102,53,102,57,97,56,57,56,50,52,99,51,48,99,57,98,56,55,49,98,54,49,50,99,102,97,48,48,102,50,101,57,101,50,52,100,55,97,100,34,125,125,93,44,34,120,30,112,97,114,116,110,101,114,34,58,34,101,116,101,114,110,108,45,109,111,110,115,116,101,114,115,119,97,112,34,125,99,109,115,103,130,120,32,77,105,110,115,119,97,112,58,32,65,103,103,114,101,103,97,116,111,114,32,77,97,114,107,101,116,32,79,114,100,101,114,120,27,80,97,114,116,110,101,114,58,32,101,116,101,114,110,108,45,109,111,110,115,116,101,114,115,119,97,112]
     * },
     * "utxos":[
     *   {"transactionHash":"8dabdcd12582f5ddd1d9b298294f591ee4117dbb8c02942c3ed7820363893b72",
     *   "index":1,
     *   "amount":"2486657998",
     *   "xfp":"100973b9",
     *   "hdPath":"m/1852'/1815'/0'/0/0",
     *   "address":"addr1q8xf2scs38ttgmhmgpuxv73fcckwa65r56rptlhv3akdyty0wdhwf8eevhfg8cxc6r70ncprncasd2x87x7q9ezxe95q37pkan"}],
     * "extraSigners":[]
     * }
     */

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
