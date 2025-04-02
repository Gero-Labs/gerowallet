import { Blockchain, ChainDerivations, Network, Paginate } from '@/models/types';
import { APIError, POPUP_WINDOW } from './config';
import networks from '../shared/utils/networks';
import {
  Bip32PrivateKey,
  Bip32PublicKey,
  Ed25519KeyHash,
  Ed25519PublicKey,
  Ed25519PrivateKey,
  Hash28ByteBase16,
} from '@cardano-sdk/crypto';
import { Asset, Cardano, Serialization } from '@cardano-sdk/core';
import { BigIntMath, HexBlob } from '@cardano-sdk/util';
import { bech32 } from 'bech32';
import { Buffer } from 'buffer';

const baseUrl = import.meta.env['VITE_BACKEND_URL'];

export function resolvePrivatePaymentKey(decodedHash: Buffer, keyIndex: number): Ed25519PrivateKey {
  const prvRootKeyBech32: Bip32PrivateKey = Bip32PrivateKey.fromBytes(decodedHash);
  return prvRootKeyBech32.derive([ChainDerivations.EXTERNAL, keyIndex]).toRawKey();
}

export function toUTxO(utxo: any): Serialization.TransactionUnspentOutput {
  const tokenMap = utxo.asset_list.reduce((map: Map<Cardano.AssetId, bigint>, asset: any) => {
    const assetId: Cardano.AssetId = Cardano.AssetId.fromParts(asset.policy_id, asset.asset_name);
    const current: bigint = map.get(assetId) ?? BigInt(0);
    map.set(assetId, current + BigInt(asset.quantity));
    return map;
  }, new Map<Cardano.AssetId, bigint>());

  return Serialization.TransactionUnspentOutput.fromCore([
    {
      txId: Cardano.TransactionId.fromHexBlob(utxo.tx_hash),
      index: utxo.tx_index
    },
    {
      address: Cardano.PaymentAddress(utxo.payment_addr.bech32),
      value: {
        coins: BigInt(utxo.value),
        assets: tokenMap,
      },
      datumHash: utxo.datum_hash,
      datum: utxo.inline_datum,
      scriptReference: utxo.reference_script
    }
  ]);
}

export function toValue(assets: any[], lovelace: string): Serialization.Value {
  const tokenMap = assets.reduce((map, asset) => {
    const assetId: Cardano.AssetId = Cardano.AssetId.fromParts(asset.policy_id, asset.asset_name);
    const current = map.get(assetId) ?? BigInt(0);
    map.set(assetId, current + BigInt(asset.quantity));
    return map;
  }, new Map<Cardano.AssetId, bigint>());
  return new Serialization.Value(BigInt(lovelace), tokenMap)
}

export function toStakeCredential(address: Cardano.Address): Cardano.Credential {
  return Cardano.BaseAddress.fromAddress(address)?.getStakeCredential();
}

export function toPaymentCredential(address: Cardano.Address): Cardano.Credential {
  const baseAddress = Cardano.BaseAddress.fromAddress(address)
  if (baseAddress)
    return baseAddress.getPaymentCredential();
  const enterpriseAddress = Cardano.EnterpriseAddress.fromAddress(address)
  if (enterpriseAddress)
    return enterpriseAddress.getPaymentCredential();
  return undefined;
}

export function paymentKeyHash(pubKey: Bip32PublicKey, index: number): Ed25519KeyHash {
  return pubKey
    .derive([ChainDerivations.EXTERNAL, index])
    .toRawKey()
    .hash();
}

export function stakeKeyHash(pubKey: Bip32PublicKey, index: number): Ed25519KeyHash {
  return pubKey
    .derive([ChainDerivations.CHIMERIC_ACCOUNT, index])
    .toRawKey()
    .hash();
}

export function getAddress(xpub: string, chain: string, network: string, index: number = 0): Cardano.Address {
  const networkId = networks.resolveNetworkId(chain, network);
  const pubKey = getPublicKey(xpub);
  return buildBaseAddress(networkId,
    Hash28ByteBase16.fromEd25519KeyHashHex(paymentKeyHash(pubKey, index).hex()),
    Hash28ByteBase16.fromEd25519KeyHashHex(stakeKeyHash(pubKey, 0).hex())).toAddress();
}

export function buildBaseAddress(networkId: Cardano.NetworkId, paymentKeyHash: Hash28ByteBase16, stakeKeyHash: Hash28ByteBase16) {
  return Cardano.BaseAddress.fromCredentials(
    networkId,
    {
      hash: paymentKeyHash,
      type: Cardano.CredentialType.KeyHash
    },
    {
      hash: stakeKeyHash,
      type: Cardano.CredentialType.KeyHash
    }
  );
}

export function buildEnterpriseAddress(networkId: Cardano.NetworkId, paymentKeyHash: Hash28ByteBase16) {
  return Cardano.EnterpriseAddress.fromCredentials(networkId, {
    hash: paymentKeyHash,
    type: Cardano.CredentialType.KeyHash
  });
}

export function buildRewardAddress(networkId: Cardano.NetworkId, stakeKeyHash: Hash28ByteBase16) {
  return Cardano.RewardAddress.fromCredentials(networkId, {
    type: Cardano.CredentialType.KeyHash,
    hash: stakeKeyHash
  });
}

export function getUtxos(
  amount: string = undefined,
  paginate: Paginate = undefined,
  utxos: any[],
  collateral: any
): Serialization.TransactionUnspentOutput[] {

  // Exclude collateral input from the overall UTXO set
  if (collateral) {
    utxos = utxos.filter(
      (utxo) =>
        !(utxo.tx_hash === collateral.tx_hash && utxo.tx_index === collateral.tx_index)
    );
  }

  // Convert raw UTXOs to the appropriate format
  const converted: Serialization.TransactionUnspentOutput[] = utxos.map((utxo) => toUTxO(utxo));

  // If no amount is specified, return all UTXOs (with optional pagination)
  if (!amount) {
    if (paginate) {
      const start = paginate.page * paginate.limit;
      const end = start + paginate.limit;
      return converted.slice(start, end);
    }
    return converted;
  }

  // Parse the target value from the provided hex string
  let targetValue: Serialization.Value;
  try {
    targetValue = Serialization.Value.fromCbor(HexBlob(amount));
  } catch (e) {
    throw APIError.InvalidRequest;
  }

  // Determine if the target is pure ADA (i.e. no multiassets)
  const targetMultiasset = targetValue.multiasset();
  const isPureTarget: boolean = !targetMultiasset || targetMultiasset.size === 0;

  // Separate UTXOs into pure ADA and those with multiassets
  const pureUtxos: Serialization.TransactionUnspentOutput[] = [];
  const multiUtxos: Serialization.TransactionUnspentOutput[] = [];
  for (const utxo of converted) {
    const utxoValue = utxo.output().amount();
    const ma = utxoValue.multiasset();
    if (!ma || ma.size === 0) {
      pureUtxos.push(utxo);
    } else {
      multiUtxos.push(utxo);
    }
  }

  const selectedUtxos: Serialization.TransactionUnspentOutput[] = [];
  let accumulatedValue: Serialization.Value = new Serialization.Value(BigInt(0));

  if (isPureTarget) {
    // --- Try to accumulate from pure ADA UTXOs first ---
    pureUtxos.sort((a, b) => {
      const aAda = a.output().amount().coin();
      const bAda = b.output().amount().coin();
      return aAda < bAda ? -1 : aAda > bAda ? 1 : 0;
    });

    for (const utxo of pureUtxos) {
      selectedUtxos.push(utxo);
      accumulatedValue = coalesceValueQuantities([accumulatedValue, utxo.output().amount()])
      // Break if we've reached or exceeded the target value
      if (accumulatedValue.coin() >= targetValue.coin()) {
        break;
      }
    }

    // --- If pure ADA UTXOs were insufficient, add multiasset UTXOs ---
    if (accumulatedValue.coin() < targetValue.coin()) {
      multiUtxos.sort((a, b) => {
        const aAda = a.output().amount().coin();
        const bAda = b.output().amount().coin();
        return aAda < bAda ? -1 : aAda > bAda ? 1 : 0;
      });
      for (const utxo of multiUtxos) {
        selectedUtxos.push(utxo);
        accumulatedValue = coalesceValueQuantities([accumulatedValue, utxo.output().amount()])
        if (accumulatedValue.coin() >= targetValue.coin()) {
          break;
        }
      }
    }
  } else {
    // For targets that include multiassets, accumulate from all UTXOs
    const sortedUtxos = [...converted].sort((a, b) => {
      const aAda = BigInt(a.output().amount().coin());
      const bAda = BigInt(b.output().amount().coin());
      return aAda < bAda ? -1 : aAda > bAda ? 1 : 0;
    });
    for (const utxo of sortedUtxos) {
      selectedUtxos.push(utxo);
      accumulatedValue = coalesceValueQuantities([accumulatedValue, utxo.output().amount()])
      if (accumulatedValue.coin() >= targetValue.coin()) {
        break;
      }
    }
  }

  // If we couldn't accumulate enough value, return null
  if (accumulatedValue.coin() < targetValue.coin()) {
    return null;
  }

  // Apply pagination if provided
  if (paginate) {
    const start = paginate.page * paginate.limit;
    const end = start + paginate.limit;
    return selectedUtxos.slice(start, end);
  }

  return selectedUtxos;
}

export function getBalance(utxos: any[], collateral: any): Serialization.Value {
  const assets: any[] = []
  let lovelace = 0;
  if (collateral) {
    utxos = utxos.filter(utxo => !(utxo.tx_hash === collateral.tx_hash && utxo.tx_index === collateral.tx_index))
  }
  utxos.forEach(utxo => {
    assets.push(...utxo.asset_list)
    lovelace += Number(utxo.value)
  })
  return toValue(assets, lovelace.toString());
}

export function coalesceValueQuantities(quantities: Serialization.Value[]): Serialization.Value {
  return new Serialization.Value(BigIntMath.sum(quantities.map(({ coin }) => coin())), Asset.util.coalesceTokenMaps(quantities.map(({ multiasset }) => multiasset())));
}

export function getRewardAddress(xpub: string, chain: string, network: string): Cardano.Address {
  const stakeKey = getStakeKey(xpub, 0);
  const networkId = networks.resolveNetworkId(chain, network)
  return Cardano.RewardAddress.fromCredentials(
    networkId,
    {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16.fromEd25519KeyHashHex(stakeKey.hash().hex())
    }).toAddress()
}

export function getCip129DrepId(xpub: string): Cardano.DRepID {
  const drepKey = getDrepKey(xpub, 0);
  return Cardano.DRepID.cip129FromCredential(
    {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16.fromEd25519KeyHashHex(drepKey.hash().hex())
    })
}

const MAX_COLLATERAL_AMOUNT = 5_000_000n;

const getFilterAsBigNum = (amount: string): bigint => {
  const reader = new Serialization.CborReader(HexBlob(amount));

  if (
    reader.peekState() === Serialization.CborReaderState.Tag &&
    reader.peekTag() === Serialization.CborTag.UnsignedBigNum
  ) {
    reader.readTag();
    return BigInt(`0x${HexBlob.fromBytes(reader.readByteString())}`).valueOf();
  }

  return reader.readInt();
};

const getFilterAmount = (amount: string): bigint => {
    const filterAmount = getFilterAsBigNum(amount);

    if (filterAmount > MAX_COLLATERAL_AMOUNT) {
      const error = APIError.InvalidRequest;
      error.info = 'The Requested Amount is Too Big';
      throw error
    }
    return filterAmount;
};

export function getCollateral({ amount = new Serialization.Value(MAX_COLLATERAL_AMOUNT).toCbor() }: { amount?: string } = {}, storedUtxos: any[]): string[] {
  if (!storedUtxos || !Array.isArray(storedUtxos)) {
    const error = APIError.InvalidRequest;
    error.info = 'No UTXOs available in wallet.';
    throw error;
  }
  let filteredUtxos = storedUtxos.filter(utxo => Array.isArray(utxo.asset_list) && utxo.asset_list.length === 0)
  if (filteredUtxos.length === 0) {
    const error = APIError.InvalidRequest;
    error.info = 'No UTXOs available in wallet.';
    throw error;
  }
  if (amount) {
    let filterAmount = MAX_COLLATERAL_AMOUNT;
    try {
      filterAmount = getFilterAmount(amount);
    } catch (e) {
      const error = APIError.InternalError;
      error.info = (e as Error)?.message || 'Unknown error';
      throw error;
    }
    const utxos = [];
    let totalCoins = 0n;
    for (const utxo of filteredUtxos) {
      const coin = utxo.value;
      totalCoins += BigInt(coin);
      utxos.push(utxo);
      if (totalCoins >= filterAmount) break;
    }
    if (totalCoins < filterAmount) {
      const error = APIError.Refused;
      error.info = 'not enough coins in configured collateral UTxOs';
      throw error
    }
    filteredUtxos = utxos;
  }
  return filteredUtxos.map((utxo) => toUTxO(utxo).toCbor());
}

export function getUsedAddresses(addresses: {}, paginate?: Paginate): HexBlob[] {
  let res: HexBlob[] = []
  const addressesArray: any[] = Object.values(addresses)
  if (addressesArray && Array.isArray(addressesArray)) {
    addressesArray.sort((a,b) => (a['path'] > b['path']) ? 1 : ((b['path'] > a['path']) ? -1 : 0))
    const addressesArrayHex: HexBlob[] = addressesArray.map(el => Cardano.Address.fromBech32(el['address']).toBytes())
    res = paginateArray(addressesArrayHex, paginate);
  }
  return res
}

export function getUnusedAddresses(xpub: string, chain: string, network: string, addresses: {}): HexBlob[] {
  console.debug('getting unused addresses');
  let addressesArray: any[] = Object.values(addresses)
  let highestIndex: number = 0;
  if (addressesArray && Array.isArray(addressesArray)) {
    addressesArray.forEach(el => {
      const hdPath: number[] = hdPathToArray(el['path'])
      if (hdPath[3] === 0) {
        if (hdPath[4] > highestIndex) {
          highestIndex = hdPath[4]
        }
      }
    })
  }
  return [getAddress(xpub, chain, network, highestIndex + 1).toBytes()]
}

function paginateArray(array: HexBlob[], paginate?: Paginate): HexBlob[] {
  let page = 0;
  let limit = array.length;
  if (paginate) {
    page = paginate.page;
    limit = paginate.limit;
  }
  const start = page * limit;
  const end = start + limit;
  return array.slice(start, end);
}

export async function focusOrCreatePopup(url: string, width: number, height: number): Promise<chrome.tabs.Tab> {
  const windows: chrome.windows.Window[] = await chrome.windows.getAll({ populate: true });
  let existingWindow = null;
  let tabb: chrome.tabs.Tab;
  // Iterate through each window and its tabs to find the URL
  for (const window of windows) {
    if (window.type === 'popup') {
      for (const tab of window.tabs) {
        if (tab.url === url) {
          existingWindow = window;
          tabb = tab;
          break;
        }
      }
      if (existingWindow) break;
    }
  }

  if (existingWindow) {
    // Focus on the existing window
    await chrome.windows.update(existingWindow.id, { focused: true });
    return tabb;
  } else {
    // Create a new window with the specified URL
    const window: chrome.windows.Window = await chrome.windows.create({
      url: url,
      type: 'popup',
      focused: true,
      ...POPUP_WINDOW,
      width: width,
      height: height,
    });
    return window.tabs[0];
  }
}

export async function submitTx(tx: string, chain: string, network: string): Promise<Response>  {
  const chainEnum: string = Object.keys(Blockchain).find(key => Blockchain[key] === chain);
  const networkEnum: string = Object.keys(Network).find(key => Network[key] === network);
  return await fetch(`${baseUrl}/api/transactions/submit-tx?chain=${chainEnum}&network=${networkEnum}&provider=KOIOS`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: tx
  })
}

export const urlScan = async url => {
  const result = await fetch(`${baseUrl}/api/url/scan?url=${url}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (result) {
    console.log('result', result);
  }
  return result;
};

export function getPublicKey(xpub: string): Bip32PublicKey {
  const { words } = bech32.decode(xpub, 200);
  const byteArray = Uint8Array.from(bech32.fromWords(words));
  return Bip32PublicKey.fromBytes(byteArray);
}

export function getStakeKey(xpub: string, index: number): Ed25519PublicKey {
  return getPublicKey(xpub)
    .derive([ChainDerivations.CHIMERIC_ACCOUNT, index])
    .toRawKey()
}

export function getDrepKey(xpub: string, index): Ed25519PublicKey {
  return getPublicKey(xpub)
    .derive([ChainDerivations.DREP, index])
    .toRawKey()
}

export function hdPathToArray(path: string): number[] {
  // Remove the 'm/' part of the path and split by '/'
  const parts = path.replace('m/', '').split('/');

  // Convert each part to an integer, handling hardened indices
  return parts.map(part => {
    if (part.endsWith("'")) {
      // If the part ends with an apostrophe, it's a hardened index
      return parseInt(part.slice(0, -1), 10) + 0x80000000; // Add the hardened flag
    } else {
      // Otherwise, it's a normal index
      return parseInt(part, 10);
    }
  });
}
