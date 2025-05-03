import { appWallet } from '@/stores';
import { crc8 } from 'crc';
import { jsonToPlutusData } from '@/chrome/serialization';
import { dexHunterStore } from '@/stores/modules/dexhunter';
import { Asset, Cardano, Serialization } from '@cardano-sdk/core';
import { isNotNil } from '@cardano-sdk/util';
import { TextDecoder } from 'web-encoding';

const baseUrl = import.meta.env['VITE_BACKEND_URL'];

function cip68Label(asset: any) {
  const unit = asset.asset;
  const label = unit.slice(56, 64);
  if (label.length !== 8 || !(label[0] === '0' && label[7] === '0')) {
    return null;
  }
  const numHex = label.slice(1, 5);
  const num: number = parseInt(numHex, 16);
  const check = label.slice(5, 7);
  return check === crc8(Buffer.from(numHex, 'hex')).toString(16).padStart(2, '0') ? num : null;
}

function resolveCip68(assetInfo, label: number, metadata, img: string, name: string) {
  const plutusData: Serialization.PlutusData = jsonToPlutusData(assetInfo.cip68_metadata[label]);
  const metadataJson = fromPlutusData(plutusData.toCore());
  metadata = metadataJson;
  if (metadataJson.otherProperties) {
    metadata['otherProperties'] = Object.fromEntries(metadataJson.otherProperties.entries())
  }
  let image = metadataJson.image;
  if (metadata['otherProperties'] && metadata['otherProperties']['logo'] && !image) {
    image = metadata['otherProperties']['logo']
  }
  if (label == 333) {
    img = `${baseUrl}/api/ipfs?path=${image.replace('ipfs://', '').replace('ipfs/', '')}`;
  } else if (label == 222) {
    img = `${baseUrl}/api/ipfs?path=${image.replace('ipfs://', '').replace('ipfs/', '')}`;
  }
  name = metadataJson.name;
  return { metadata, img, name };
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
    console.log(data.items)
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

export async function resolveAsset(asset, token): Promise<any> {
  let img;
  let name: string = Buffer.from(token.asset_name, 'hex').toString('ascii');
  let metadata = null;
  let onchain_metadata = null;
  let isScam = false
  if (token.policy_id) {
    isScam = dexHunterStore().blacklistPolicies.includes(token.policy_id)
  }
  const quantity = token.quantity ? token.quantity : undefined;
  if (token.asset_name === 'lovelace') {
    img = token.logo;
    name = 'ADA'
  } else if (asset) {
    if (asset.metadata) {
      metadata = asset.metadata
      name = asset.metadata.ticker
      if (asset.metadata?.logo) {
        img = `data:image/png;base64,${asset.metadata.logo}`;
      }
    } else if (asset.onchain_metadata) {
      if (asset.onchain_metadata?.image) {
        let imgString
        if (typeof asset.onchain_metadata.image == "string") {
          imgString = asset.onchain_metadata.image
        } else if (Array.isArray(asset.onchain_metadata.image)) {
          imgString = asset.onchain_metadata.image.join('')
        }
        console.log(baseUrl)
        if (imgString.startsWith('ar://') || imgString.startsWith('ar/')) {
          img = `${baseUrl}/api/ar/${imgString.replace('ar://', '').replace('ar/', '')}`;
        } else if (imgString.startsWith('https://') || imgString.startsWith('data:image')) {
          img = imgString;
        } else {
          img = `${baseUrl}/api/ipfs?path=${imgString.replace('ipfs://', '').replace('ipfs/', '')}`;
        }
      } else if (asset.onchain_metadata['721'] && asset.onchain_metadata['721'][asset.policy_id] && asset.onchain_metadata['721'][asset.policy_id][name]) {
        const obj = asset.onchain_metadata['721'][asset.policy_id][name];
        onchain_metadata = obj
        if (obj.image) {
          let imgString
          if (typeof obj.image == "string") {
            imgString = obj.image
          } else if (Array.isArray(obj.image)) {
            imgString = obj.image.join('')
          }
          if (imgString.includes('ar://') || imgString.includes('ar/')) {
            img = `${baseUrl}/api/ar/${imgString.replace('ar://', '').replace('ar/', '')}`;
          } else if (imgString.startsWith('https://') || imgString.startsWith('data:image')) {
            img = imgString;
          } else {
            img = `${baseUrl}/api/ipfs?path=${imgString.replace('ipfs://', '').replace('ipfs/', '')}`;
          }
        }
        if (obj.name) {
          name = obj.name
        }
      } else { // CIP 68
        const label: number = cip68Label(asset);
        if (label) {
          const assetInfo = await appWallet.getDetailedAssetsInfo(asset.policy_id, asset.asset_name);
          if (assetInfo?.cip68_metadata && assetInfo?.cip68_metadata[label]) {
            const resolvedCip68 = resolveCip68(assetInfo, label, metadata, img, name);
            metadata = resolvedCip68.metadata;
            img = resolvedCip68.img;
            name = resolvedCip68.name;
          }
        }
      }
    } else {
      const assetInfo = await appWallet.getDetailedAssetsInfo(token.policy_id, token.asset_name);
      if (assetInfo?.cip68_metadata) {
        const label: number = cip68Label(asset);
        if (assetInfo?.cip68_metadata && assetInfo?.cip68_metadata[label]) {
          const resolvedCip68 = resolveCip68(assetInfo, label, metadata, img, name);
          metadata = resolvedCip68.metadata;
          img = resolvedCip68.img;
          name = resolvedCip68.name;
        }
      }
    }
  }
  return {
    unit: token.policy_id + token.asset_name,
    img,
    name,
    policy_id: token.policy_id,
    metadata,
    onchain_metadata,
    quantity,
    verified: false,
    isScam,
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
