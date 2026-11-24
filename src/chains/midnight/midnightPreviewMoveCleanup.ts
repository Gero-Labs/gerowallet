import type Dexie from 'dexie';
import { getDb as getWalletDb } from '@/db/wallet-db';
import { Blockchain } from '@/models/types';
import { midnightActions } from '@/stores/midnightStore';
import { deleteStoreCacheScope } from '@/utils/storeCache';
import { debugLog } from '@/utils/debug';
import { clearMidnightNetworkCheckpoints } from './midnightSyncGeneration';
import { PREVIEW_MOVE_NOTICE_CONFIG_KEY, previewContactAddress, type PreviewMoveStamp } from './midnightPreviewMove';

/**
 * The login half of moving a Stagenet wallet to Preview (midnightPreviewMove.ts).
 *
 * Preview is a new chain: nothing the wallet saw on Stagenet exists there. So,
 * for a record the GeroWalletDatabase v18 upgrade stamped `previewMovePending`,
 * this drops what the old chain left on this device before the wallet starts,
 * and the wallet syncs Preview from empty:
 *
 * - midnightStore's per-wallet state (balances, history, UTxOs, DUST, the sync
 *   cursor), scoped by the Stagenet unshielded address, in memory and in the
 *   `gero-store-cache` IndexedDB;
 * - the wallet SDK checkpoints of Stagenet and Preview (shielded and DUST
 *   state), which are kept per network and keyed by a hash of the seed, so a
 *   network's checkpoints are dropped together; another Preview wallet only
 *   pays a cold sync for it;
 * - the sites connected on Stagenet, which ask again on Preview.
 *
 * Saved contacts' Stagenet addresses become their Preview addresses (the same
 * keys), and the per-wallet config gets the one-time notice that the wallet
 * moved (MidnightPreviewMoveNotice.vue). The stamp goes last, so an interrupted
 * run repeats at the next login. The record is read from the database, never
 * from a request. `db` is the GeroWalletDatabase (`getDb()` of gero-db.ts),
 * passed in so the worker's bundle keeps its existing import order.
 */
export async function applyPendingPreviewMove(db: Dexie, walletId: number): Promise<boolean> {
  const wallet = await db.table('wallets').get(walletId) as
    { chain?: string; previewMovePending?: PreviewMoveStamp } | undefined;
  const stamp = wallet?.previewMovePending;
  if (!stamp || wallet?.chain !== Blockchain.MIDNIGHT) return false;

  const walletDb = await getWalletDb(walletId);
  if (walletDb) await resetWalletTables(walletDb);

  const stagenetUnshielded = typeof stamp.stagenetUnshielded === 'string' ? stamp.stagenetUnshielded : '';
  if (stagenetUnshielded) {
    midnightActions.forgetWallet(stagenetUnshielded);
    await deleteStoreCacheScope(stagenetUnshielded);
  }
  await clearMidnightNetworkCheckpoints('midnight-stagenet');
  await clearMidnightNetworkCheckpoints('midnight-preview');

  await db.table('wallets').update(walletId, { previewMovePending: undefined });
  debugLog('🌙 Midnight wallet moved from Stagenet to Preview: old chain state cleared');
  return true;
}

/** Connected sites cleared, contacts re-encoded, the notice raised: one transaction. */
async function resetWalletTables(walletDb: Dexie): Promise<void> {
  const contacts = walletDb.table('contacts');
  const connected = walletDb.table('connected_dapps');
  const config = walletDb.table('config');
  await walletDb.transaction('rw', [contacts, connected, config], async () => {
    await connected.clear();
    for (const contact of await contacts.toArray() as Array<{ address?: unknown }>) {
      if (typeof contact.address !== 'string') continue;
      const address = previewContactAddress(contact.address);
      if (address === contact.address) continue;
      await contacts.delete(contact.address);
      // A contact already saved under its Preview address keeps that entry.
      if (!(await contacts.get(address))) await contacts.put({ ...contact, address });
    }
    await config.put({ key: PREVIEW_MOVE_NOTICE_CONFIG_KEY, value: true });
  });
}
