import { APIError, DataSignError, NETWORK_ID, POPUP_WINDOW, STORAGE, TxSendError } from './config';
import {
  Address,
  BaseAddress,
  BigNum,
  Bip32PublicKey,
  ByronAddress,
  Credential,
  EnterpriseAddress,
  PointerAddress,
  PublicKey,
  RewardAddress,
  Transaction,
  TransactionUnspentOutput,
  Value,
} from '@emurgo/cardano-serialization-lib-browser';
import networks from '@/shared/utils/networks';
import {
  Blockchain,
  ChainDerivations,
  CollateralParams,
  ERROR,
  Network,
  Paginate,
  STAKING_KEY_INDEX,
} from '@/models/types';
import { toUTxO, toValue } from '@/shared/utils/converter';
import * as cbor from 'cbor';

interface WhitelistedEntry {
  domain: string;
  id: number;
}

export const getStorage = (key) =>
  new Promise<any>((res, rej) =>
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) rej(undefined);
      res(key ? result[key] : result);
    }),
  );
export const setStorage = (item) =>
  new Promise((res, rej) =>
    chrome.storage.local.set(item, () => {
      if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
      res(true);
    }),
  );

export const removeStorage = (item) =>
  new Promise((res, rej) =>
    chrome.storage.local.remove(item, () => {
      if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
      res(true);
    }),
  );

export const getWhitelisted = async (): Promise<WhitelistedEntry[]> => {
  const result = await getStorage(STORAGE.whitelisted);
  return Array.isArray(result) ? result : [];
};

export const isWhitelisted = async (_origin: string): Promise<boolean> => {
  const whitelisted: WhitelistedEntry[] = await getWhitelisted();
  const bringDomains = await getStorage('bring_relevantDomains')
  if (whitelisted.find(el => _origin.includes(el.domain))) return true;
  return !!(bringDomains && bringDomains.find(el => _origin.includes(el)));
};

export const getCurrency = () => getStorage(STORAGE.currency);

export const setCurrency = (currency) =>
  setStorage({ [STORAGE.currency]: currency });

export const getBalance = async (): Promise<Value> => {
  const utxos = await getStorage(STORAGE.utxos)
  console.log(utxos)
  const amount = []
  let lovelace = 0
  utxos.forEach(utxo => {
    amount.push(...utxo.asset_list)
    lovelace += Number(utxo.value)
  })
  const balance = toValue(amount, lovelace.toString());
  console.log(balance.to_json())
  return balance;
};

export const getUtxos = async (
  amount: string = undefined,
  paginate: Paginate = undefined
): Promise<TransactionUnspentOutput[] | null> => {
  let utxos = await getStorage(STORAGE.utxos);
  const collateral = await getStorage(STORAGE.collateral);

  // Exclude collateral input from the overall UTXO set
  if (collateral) {
    utxos = utxos.filter(
      (utxo) =>
        !(utxo.tx_hash === collateral.tx_hash && utxo.tx_index === collateral.tx_index)
    );
  }

  // Convert raw UTXOs to the appropriate format
  const converted: TransactionUnspentOutput[] = utxos.map((utxo) => toUTxO(utxo));

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
  let targetValue;
  try {
    targetValue = Value.from_hex(amount);
  } catch (e) {
    throw APIError.InvalidRequest;
  }

  // Determine if the target is pure ADA (i.e. no multiassets)
  const targetMultiasset = targetValue.multiasset();
  const isPureTarget = !targetMultiasset || targetMultiasset.len() === 0;

  // Separate UTXOs into pure ADA and those with multiassets
  const pureUtxos: TransactionUnspentOutput[] = [];
  const multiUtxos: TransactionUnspentOutput[] = [];
  for (const utxo of converted) {
    const utxoValue = utxo.output().amount();
    const ma = utxoValue.multiasset();
    if (!ma || ma.len() === 0) {
      pureUtxos.push(utxo);
    } else {
      multiUtxos.push(utxo);
    }
  }

  const selectedUtxos: TransactionUnspentOutput[] = [];
  let accumulatedValue: Value = Value.zero();

  if (isPureTarget) {
    // --- Try to accumulate from pure ADA UTXOs first ---
    pureUtxos.sort((a, b) => {
      const aAda = BigInt(a.output().amount().coin().to_str());
      const bAda = BigInt(b.output().amount().coin().to_str());
      return aAda < bAda ? -1 : aAda > bAda ? 1 : 0;
    });

    for (const utxo of pureUtxos) {
      selectedUtxos.push(utxo);
      accumulatedValue = accumulatedValue.checked_add(utxo.output().amount());
      // Break if we've reached or exceeded the target value
      if (accumulatedValue.compare(targetValue) !== -1) {
        break;
      }
    }

    // --- If pure ADA UTXOs were insufficient, add multiasset UTXOs ---
    if (accumulatedValue.compare(targetValue) === -1) {
      multiUtxos.sort((a, b) => {
        const aAda = BigInt(a.output().amount().coin().to_str());
        const bAda = BigInt(b.output().amount().coin().to_str());
        return aAda < bAda ? -1 : aAda > bAda ? 1 : 0;
      });
      for (const utxo of multiUtxos) {
        selectedUtxos.push(utxo);
        accumulatedValue = accumulatedValue.checked_add(utxo.output().amount());
        if (accumulatedValue.compare(targetValue) !== -1) {
          break;
        }
      }
    }
  } else {
    // For targets that include multiassets, accumulate from all UTXOs
    const sortedUtxos = [...converted].sort((a, b) => {
      const aAda = BigInt(a.output().amount().coin().to_str());
      const bAda = BigInt(b.output().amount().coin().to_str());
      return aAda < bAda ? -1 : aAda > bAda ? 1 : 0;
    });
    for (const utxo of sortedUtxos) {
      selectedUtxos.push(utxo);
      accumulatedValue = accumulatedValue.checked_add(utxo.output().amount());
      if (accumulatedValue.compare(targetValue) !== -1) {
        break;
      }
    }
  }

  // If we couldn't accumulate enough value, return null
  if (accumulatedValue.compare(targetValue) === -1) {
    return null;
  }

  // Apply pagination if provided
  if (paginate) {
    const start = paginate.page * paginate.limit;
    const end = start + paginate.limit;
    return selectedUtxos.slice(start, end);
  }

  return selectedUtxos;
};

export const getPubKey = async (): Promise<Bip32PublicKey> => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  return Bip32PublicKey.from_bech32(loggedWallet['publicKey'])
}

export const getAddress = async (): Promise<Address> => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  const pubKey = Bip32PublicKey.from_bech32(loggedWallet['publicKey'])
    .derive(ChainDerivations.EXTERNAL)
    .derive(0)
    .to_raw_key();
  const stakeKey = Bip32PublicKey.from_bech32(loggedWallet['publicKey'])
    .derive(ChainDerivations.CHIMERIC_ACCOUNT)
    .derive(STAKING_KEY_INDEX)
    .to_raw_key();
  return BaseAddress.new(
    networks.resolveNetworkId(loggedWallet['chain'], loggedWallet['network']),
    Credential.from_keyhash(pubKey.hash()),
    Credential.from_keyhash(stakeKey.hash()),
  ).to_address();
};

export const getStakeKey = async (): Promise<PublicKey> => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  return Bip32PublicKey.from_bech32(loggedWallet['publicKey'])
    .derive(ChainDerivations.CHIMERIC_ACCOUNT)
    .derive(STAKING_KEY_INDEX)
    .to_raw_key();
}

export const getRewardAddresses = async () => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  const stakeKey = await getStakeKey();
  const networkId = networks.resolveNetworkId(loggedWallet['chain'], loggedWallet['network'])
  return [RewardAddress.new(networkId, Credential.from_keyhash(stakeKey.hash())).to_address().to_hex()]
};

export const getDRepKey = async (): Promise<PublicKey> => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  return Bip32PublicKey.from_bech32(loggedWallet['publicKey'])
    .derive(ChainDerivations.DREP)
    .derive(STAKING_KEY_INDEX)
    .to_raw_key()
};

export const getCollateral = async (params: CollateralParams): Promise<TransactionUnspentOutput[]> => {
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
  let targetValue: BigNum;
  try {
    targetValue = BigNum.from_str(decodedAmount);
  } catch (e) {
    const error = APIError.InvalidRequest;
    error.info = 'Invalid amount parameter conversion.';
    throw error;
  }

  // Enforce the maximum collateral limit (5 ADA = 5,000,000 lovelaces).
  const maxCollateral = BigNum.from_str("5000000");
  if (targetValue.compare(maxCollateral) === 1) {
    const error = APIError.InvalidRequest;
    error.info = 'The requested collateral exceeds the allowed maximum of 5 ADA.';
    throw error;
  }

  // Retrieve UTXOs from storage.
  const storedUtxos = await getStorage(STORAGE.utxos);
  if (!storedUtxos || !Array.isArray(storedUtxos)) {
    const error = APIError.InvalidRequest;
    error.info = 'No UTXOs available in wallet.';
    throw error;
  }

  // Filter for pure ADA UTXOs (asset_list exists and is empty).
  const pureUtxos = storedUtxos
    .filter(utxo => Array.isArray(utxo.asset_list) && utxo.asset_list.length === 0)
    .map(utxo => toUTxO(utxo));

  if (pureUtxos.length === 0) {
    const error = APIError.InvalidRequest;
    error.info = 'No pure ADA UTXOs available in wallet.';
    throw error;
  }
  console.log('pureUtxos', pureUtxos)
  // Sort the pure ADA UTXOs in ascending order by coin value.
  pureUtxos.sort((a, b) =>
    a.output().amount().coin().compare(b.output().amount().coin())
  );

  const selectedUtxos: TransactionUnspentOutput[] = [];
  let accumulatedValue = BigNum.zero();

  // Greedily accumulate UTXOs until the target is met, optimizing by removing any excess smallest UTXO.
  for (const utxo of pureUtxos) {
    selectedUtxos.push(utxo);
    accumulatedValue = accumulatedValue.checked_add(utxo.output().amount().coin());

    // Try to remove the smallest UTXO if the remaining sum still meets the target.
    while (selectedUtxos.length > 0) {
      const smallestUtxo = selectedUtxos[0];
      const potentialSum = accumulatedValue.checked_sub(smallestUtxo.output().amount().coin());
      if (potentialSum.compare(targetValue) !== -1) {
        // Removing the smallest UTXO still meets the required amount.
        selectedUtxos.shift();
        accumulatedValue = potentialSum;
      } else {
        break;
      }
    }

    if (accumulatedValue.compare(targetValue) !== -1) {
      break;
    }
  }

  // If the accumulated collateral is less than the required amount, throw an error.
  if (accumulatedValue.compare(targetValue) === -1) {
    const error = APIError.InvalidRequest;
    error.info = 'Not enough ADA in the wallet to meet the collateral requirements.';
    throw error;
  }

  return selectedUtxos;
};

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
      console.log(input)
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
};

export const getNetwork = async (): Promise<any> => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet)
  return loggedWallet['network'].toLowerCase();
};

export const getUsedAddresses = async (paginate?: Paginate): Promise<any> => {
  const addresses: {} = await getStorage(STORAGE.addresses);
  let res = []
  const addressesArray: any[] = Object.values(addresses)
  if (addressesArray && Array.isArray(addressesArray)) {
    addressesArray.sort((a,b) => (a['path'] > b['path']) ? 1 : ((b['path'] > a['path']) ? -1 : 0))
    const addressesArrayHex: string[] = addressesArray.map(el => Address.from_bech32(el['address']).to_hex())
    res = paginateArray(addressesArrayHex, paginate);
  }
  return res
};

function paginateArray(array: any[], paginate?: Paginate): any[] {
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
  const windows = await chrome.windows.getAll({ populate: true });
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

const isValidAddressBytes = async (address: Buffer) => {
  const network = await getNetwork();
  try {
    const addr: Address = Address.from_bytes(address);
    return (addr.network_id() === 1 && network === NETWORK_ID.mainnet) ||
      (addr.network_id() === 0 &&
        (network === NETWORK_ID.testnet ||
          network === NETWORK_ID.preview ||
          network === NETWORK_ID.preprod));

  } catch (e) {
    console.log(e);
  }
  try {
    const addr: ByronAddress = ByronAddress.from_bytes(address);
    return (addr.network_id() === 1 && network === NETWORK_ID.mainnet) ||
      (addr.network_id() === 0 &&
        (network === NETWORK_ID.testnet ||
          network === NETWORK_ID.preview ||
          network === NETWORK_ID.preprod));

  } catch (e) {
    console.log(e);
  }
  return false;
};

export const extractKeyHash = async (address: string) => {
  const uint8Array: Buffer = Buffer.from(address, 'hex');
  let addressObject: Address
  if (!(await isValidAddressBytes(uint8Array))) {
    addressObject = Address.from_bech32(address)
    const array = Buffer.from(addressObject.to_hex(), 'hex')
    if (!(await isValidAddressBytes(array))) {
      throw DataSignError.InvalidFormat;
    }
  } else {
    addressObject = Address.from_bytes(uint8Array);
  }
  try {
    const addr: BaseAddress = BaseAddress.from_address(addressObject);
    return addr.payment_cred().to_keyhash().to_bech32('addr_vkh');
  } catch (e) {
    // console.log(e);
  }
  try {
    const addr: EnterpriseAddress = EnterpriseAddress.from_address(addressObject);
    return addr.payment_cred().to_keyhash().to_bech32('addr_vkh');
  } catch (e) {
    // console.log(e);
  }
  try {
    const addr: PointerAddress = PointerAddress.from_address(addressObject);
    return addr.payment_cred().to_keyhash().to_bech32('addr_vkh');
  } catch (e) {
    // console.log(e);
  }
  try {
    const addr: RewardAddress = RewardAddress.from_address(addressObject);
    return addr.payment_cred().to_keyhash().to_bech32('stake_vkh');
  } catch (e) {
    // console.log(e);
  }
  throw DataSignError.AddressNotPK;
};

export const verifyPayload = (payload) => {
  if (Buffer.from(payload, 'hex').length <= 0)
    throw DataSignError.InvalidFormat;
};

export const verifyTx = async (tx) => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  try {
    const parseTx = Transaction.from_bytes(Buffer.from(tx, 'hex'));
    let networkId = parseTx.body().network_id() ? parseTx.body().network_id().kind() : null;
    if (!networkId && networkId != 0) {
      networkId = parseTx.body().outputs().get(0).address().network_id();
    }
    if (networkId != networks.resolveNetworkId(loggedWallet['chain'], loggedWallet['network'])) {
      throw Error('Wrong network');
    }
  } catch (e) {
    throw APIError.InvalidRequest;
  }
};

export const urlScan = async url => {
  const baseUrl = process.env['VUE_APP_BACKEND_URL'];
  const result = await fetch(`https://api.gerowallet.io/api/url/scan?url=${url}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (result) {
    console.log('result', result);
  }
  return result;
};

export const submitTx = async (tx) => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  const chain = Object.keys(Blockchain).find(key => Blockchain[key] === loggedWallet?.chain);
  const network = Object.keys(Network).find(key => Network[key] === loggedWallet?.network);
  const response  = await fetch(`https://api.gerowallet.io/api/transactions/submit-tx?chain=${chain}&network=${network}&provider=KOIOS`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: tx
  })

  if (!response.ok) { // Check if the response is not in the range of 200-299
    switch (response.status) { // Access the status code directly from response
      case 400:
        throw { ...TxSendError.Failure, message: response.statusText };
      case 500:
        throw APIError.InternalError;
      case 429:
        throw TxSendError.Refused;
      case 425:
        throw ERROR.fullMempool;
      default:
        throw APIError.InvalidRequest;
    }
  }
  return await response.text();
}

export const getPubDRepKey = async (): Promise<string> => {
  const drepPubKey: PublicKey = await getDRepKey()
  return drepPubKey.to_hex()
}

export const getRegisteredPubStakeKeys = async () => {
  const account = await getStorage(STORAGE.account);
  if (account?.active) {
    return [(await getStakeKey()).to_hex()];
  } else {
    return [];
  }
}

export const getUnregisteredPubStakeKeys = async () => {
  const account = await getStorage(STORAGE.account);
  if (account?.active) {
    return [];
  } else {
    return [(await getStakeKey()).to_hex()];
  }
}
