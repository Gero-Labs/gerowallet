import { Blockchain, ChainDerivations, CollateralParams, Network, Paginate } from '@/models/types';
import { APIError, POPUP_WINDOW } from './config';
import * as cbor from 'cbor';
import networks from '../shared/utils/networks';
import { Bip32PublicKey, Ed25519PublicKey, Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { Cardano, Serialization, Asset } from '@cardano-sdk/core';
import { HexBlob, BigIntMath } from '@cardano-sdk/util';
import { bech32 } from 'bech32';
import { toUTxO, toValue } from '@/shared/utils/converter2';

export function getAddress(xpub: string, chain: string, network: string): Cardano.Address {
  const networkId = networks.resolveNetworkId(chain, network);
  const pubKey = getPublicKey(xpub);
  const paymentKeyHash = pubKey
    .derive([ChainDerivations.EXTERNAL, 0])
    .toRawKey()
    .hash();
  const stakeKeyHash = pubKey
    .derive([ChainDerivations.CHIMERIC_ACCOUNT, 0])
    .toRawKey()
    .hash();
  const baseAddress: Cardano.BaseAddress = Cardano.BaseAddress.fromCredentials(
    networkId,
    {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16.fromEd25519KeyHashHex(paymentKeyHash.hex()),
    },
    {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16.fromEd25519KeyHashHex(stakeKeyHash.hex()),
    });
  return baseAddress.toAddress();
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

export function getBalance(utxos: any[]): Serialization.Value {
  const assets: any[] = []
  let lovelace = 0
  utxos.forEach(utxo => {
    assets.push(...utxo.asset_list)
    lovelace += Number(utxo.value)
  })
  return toValue(assets, lovelace.toString());
}

export function coalesceValueQuantities(quantities: Serialization.Value[]): Serialization.Value {
  return new Serialization.Value(BigIntMath.sum(quantities.map(({ coin }) => coin())), Asset.util.coalesceTokenMaps(quantities.map(({ multiasset }) => multiasset())));
}

export function getRewardAddresses(xpub: string, chain: string, network: string) {
  const stakeKey = getStakeKey(xpub, 0);
  const networkId = networks.resolveNetworkId(chain, network)
  return [Cardano.RewardAddress.fromCredentials(
    networkId,
    {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16.fromEd25519KeyHashHex(stakeKey.hash().hex())
    }).toAddress().toBytes()]
}

export function getCollateral(params: CollateralParams, storedUtxos: any[]): Serialization.TransactionUnspentOutput[] {
  // Default to 5000000 lovelaces (5 ADA) if no amount parameter is provided.
  const inputAmount = (params && params.amount != null) ? params.amount : "5000000";

  // Decode the amount parameter.
  let decodedAmount: string;
  try {
    decodedAmount = decodeCollateralAmount(inputAmount);
  } catch (e) {
    const error = APIError.InvalidRequest;
    error.info = 'Invalid amount parameter.';
    throw error;
  }
  // Convert the decoded amount to a BigNum.
  let targetValue;
  try {
    targetValue = BigInt(decodedAmount);
  } catch (e) {
    const error = APIError.InvalidRequest;
    error.info = 'Invalid amount parameter conversion.';
    throw error;
  }

  // Enforce the maximum collateral limit (5 ADA = 5,000,000 lovelaces).
  const maxCollateral = BigInt("5000000");
  if (targetValue > maxCollateral) {
    const error = APIError.InvalidRequest;
    error.info = 'The requested collateral exceeds the allowed maximum of 5 ADA.';
    throw error;
  }

  // Retrieve UTXOs from storage.
  if (!storedUtxos || !Array.isArray(storedUtxos)) {
    const error = APIError.InvalidRequest;
    error.info = 'No UTXOs available in wallet.';
    throw error;
  }

  // Filter for pure ADA UTXOs (asset_list exists and is empty).
  const pureUtxos: Serialization.TransactionUnspentOutput[] = storedUtxos
    .filter(utxo => Array.isArray(utxo.asset_list) && utxo.asset_list.length === 0)
    .map((utxo: any) => toUTxO(utxo));

  if (pureUtxos.length === 0) {
    const error = APIError.InvalidRequest;
    error.info = 'No pure ADA UTXOs available in wallet.';
    throw error;
  }
  // Sort the pure ADA UTXOs in ascending order by coin value.
  pureUtxos.sort((a: Serialization.TransactionUnspentOutput, b: Serialization.TransactionUnspentOutput) => {
    const coinA = a.output().amount().coin();
    const coinB = b.output().amount().coin();
    return coinA < coinB ? -1 : coinA > coinB ? 1 : 0;
  });

  const selectedUtxos: Serialization.TransactionUnspentOutput[] = [];
  let accumulatedValue: bigint = BigInt(0);

  // Greedily accumulate UTXOs until the target is met, optimizing by removing any excess smallest UTXO.
  for (const utxo of pureUtxos) {
    selectedUtxos.push(utxo);
    accumulatedValue = accumulatedValue + utxo.output().amount().coin();

    // Try to remove the smallest UTXO if the remaining sum still meets the target.
    while (selectedUtxos.length > 0) {
      const smallestUtxo = selectedUtxos[0];
      const potentialSum = accumulatedValue - smallestUtxo.output().amount().coin();
      if (potentialSum >= targetValue) {
        // Removing the smallest UTXO still meets the required amount.
        selectedUtxos.shift();
        accumulatedValue = potentialSum;
      } else {
        break;
      }
    }

    if (accumulatedValue >= targetValue) {
      break;
    }
  }

  // If the accumulated collateral is less than the required amount, throw an error.
  if (accumulatedValue < targetValue) {
    const error = APIError.InvalidRequest;
    error.info = 'Not enough ADA in the wallet to meet the collateral requirements.';
    throw error;
  }

  return selectedUtxos;
}

/**
 * Decodes the collateral amount parameter.
 * - If the input is a number, returns its string representation.
 * - If the input is a string containing only digits, returns it directly.
 * - Otherwise, if the string is a valid hex string (i.e. contains [0-9a-fA-F]) assume it is CBOR encoded and decode it.
 * @throws Error if the input is not in one of the expected formats.
 */
const decodeCollateralAmount = (input: string | number): string => {
  if (typeof input === "number") {
    return String(input);
  }
  if (/^[0-9]+$/.test(input)) {
    // A decimal string.
    return input;
  }
  if (/^[0-9a-fA-F]+$/.test(input)) {
    try {
      const buffer = Buffer.from(input, "hex");
      const decoded = cbor.decodeFirstSync(buffer);
      if (typeof decoded === "number" || typeof decoded === "bigint") {
        return String(decoded);
      }
      throw new Error("Decoded value is not a number");
    } catch (e) {
      throw new Error("Invalid CBOR encoded amount");
    }
  }
  throw new Error("Invalid amount format");
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
  // TODO fix base URL from env
  return await fetch(`https://api.gerowallet.io/api/transactions/submit-tx?chain=${chainEnum}&network=${networkEnum}&provider=KOIOS`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: tx
  })
}

export const urlScan = async url => {
  // TODO fix base URL from env
  const result = await fetch(`https://api.gerowallet.io/api/url/scan?url=${url}`, {
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
