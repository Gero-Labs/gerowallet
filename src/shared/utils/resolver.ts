import { crc8 } from 'crc';
import { jsonToPlutusData } from '@/chrome/serialization';
import { Asset, Cardano, Serialization } from '@cardano-sdk/core';
import { isNotNil } from '@cardano-sdk/util';
import { Hash28ByteBase16, Bip32PrivateKey } from '@cardano-sdk/crypto';
import TokenMetadataStore from '@/stores/tokenMetadataStore';
import NetworkStore from '@/stores/networkStore';
import { resolveIconUrl, type IconPlaceholders } from '@/shared/utils/iconResolver';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';
import { HARDENED, ChainDerivations, Keys } from '@/models/types';
import { debugLog } from '@/utils/debug';
import assetsModule from '@/utils/assets';

// Service worker compatible icon resolution
const isServiceWorker = typeof document === 'undefined';

// Import assets from a centralized location (static import)
// In service worker context, these will be empty strings and the bundler will tree-shake the unused module
const placeholders: IconPlaceholders = {
  greenSvg: isServiceWorker ? '' : assetsModule.greenSvg,
  purpleSvg: isServiceWorker ? '' : assetsModule.purpleSvg,
  pinkSvg: isServiceWorker ? '' : assetsModule.pinkSvg,
  orangeSvg: isServiceWorker ? '' : assetsModule.orangeSvg,
  yellowSvg: isServiceWorker ? '' : assetsModule.yellowSvg,
  blueSvg: isServiceWorker ? '' : assetsModule.blueSvg,
  greySvg: isServiceWorker ? '' : assetsModule.greySvg,
  errorImage: isServiceWorker ? '' : assetsModule.errorImage,
};

export function resolveIcon(icon: string): string {
  return resolveIconUrl(icon, placeholders);
}

function cip68Label(asset_name: string | null | undefined): number | null {
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

function resolveCip68(
  onchain_metadata_extra: string,
  label: number,
  metadata,
  tokenInfo?: { unit?: string; policy_id?: string; asset_name?: string },
) {
  const plutusData: Serialization.PlutusData = jsonToPlutusData(JSON.parse(onchain_metadata_extra)[label]);
  const metadataJson: Asset.NftMetadata | null = fromPlutusData(plutusData.toCore());

  if (!metadataJson) {
    console.warn('⚠️ CIP68: Failed to parse PlutusData for token:', {
      unit: tokenInfo?.unit,
      policy_id: tokenInfo?.policy_id,
      asset_name: tokenInfo?.asset_name,
      label,
      onchain_metadata_extra
    });
  }

  metadata = metadataJson;
  if (metadataJson && metadataJson.otherProperties) {
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
        debugLog('Invalid PlutusData: "name" is required');
        return false;
      }
      return true;
    }
    debugLog('Invalid PlutusData: "name" must be utf8 bounded bytes');
    return false;
  },
  isValidDatumShape: (plutusData: Cardano.PlutusData | undefined): plutusData is Cardano.ConstrPlutusData => {
    const minNumberOfFields = strict ? 3 : 1;  // Allow 1 field (metadata only) for lenient parsing
    const isValid =
      Cardano.util.isConstrPlutusData(plutusData) &&
      plutusData.constructor === 0n &&
      plutusData.fields.items.length >= minNumberOfFields;
    if (!isValid)
      debugLog(
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
  // A chunked string is only valid when EVERY item decodes as UTF-8 bounded bytes.
  // String-coercing a stray int/map into the concatenation would fabricate a garbage
  // value that then passes downstream `typeof x === 'string'` checks unwarned.
  let list: string = "";
  for (const item of data.items) {
    const chunk = tryConvertPlutusDataToUtf8String(item);
    if (typeof chunk !== 'string') return data;
    list += chunk;
  }
  return list;
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
    } else {
      // Include all other PlutusData types (PlutusMap, PlutusBigInt, etc.)
      // This is important for CIP68 metadata fields like decimals: { "int": 6 }
      record[keyAsStr] = value;
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

  // Validate that first field is a map (metadata)
  if (!Cardano.util.isPlutusMap(nftMetadata)) {
    debugLog('Invalid PlutusData: expecting a map at [0]');
    return null;
  }

  // Version field is optional - some tokens don't include it (malformed but we can be lenient)
  let versionString = '1'; // Default version
  if (version !== undefined) {
    if (Cardano.util.isPlutusBigInt(version)) {
      versionString = version.toString();
    } else {
      debugLog('Invalid PlutusData: version at [1] should be integer, defaulting to "1"');
    }
  } else {
    debugLog('CIP68: Version field missing, defaulting to "1"');
  }

  const nftMetadataRecord = tryConvertPlutusMapToUtf8Record(nftMetadata);
  const { name, image, mediaType, description, files, decimals, ticker, url, logo, legal, ...additionalProperties } = nftMetadataRecord;

  if (!conditionalValidators.isNameValid(name)) {
    return null;
  }

  // `image` is the CIP-68 *NFT* (222) field; fungible tokens (333) carry `logo`
  // instead and legitimately have no `image` at all. Only an image that is present
  // but undecodable is a real defect — warning on every absent one buried the log.
  let imageAsUri: Asset.Uri = undefined
  if (typeof image === 'string') {
    imageAsUri = tryCoerce(image, Asset.Uri);
  } else if (typeof image !== 'undefined') {
    debugLog('Invalid PlutusData: "image" must be UTF-8 bounded bytes');
  }

  // Extract decimals from PlutusData - it's stored as a map with "int" key
  let decimalsValue: number | undefined = undefined;
  if (decimals) {
    if (Cardano.util.isPlutusMap(decimals)) {
      // CIP68 stores decimals as a map: { "int": 6 }
      const decimalsRecord = tryConvertPlutusMapToUtf8Record(decimals);
      const intValue = decimalsRecord['int'];
      if (Cardano.util.isPlutusBigInt(intValue)) {
        decimalsValue = Number(intValue);
      } else if (typeof intValue === 'string') {
        decimalsValue = parseInt(intValue, 10);
      }
    } else if (Cardano.util.isPlutusBigInt(decimals)) {
      decimalsValue = Number(decimals);
    } else if (typeof decimals === 'string') {
      decimalsValue = parseInt(decimals, 10);
    }
  }

  return {
    description: asString(description),
    files: mapFiles(files),
    image: imageAsUri,
    mediaType: tryCoerce(mediaType, Asset.ImageMediaType),
    name: name || '',
    decimals: decimalsValue,
    ticker: asString(ticker),
    url: asString(url),
    logo: asString(logo),
    legal: asString(legal),
    otherProperties: undefinedIfEmpty(mapOtherProperties(additionalProperties)),
    version: versionString
  };
};


// Token image overrides — replace bad/missing logos for specific tokens
// In service worker (background), SVG imports are empty — overrides only apply in browser context.
// Keyed by resolved token name/ticker (see applyTokenImageOverride consumers).
export const TOKEN_IMAGE_OVERRIDES: Record<string, string> = isServiceWorker
  ? {}
  : {
      // The Cardano-native NIGHT ($NIGHT) token wears the black/white Midnight mark.
      NIGHT: assetsModule.midnightTokenLogo,
    };

/**
 * Apply token image overrides for a given token name/ticker.
 * Returns the override image if one exists, otherwise returns the original.
 */
export function applyTokenImageOverride(name: string | undefined, originalImg: string): string {
  if (name && TOKEN_IMAGE_OVERRIDES[name]) return TOKEN_IMAGE_OVERRIDES[name];
  return originalImg;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- token records mix provider payload + chain-specific metadata shapes; resolves to a dynamic display bag consumed across the app
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
    // `token.unit` should be a hex AssetId (policyId + assetName). Some tx assets
    // arrive with a malformed/non-hex unit, which makes Cardano.AssetId.* throw
    // "expected hex string" and crashes the entire TransactionDetails render. Only
    // parse the unit when it's valid hex; otherwise fall back to the explicit
    // policy_id / asset_name fields.
    const unitIsHexAssetId =
      typeof token.unit === 'string' &&
      token.unit.length >= 56 &&
      token.unit.length % 2 === 0 &&
      /^[0-9a-fA-F]+$/.test(token.unit);

    if (token.policy_id) {
      policy_id = token.policy_id;
    } else if (unitIsHexAssetId) {
      policy_id = Cardano.AssetId.getPolicyId(token.unit);
    }

    if (token.asset_name) {
      asset_name = token.asset_name;
    } else if (unitIsHexAssetId) {
      asset_name = Cardano.AssetId.getAssetName(token.unit);
    }
    if (policy_id) {
      isScam = TokenMetadataStore.state.blacklistPolicies.includes(policy_id)
    }
    const label: number = cip68Label(asset_name)
    if (label && asset) {
      if (asset.onchain_metadata_extra && asset.onchain_metadata_extra[label]) {
        const tokenInfo = { unit, policy_id, asset_name };
        const cip68Data = resolveCip68(asset.onchain_metadata_extra, label, metadata, tokenInfo);
        if (label === 222) {
          onchain_metadata = cip68Data
          asset.onchain_metadata = cip68Data
          name = cip68Data?.name
          img = cip68Data?.image
        } else {
          asset.metadata = cip68Data
        }
        if (label === 333 && asset.metadata && !asset.metadata.decimals) {
          const token = structuredClone(TokenMetadataStore.state.tokens[asset.asset])
          if (token?.decimals) {
            asset.metadata.decimals = token.decimals
          } else {
            asset.metadata.decimals = 0
          }
        }
      }
    } else if (asset_name) {
      try {
        const decoded = Cardano.AssetName.toUTF8(Cardano.AssetName(asset_name), true);
        // Check if UTF-8 decoding produced valid readable text (no replacement chars or control chars)
        const hasInvalidChars = /[\uFFFD\u0000-\u001F]/.test(decoded) ||
          decoded.split('').some(ch => ch.charCodeAt(0) > 127 && ch.charCodeAt(0) < 160);
        name = hasInvalidChars ? asset_name.slice(0, 16) + '...' : decoded;
      } catch (e) {
        name = asset_name.slice(0, 16) + '...';
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
      verified = TokenMetadataStore.state.tokens[asset.asset]?.verified || false;
    } else if (asset.onchain_metadata) {
      if (asset.onchain_metadata?.image) {
        if (typeof asset.onchain_metadata.image == "string") {
          img = resolveIcon(asset.onchain_metadata.image)
        } else if (Array.isArray(asset.onchain_metadata.image)) {
          img = resolveIcon(asset.onchain_metadata.image.join(''))
        }
      } else if (asset.onchain_metadata['721']) {
        // CIP-25 v1/v2 compatible lookup:
        // v1: policy_id as hex text, asset_name as UTF-8 text
        // v2: policy_id and asset_name as raw bytes (Koios returns "0x"-prefixed hex keys)
        const cip25 = asset.onchain_metadata['721'];
        const pid = policy_id || asset.policy_id;
        const policyMeta = cip25[pid] || cip25[`0x${pid}`];
        if (policyMeta) {
          const aName = asset_name || asset.asset_name;
          const obj = policyMeta[name]             // CIP-25v1: UTF-8 decoded name
                   || policyMeta[aName]             // CIP-25v2: hex-encoded asset_name
                   || policyMeta[`0x${aName}`];     // CIP-25v2: Koios "0x"-prefixed hex
          if (obj) {
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
        }
      }
      if (asset.onchain_metadata?.files && !img) {
        const file = asset.onchain_metadata?.files.find((file: { src?: string; mediaType?: string }) => !!file.src && file.mediaType?.includes('image'));
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
  // Fallback name for assets we could not resolve (e.g. non-hex unit).
  if (!name) {
    name = typeof unit === 'string' && unit.length > 16 ? unit.slice(0, 16) + '...' : (unit || '');
  }
  // Apply token image overrides
  img = applyTokenImageOverride(name, img);

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

  const sortedArray: string[] = [...array].sort();
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
  // Baseline close can be 0 (newly-listed token, gap-filled candle) — avoid Infinity/NaN
  const percentChange = past.close > 0 ? (change / past.close) * 100 : 0;

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
 * @returns Array of signers with their derivation paths
 */
export function analyzeTransactionForSignatures(
  transaction: Cardano.Tx,
  utxos: Cardano.Utxo[],
  addresses: Keys,
  accountIndex: number,
  stakeAddress: string,
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
        foundAddressInfo = addresses.payment.find((addr: { address: string }) => addr.address === outputAddress);
      }

      // Search in change addresses if not found in payment
      if (!foundAddressInfo && addresses.change) {
        foundAddressInfo = addresses.change.find((addr: { address: string }) => addr.address === outputAddress);
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
    for (const certificate of transaction.body.certificates) {
      if (certificate.__typename === Cardano.CertificateType.StakeRegistration ||
          certificate.__typename === Cardano.CertificateType.StakeDeregistration ||
          certificate.__typename === Cardano.CertificateType.Registration ||
          certificate.__typename === Cardano.CertificateType.Unregistration ||
          certificate.__typename === Cardano.CertificateType.StakeDelegation ||
          certificate.__typename === Cardano.CertificateType.StakeRegistrationDelegation ||
          certificate.__typename === Cardano.CertificateType.VoteDelegation ||
          certificate.__typename === Cardano.CertificateType.VoteRegistrationDelegation ||
          certificate.__typename === Cardano.CertificateType.StakeVoteRegistrationDelegation) {
        // Need stake key signature for both staking and governance operations (including Conway-era certificates)
        requiredSigners.push({
          derivationPath: [ChainDerivations.CHIMERIC_ACCOUNT, 0],
          type: 'stake'
        });
      }

      // Pool operator certificates
      if (certificate.__typename === Cardano.CertificateType.PoolRegistration) {
        // Pool registration requires owner stake key signatures
        // The cold key signature is handled separately (outside HD derivation tree)
        const poolCert = certificate as Cardano.PoolRegistrationCertificate;
        if (poolCert.poolParameters?.owners) {
          for (const owner of poolCert.poolParameters.owners) {
            // If this wallet's stake address is an owner, require stake key signature
            if (owner === stakeAddress) {
              requiredSigners.push({
                derivationPath: [ChainDerivations.CHIMERIC_ACCOUNT, 0],
                type: 'stake'
              });
            }
          }
        }
        // Flag that cold key signature is also needed (handled by pool signing flow)
        (requiredSigners as unknown as { requiresColdKeySignature?: boolean }).requiresColdKeySignature = true;
      }

      if (certificate.__typename === Cardano.CertificateType.PoolRetirement) {
        // Pool retirement requires cold key signature (handled by pool signing flow)
        (requiredSigners as unknown as { requiresColdKeySignature?: boolean }).requiresColdKeySignature = true;
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
    debugLog('🔍 Checking requiredExtraSignatures:', transaction.body.requiredExtraSignatures);
    for (const keyHash of transaction.body.requiredExtraSignatures) {
      debugLog(`🔍 Looking for required key hash: ${keyHash}`);
      let foundMatch = false;

      // Search through all known addresses in the wallet store keys
      const addressTypes = ['payment', 'change', 'stake'];

      for (const addressType of addressTypes) {
        if (foundMatch) break;

        const addressArray = addresses[addressType];
        if (addressArray && Array.isArray(addressArray)) {
          for (const addressInfo of addressArray) {
            if (addressInfo && (addressInfo.cred)) {
              debugLog(`🔍 Comparing required: ${keyHash} vs wallet: ${addressInfo.cred} (${addressType})`);
              // Compare key hash directly from wallet store
              // Use cred field if keyHash is not available (this is the actual field name in WalletStore)
              if (keyHash === addressInfo.cred) {
                const pathArray = parseDerivationPath(addressInfo.path);
                debugLog(`🔍 Full parsed path: [${pathArray.join(',')}]`);
                debugLog(`🔍 Should be: [0, 0] for external address index 0`);
                requiredSigners.push({
                  derivationPath: pathArray,
                  type: addressType === 'stake' ? 'stake' : 'payment'
                });
                foundMatch = true;
                debugLog(`✅ Found matching key for ${keyHash} in ${addressType} addresses at path ${addressInfo.path}`);
                break;
              }
            }
          }
        }
      }
    }
  }

  // Remove duplicates
  const result = requiredSigners.filter((signer, index, self) =>
      index === self.findIndex(s =>
        s.derivationPath.join(',') === signer.derivationPath.join(',') && s.type === signer.type
      )
  );

  // Carry forward the pool operator cold key flag (if set during certificate analysis)
  if ((requiredSigners as unknown as { requiresColdKeySignature?: boolean }).requiresColdKeySignature) {
    (result as unknown as { requiresColdKeySignature?: boolean }).requiresColdKeySignature = true;
  }

  return result;
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
