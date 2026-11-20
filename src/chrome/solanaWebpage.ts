// Solana dApp connection: page-world bridge to the background (via content.ts's relay),
// used by injectSolana.ts. Bytes cross as plain arrays; errors arrive as Errors with a
// `code` (messaging.ts toPageError → toSolanaPageError).
import { SOLANA_METHOD } from '@/chrome/config';
import { Messaging } from '@/chrome/messaging';
import type { SolanaChainId } from '@/chains/solana/solanaDappProtocol';

interface ContentReply<T> {
  data: T;
}

export interface SolanaConnectedAccount {
  address: string;
  chain: SolanaChainId;
}

/** Whether Gero may offer itself to Solana dApps (the `isSolanaEnabled` flag). */
export const solanaAvailable = async (): Promise<boolean> => {
  const reply = (await Messaging.sendToContent({ method: SOLANA_METHOD.available, data: {} })) as ContentReply<unknown>;
  return reply.data === true;
};

/** Asks to connect; `silent` never prompts and fails unless the site is already connected. */
export const solanaConnect = async (silent: boolean): Promise<SolanaConnectedAccount> => {
  const reply = (await Messaging.sendToContent({
    method: SOLANA_METHOD.connect,
    data: { silent, userGesture: navigator.userActivation?.isActive },
  })) as ContentReply<SolanaConnectedAccount>;
  return reply.data;
};

/** Asks the user to sign the dApp's `transaction`; the transaction with the wallet's signature added. */
export const solanaSignTransaction = async (address: string, transaction: Uint8Array, chain?: string): Promise<Uint8Array> => {
  const reply = (await Messaging.sendToContent({
    method: SOLANA_METHOD.signTransaction,
    data: { address, transaction: Array.from(transaction), chain, userGesture: navigator.userActivation?.isActive },
  })) as ContentReply<{ signedTransaction: number[] }>;
  return new Uint8Array(reply.data.signedTransaction);
};

/** As solanaSignTransaction, then Gero submits it; the transaction's signature (its id). */
export const solanaSignAndSendTransaction = async (address: string, transaction: Uint8Array, chain?: string): Promise<Uint8Array> => {
  const reply = (await Messaging.sendToContent({
    method: SOLANA_METHOD.signAndSendTransaction,
    data: { address, transaction: Array.from(transaction), chain, userGesture: navigator.userActivation?.isActive },
  })) as ContentReply<{ signature: number[] }>;
  return new Uint8Array(reply.data.signature);
};

/** Sign in with Solana: the account, and the exact SIWS message the wallet built and signed. */
export const solanaSignIn = async (input: unknown): Promise<SolanaConnectedAccount & { signedMessage: Uint8Array; signature: Uint8Array }> => {
  const reply = (await Messaging.sendToContent({
    method: SOLANA_METHOD.signIn,
    data: { input, userGesture: navigator.userActivation?.isActive },
  })) as ContentReply<SolanaConnectedAccount & { signedMessage: number[]; signature: number[] }>;
  const { address, chain, signedMessage, signature } = reply.data;
  return { address, chain, signedMessage: new Uint8Array(signedMessage), signature: new Uint8Array(signature) };
};

/** Asks the user to sign `message` with `address`; the 64-byte ed25519 signature. */
export const solanaSignMessage = async (address: string, message: Uint8Array): Promise<Uint8Array> => {
  const reply = (await Messaging.sendToContent({
    method: SOLANA_METHOD.signMessage,
    data: { address, message: Array.from(message), userGesture: navigator.userActivation?.isActive },
  })) as ContentReply<{ signature: number[] }>;
  return new Uint8Array(reply.data.signature);
};
