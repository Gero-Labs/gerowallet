import { DataSignError, NETWORK_ID, STORAGE } from './config';
import {
  Address,
  BaseAddress,
  ByronAddress,
  EnterpriseAddress,
  PointerAddress,
  RewardAddress,
} from '@emurgo/cardano-serialization-lib-browser';

export const getStorage = (key) =>
  new Promise<any>((res, rej) =>
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) rej(undefined);
      res(key ? result[key] : result);
    }),
  );

export const getNetwork = async (): Promise<any> => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet)
  return loggedWallet['network'].toLowerCase();
};

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
