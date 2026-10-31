import { BITCOIN_METHOD } from './config';

/**
 * Whether web pages get the Unisat-compatible Bitcoin dApp API: the
 * `window.gero_btc` provider, the Wallet-Standard wallet, the
 * `window.btc_providers` entry and every `BITCOIN_METHOD.*` request.
 * Hard-gated off for 2.7.
 *
 * The single source of truth for that gate. inject.ts reads it to hide the
 * providers, the content relay to keep the methods off its gesture fast path,
 * and the background router to refuse them, so a page posting the raw request
 * message itself gets a refusal too. WalletConnect's bip122 namespace is a
 * separate surface and is not covered by this gate.
 */
export const BITCOIN_DAPP_ENABLED = false;

const BITCOIN_DAPP_METHODS: ReadonlySet<string> = new Set(Object.values(BITCOIN_METHOD));

export function isBitcoinDappMethod(method: unknown): boolean {
  return typeof method === 'string' && BITCOIN_DAPP_METHODS.has(method);
}

/** False for a Bitcoin dApp method while that API is gated off, true for every other method. */
export function isDappMethodAvailable(method: unknown, bitcoinDappEnabled: boolean = BITCOIN_DAPP_ENABLED): boolean {
  return bitcoinDappEnabled || !isBitcoinDappMethod(method);
}
