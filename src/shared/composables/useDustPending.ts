/**
 * Local record of DUST registrations we've submitted but the Midnight indexer
 * hasn't confirmed yet. The mapping takes ~2.5h to relay, and `/dust/status`
 * keeps returning `Unregistered` the whole time — so without this the UI would
 * re-offer "register" and let the user submit a duplicate (and pay a second
 * network fee) during the relay window.
 *
 * Keyed by the Cardano stake (reward) address, since that is the credential a
 * DUST registration is bound to. Records auto-expire; a confirmed `Registered`
 * status clears them.
 */

const KEY = 'gero.dustPending';
/** Relay is ~2.5h; keep the pending guard generous so a slow relay never
 *  re-exposes the register button, but expire eventually so a failed/rolled-back
 *  submission doesn't block forever. */
const TTL_MS = 24 * 60 * 60 * 1000;

export interface DustPendingRecord {
  dustAddress: string;
  txHash: string;
  submittedAt: number;
}

function readAll(): Record<string, DustPendingRecord> {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, DustPendingRecord>;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, DustPendingRecord>): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(map));
}

/** Record a just-submitted registration/redirect for `stakeAddress`. */
export function markDustPending(stakeAddress: string, dustAddress: string, txHash: string): void {
  if (!stakeAddress) return;
  const all = readAll();
  all[stakeAddress] = { dustAddress, txHash, submittedAt: Date.now() };
  writeAll(all);
}

/** The un-expired pending record for `stakeAddress`, or null. */
export function getDustPending(stakeAddress: string): DustPendingRecord | null {
  if (!stakeAddress) return null;
  const all = readAll();
  const rec = all[stakeAddress];
  if (!rec) return null;
  if (Date.now() - rec.submittedAt > TTL_MS) {
    delete all[stakeAddress];
    writeAll(all);
    return null;
  }
  return rec;
}

/** Clear the pending record — call once the indexer confirms `Registered`. */
export function clearDustPending(stakeAddress: string): void {
  if (!stakeAddress) return;
  const all = readAll();
  if (all[stakeAddress]) {
    delete all[stakeAddress];
    writeAll(all);
  }
}
