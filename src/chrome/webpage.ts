import { METHOD } from '@/chrome/config';
import { Messaging } from '@/chrome/messaging';
import { DataSignature, Paginate } from '@/models/types';
import { Cardano as CardanoCore } from '@cardano-sdk/core';

export const getBalance = async (): Promise<string> => {
  const result = await Messaging.sendToContent({
    method: METHOD.getBalance,data: {}
  });
  return result['data'];
};

export const enable = async (): Promise<any> => {
  const result = await Messaging.sendToContent({
    method: METHOD.enable,data: {}
  });
  return result['data'];
};

export const isEnabled = async (): Promise<boolean> => {
  const result = await Messaging.sendToContent({
    method: METHOD.isEnabled,data: {}
  });
  return result['data'];
};

export const promptLogin = async (): Promise<void> => {
  const result = await Messaging.sendToContent({
    method: METHOD.popupLogin,
    data: { },
  });
  if (result['data']) {
    window.dispatchEvent(new CustomEvent('gero:login', {
      bubbles: true,
      cancelable: true,
      composed: false,
    }))
  }
  return result['data'];
};

export const signData = async (address: CardanoCore.PaymentAddress | CardanoCore.RewardAccount | string, payload: string): Promise<DataSignature> => {
  const result = await Messaging.sendToContent({
    method: METHOD.signData,
    data: { address, payload },
  });
  return result['data'];
};

export const signTx = async (tx: string, partialSign: boolean = false): Promise<string> => {
  const result = await Messaging.sendToContent({
    method: METHOD.signTx,
    data: { tx, partialSign },
  });
  console.log('signTx Result', result['data'])
  return result['data'];
};

export const getAddress = async (): Promise<string[]> => {
  const result = await Messaging.sendToContent({
    method: METHOD.getAddress,
    data: {}
  });
  return result['data'];
};

export const getAddressBech32 = async (): Promise<string[]> => {
  const result = await Messaging.sendToContent({
    method: METHOD.getAddressBech32,
    data: {}
  });
  return [result['data']];
};

export const getRewardAddresses = async (): Promise<string[]> => {
  const result = await Messaging.sendToContent({
    method: METHOD.getRewardAddresses,
    data: {}
  });
  return result['data'];
};

export const getUsedAddresses = async (paginate?: Paginate): Promise<string[]> => {
  const result = await Messaging.sendToContent({
    method: METHOD.getUsedAddresses,
    data: { paginate }
  });
  return result['data'];
};

export const getUnusedAddresses = async (): Promise<string[]> => {
  const result = await Messaging.sendToContent({
    method: METHOD.getUnusedAddresses,
    data: {}
  });
  return result['data'];
};

export const getNetworkId = async () => {
  const result = await Messaging.sendToContent({
    method: METHOD.getNetworkId,
    data: {}
  });
  return result['data'];
};

export const getUtxos = async (amount?: string, paginate?: Paginate) => {
  const result = await Messaging.sendToContent({
    method: METHOD.getUtxos,
    data: { amount, paginate },
  });
  return result['data'];
};

export const getCollateral = async (params) => {
  const result = await Messaging.sendToContent( {
    method: METHOD.getCollateral,
    data: { params }
  });
  console.log('getCollateral Result', result);
  return result['data'];
};

export const submitTx = async (tx) => {
  const result = await Messaging.sendToContent({
    method: METHOD.submitTx,
    data: { tx } ,
  });
  console.log('submitTx Result', result['data']);
  return result['data'];
};

export const getPubDRepKey = async () => {
  const result = await Messaging.sendToContent({
    method: METHOD.getPubDRepKey,
    data: {},
  });
  return result['data'];
};

export const getRegisteredPubStakeKeys = async () => {
  const result = await Messaging.sendToContent({
    method: METHOD.getRegisteredPubStakeKeys,
    data: {},
  });
  return result['data'];
};

export const getUnregisteredPubStakeKeys = async () => {
  const result = await Messaging.sendToContent({
    method: METHOD.getUnregisteredPubStakeKeys,
    data: {},
  });
  return result['data'];
};

export const getAccountPub = async () => {
  const result = await Messaging.sendToContent({
    method: METHOD.getAccountPub,
    data: {},
  });
  return result['data'];
};

export const getNetworkMagic = async () => {
  const result = await Messaging.sendToContent({
    method: METHOD.getNetworkMagic,
    data: {},
  });
  return result['data'];
};
