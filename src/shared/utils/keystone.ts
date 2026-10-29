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
import { debugLog } from '@/utils/debug';
import i18n from '@/plugins/i18n';
import { credSet } from '@/shared/utils/keyCreds';
import { assertCip113SignAllowed } from '@/shared/utils/cip113SignPreflight';
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
/**
 * The first firmware that parses and shows a pool registration certificate. Committee
 * certificates (with their cold and hot credentials) and votes are shown from 1.6.6,
 * below the first version a Keystone reports, so no recorded firmware is refused them.
 */
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

/** A wallet key the Keystone signs with: its path, and the address a hash request lists for it. */
interface SigningKey { path: string; address?: string }

/** A witness beyond the inputs' own: the key hash it is for, and the key that gives it. */
interface ExtraSigner extends SigningKey { keyHash: string }

/** A key list of the key set, empty when an older or partial key set has none. */
const keyList = (list: Key[] | undefined): Key[] => (Array.isArray(list) ? list : []);

/** A DRep ID is not an address, so a DRep key lists none. */
const signingKey = (key: Key | undefined, listsAddress = true): SigningKey | undefined =>
  key?.path ? { path: key.path, ...(listsAddress && key.address ? { address: key.address } : {}) } : undefined;

/**
 * The wallet's keys by lowercase key hash, as a required signer names them: payment and
 * change keys, then the stake key (the Trezor mapping's order), then the DRep key and
 * the constitutional committee cold and hot keys.
 */
const ownKeysByHash = (keys: Keys): Map<string, SigningKey> => {
  const byHash = new Map<string, SigningKey>();
  const add = (list: Key[] | undefined, listsAddress = true) => keyList(list).forEach((key) => {
    const hash = String(key.cred ?? '').toLowerCase();
    const signer = signingKey(key, listsAddress);
    if (hash && signer && !byHash.has(hash)) byHash.set(hash, signer);
  });
  add(keys.payment);
  add(keys.change);
  add(keys.stake);
  add(keys.drep105, false);
  add(keys.drep129, false);
  add(keys.ccCold, false);
  add(keys.ccHot, false);
  return byHash;
};

/**
 * Whether a credential is a key hash the given creds own. With no cred of that kind in
 * the key set (not expected), any key hash is, as the software signer's resolver does.
 */
const isOwnKeyHash = (owned: Set<string>, credential: { type: Cardano.CredentialType; hash: string }) =>
  credential.type === Cardano.CredentialType.KeyHash
  && (owned.size === 0 || owned.has(credential.hash.toLowerCase()));

/**
 * The stake credential hashes this wallet's stake key signs for: certificates whose
 * stake credential is the wallet's stake key, pool registrations that list its reward
 * address as an owner, and withdrawals from that address. A reward address is the
 * wallet's when its key hash is a stake cred of the key set or it is the wallet's own
 * stake address. Another credential (someone else's key, a script) is not this wallet's
 * to sign. A key set with no stake cred (not expected) keeps every key-hash certificate,
 * as the software signer's resolver does, rather than drop a witness the wallet's own
 * action needs.
 */
const ownStakeSignerHashes = (txCore: Cardano.Tx, keys: Keys, stakeAddress: string | undefined): string[] => {
  const ownStakeCreds = credSet(keys.stake);
  const isOwnRewardAccount = (account: Cardano.RewardAccount) =>
    account === stakeAddress || ownStakeCreds.has(Cardano.RewardAccount.toHash(account).toLowerCase());
  const hashes: string[] = [];
  txCore.body.certificates?.forEach((cert: Cardano.Certificate) => {
    // Each owner of a registered pool signs its registration with that owner's stake key.
    // The pool's cold key signs too, which is not one of the wallet's keys. Keystone
    // firmware has parsed and shown pool registrations since 1.5.8.
    if (cert.__typename === Cardano.CertificateType.PoolRegistration) {
      cert.poolParameters.owners.forEach((owner: Cardano.RewardAccount) => {
        if (isOwnRewardAccount(owner)) hashes.push(Cardano.RewardAccount.toHash(owner));
      });
      return;
    }
    // Check if certificate has stakeCredential property (all stake-related certs do)
    if (!('stakeCredential' in cert) || cert.stakeCredential?.type !== Cardano.CredentialType.KeyHash) return;
    if (ownStakeCreds.size === 0 || ownStakeCreds.has(cert.stakeCredential.hash.toLowerCase())) {
      hashes.push(cert.stakeCredential.hash);
    }
  });
  txCore.body.withdrawals?.forEach((withdrawal: Cardano.Withdrawal) => {
    if (isOwnRewardAccount(withdrawal.stakeAddress)) hashes.push(Cardano.RewardAccount.toHash(withdrawal.stakeAddress));
  });
  return hashes;
};

/**
 * The DRep credential hashes this wallet's DRep key signs for: its DRep registration,
 * update and retirement certificates, and the votes it casts as that DRep.
 */
const ownDrepSignerHashes = (txCore: Cardano.Tx, keys: Keys): string[] => {
  const ownDrepCreds = credSet(keys.drep105, keys.drep129);
  const hashes: string[] = [];
  txCore.body.certificates?.forEach((cert: Cardano.Certificate) => {
    if ('dRepCredential' in cert && cert.dRepCredential && isOwnKeyHash(ownDrepCreds, cert.dRepCredential)) hashes.push(cert.dRepCredential.hash);
  });
  txCore.body.votingProcedures?.forEach(({ voter }) => {
    if (voter.__typename === Cardano.VoterType.dRepKeyHash && isOwnKeyHash(ownDrepCreds, voter.credential)) hashes.push(voter.credential.hash);
  });
  return hashes;
};

/**
 * The constitutional committee credential hashes this wallet signs for: the cold key
 * for the committee certificates of its cold credential (authorizing a hot credential,
 * resigning), the hot key for the votes it casts as a committee member. The hot
 * credential an authorization names does not sign it.
 */
const ownCommitteeSignerHashes = (txCore: Cardano.Tx, keys: Keys): { cold: string[]; hot: string[] } => {
  const ownColdCreds = credSet(keys.ccCold);
  const ownHotCreds = credSet(keys.ccHot);
  const cold: string[] = [];
  const hot: string[] = [];
  txCore.body.certificates?.forEach((cert: Cardano.Certificate) => {
    if ((cert.__typename === Cardano.CertificateType.AuthorizeCommitteeHot
      || cert.__typename === Cardano.CertificateType.ResignCommitteeCold)
      && isOwnKeyHash(ownColdCreds, cert.coldCredential)) cold.push(cert.coldCredential.hash);
  });
  txCore.body.votingProcedures?.forEach(({ voter }) => {
    if (voter.__typename === Cardano.VoterType.ccHotKeyHash && isOwnKeyHash(ownHotCreds, voter.credential)) hot.push(voter.credential.hash);
  });
  return { cold, hot };
};

/**
 * Every witness the transaction needs from this wallet, worked out once for both
 * request types:
 * - `inputs`: each input whose UTxO is known, with the payment or change key at its
 *   address (none for an input the wallet does not own).
 * - `extra`: the other witnesses, one per key hash: collateral (the key at the collateral
 *   UTxO's address, as Trezor maps it, unless that key already signs an input), required
 *   signers (DEX orders, a CIP-113 transfer's owner), the stake key for its certificates,
 *   pool ownerships and withdrawals, the DRep key for its certificates and votes, and the
 *   committee cold key for its certificates and hot key for its votes. Any other hash is
 *   not this wallet's to sign: another party signs for it (a multisig).
 * The firmware signs each extra signer at whatever path it carries, and a key it also
 * signs an input with only once (sign_tx dedupes by public key), so a required signer is
 * listed even when an input's key is the one it names.
 */
const walletSigners = (txCore: Cardano.Tx, keys: Keys, utxos: Cardano.Utxo[], stakeAddress: string | undefined) => {
  // Indexed once by `txId#index`, the first of any duplicate kept, as a scan would find it.
  const utxoByRef = new Map<string, Cardano.Utxo>();
  utxos.forEach((utxo) => {
    const ref = `${utxo[0].txId}#${utxo[0].index}`;
    if (!utxoByRef.has(ref)) utxoByRef.set(ref, utxo);
  });
  const utxoOf = (txIn: Cardano.TxIn) => utxoByRef.get(`${txIn.txId}#${txIn.index}`);
  const addressOf = ([txIn, txOut]: Cardano.Utxo) => txIn.address || txOut.address;
  const keyAt = (address: string) => keyList(keys.payment).find((key) => key.address === address)
    || keyList(keys.change).find((key) => key.address === address);

  const inputs = txCore.body.inputs.flatMap((txIn) => {
    const utxo = utxoOf(txIn);
    return utxo ? [{ utxo, key: signingKey(keyAt(addressOf(utxo))) }] : [];
  });

  const inputPaths = new Set(inputs.flatMap(({ key }) => (key ? [key.path] : [])));
  const extra = new Map<string, ExtraSigner>();
  const add = (keyHash: string | undefined, key: SigningKey | undefined) => {
    const hash = String(keyHash ?? '').toLowerCase();
    if (!hash || !key || extra.has(hash)) return;
    extra.set(hash, { keyHash: hash, ...key });
  };

  txCore.body.collaterals?.forEach((txIn) => {
    const utxo = utxoOf(txIn);
    const key = utxo && keyAt(addressOf(utxo));
    const signer = signingKey(key);
    if (signer && !inputPaths.has(signer.path)) add(key?.cred, signer);
  });
  const byHash = ownKeysByHash(keys);
  const requiredSigners = txCore.body.requiredExtraSignatures ?? [];
  debugLog('[Keystone] Found required signers:', requiredSigners.length);
  requiredSigners.forEach((keyHash) => add(keyHash, byHash.get(keyHash.toLowerCase())));
  const stakeKey = signingKey(keyList(keys.stake)[0]);
  ownStakeSignerHashes(txCore, keys, stakeAddress).forEach((keyHash) => add(keyHash, stakeKey));
  const drepKey = signingKey(keyList(keys.drep105)[0] ?? keyList(keys.drep129)[0], false);
  ownDrepSignerHashes(txCore, keys).forEach((keyHash) => add(keyHash, drepKey));
  const committee = ownCommitteeSignerHashes(txCore, keys);
  const ccColdKey = signingKey(keyList(keys.ccCold)[0], false);
  committee.cold.forEach((keyHash) => add(keyHash, ccColdKey));
  const ccHotKey = signingKey(keyList(keys.ccHot)[0], false);
  committee.hot.forEach((keyHash) => add(keyHash, ccHotKey));

  return { inputs, extra: [...extra.values()] };
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
export const createKeystoneSignRequest = async (tx: Serialization.Transaction, walletData, utxos: Cardano.Utxo[], keys: Keys): Promise<KeystoneSignRequestResponse> => {
  // Keystone signs whatever QR it is shown, and the page cannot read the CIP-113 refusal
  // index; every caller, the dApp approvals included, passes through here.
  const txCborHex = tx.toCbor();
  await assertCip113SignAllowed(txCborHex, i18n.t('wallet.keystoneSigningFailed') as string);

  // Convert Serialization.Transaction to Core Cardano.Tx to get proper certificate types
  const txCore = tx.toCore();
  assertFirmwareShowsCertificates(txCore, walletData.firmwareVersion);

  const xfp = walletData.xfp ?? "";
  const cborBuffer = Buffer.from(txCborHex, 'hex');
  const { inputs, extra } = walletSigners(txCore, keys, utxos, walletData.stakeAddress);

  // Check if we should sign the hash or full transaction (for multi-sig/script transactions)
  const useHash = sdk.cardano.checkNeedSignTxHash(cborBuffer);
  const requestId = crypto.randomUUID();
  debugLog('[Keystone] checkNeedSignTxHash:', useHash);

  if (useHash) {
    // Hash-based signing (for transactions with existing witnesses/scripts)
    const txHash = txCore.id; // Transaction ID is the hash
    debugLog('[Keystone] Using hash-based signing for transaction:', txHash);

    // The firmware signs every listed path with no dedupe of its own, so a repeated path
    // would add a second witness for the same key.
    const ownedKeypathList: CryptoKeypath[] = [];
    const ownedAddressList: string[] = [];
    const addedPaths = new Set<string>();
    [...inputs.flatMap(({ key }) => (key ? [key] : [])), ...extra].forEach((key) => {
      if (addedPaths.has(key.path)) return;
      addedPaths.add(key.path);
      ownedKeypathList.push(createCryptoKeypath(key.path, xfp));
      if (key.address) ownedAddressList.push(key.address);
    });
    debugLog('[Keystone] Owned keypaths:', ownedKeypathList.length);

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
    // Create sign request object following Keystone demo pattern
    const cardanoSignRequest = {
      requestId,
      signData: cborBuffer,
      utxos: inputs.map(({ utxo, key }) => ({
        transactionHash: utxo[0].txId,
        index: utxo[0].index,
        amount: String(utxo[1].value.coins), // Convert BigInt to string
        xfp,
        hdPath: key?.path || '',
        address: utxo[0].address || utxo[1].address,
      })),
      extraSigners: extra.map(({ keyHash, path }) => ({ keyHash, xfp, keyPath: path })),
      origin: 'gerowallet'
    };
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
