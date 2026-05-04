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
import { nexusCollateralApi } from '@/api/nexus-collateral-api';
import { debugLog } from '@/utils/debug';

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
  if (!addressBech32) return undefined;
  const address = Cardano.Address.fromString(addressBech32);
  if (!address) return undefined;
  const type = address.getType();
  if (type !== Cardano.AddressType.BasePaymentKeyStakeKey &&
      type !== Cardano.AddressType.BasePaymentScriptStakeKey) {
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

export function filterOutCollateralFromUTxOs(utxos: Cardano.Utxo[], collateral: Cardano.Utxo) {
  if (collateral) {
    return utxos.filter(
      (utxo) =>
        !(utxo[0].txId === collateral[0].txId && utxo[0].index === collateral[0].index)
    );
  }
  return utxos;
}

export function getUtxos(
  amount: string = undefined,
  paginate: Paginate = undefined,
  utxos: Cardano.Utxo[],
  collateral: Cardano.Utxo
): Serialization.TransactionUnspentOutput[] {
  // Exclude collateral input from the overall UTXO set
  utxos = filterOutCollateralFromUTxOs(utxos, collateral);

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

export async function getCollateral(
  { amount = new Serialization.Value(MAX_COLLATERAL_AMOUNT).toCbor() }: { amount?: string } = {},
  storedUtxos: Cardano.Utxo[]
): Promise<string[]> {
  if (!storedUtxos || !Array.isArray(storedUtxos)) {
    const error = APIError.InvalidRequest;
    error.info = 'No UTXOs available in wallet.';
    throw error;
  }

  let filterAmount = MAX_COLLATERAL_AMOUNT;
  if (amount) {
    try {
      filterAmount = getFilterAmount(amount);
    } catch (e) {
      const error = APIError.InternalError;
      error.info = (e as Error)?.message || 'Unknown error';
      throw error;
    }
  }

  // Pass 1: try to satisfy from the user's own pure-ADA UTxOs.
  // Cardano.Utxo is [TxIn, TxOut] where TxOut.value = { coins: bigint, assets?: Map }
  const pureAdaUtxos = storedUtxos.filter((utxo) => {
    const txOut = utxo[1];
    return !txOut.value.assets || txOut.value.assets.size === 0;
  });

  const selected: Cardano.Utxo[] = [];
  let totalCoins = 0n;
  for (const utxo of pureAdaUtxos) {
    selected.push(utxo);
    totalCoins += BigInt(utxo[1].value.coins);
    if (totalCoins >= filterAmount) break;
  }

  if (totalCoins >= filterAmount) {
    return selected.map((utxo) => Serialization.TransactionUnspentOutput.fromCore(utxo).toCbor());
  }

  // Pass 2 — Nexus shared-pool fallback. The wallet has no own pure-ADA UTxO
  // big enough for collateral, so ask Nexus to lend one of the pool UTxOs at
  // its enterprise address. The returned ref points to a real on-chain UTxO
  // we don't control; on signTx the background detects the pool address and
  // calls /v1/collateral/cosign for the witness.
  try {
    const lent = await nexusCollateralApi.lend();
    const utxoCbor = buildNexusUtxoCbor(lent);
    return [utxoCbor];
  } catch (lendErr) {
    debugLog('[getCollateral] Nexus lend fallback failed:', lendErr);
    const error = APIError.Refused;
    error.info = pureAdaUtxos.length === 0
      ? 'No pure ADA UTXOs available for collateral.'
      : 'not enough coins in configured collateral UTxOs';
    throw error;
  }
}

/**
 * Build the CIP-30 {@code TransactionUnspentOutput} CBOR for a Nexus-lent UTxO.
 * Nexus returns raw fields ({@code txHash}, {@code outputIndex}, {@code address},
 * {@code lovelace}); we synthesize the cardano-sdk core shape here so the call
 * site can return the same kind of value used elsewhere in this file.
 */
function buildNexusUtxoCbor(lent: { txHash: string; outputIndex: number; address: string; lovelace: string }): string {
  const address = Cardano.PaymentAddress(lent.address);
  const utxo: Cardano.Utxo = [
    {
      txId: Cardano.TransactionId(lent.txHash),
      index: lent.outputIndex,
      address,
    },
    {
      address,
      value: { coins: BigInt(lent.lovelace) },
    },
  ];
  return Serialization.TransactionUnspentOutput.fromCore(utxo).toCbor();
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

// Track pending popup creations to prevent race conditions
const pendingPopups = new Map<string, Promise<chrome.tabs.Tab>>();

export async function focusOrCreatePopup(url: string, width: number, height: number): Promise<chrome.tabs.Tab> {
  // Check if we're already creating a popup for this URL
  if (pendingPopups.has(url)) {
    console.log('⏳ Popup already being created for:', url);
    return pendingPopups.get(url);
  }

  // Create the popup promise
  const popupPromise = (async () => {
    try {
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
        console.log('✅ Focusing existing popup:', url);
        await chrome.windows.update(existingWindow.id, { focused: true });
        return tabb;
      } else {
        // Create a new window with the specified URL
        console.log('🆕 Creating new popup:', url);
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
    } finally {
      // Clean up the pending popup tracking after creation
      pendingPopups.delete(url);
    }
  })();

  // Store the promise to prevent concurrent creations
  pendingPopups.set(url, popupPromise);

  return popupPromise;
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
    words = bech32.decode(xpub, 1023);
  } catch (e) {
    words = bech32m.decode(xpub, 1023);
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
 * Detect address format and convert to PaymentAddress or RewardAddress.
 * Handles bech32 (addr1…, stake1…), hex-encoded raw bytes (CIP-30 spec), and DRepKeyHash.
 *
 * @param addr bech32 address, hex-encoded address bytes, or DRepKeyHash
 * @returns PaymentAddress | RewardAddress (DRepKeyHash is converted to a type 6 address)
 */
export function addrToSignWith(addr: Cardano.PaymentAddress | Cardano.RewardAccount | string): Cardano.PaymentAddress | Cardano.RewardAccount {
  // 1. Try bech32 (addr1…, stake1…)
  try {
    return Cardano.isRewardAccount(addr) ? Cardano.RewardAccount(addr) : Cardano.PaymentAddress(addr);
  } catch {
    // Not bech32 — continue
  }

  // 2. Try hex-encoded address bytes (CIP-30 spec format)
  try {
    const addressBytes = Buffer.from(addr, 'hex');
    const cardanoAddr = Cardano.Address.fromBytes(addressBytes);
    const bech32Addr = cardanoAddr.toBech32();
    const addrType = cardanoAddr.getType();
    if (addrType === Cardano.AddressType.RewardKey || addrType === Cardano.AddressType.RewardScript) {
      return bech32Addr as unknown as Cardano.RewardAccount;
    }
    return bech32Addr as unknown as Cardano.PaymentAddress;
  } catch {
    // Not hex address — continue
  }

  // 3. Try DRep key hash
  try {
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
  } catch {
    throw DataSignError.AddressNotPK;
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

/**
 * Creates legacy UTXO structure from Cardano JS SDK transaction format
 * This is needed for TransactionDetails component compatibility and transaction calculations
 * @param tx - Transaction with Cardano JS SDK body structure
 * @param utxos - Current wallet UTXOs for input resolution
 * @returns Legacy UTXO structure with inputs and outputs
 */
export function createUtxoStructure(tx: any, utxos: Cardano.Utxo[]): any {
  const inputs: any[] = [];
  const outputs: any[] = [];

  // Convert inputs from Cardano JS SDK format to legacy format
  // For inputs, we need to find the actual UTXO values from our UTXO set
  if (tx.body?.inputs) {
    tx.body.inputs.forEach((input: any) => {
      // Try to find the corresponding UTXO from provided UTXOs
      const utxo = utxos.find((utxo: any) =>
        utxo[0].txId === input.txId && utxo[0].index === input.index
      );

      let address = '';
      let amount: any[] = [];

      if (utxo) {
        // Use the actual UTXO data
        address = utxo[1].address;
        amount = [{
          unit: 'lovelace',
          quantity: Number(utxo[1].value.coins)
        }];

        if (utxo[1].value.assets && utxo[1].value.assets.size > 0) {
          utxo[1].value.assets.forEach((quantity: bigint, assetId: string) => {
            amount.push({
              unit: assetId,
              quantity: Number(quantity)
            });
          });
        }
      }

      inputs.push({
        tx_hash: input.txId,
        output_index: input.index,
        address: address,
        amount: amount
      });
    });
  }

  // Convert outputs from Cardano JS SDK format to legacy format
  if (tx.body?.outputs) {
    tx.body.outputs.forEach((output: any, index: number) => {
      const amount: any[] = [{
        unit: 'lovelace',
        quantity: Number(output.value.coins)
      }];

      // Convert assets map to array format
      if (output.value.assets && output.value.assets.size > 0) {
        output.value.assets.forEach((quantity: bigint, assetId: string) => {
          amount.push({
            unit: assetId,
            quantity: Number(quantity)
          });
        });
      }

      outputs.push({
        output_index: index,
        address: output.address,
        amount: amount
      });
    });
  }

  return {
    inputs,
    outputs
  };
}

/**
 * Converts transactions to database schema format
 * Handles various transaction formats including Cardano JS SDK and legacy formats
 * @param txs - Array of transactions to convert
 * @param utxos - Current wallet UTXOs for input resolution
 * @returns Array of converted transactions ready for database storage
 */
export function convertTransactionsForStorage(txs: any[], utxos: Cardano.Utxo[]): any[] {
  // First pass: build a lookup map of all outputs (txHash#index → amount[])
  // so that inputs in other transactions can find their native token amounts.
  // We deserialize CBOR for transactions that have it but no body yet.
  const outputLookup = new Map<string, any[]>();
  for (const tx of txs) {
    const txHash = tx.tx_hash || tx.id;
    if (!txHash) continue;

    let outputs: any[] | undefined;
    if (tx.body?.outputs) {
      outputs = tx.body.outputs;
    } else if (tx.cbor && !tx.body) {
      // Skip non-array CBOR (e.g. bare TxBody from Apex chain)
      const firstByte = typeof tx.cbor === 'string' ? parseInt(tx.cbor.slice(0, 2), 16) : 0;
      if ((firstByte >> 5) === 4) {
        try {
          const deserialized = Serialization.TxCBOR.deserialize(Serialization.TxCBOR(tx.cbor));
          outputs = deserialized.body?.outputs;
        } catch { /* skip */ }
      }
    }

    if (outputs) {
      outputs.forEach((output: any, index: number) => {
        const amount: any[] = [{
          unit: 'lovelace',
          quantity: Number(output.value?.coins ?? output.value),
        }];
        if (output.value?.assets && output.value.assets.size > 0) {
          output.value.assets.forEach((qty: bigint, assetId: string) => {
            amount.push({ unit: assetId, quantity: Number(qty) });
          });
        }
        if (amount.length > 1) {
          outputLookup.set(`${txHash}#${index}`, amount);
        }
      });
    }
  }

  return txs.map(tx => {
    // Check if this is already a properly formatted transaction with utxo data
    if (tx.id && tx.utxo) {
      // Rebuild outputs from body if available — the sync backend may only include
      // lovelace in utxo.outputs[].amount, missing native tokens
      if (tx.body?.outputs) {
        tx.utxo.outputs = tx.body.outputs.map((output: any, index: number) => {
          const amount: any[] = [{
            unit: 'lovelace',
            quantity: Number(output.value?.coins ?? output.value),
          }];
          if (output.value?.assets && output.value.assets.size > 0) {
            output.value.assets.forEach((qty: bigint, assetId: string) => {
              amount.push({ unit: assetId, quantity: Number(qty) });
            });
          }
          const existing = tx.utxo?.outputs?.[index] || {};
          return {
            ...existing,
            output_index: index,
            address: output.address || existing.address,
            amount,
          };
        });
      }
      return tx;
    }

    // If transaction has id and Cardano JS SDK structure but no utxo, create utxo structure
    if (tx.id && tx.body && !tx.utxo) {
      return {
        ...tx,
        utxo: createUtxoStructure(tx, utxos)
      };
    }

    // Check if this is a transaction from sync with deserialized body
    if (tx.body && tx.cbor) {
      const txId = tx.tx_hash || tx.id;
      // Rebuild UTxO structure from body to ensure native tokens are included in outputs
      // The sync backend may only send lovelace in utxo.outputs[].amount
      const utxo = tx.utxo || { inputs: [], outputs: [] };
      if (tx.body.outputs) {
        utxo.outputs = tx.body.outputs.map((output: any, index: number) => {
          const amount: any[] = [{
            unit: 'lovelace',
            quantity: Number(output.value?.coins ?? output.value),
          }];
          if (output.value?.assets && output.value.assets.size > 0) {
            output.value.assets.forEach((qty: bigint, assetId: string) => {
              amount.push({ unit: assetId, quantity: Number(qty) });
            });
          }
          // Preserve existing output fields (address, data_hash, etc.) if available
          const existing = tx.utxo?.outputs?.[index] || {};
          return {
            ...existing,
            output_index: index,
            address: output.address || existing.address,
            amount,
          };
        });
      }
      return {
        ...tx,
        id: txId,
        utxo,
      };
    }

    // Check if this is a raw transaction with CBOR that needs full conversion
    if (tx.cbor && !tx.body) {
      // Cardano Tx CBOR is a top-level array (major type 4). Apex/non-Cardano
      // chains may send a bare TxBody (map, major type 5). Skip those silently —
      // they will be stored as-is and the UI guards via isCardanoTx.
      const firstByte = typeof tx.cbor === 'string' ? parseInt(tx.cbor.slice(0, 2), 16) : 0;
      const majorType = firstByte >> 5;
      if (majorType !== 4) {
        const txId = tx.tx_hash || tx.hash || 'unknown_' + Date.now();
        return { ...tx, id: txId };
      }
      try {
        // Use the already imported Serialization from the top of the file
        // Deserialize the transaction
        const txDeserialized = Serialization.TxCBOR.deserialize(Serialization.TxCBOR(tx.cbor));
        const txId = tx.tx_hash || Serialization.Transaction.fromCore(txDeserialized).getId();

        // Rebuild UTxO structure from deserialized body to include native tokens
        // in both inputs and outputs. For outputs we use the CBOR body directly.
        // For inputs, we enrich the backend-provided inputs with native tokens
        // by looking up each input reference against ALL outputs in this batch.
        const utxo = tx.utxo || { inputs: [], outputs: [] };

        // Rebuild outputs from CBOR body
        if (txDeserialized.body?.outputs) {
          utxo.outputs = txDeserialized.body.outputs.map((output: any, index: number) => {
            const amount: any[] = [{
              unit: 'lovelace',
              quantity: Number(output.value?.coins ?? output.value),
            }];
            if (output.value?.assets && output.value.assets.size > 0) {
              output.value.assets.forEach((qty: bigint, assetId: string) => {
                amount.push({ unit: assetId, quantity: Number(qty) });
              });
            }
            const existing = tx.utxo?.outputs?.[index] || {};
            return {
              ...existing,
              output_index: index,
              address: output.address || existing.address,
              amount,
            };
          });
        }

        // Enrich inputs with native tokens from the output lookup map
        if (utxo.inputs && outputLookup.size > 0) {
          utxo.inputs = utxo.inputs.map((input: any) => {
            const key = `${input.tx_hash}#${input.output_index}`;
            const enrichedAmount = outputLookup.get(key);
            if (enrichedAmount && input.amount?.length <= 1) {
              return { ...input, amount: enrichedAmount };
            }
            return input;
          });
        }

        // Return the transaction in the expected database format
        return {
          id: txId,
          tx_hash: txId,
          block_hash: tx.block_hash || '',
          block_height: tx.block_height || 0,
          absolute_slot: tx.absolute_slot || 0,
          tx_timestamp: tx.tx_timestamp || Math.floor(Date.now() / 1000),
          tx_size: tx.tx_size || (tx.cbor ? tx.cbor.length / 2 : 0),
          epoch_no: tx.epoch_no || 0,
          cbor: tx.cbor,
          body: txDeserialized.body,
          witness: txDeserialized.witness,
          auxiliaryData: txDeserialized.auxiliaryData,
          isValid: txDeserialized.isValid !== false,
          pending: false,
          utxo
        };
      } catch (e) {
        const txHash = tx.tx_hash || tx.hash || 'unknown';
        const cborPreview = typeof tx.cbor === 'string' ? tx.cbor.slice(0, 64) : '<non-string>';
        console.warn(`Skipping tx ${txHash}: CBOR deserialize failed (${(e as Error).message}). CBOR head: ${cborPreview}`);
        // Fallback: keep tx as-is so caller can still index it; UI helpers guard via isCardanoTx
        const fallbackId = tx.tx_hash || tx.hash || 'fallback_' + Date.now();
        return { ...tx, id: fallbackId };
      }
    }

    // Legacy format - just ensure it has an id
    const txId = tx.tx_hash || tx.hash || 'unknown_' + Date.now();
    return { ...tx, id: txId };
  });
}

/**
 * GroupedAddress interface for CIP-8 signing
 * Replaces import from @cardano-sdk/key-management to avoid blocking imports
 */
export interface GroupedAddress {
  type: number; // ChainDerivations role (0 = External, 1 = Internal, 2 = Stake)
  index: number;
  networkId: Cardano.NetworkId;
  accountIndex: number;
  address: Cardano.PaymentAddress;
  rewardAccount: Cardano.RewardAccount;
}

/**
 * KeyAgent interface for CIP-8 signing
 */
export interface KeyAgent {
  derivePublicKey: (derivationPath: { role: number; index: number }) => Promise<string>;
  signBlob: (derivationPath: { role: number; index: number }, blob: string) => Promise<{
    publicKey: string;
    signature: string;
  }>;
}

/**
 * Custom CIP-8 data signing implementation
 * Implements CIP-30 signData specification without using @cardano-sdk/key-management
 * This avoids the problematic cip8 import that blocks Chrome event listeners
 *
 * Returns proper COSE_Sign1 + COSE_Key structures as required by CIP-30:
 *   signature: cbor<COSE_Sign1>
 *   key:       cbor<COSE_Key>
 *
 * @param keyAgent - Object with derivePublicKey and signBlob methods
 * @param knownAddresses - List of known addresses for the wallet
 * @param signWith - Address to sign with (payment or reward address)
 * @param payload - Hex payload to sign
 * @returns DataSignature with COSE-encoded signature and key
 */
export async function signDataCip8(
  keyAgent: KeyAgent,
  knownAddresses: GroupedAddress[],
  signWith: Cardano.PaymentAddress | Cardano.RewardAccount,
  payload: string
): Promise<{ signature: string; key: string }> {
  // Find the address in knownAddresses that matches signWith
  let matchingAddress = knownAddresses.find(addr => addr.address === signWith);

  // If not found in payment/change addresses, check if it's a stake address
  if (!matchingAddress) {
    // Check if signWith is a reward account (stake address)
    const signWithStr = signWith.toString();
    const isRewardAccount = signWithStr.startsWith('stake') ||
                           knownAddresses.some(addr => addr.rewardAccount === signWith);

    if (isRewardAccount) {
      // Use stake key (role 2, index 0)
      const firstAddress = knownAddresses[0];
      if (!firstAddress) {
        throw new Error(DataSignError.AddressNotPK.info);
      }

      matchingAddress = {
        type: ChainDerivations.CHIMERIC_ACCOUNT, // Stake key role
        index: 0,
        networkId: firstAddress.networkId,
        accountIndex: firstAddress.accountIndex,
        address: firstAddress.address,
        rewardAccount: signWith as Cardano.RewardAccount
      };
    }
  }

  if (!matchingAddress) {
    throw new Error(`${DataSignError.AddressNotPK.info}: ${signWith}`);
  }

  // Get the derivation path for this address
  const derivationPath = {
    role: matchingAddress.type,
    index: matchingAddress.index
  };

  // Convert address to raw bytes for COSE headers
  const addressBytes = Cardano.Address.fromBech32(signWith).toBytes();

  // Dynamic import to avoid WASM loading issues at module init time
  const { createBuilderWithSigStructure, createCoseKeyHex, safeFreeCSLObject } =
    await import('@/shared/utils/converter');

  // Build COSE_Sign1: create builder and extract Sig_structure for signing
  const { builder, sigStrucBytes } = createBuilderWithSigStructure(addressBytes, payload);

  let coseSign1: any = null;
  try {
    // Sign the Sig_structure (not the raw payload) — this is what CIP-8 requires
    const signResult = await keyAgent.signBlob(derivationPath, sigStrucBytes);

    // Finalize COSE_Sign1 with the Ed25519 signature
    const signatureRaw = Buffer.from(signResult.signature, 'hex');
    coseSign1 = builder.build(signatureRaw);
    const signatureHex = Buffer.from(coseSign1.to_bytes()).toString('hex');

    // Build COSE_Key
    const keyHex = createCoseKeyHex(addressBytes, signResult.publicKey);

    // Return in CIP-30 DataSignature format (COSE-encoded)
    return {
      signature: signatureHex,
      key: keyHex
    };
  } finally {
    safeFreeCSLObject(builder);
    if (coseSign1) safeFreeCSLObject(coseSign1);
  }
}
