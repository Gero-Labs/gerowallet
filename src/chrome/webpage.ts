import { METHOD, BITCOIN_METHOD } from '@/chrome/config';
import { Messaging } from '@/chrome/messaging';
import { DataSignature, Paginate } from '@/models/types';
import { Cardano as CardanoCore } from '@cardano-sdk/core';

export const getBalance = async (): Promise<string> => {
  console.log('🔵 [webpage.ts] getBalance called');
  const result = await Messaging.sendToContent({
    method: METHOD.getBalance,
    data: {}
  });
  console.log('🔵 [webpage.ts] getBalance result:', result);
  return result['data'];
};

export const enable = async (): Promise<any> => {
  console.log('🔵 [webpage.ts] enable called');
  const result = await Messaging.sendToContent({
    method: METHOD.enable,
    data: { userGesture: navigator.userActivation?.isActive }
  });
  console.log('🔵 [webpage.ts] enable result:', result);
  return result['data'];
};

export const isEnabled = async (): Promise<boolean> => {
  console.log('🔵 [webpage.ts] isEnabled called');
  const result = await Messaging.sendToContent({
    method: METHOD.isEnabled,
    data: {}
  });
  console.log('🔵 [webpage.ts] isEnabled result:', result);
  return result['data'];
};

export const promptLogin = async (): Promise<void> => {
  console.log('🔵 [webpage.ts] promptLogin called');
  const result = await Messaging.sendToContent({
    method: METHOD.popupLogin,
    data: { userGesture: navigator.userActivation?.isActive },
  });
  console.log('🔵 [webpage.ts] promptLogin result:', result);
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
  console.log('🔵 [webpage.ts] signData called', { address, payload });
  const result: any = await Messaging.sendToContent({
    method: METHOD.signData,
    data: { address, payload, userGesture: navigator.userActivation?.isActive },
  });
  console.log('🔵 [webpage.ts] signData result:', result);
  return {
    key: result.data.key,
    signature: result.data.signature,
  };
};

export const signTx = async (tx: string, partialSign: boolean = false): Promise<string> => {
  console.log('🔵 [webpage.ts] signTx called', { txLength: tx?.length, partialSign });
  const result = await Messaging.sendToContent({
    method: METHOD.signTx,
    data: { tx, partialSign, userGesture: navigator.userActivation?.isActive },
  });
  console.log('🔵 [webpage.ts] signTx result:', result);
  return result['data'];
};

export const getAddress = async (): Promise<string[]> => {
  console.log('🔵 [webpage.ts] getAddress called');
  const result = await Messaging.sendToContent({
    method: METHOD.getAddress,
    data: {}
  });
  console.log('🔵 [webpage.ts] getAddress result:', result);
  return result['data'];
};

export const getAddressBech32 = async (): Promise<string[]> => {
  console.log('🔵 [webpage.ts] getAddressBech32 called');
  const result = await Messaging.sendToContent({
    method: METHOD.getAddressBech32,
    data: {}
  });
  console.log('🔵 [webpage.ts] getAddressBech32 result:', result);
  return [result['data']];
};

export const getRewardAddresses = async (): Promise<string[]> => {
  console.log('🔵 [webpage.ts] getRewardAddresses called');
  const result = await Messaging.sendToContent({
    method: METHOD.getRewardAddresses,
    data: {}
  });
  console.log('🔵 [webpage.ts] getRewardAddresses result:', result);
  return result['data'];
};

export const getUsedAddresses = async (paginate?: Paginate): Promise<string[]> => {
  console.log('🔵 [webpage.ts] getUsedAddresses called', { paginate });
  const result = await Messaging.sendToContent({
    method: METHOD.getUsedAddresses,
    data: { paginate }
  });
  console.log('🔵 [webpage.ts] getUsedAddresses result:', result);
  return result['data'];
};

export const getUnusedAddresses = async (): Promise<string[]> => {
  console.log('🔵 [webpage.ts] getUnusedAddresses called');
  const result = await Messaging.sendToContent({
    method: METHOD.getUnusedAddresses,
    data: {}
  });
  console.log('🔵 [webpage.ts] getUnusedAddresses result:', result);
  return result['data'];
};

export const getNetworkId = async () => {
  console.log('🔵 [webpage.ts] getNetworkId called');
  const result = await Messaging.sendToContent({
    method: METHOD.getNetworkId,
    data: {}
  });
  console.log('🔵 [webpage.ts] getNetworkId result:', result);
  return result['data'];
};

export const getUtxos = async (amount?: string, paginate?: Paginate) => {
  console.log('🔵 [webpage.ts] getUtxos called', { amount, paginate });
  const result = await Messaging.sendToContent({
    method: METHOD.getUtxos,
    data: { amount, paginate },
  });
  console.log('🔵 [webpage.ts] getUtxos result:', result);
  return result['data'];
};

export const getCollateral = async (params) => {
  console.log('🔵 [webpage.ts] getCollateral called', { params });
  const result = await Messaging.sendToContent( {
    method: METHOD.getCollateral,
    data: { params }
  });
  console.log('🔵 [webpage.ts] getCollateral result:', result);
  return result['data'];
};

export const submitTx = async (tx) => {
  console.log('🔵 [webpage.ts] submitTx called', { txLength: tx?.length });
  const result = await Messaging.sendToContent({
    method: METHOD.submitTx,
    data: { tx } ,
  });
  console.log('🔵 [webpage.ts] submitTx result:', result);
  return result['data'];
};

export const getPubDRepKey = async () => {
  console.log('🔵 [webpage.ts] getPubDRepKey called');
  const result = await Messaging.sendToContent({
    method: METHOD.getPubDRepKey,
    data: {},
  });
  console.log('🔵 [webpage.ts] getPubDRepKey result:', result);
  return result['data'];
};

export const getRegisteredPubStakeKeys = async () => {
  console.log('🔵 [webpage.ts] getRegisteredPubStakeKeys called');
  const result = await Messaging.sendToContent({
    method: METHOD.getRegisteredPubStakeKeys,
    data: {},
  });
  console.log('🔵 [webpage.ts] getRegisteredPubStakeKeys result:', result);
  return result['data'];
};

export const getUnregisteredPubStakeKeys = async () => {
  console.log('🔵 [webpage.ts] getUnregisteredPubStakeKeys called');
  const result = await Messaging.sendToContent({
    method: METHOD.getUnregisteredPubStakeKeys,
    data: {},
  });
  console.log('🔵 [webpage.ts] getUnregisteredPubStakeKeys result:', result);
  return result['data'];
};

export const getAccountPub = async () => {
  console.log('🔵 [webpage.ts] getAccountPub called');
  const result = await Messaging.sendToContent({
    method: METHOD.getAccountPub,
    data: {},
  });
  console.log('🔵 [webpage.ts] getAccountPub result:', result);
  return result['data'];
};

export const getNetworkMagic = async () => {
  console.log('🔵 [webpage.ts] getNetworkMagic called');
  const result = await Messaging.sendToContent({
    method: METHOD.getNetworkMagic,
    data: {},
  });
  console.log('🔵 [webpage.ts] getNetworkMagic result:', result);
  return result['data'];
};

// ─── Bitcoin (Unisat-compatible) ──────────────────────────────────────────────

export const btcRequestAccounts = async (): Promise<string[]> => {
  const result = await Messaging.sendToContent({
    method: BITCOIN_METHOD.enable,
    data: { userGesture: navigator.userActivation?.isActive },
  });
  if (result['error']) throw result['error'];
  return result['data'];
};

export const btcGetAccounts = async (): Promise<string[]> => {
  const result = await Messaging.sendToContent({ method: BITCOIN_METHOD.getAccounts, data: {} });
  if (result['error']) throw result['error'];
  return result['data'];
};

export const btcGetPublicKey = async (): Promise<string> => {
  const result = await Messaging.sendToContent({ method: BITCOIN_METHOD.getPublicKey, data: {} });
  if (result['error']) throw result['error'];
  return result['data'];
};

export const btcGetNetwork = async (): Promise<string> => {
  const result = await Messaging.sendToContent({ method: BITCOIN_METHOD.getNetwork, data: {} });
  if (result['error']) throw result['error'];
  return result['data'];
};

export const btcGetChain = async (): Promise<{ enum: string; name: string; network: string }> => {
  const network = await btcGetNetwork();
  if (network === 'testnet') {
    return { enum: 'BITCOIN_TESTNET', name: 'Bitcoin Testnet', network: 'testnet' };
  }
  return { enum: 'BITCOIN_MAINNET', name: 'Bitcoin Mainnet', network: 'mainnet' };
};

export const btcGetBalance = async (): Promise<{ confirmed: number; unconfirmed: number; total: number }> => {
  const result = await Messaging.sendToContent({ method: BITCOIN_METHOD.getBalance, data: {} });
  if (result['error']) throw result['error'];
  return result['data'];
};

export const btcGetUtxos = async (): Promise<any[]> => {
  const result = await Messaging.sendToContent({ method: BITCOIN_METHOD.getUtxos, data: {} });
  if (result['error']) throw result['error'];
  return result['data'];
};

export const btcSignPsbt = async (psbtHex: string, options?: { autoFinalized?: boolean; toSignInputs?: any[] }): Promise<string> => {
  const result = await Messaging.sendToContent({
    method: BITCOIN_METHOD.signPsbt,
    data: { psbtHex, options, userGesture: navigator.userActivation?.isActive },
  });
  if (result['error']) throw result['error'];
  return result['data'];
};

export const btcSignPsbts = async (psbtHexs: string[], options?: { autoFinalized?: boolean; toSignInputs?: any[] }): Promise<string[]> => {
  const result = await Messaging.sendToContent({
    method: BITCOIN_METHOD.signPsbts,
    data: { psbtHexs, options, userGesture: navigator.userActivation?.isActive },
  });
  if (result['error']) throw result['error'];
  return result['data'];
};

export const btcSignMessage = async (message: string, type: 'ecdsa' | 'bip322-simple' = 'ecdsa'): Promise<string> => {
  const result = await Messaging.sendToContent({
    method: BITCOIN_METHOD.signMessage,
    data: { message, type, userGesture: navigator.userActivation?.isActive },
  });
  if (result['error']) throw result['error'];
  return result['data'];
};

export const btcPushTx = async ({ rawtx }: { rawtx: string }): Promise<string> => {
  const result = await Messaging.sendToContent({
    method: BITCOIN_METHOD.pushTx,
    data: { rawtx },
  });
  if (result['error']) throw result['error'];
  return result['data'];
};

export const btcPushPsbt = async (psbtHex: string): Promise<string> => {
  const result = await Messaging.sendToContent({
    method: BITCOIN_METHOD.pushPsbt,
    data: { psbtHex },
  });
  if (result['error']) throw result['error'];
  return result['data'];
};
