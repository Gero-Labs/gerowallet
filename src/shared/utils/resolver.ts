import { toAddress, toBaseAddress } from '@/shared/utils/converter';
import { buildRewardAddress } from '@/shared/utils/builder';
import { Address, BaseAddress, Ed25519KeyHash, PlutusData } from '@emurgo/cardano-serialization-lib-browser';
import { appWallet } from '@/store';
import { crc8 } from 'crc';
import { jsonToPlutusData } from '@/shared/utils/converter';

const baseUrl = process.env['VUE_APP_BACKEND_URL'];

export const resolveRewardAddress = (bech32: string) => {
  try {
    const address: Address = toAddress(bech32);
    const baseAddress: BaseAddress = toBaseAddress(bech32);
    const stakeKeyHash: Ed25519KeyHash = baseAddress?.stake_cred().to_keyhash();

    if (stakeKeyHash) return buildRewardAddress(address.network_id(), stakeKeyHash).to_address().to_bech32();

    throw new Error(`Couldn't resolve reward address from address: ${bech32}`);
  } catch (error) {
    throw new Error(`An error occurred during resolveRewardAddress: ${error}.`);
  }
};

function cip68Label(asset: any) {
  const unit = asset.asset;
  const label = unit.slice(56, 64);
  if (label.length !== 8 || !(label[0] === '0' && label[7] === '0')) {
    return null;
  }
  const numHex = label.slice(1, 5);
  const num = parseInt(numHex, 16);
  const check = label.slice(5, 7);
  return check === crc8(Buffer.from(numHex, 'hex')).toString(16).padStart(2, '0') ? num : null;
}

export async function resolveAsset(assets, token) {
  let img;
  let name = Buffer.from(token.asset_name, 'hex').toString('ascii');
  let metadata = null;
  let onchain_metadata = null;
  const quantity = token.quantity ? token.quantity : undefined;
  if (token.asset_name === 'lovelace') {
    img = token.logo;
    name = 'ADA'
  } else {
    if (assets) {
      const asset = assets.find(asset =>
        asset.policy_id === token.policy_id &&
        asset.asset_name === token.asset_name
      );
      if (asset?.metadata) {
        metadata = asset.metadata
        name = asset.metadata.ticker
        if (asset.metadata?.logo) {
          img = `data:image/png;base64,${asset.metadata.logo}`;
        }
      } else if (asset?.onchain_metadata) {
        if (asset.onchain_metadata?.image) {
          img = `${baseUrl}/api/ipfs/${asset.onchain_metadata.image.replace('ipfs://', '')}`;
        } else if (asset?.onchain_metadata['721'] && asset?.onchain_metadata['721'][asset.policy_id] && asset.onchain_metadata['721'][asset.policy_id][name]) {
          const obj = asset.onchain_metadata['721'][asset.policy_id][name];
          onchain_metadata = obj
          if (obj.image) {
            img = `${baseUrl}/api/ipfs/${obj.image.replace('ipfs://', '').replace('ipfs/', '')}`;
          }
        } else { // CIP 68
          const label = cip68Label(asset);
          if (label) {
            const assetInfo = await appWallet.getDetailedAssetsInfo(asset.policy_id, asset.asset_name);
            if (assetInfo?.cip68_metadata && assetInfo?.cip68_metadata[label]) {
              const plutusData: PlutusData = jsonToPlutusData(assetInfo.cip68_metadata[label]);
              const metadataJson = JSON.parse(plutusData.to_json(0)).fields[0];
              if (label == 333) {
                metadata = metadataJson
              }
              img = `${baseUrl}/api/ipfs/${metadataJson.logo.replace('ipfs://', '').replace('ipfs/', '')}`;
              name = metadataJson.name
            }
          }
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
  };
}

export function findCollectionName(collectible) {
  let projectName
  if (collectible?.onchain_metadata?.collection) {
    return collectible.onchain_metadata.collection
  }
  if (collectible?.onchain_metadata?.project) {
    return collectible.onchain_metadata.project
  }
  return projectName
}

export function findCollectionDescription(collectible) {
  if (collectible?.onchain_metadata?.description) {
    return collectible.onchain_metadata.description
  }
  return null
}

export function longestCommonStartingSubstring(array) {
  if (array.length == 0) {
    return
  }
  const sortedArray = [...array].sort();
  const firstItem = sortedArray[0];
  const lastItem = sortedArray[sortedArray.length - 1];
  const firstItemLength = firstItem.length;
  let i = 0;

  while (i < firstItemLength && firstItem.charAt(i) === lastItem.charAt(i)) {
    i++;
  }

  let subString = firstItem.substring(0, i);
  if (subString.endsWith('#')) {
    subString = firstItem.substring(0, i-1)
  }
  return subString.trim();
}
