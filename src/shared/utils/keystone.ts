import { Key, Keys, purpose } from '@/models/types';
import {
  CardanoSignature, CardanoSignDataSignature,
  Curve,
  KeystoneSDK,
  UR,
  UREncoder,
} from '@keystonehq/keystone-sdk';
import { CryptoKeypath, DerivationAlgorithm, PathComponent } from '@keystonehq/bc-ur-registry-cardano';
import { CryptoHDKey, CryptoMultiAccounts } from '@keystonehq/bc-ur-registry';
import { Options } from 'qr-code-styling/lib/types';
import logo128Url from '@/assets/img/bkp/logo128.png';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { createBuilderWithSigStructure, createCoseKeyHex, toHexArray, buildAndSignData } from '@/shared/utils/converter';
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { debugLog } from '@/utils/debug';
import i18n from '@/plugins/i18n';
import { bitcoinAccountPath } from '@/chains/bitcoin/bitcoinPaths';
import {
  InvalidAccountIndexError,
  assertAccountIndices,
  cardanoAccountPath,
  accountXpub,
  type AccountXpub,
} from '@/shared/utils/walletAccount';

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

/**
 * One key-derivation request for several Cardano accounts: one schema per account,
 * so a single scan on the Keystone exports all of them.
 */
export const getKeystoneAccountsUR = (accountIndices: number[]): Options => {
  const ur: UR = sdk.generateKeyDerivationCall({
    schemas: assertAccountIndices(accountIndices).map((index) => ({
      path: cardanoAccountPath(index), curve: Curve.ed25519, algo: DerivationAlgorithm.bip32ed25519,
    })),
    origin: 'gerowallet',
  });
  return qrCodeOptions(UREncoder.encodeSinglePart(ur), 190);
}

type FirmwareVersion = [number, number, number];

/** "3.2.0", or with the firmware's edition suffix ("3.2.0 - Cypherpunk", "3.2.0 - BTC"). */
const parseFirmwareVersion = (version: string | undefined): FirmwareVersion | undefined => {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})( - [A-Za-z]{1,16})?$/.exec(version ?? '');
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
};

const isOlderFirmware = (version: FirmwareVersion, than: FirmwareVersion): boolean =>
  (version[0] - than[0] || version[1] - than[1] || version[2] - than[2]) < 0;

/** The first firmware that answers pairing with its own version; older firmware sends a fixed 1.1.0. */
const FIRST_FIRMWARE_REPORTING_VERSION: FirmwareVersion = [1, 7, 2];
/** The first firmware that parses and shows a pool registration certificate. */
const POOL_REGISTRATION_FIRMWARE: FirmwareVersion = [1, 5, 8];

/**
 * The firmware version a Keystone reported in its pairing answer, or undefined when
 * the answer does not tell: no version, one that does not parse, or the fixed "1.1.0"
 * that firmware up to 1.7.0 sends instead of its own.
 */
export const keystoneFirmwareVersion = (multiAccounts: CryptoMultiAccounts): string | undefined => {
  const reported = multiAccounts.getVersion();
  const parsed = parseFirmwareVersion(reported);
  return parsed && !isOlderFirmware(parsed, FIRST_FIRMWARE_REPORTING_VERSION) ? reported : undefined;
};

/**
 * Refuses a pool registration on firmware known to be too old to show one, so the
 * device is never asked to sign a certificate its screen leaves out. An unknown
 * version (a Keystone paired before Gero recorded it, or firmware that does not
 * report it) is not refused.
 */
const assertFirmwareShowsCertificates = (txCore: Cardano.Tx, firmwareVersion: string | undefined) => {
  const version = parseFirmwareVersion(firmwareVersion);
  if (!version || !isOlderFirmware(version, POOL_REGISTRATION_FIRMWARE)) return;
  if (txCore.body.certificates?.some((cert) => cert.__typename === Cardano.CertificateType.PoolRegistration)) {
    throw new Error(i18n.t('wallet.keystoneFirmwareNoPoolRegistration', { version: POOL_REGISTRATION_FIRMWARE.join('.') }) as string);
  }
};

/**
 * The accounts in a Keystone `crypto-multi-accounts` answer, by the path each key
 * carries. Only the accounts that were asked for are kept, so a device answering
 * with other paths can never add an account the user did not see listed.
 */
export const parseKeystoneAccounts = (cbor: Buffer, accountIndices: number[]): { xfp: string; accounts: AccountXpub[]; firmwareVersion?: string } => {
  const multiAccounts = CryptoMultiAccounts.fromCBOR(cbor);
  const wanted = new Set(assertAccountIndices(accountIndices));
  const accounts = multiAccounts.getKeys()
    .map((key) => accountXpub(key.getKey().toString('hex'), key.getChainCode().toString('hex'), key.getOrigin().getPath()))
    .filter((account) => wanted.has(account.accountIndex))
    .sort((a, b) => a.accountIndex - b.accountIndex);
  if (accounts.length === 0) throw new InvalidAccountIndexError('The Keystone did not return the requested accounts');
  const firmwareVersion = keystoneFirmwareVersion(multiAccounts);
  return { xfp: multiAccounts.getMasterFingerprint().toString('hex'), accounts, ...(firmwareVersion && { firmwareVersion }) };
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
export const createKeystoneDataSignRequest = (address: string, payloadHex: string, xfp: string, xpub: string, addressPath: string): { ur: UR; requestId: string; builder; addressBytes: Uint8Array } => {
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
    requestId: signDataRequest.requestId,
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
export const parseDataSignature = (ur: UR, builder, addressBytes: Uint8Array, expectedRequestId: string): { signature: string; key: string } => {
  const keystoneSign: CardanoSignDataSignature = sdk.cardano.parseSignDataSignature(ur);
  if (!expectedRequestId || keystoneSign.requestId !== expectedRequestId) throw new Error('Keystone response does not match the approved request');

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
 * The wallet key a required signer names, matched by key hash as the Trezor mapping
 * does: payment and change keys, then the stake key. Undefined for any other hash,
 * which is not this wallet's to sign.
 */
const ownRequiredSignerKey = (keys: Keys, keyHash: Ed25519KeyHashHex): Key | undefined => {
  const hash = keyHash.toLowerCase();
  return [...keys.payment, ...keys.change, ...keys.stake]
    .find((key) => !!key.path && String(key.cred).toLowerCase() === hash);
};

/**
 * The stake credential of a reward (stake) address. It is not a base address, so
 * BaseAddress.fromAddress() gives undefined for it; in @cardano-sdk/core a reward
 * address holds its one credential as the payment credential.
 */
const rewardAddressCredential = (stakeAddress: string): Cardano.Credential => {
  const rewardAddress = Cardano.RewardAddress.fromAddress(Cardano.Address.fromBech32(stakeAddress));
  if (!rewardAddress) throw new Error('The stake address is not a reward address');
  return rewardAddress.getPaymentCredential();
};

/**
 * The stake credential hashes this wallet's stake key signs for: certificates whose
 * stake credential is the wallet's stake key, pool registrations that list its reward
 * address as an owner, and withdrawals from that address. Another credential (someone
 * else's key, a script) is not this wallet's to sign. A key set with no stake cred (not
 * expected) keeps every stake-credential certificate, as the software signer's
 * resolver does, rather than drop a witness the wallet's own action needs.
 */
const ownStakeSignerHashes = (txCore: Cardano.Tx, keys: Keys, stakeAddress: string | undefined): Cardano.Credential['hash'][] => {
  const ownStakeCreds = new Set(keys.stake.map((key) => String(key.cred ?? '').toLowerCase()).filter(Boolean));
  const hashes: Cardano.Credential['hash'][] = [];
  txCore.body.certificates?.forEach((cert: Cardano.Certificate) => {
    // Each owner of a registered pool signs its registration with that owner's stake key.
    // The pool's cold key signs too, which is not one of the wallet's keys. Keystone
    // firmware has parsed and shown pool registrations since 1.5.8.
    if (cert.__typename === Cardano.CertificateType.PoolRegistration) {
      cert.poolParameters.owners.forEach((owner: Cardano.RewardAccount) => {
        if (owner === stakeAddress) hashes.push(rewardAddressCredential(owner).hash);
      });
      return;
    }
    // Check if certificate has stakeCredential property (all stake-related certs do)
    if (!('stakeCredential' in cert) || !cert.stakeCredential) return;
    if (ownStakeCreds.size === 0 || ownStakeCreds.has(cert.stakeCredential.hash.toLowerCase())) {
      hashes.push(cert.stakeCredential.hash);
    }
  });
  txCore.body.withdrawals?.forEach((withdrawal: Cardano.Withdrawal) => {
    if (withdrawal.stakeAddress === stakeAddress) hashes.push(rewardAddressCredential(withdrawal.stakeAddress).hash);
  });
  return hashes;
};

/**
 * Helper function to get owned keypaths and addresses for hash-based signing
 */
const getOwnedKeyAddressList = (xfp: string, keys: Keys, tx: Serialization.Transaction, utxos: Cardano.Utxo[], stakeAddress: string | undefined) => {
  const ownedKeypathList: CryptoKeypath[] = [];
  const ownedAddressList: string[] = [];
  // The firmware signs every listed path with no dedupe of its own, so a repeated path
  // would add a second witness for the same key.
  const addedPaths = new Set<string>();
  const addKey = (key: Key) => {
    if (addedPaths.has(key.path)) return;
    ownedKeypathList.push(createCryptoKeypath(key.path, xfp));
    if (key.address) ownedAddressList.push(key.address);
    addedPaths.add(key.path);
  };

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

      if (foundKey) addKey(foundKey);
    }
  });

  // Required signers that are this wallet's keys (DEX and other contract transactions)
  const txCore = tx.toCore();
  txCore.body.requiredExtraSignatures?.forEach((keyHash: Ed25519KeyHashHex) => {
    const key = ownRequiredSignerKey(keys, keyHash);
    if (key) addKey(key);
  });

  // The stake key, when a certificate, pool ownership or withdrawal is the wallet's own
  const stakeKey = keys.stake[0];
  if (stakeKey && ownStakeSignerHashes(txCore, keys, stakeAddress).length > 0) addKey(stakeKey);

  return { ownedKeypathList, ownedAddressList };
};

export interface KeystoneSignRequestResponse {
  ur: UR,
  requestId: string,
  useHash: boolean,
  txHash?: string
}

/**
 * Creates a Keystone signing request from a transaction
 * @param tx - The transaction to sign (Serialization.Transaction)
 * @param walletData - Wallet data containing xfp, stakeAddress and the paired firmwareVersion
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

    // One extra signer per key hash: a key that a required signer, a certificate and
    // a withdrawal all name signs once. Credentials are compared by hash, since each
    // certificate and withdrawal carries its own Credential object.
    const signerHashes = new Set<string>();
    const addSigner = (keyHash: string, keyPath: string) => {
      if (signerHashes.has(keyHash)) return;
      signerHashes.add(keyHash);
      extraSigners.push({ keyHash, xfp, keyPath });
    };

    // Required signers (used by DEX transactions and other contracts) that are this
    // wallet's keys, each at its own path: the firmware signs an extra signer at
    // whatever path it carries. A key that signs an owned input already witnesses the
    // transaction.
    const requiredSigners = txCore.body.requiredExtraSignatures ?? [];
    debugLog('[Keystone] Found required signers:', requiredSigners.length);
    const inputPaths = new Set(keystoneUtxos.map((utxo) => utxo.hdPath));
    requiredSigners.forEach((keyHash: Ed25519KeyHashHex) => {
      const key = ownRequiredSignerKey(keys, keyHash);
      if (key && !inputPaths.has(key.path)) addSigner(keyHash, key.path);
    });

    // Also check for certificates and withdrawals (for staking operations)
    const stakePath = keys.stake[0]?.path || '';
    ownStakeSignerHashes(txCore, keys, walletData.stakeAddress).forEach((keyHash) => addSigner(keyHash, stakePath));
    return {keystoneUtxos, extraSigners}
  }

  assertFirmwareShowsCertificates(tx.toCore(), walletData.firmwareVersion);

  const xfp = walletData.xfp ?? "";
  const txCborHex = tx.toCbor();
  const cborBuffer = Buffer.from(txCborHex, 'hex');

  // Check if we should sign the hash or full transaction (for multi-sig/script transactions)
  const useHash = sdk.cardano.checkNeedSignTxHash(cborBuffer);
  const requestId = crypto.randomUUID();
  debugLog('[Keystone] checkNeedSignTxHash:', useHash);

  if (useHash) {
    // Hash-based signing (for transactions with existing witnesses/scripts)
    // Compute transaction hash from transaction body
    const txCore = tx.toCore();
    const txHash = txCore.id; // Transaction ID is the hash

    debugLog('[Keystone] Using hash-based signing for transaction:', txHash);

    const { ownedKeypathList, ownedAddressList } = getOwnedKeyAddressList(xfp, keys, tx, utxos, walletData.stakeAddress);

    debugLog('[Keystone] Owned keypaths:', ownedKeypathList.length);
    debugLog('[Keystone] Owned addresses:', ownedAddressList);

    return {
      ur: sdk.cardano.generateSignTxHashRequest(
        txHash,
        ownedKeypathList,
        ownedAddressList,
        'gerowallet',
        requestId
      ),
      requestId,
      useHash: true,
      txHash
    };
  } else {
    // Full CBOR signing (normal transactions)
    debugLog('[Keystone] Using full CBOR signing');
    const res = getOwnedUtxos(tx.body().inputs().values(), xfp);
    // Create sign request object following Keystone demo pattern
    const cardanoSignRequest = {
      requestId,
      signData: cborBuffer,
      utxos: res.keystoneUtxos,
      extraSigners: res.extraSigners,
      origin: 'gerowallet'
    };
    debugLog('[Keystone] Sign request:', cardanoSignRequest);
    // Generate UR using SDK wrapper (as shown in Keystone demo)
    return {
      ur: sdk.cardano.generateSignRequest(cardanoSignRequest),
      requestId,
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
 * Generate QR code for Bitcoin account sync (xpub derivation request) at the
 * account's path, m/purpose'/coinType'/account' (coin type 1' off Mainnet)
 * @param network - The wallet's network
 * @param addressType - Bitcoin address type ('legacy', 'segwit', 'taproot')
 * @param accountIndex - Account index (default 0)
 * @returns QR code options for displaying sync request
 */
export const generateBitcoinSyncQR = (network: string, addressType: string = 'segwit', accountIndex: number = 0): Options => {
  // Generate key derivation request for Bitcoin (secp256k1 curve)
  const ur: UR = sdk.generateKeyDerivationCall({
    schemas: [{
      path: bitcoinAccountPath(network, addressType, accountIndex),
      curve: Curve.secp256k1, // Bitcoin uses secp256k1, not ed25519
      algo: DerivationAlgorithm.slip10 // SLIP-0010 for secp256k1
    }],
    origin: 'gerowallet'
  });

  return qrCodeOptions(UREncoder.encodeSinglePart(ur), 190);
};

/**
 * Parse the Bitcoin account a Keystone exported (issue 1326).
 *
 * The key-derivation request from {@link generateBitcoinSyncQR} is answered with a
 * `crypto-multi-accounts` UR; a lone `crypto-hdkey` is read too. Only the key at the
 * account path that was asked for is taken, so an answer for another account is
 * refused rather than paired. Only the `crypto-multi-accounts` answer carries the
 * firmware version (firmware 1.7.2 and later, the first that accepts this request).
 *
 * @param ur - UR from scanned QR code
 * @param network - The network the account was requested on
 * @param addressType - The address type that was requested
 * @param accountIndex - The account that was requested
 * @returns Object containing xpub (already in the wallet's xpub form), master fingerprint, path, and the firmware version when the answer reports one
 */
export const parseBitcoinAccount = (ur: UR, network: string, addressType: string = 'segwit', accountIndex: number = 0): {
  xpub: string;
  xfp: string;
  path: string;
  publicKey: string;
  chainCode: string;
  firmwareVersion?: string;
} => {
  let keys: CryptoHDKey[];
  let xfp: Buffer | undefined;
  let firmwareVersion: string | undefined;
  if (ur.type === 'crypto-multi-accounts') {
    const multiAccounts = CryptoMultiAccounts.fromCBOR(ur.cbor);
    keys = multiAccounts.getKeys();
    xfp = multiAccounts.getMasterFingerprint();
    firmwareVersion = keystoneFirmwareVersion(multiAccounts);
  } else if (ur.type === 'crypto-hdkey') {
    keys = [CryptoHDKey.fromCBOR(ur.cbor)];
  } else {
    throw new Error('Expected a crypto-multi-accounts or crypto-hdkey response');
  }

  const requested = bitcoinAccountPath(network, addressType, accountIndex);
  const key = keys.find((k) => `m/${k.getOrigin()?.getPath()}` === requested);
  if (!key) throw new Error('The Keystone did not return the requested Bitcoin account');

  return {
    xpub: key.getBip32Key(), // Base58 encoded xpub
    xfp: (xfp ?? key.getOrigin()?.getSourceFingerprint())?.toString('hex') || '',
    path: key.getOrigin()?.getPath() || '',
    publicKey: key.getKey().toString('hex'),
    chainCode: key.getChainCode()?.toString('hex') || '',
    ...(firmwareVersion && { firmwareVersion }),
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
  const ur: UR = sdk.btc.generatePSBT(psbtBuffer);

  return qrCodeOptions(UREncoder.encodeSinglePart(ur), 190);
};

/**
 * Parse signed Bitcoin PSBT from scanned QR code
 * @param ur - UR from scanned QR code
 * @returns Signed PSBT in hex format
 */
export const parseBitcoinSignature = (ur: UR): string => {
  // Parse the signed crypto-psbt UR
  return sdk.btc.parsePSBT(ur);
};
