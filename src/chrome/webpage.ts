import { METHOD, BITCOIN_METHOD } from '@/chrome/config';
import { Messaging } from '@/chrome/messaging';
import { DataSignature, Paginate } from '@/models/types';
import { Cardano as CardanoCore } from '@cardano-sdk/core';

// Envelope returned by the content-script proxy. Each call comes back as
// `{ data, error?, target, sender, id }`; callers only ever read `data`/`error`.
interface ContentReply<T = unknown> {
  data: T;
  error?: unknown;
}

export const getBalance = async (): Promise<string> => {
  const result = await Messaging.sendToContent({
    method: METHOD.getBalance,
    data: {}
  });
  return result['data'];
};

export const enable = async (): Promise<boolean> => {
  const result = (await Messaging.sendToContent({
    method: METHOD.enable,
    data: { userGesture: navigator.userActivation?.isActive }
  })) as ContentReply<boolean>;
  return result.data;
};

export const isEnabled = async (): Promise<boolean> => {
  const result = await Messaging.sendToContent({
    method: METHOD.isEnabled,
    data: {}
  });
  return result['data'];
};

export const signData = async (address: CardanoCore.PaymentAddress | CardanoCore.RewardAccount | string, payload: string): Promise<DataSignature> => {
  const result = (await Messaging.sendToContent({
    method: METHOD.signData,
    data: { address, payload, userGesture: navigator.userActivation?.isActive },
  })) as ContentReply<DataSignature>;
  return {
    key: result.data.key,
    signature: result.data.signature,
  };
};

export const signTx = async (tx: string, partialSign: boolean = false): Promise<string> => {
  const result = await Messaging.sendToContent({
    method: METHOD.signTx,
    data: { tx, partialSign, userGesture: navigator.userActivation?.isActive },
  });
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
  return result['data'];
};

export const submitTx = async (tx) => {
  const result = await Messaging.sendToContent({
    method: METHOD.submitTx,
    data: { tx } ,
  });
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

export const btcGetUtxos = async (): Promise<unknown[]> => {
  const result = await Messaging.sendToContent({ method: BITCOIN_METHOD.getUtxos, data: {} });
  if (result['error']) throw result['error'];
  return result['data'];
};

export const btcSignPsbt = async (psbtHex: string, options?: { autoFinalized?: boolean; toSignInputs?: unknown[] }): Promise<string> => {
  const result = await Messaging.sendToContent({
    method: BITCOIN_METHOD.signPsbt,
    data: { psbtHex, options, userGesture: navigator.userActivation?.isActive },
  });
  if (result['error']) throw result['error'];
  return result['data'];
};

export const btcSignPsbts = async (psbtHexs: string[], options?: { autoFinalized?: boolean; toSignInputs?: unknown[] }): Promise<string[]> => {
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
