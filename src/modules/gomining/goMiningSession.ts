/**
 * Linking a Gero Bitcoin wallet to its GoMining account.
 *
 * The wallet signs `goMiningLinkMessage` with BIP-322 at its first receive address
 * (`m/purpose'/coin'/account'/0/0`, the record's `baseAddress`), the key
 * `WalletBg.signBitcoinDappMessage` signs with. gero-backend checks the signature,
 * derives the GoMining partner user id from that address and returns a session
 * token, which is kept here in `chrome.storage.session`: memory only, gone when
 * the browser closes, unreadable from content scripts. Outside the extension (the
 * web build, tests) it lives in this module's memory.
 */

import { Blockchain, WalletType } from '@/models/types';
import type { GoMiningConfig, GoMiningSession } from '@/api/gomining-api';

/** Why a wallet cannot use GoMining; null when it can. */
export type GoMiningUnsupportedReason = 'chain' | 'walletType' | 'addressType' | 'network';

export interface GoMiningWalletFacts {
  chain?: string;
  network?: string;
  type?: string;
  addressType?: string;
  baseAddress?: string;
}

/**
 * Only software Bitcoin wallets sign messages in Gero, and the BIP-322 signer
 * proves a P2WPKH or P2TR output, so legacy addresses cannot link. The backend
 * links and takes payments on one Bitcoin network; any other is refused before
 * anything is signed, so a testnet address is never bound to a production account.
 */
export function goMiningUnsupportedReason(wallet: GoMiningWalletFacts | null | undefined, config: Pick<GoMiningConfig, 'bitcoinNetwork'>): GoMiningUnsupportedReason | null {
  if (!wallet || wallet.chain !== Blockchain.BITCOIN) return 'chain';
  if (wallet.type !== WalletType.Normal || !wallet.baseAddress) return 'walletType';
  if (wallet.addressType !== 'segwit' && wallet.addressType !== 'taproot') return 'addressType';
  if (wallet.network !== config.bitcoinNetwork) return 'network';
  return null;
}

/** Hex nonces only, so a reply can never put other words in the signed message. */
const NONCE = /^[0-9a-f]{32,128}$/i;

/** The exact text signed to link. gero-backend rebuilds it byte for byte. */
export function goMiningLinkMessage(address: string, nonce: string): string {
  if (!NONCE.test(nonce)) throw new Error('Invalid GoMining challenge');
  return `Gero Wallet: link this Bitcoin address to GoMining.\nAddress: ${address}\nNonce: ${nonce}`;
}

interface StoredSession extends GoMiningSession {
  address: string;
  network: string;
}

const KEY_PREFIX = 'gomining.session.';
/** A token this close to expiry is treated as expired, so no request leaves with it. */
const EXPIRY_MARGIN_MS = 60_000;

const memory = new Map<string, StoredSession>();

function sessionArea(): chrome.storage.StorageArea | null {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id && chrome.storage?.session ? chrome.storage.session : null;
}

function isStoredSession(value: unknown): value is StoredSession {
  const v = value as Partial<StoredSession> | null;
  return !!v && typeof v.token === 'string' && !!v.token && typeof v.expiresAt === 'number'
    && typeof v.address === 'string' && typeof v.network === 'string';
}

/** The session for this wallet's address and network, unless it is missing or about to expire. */
export async function readGoMiningSession(walletId: number, address: string, network: string, now = Date.now()): Promise<GoMiningSession | null> {
  const key = `${KEY_PREFIX}${walletId}`;
  const area = sessionArea();
  const stored = area ? (await area.get(key))[key] : memory.get(key);
  if (!isStoredSession(stored)) return null;
  if (stored.address !== address || stored.network !== network || stored.expiresAt - EXPIRY_MARGIN_MS <= now) {
    await clearGoMiningSession(walletId);
    return null;
  }
  return { token: stored.token, expiresAt: stored.expiresAt };
}

export async function writeGoMiningSession(walletId: number, session: GoMiningSession, address: string, network: string): Promise<void> {
  const key = `${KEY_PREFIX}${walletId}`;
  const stored: StoredSession = { ...session, address, network };
  const area = sessionArea();
  if (area) await area.set({ [key]: stored });
  else memory.set(key, stored);
}

export async function clearGoMiningSession(walletId: number): Promise<void> {
  const key = `${KEY_PREFIX}${walletId}`;
  const area = sessionArea();
  if (area) await area.remove(key);
  else memory.delete(key);
}
