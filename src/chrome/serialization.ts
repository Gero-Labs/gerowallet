import { Blockchain, ChainDerivations, Network, Paginate, UTxO } from '@/models/types';
import { APIError, DataSignError, POPUP_WINDOW } from './config';
import networks from '@/utils/networks';
import {
  Bip32PublicKey,
  Ed25519KeyHash,
  Ed25519KeyHashHex,
  Ed25519PublicKey,
  Hash28ByteBase16,
  Hash32ByteBase16,
} from '@cardano-sdk/crypto';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { bech32, bech32m, Decoded } from 'bech32';
import { Buffer } from 'buffer';

const baseUrl = import.meta.env['VITE_BACKEND_URL'];

export function jsonToPlutusData(jsonObj): Serialization.PlutusData {
  function parsePlutusData(data): Serialization.PlutusData {
    if ('bytes' in data) {
      return Serialization.PlutusData.newBytes(Buffer.from(data.bytes, 'hex'));
    } else if (data.int !== undefined) {
      return Serialization.PlutusData.newInteger(BigInt(data.int.toString()));
    } else if (data.list) {
      const plutusList: Serialization.PlutusList = new Serialization.PlutusList();
      data.list.forEach(item => {
        plutusList.add(parsePlutusData(item));
      });
      return Serialization.PlutusData.newList(plutusList);
    } else if (data.map) {
      const plutusMap: Serialization.PlutusMap = new Serialization.PlutusMap();
      data.map.forEach(item => {
        const key: Serialization.PlutusData = parsePlutusData(item.k);
        const value: Serialization.PlutusData = parsePlutusData(item.v);
        plutusMap.insert(key, value);
      });
      return Serialization.PlutusData.newMap(plutusMap);
    } else if (data.constructor !== undefined && data.fields) {
      const constrFields: Serialization.PlutusList = new Serialization.PlutusList();
      data.fields.forEach(field => {
        constrFields.add(parsePlutusData(field));
      });
      return Serialization.PlutusData.newConstrPlutusData(
        new Serialization.ConstrPlutusData(
          BigInt(data.constructor.toString()),
          constrFields
        )
      );
    } else {
      throw new Error('Unsupported Plutus Data format');
    }
  }
  return parsePlutusData(jsonObj);
}

export function isPaymentAddress(address: string): boolean {
  return Cardano.Address.isValid(address) || Cardano.Address.isValidByron(address);
}

export function toValueCore(amount: { unit: string; quantity: string; }[]): Cardano.Value {
  const value: Cardano.Value = {
    coins: BigInt(0),
    assets: new Map<Cardano.AssetId, bigint>()
  };
  amount.forEach(amt => {
    if (amt.unit === 'lovelace') {
      value.coins = BigInt(amt.quantity);
    } else {
      const assetId: Cardano.AssetId = Cardano.AssetId(amt.unit);
      const current: bigint = value.assets?.get(assetId) ?? BigInt(0);
      value.assets?.set(assetId, current + BigInt(amt.quantity));
    }
  });
  return value;
}

export function toStakeCredential(address: Cardano.Address): Cardano.Credential {
  return Cardano.BaseAddress.fromAddress(address)?.getStakeCredential();
}

export function toStakeAddress(addressBech32: string, networkId: Cardano.NetworkId): string {
  if (Cardano.Address.fromString(addressBech32).getType() !== Cardano.AddressType.BasePaymentKeyStakeKey &&
      Cardano.Address.fromString(addressBech32).getType() !== Cardano.AddressType.BasePaymentScriptStakeKey) {
    return undefined;
  }
  const stakeCredential: Cardano.Credential = toStakeCredential(Cardano.Address.fromBech32(addressBech32));
  if (!stakeCredential) {
    return undefined;
  }
  return Cardano.RewardAddress
    .fromCredentials(networkId, stakeCredential)
    .toAddress()
    .toBech32();
}

export function toPaymentCredential(address: Cardano.Address): Cardano.Credential {
  try {
    const baseAddress: Cardano.BaseAddress = Cardano.BaseAddress.fromAddress(address)
    if (baseAddress)
      return baseAddress.getPaymentCredential();
  } catch (e) {
    // ignore
  }
  try {
    const enterpriseAddress: Cardano.EnterpriseAddress = Cardano.EnterpriseAddress.fromAddress(address)
    if (enterpriseAddress)
      return enterpriseAddress.getPaymentCredential();
  } catch (e) {
    // ignore
  }
  try {
    const pointerAddress: Cardano.PointerAddress = Cardano.PointerAddress.fromAddress(address)
    if (pointerAddress)
      return pointerAddress.getPaymentCredential();
  } catch (e) {
    // ignore
  }
  try {
    const rewardAddress: Cardano.RewardAddress = Cardano.RewardAddress.fromAddress(address)
    if (rewardAddress)
      return rewardAddress.getPaymentCredential();
  } catch (e) {
    // ignore
  }
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
    Hash28ByteBase16(paymentKeyHash(pubKey, index).hex()),
    Hash28ByteBase16(stakeKeyHash(pubKey, 0).hex())).toAddress();
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

export function getUtxos(
  amount: string = undefined,
  paginate: Paginate = undefined,
  utxos: Cardano.Utxo[],
  collateral: Cardano.Utxo
): Serialization.TransactionUnspentOutput[] {
  // Exclude collateral input from the overall UTXO set
  if (collateral) {
    utxos = utxos.filter(
      (utxo) =>
        !(utxo[0].txId === collateral[0].txId && utxo[0].index === collateral[0].index)
    );
  }

  // Convert raw UTXOs to the appropriate format
  const converted: Serialization.TransactionUnspentOutput[] = utxos.map((utxo: Cardano.Utxo) => {
    // Reconstruct the value with proper Map for assets (needed after JSON deserialization)
    let value = utxo[1].value;
    if (value?.assets && !(value.assets instanceof Map)) {
      const assetsMap = new Map<Cardano.AssetId, bigint>();
      // Convert plain object back to Map
      Object.entries(value.assets).forEach(([assetId, quantity]) => {
        assetsMap.set(assetId as Cardano.AssetId, BigInt(quantity as any));
      });
      value = {
        coins: BigInt(value.coins),
        assets: assetsMap
      };
    } else if (value) {
      // Ensure coins is BigInt even if no assets
      value = {
        coins: BigInt(value.coins),
        assets: value.assets || undefined
      };
    }

    return Serialization.TransactionUnspentOutput.fromCore([{
      txId: utxo[0].txId,
      index: utxo[0].index
    }, {
      address: utxo[1].address,
      value: value,
      datumHash: utxo[1].datumHash,
      datum: utxo[1].datum,
      scriptReference: utxo[1].scriptReference
    }]);
  });

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

export function getBalance(utxos: Cardano.Utxo[], collateral: Cardano.Utxo): Serialization.Value {
  let accumulatedValue: Serialization.Value = new Serialization.Value(BigInt(0));
  if (utxos && collateral) {
    utxos = utxos.filter((utxo: Cardano.Utxo) => !(utxo[0].txId === collateral[0].txId && utxo[0].index === collateral[0].index))
  }
  utxos.forEach((utxo: Cardano.Utxo) => {
    // Ensure coins is BigInt and assets is a Map (handle deserialization from storage)
    let utxoValue = utxo[1].value;

    // Convert coins to BigInt if it's a string
    const coins = typeof utxoValue.coins === 'string' ? BigInt(utxoValue.coins) : BigInt(utxoValue.coins);

    // Convert assets to Map if it's a plain object
    let assets: Map<Cardano.AssetId, bigint> | undefined = undefined;
    if (utxoValue.assets) {
      if (utxoValue.assets instanceof Map) {
        assets = utxoValue.assets;
      } else {
        // Convert plain object to Map
        assets = new Map<Cardano.AssetId, bigint>();
        Object.entries(utxoValue.assets).forEach(([assetId, quantity]) => {
          assets!.set(assetId as Cardano.AssetId, BigInt(quantity as any));
        });
      }
    }

    const value: Serialization.Value = Serialization.Value.fromCore({
      coins,
      assets
    });
    accumulatedValue = coalesceValueQuantities([accumulatedValue, value]);
  })
  return accumulatedValue;
}

export function coalesceValueQuantities(quantities: Serialization.Value[]): Serialization.Value {
  const value: Serialization.Value = new Serialization.Value(BigInt(0), new Map<Cardano.AssetId, bigint>());
  quantities.forEach((val: Serialization.Value) => {
    value.setCoin(value.coin() + val.coin());
    const tokenMap = value.multiasset();
    val.multiasset()?.forEach((quantity, assetId) => {
      const current = tokenMap.get(assetId) ?? BigInt(0);
      tokenMap.set(assetId, current + quantity);
    })
    value.setMultiasset(tokenMap);
  })
  return value;
}

export function getRewardAddress(xpub: string, chain: string, network: string): Cardano.Address {
  const stakeKey = getStakeKey(xpub, 0);
  const networkId = networks.resolveNetworkId(chain, network)
  return Cardano.RewardAddress.fromCredentials(
    networkId,
    {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16(stakeKey.hash().hex())
    }).toAddress()
}

export function getCip129DrepId(xpub: string): Cardano.DRepID {
  const drepKey = getDrepKey(xpub, 0);
  return Cardano.DRepID.cip129FromCredential(
    {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16(drepKey.hash().hex())
    })
}

export function getCip105DrepId(xpub: string): Cardano.DRepID {
  const drepKey = getDrepKey(xpub, 0);
  return Cardano.DRepID.cip105FromCredential(
    {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16(drepKey.hash().hex())
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

export function getUsedAddresses(keys: any, paginate?: Paginate): HexBlob[] {
  let res: HexBlob[] = []
  const addresses: string[] = keys.payment.filter(a => a.used);
  if (addresses && Array.isArray(addresses)) {
    const addressesArrayHex: HexBlob[] = addresses.map(el => Cardano.Address.fromBech32(el['address']).toBytes());
    res = paginateArray(addressesArrayHex, paginate);
  }
  return res
}

export function getUnusedAddresses(xpub: string, chain: string, network: string, keys: any): HexBlob[] {
  let res: HexBlob[] = []
  const addresses: string[] = keys.payment.filter(a => !a.used);
  if (addresses && Array.isArray(addresses)) {
    res = addresses.map(el => Cardano.Address.fromBech32(el['address']).toBytes());
    if (res.length == 0) {
      let highestIndex: number = 0
      const usedAddresses = keys.payment.filter(a => a.used)
      usedAddresses.forEach((usedAddress: any) => {
        const hdPath: number[] = hdPathToArray(usedAddress.path)
        if (hdPath[3] === 0 && hdPath[4] > highestIndex) {
          highestIndex = hdPath[4]
        }
      });
      res = [getAddress(xpub, chain, network, highestIndex + 1).toBytes()]
    }
  }
  return res;
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
  return fetch(`${baseUrl}/api/transactions/submit-tx?chain=${chainEnum}&network=${networkEnum}&provider=KOIOS`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: tx
  })
}

export const urlScan = async (url: string) => {
  return fetch(`${baseUrl}/api/url/scan?url=${url}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

export function getPublicKey(xpub: string): Bip32PublicKey {
  let words: Decoded;
  try {
    words = bech32.decode(xpub, 120);
  } catch (e) {
    words = bech32m.decode(xpub, 120);
  }
  const byteArray = Uint8Array.from(bech32.fromWords(words.words));
  return Bip32PublicKey.fromBytes(byteArray);
}

export function getPaymentKeyExternal(xpub: string, index: number): Ed25519PublicKey {
  return getPublicKey(xpub)
    .derive([ChainDerivations.EXTERNAL, index])
    .toRawKey()
}

export function getPaymentKeyInternal(xpub: string, index: number): Ed25519PublicKey {
  return getPublicKey(xpub)
    .derive([ChainDerivations.INTERNAL, index])
    .toRawKey()
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

export function getCcColdKey(xpub: string, index): Ed25519PublicKey {
  return getPublicKey(xpub)
    .derive([ChainDerivations.CONSTITUTIONAL_COMMITTEE_COLD, index])
    .toRawKey()
}

export function getCcHotKey(xpub: string, index): Ed25519PublicKey {
  return getPublicKey(xpub)
    .derive([ChainDerivations.CONSTITUTIONAL_COMMITTEE_HOT, index])
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

export function toUTxO(utxo: UTxO): Serialization.TransactionUnspentOutput {
  const tokenMap: Cardano.TokenMap = utxo.asset_list.reduce((map: Cardano.TokenMap, asset: any) => {
    const assetId: Cardano.AssetId = Cardano.AssetId.fromParts(asset.policy_id, asset.asset_name);
    const current: bigint = map.get(assetId) ?? BigInt(0);
    map.set(assetId, current + BigInt(asset.quantity));
    return map;
  }, new Map<Cardano.AssetId, bigint>());

  return Serialization.TransactionUnspentOutput.fromCore([
    {
      txId: Cardano.TransactionId.fromHexBlob(HexBlob(utxo.tx_hash)),
      index: utxo.tx_index
    },
    {
      address: Cardano.PaymentAddress(utxo.payment_addr.bech32),
      value: {
        coins: BigInt(utxo.value),
        assets: tokenMap,
      },
      datumHash: utxo.datum_hash ? Hash32ByteBase16.fromHexBlob(HexBlob(utxo.datum_hash)) : null,
      datum: utxo.inline_datum ? Serialization.PlutusData.fromCbor(HexBlob(utxo.inline_datum.bytes)).toCore() : null,
      scriptReference: utxo.reference_script ? Serialization.Script.fromCbor(HexBlob(utxo.reference_script.bytes)).toCore() : null
    }
  ]);
}

/**
 * Detect a type of hex encoded addr and convert to PaymentAddress or RewardAddress.
 *
 * @param addr when hex encoded, it can be a PaymentAddress, RewardAddress or DRepKeyHash
 * @returns PaymentAddress | RewardAddress DRepKeyHash is converted to a type 6 address
 */
export function addrToSignWith(addr: Cardano.PaymentAddress | Cardano.RewardAccount | string): Cardano.PaymentAddress | Cardano.RewardAccount {
  try {
    return Cardano.isRewardAccount(addr) ? Cardano.RewardAccount(addr) : Cardano.PaymentAddress(addr);
  } catch {
    // Try to parse as drep key hash
    const drepKeyHash = Ed25519KeyHashHex(addr);
    const drepId = Cardano.DRepID.cip129FromCredential({
      hash: Hash28ByteBase16(drepKeyHash),
      type: Cardano.CredentialType.KeyHash
    });
    const drepAddr: Cardano.Address = Cardano.DRepID.toAddress(drepId)?.toAddress();
    if (!drepAddr) {
      throw DataSignError.AddressNotPK;
    }
    return drepAddr.toBech32();
  }
}

export function keyHashFromAddress(address: string): Hash28ByteBase16 {
  const keyAddress: Cardano.Address = Cardano.Address.fromBech32(address);
  try {
    return Cardano.BaseAddress.fromAddress(keyAddress).getPaymentCredential().hash;
  } catch (e) {
    // I want the application to not crush but don't care about the message
  }
  try {
    return Cardano.EnterpriseAddress.fromAddress(keyAddress).getPaymentCredential().hash
  } catch (e) {
    // I want the application to not crush but don't care about the message
  }
  try {
    return Cardano.PointerAddress.fromAddress(keyAddress).getPaymentCredential().hash
  } catch (e) {
    // I want the application to not crush but don't care about the message
  }
  try {
    return Cardano.RewardAddress.fromAddress(keyAddress).getPaymentCredential().hash
  } catch (e) {
    // I want the application to not crush but don't care about the message
  }
  return undefined;
}
