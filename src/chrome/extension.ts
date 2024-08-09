import { APIError, DataSignError, NETWORK_ID, POPUP_WINDOW, STORAGE } from './config';
// import { mnemonicToEntropy } from 'bip39';
import {
  Address,
  BaseAddress,
  Bip32PublicKey,
  ByronAddress,
  EnterpriseAddress,
  PointerAddress,
  RewardAddress,
  StakeCredential,
  Transaction,
  TransactionUnspentOutput,
  Value,
} from '@emurgo/cardano-serialization-lib-browser';
import networks from '@/shared/utils/networks';
import { ChainDerivations, Paginate, STAKING_KEY_INDEX } from '@/models/types';
import { toUTxO, toValue } from '@/shared/utils/converter';
// import { ChainDerivations, STAKING_KEY_INDEX } from '@/models/types';
// import networks from '@/shared/utils/networks';
// import { createAvatar } from '@dicebear/avatars';
// import * as style from '@dicebear/avatars-bottts-sprites';
// import { initTx } from './wallet';
// import {
//   blockfrostRequest,
//   networkNameToId,
//   utxoFromJson,
//   assetsToValue,
//   txToLedger,
//   txToTrezor,
//   linkToSrc,
//   convertMetadataPropToString,
//   fromAssetUnit,
//   toAssetUnit,
//   Data,
// } from '../util';
// import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
// import Ada, { HARDENED } from '@cardano-foundation/ledgerjs-hw-app-cardano';
// import TrezorConnect from '@trezor/connect-web';
// import AssetFingerprint from '@emurgo/cip14-js';
// import { isAddress } from 'web3-validator';
// import { milkomedaNetworks } from '@dcspark/milkomeda-constants';

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

// export const encryptWithPassword = async (password, rootKeyBytes) => {
//   await Loader.load();
//   const rootKeyHex = Buffer.from(rootKeyBytes, 'hex').toString('hex');
//   const passwordHex = Buffer.from(password).toString('hex');
//   const salt = cryptoRandomString({ length: 2 * 32 });
//   const nonce = cryptoRandomString({ length: 2 * 12 });
//   return Loader.Cardano.encrypt_with_password(
//     passwordHex,
//     salt,
//     nonce,
//     rootKeyHex
//   );
// };

// export const decryptWithPassword = async (password, encryptedKeyHex) => {
//   await Loader.load();
//   const passwordHex = Buffer.from(password).toString('hex');
//   let decryptedHex;
//   try {
//     decryptedHex = Loader.Cardano.decrypt_with_password(
//       passwordHex,
//       encryptedKeyHex
//     );
//   } catch (err) {
//     throw new Error(ERROR.wrongPassword);
//   }
//   return decryptedHex;
// };

export const getWhitelisted = async (): Promise<WhitelistedEntry[]> => {
  const result = await getStorage(STORAGE.whitelisted);
  return Array.isArray(result) ? result : [];
};

export const isWhitelisted = async (_origin: string): Promise<boolean> => {
  const whitelisted: WhitelistedEntry[] = await getWhitelisted();
  let access = false;
  if (whitelisted.find(el => _origin.includes(el.domain))) access = true;
  return access;
};

export const getCurrency = () => getStorage(STORAGE.currency);

export const setCurrency = (currency) =>
  setStorage({ [STORAGE.currency]: currency });

// export const getDelegation = async () => {
//   const currentAccount = await getCurrentAccount();
//   const stake = await blockfrostRequest(
//     `/accounts/${currentAccount.rewardAddr}`
//   );
//   if (!stake || stake.error || !stake.pool_id) return {};
//   const delegation = await blockfrostRequest(
//     `/pools/${stake.pool_id}/metadata`
//   );
//   if (!delegation || delegation.error) return {};
//   return {
//     active: stake.active,
//     rewards: stake.withdrawable_amount,
//     homepage: delegation.homepage,
//     poolId: stake.pool_id,
//     ticker: delegation.ticker,
//     description: delegation.description,
//     name: delegation.name,
//   };
// };

// export const getPoolMetadata = async (poolId) => {
//   if (!poolId) {
//     throw new Error('poolId argument not provided');
//   }
//
//   const delegation = await blockfrostRequest(`/pools/${poolId}/metadata`);
//
//   if (delegation.error) {
//     throw new Error(delegation.message);
//   }
//
//   return {
//     ticker: delegation.ticker,
//     name: delegation.name,
//     id: poolId,
//     hex: delegation.hex,
//   };
// };

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

// export const getBalanceExtended = async () => {
//   const currentAccount = await getCurrentAccount();
//   const result = await blockfrostRequest(
//     `/addresses/${currentAccount.paymentKeyHashBech32}/extended`
//   );
//   if (result.error) {
//     if (result.status_code === 400) throw APIError.InvalidRequest;
//     else if (result.status_code === 500) throw APIError.InternalError;
//     else return [];
//   }
//   return result.amount;
// };

// export const getFullBalance = async () => {
//   const currentAccount = await getCurrentAccount();
//   const result = await blockfrostRequest(
//     `/accounts/${currentAccount.rewardAddr}`
//   );
//   if (result.error) return '0';
//   return (
//     BigInt(result.controlled_amount) - BigInt(result.withdrawable_amount)
//   ).toString();
// };

// export const getTransactions = async (paginate = 1, count = 10) => {
//   const currentAccount = await getCurrentAccount();
//   const result = await blockfrostRequest(
//     `/addresses/${currentAccount.paymentKeyHashBech32}/transactions?page=${paginate}&order=desc&count=${count}`
//   );
//   if (!result || result.error) return [];
//   return result.map((tx) => ({
//     txHash: tx.tx_hash,
//     txIndex: tx.tx_index,
//     blockHeight: tx.block_height,
//   }));
// };

// export const getTxInfo = async (txHash) => {
//   const result = await blockfrostRequest(`/txs/${txHash}`);
//   if (!result || result.error) return null;
//   return result;
// };
//
// export const getBlock = async (blockHashOrNumb) => {
//   const result = await blockfrostRequest(`/blocks/${blockHashOrNumb}`);
//   if (!result || result.error) return null;
//   return result;
// };
//
// export const getTxUTxOs = async (txHash) => {
//   const result = await blockfrostRequest(`/txs/${txHash}/utxos`);
//   if (!result || result.error) return null;
//   return result;
// };
//
// export const getTxMetadata = async (txHash) => {
//   const result = await blockfrostRequest(`/txs/${txHash}/metadata`);
//   if (!result || result.error) return null;
//   return result;
// };
//
// export const updateTxInfo = async (txHash) => {
//   const currentAccount = await getCurrentAccount();
//   const network = await getNetwork();
//
//   let detail = await currentAccount[network.id].history.details[txHash];
//
//   if (typeof detail !== 'object' || Object.keys(detail).length < 4) {
//     detail = {};
//     const info = getTxInfo(txHash);
//     const uTxOs = getTxUTxOs(txHash);
//     const metadata = getTxMetadata(txHash);
//
//     detail.info = await info;
//     if (info) detail.block = await getBlock(detail.info.block_height);
//     detail.utxos = await uTxOs;
//     detail.metadata = await metadata;
//   }
//
//   return detail;
// };
//
// export const setTxDetail = async (txObject) => {
//   const currentIndex = await getCurrentAccountIndex();
//   const network = await getNetwork();
//   const accounts = await getStorage(STORAGE.accounts);
//   for (const txHash of Object.keys(txObject)) {
//     const txDetail = txObject[txHash];
//     accounts[currentIndex][network.id].history.details[txHash] = txDetail;
//     await setStorage({
//       [STORAGE.accounts]: {
//         ...accounts,
//       },
//     });
//     delete txObject[txHash];
//   }
//   return true;
// };
//
// export const getSpecificUtxo = async (txHash, txId) => {
//   const result = await blockfrostRequest(`/txs/${txHash}/utxos`);
//   if (!result || result.error) return null;
//   return result.outputs[txId];
// };

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

// const checkCollateral = async (currentAccount, network, checkTx) => {
//   if (checkTx) {
//     const transactions = await getTransactions();
//     if (
//       transactions.length <= 0 ||
//       currentAccount[network.id].history.confirmed.includes(
//         transactions[0].txHash
//       )
//     )
//       return;
//   }
//   let result = [];
//   let page = 1;
//   while (true) {
//     let pageResult = await blockfrostRequest(
//       `/addresses/${currentAccount.paymentKeyHashBech32}/utxos?page=${page}`
//     );
//     if (pageResult.error) {
//       if (result.status_code === 400) throw APIError.InvalidRequest;
//       else if (result.status_code === 500) throw APIError.InternalError;
//       else {
//         pageResult = [];
//       }
//     }
//     result = result.concat(pageResult);
//     if (pageResult.length <= 0) break;
//     page++;
//   }
//
//   // exclude collateral input from overall utxo set
//   if (currentAccount[network.id].collateral) {
//     const initialSize = result.length;
//     result = result.filter(
//       (utxo) =>
//         !(
//           utxo.tx_hash === currentAccount[network.id].collateral.txHash &&
//           utxo.output_index === currentAccount[network.id].collateral.txId
//         )
//     );
//
//     if (initialSize == result.length) {
//       delete currentAccount[network.id].collateral;
//       return true;
//     }
//   }
// };
//
// export const getCollateral = async () => {
//   await Loader.load();
//   const currentIndex = await getCurrentAccountIndex();
//   const accounts = await getStorage(STORAGE.accounts);
//   const currentAccount = accounts[currentIndex];
//   const network = await getNetwork();
//   if (await checkCollateral(currentAccount, network, true)) {
//     await setStorage({ [STORAGE.accounts]: accounts });
//   }
//   const collateral = currentAccount[network.id].collateral;
//   if (collateral) {
//     const collateralUtxo = Loader.Cardano.TransactionUnspentOutput.new(
//       Loader.Cardano.TransactionInput.new(
//         Loader.Cardano.TransactionHash.from_bytes(
//           Buffer.from(collateral.txHash, 'hex')
//         ),
//         Loader.Cardano.BigNum.from_str(collateral.txId.toString())
//       ),
//       Loader.Cardano.TransactionOutput.new(
//         Loader.Cardano.Address.from_bech32(
//           currentAccount[network.id].paymentAddr
//         ),
//         Loader.Cardano.Value.new(
//           Loader.Cardano.BigNum.from_str(collateral.lovelace)
//         )
//       )
//     );
//     return [collateralUtxo];
//   }
//   const utxos = await getUtxos();
//   return utxos.filter(
//     (utxo) =>
//       utxo
//         .output()
//         .amount()
//         .coin()
//         .compare(Loader.Cardano.BigNum.from_str('50000000')) <= 0 &&
//       !utxo.output().amount().multiasset()
//   );
// };
//
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
    StakeCredential.from_keyhash(pubKey.hash()),
    StakeCredential.from_keyhash(stakeKey.hash()),
  ).to_address().to_hex();
};

export const getAddressBech32 = async () => {
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
      StakeCredential.from_keyhash(pubKey.hash()),
      StakeCredential.from_keyhash(stakeKey.hash()),
  ).to_address().to_bech32();
};

export const getRewardAddresses = async () => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  const stakeKey = Bip32PublicKey.from_bech32(loggedWallet['publicKey'])
    .derive(ChainDerivations.CHIMERIC_ACCOUNT)
    .derive(STAKING_KEY_INDEX)
    .to_raw_key();
  const networkId = networks.resolveNetworkId(loggedWallet['chain'], loggedWallet['network'])
  return [RewardAddress.new(networkId, StakeCredential.from_keyhash(stakeKey.hash())).to_address().to_hex()]
};

export const getNetwork = async (): Promise<any> => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  return loggedWallet['network'].toLowerCase();
};

export const getUsedAddresses = async (paginate?: Paginate): Promise<any> => {
  let addresses: string[] = await getStorage(STORAGE.addresses);
  if (Array.isArray(addresses)) {
    addresses = addresses.map(address => Address.from_bech32(address).to_hex())
    return paginateArray(addresses, paginate);
  }
  return []
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

// export const setNetwork = async (network) => {
//   const currentNetwork = await getNetwork();
//   let id;
//   let node;
//   if (network.id === NETWORK_ID.mainnet) {
//     id = NETWORK_ID.mainnet;
//     node = NODE.mainnet;
//   } else if (network.id === NETWORK_ID.testnet) {
//     id = NETWORK_ID.testnet;
//     node = NODE.testnet;
//   } else if (network.id === NETWORK_ID.preview) {
//     id = NETWORK_ID.preview;
//     node = NODE.preview;
//   } else {
//     id = NETWORK_ID.preprod;
//     node = NODE.preprod;
//   }
//   if (network.node) node = network.node;
//   if (currentNetwork && currentNetwork.id !== id)
//     emitNetworkChange(networkNameToId(id));
//   await setStorage({
//     [STORAGE.network]: {
//       id,
//       node,
//       mainnetSubmit: network.mainnetSubmit,
//       testnetSubmit: network.testnetSubmit,
//     },
//   });
//   return true;
// };
//
// const accountToNetworkSpecific = (account, network) => {
//   const assets = account[network.id].assets;
//   const lovelace = account[network.id].lovelace;
//   const history = account[network.id].history;
//   const minAda = account[network.id].minAda;
//   const collateral = account[network.id].collateral;
//   const recentSendToAddresses = account[network.id].recentSendToAddresses;
//   const paymentAddr = account[network.id].paymentAddr;
//   const rewardAddr = account[network.id].rewardAddr;
//
//   return {
//     ...account,
//     paymentAddr,
//     rewardAddr,
//     assets,
//     lovelace,
//     minAda,
//     collateral,
//     history,
//     recentSendToAddresses,
//   };
// };
//
// /** Returns account with network specific settings (e.g. address, reward address, etc.) */
// export const getCurrentAccount = async () => {
//   const currentAccountIndex = await getCurrentAccountIndex();
//   const accounts = await getStorage(STORAGE.accounts);
//   const network = await getNetwork();
//   return accountToNetworkSpecific(accounts[currentAccountIndex], network);
// };
//
// /** Returns accounts with network specific settings (e.g. address, reward address, etc.) */
// export const getAccounts = async () => {
//   const accounts = await getStorage(STORAGE.accounts);
//   const network = await getNetwork();
//   for (const index in accounts) {
//     accounts[index] = await accountToNetworkSpecific(accounts[index], network);
//   }
//   return accounts;
// };
//
// export const setAccountName = async (name) => {
//   const currentAccountIndex = await getCurrentAccountIndex();
//   const accounts = await getStorage(STORAGE.accounts);
//   accounts[currentAccountIndex].name = name;
//   return await setStorage({ [STORAGE.accounts]: accounts });
// };
//
// export const setAccountAvatar = async (avatar) => {
//   const currentAccountIndex = await getCurrentAccountIndex();
//   const accounts = await getStorage(STORAGE.accounts);
//   accounts[currentAccountIndex].avatar = avatar;
//   return await setStorage({ [STORAGE.accounts]: accounts });
// };
//

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

// export const createPopup = async (popup: string, origin?: string): Promise<chrome.tabs.Tab> => {
//   console.log('createPopup')
//   let left = 0;
//   let top = 0;
//   try {
//     const lastFocused: chrome.windows.Window = await new Promise((res, rej) => {
//       chrome.windows.getLastFocused((windowObject) => {
//         if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
//         res(windowObject);
//       });
//     });
//     top = lastFocused.top!;
//     left = lastFocused.left! + Math.round((lastFocused.width! - POPUP_WINDOW.width) / 2);
//   } catch (_) {
//     const { screenX, screenY, outerWidth } = window;
//     top = Math.max(screenY, 0);
//     left = Math.max(screenX + (outerWidth - POPUP_WINDOW.width), 0);
//   }
//
//   const { popupWindow, tab } = await new Promise<{ popupWindow: chrome.windows.Window, tab: chrome.tabs.Tab }>((res, rej) =>
//     chrome.tabs.create(
//       {
//         url: chrome.runtime.getURL(`index.html#/${popup}?website=${origin}`),
//         active: false,
//       },
//       function (tab) {
//         chrome.windows.create(
//           {
//             tabId: tab.id,
//             type: 'popup',
//             focused: true,
//             ...POPUP_WINDOW,
//             left,
//             top,
//           },
//           function (newWindow) {
//             res({ popupWindow: newWindow, tab });
//           }
//         );
//       }
//     )
//   );
//
//   if (popupWindow.left !== left && popupWindow.state !== 'fullscreen') {
//     await new Promise<void>((res, rej) => {
//       chrome.windows.update(popupWindow.id!, { left, top }, () => {
//         res();
//       });
//     });
//   }
//   return tab;
// };

// export const createTab = (tab, query = '') =>
//   new Promise((res, rej) =>
//     chrome.tabs.create(
//       {
//         url: chrome.runtime.getURL(tab + '.html' + query),
//         active: true,
//       },
//       function (tab) {
//         chrome.windows.create(
//           {
//             tabId: tab.id,
//             focused: true,
//           },
//           function () {
//             res(tab);
//           }
//         );
//       }
//     )
//   );
//
// export const getCurrentWebpage = () =>
//   new Promise((res, rej) => {
//     chrome.tabs.query(
//       {
//         active: true,
//         lastFocusedWindow: true,
//         status: 'complete',
//         windowType: 'normal',
//       },
//       function (tabs) {
//         res({
//           url: new URL(tabs[0].url).origin,
//           favicon: tabs[0].favIconUrl,
//           tabId: tabs[0].id,
//         });
//       }
//     );
//   });
//
// const harden = (num) => {
//   return 0x80000000 + num;
// };
//
// export const bytesAddressToBinary = (bytes) =>
//   bytes.reduce((str, byte) => str + byte.toString(2).padStart(8, '0'), '');
//
// export const isValidAddress = async (address) => {
//   await Loader.load();
//   const network = await getNetwork();
//   try {
//     const addr = Loader.Cardano.Address.from_bech32(address);
//     if (
//       (addr.network_id() === 1 && network.id === NETWORK_ID.mainnet) ||
//       (addr.network_id() === 0 &&
//         (network.id === NETWORK_ID.testnet ||
//           network.id === NETWORK_ID.preview ||
//           network.id === NETWORK_ID.preprod))
//     )
//       return addr.to_bytes();
//     return false;
//   } catch (e) {}
//   try {
//     const addr = Loader.Cardano.ByronAddress.from_base58(address);
//     if (
//       (addr.network_id() === 1 && network.id === NETWORK_ID.mainnet) ||
//       (addr.network_id() === 0 &&
//         (network.id === NETWORK_ID.testnet ||
//           network.id === NETWORK_ID.preview ||
//           network.id === NETWORK_ID.preprod))
//     )
//       return addr.to_address().to_bytes();
//     return false;
//   } catch (e) {}
//   return false;
// };
//
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
//
// export const isValidEthAddress = function (address) {
//   return isAddress(address);
// };
//
export const extractKeyHash = async (address: string) => {
  console.log(address);
  const uint8Array: Buffer = Buffer.from(address, 'hex');
  if (!(await isValidAddressBytes(uint8Array)))
    throw DataSignError.InvalidFormat;
  const addressObject: Address = Address.from_bytes(uint8Array);
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
//
// export const extractKeyOrScriptHash = async (address) => {
//   await Loader.load();
//   if (!(await isValidAddressBytes(Buffer.from(address, 'hex'))))
//     throw DataSignError.InvalidFormat;
//   try {
//     const addr = Loader.Cardano.BaseAddress.from_address(
//       Loader.Cardano.Address.from_bytes(Buffer.from(address, 'hex'))
//     );
//
//     const credential = addr.payment_cred();
//     if (credential.kind() === 0)
//       return credential.to_keyhash().to_bech32('addr_vkh');
//     if (credential.kind() === 1)
//       return credential.to_scripthash().to_bech32('script');
//   } catch (e) {}
//   try {
//     const addr = Loader.Cardano.EnterpriseAddress.from_address(
//       Loader.Cardano.Address.from_bytes(Buffer.from(address, 'hex'))
//     );
//     const credential = addr.payment_cred();
//     if (credential.kind() === 0)
//       return credential.to_keyhash().to_bech32('addr_vkh');
//     if (credential.kind() === 1)
//       return credential.to_scripthash().to_bech32('script');
//   } catch (e) {}
//   try {
//     const addr = Loader.Cardano.PointerAddress.from_address(
//       Loader.Cardano.Address.from_bytes(Buffer.from(address, 'hex'))
//     );
//     const credential = addr.payment_cred();
//     if (credential.kind() === 0)
//       return credential.to_keyhash().to_bech32('addr_vkh');
//     if (credential.kind() === 1)
//       return credential.to_scripthash().to_bech32('script');
//   } catch (e) {}
//   try {
//     const addr = Loader.Cardano.RewardAddress.from_address(
//       Loader.Cardano.Address.from_bytes(Buffer.from(address, 'hex'))
//     );
//     const credential = addr.payment_cred();
//     if (credential.kind() === 0)
//       return credential.to_keyhash().to_bech32('stake_vkh');
//     if (credential.kind() === 1)
//       return credential.to_scripthash().to_bech32('script');
//   } catch (e) {}
//   throw new Error('No address type matched.');
// };
//
// export const verifySigStructure = async (sigStructure) => {
//   await Loader.load();
//   try {
//     Loader.Message.SigStructure.from_bytes(Buffer.from(sigStructure, 'hex'));
//   } catch (e) {
//     throw DataSignError.InvalidFormat;
//   }
// };
//
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

//
// /**
//  *
//  * @param {string} tx - cbor hex string
//  * @returns
//  */
//
// export const submitTx = async (tx) => {
//   const network = await getNetwork();
//   if (network[network.id + 'Submit']) {
//     const result = await fetch(network[network.id + 'Submit'], {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/cbor' },
//       body: Buffer.from(tx, 'hex'),
//     });
//     if (result.ok) {
//       return await result.json();
//     }
//     throw APIError.InvalidRequest;
//   }
//   const result = await blockfrostRequest(
//     `/tx/submit`,
//     { 'Content-Type': 'application/cbor' },
//     Buffer.from(tx, 'hex')
//   );
//   if (result.error) {
//     if (result.status_code === 400)
//       throw { ...TxSendError.Failure, message: result.message };
//     else if (result.status_code === 500) throw APIError.InternalError;
//     else if (result.status_code === 429) throw TxSendError.Refused;
//     else if (result.status_code === 425) throw ERROR.fullMempool;
//     else throw APIError.InvalidRequest;
//   }
//   return result;
// };
//
// const emitNetworkChange = async (networkId) => {
//   //to webpage
//   chrome.tabs.query({}, (tabs) => {
//     tabs.forEach((tab) =>
//       chrome.tabs.sendMessage(tab.id, {
//         data: networkId,
//         target: TARGET,
//         sender: SENDER.extension,
//         event: EVENT.networkChange,
//       })
//     );
//   });
// };
//
// const emitAccountChange = async (addresses) => {
//   //to extenstion itself
//   if (typeof window !== 'undefined') {
//     window.postMessage({
//       data: addresses,
//       target: TARGET,
//       sender: SENDER.extension,
//       event: EVENT.accountChange,
//     });
//   }
//   //to webpage
//   chrome.tabs.query({}, (tabs) => {
//     tabs.forEach((tab) =>
//       chrome.tabs.sendMessage(tab.id, {
//         data: addresses,
//         target: TARGET,
//         sender: SENDER.extension,
//         event: EVENT.accountChange,
//       })
//     );
//   });
// };
//
// export const onAccountChange = (callback) => {
//   function responseHandler(e) {
//     const response = e.data;
//     if (
//       typeof response !== 'object' ||
//       response === null ||
//       !response.target ||
//       response.target !== TARGET ||
//       !response.event ||
//       response.event !== EVENT.accountChange ||
//       !response.sender ||
//       response.sender !== SENDER.extension
//     )
//       return;
//     callback(response.data);
//   }
//   window.addEventListener('message', responseHandler);
//   return {
//     remove: () => {
//       window.removeEventListener('message', responseHandler);
//     },
//   };
// };
//
// export const switchAccount = async (accountIndex) => {
//   await setStorage({ [STORAGE.currentAccount]: accountIndex });
//   const address = await getAddress();
//   emitAccountChange([address]);
//   return true;
// };
//
// export const requestAccountKey = async (password, accountIndex) => {
//   await Loader.load();
//   const encryptedRootKey = await getStorage(STORAGE.encryptedKey);
//   let accountKey;
//   try {
//     accountKey = Loader.Cardano.Bip32PrivateKey.from_bytes(
//       Buffer.from(await decryptWithPassword(password, encryptedRootKey), 'hex')
//     )
//       .derive(harden(1852)) // purpose
//       .derive(harden(1815)) // coin type;
//       .derive(harden(parseInt(accountIndex)));
//   } catch (e) {
//     throw ERROR.wrongPassword;
//   }
//
//   return {
//     accountKey,
//     paymentKey: accountKey.derive(0).derive(0).to_raw_key(),
//     stakeKey: accountKey.derive(2).derive(0).to_raw_key(),
//   };
// };
//
// export const resetStorage = async (password) => {
//   await requestAccountKey(password, 0);
//   await new Promise((res, rej) => chrome.storage.local.clear(() => res()));
//   return true;
// };
//
// export const createAccount = async (name, password, accountIndex = null) => {
//   await Loader.load();
//
//   const existingAccounts = await getStorage(STORAGE.accounts);
//
//   const index = accountIndex
//     ? accountIndex
//     : existingAccounts
//       ? Object.keys(getNativeAccounts(existingAccounts)).length
//       : 0;
//
//   let { accountKey, paymentKey, stakeKey } = await requestAccountKey(
//     password,
//     index
//   );
//
//   const publicKey = Buffer.from(accountKey.to_public().as_bytes()).toString(
//     'hex'
//   ); // BIP32 Public key
//   const paymentKeyPub = paymentKey.to_public();
//   const stakeKeyPub = stakeKey.to_public();
//
//   accountKey.free();
//   paymentKey.free();
//   stakeKey.free();
//   accountKey = null;
//   paymentKey = null;
//   stakeKey = null;
//
//   const paymentKeyHash = Buffer.from(
//     paymentKeyPub.hash().to_bytes(),
//     'hex'
//   ).toString('hex');
//
//   const paymentKeyHashBech32 = paymentKeyPub.hash().to_bech32('addr_vkh');
//
//   const stakeKeyHash = Buffer.from(
//     stakeKeyPub.hash().to_bytes(),
//     'hex'
//   ).toString('hex');
//
//   const paymentAddrMainnet = Loader.Cardano.BaseAddress.new(
//     Loader.Cardano.NetworkInfo.mainnet().network_id(),
//     Loader.Cardano.StakeCredential.from_keyhash(paymentKeyPub.hash()),
//     Loader.Cardano.StakeCredential.from_keyhash(stakeKeyPub.hash())
//   )
//     .to_address()
//     .to_bech32();
//
//   const rewardAddrMainnet = Loader.Cardano.RewardAddress.new(
//     Loader.Cardano.NetworkInfo.mainnet().network_id(),
//     Loader.Cardano.StakeCredential.from_keyhash(stakeKeyPub.hash())
//   )
//     .to_address()
//     .to_bech32();
//
//   const paymentAddrTestnet = Loader.Cardano.BaseAddress.new(
//     Loader.Cardano.NetworkInfo.testnet().network_id(),
//     Loader.Cardano.StakeCredential.from_keyhash(paymentKeyPub.hash()),
//     Loader.Cardano.StakeCredential.from_keyhash(stakeKeyPub.hash())
//   )
//     .to_address()
//     .to_bech32();
//
//   const rewardAddrTestnet = Loader.Cardano.RewardAddress.new(
//     Loader.Cardano.NetworkInfo.testnet().network_id(),
//     Loader.Cardano.StakeCredential.from_keyhash(stakeKeyPub.hash())
//   )
//     .to_address()
//     .to_bech32();
//
//   const networkDefault = {
//     lovelace: null,
//     minAda: 0,
//     assets: [],
//     history: { confirmed: [], details: {} },
//   };
//
//   const newAccount = {
//     [index]: {
//       index,
//       publicKey,
//       paymentKeyHash,
//       paymentKeyHashBech32,
//       stakeKeyHash,
//       name,
//       [NETWORK_ID.mainnet]: {
//         ...networkDefault,
//         paymentAddr: paymentAddrMainnet,
//         rewardAddr: rewardAddrMainnet,
//       },
//       [NETWORK_ID.testnet]: {
//         ...networkDefault,
//         paymentAddr: paymentAddrTestnet,
//         rewardAddr: rewardAddrTestnet,
//       },
//       [NETWORK_ID.preview]: {
//         ...networkDefault,
//         paymentAddr: paymentAddrTestnet,
//         rewardAddr: rewardAddrTestnet,
//       },
//       [NETWORK_ID.preprod]: {
//         ...networkDefault,
//         paymentAddr: paymentAddrTestnet,
//         rewardAddr: rewardAddrTestnet,
//       },
//       avatar: Math.random().toString(),
//     },
//   };
//
//   await setStorage({
//     [STORAGE.accounts]: { ...existingAccounts, ...newAccount },
//   });
//   return index;
// };
//
// export const createHWAccounts = async (accounts) => {
//   await Loader.load();
//   const existingAccounts = await getStorage(STORAGE.accounts);
//   accounts.forEach((account) => {
//     const publicKey = Loader.Cardano.Bip32PublicKey.from_bytes(
//       Buffer.from(account.publicKey, 'hex')
//     );
//
//     const paymentKeyHashRaw = publicKey.derive(0).derive(0).to_raw_key().hash();
//     const stakeKeyHashRaw = publicKey.derive(2).derive(0).to_raw_key().hash();
//
//     const paymentKeyHash = Buffer.from(paymentKeyHashRaw.to_bytes()).toString(
//       'hex'
//     );
//
//     const paymentKeyHashBech32 = paymentKeyHashRaw.to_bech32('addr_vkh');
//
//     const stakeKeyHash = Buffer.from(stakeKeyHashRaw.to_bytes()).toString(
//       'hex'
//     );
//
//     const paymentAddrMainnet = Loader.Cardano.BaseAddress.new(
//       Loader.Cardano.NetworkInfo.mainnet().network_id(),
//       Loader.Cardano.StakeCredential.from_keyhash(paymentKeyHashRaw),
//       Loader.Cardano.StakeCredential.from_keyhash(stakeKeyHashRaw)
//     )
//       .to_address()
//       .to_bech32();
//
//     const rewardAddrMainnet = Loader.Cardano.RewardAddress.new(
//       Loader.Cardano.NetworkInfo.mainnet().network_id(),
//       Loader.Cardano.StakeCredential.from_keyhash(stakeKeyHashRaw)
//     )
//       .to_address()
//       .to_bech32();
//
//     const paymentAddrTestnet = Loader.Cardano.BaseAddress.new(
//       Loader.Cardano.NetworkInfo.testnet().network_id(),
//       Loader.Cardano.StakeCredential.from_keyhash(paymentKeyHashRaw),
//       Loader.Cardano.StakeCredential.from_keyhash(stakeKeyHashRaw)
//     )
//       .to_address()
//       .to_bech32();
//
//     const rewardAddrTestnet = Loader.Cardano.RewardAddress.new(
//       Loader.Cardano.NetworkInfo.testnet().network_id(),
//       Loader.Cardano.StakeCredential.from_keyhash(stakeKeyHashRaw)
//     )
//       .to_address()
//       .to_bech32();
//
//     const index = account.accountIndex;
//     const name = account.name;
//
//     const networkDefault = {
//       lovelace: null,
//       minAda: 0,
//       assets: [],
//       history: { confirmed: [], details: {} },
//     };
//
//     existingAccounts[index] = {
//       index,
//       publicKey: Buffer.from(publicKey.as_bytes()).toString('hex'),
//       paymentKeyHash,
//       paymentKeyHashBech32,
//       stakeKeyHash,
//       name,
//       [NETWORK_ID.mainnet]: {
//         ...networkDefault,
//         paymentAddr: paymentAddrMainnet,
//         rewardAddr: rewardAddrMainnet,
//       },
//       [NETWORK_ID.testnet]: {
//         ...networkDefault,
//         paymentAddr: paymentAddrTestnet,
//         rewardAddr: rewardAddrTestnet,
//       },
//       [NETWORK_ID.preview]: {
//         ...networkDefault,
//         paymentAddr: paymentAddrTestnet,
//         rewardAddr: rewardAddrTestnet,
//       },
//       [NETWORK_ID.preprod]: {
//         ...networkDefault,
//         paymentAddr: paymentAddrTestnet,
//         rewardAddr: rewardAddrTestnet,
//       },
//       avatar: Math.random().toString(),
//     };
//   });
//   await setStorage({
//     [STORAGE.accounts]: existingAccounts,
//   });
// };
//
// export const deleteAccount = async () => {
//   const storage = await getStorage();
//   const accounts = storage[STORAGE.accounts];
//   const currentIndex = storage[STORAGE.currentAccount];
//   if (Object.keys(accounts).length <= 1) throw new Error(ERROR.onlyOneAccount);
//   delete accounts[currentIndex];
//   return await setStorage({ [STORAGE.accounts]: accounts });
// };
//
// export const getNativeAccounts = (accounts) => {
//   const nativeAccounts = {};
//   Object.keys(accounts)
//     .filter((accountIndex) => !isHW(accountIndex))
//     .forEach(
//       (accountIndex) => (nativeAccounts[accountIndex] = accounts[accountIndex])
//     );
//   return nativeAccounts;
// };
//
// export const indexToHw = (accountIndex) => ({
//   device: accountIndex.split('-')[0],
//   id: accountIndex.split('-')[1],
//   account: parseInt(accountIndex.split('-')[2]),
// });
//
// export const getHwAccounts = (accounts, { device, id }) => {
//   const hwAccounts = {};
//   Object.keys(accounts)
//     .filter(
//       (accountIndex) =>
//         isHW(accountIndex) &&
//         indexToHw(accountIndex).device == device &&
//         indexToHw(accountIndex).id == id
//     )
//     .forEach(
//       (accountIndex) => (hwAccounts[accountIndex] = accounts[accountIndex])
//     );
//   return hwAccounts;
// };
//
// export const isHW = (accountIndex) =>
//   accountIndex != null &&
//   accountIndex != undefined &&
//   accountIndex != 0 &&
//   typeof accountIndex !== 'number' &&
//   (accountIndex.startsWith(HW.trezor) || accountIndex.startsWith(HW.ledger));
//
// export const initHW = async ({ device, id }) => {
//   if (device == HW.ledger) {
//     const foundDevice = await new Promise((res, rej) =>
//       navigator.usb
//         .getDevices()
//         .then((devices) =>
//           res(
//             devices.find(
//               (device) =>
//                 device.productId == id && device.manufacturerName === 'Ledger'
//             )
//           )
//         )
//     );
//     const transport = await TransportWebUSB.open(foundDevice);
//     const appAda = new Ada(transport);
//     await appAda.getVersion(); // check if Ledger has Cardano app opened
//     return appAda;
//   } else if (device == HW.trezor) {
//     try {
//       await TrezorConnect.init({
//         manifest: {
//           email: 'namiwallet.cardano@gmail.com',
//           appUrl: 'http://namiwallet.io',
//         },
//       });
//     } catch (e) {}
//   }
// };
//
// /**
//  *
//  * @param {string} assetName utf8 encoded
//  */
// export const getAdaHandle = async (assetName) => {
//   try {
//     const network = await getNetwork();
//     if (!network) return null;
//     let handleUrl;
//     switch (network.id){
//       case 'mainnet':
//         handleUrl = 'https://api.handle.me'
//         break;
//       case 'preprod':
//         handleUrl = 'https://preprod.api.handle.me'
//         break;
//       default:
//         return null;
//     }
//     const response = await fetch(`${handleUrl}/handles/${assetName}`);
//     const data = response && response.ok ? await response.json() : null;
//     return data && data.resolved_addresses && data.resolved_addresses.ada
//       ? data.resolved_addresses.ada
//       : null;
//   } catch (e) {
//     return null;
//   }
// };
//
// /**
//  *
//  * @param {string} ethAddress
//  */
// export const getMilkomedaData = async (ethAddress) => {
//   const network = await getNetwork();
//   if (network.id === NETWORK_ID.mainnet) {
//     const { isAllowed } = await fetch(
//       'https://' +
//       milkomedaNetworks['c1-mainnet'].backendEndpoint +
//       `/v1/isAddressAllowed?address=${ethAddress}`
//     ).then((res) => res.json());
//     const { ada, ttl_expiry, assets, current_address } = await fetch(
//       'https://' +
//       milkomedaNetworks['c1-mainnet'].backendEndpoint +
//       '/v1/stargate'
//     ).then((res) => res.json());
//     const protocolMagic = milkomedaNetworks['c1-mainnet'].protocolMagic;
//     return {
//       isAllowed,
//       assets: [],
//       ada,
//       current_address,
//       protocolMagic,
//       ttl: ttl_expiry,
//     };
//   } else {
//     const { isAllowed } = await fetch(
//       'https://' +
//       milkomedaNetworks['c1-devnet'].backendEndpoint +
//       `/v1/isAddressAllowed?address=${ethAddress}`
//     ).then((res) => res.json());
//     const { ada, ttl_expiry, assets, current_address } = await fetch(
//       'https://' +
//       milkomedaNetworks['c1-devnet'].backendEndpoint +
//       '/v1/stargate'
//     ).then((res) => res.json());
//     const protocolMagic = milkomedaNetworks['c1-devnet'].protocolMagic;
//     return {
//       isAllowed,
//       assets: [],
//       ada,
//       current_address,
//       protocolMagic,
//       ttl: ttl_expiry,
//     };
//   }
// };
//
// export const createWallet = async (name, seedPhrase, password) => {
//   await Loader.load();
//
//   let entropy = mnemonicToEntropy(seedPhrase);
//   let rootKey = Loader.Cardano.Bip32PrivateKey.from_bip39_entropy(
//     Buffer.from(entropy, 'hex'),
//     Buffer.from('')
//   );
//   entropy = null;
//   seedPhrase = null;
//
//   const encryptedRootKey = await encryptWithPassword(
//     password,
//     rootKey.as_bytes()
//   );
//   rootKey.free();
//   rootKey = null;
//
//   const checkStore = await getStorage(STORAGE.encryptedKey);
//   if (checkStore) throw new Error(ERROR.storeNotEmpty);
//   await setStorage({ [STORAGE.encryptedKey]: encryptedRootKey });
//   await setStorage({
//     [STORAGE.network]: { id: NETWORK_ID.mainnet, node: NODE.mainnet },
//   });
//
//   await setStorage({
//     [STORAGE.currency]: 'usd',
//   });
//
//   const index = await createAccount(name, password);
//
//   //check for sub accounts
//   let searchIndex = 1;
//   while (true) {
//     let { paymentKey, stakeKey } = await requestAccountKey(
//       password,
//       searchIndex
//     );
//     const paymentKeyHashBech32 = paymentKey
//       .to_public()
//       .hash()
//       .to_bech32('addr_vkh');
//     // const stakeKeyHash = stakeKey.to_public().hash();
//     paymentKey.free();
//     // stakeKey.free();
//     paymentKey = null;
//     // stakeKey = null;
//     // const paymentAddr = Loader.Cardano.BaseAddress.new(
//     //   Loader.Cardano.NetworkInfo.mainnet().network_id(),
//     //   Loader.Cardano.StakeCredential.from_keyhash(paymentKeyHash),
//     //   Loader.Cardano.StakeCredential.from_keyhash(stakeKeyHash)
//     // )
//     //   .to_address()
//     //   .to_bech32();
//     const transactions = await blockfrostRequest(
//       `/addresses/${paymentKeyHashBech32}/transactions`
//     );
//     if (transactions && !transactions.error && transactions.length >= 1)
//       createAccount(`Account ${searchIndex}`, password, searchIndex);
//     else break;
//     searchIndex++;
//   }
//
//   password = null;
//   await switchAccount(index);
//
//   return true;
// };
//
// export const mnemonicToObject = (mnemonic) => {
//   const mnemonicMap = {};
//   mnemonic.split(' ').forEach((word, index) => (mnemonicMap[index + 1] = word));
//   return mnemonicMap;
// };
//
// export const mnemonicFromObject = (mnemonicMap) => {
//   return Object.keys(mnemonicMap).reduce(
//     (acc, key) => (acc ? acc + ' ' + mnemonicMap[key] : acc + mnemonicMap[key]),
//     ''
//   );
// };
//
// export const avatarToImage = (avatar) => {
//   const blob = new Blob(
//     [
//       createAvatar(style, {
//         seed: avatar,
//       }),
//     ],
//     { type: 'image/svg+xml' }
//   );
//   return URL.createObjectURL(blob);
// };
//
// export const getAsset = async (unit) => {
//   if (!window.assets) {
//     window.assets = JSON.parse(
//       localStorage.getItem(LOCAL_STORAGE.assets) || '{}'
//     );
//   }
//   const assets = window.assets;
//   const asset = assets[unit] || {};
//   const time = Date.now();
//   const h1 = 6000000;
//   if (asset && asset.time && time - asset.time <= h1 && !asset.mint) {
//     return asset;
//   } else {
//     const { policyId, name, label } = fromAssetUnit(unit);
//     const bufferName = Buffer.from(name, 'hex');
//     asset.unit = unit;
//     asset.policy = policyId;
//     asset.fingerprint = AssetFingerprint.fromParts(
//       Buffer.from(policyId, 'hex'),
//       bufferName
//     ).fingerprint();
//     asset.name = Number.isInteger(label)
//       ? `(${label}) ` + bufferName.toString()
//       : bufferName.toString();
//
//     // CIP-0067 & CIP-0068 (support 222 and 333 sub standards)
//
//     if (label === 222) {
//       const refUnit = toAssetUnit(policyId, name, 100);
//       try {
//         const owners = await blockfrostRequest(`/assets/${refUnit}/addresses`);
//         if (!owners || owners.error) {
//           throw new Error('No owner found.');
//         }
//         const [refUtxo] = await blockfrostRequest(
//           `/addresses/${owners[0].address}/utxos/${refUnit}`
//         );
//         const datum =
//           refUtxo?.inline_datum ||
//           (await blockfrostRequest(`/scripts/datum/${refUtxo?.data_hash}/cbor`))
//             ?.cbor;
//         const metadataDatum = datum && (await Data.from(datum));
//
//         if (metadataDatum.index !== 0) throw new Error('No correct metadata.');
//
//         const metadata = metadataDatum && Data.toJson(metadataDatum.fields[0]);
//
//         asset.displayName = metadata.name;
//         asset.image = metadata.image ? linkToSrc(convertMetadataPropToString(metadata.image)) : '';
//         asset.decimals = 0;
//       } catch (_e) {
//         asset.displayName = asset.name;
//         asset.mint = true;
//       }
//     } else if (label === 333) {
//       const refUnit = toAssetUnit(policyId, name, 100);
//       try {
//         const owners = await blockfrostRequest(`/assets/${refUnit}/addresses`);
//         if (!owners || owners.error) {
//           throw new Error('No owner found.');
//         }
//         const [refUtxo] = await blockfrostRequest(
//           `/addresses/${owners[0].address}/utxos/${refUnit}`
//         );
//         const datum =
//           refUtxo?.inline_datum ||
//           (await blockfrostRequest(`/scripts/datum/${refUtxo?.data_hash}/cbor`))
//             ?.cbor;
//         const metadataDatum = datum && (await Data.from(datum));
//
//         if (metadataDatum.index !== 0) throw new Error('No correct metadata.');
//
//         const metadata = metadataDatum && Data.toJson(metadataDatum.fields[0]);
//
//         asset.displayName = metadata.name;
//         asset.image = linkToSrc(convertMetadataPropToString(metadata.logo)) || '';
//         asset.decimals = metadata.decimals || 0;
//       } catch (_e) {
//         asset.displayName = asset.name;
//         asset.mint = true;
//       }
//     } else {
//       let result = await blockfrostRequest(`/assets/${unit}`);
//       if (!result || result.error) {
//         result = {};
//         asset.mint = true;
//       }
//       const onchainMetadata =
//         result.onchain_metadata &&
//         ((result.onchain_metadata.version === 2 &&
//             result.onchain_metadata?.[`0x${policyId}`]?.[`0x${name}`]) ||
//           result.onchain_metadata);
//       asset.displayName =
//         (onchainMetadata && onchainMetadata.name) ||
//         (result.metadata && result.metadata.name) ||
//         asset.name;
//       asset.image =
//         (onchainMetadata &&
//           onchainMetadata.image &&
//           linkToSrc(convertMetadataPropToString(onchainMetadata.image))) ||
//         (result.metadata &&
//           result.metadata.logo &&
//           linkToSrc(result.metadata.logo, true)) ||
//         '';
//       asset.decimals = (result.metadata && result.metadata.decimals) || 0;
//       if (!asset.name) {
//         if (asset.displayName) asset.name = asset.displayName[0];
//         else asset.name = '-';
//       }
//     }
//     asset.time = Date.now();
//     assets[unit] = asset;
//     window.assets = assets;
//     localStorage.setItem(LOCAL_STORAGE.assets, JSON.stringify(assets));
//     return asset;
//   }
// };
//
// // export const updateBalance = async (currentAccount, network) => {
// //   await Loader.load();
// //   const assets = await getBalanceExtended();
// //   const amount = await assetsToValue(assets);
// //   await checkCollateral(currentAccount, network);
// //
// //   if (assets.length > 0) {
// //     currentAccount[network.id].lovelace = assets.find(
// //       (am) => am.unit === 'lovelace'
// //     ).quantity;
// //     currentAccount[network.id].assets = assets.filter(
// //       (am) => am.unit !== 'lovelace'
// //     );
// //     if (currentAccount[network.id].assets.length > 0) {
// //       const protocolParameters = await initTx();
// //       const checkOutput = Loader.Cardano.TransactionOutput.new(
// //         Loader.Cardano.Address.from_bech32(
// //           currentAccount[network.id].paymentAddr
// //         ),
// //         amount
// //       );
// //       currentAccount[network.id].minAda = Loader.Cardano.min_ada_required(
// //         checkOutput,
// //         Loader.Cardano.BigNum.from_str(protocolParameters.coinsPerUtxoWord)
// //       ).to_str();
// //     } else {
// //       currentAccount[network.id].minAda = 0;
// //     }
// //   } else {
// //     currentAccount[network.id].lovelace = 0;
// //     currentAccount[network.id].assets = [];
// //     currentAccount[network.id].minAda = 0;
// //   }
// //   return true;
// // };
//
// const updateTransactions = async (currentAccount, network) => {
//   const transactions = await getTransactions();
//   if (
//     transactions.length <= 0 ||
//     currentAccount[network.id].history.confirmed.includes(
//       transactions[0].txHash
//     )
//   )
//     return false;
//   let txHashes = transactions.map((tx) => tx.txHash);
//   txHashes = txHashes.concat(currentAccount[network.id].history.confirmed);
//   const txSet = new Set(txHashes);
//   currentAccount[network.id].history.confirmed = Array.from(txSet);
//   return true;
// };
//
// export const setTransactions = async (txs) => {
//   const currentIndex = await getCurrentAccountIndex();
//   const network = await getNetwork();
//   const accounts = await getStorage(STORAGE.accounts);
//   accounts[currentIndex][network.id].history.confirmed = txs;
//   return await setStorage({
//     [STORAGE.accounts]: {
//       ...accounts,
//     },
//   });
// };
//
// export const setCollateral = async (collateral) => {
//   const currentIndex = await getCurrentAccountIndex();
//   const network = await getNetwork();
//   const accounts = await getStorage(STORAGE.accounts);
//   accounts[currentIndex][network.id].collateral = collateral;
//   return await setStorage({
//     [STORAGE.accounts]: {
//       ...accounts,
//     },
//   });
// };
//
// export const removeCollateral = async () => {
//   const currentIndex = await getCurrentAccountIndex();
//   const network = await getNetwork();
//   const accounts = await getStorage(STORAGE.accounts);
//   delete accounts[currentIndex][network.id].collateral;
//
//   return await setStorage({
//     [STORAGE.accounts]: {
//       ...accounts,
//     },
//   });
// };
//
// export const updateAccount = async (forceUpdate = false) => {
//   const currentIndex = await getCurrentAccountIndex();
//   const accounts = await getStorage(STORAGE.accounts);
//   const currentAccount = accounts[currentIndex];
//   const network = await getNetwork();
//
//   await updateTransactions(currentAccount, network);
//
//   if (
//     currentAccount[network.id].history.confirmed[0] ===
//     currentAccount[network.id].lastUpdate &&
//     !forceUpdate &&
//     !currentAccount[network.id].forceUpdate
//   ) {
//     if (currentAccount[network.id].lovelace == null) {
//       // first initilization of account
//       currentAccount[network.id].lovelace = '0';
//       await setStorage({
//         [STORAGE.accounts]: {
//           ...accounts,
//         },
//       });
//     }
//     return;
//   }
//
//   // forcing acccount update for in case of breaking changes in an Nami update
//   if (currentAccount[network.id].forceUpdate)
//     delete currentAccount[network.id].forceUpdate;
//
//   await updateBalance(currentAccount, network);
//
//   currentAccount[network.id].lastUpdate =
//     currentAccount[network.id].history.confirmed[0];
//
//   return await setStorage({
//     [STORAGE.accounts]: {
//       ...accounts,
//     },
//   });
// };
//
// export const updateRecentSentToAddress = async (address) => {
//   const currentIndex = await getCurrentAccountIndex();
//   const accounts = await getStorage(STORAGE.accounts);
//   const network = await getNetwork();
//   accounts[currentIndex][network.id].recentSendToAddresses = [address]; // Update in the future to add mulitple addresses
//   return await setStorage({
//     [STORAGE.accounts]: {
//       ...accounts,
//     },
//   });
// };
//
// export const displayUnit = (quantity, decimals = 6) => {
//   return parseInt(quantity) / 10 ** decimals;
// };
//
// export const toUnit = (amount, decimals = 6) => {
//   if (!amount) return '0';
//   let result = parseFloat(
//     amount.toString().replace(/[,\s]/g, '')
//   ).toLocaleString('en-EN', { minimumFractionDigits: decimals });
//   const split = result.split('.');
//   const front = split[0].replace(/[,\s]/g, '');
//   result =
//     (front === 0 ? '' : front) + (split[1] ? split[1].slice(0, decimals) : '');
//   if (!result) return '0';
//   else if (result === 'NaN') return '0';
//   return result;
// };
