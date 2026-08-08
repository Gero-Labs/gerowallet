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
  TxInId,
  util,
} from '@cardano-sdk/key-management';
import { bech32 } from 'bech32';
import { NetworkInfo } from '@/utils/networks';
import { BIP32Path, Ed25519KeyHashHex, Ed25519PublicKeyHex, Ed25519SignatureHex } from '@cardano-sdk/crypto';
import { areStringsEqualInConstantTime, HexBlob } from '@cardano-sdk/util';
import { debugLog } from '@/utils/debug';

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
  txInKeyPathMap: Record<string, AccountKeyDerivationPath>;
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

const multiSigWitnessPaths: BIP32Path[] = [
  util.accountKeyDerivationPathToBip32Path(0, { index: 0, role: KeyRole.External }, KeyPurpose.MULTI_SIG)
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
 * Trezor transaction transformer - converts Cardano SDK transaction to Trezor format
 * This is adapted from @cardano-sdk/hardware-trezor internal transformers
 */
const resolvePaymentKeyPathForTxIn = (txIn: Cardano.TxIn, context: TrezorTxTransformerContext): string | undefined => {
  if (!context) return undefined;

  // Use official TxInId utility from key-management package
  const txInId = TxInId(txIn);
  const keyPath = context.txInKeyPathMap[txInId];
  if (!keyPath) return undefined;

  const bip32Path = util.accountKeyDerivationPathToBip32Path(
    context.accountIndex,
    keyPath,
    KeyPurpose.STANDARD
  );

  return bip32PathToString(bip32Path);
};

const toTrezorTxIn = (txIn: Cardano.TxIn, context: TrezorTxTransformerContext): Trezor.CardanoInput => {
  const path = resolvePaymentKeyPathForTxIn(txIn, context);
  return {
    path,
    prev_hash: txIn.txId,
    prev_index: txIn.index
  };
};

const mapTxIns = (txIns: Cardano.TxIn[], context: TrezorTxTransformerContext): Trezor.CardanoInput[] =>
  txIns.map((txIn) => toTrezorTxIn(txIn, context));

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
 * Get script reference from transaction output in CBOR format
 * Matches official SDK implementation from txOut.ts
 */
const getScriptHex = (output: Serialization.TransactionOutput): string | undefined => {
  const scriptRef = output.scriptRef();
  if (!scriptRef) return undefined;
  return scriptRef.toCbor();
};

/**
 * Convert inline datum to CBOR format for Trezor
 * Matches official SDK implementation from txOut.ts
 */
const getInlineDatum = (datum: Cardano.PlutusData): string => {
  return Serialization.PlutusData.fromCore(datum).toCbor();
};

/**
 * Convert TxOut to Trezor format with Babbage-era support
 * Includes inline datum and reference script handling
 */
const toTxOut = (output: { index: number; txOut: Cardano.TxOut; isCollateral?: boolean }, context: TrezorTxTransformerContext): Trezor.CardanoOutput => {
  const { txOut } = output;
  const { knownAddresses, outputsFormat, collateralReturnFormat } = context;

  // Find if this is one of our addresses
  const knownAddress = knownAddresses.find((addr: GroupedAddress) => addr.address === txOut.address);

  const format = output.isCollateral ? collateralReturnFormat : outputsFormat?.[output.index];
  const isBabbage = format === Trezor.PROTO.CardanoTxOutputSerializationFormat.MAP_BABBAGE;

  // Serialize the output to access script reference
  const serializedOutput = Serialization.TransactionOutput.fromCore(txOut);
  const scriptHex = getScriptHex(serializedOutput);

  const baseOutput: Record<string, unknown> = {
    amount: txOut.value.coins.toString(),
    tokenBundle: mapTokenMap(txOut.value.assets),
    format,
    // Datum hash (always included if present)
    datumHash: txOut.datumHash?.toString(),
    // Inline datum (Babbage format only)
    inlineDatum: isBabbage && txOut.datum ? getInlineDatum(txOut.datum) : undefined,
    // Reference script (Babbage format only)
    referenceScript: isBabbage ? scriptHex : undefined,
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
      ? util.accountKeyDerivationPathToBip32Path(0, knownAddress.stakeKeyDerivationPath, KeyPurpose.STANDARD)
      : undefined;

    const paymentKeyPathArray = util.accountKeyDerivationPathToBip32Path(
      0,
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

const mapTxOuts = (outputs: Cardano.TxOut[], context: TrezorTxTransformerContext): Trezor.CardanoOutput[] =>
  outputs.map((txOut, index) => toTxOut({ index, txOut }, context));

const mapDRep = (dRep: Cardano.DelegateRepresentative | undefined): Trezor.CardanoDRep | undefined => {
  if (!dRep) return undefined;

  // DelegateRepresentative is a discriminated union of Credential | AlwaysAbstain | AlwaysNoConfidence
  if ('__typename' in dRep) {
    switch (dRep.__typename) {
      case 'AlwaysAbstain':
        return { type: Trezor.PROTO.CardanoDRepType.ABSTAIN };
      case 'AlwaysNoConfidence':
        return { type: Trezor.PROTO.CardanoDRepType.NO_CONFIDENCE };
    }
  }

  // If it's a Credential type (has 'type' and 'hash' properties)
  if ('type' in dRep && 'hash' in dRep) {
    return {
      type: dRep.type === Cardano.CredentialType.KeyHash
        ? Trezor.PROTO.CardanoDRepType.KEY_HASH
        : Trezor.PROTO.CardanoDRepType.SCRIPT_HASH,
      keyHash: dRep.type === Cardano.CredentialType.KeyHash ? dRep.hash : undefined,  // Note: Trezor uses snake_case
      scriptHash: dRep.type === Cardano.CredentialType.ScriptHash ? dRep.hash : undefined,  // Note: Trezor uses snake_case
    };
  }

  return undefined;
};

const mapCerts = (certificates: Cardano.Certificate[]): Trezor.CardanoCertificate[] | undefined => {
  if (!certificates || certificates.length === 0) return undefined;

  return certificates.map((cert: Cardano.Certificate, index) => {
    debugLog(`[TREZOR] Processing certificate ${index}: ${cert.__typename}`);
    const stakeKeyPathArray = util.accountKeyDerivationPathToBip32Path(0, { role: KeyRole.Stake, index: 0 }, KeyPurpose.STANDARD);
    const stakeKeyPath = bip32PathToString(stakeKeyPathArray);

    // Vote delegation (Conway-era)
    if (cert.__typename === Cardano.CertificateType.VoteDelegation) {
      debugLog('[TREZOR] Mapping VoteDelegation certificate');

      return {
        type: Trezor.PROTO.CardanoCertificateType.VOTE_DELEGATION,
        path: stakeKeyPath,
        dRep: mapDRep(cert.dRep),
      };
    }

    // Standard stake delegation
    if (cert.__typename === Cardano.CertificateType.StakeDelegation) {
      debugLog('[TREZOR] Mapping StakeDelegation certificate');
      // Convert pool ID from bech32 to hex
      const poolIdHex = Cardano.PoolId.toKeyHash(cert.poolId);

      return {
        type: Trezor.PROTO.CardanoCertificateType.STAKE_DELEGATION,
        path: stakeKeyPath,
        pool: poolIdHex,
        dRep: undefined,
        deposit: undefined,
        keyHash: undefined,
        poolParameters: undefined,
        scriptHash: undefined,
      };
    }

    // Conway-era registration
    if (cert.__typename === Cardano.CertificateType.Registration) {
      debugLog('[TREZOR] Mapping Registration certificate (Conway)');
      return {
        type: Trezor.PROTO.CardanoCertificateType.STAKE_REGISTRATION_CONWAY,
        path: stakeKeyPath,
        deposit: cert.deposit?.toString(),
        dRep: undefined,
        keyHash: undefined,
        pool: undefined,
        poolParameters: undefined,
        scriptHash: undefined,
      };
    }

    // Legacy registration
    if (cert.__typename === Cardano.CertificateType.StakeRegistration) {
      return {
        type: Trezor.PROTO.CardanoCertificateType.STAKE_REGISTRATION,
        path: stakeKeyPath,
        dRep: undefined,
        deposit: undefined,
        keyHash: undefined,
        pool: undefined,
        poolParameters: undefined,
        scriptHash: undefined,
      };
    }

    // Conway-era unregistration
    if (cert.__typename === Cardano.CertificateType.Unregistration) {
      return {
        type: Trezor.PROTO.CardanoCertificateType.STAKE_DEREGISTRATION_CONWAY,
        path: stakeKeyPath,
        deposit: cert.deposit?.toString(),
        dRep: undefined,
        keyHash: undefined,
        pool: undefined,
        poolParameters: undefined,
        scriptHash: undefined,
      };
    }

    // Legacy deregistration
    if (cert.__typename === Cardano.CertificateType.StakeDeregistration) {
      return {
        type: Trezor.PROTO.CardanoCertificateType.STAKE_DEREGISTRATION,
        path: stakeKeyPath,
        dRep: undefined,
        deposit: undefined,
        keyHash: undefined,
        pool: undefined,
        poolParameters: undefined,
        scriptHash: undefined,
      };
    }

    // Combined certificates are not supported by Trezor firmware
    // These must be decomposed into individual certificates for Trezor compatibility
    if (cert.__typename === Cardano.CertificateType.StakeVoteRegistrationDelegation) {
      throw new Error(
        `[Trezor] Combined certificate type '${cert.__typename}' is not supported by Trezor hardware. ` +
        'This operation requires separate certificates for registration and delegation. ' +
        'Please try again or contact support if the issue persists.'
      );
    }

    if (cert.__typename === Cardano.CertificateType.StakeVoteDelegation) {
      throw new Error(
        `[Trezor] Combined certificate type '${cert.__typename}' is not supported by Trezor hardware. ` +
        'This operation requires separate certificates for stake and vote delegation. ' +
        'Please try again or contact support if the issue persists.'
      );
    }

    if (cert.__typename === Cardano.CertificateType.StakeRegistrationDelegation) {
      throw new Error(
        `[Trezor] Combined certificate type '${cert.__typename}' is not supported by Trezor hardware. ` +
        'This operation requires separate certificates for registration and delegation. ' +
        'Please try again or contact support if the issue persists.'
      );
    }

    if (cert.__typename === Cardano.CertificateType.VoteRegistrationDelegation) {
      throw new Error(
        `[Trezor] Combined certificate type '${cert.__typename}' is not supported by Trezor hardware. ` +
        'This operation requires separate certificates for registration and delegation. ' +
        'Please try again or contact support if the issue persists.'
      );
    }

    throw new Error(`Unsupported certificate type: ${cert.__typename}`);
  });
};

/**
 * Resolve stake key path for a withdrawal reward address
 * Matches official SDK implementation from keyPaths.ts
 */
const resolveStakeKeyPath = (
  rewardAddress: Cardano.RewardAddress,
  knownAddresses: GroupedAddress[]
): string | null => {
  // Find matching known address by reward account
  const knownAddress = knownAddresses.find(
    ({ rewardAccount }) => rewardAccount === rewardAddress.toAddress().toBech32()
  );

  // Get the stake key path from the matched address
  if (!knownAddress) return null;

  const stakeKeyPath = util.stakeKeyPathFromGroupedAddress(knownAddress);
  if (!stakeKeyPath) return null;

  // Type guard: ensure we have a valid AccountKeyDerivationPath (not a BIP32Path array)
  if (typeof stakeKeyPath === 'object' && !Array.isArray(stakeKeyPath) && 'role' in stakeKeyPath && 'index' in stakeKeyPath) {
    // Convert to BIP32 path string
    const bip32Path: BIP32Path = util.accountKeyDerivationPathToBip32Path(
      0,
      stakeKeyPath as AccountKeyDerivationPath,
      KeyPurpose.STANDARD
    );

    return bip32PathToString(bip32Path);
  }

  return null;
};

/**
 * Transform Cardano withdrawal to Trezor format
 * Matches official SDK implementation from withdrawals.ts
 */
const toTrezorWithdrawal = (withdrawal: Cardano.Withdrawal, context: TrezorTxTransformerContext): Trezor.CardanoWithdrawal => {
  const address = Cardano.Address.fromString(withdrawal.stakeAddress);
  const rewardAddress = address?.asReward();

  if (!rewardAddress) {
    throw new Error('Invalid withdrawal stake address');
  }

  // Use constant-time comparison for credential type (prevents timing attacks)
  if (areStringsEqualInConstantTime(
    rewardAddress.getPaymentCredential().type.toString(),
    Cardano.CredentialType.KeyHash.toString()
  )) {
    // Key hash credential - try to resolve path
    const keyPath = context?.knownAddresses
      ? resolveStakeKeyPath(rewardAddress, context.knownAddresses)
      : null;

    return keyPath
      ? {
          amount: withdrawal.quantity.toString(),
          keyHash: undefined,
          path: keyPath,
          scriptHash: undefined,
        }
      : {
          amount: withdrawal.quantity.toString(),
          keyHash: rewardAddress.getPaymentCredential().hash.toString(),
          path: undefined,
          scriptHash: undefined,
        };
  } else {
    // Script hash credential
    return {
      amount: withdrawal.quantity.toString(),
      keyHash: undefined,
      path: undefined,
      scriptHash: rewardAddress.getPaymentCredential().hash.toString(),
    };
  }
};

/**
 * Map withdrawals array to Trezor format
 * Matches official SDK implementation from withdrawals.ts
 */
const mapWithdrawals = (withdrawals?: Cardano.Withdrawal[], context?: TrezorTxTransformerContext): Trezor.CardanoWithdrawal[] | undefined => {
  return withdrawals
    ? withdrawals.map((withdrawal) => toTrezorWithdrawal(withdrawal, context!))
    : undefined;
};

const mapAuxiliaryData = (hash: string): Trezor.CardanoAuxiliaryData => ({
  hash,
  cVoteRegistrationParameters: undefined,
});

/**
 * Map required signers to Trezor format
 * Tries to match keyHash against both payment and stake credentials
 * Returns keyPath if found in known addresses, otherwise returns keyHash
 */
const toRequiredSigner = (keyHash: Ed25519KeyHashHex, context?: TrezorTxTransformerContext): Trezor.CardanoRequiredSigner => {
  if (!context || !context.knownAddresses) {
    return { keyHash, keyPath: undefined };
  }

  // Try to match against payment credentials
  const paymentCredKnownAddress = context.knownAddresses.find((address: GroupedAddress) => {
    const addr = Cardano.Address.fromBech32(address.address)?.asBase();
    const paymentCredential = addr?.getPaymentCredential().hash;
    return !!paymentCredential && areStringsEqualInConstantTime(paymentCredential.toString(), keyHash);
  });

  // Try to match against stake credentials
  const stakeCredKnownAddress = context.knownAddresses.find((address: GroupedAddress) => {
    const stakeCredential = Cardano.RewardAccount.toHash(address.rewardAccount);
    return !!stakeCredential && areStringsEqualInConstantTime(stakeCredential.toString(), keyHash);
  });

  // If we found a payment credential match, return payment key path
  if (paymentCredKnownAddress) {
    const paymentKeyPath = util.paymentKeyPathFromGroupedAddress(paymentCredKnownAddress);
    if (paymentKeyPath && typeof paymentKeyPath === 'object' && !Array.isArray(paymentKeyPath) && 'role' in paymentKeyPath && 'index' in paymentKeyPath) {
      const bip32Path: BIP32Path = util.accountKeyDerivationPathToBip32Path(
        context.accountIndex,
        paymentKeyPath as AccountKeyDerivationPath,
        KeyPurpose.STANDARD
      );
      return {
        keyHash: undefined,
        keyPath: bip32PathToString(bip32Path),
      };
    }
  }

  // If we found a stake credential match, return stake key path
  if (stakeCredKnownAddress) {
    const stakeKeyPath = util.stakeKeyPathFromGroupedAddress(stakeCredKnownAddress);
    if (stakeKeyPath && typeof stakeKeyPath === 'object' && !Array.isArray(stakeKeyPath) && 'role' in stakeKeyPath && 'index' in stakeKeyPath) {
      const bip32Path: BIP32Path = util.accountKeyDerivationPathToBip32Path(
        context.accountIndex,
        stakeKeyPath as AccountKeyDerivationPath,
        KeyPurpose.STANDARD
      );
      return {
        keyHash: undefined,
        keyPath: bip32PathToString(bip32Path),
      };
    }
  }

  // If no match found, return the keyHash
  return {
    keyHash,
    keyPath: undefined,
  };
};

const mapRequiredSigners = (requiredSigners?: Ed25519KeyHashHex[], context?: TrezorTxTransformerContext): Trezor.CardanoRequiredSigner[] | undefined => {
  if (!requiredSigners || requiredSigners.length === 0) return undefined;

  return requiredSigners.map(keyHash => toRequiredSigner(keyHash, context));
};

/**
 * Map additional witness requests (stake key path when needed)
 * Additional witnesses are signatures that Trezor cannot automatically derive from transaction inputs
 *
 * NOTE: Payment key paths should NOT be included here because they are already in the inputs!
 * Including them here causes invalid signatures.
 *
 * Stake key signature is only required for transactions with certificates or withdrawals
 */
const mapAdditionalWitnessRequests = (body: Cardano.TxBody, context: TrezorTxTransformerContext): string[] | undefined => {
  if (!context || !context.knownAddresses || context.knownAddresses.length === 0) {
    return undefined;
  }

  // Only add stake key path if transaction has certificates or withdrawals
  // These are the only cases where stake key signature is required as an ADDITIONAL witness
  const hasCertificates = body.certificates && body.certificates.length > 0;
  const hasWithdrawals = body.withdrawals && body.withdrawals.length > 0;

  if (hasCertificates || hasWithdrawals) {
    // util.stakeKeyPathFromGroupedAddress sometimes returns a BIP32Path array instead of AccountKeyDerivationPath,
    // so we manually construct the stake key path for reliability
    const stakeKeyPath = util.accountKeyDerivationPathToBip32Path(
      context.accountIndex,
      { role: KeyRole.Stake, index: 0 } as AccountKeyDerivationPath,
      KeyPurpose.STANDARD
    );
    const stakeKeyPathString = bip32PathToString(stakeKeyPath);
    return [stakeKeyPathString];
  }

  // For transactions without certificates/withdrawals, no additional witnesses needed
  // Payment key signatures are handled via input paths automatically
  return undefined;
};

/**
 * Transform Cardano SDK transaction body to Trezor format
 */
const txToTrezor = async (
  body: Cardano.TxBody,
  context: TrezorTxTransformerContext
): Promise<Omit<Trezor.CardanoSignTransaction, 'signingMode' | 'derivationType'>> => {
  return {
    inputs: mapTxIns(body.inputs, context),
    outputs: mapTxOuts(body.outputs, context),
    fee: body.fee.toString(),
    ttl: body.validityInterval?.invalidHereafter?.toString(),
    protocolMagic: context.chainId.networkMagic,
    networkId: context.chainId.networkId,
    certificates: mapCerts(body.certificates),
    withdrawals: mapWithdrawals(body.withdrawals, context),
    validityIntervalStart: body.validityInterval?.invalidBefore?.toString(),
    auxiliaryData: body.auxiliaryDataHash ? mapAuxiliaryData(body.auxiliaryDataHash) : undefined,
    mint: mapTokenMap(body.mint, true),
    scriptDataHash: body.scriptIntegrityHash?.toString(),
    collateralInputs: body.collaterals ? mapTxIns(body.collaterals, context) : undefined,
    requiredSigners: mapRequiredSigners(body.requiredExtraSignatures, context),
    collateralReturn: body.collateralReturn ? toTxOut({ index: 0, txOut: body.collateralReturn, isCollateral: true }, context) : undefined,
    totalCollateral: body.totalCollateral?.toString(),
    referenceInputs: body.referenceInputs ? mapTxIns(body.referenceInputs, context) : undefined,
    includeNetworkId: !!body.networkId,
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
          if (href.includes('connect.trezor.io') && !features) {
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
      const accountIndex = parseInt(pathParts[3].replace("'", ""));

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
    const txBod: Cardano.TxBody = tx.body;
    const knownAddresses: GroupedAddress[] = this.createKnownAddressesFromKeys(keys, network);

    // Validate that we have known addresses
    if (!knownAddresses || knownAddresses.length === 0) {
      throw new Error(
        '[Trezor] No known addresses available. Cannot create transaction context. ' +
        'Please ensure your wallet is properly initialized.'
      );
    }

    const inputResolver: Cardano.InputResolver = this.createInputResolver(utxos);
    const txInKeyPathMap = await util.createTxInKeyPathMap(txBod, knownAddresses, inputResolver);
    const scripts: Cardano.Script[] = tx.auxiliaryData?.scripts;

    const txBody: Serialization.TransactionBody = deserializedTx.body();
    try {
      const body = txBody.toCore();
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

      const trezorTxData: Omit<Trezor.CardanoSignTransaction, 'signingMode'> = await txToTrezor(body, {
        accountIndex: 0,
        chainId: {
          networkId: network.networkId,
          networkMagic: network.networkParams.networkMagic
        },
        collateralReturnFormat,
        knownAddresses,
        outputsFormat,
        tagCborSets: txBody.hasTaggedSets(),
        txInKeyPathMap
      });

      const signingMode = this.matchSigningMode(trezorTxData);

      // Map additional witness requests for all transactions (payment paths + stake path when needed)
      const additionalWitnessRequests = signingMode === Trezor.PROTO.CardanoTxSigningMode.MULTISIG_TRANSACTION
        ? multiSigWitnessPaths.map(path => bip32PathToString(path))
        : mapAdditionalWitnessRequests(body, {
            accountIndex: 0,
            chainId: {
              networkId: network.networkId,
              networkMagic: network.networkParams.networkMagic
            },
            knownAddresses,
            txInKeyPathMap
          });

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

      // Derive expected public keys from xPub instead of calling Trezor
      const expectedPublicKeys = util
        .ownSignatureKeyPaths(body, knownAddresses, txInKeyPathMap, undefined, scripts)
        .map((derivationPath) => this.derivePublicKeyFromXpub(xPub, derivationPath));

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
   * @param accountIndex - Account index
   * @param keys
   */
  async cardanoSignMessage(
    address: string,
    payload: string,
    networkId: number,
    accountIndex: number,
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
            accountIndex: 0, // Assuming account 0 could be parameterized
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
            accountIndex: 0, // Assuming account 0 could be parameterized
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
              accountIndex: 0,
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

  /**
   * Create InputResolver from UTXO set for transaction input resolution
   * This allows the Trezor transaction context to resolve transaction inputs
   */
  createInputResolver(utxos: Cardano.Utxo[]): Cardano.InputResolver {
    return {
      resolveInput: async (txIn: Cardano.TxIn): Promise<Cardano.TxOut | null> => {
        try {
          // Validate that UTXOs array is not empty
          if (!utxos || utxos.length === 0) {
            throw new Error('[Trezor] UTXO set is empty. Cannot resolve transaction inputs.');
          }

          // Find the UTXO that matches the transaction input
          const utxo: Cardano.Utxo = utxos.find(([hydratedTxIn, _txOut]) =>
            hydratedTxIn.txId === txIn.txId && hydratedTxIn.index === txIn.index
          );

          if (!utxo) {
            // For partial transactions (Plutus, multisig), some inputs may not belong to this wallet
            // (e.g., script inputs, other signers' inputs). Return null to skip them.
            console.debug(
              `[Trezor] Input not found in wallet UTXOs: ${txIn.txId}#${txIn.index}. ` +
              'This is expected for partial transactions with script inputs or multi-party transactions.'
            );
            return null;
          }

          return utxo[1]; // Return the TxOut part of the UTXO
        } catch (error) {
          // Re-throw the error to ensure it bubbles up
          console.error('[TREZOR] Error resolving input:', error);
          throw error;
        }
      }
    };
  },

  // ============================================================================
  // BITCOIN TREZOR INTEGRATION
  // ============================================================================

  /**
   * Initialize Bitcoin Trezor connection and get extended public key (xpub)
   * @param addressType - Bitcoin address type ('legacy', 'segwit', 'taproot')
   * @param accountIndex - Account index (default 0)
   * @returns Bitcoin xpub and device info
   */
  async initBitcoinTrezor(addressType: string = 'segwit', accountIndex: number = 0): Promise<{
    xpub: string;
    deviceLabel: string;
    firmwareVersion: string;
  }> {
    await this.init();

    // Determine coin and derivation path based on address type
    let path: string;
    let coin: string = 'btc'; // Bitcoin mainnet

    switch (addressType) {
      case 'legacy':
        path = `m/44'/0'/${accountIndex}'`; // BIP44
        break;
      case 'taproot':
        path = `m/86'/0'/${accountIndex}'`; // BIP86
        break;
      case 'segwit':
      default:
        path = `m/84'/0'/${accountIndex}'`; // BIP84
        break;
    }

    // Get extended public key from Trezor
    const result = await TrezorConnect.getPublicKey({
      path,
      coin,
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
      xpub: result.payload.xpub,
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
   * @returns Bitcoin address
   */
  async getAddress(
    addressType: string = 'segwit',
    accountIndex: number = 0,
    addressIndex: number = 0,
    isChange: boolean = false,
    verify: boolean = false
  ): Promise<string> {
    await this.init();

    // Determine path and script type based on address type
    let path: string;
    let scriptType: 'SPENDADDRESS' | 'SPENDMULTISIG' | 'SPENDWITNESS' | 'SPENDP2SHWITNESS' | 'SPENDTAPROOT';

    switch (addressType) {
      case 'legacy':
        path = `m/44'/0'/${accountIndex}'/${isChange ? 1 : 0}/${addressIndex}`;
        scriptType = 'SPENDADDRESS'; // P2PKH
        break;
      case 'taproot':
        path = `m/86'/0'/${accountIndex}'/${isChange ? 1 : 0}/${addressIndex}`;
        scriptType = 'SPENDTAPROOT'; // P2TR
        break;
      case 'segwit':
      default:
        path = `m/84'/0'/${accountIndex}'/${isChange ? 1 : 0}/${addressIndex}`;
        scriptType = 'SPENDWITNESS'; // P2WPKH
        break;
    }

    const result = await TrezorConnect.getAddress({
      path,
      coin: 'btc',
      showOnTrezor: verify,
      scriptType,
    });

    if (!result.success) {
      throw new Error(result.payload.error || 'Failed to get Bitcoin address from Trezor');
    }

    return result.payload.address;
  },

  /**
   * Sign Bitcoin transaction (PSBT) with Trezor
   * @param psbt - PSBT in base64 format
   * @param addressType - Bitcoin address type
   * @param accountIndex - Account index
   * @returns Signed PSBT in base64 format
   */
  // Note: this is the BITCOIN sign (PSBT); the Cardano sign is `cardanoSignTransaction` above.
  async signTransaction(
    psbt: string,
    _addressType: string = 'segwit',
    _accountIndex: number = 0
  ): Promise<string> {
    await this.init();

    // Trezor Connect supports PSBT signing directly
    const result = await TrezorConnect.signTransaction({
      coin: 'btc',
      inputs: [], // Will be parsed from PSBT
      outputs: [], // Will be parsed from PSBT
      // @ts-ignore - PSBT support in newer versions
      serialize: true,
      // @ts-ignore
      psbt,
    });

    if (!result.success) {
      throw new Error(result.payload.error || 'Failed to sign Bitcoin transaction with Trezor');
    }

    // Return signed PSBT
    // @ts-ignore
    return result.payload.serializedTx || result.payload.psbt;
  },

  /**
   * Verify Bitcoin address on Trezor device screen
   * @param addressType - Bitcoin address type
   * @param accountIndex - Account index
   * @param addressIndex - Address index
   * @param isChange - Internal or external address
   */
  async verifyBitcoinAddress(
    addressType: string = 'segwit',
    accountIndex: number = 0,
    addressIndex: number = 0,
    isChange: boolean = false
  ): Promise<string> {
    return await this.getAddress(addressType, accountIndex, addressIndex, isChange, true);
  },
};
