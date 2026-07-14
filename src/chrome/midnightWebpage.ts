// Midnight DApp Connector — page-context bridge functions. Each wraps a
// `Messaging.sendToContent` round-trip to the content script, which relays
// to background after the per-origin whitelist gate (see messaging.ts
// createProxyController). Mirrors the CIP-30 pattern in `webpage.ts`.
//
// Wire shapes are verified against the ACTUAL published
// `@midnight-ntwrk/dapp-connector-api@4.0.1` package (not just spec prose —
// see docs/midnight/2026-07-09-midnight-dapp-connector-plan.md §3.1 for two
// places the two disagree).

import { MIDNIGHT_METHOD } from '@/chrome/config';
import { Messaging } from '@/chrome/messaging';
import type {
  ConnectedAPI,
  Configuration,
  ConnectionStatus,
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
 * `tx` is expected to already be balanced + sealed (proofs, signatures,
 * cryptographic binding) — the connector is a relayer here, not a builder.
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
