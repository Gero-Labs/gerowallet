import { crc8 } from 'crc';
import { jsonToPlutusData } from '@/chrome/serialization';
import { Asset, Cardano, Serialization, util } from '@cardano-sdk/core';
import { HexBlob, isNotNil } from '@cardano-sdk/util';
import { TextDecoder } from 'web-encoding';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import DexHunterStore from '@/plugins/dexHunterStore';
import NetworkStore from '@/plugins/networkStore';
import { CID } from 'multiformats/cid';

// Service worker compatible icon resolution
const isServiceWorker = typeof document === 'undefined' && typeof importScripts === 'function';
const baseUrl = import.meta.env['VITE_BACKEND_URL'];

// For service worker, we'll provide fallback values instead of importing assets
let greenSvg = '';
let purpleSvg = '';
let pinkSvg = '';
let orangeSvg = '';
let blueSvg = '';
let greySvg = '';
let errorImage = '';

if (!isServiceWorker) {
  try {
    greenSvg = require('@/assets/svg/green.svg').default || require('@/assets/svg/green.svg');
    purpleSvg = require('@/assets/svg/purple.svg').default || require('@/assets/svg/purple.svg');
    pinkSvg = require('@/assets/svg/pink.svg').default || require('@/assets/svg/pink.svg');
    orangeSvg = require('@/assets/svg/orange.svg').default || require('@/assets/svg/orange.svg');
    blueSvg = require('@/assets/svg/blue.svg').default || require('@/assets/svg/blue.svg');
    greySvg = require('@/assets/svg/grey.svg').default || require('@/assets/svg/grey.svg');
    errorImage = require('@/assets/img/1x1.png').default || require('@/assets/img/1x1.png');
  } catch (e) {
    // Fallback if require fails
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

const tryCoerce = <T>(value: string | Cardano.PlutusData | undefined, ctor: (v: string) => T): T | undefined => {
  if (typeof value !== 'string')
    return undefined;
  try {
    return ctor(value);
  } catch (error) {
    console.warn(error instanceof Error ? error.message : error);
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
        asset.metadata = resolveCip68(asset.onchain_metadata_extra, label, metadata);
        if (label === 333 && asset.metadata && !asset.metadata.decimals) {
          const token = structuredClone(DexHunterStore.state.dexHunterTokens[asset.asset])
          if (token?.decimals) {
            asset.metadata.decimals = token.decimals
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
    const collectionKey: string = Object.keys(collectible.onchain_metadata).find(key => key.toLowerCase() === 'collection' || key.toLowerCase() === 'project');
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
