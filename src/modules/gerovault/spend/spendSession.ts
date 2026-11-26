/**
 * The spend in progress for each vault, kept in this page's memory so the proposer can move from
 * the spend screen to the signatures screen without loading the bundle file again. It holds no
 * secret: the bundle and verified signatures only. A reload forgets it; the bundle file and the
 * witness files are what persists, and loading them again gives the same state.
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

export function spendSession(vaultId: string): SpendSession | undefined {
  return sessions.get(vaultId);
}

/** Starts (or restarts) the session of `bundle`'s vault. A different bundle replaces the old one. */
export function startSpendSession(bundle: UnsignedTxBundle): SpendSession {
  const current = sessions.get(bundle.vaultId);
  if (current && current.bundle.txId === bundle.txId) return current;
  const session: SpendSession = { bundle, collection: emptyCollection(bundle) };
  sessions.set(bundle.vaultId, session);
  return session;
}

export function updateSpendSession(vaultId: string, patch: Partial<Pick<SpendSession, 'collection' | 'submittedTxId'>>): SpendSession | undefined {
  const current = sessions.get(vaultId);
  if (!current) return undefined;
  if (patch.collection && patch.collection.txId !== current.bundle.txId) return current;
  const next: SpendSession = { ...current, ...patch };
  sessions.set(vaultId, next);
  return next;
}

export function clearSpendSession(vaultId: string): void {
  sessions.delete(vaultId);
}
