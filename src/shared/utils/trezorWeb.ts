import { coin_type, Key, Keys, purpose } from '@/models/types';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { hdPathToArray, toStakeAddress, getPublicKey } from '@/chrome/serialization';
import TrezorConnect from '@trezor/connect-web';
import * as Trezor from '@trezor/connect';
import {
  AccountKeyDerivationPath,
  AddressType,
  errors,
  GroupedAddress,
  KeyPurpose,
  KeyRole,
  util,
} from '@cardano-sdk/key-management';
import { bech32 } from 'bech32';
import { parseSafeUrl } from '@/shared/utils/externalLink';
import { NetworkInfo } from '@/utils/networks';
import { BIP32Path, Ed25519PublicKeyHex, Ed25519SignatureHex } from '@cardano-sdk/crypto';
import { areStringsEqualInConstantTime, HexBlob } from '@cardano-sdk/util';
import type { BitcoinHardwareAccount } from '@/chains/bitcoin/bitcoinKeyManager';
import { bitcoinAccountPath, bitcoinAddressPath, trezorCoin } from '@/chains/bitcoin/bitcoinPaths';
import {
  accountKeyIndices,
  assertTrezorCanSign,
  extraWitnessRequests,
  trezorCertificates,
  trezorInputs,
  trezorKeyContext,
  trezorReferenceInputs,
  trezorRequiredSigners,
  trezorWithdrawals,
  walletWitnessPaths,
  type TrezorKeyContext,
} from '@/shared/utils/trezorWitnesses';
import { accountIndexFromKeys, assertAccountIndices, cardanoAccountPath, accountXpub, type AccountXpub } from '@/shared/utils/walletAccount';

/**
 * Trezor transaction transformer context
 * Contains all information needed to transform Cardano SDK transactions to Trezor format
 */
interface TrezorTxTransformerContext {
  accountIndex: number;
  chainId: {
    networkId: number;
    networkMagic: number;
  };
  knownAddresses: GroupedAddress[];
  /** The key set and UTxOs that decide which keys sign (trezorWitnesses.ts). */
  keyContext: TrezorKeyContext;
  outputsFormat?: Trezor.PROTO.CardanoTxOutputSerializationFormat[];
  collateralReturnFormat?: Trezor.PROTO.CardanoTxOutputSerializationFormat;
  tagCborSets?: boolean;
}

/**
 * Trezor Connect Wrapper (document-context / WebUSB)
 * Clean wrapper around @trezor/connect-web for Cardano and Bitcoin operations
 * Runs in a document context (e.g. options page / side panel) so it can use
 * WebUSB directly, falling back to Trezor Bridge when WebUSB is unavailable.
 */

// Guards the one-time window.open patch that forces connect-web's UI to open as
// a popup window instead of a tab (see init()).
let windowOpenPatchedForTrezor = false;

// Trezor Connect manifest configuration
const TREZOR_MANIFEST = {
  appName: 'Gero Dashboard',
  appIcon: 'https://raw.githubusercontent.com/Gero-Labs/staking-pool/refs/heads/main/logo-64.png',
  appUrl: `chrome-extension://${chrome.runtime.id}`,
  email: 'support@gerowallet.io',
};

/** The CIP-1854 multisig witness of the wallet's own account (the SDK's agent always asks for account 0's). */
const multiSigWitnessPaths = (accountIndex: number): BIP32Path[] => [
  util.accountKeyDerivationPathToBip32Path(accountIndex, { index: 0, role: KeyRole.External }, KeyPurpose.MULTI_SIG)
];

const stakeCredentialCert = (certificateType: Trezor.PROTO.CardanoCertificateType): boolean =>
  certificateType === Trezor.PROTO.CardanoCertificateType.STAKE_REGISTRATION ||
  certificateType === Trezor.PROTO.CardanoCertificateType.STAKE_DEREGISTRATION ||
  certificateType === Trezor.PROTO.CardanoCertificateType.STAKE_DELEGATION;

const containsOnlyScriptHashCredentials = (tx: Omit<Trezor.CardanoSignTransaction, 'signingMode'>): boolean => {
  if (tx['certificates']) {
    for (const cert of tx['certificates']) {
      if (!stakeCredentialCert(cert.type) || !cert.scriptHash) return false;
    }
  }
  return !tx['withdrawals']?.some((withdrawal) => !withdrawal.scriptHash);
};

const isMultiSig = (tx: Omit<Trezor.CardanoSignTransaction, 'signingMode'>): boolean => {
  const allThirdPartyInputs = !tx['inputs'].some((input) => input.path);
  const allThirdRequiredSigner = !tx['requiredSigners']?.some((signer) => signer.keyPath);
  // Trezor doesn't allow change outputs to address controlled by your keys and instead you have to use script address for change out
  const allThirdPartyOutputs = !tx['outputs'].some((out) => 'addressParameters' in out);

  return (
    allThirdPartyInputs &&
    allThirdPartyOutputs &&
    allThirdRequiredSigner &&
    !tx['collateralInputs'] &&
    !tx['collateralReturn'] &&
    !tx['totalCollateral'] &&
    !tx['referenceInputs'] &&
    containsOnlyScriptHashCredentials(tx)
  );
};

/**
 * Map derivation type from TrezorConfig to Trezor PROTO format
 */
const mapDerivationType = (derivationType: number): number => {
  // Map derivation types - typically 0 for ICARUS, 1 for LEDGER, 2 for ICARUS_TREZOR
  return derivationType;
};

/**
 * Transform transport errors to proper error types
 */
const transportTypedError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  const message = (error as { message?: string } | undefined)?.message;
  return new Error(message || 'Unknown transport error');
};

/**
 * Convert BIP32 path array to string format
 * Example: [2147485500, 2147485463, 2147483648, 0, 0] -> "m/1852'/1815'/0'/0/0"
 */
const bip32PathToString = (path: BIP32Path): string => {
  return 'm/' + path.map((index) => {
    // Hardened indices have bit 31 set (>= 0x80000000)
    const isHardened = index >= 0x80000000;
    const value = isHardened ? index - 0x80000000 : index;
    return isHardened ? `${value}'` : `${value}`;
  }).join('/');
};

/**
 * Compare asset names canonically for sorting
 * Shorter asset names come first, then lexicographic order
 */
const compareAssetNameCanonically = (a: Trezor.CardanoToken, b: Trezor.CardanoToken): number => {
  if (a.assetNameBytes.length === b.assetNameBytes.length) {
    return a.assetNameBytes > b.assetNameBytes ? 1 : -1;
  } else if (a.assetNameBytes.length > b.assetNameBytes.length) {
    return 1;
  }
  return -1;
};

/**
 * Compare policy IDs canonically for sorting
 * Policy IDs are always the same length, so direct lexicographic comparison
 */
const comparePolicyIdCanonically = (a: Trezor.CardanoAssetGroup, b: Trezor.CardanoAssetGroup): number =>
  a.policyId > b.policyId ? 1 : -1;

/**
 * Convert TokenMap to Trezor AssetGroups with canonical sorting
 * Matches official SDK implementation from @cardano-sdk/hardware-trezor/transformers/assets.ts
 */
const mapTokenMap = (tokenMap?: Cardano.TokenMap, isMint?: boolean): Trezor.CardanoAssetGroup[] | undefined => {
  if (!tokenMap || tokenMap.size === 0) return undefined;

  const groupedByPolicy = new Map<string, Trezor.CardanoToken[]>();

  // Group tokens by policy ID
  for (const [assetId, amount] of tokenMap.entries()) {
    const policyId = Cardano.AssetId.getPolicyId(assetId);
    const assetName = Cardano.AssetId.getAssetName(assetId);

    if (!groupedByPolicy.has(policyId)) {
      groupedByPolicy.set(policyId, []);
    }

    groupedByPolicy.get(policyId)!.push({
      assetNameBytes: assetName,
      ...(isMint ? { mintAmount: amount.toString() } : { amount: amount.toString() }),
    });
  }

  // Build asset groups with canonical sorting
  const assetGroups: Trezor.CardanoAssetGroup[] = [];
  for (const [policyId, tokens] of groupedByPolicy.entries()) {
    // Sort tokens within each policy group by asset name
    tokens.sort(compareAssetNameCanonically);

    assetGroups.push({
      policyId,
      tokenAmounts: tokens,
    });
  }

  // Sort asset groups by policy ID
  assetGroups.sort(comparePolicyIdCanonically);

  return assetGroups;
};

/**
 * The output's reference script, as the bytes it has in the transaction.
 */
const getScriptHex = (output: Serialization.TransactionOutput): string | undefined => {
  const scriptRef = output.scriptRef();
  if (!scriptRef) return undefined;
  return scriptRef.toCbor();
};

/**
 * The output's inline datum, as the bytes it has in the transaction.
 */
const getInlineDatum = (output: Serialization.TransactionOutput): string | undefined =>
  output.datum()?.asInlineData()?.toCbor();

/**
 * Convert a transaction output to Trezor format with Babbage-era support
 * Includes inline datum and reference script handling
 *
 * Takes the output as the transaction holds it. The device serializes each output back from
 * these params and hashes the body, so the inline datum and reference script must go over as
 * their original bytes. Re-encoding them from the Core value, as @cardano-sdk/hardware-trezor
 * does, changes any not in the SDK's own encoding (a definite-length list datum comes back
 * indefinite-length), and cardanoSignTransaction then fails with "Trezor computed a different
 * transaction id".
 */
const toTxOut = (output: { index: number; txOut: Serialization.TransactionOutput; isCollateral?: boolean }, context: TrezorTxTransformerContext): Trezor.CardanoOutput => {
  const txOut = output.txOut.toCore();
  const { knownAddresses, outputsFormat, collateralReturnFormat } = context;

  // Find if this is one of our addresses
  const knownAddress = knownAddresses.find((addr: GroupedAddress) => addr.address === txOut.address);

  const format = output.isCollateral ? collateralReturnFormat : outputsFormat?.[output.index];
  const isBabbage = format === Trezor.PROTO.CardanoTxOutputSerializationFormat.MAP_BABBAGE;

  const baseOutput: Record<string, unknown> = {
    amount: txOut.value.coins.toString(),
    tokenBundle: mapTokenMap(txOut.value.assets),
    format,
    // Datum hash (always included if present)
    datumHash: txOut.datumHash?.toString(),
    // Inline datum (Babbage format only)
    inlineDatum: isBabbage ? getInlineDatum(output.txOut) : undefined,
    // Reference script (Babbage format only)
    referenceScript: isBabbage ? getScriptHex(output.txOut) : undefined,
  };

  // Check if this is a script address (script addresses should always use address string, not addressParameters)
  const address = Cardano.Address.fromString(txOut.address);
  const addressType = address?.getType();
  const isScriptAddress = addressType === Cardano.AddressType.BasePaymentScriptStakeKey ||
                          addressType === Cardano.AddressType.BasePaymentScriptStakeScript ||
                          addressType === Cardano.AddressType.BasePaymentKeyStakeScript ||
                          addressType === Cardano.AddressType.EnterpriseScript ||
                          addressType === Cardano.AddressType.RewardScript;

  if (knownAddress && !isScriptAddress) {
    // Change output (our address, not a script) - use address parameters
    const stakeKeyPathArray = knownAddress.stakeKeyDerivationPath
      ? util.accountKeyDerivationPathToBip32Path(context.accountIndex, knownAddress.stakeKeyDerivationPath, KeyPurpose.STANDARD)
      : undefined;

    const paymentKeyPathArray = util.accountKeyDerivationPathToBip32Path(
      context.accountIndex,
      { role: knownAddress.type === AddressType.External ? KeyRole.External : KeyRole.Internal, index: knownAddress.index },
      KeyPurpose.STANDARD
    );

    baseOutput.addressParameters = {
      addressType: Trezor.PROTO.CardanoAddressType.BASE,
      path: bip32PathToString(paymentKeyPathArray),
      stakingPath: stakeKeyPathArray ? bip32PathToString(stakeKeyPathArray) : undefined,
    };
  } else {
    // External output or script address - use address string
    baseOutput.address = txOut.address;
  }

  return baseOutput as unknown as Trezor.CardanoOutput;
};

const mapTxOuts = (outputs: Serialization.TransactionOutput[], context: TrezorTxTransformerContext): Trezor.CardanoOutput[] =>
  outputs.map((txOut, index) => toTxOut({ index, txOut }, context));

const mapAuxiliaryData = (hash: string): Trezor.CardanoAuxiliaryData => ({
  hash,
  cVoteRegistrationParameters: undefined,
});

/**
 * Transform Cardano SDK transaction body to Trezor format
 * Outputs map from the serialized body, the rest from its Core value (see toTxOut).
 */
const txToTrezor = async (
  txBody: Serialization.TransactionBody,
  context: TrezorTxTransformerContext
): Promise<Omit<Trezor.CardanoSignTransaction, 'signingMode' | 'derivationType'>> => {
  const body = txBody.toCore();
  const collateralReturn = txBody.collateralReturn();
  return {
    inputs: trezorInputs(body.inputs, context.keyContext),
    outputs: mapTxOuts(txBody.outputs(), context),
    fee: body.fee.toString(),
    ttl: body.validityInterval?.invalidHereafter?.toString(),
    protocolMagic: context.chainId.networkMagic,
    networkId: context.chainId.networkId,
    certificates: trezorCertificates(body.certificates, context.keyContext),
    withdrawals: trezorWithdrawals(body.withdrawals, context.keyContext),
    validityIntervalStart: body.validityInterval?.invalidBefore?.toString(),
    auxiliaryData: body.auxiliaryDataHash ? mapAuxiliaryData(body.auxiliaryDataHash) : undefined,
    mint: mapTokenMap(body.mint, true),
    scriptDataHash: body.scriptIntegrityHash?.toString(),
    collateralInputs: body.collaterals ? trezorInputs(body.collaterals, context.keyContext) : undefined,
    requiredSigners: trezorRequiredSigners(body.requiredExtraSignatures, context.keyContext),
    collateralReturn: collateralReturn ? toTxOut({ index: 0, txOut: collateralReturn, isCollateral: true }, context) : undefined,
    totalCollateral: body.totalCollateral?.toString(),
    referenceInputs: body.referenceInputs ? trezorReferenceInputs(body.referenceInputs) : undefined,
    // Not `!!body.networkId`: a testnet's network id is 0, and leaving it out changes the body.
    includeNetworkId: body.networkId !== undefined,
    tagCborSets: context.tagCborSets,
  };
};

export default {
  initialized: false,
  trezorConfig: {
    derivationType: Trezor.PROTO.CardanoDerivationType.ICARUS_TREZOR
  },

  /**
   * Initialize TrezorConnect (lazy initialization)
   * Safe to call multiple times - only initializes once
   * Document-context init: WebUSB primary transport, Bridge as fallback.
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // connect-web opens its UI via window.open(url, 'modal') with NO window
      // features, which Chrome renders as a browser TAB. A tab lingers after the
      // operation and keeps holding the WebUSB device, so back-to-back ops collide
      // with "device is used by another application" / Failure_ActionCancelled.
      // Force a popup WINDOW for connect.trezor.io URLs (features string) — connect
      // owns and closes it after each op, releasing the device. Scoped to Trezor
      // URLs; every other window.open is passed through untouched. Idempotent.
      if (!windowOpenPatchedForTrezor && typeof window !== 'undefined') {
        const nativeOpen = window.open.bind(window);
        window.open = function patchedOpen(url?: string | URL, target?: string, features?: string): Window | null {
          const href = typeof url === 'string' ? url : (url?.href ?? '');
          if (parseSafeUrl(href)?.hostname === 'connect.trezor.io' && !features) {
            return nativeOpen(url as string, target ?? 'modal', 'popup=yes,width=420,height=680');
          }
          return nativeOpen(url as string, target as string, features as string);
        } as typeof window.open;
        windowOpenPatchedForTrezor = true;
      }

      // Force env 'web' + coreMode 'popup'. connect-web auto-detects env
      // 'webextension' whenever chrome.runtime.onConnect exists — true even in this
      // sidepanel/options document — which routes to a browser tab + a connect
      // content-script the package never injects, so the handshake times out. env
      // 'web' takes the window.open + postMessage path instead: the connect core and
      // WebUSB transport run in the popup window (no content-script, no Trezor Bridge
      // daemon). This only works from a document (has window.open), never the SW.
      // env is an internal ConnectSettings field, hence the cast.
      await TrezorConnect.init({
        manifest: TREZOR_MANIFEST,
        transports: ['WebUsbTransport', 'BridgeTransport'],
        connectSrc: 'https://connect.trezor.io/9/',
        coreMode: 'popup',
        env: 'web',
        lazyLoad: true,
      } as Parameters<typeof TrezorConnect.init>[0]);
      this.initialized = true;
    } catch (error) {
      console.error('[TREZOR] Initialization failed:', error);
      throw error;
    }
  },

  /**
   * Get device features including device name/label
   */
  async getFeatures(): Promise<Trezor.Features> {
    await this.init();

    const result = await TrezorConnect.getFeatures();
    if (!result.success) {
      throw new Error(result.payload.error || 'Failed to get device features');
    }

    return result.payload;
  },

  /**
   * Get extended public key for an account
   * Returns in Bech32 format (xpub1...) compatible with Gero Wallet
   */
  async getXpub(path: string): Promise<{
    productName: string;
    btSupported: boolean;
    hwPublicKey: string;
    keys: Array<{ chainCode: string; path: string; publicKey: string }>;
  }> {
    await this.init();

    try {
      // Extract account index from path (e.g., "m/1852'/1815'/0'" -> 0)
      const pathParts = path.split('/');
      const accountIndex = parseInt(pathParts[3].replace(/'/g, ""));

      // Get device name
      const features: Trezor.Features = await this.getFeatures();
      const deviceName = features['label'] || 'Trezor';
      const model = features['model'];

      // Get public key from Trezor. On the connect-web (WebUSB) path the very first
      // call right after the popup opens can resolve success:true with an incomplete
      // payload (node missing) — retry once so pairing succeeds on the first attempt
      // instead of erroring and needing a second click.
      const getKey = () => TrezorConnect.cardanoGetPublicKey({
        path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/${accountIndex}'`,
        showOnTrezor: false, // Don't show on device during pairing
      } as Trezor.CardanoGetPublicKey);

      let res = await getKey();
      if (res.success && !res.payload?.node) {
        res = await getKey();
      }

      if (!res.success) {
        const errorMessage = 'error' in res.payload ? res.payload.error : 'Failed to get Trezor public key';
        throw new Error(errorMessage);
      }
      if (!res.payload?.node) {
        throw new Error('Trezor returned an incomplete public key. Please try again.');
      }

      const chainCode = res.payload.node.chain_code;
      const publicKey = res.payload.node.public_key;
      const bip32PublicKeyHex = res.payload.publicKey;
      const bip32PublicKeyBytes = Buffer.from(bip32PublicKeyHex, 'hex');
      const words = bech32.toWords(bip32PublicKeyBytes);
      const hwPublicKey = bech32.encode('xpub', words, 1023);

      return {
        productName: deviceName,
        btSupported: model.toLowerCase() === 'safe 7',
        hwPublicKey,
        keys: [{
          chainCode,
          path,
          publicKey,
        }]
      };
    } catch (error: unknown) {
      console.error('[TREZOR] Failed to get public key:', error);
      throw error;
    }
  },

  /**
   * Pair several Cardano accounts at once: one bundled request, so the user
   * approves the export once however many accounts are asked for.
   */
  async getAccountXpubs(accountIndices: number[]): Promise<{
    productName: string;
    btSupported: boolean;
    accounts: AccountXpub[];
  }> {
    await this.init();
    const paths = assertAccountIndices(accountIndices).map(cardanoAccountPath);
    const features: Trezor.Features = await this.getFeatures();
    const getKeys = () => TrezorConnect.cardanoGetPublicKey({
      bundle: paths.map((path) => ({ path, showOnTrezor: false })),
    } as unknown as Trezor.BundledParams<Trezor.CardanoGetPublicKey>);
    // Same connect-web quirk as the single-key path above: retry once.
    let res = await getKeys();
    if (res.success && !res.payload?.every((key) => key?.node)) {
      res = await getKeys();
    }
    if (!res.success) {
      throw new Error('error' in res.payload ? res.payload.error : 'Failed to get Trezor public keys');
    }
    if (res.payload.length !== paths.length || !res.payload.every((key) => key?.node)) {
      throw new Error('Trezor returned an incomplete public key. Please try again.');
    }
    return {
      productName: features['label'] || 'Trezor',
      btSupported: features['model'].toLowerCase() === 'safe 7',
      accounts: res.payload.map((key, i) => accountXpub(key.node.public_key, key.node.chain_code, paths[i])),
    };
  },

  /**
   * Gets the mode in which we want to sign the transaction.
   * This function will always return the first matching type depending on the provided data
   * Data is further checked on the Trezor side
   */
  matchSigningMode(tx: Omit<Trezor.CardanoSignTransaction, 'signingMode'>): Trezor.PROTO.CardanoTxSigningMode {
    if (tx['certificates']) {
      for (const cert of tx['certificates']) {
        // Represents pool registration from the perspective of a pool owner.
        if (
          cert.type === Trezor.PROTO.CardanoCertificateType.STAKE_POOL_REGISTRATION &&
          cert.poolParameters?.owners.some((owner) => owner.stakingKeyPath)
        )
          return Trezor.PROTO.CardanoTxSigningMode.POOL_REGISTRATION_AS_OWNER;
      }
    }

    /** Plutus signing mode has a broader usage e.g. multisig tx that contains referenceInputs is marked as plutus */
    if (tx['collateralInputs'] || tx['collateralReturn'] || tx['totalCollateral'] || tx['referenceInputs']) {
      return Trezor.PROTO.CardanoTxSigningMode.PLUTUS_TRANSACTION;
    }

    // Represents a transaction controlled by native scripts.
    // Like an ordinary transaction, but stake credentials and all similar elements are given as script hashes
    if (isMultiSig(tx)) {
      return Trezor.PROTO.CardanoTxSigningMode.MULTISIG_TRANSACTION;
    }

    // Represents an ordinary user transaction transferring funds.
    return Trezor.PROTO.CardanoTxSigningMode.ORDINARY_TRANSACTION;
  },

  /**
   * Sign a Cardano transaction (CIP-30 / hardware-trezor signing pipeline)
   */
  async cardanoSignTransaction(
    tx: Cardano.Tx,
    keys: Keys,
    utxos: Cardano.Utxo[],
    isUsb: boolean,
    network: NetworkInfo,
    xPub: string,
    originalTxCbor?: string,
  ): Promise<Cardano.Signatures> {
    await this.init();
    // Use original CBOR if provided (for multisig) to preserve exact byte representation
    // This is critical for multisig transactions where another party has already signed the original bytes
    const deserializedTx: Serialization.Transaction = originalTxCbor
      ? Serialization.Transaction.fromCbor(Serialization.TxCBOR(originalTxCbor))
      : Serialization.Transaction.fromCore(tx);
    assertTrezorCanSign(deserializedTx);
    const accountIndex = accountIndexFromKeys(keys);
    const knownAddresses: GroupedAddress[] = this.createKnownAddressesFromKeys(keys, network);

    // Validate that we have known addresses
    if (!knownAddresses || knownAddresses.length === 0) {
      throw new Error(
        '[Trezor] No known addresses available. Cannot create transaction context. ' +
        'Please ensure your wallet is properly initialized.'
      );
    }

    // Which keys sign is the shared plan's rule (keyCreds.ts), as for software wallets and Keystone.
    const keyContext = trezorKeyContext(keys, utxos);
    const walletPaths = walletWitnessPaths(deserializedTx.toCore(), keys, utxos);

    const txBody: Serialization.TransactionBody = deserializedTx.body();
    try {
      const hash = txBody.hash() as unknown as HexBlob;

      const outputsFormat = txBody
        .outputs()
        .map((out) =>
          out.isBabbageOutput()
            ? Trezor.PROTO.CardanoTxOutputSerializationFormat.MAP_BABBAGE
            : Trezor.PROTO.CardanoTxOutputSerializationFormat.ARRAY_LEGACY
        );
      const collateralReturnFormat = txBody.collateralReturn()?.isBabbageOutput()
        ? Trezor.PROTO.CardanoTxOutputSerializationFormat.MAP_BABBAGE
        : Trezor.PROTO.CardanoTxOutputSerializationFormat.ARRAY_LEGACY;

      const trezorTxData: Omit<Trezor.CardanoSignTransaction, 'signingMode'> = await txToTrezor(txBody, {
        accountIndex,
        chainId: {
          networkId: network.networkId,
          networkMagic: network.networkParams.networkMagic
        },
        collateralReturnFormat,
        knownAddresses,
        outputsFormat,
        tagCborSets: txBody.hasTaggedSets(),
        keyContext,
      });

      const signingMode = this.matchSigningMode(trezorTxData);

      const isMultiSigMode = signingMode === Trezor.PROTO.CardanoTxSigningMode.MULTISIG_TRANSACTION;
      // The device witnesses each path the request carries; ask only for the plan's others.
      const additionalWitnessRequests = isMultiSigMode
        ? multiSigWitnessPaths(accountIndex).map(path => bip32PathToString(path))
        : extraWitnessRequests(trezorTxData, walletPaths);

      const fullTrezorParams = {
        ...trezorTxData,
        additionalWitnessRequests,
        signingMode,
        ...(this.trezorConfig.derivationType
          ? {
            derivationType: mapDerivationType(this.trezorConfig.derivationType)
          }
          : {})
      };

      const result = await TrezorConnect.cardanoSignTransaction(fullTrezorParams);

      // The keys the plan signs with, derived from the account xpub (a Plutus transaction keeps
      // every witness, a multisig one its multisig key, below).
      const expectedPublicKeys = isMultiSigMode || signingMode === Trezor.PROTO.CardanoTxSigningMode.PLUTUS_TRANSACTION
        ? []
        : walletPaths.map((path) => this.derivePublicKeyFromXpub(xPub, accountKeyIndices(path) as AccountKeyDerivationPath));

      if (!result.success) {
        throw new errors.TransportError('Failed to export extended account public key', result.payload);
      }

      const signedData = result.payload;

      if (!areStringsEqualInConstantTime(signedData.hash, hash)) {
        throw new errors.HwMappingError(
          `Trezor computed a different transaction id: ${signedData.hash} than expected: ${hash}`
        );
      }

      // Convert witnesses to signatures map
      const witnessesArray = signedData.witnesses || [];
      if (isMultiSigMode && witnessesArray.length > 0) {
        // The stored xpub is 1852', so it cannot identify the 1854' witness.
        // Export this account's multisig xpub and keep the same strict filter.
        const exported = await TrezorConnect.cardanoGetPublicKey({
          path: `m/1854'/1815'/${accountIndex}'`,
          showOnTrezor: false,
          derivationType: fullTrezorParams.derivationType,
        });
        if (!exported.success) {
          throw new errors.TransportError('Failed to export multisig account public key', exported.payload);
        }
        if (!/^[0-9a-f]{128}$/i.test(exported.payload.publicKey)) {
          throw new errors.HwMappingError('Trezor returned an invalid multisig account public key');
        }
        const multisigXpub = bech32.encode('xpub', bech32.toWords(Buffer.from(exported.payload.publicKey, 'hex')), 1023);
        expectedPublicKeys.splice(0, expectedPublicKeys.length,
          this.derivePublicKeyFromXpub(multisigXpub, { role: KeyRole.External, index: 0 }));
      }
      const signatures = new Map<Ed25519PublicKeyHex, Ed25519SignatureHex>();

      for (const witness of witnessesArray) {
        const publicKey = Ed25519PublicKeyHex(witness.pubKey);
        const signature = Ed25519SignatureHex(witness.signature);

        // For Plutus transactions, trust ALL signatures from Trezor
        // Trezor analyzes the transaction structure and signs with the correct keys
        // This includes script inputs, collateral, and other Plutus-specific signing requirements
        if (signingMode === Trezor.PROTO.CardanoTxSigningMode.PLUTUS_TRANSACTION) {
          signatures.set(publicKey, signature);
        } else if (expectedPublicKeys.includes(publicKey)) {
          // For non-Plutus transactions, only include expected signatures (security measure)
          signatures.set(publicKey, signature);
        }
      }

      return signatures;
    } catch (error: unknown) {
      const innerErrorCode = (error as { innerError?: { code?: string } } | undefined)?.innerError?.code;
      if (innerErrorCode === 'Failure_ActionCancelled') {
        throw new errors.AuthenticationError('Transaction signing aborted', error);
      }
      throw transportTypedError(error);
    }
  },

  /**
   * Derive public key from xPub for a given derivation path
   * This avoids calling Trezor device for each public key
   */
  derivePublicKeyFromXpub(xPub: string, derivationPath: AccountKeyDerivationPath): Ed25519PublicKeyHex {
    try {
      // Get Bip32PublicKey from xPub string
      const bip32PubKey = getPublicKey(xPub);

      // Derive the child key using the derivation path
      const childKey = bip32PubKey.derive([derivationPath.role, derivationPath.index]);

      // Get the raw Ed25519 public key and convert to hex
      const rawKey = childKey.toRawKey();
      const publicKeyHex: Ed25519PublicKeyHex = rawKey.hex();

      return publicKeyHex;
    } catch (error) {
      console.error('[TREZOR] Failed to derive public key from xPub:', error);
      throw error;
    }
  },

  /**
   * Sign arbitrary data (CIP-8 / CIP-30)
   * @param address - Address to sign with
   * @param payload - Data to sign (hex)
   * @param networkId - Network Id
   * @param keys - The wallet's keys; the signing path is the matched key's
   */
  async cardanoSignMessage(
    address: string,
    payload: string,
    networkId: number,
    keys: Keys,
  ): Promise<{
    signatureHex: string;
    signingPublicKeyHex: string;
    addressFieldHex: string;
  }> {
    await this.init();

    try {
      // Normalize address to bech32 for matching against wallet keys
      // DApps may pass hex (CIP-30 spec) or bech32 — keys store bech32
      let normalizedAddress = address;
      if (!address.startsWith('addr') && !address.startsWith('stake')) {
        try {
          const addressBytes = Buffer.from(address, 'hex');
          normalizedAddress = Cardano.Address.fromBytes(addressBytes).toBech32();
        } catch {
          // Keep original if conversion fails
        }
      }

      // Only sign for an address this wallet actually owns. Search payment,
      // change, AND stake keys (mirrors the PRF signData path). A dApp-supplied
      // address that matches none must be REJECTED — never fall back to signing
      // with the stake key over an arbitrary payload for an address we don't own.
      const matchingKey =
        keys.payment.find(key => key.address === normalizedAddress) ||
        keys.change.find(key => key.address === normalizedAddress) ||
        keys.stake.find(key => key.address === normalizedAddress);

      if (!matchingKey?.path) {
        throw new Error('Address not found in wallet keys');
      }
      const derivationPath: string = matchingKey.path;

      // Sign the message with Trezor using the correct parameter structure
      const result = await TrezorConnect.cardanoSignMessage({
        path: derivationPath,
        payload,  // Required: hex-encoded payload
        networkId,
        hashPayload: false,  // Don't hash, the payload is already in correct format
      } as Trezor.CardanoSignMessage);

      if (!result.success) {
        const errorMessage = 'error' in result.payload ? result.payload.error : 'Failed to sign data';
        throw new Error(errorMessage);
      }

      // Convert response to expected format for CIP-8/CIP-30
      // The website expects COSE-formatted data (CBOR Object Signing and Encryption)
      // Trezor returns both plain and COSE-formatted values:
      //   - coseKey: COSE_Key formatted public key
      //   - coseSignature: COSE_Sign1 formatted signature
      return {
        signatureHex: result.payload.coseSignature,  // Use COSE_Sign1 format
        signingPublicKeyHex: result.payload.coseKey,  // Use COSE_Key format
        addressFieldHex: address,  // Address is already in hex format
      };

    } catch (error: unknown) {
      console.error('[TREZOR] Data signing failed:', error);
      throw error;
    }
  },

  /**
   * Create GroupedAddress[] from a Keys object for Trezor transaction context
   * Maps wallet keys to the format expected by TrezorTxTransformerContext
   */
  createKnownAddressesFromKeys(keys: Keys, network: NetworkInfo): GroupedAddress[] {
    const knownAddresses: GroupedAddress[] = [];
    const accountIndex = accountIndexFromKeys(keys);

    // Process payment addresses (External)
    keys.payment.forEach((key: Key, _arrayIndex: number) => {
      if (key.address && key.path) {
        try {
          const networkId = network.networkId === 1 ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;
          const pathArray = hdPathToArray(key.path);
          const derivationIndex = pathArray[pathArray.length - 1]; // Last index in the path

          knownAddresses.push({
            type: AddressType.External, // Payment addresses are external
            index: derivationIndex,
            networkId,
            accountIndex,
            address: key.address as Cardano.PaymentAddress,
            rewardAccount: toStakeAddress(key.address, networkId) as Cardano.RewardAccount,
            stakeKeyDerivationPath: this.getStakeKeyDerivationPath(key, keys.stake)
          });
        } catch (error) {
          console.warn(`[TREZOR] Failed to process payment address ${key.address}:`, error);
        }
      }
    });

    // Process change addresses (Internal)
    keys.change.forEach((key: Key, _arrayIndex: number) => {
      if (key.address && key.path) {
        try {
          const networkId = network.networkId === 1 ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;
          const pathArray = hdPathToArray(key.path);
          const derivationIndex = pathArray[pathArray.length - 1]; // Last index in the path
          knownAddresses.push({
            type: AddressType.Internal, // Change addresses are internal
            index: derivationIndex,
            networkId,
            accountIndex,
            address: key.address as Cardano.PaymentAddress,
            rewardAccount: toStakeAddress(key.address, networkId) as Cardano.RewardAccount,
            stakeKeyDerivationPath: this.getStakeKeyDerivationPath(key, keys.stake)
          });
        } catch (error) {
          console.warn(`[TREZOR] Failed to process change address ${key.address}:`, error);
        }
      }
    });

    // Process stake/reward addresses
    if (keys.stake && keys.stake.length > 0) {
      keys.stake.forEach((key: Key, _arrayIndex: number) => {
        if (key.address && key.path) {
          try {
            const networkId = network.networkId === 1 ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;
            const pathArray = hdPathToArray(key.path);
            const derivationIndex = pathArray[pathArray.length - 1]; // Last index in the path

            // For stake addresses, we add them as reward accounts
            knownAddresses.push({
              type: AddressType.External, // Stake addresses use External type
              index: derivationIndex,
              networkId,
              accountIndex,
              address: key.address as Cardano.PaymentAddress, // The stake address itself
              rewardAccount: key.address as Cardano.RewardAccount, // Same as address for stake keys
              stakeKeyDerivationPath: {
                role: KeyRole.Stake,
                index: derivationIndex
              } as AccountKeyDerivationPath
            });
          } catch (error) {
            console.warn(`[TREZOR] Failed to process stake address ${key.address}:`, error);
          }
        }
      });
    }

    return knownAddresses;
  },

  /**
   * Get a stake key derivation path for a payment address
   */
  getStakeKeyDerivationPath(paymentKey: Key, stakeKeys: Key[]): AccountKeyDerivationPath | undefined {
    try {
      // Find the associated stake key for this payment address
      const paymentAddress: Cardano.Address = Cardano.Address.fromString(paymentKey.address);

      if (paymentAddress.getType() === Cardano.AddressType.BasePaymentKeyStakeKey ||
        paymentAddress.getType() === Cardano.AddressType.BasePaymentScriptStakeKey) {

        // For base addresses, we need to provide a stake key derivation path
        // Since asReward() is returning undefined, let's use the first available stake key
        if (stakeKeys && stakeKeys.length > 0 && stakeKeys[0].path) {
          const pathArray = hdPathToArray(stakeKeys[0].path);
          return {
            role: KeyRole.Stake,
            index: pathArray[pathArray.length - 1] // The last element is the index
          } as AccountKeyDerivationPath;
        }
      }

      return undefined; // No stake key derivation path for enterprise addresses
    } catch (error) {
      console.warn('[TREZOR] Failed to get stake key derivation path:', error);
      return undefined;
    }
  },


  // ============================================================================
  // BITCOIN TREZOR INTEGRATION
  // ============================================================================

  /**
   * Initialize Bitcoin Trezor connection and get the account's extended public key
   * @param addressType - Bitcoin address type ('legacy', 'segwit', 'taproot')
   * @param accountIndex - Account index (default 0)
   * @param network - The wallet's network: picks Connect's coin and the path's coin type
   * @returns Bitcoin xpub, in the wallet's form, and device info
   */
  async initBitcoinTrezor(addressType: string = 'segwit', accountIndex: number = 0, network: string = 'Mainnet'): Promise<{
    xpub: string;
    deviceLabel: string;
    firmwareVersion: string;
  }> {
    await this.init();

    // Loaded here so the Cardano paths that use this module don't bundle Bitcoin's crypto.
    const { toAccountXpub } = await import('@/chains/bitcoin/bitcoinKeyManager');

    const result = await TrezorConnect.getPublicKey({
      path: bitcoinAccountPath(network, addressType, accountIndex),
      coin: trezorCoin(network),
      crossChain: false,
    });

    if (!result.success) {
      throw new Error(result.payload.error || 'Failed to get Bitcoin public key from Trezor');
    }

    // Get device features for device info
    const features = await TrezorConnect.getFeatures();
    const deviceLabel = features.success ? features.payload.label : 'Trezor';
    const firmwareVersion = features.success
      ? `${features.payload.major_version}.${features.payload.minor_version}.${features.payload.patch_version}`
      : 'Unknown';

    return {
      // On testnet the device answers with a tpub; the wallet stores every account key as an xpub.
      xpub: toAccountXpub(result.payload.xpub),
      deviceLabel,
      firmwareVersion,
    };
  },

  /**
   * Get Bitcoin address from Trezor with optional verification on device screen
   * @param addressType - Bitcoin address type
   * @param accountIndex - Account index
   * @param addressIndex - Address index
   * @param isChange - Internal (change) address or external (receive)
   * @param verify - Display address on device for verification
   * @param network - The wallet's network: picks Connect's coin and the path's coin type
   * @returns Bitcoin address
   */
  async getAddress(
    addressType: string = 'segwit',
    accountIndex: number = 0,
    addressIndex: number = 0,
    isChange: boolean = false,
    verify: boolean = false,
    network: string = 'Mainnet'
  ): Promise<string> {
    await this.init();

    const path = bitcoinAddressPath(network, addressType, accountIndex, isChange, addressIndex);
    let scriptType: 'SPENDADDRESS' | 'SPENDMULTISIG' | 'SPENDWITNESS' | 'SPENDP2SHWITNESS' | 'SPENDTAPROOT';

    switch (addressType) {
      case 'legacy':
        scriptType = 'SPENDADDRESS'; // P2PKH
        break;
      case 'taproot':
        scriptType = 'SPENDTAPROOT'; // P2TR
        break;
      case 'segwit':
      default:
        scriptType = 'SPENDWITNESS'; // P2WPKH
        break;
    }

    const result = await TrezorConnect.getAddress({
      path,
      coin: trezorCoin(network),
      showOnTrezor: verify,
      scriptType,
    });

    if (!result.success) {
      throw new Error(result.payload.error || 'Failed to get Bitcoin address from Trezor');
    }

    return result.payload.address;
  },

  /**
   * Sign a Bitcoin transaction (PSBT) with the Trezor's account
   * @param psbt - Unsigned PSBT, hex or base64
   * @param account - The wallet's account: its xpub, network, address type and index
   * @returns The same PSBT with the device's signatures, in hex (not finalized)
   */
  // Note: this is the BITCOIN sign (PSBT); the Cardano sign is `cardanoSignTransaction` above.
  async signTransaction(psbt: string, account: BitcoinHardwareAccount): Promise<string> {
    await this.init();

    // Loaded here so the Cardano paths that use this module don't bundle Bitcoin's crypto.
    const { mergeTrezorSignatures, parseBitcoinPsbt, trezorSignTransactionParams } = await import('@/chains/bitcoin/trezorPsbt');
    const unsigned = parseBitcoinPsbt(psbt, account.network);
    const result = await TrezorConnect.signTransaction(trezorSignTransactionParams(unsigned, account));

    if (!result.success) {
      throw new Error(result.payload.error || 'Failed to sign Bitcoin transaction with Trezor');
    }

    return mergeTrezorSignatures(unsigned, result.payload.serializedTx).toHex();
  },

  /**
   * Verify Bitcoin address on Trezor device screen
   * @param addressType - Bitcoin address type
   * @param accountIndex - Account index
   * @param addressIndex - Address index
   * @param isChange - Internal or external address
   * @param network - The wallet's network
   */
  async verifyBitcoinAddress(
    addressType: string = 'segwit',
    accountIndex: number = 0,
    addressIndex: number = 0,
    isChange: boolean = false,
    network: string = 'Mainnet'
  ): Promise<string> {
    return await this.getAddress(addressType, accountIndex, addressIndex, isChange, true, network);
  },
};
