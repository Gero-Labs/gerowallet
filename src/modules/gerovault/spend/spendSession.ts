/**
 * The spend in progress for each vault of each wallet, kept in this page's memory so the proposer
 * can move from the spend screen to the signatures screen without loading the bundle file again.
 * Keyed by wallet as well as vault: one extension may hold several owners of the same vault, and
 * a signature verified as one wallet's own is not another's. It holds no secret: the bundle and
 * verified signatures only. A reload forgets it; the bundle file and the witness files are what
 * persists, and loading them again gives the same state.
 */
import { shallowReactive } from 'vue';
import type { UnsignedTxBundle } from '@/modules/gerovault/contracts';
import { emptyCollection, type SignatureCollection } from './witnesses';

export interface SpendSession {
  readonly bundle: UnsignedTxBundle;
  readonly collection: SignatureCollection;
  /** Set once the transaction was handed to the chain reader. */
  readonly submittedTxId?: string;
}

const sessions = shallowReactive(new Map<string, SpendSession>());

/** The key of one wallet's session for one vault. */
export function spendSessionKey(walletId: number, vaultId: string): string {
  return `${walletId}:${vaultId}`;
}

export function spendSession(key: string): SpendSession | undefined {
  return sessions.get(key);
}

/** Starts (or keeps) the session of `bundle` under `key`. A different bundle replaces the old one. */
export function startSpendSession(key: string, bundle: UnsignedTxBundle): SpendSession {
  const current = sessions.get(key);
  if (current && current.bundle.txId === bundle.txId) return current;
  const session: SpendSession = { bundle, collection: emptyCollection(bundle) };
  sessions.set(key, session);
  return session;
}

export function updateSpendSession(key: string, patch: Partial<Pick<SpendSession, 'collection' | 'submittedTxId'>>): SpendSession | undefined {
  const current = sessions.get(key);
  if (!current) return undefined;
  if (patch.collection && patch.collection.txId !== current.bundle.txId) return current;
  const next: SpendSession = { ...current, ...patch };
  sessions.set(key, next);
  return next;
}

export function clearSpendSession(key: string): void {
  sessions.delete(key);
}
