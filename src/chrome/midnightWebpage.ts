// Midnight DApp Connector — page-context bridge functions. Each wraps a
// `Messaging.sendToContent` round-trip to the content script, which relays
// to background after the per-origin whitelist gate (see messaging.ts
// createProxyController). Mirrors the CIP-30 pattern in `webpage.ts`.
//
// Wire shapes are verified against the ACTUAL published
// `@midnight-ntwrk/dapp-connector-api@4.0.1` package (not just spec prose —
// the internal connector plan §3.1 records two
// places the two disagree).

import { MIDNIGHT_METHOD } from '@/chrome/config';
import { Messaging } from '@/chrome/messaging';
import type {
  ConnectedAPI,
  Configuration,
  ConnectionStatus,
  DesiredOutput,
  HistoryEntry,
  Signature,
  SignDataOptions,
  TokenType,
} from '@midnight-ntwrk/dapp-connector-api';

interface ContentReply<T = unknown> {
  data: T;
  error?: unknown;
}

/** `MIDNIGHT_METHOD.connect`'s own handler performs the approval prompt. */
export const midnightConnect = async (networkId: string): Promise<boolean> => {
  const result = (await Messaging.sendToContent({
    method: MIDNIGHT_METHOD.connect,
    data: { networkId, userGesture: navigator.userActivation?.isActive },
  })) as ContentReply<boolean>;
  return result.data;
};

export const midnightGetShieldedBalances = async (): Promise<Record<TokenType, bigint>> => {
  const result = (await Messaging.sendToContent({
    method: MIDNIGHT_METHOD.getShieldedBalances,
    data: {},
  })) as ContentReply<Record<TokenType, string>>;
  return bigintRecord(result.data);
};

export const midnightGetUnshieldedBalances = async (): Promise<Record<TokenType, bigint>> => {
  const result = (await Messaging.sendToContent({
    method: MIDNIGHT_METHOD.getUnshieldedBalances,
    data: {},
  })) as ContentReply<Record<TokenType, string>>;
  return bigintRecord(result.data);
};

export const midnightGetDustBalance = async (): Promise<{ cap: bigint; balance: bigint }> => {
  const result = (await Messaging.sendToContent({
    method: MIDNIGHT_METHOD.getDustBalance,
    data: {},
  })) as ContentReply<{ cap: string; balance: string }>;
  return { cap: BigInt(result.data.cap), balance: BigInt(result.data.balance) };
};

export const midnightGetShieldedAddresses = async (): Promise<{
  shieldedAddress: string;
  shieldedCoinPublicKey: string;
  shieldedEncryptionPublicKey: string;
}> => {
  const result = (await Messaging.sendToContent({
    method: MIDNIGHT_METHOD.getShieldedAddresses,
    data: {},
  })) as ContentReply<{
    shieldedAddress: string;
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
  }>;
  return result.data;
};

export const midnightGetUnshieldedAddress = async (): Promise<{ unshieldedAddress: string }> => {
  const result = (await Messaging.sendToContent({
    method: MIDNIGHT_METHOD.getUnshieldedAddress,
    data: {},
  })) as ContentReply<{ unshieldedAddress: string }>;
  return result.data;
};

export const midnightGetDustAddress = async (): Promise<{ dustAddress: string }> => {
  const result = (await Messaging.sendToContent({
    method: MIDNIGHT_METHOD.getDustAddress,
    data: {},
  })) as ContentReply<{ dustAddress: string }>;
  return result.data;
};

export const midnightGetTxHistory = async (
  pageNumber: number,
  pageSize: number,
): Promise<HistoryEntry[]> => {
  const result = (await Messaging.sendToContent({
    method: MIDNIGHT_METHOD.getTxHistory,
    data: { pageNumber, pageSize },
  })) as ContentReply<HistoryEntry[]>;
  return result.data;
};

export const midnightGetConfiguration = async (): Promise<Configuration> => {
  const result = (await Messaging.sendToContent({
    method: MIDNIGHT_METHOD.getConfiguration,
    data: {},
  })) as ContentReply<Configuration>;
  return result.data;
};

export const midnightGetConnectionStatus = async (): Promise<ConnectionStatus> => {
  const result = (await Messaging.sendToContent({
    method: MIDNIGHT_METHOD.getConnectionStatus,
    data: {},
  })) as ContentReply<ConnectionStatus>;
  return result.data;
};

/**
 * Submit `tx` to the network, using the wallet as a relayer. `tx` is expected
 * to be balanced + signed; GeroWallet proves + binds it server-side on submit
 * (Nexus `/tx/finalize`), so it accepts the unproven output of `makeTransfer`
 * as well as an already-sealed tx.
 */
export const midnightSubmitTransaction = async (tx: string): Promise<void> => {
  const result = (await Messaging.sendToContent({
    method: MIDNIGHT_METHOD.submitTransaction,
    data: { tx, userGesture: navigator.userActivation?.isActive },
  })) as ContentReply<undefined>;
  void result;
};

export const midnightSignData = async (
  data: string,
  options: SignDataOptions,
): Promise<Signature> => {
  const result = (await Messaging.sendToContent({
    method: MIDNIGHT_METHOD.signData,
    data: { data, options, userGesture: navigator.userActivation?.isActive },
  })) as ContentReply<Signature>;
  return result.data;
};

/**
 * Build a native-NIGHT unshielded transfer to the desired outputs and return
 * the serialized tx. The returned `tx` is balanced + signed but NOT proven —
 * GeroWallet proves + binds server-side on submit, so it is only submittable
 * through GeroWallet's own `submitTransaction`. Phase 2 supports
 * `kind:'unshielded'` native NIGHT only; shielded/mixed outputs and
 * `payFees:false` reject with InvalidRequest.
 */
export const midnightMakeTransfer = async (
  desiredOutputs: DesiredOutput[],
  options?: { payFees?: boolean },
): Promise<{ tx: string }> => {
  const result = (await Messaging.sendToContent({
    method: MIDNIGHT_METHOD.makeTransfer,
    data: {
      // Chrome messaging can't carry BigInt — send each value as a decimal string.
      desiredOutputs: desiredOutputs.map((o) => ({ ...o, value: o.value.toString() })),
      options,
      userGesture: navigator.userActivation?.isActive,
    },
  })) as ContentReply<{ tx: string }>;
  return result.data;
};

export const midnightHintUsage = async (
  methodNames: Array<keyof ConnectedAPI>,
): Promise<void> => {
  const result = (await Messaging.sendToContent({
    method: MIDNIGHT_METHOD.hintUsage,
    data: { methodNames },
  })) as ContentReply<undefined>;
  void result;
};

/** Chrome messaging can't carry BigInt — background sends decimal strings. */
function bigintRecord(raw: Record<string, string>): Record<TokenType, bigint> {
  const out: Record<TokenType, bigint> = {};
  for (const [k, v] of Object.entries(raw ?? {})) out[k] = BigInt(v);
  return out;
}

// Phase 2/3 (not yet implemented server-side — see build plan §4):
// makeTransfer, makeIntent, balanceUnsealedTransaction,
// balanceSealedTransaction, getProvingProvider.
