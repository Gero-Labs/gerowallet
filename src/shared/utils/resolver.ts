import { appWallet } from '@/store';
import { crc8 } from 'crc';
import { jsonToPlutusData } from '@/chrome/serialization';
import { dexHunterStore } from '@/store/modules/dexhunter';
import { Asset, Serialization } from '@cardano-sdk/core';
import { dummyLogger } from 'ts-log'

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
  const metadataJson = Asset.NftMetadata.fromPlutusData(plutusData.toCore(), dummyLogger);
  if (label == 333) {
    metadata = metadataJson;
    img = `${baseUrl}/api/ipfs?path=${metadataJson.image.replace('ipfs://', '').replace('ipfs/', '')}`;
  } else if (label == 222) {
    img = `${baseUrl}/api/ipfs?path=${metadataJson.image.replace('ipfs://', '').replace('ipfs/', '')}`;
  }
  name = metadataJson.name;
  return { metadata, img, name };
}

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
