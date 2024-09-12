import { APIError, DataSignError, NETWORK_ID, POPUP_WINDOW, STORAGE } from './config';
import {
  Address,
  BaseAddress,
  Bip32PublicKey,
  ByronAddress,
  Credential,
  EnterpriseAddress,
  PointerAddress,
  RewardAddress,
  Transaction,
  TransactionUnspentOutput,
  Value,
} from '@emurgo/cardano-serialization-lib-browser';
import networks from '@/shared/utils/networks';
import { ChainDerivations, Paginate, STAKING_KEY_INDEX } from '@/models/types';
import { toUTxO, toValue } from '@/shared/utils/converter';

interface WhitelistedEntry {
  domain: string;
  id: number;
}

interface Network {
  id: string;
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

export const getUtxos = async (amount = undefined, paginate = undefined): Promise<TransactionUnspentOutput[] | null> => {
  let utxos = await getStorage(STORAGE.utxos)
  const collateral = await getStorage(STORAGE.collateral)

  // exclude collateral input from overall utxo set
  if (collateral) {
    utxos = utxos.filter((utxo) => !(utxo.tx_hash === collateral.tx_hash && utxo.tx_index === collateral.tx_index));
  }
  let converted: TransactionUnspentOutput[] = utxos.map((utxo) => toUTxO(utxo));
  // filter utxos
  if (amount) {
    let filterValue;
    try {
      filterValue = Value.from_bytes(Buffer.from(amount, 'hex'));
    } catch (e) {
      throw APIError.InvalidRequest;
    }
    converted = converted.filter((unspent) => !unspent.output().amount().compare(filterValue) || unspent.output().amount().compare(filterValue) !== -1);
  }
  if ((amount || paginate) && converted.length <= 0) {
    return null;
  }
  return converted;
};

export const getAddress = async () => {
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
  ).to_address().to_hex();
};

export const getAddressBech32 = async () => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet) {
    return undefined
  }
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
  ).to_address().to_bech32();
};

export const getRewardAddresses = async () => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  const stakeKey = Bip32PublicKey.from_bech32(loggedWallet['publicKey'])
    .derive(ChainDerivations.CHIMERIC_ACCOUNT)
    .derive(STAKING_KEY_INDEX)
    .to_raw_key();
  const networkId = networks.resolveNetworkId(loggedWallet['chain'], loggedWallet['network'])
  return [RewardAddress.new(networkId, Credential.from_keyhash(stakeKey.hash())).to_address().to_hex()]
};

export const getNetwork = async (): Promise<any> => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet)
  return loggedWallet['network'].toLowerCase();
};

export const getUsedAddresses = async (paginate?: Paginate): Promise<any> => {
  const addresses: {} = await getStorage(STORAGE.addresses);
  let res = []
  const addressesArray = Object.keys(addresses)
  if (Array.isArray(addressesArray)) {
    const addressesArrayHex = Object.keys(addresses).map(address => Address.from_bech32(address).to_hex())
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
    console.log(e);
  }
  try {
    const addr: EnterpriseAddress = EnterpriseAddress.from_address(addressObject);
    return addr.payment_cred().to_keyhash().to_bech32('addr_vkh');
  } catch (e) {
    console.log(e);
  }
  try {
    const addr: PointerAddress = PointerAddress.from_address(addressObject);
    return addr.payment_cred().to_keyhash().to_bech32('addr_vkh');
  } catch (e) {
    console.log(e);
  }
  try {
    const addr: RewardAddress = RewardAddress.from_address(addressObject);
    return addr.payment_cred().to_keyhash().to_bech32('stake_vkh');
  } catch (e) {
    console.log(e);
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
