import { crc8 } from 'crc';
import { jsonToPlutusData } from '@/chrome/serialization';
import { Asset, Cardano, Serialization, util } from '@cardano-sdk/core';
import { HexBlob, isNotNil } from '@cardano-sdk/util';
import { Hash28ByteBase16, Bip32PrivateKey } from '@cardano-sdk/crypto';
import DexHunterStore from '@/stores/dexHunterStore';
import NetworkStore from '@/stores/networkStore';
import { CID } from 'multiformats/cid';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';
import { HARDENED, ChainDerivations, Keys } from '@/models/types';

// Service worker compatible icon resolution
const isServiceWorker = typeof document === 'undefined';
const baseUrl = import.meta.env['VITE_BACKEND_URL'];

// Import assets from a centralized location
let greenSvg = '';
let purpleSvg = '';
let pinkSvg = '';
let orangeSvg = '';
let blueSvg = '';
let greySvg = '';
let errorImage = '';

if (!isServiceWorker) {
  try {
    // Use centralized assets instead of require
    import('@/utils/assets').then(assets => {
      greenSvg = assets.default.greenSvg;
      purpleSvg = assets.default.purpleSvg;
      pinkSvg = assets.default.pinkSvg;
      orangeSvg = assets.default.orangeSvg;
      blueSvg = assets.default.blueSvg;
      greySvg = assets.default.greySvg;
      errorImage = assets.default.errorImage;
    }).catch(e => {
      console.warn('Failed to load assets:', e);
    });
  } catch (e) {
    // Fallback if imports fail
    console.warn('Failed to load assets:', e);
  }
}

function detectCIDVersion(cidStr: string) {
  try {
    const cid = CID.parse(cidStr);
    return cid.version; // 0, 1, or 2
  } catch (e) {
    return null; // Not a valid CID
  }
}

export function resolveIcon(icon: string): string {
  if (!icon) {
    return errorImage;
  }

  if (icon.startsWith('http') || icon.startsWith('data:')) {
    return icon;
  } else if (icon.startsWith('ar://') || icon.startsWith('ar/')) {
    return `${baseUrl}/api/ar/${icon.replace('ar://', '').replace('ar/', '')}`
  } else if (icon.startsWith('ipfs://') || icon.startsWith('ipfs/')) {
    return `${baseUrl}/api/ipfs?path=${icon.replace('ipfs://', '').replace('ipfs/', '')}`
  } else if (detectCIDVersion(icon) != null) {
    return `${baseUrl}/api/ipfs?path=${icon}`
  }

  switch (icon) {
    case 'green':
    case 'teal':
      return greenSvg;
    case 'purple':
    case 'deep-purple':
      return purpleSvg;
    case 'pink':
      return pinkSvg;
    case 'orange':
    case 'chocolate':
      return orangeSvg;
    case 'blue':
    case 'cyan':
      return blueSvg;
    case 'grey':
      return greySvg;
  }

  const firstChar = icon.charAt(0);
  let mimeType: string | null = null;

  switch (firstChar) {
    case '/':
      mimeType = 'image/jpeg';
      break;
    case 'i':
      mimeType = 'image/png';
      break;
    case 'R':
      mimeType = 'image/gif';
      break;
    case 'U':
      mimeType = 'image/webp';
      break;
    default:
      return errorImage;
  }

  return `data:${mimeType};base64,${icon}`;
}

function cip68Label(asset_name: any): number | null {
  if (!asset_name) {
    return null;
  }
  const label = asset_name.slice(0, 8);
  if (label.length !== 8 || !(label[0] === '0' && label[7] === '0')) {
    return null;
  }
  const numHex = label.slice(1, 5);
  const num: number = parseInt(numHex, 16);
  const check = label.slice(5, 7);
  return check === crc8(Buffer.from(numHex, 'hex')).toString(16).padStart(2, '0') ? num : null;
}

function resolveCip68(onchain_metadata_extra: any, label: number, metadata) {
  const plutusData: Serialization.PlutusData = jsonToPlutusData(JSON.parse(onchain_metadata_extra)[label]);
  const metadataJson: Asset.NftMetadata = fromPlutusData(plutusData.toCore());
  metadata = metadataJson;
  if (metadataJson.otherProperties) {
    metadata = {
      ...metadataJson,
      ...Object.fromEntries(metadataJson.otherProperties.entries())
    }
  }
  return metadata;
}

const getConditionalValidators = (strict: boolean) => ({
  isNameValid: (name: Cardano.PlutusData | string | undefined): name is string | undefined => {
    if (typeof name === 'string') return true;
    if (typeof name === 'undefined') {
      if (strict) {
        console.debug('Invalid PlutusData: "name" is required');
        return false;
      }
      return true;
    }
    console.debug('Invalid PlutusData: "name" must be utf8 bounded bytes');
    return false;
  },
  isValidDatumShape: (plutusData: Cardano.PlutusData | undefined): plutusData is Cardano.ConstrPlutusData => {
    const minNumberOfFields = strict ? 3 : 2;
    const isValid =
      Cardano.util.isConstrPlutusData(plutusData) &&
      plutusData.constructor === 0n &&
      plutusData.fields.items.length >= minNumberOfFields;
    if (!isValid)
      console.debug(
        `Invalid PlutusData: expecting ConstrPlutusData with 0th constructor and ${minNumberOfFields} items`
      );
    return isValid;
  }
});

const utf8Decoder = new TextDecoder('utf8', { fatal: true });

const tryConvertPlutusDataToUtf8String = (data: Cardano.PlutusData): Cardano.PlutusData | string => {
  if (!Cardano.util.isPlutusBoundedBytes(data)) return data;
  try {
    return utf8Decoder.decode(data);
  } catch {
    return data;
  }
};

const tryConvertPlutusDataToUtf8List = (data: Cardano.PlutusData): Cardano.PlutusData | string => {
  if (!Cardano.util.isPlutusList(data)) return data;
  let list: string = "";
  try {
    data.items.forEach(item => {
      list += tryConvertPlutusDataToUtf8String(item);
    })
    return list;
  } catch {
    return data;
  }
}

const tryConvertPlutusMapToUtf8Record = (map: Cardano.PlutusMap): Partial<Record<string, string | Cardano.PlutusData>> => {
  const record: Partial<Record<string, string | Cardano.PlutusData>> = {};
  for (const [key, value] of map.data.entries()) {
    const keyAsStr = tryConvertPlutusDataToUtf8String(key);
    if (typeof keyAsStr !== 'string') {
      console.warn('Failed to decode plutus map key', key);
      continue;
    }
    if (Cardano.util.isPlutusList(value)) {
      record[keyAsStr] = tryConvertPlutusDataToUtf8List(value)
    } else if (Cardano.util.isPlutusBoundedBytes(value)) {
      record[keyAsStr] = tryConvertPlutusDataToUtf8String(value);
    }
  }
  return record;
};

export const asString = (value: unknown) => (typeof value === 'string' ? value : undefined);

const tryCoerce = <T,>(value: string | Cardano.PlutusData | undefined, ctor: (v: string) => T): T | undefined => {
  if (typeof value !== 'string')
    return undefined;
  try {
    return ctor(value);
  } catch (error) {
    console.warn(error && typeof error === 'object' && 'message' in error ? String(error.message) : error);
    return undefined;
  }
};

const mapFiles = (files: string | Cardano.PlutusData | undefined): Asset.NftMetadataFile[] | undefined => {
  if (!files) return undefined;
  if (!Cardano.util.isPlutusList(files)) {
    console.warn('expected "files" to be a list');
    return undefined;
  }
  return files.items.map((file) => mapFile(file)).filter(isNotNil);
};

const mapOtherPropertyValue = (value: string | Cardano.PlutusData): Cardano.Metadatum => {
  if (typeof value === 'string' || Cardano.util.isPlutusBigInt(value) || Cardano.util.isPlutusBoundedBytes(value)) return value;
  if (Cardano.util.isPlutusMap(value)) {
    const properties = mapOtherProperties(tryConvertPlutusMapToUtf8Record(value));
    return new Map(Object.entries(properties));
  }
  const list = Cardano.util.isPlutusList(value) ? value.items : value.fields.items;
  return list.map((item) => mapOtherPropertyValue(item));
};

const mapOtherProperties = (
  additionalProperties: Partial<Record<string, string | Cardano.PlutusData>>,
): Map<string, Cardano.Metadatum> =>
  Object.entries(additionalProperties).reduce((result, [key, value]) => {
    if (typeof value !== 'undefined') {
      result.set(key, mapOtherPropertyValue(value));
    }
    return result;
  }, new Map());

const undefinedIfEmpty = <K, V>(map: Map<K, V>) => (map.size > 0 ? map : undefined);

const mapFile = (file: Cardano.PlutusData): Asset.NftMetadataFile | undefined => {
  if (!Cardano.util.isPlutusMap(file)) {
    return undefined;
  }
  const {
    mediaType: mediaTypeStr,
    src: srcStr,
    name,
    ...additionalProperties
  } = tryConvertPlutusMapToUtf8Record(file);
  const mediaType = tryCoerce(mediaTypeStr, Asset.MediaType);
  const src = tryCoerce(srcStr, Asset.Uri);
  if (typeof src !== 'string' || typeof mediaType !== 'string') {
    return undefined;
  }
  return {
    mediaType,
    name: asString(name),
    otherProperties: undefinedIfEmpty(mapOtherProperties(additionalProperties)),
    src
  };
};

export const fromPlutusData = (
  plutusData: Cardano.PlutusData | undefined,
  strict = false
): Asset.NftMetadata | null => {
  const conditionalValidators = getConditionalValidators(strict);
  if (!conditionalValidators.isValidDatumShape(plutusData)) {
    return null;
  }

  const [nftMetadata, version] = plutusData.fields.items;
  if (!Cardano.util.isPlutusMap(nftMetadata) || !Cardano.util.isPlutusBigInt(version)) {
    console.debug('Invalid PlutusData: expecting a map at [0] and integer at [1]');
    return null;
  }

  const nftMetadataRecord = tryConvertPlutusMapToUtf8Record(nftMetadata);
  const { name, image, mediaType, description, files, ...additionalProperties } = nftMetadataRecord;

  if (!conditionalValidators.isNameValid(name)) {
    return null;
  }

  let imageAsUri: Asset.Uri = undefined
  if (typeof image !== 'string') {
    console.debug('Invalid PlutusData: "image" must be UTF-8 bounded bytes');
  } else {
    imageAsUri = tryCoerce(image, Asset.Uri);
  }

  return {
    description: asString(description),
    files: mapFiles(files),
    image: imageAsUri,
    mediaType: tryCoerce(mediaType, Asset.ImageMediaType),
    name: name || '',
    otherProperties: undefinedIfEmpty(mapOtherProperties(additionalProperties)),
    version: version.toString()
  };
};


export function resolveAsset(token: any): any {
  const unit = token.unit;
  let metadata = null;
  let onchain_metadata = null;
  let isScam: boolean = false;
  let name: string;
  let img: string;
  let verified: boolean = false;
  let policy_id: string;
  let asset_name: string;

  const asset = structuredClone(NetworkStore.state.assets[token.unit]);
  if (!asset) {
    // TODO
  }
  const quantity = token.quantity ? token.quantity.toString() : undefined;
  if (token.policy_id === "") { // Network Currency
    return {
      unit,
      img: token.metadata.logo,
      name: token.metadata.ticker,
      policy_id: "",
      asset_name: undefined,
      metadata: token.metadata,
      onchain_metadata: null,
      quantity,
      verified: true,
      isScam: false,
      risk: 'AAA',
    };
  } else {
    if (!token.policy_id && token.unit) {
      policy_id = Cardano.AssetId.getPolicyId(token.unit);
    } else if (token.policy_id) {
      policy_id = token.policy_id;
    }
    if (!token.asset_name && token.unit) {
      asset_name = Cardano.AssetId.getAssetName(token.unit);
    } else {
      asset_name = token.asset_name;
    }
    if (policy_id) {
      isScam = DexHunterStore.state.blacklistPolicies.includes(policy_id)
    }
    const label: number = cip68Label(asset_name)
    if (label && asset) {
      if (asset.onchain_metadata_extra && asset.onchain_metadata_extra[label]) {
        const cip68Data = resolveCip68(asset.onchain_metadata_extra, label, metadata);
        if (label === 222) {
          onchain_metadata = cip68Data
          asset.onchain_metadata = cip68Data
          name = cip68Data.name
          img = cip68Data.image
        } else {
          asset.metadata = cip68Data
        }
        if (label === 333 && asset.metadata && !asset.metadata.decimals) {
          const token = structuredClone(DexHunterStore.state.dexHunterTokens[asset.asset])
          if (token?.decimals) {
            asset.metadata.decimals = token.decimals
          } else {
            asset.metadata.decimals = 0
          }
        }
      }
    } else if (asset_name) {
      try {
        name = Cardano.AssetName.toUTF8(Cardano.AssetName(asset_name), true);
      } catch (e) {
        name = String(util.hexToBytes(HexBlob(asset_name)));
      }
    }
  }
  if (asset) {
    if (asset.metadata) { // Token
      metadata = asset.metadata
      if (asset.metadata.ticker) {
        name = asset.metadata.ticker
      } else if (asset.metadata.name) {
        name = asset.metadata.name
      }
      if (asset.metadata?.logo) {
        img = resolveIcon(asset.metadata.logo);
      } else if (asset.metadata?.image) {
        img = resolveIcon(asset.metadata.image);
      }
      verified = DexHunterStore.state.dexHunterTokens[asset.asset]?.verified || false;
    } else if (asset.onchain_metadata) {
      if (asset.onchain_metadata?.image) {
        if (typeof asset.onchain_metadata.image == "string") {
          img = resolveIcon(asset.onchain_metadata.image)
        } else if (Array.isArray(asset.onchain_metadata.image)) {
          img = resolveIcon(asset.onchain_metadata.image.join(''))
        }
      } else if (asset.onchain_metadata['721'] && asset.onchain_metadata['721'][asset.policy_id] && asset.onchain_metadata['721'][asset.policy_id][name]) {
        const obj = asset.onchain_metadata['721'][asset.policy_id][name];
        onchain_metadata = obj
        if (obj.image) {
          if (typeof obj.image == "string") {
            img = resolveIcon(obj.image)
          } else if (Array.isArray(obj.image)) {
            img = resolveIcon(obj.image.join(''))
          }
        }
        if (obj.name) {
          name = obj.name
        }
      }
      if (asset.onchain_metadata?.files && !img) {
        const file = asset.onchain_metadata?.files.find((file: any) => !!file.src && file.mediaType?.includes('image'));
        if (file) {
          if (typeof file.src == "string") {
            img = resolveIcon(file.src)
          } else if (Array.isArray(file.src)) {
            img = resolveIcon(file.src.join(''))
          }
        }
      }
    }
  }
  return {
    unit,
    img,
    name,
    policy_id,
    asset_name,
    metadata,
    onchain_metadata,
    quantity,
    verified,
    isScam,
    fingerprint: token?.fingerprint,
  };
}

export function findCollectionName(collectible) {
  let projectName: string = ''
  if (collectible?.onchain_metadata) {
    const collectionKey: string = Object.keys(collectible.onchain_metadata).find(key => key.toLowerCase() === 'collection' || key.toLowerCase() === 'project' || key.toLowerCase() === 'name');
    if (collectionKey) {
      projectName = collectible.onchain_metadata[collectionKey]
    }
  }
  if (!projectName && collectible?.onchain_metadata?.attributes) {
    const collectionKey: string = Object.keys(collectible.onchain_metadata.attributes).find(key => key.toLowerCase() === 'collection' || key.toLowerCase() === 'project' || key.toLowerCase() === 'collectionname');
    if (collectionKey) {
      projectName = collectible.onchain_metadata.attributes[collectionKey]
    }
  }
  return projectName
}

export function findCollectionDescription(collectible) {
  if (collectible?.onchain_metadata) {
    const descriptionKey: string = Object.keys(collectible.onchain_metadata).find(key => key.toLowerCase() === 'description');
    if (descriptionKey) {
      return collectible.onchain_metadata[descriptionKey]
    }
  }
  if (collectible?.onchain_metadata?.attributes) {
    const descriptionKey: string = Object.keys(collectible.onchain_metadata.attributes).find(key => key.toLowerCase() === 'description');
    if (descriptionKey) {
      return collectible.onchain_metadata.attributes[descriptionKey]
    }
  }
  return null
}

export function longestCommonStartingSubstring(array) {
  if (array.length == 0) {
    return
  }

  const sortedArray: any[] = [...array].sort();
  const firstItem = sortedArray[0];
  const lastItem = sortedArray[sortedArray.length - 1];
  try {
    const firstItemLength = firstItem.length;
    let i: number = 0;

    while (i < firstItemLength && firstItem.charAt(i) === lastItem.charAt(i)) {
      i++;
    }

    let subString = firstItem.substring(0, i);
    if (subString.endsWith('#')) {
      subString = firstItem.substring(0, i-1)
    }
    return subString.trim();
  } catch (e) {
    console.log(e)
    return
  }
}

export function resolvePaymentKeyHash(bech32: string): Hash28ByteBase16 {
  try {
    const paymentKeyHash = [
      Cardano.BaseAddress.fromAddress(Cardano.Address.fromBech32(bech32))?.getPaymentCredential().hash,
      Cardano.EnterpriseAddress.fromAddress(Cardano.Address.fromBech32(bech32))?.getPaymentCredential().hash,
    ].find((kh) => kh !== undefined);

    if (paymentKeyHash !== undefined) return paymentKeyHash;

    throw new Error(
      `Couldn't resolve payment key hash from address: ${bech32}`,
    );
  } catch (error) {
    throw new Error(
      `An error occurred during resolvePaymentKeyHash: ${error}.`,
    );
  }
}

/**
 * @param {Array<{time: number, close: number}>} data
 * @returns {{ latestTime: number, pastTime: number, change: number, percentChange: number }|null}
 */
export function get24hChange(data) {
  if (!data || data.length < 2) return null;

  // Make a shallow copy and sort ascending by timestamp
  const sorted = data.slice().sort((a, b) => a.time - b.time);

  // Latest point
  const latest = sorted[sorted.length - 1];

  // Threshold timestamp: 24h before latest
  const threshold = latest.time - 24 * 3600;

  // Find the most recent entry at or before a threshold
  let past = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].time <= threshold) {
      past = sorted[i];
      break;
    }
  }

  // If no point ≥24h ago, fallback to the oldest available
  if (!past) {
    past = sorted[0];
  }

  const change = latest.close - past.close;
  const percentChange = (change / past.close) * 100;

  return {
    latestTime: latest.time,
    pastTime: past.time,
    change,
    percentChange
  };
}

export function resolvePrivateKey(mnemonic: string): Bip32PrivateKey {
  const bip39entropy = bip39.mnemonicToEntropy(mnemonic);
  return Bip32PrivateKey.fromBip39Entropy(Buffer.from(bip39entropy, 'hex'), '');
}

/**
 * Analyzes transaction to determine which keys need to sign
 * @param transaction - The transaction to analyze
 * @param utxos - Available UTXOs
 * @param addresses - Address mappings
 * @param accountIndex - Account index for derivation
 * @param stakeAddress - The stake address for the wallet
 * @param paymentKeyExternal - Function to get payment key
 * @param stakeKey - Function to get stake key
 * @returns Array of signers with their derivation paths
 */
export function analyzeTransactionForSignatures(
  transaction: Cardano.Tx,
  utxos: Cardano.Utxo[],
  addresses: Keys,
  accountIndex: number,
  stakeAddress: string,
  paymentKeyExternal: (index: number) => any,
  stakeKey: () => any
): Array<{ derivationPath: number[], type: string }> {
  const requiredSigners: Array<{ derivationPath: number[], type: string }> = [];

  // Check transaction inputs
  for (const input of transaction.body.inputs) {
    const utxo = utxos.find(u =>
      u[0].txId === input.txId && u[0].index === input.index
    );

    if (utxo) {
      const outputAddress = utxo[1].address;

      // The addresses parameter is actually the keys object from the wallet store
      // It has structure: { payment: [addressObj], change: [addressObj], stake: [addressObj], ... }
      let foundAddressInfo = null;

      // Search in payment addresses
      if (addresses.payment) {
        foundAddressInfo = addresses.payment.find((addr: any) => addr.address === outputAddress);
      }

      // Search in change addresses if not found in payment
      if (!foundAddressInfo && addresses.change) {
        foundAddressInfo = addresses.change.find((addr: any) => addr.address === outputAddress);
      }

      if (foundAddressInfo && foundAddressInfo.path) {
        const pathArray = parseDerivationPath(foundAddressInfo.path);
        requiredSigners.push({
          derivationPath: pathArray,
          type: 'payment'
        });
      } else {
        // This should not happen if the wallet store is properly populated
        // But fallback to external 0 as a last resort
        requiredSigners.push({
          derivationPath: [ChainDerivations.EXTERNAL, 0],
          type: 'payment'
        });
      }
    }
  }

  // Check for certificates (staking operations and governance)
  if (transaction.body.certificates && transaction.body.certificates.length > 0) {
    console.debug('🔍 Analyzing certificates for required signatures:');
    for (const certificate of transaction.body.certificates) {
      console.debug(`  Certificate type: ${certificate.__typename}`);

      if (certificate.__typename === Cardano.CertificateType.StakeRegistration ||
          certificate.__typename === Cardano.CertificateType.StakeDeregistration ||
          certificate.__typename === Cardano.CertificateType.StakeDelegation ||
          certificate.__typename === Cardano.CertificateType.StakeRegistrationDelegation ||
          certificate.__typename === Cardano.CertificateType.VoteDelegation ||
          certificate.__typename === Cardano.CertificateType.VoteRegistrationDelegation ||
          certificate.__typename === Cardano.CertificateType.StakeVoteRegistrationDelegation) {
        // Need stake key signature for both staking and governance operations
        console.debug(`  Adding stake key signer for certificate: ${certificate.__typename}`);
        requiredSigners.push({
          derivationPath: [ChainDerivations.CHIMERIC_ACCOUNT, 0],
          type: 'stake'
        });
      } else {
        console.debug(`  Unknown certificate type, no signer added: ${certificate.__typename}`);
      }
    }
  }

  // Check for withdrawals
  if (transaction.body.withdrawals && transaction.body.withdrawals.length > 0) {
    for (const rewardAddress of transaction.body.withdrawals) {
      if (rewardAddress.stakeAddress === stakeAddress) {
        // Need stake key signature for withdrawal
        requiredSigners.push({
          derivationPath: [ChainDerivations.CHIMERIC_ACCOUNT, 0],
          type: 'stake'
        });
      }
    }
  }

  // Check for required signers field
  // Only check for signatures that belong to this wallet (for multisig support)
  if (transaction.body.requiredExtraSignatures && transaction.body.requiredExtraSignatures.length > 0) {
    console.debug('🔍 Checking requiredExtraSignatures:', transaction.body.requiredExtraSignatures);
    for (const keyHash of transaction.body.requiredExtraSignatures) {
      console.debug(`🔍 Looking for required key hash: ${keyHash}`);
      let foundMatch = false;

      // Search through all known addresses in the wallet store keys
      const addressTypes = ['payment', 'change', 'stake'];

      for (const addressType of addressTypes) {
        if (foundMatch) break;

        const addressArray = addresses[addressType];
        if (addressArray && Array.isArray(addressArray)) {
          for (const addressInfo of addressArray) {
            if (addressInfo && (addressInfo.cred)) {
              console.debug(`🔍 Comparing required: ${keyHash} vs wallet: ${addressInfo.cred} (${addressType})`);
              // Compare key hash directly from wallet store
              // Use cred field if keyHash is not available (this is the actual field name in WalletStore)
              if (keyHash === addressInfo.cred) {
                const pathArray = parseDerivationPath(addressInfo.path);
                console.debug(`🔍 Full parsed path: [${pathArray.join(',')}]`);
                console.debug(`🔍 Should be: [0, 0] for external address index 0`);
                requiredSigners.push({
                  derivationPath: pathArray,
                  type: addressType === 'stake' ? 'stake' : 'payment'
                });
                foundMatch = true;
                console.debug(`✅ Found matching key for ${keyHash} in ${addressType} addresses at path ${addressInfo.path}`);
                break;
              }
            }
          }
        }
      }
    }
  }

  // Remove duplicates
  return requiredSigners.filter((signer, index, self) =>
      index === self.findIndex(s =>
        s.derivationPath.join(',') === signer.derivationPath.join(',') && s.type === signer.type
      )
  );
}

/**
 * Parses a derivation path string into an array of numbers
 * @param pathString - Derivation path string (e.g., "m/1852'/1815'/0'/0/0")
 * @returns Array of derivation path numbers
 */
export function parseDerivationPath(pathString: string): number[] {
  return pathString
    .replace('m/', '')
    .split('/')
    .map(segment => {
      const num = parseInt(segment.replace("'", ""));
      return segment.includes("'") ? num + HARDENED : num;
    })
    .slice(3); // Remove the first 3 elements (purpose, coin_type, account) as they're handled at account level
}
