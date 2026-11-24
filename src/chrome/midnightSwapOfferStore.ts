// The worker's copy of the maker's swap offers (midnightSwapRecords.ts): read
// from and written to the extension's private store, never chrome.storage.local,
// and re-read against the worker's own synced coins on every read. One write
// queue per key, so a status refresh never overwrites a record added a moment
// before.

import { getPrivate, setPrivate } from '@/utils/privateStore';
import {
  midnightSwapRecordsKey, readSwapOfferRecords, refreshSwapOfferRecords, reservedSwapCoins, reservedSwapNullifiers,
  type MidnightSwapCoinView, type MidnightSwapOfferRecord,
} from '@/chains/midnight/midnightSwapRecords';

const queues = new Map<string, Promise<unknown>>();

/** Run `task` after every earlier task on the same key. */
function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.set(key, next);
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
  return next;
}

/** The offers of wallet `walletId` on `network`, with the status to show against `view`; what settled is written back. */
export function loadSwapOffers(network: string, walletId: number, view: MidnightSwapCoinView, now = Date.now()): Promise<MidnightSwapOfferRecord[]> {
  const key = midnightSwapRecordsKey(network, walletId);
  return serialized(key, async () => {
    const stored = readSwapOfferRecords(await getPrivate(key));
    const refreshed = refreshSwapOfferRecords(stored, view, now);
    if (refreshed.changed) await setPrivate(key, refreshed.stored);
    return refreshed.records;
  });
}

/** Add `record` to wallet `walletId`'s offers, or replace the one with its id. */
export function saveSwapOffer(walletId: number, record: MidnightSwapOfferRecord): Promise<void> {
  const key = midnightSwapRecordsKey(record.network, walletId);
  return serialized(key, async () => {
    const stored = readSwapOfferRecords(await getPrivate(key)).filter(r => r.offerId !== record.offerId);
    await setPrivate(key, [record, ...stored]);
  });
}

/** Apply `patch` to the offer with `offerId`; `undefined` when there is none. */
export function updateSwapOffer(
  network: string,
  walletId: number,
  offerId: string,
  patch: Partial<Pick<MidnightSwapOfferRecord, 'status' | 'settledAt' | 'withdrawTxHash' | 'listed'>>,
): Promise<MidnightSwapOfferRecord | undefined> {
  const key = midnightSwapRecordsKey(network, walletId);
  return serialized(key, async () => {
    const stored = readSwapOfferRecords(await getPrivate(key));
    const at = stored.findIndex(r => r.offerId === offerId);
    if (at < 0) return undefined;
    stored[at] = { ...stored[at], ...patch };
    await setPrivate(key, stored);
    return stored[at];
  });
}

/** Coins of wallet `walletId`'s open offers on `network`: kept out of every other spend. */
export async function reservedSwapCoinsFor(network: string, walletId: number, now = Date.now()): Promise<Set<string>> {
  const stored = readSwapOfferRecords(await getPrivate(midnightSwapRecordsKey(network, walletId)));
  return reservedSwapCoins(stored, now);
}

/** Nullifiers of the private coins of wallet `walletId`'s open offers on `network`: a second offer or a take never selects them. */
export async function reservedSwapNullifiersFor(network: string, walletId: number, now = Date.now()): Promise<Set<string>> {
  const stored = readSwapOfferRecords(await getPrivate(midnightSwapRecordsKey(network, walletId)));
  return reservedSwapNullifiers(stored, now);
}
