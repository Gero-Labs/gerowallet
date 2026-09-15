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

import { ref } from 'vue';

/**
 * Bumped on every write to the pending map. `useCnightDustRegistration()` builds its
 * refs PER CALL, so the registration dialog and the holdings-table DUST strip each hold
 * independent state and neither sees the other's updates — the strip kept offering
 * "Set up" after a successful registration until a page reload. Components that render
 * registration state watch this counter and re-read.
 */
export const dustPendingRevision = ref(0);

const KEY = 'gero.dustPending';
/**
 * Relay is ~2.5h, occasionally several hours on mainnet; keep the pending
 * guard generous so a slow relay never re-exposes the register button.
 *
 * This was 6h, chosen when the TTL was the ONLY way a record could ever go
 * away — expiry had to double as failure handling, so it was kept short
 * ("24h was long enough for a single failed/rolled-back submission to read as
 * a full day of phantom REGISTRATION PENDING"). Both reconcilers below now
 * settle a record against chain truth within `DUST_PENDING_GRACE_MS`, so
 * expiry no longer has to guess, and 6h was actively harmful: on a slow
 * mainnet relay the Midnight dashboard dropped its "pending" pill and reverted
 * to a "Register for DUST" prompt hours before `useDustPathB` could see the
 * registration — the window where a real, in-flight registration is invisible
 * on both sides. 18h covers the worst observed relay with margin; a genuinely
 * failed submission still clears ~10 minutes after it was made.
 */
const TTL_MS = 18 * 60 * 60 * 1000;

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
  dustPendingRevision.value += 1;
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

/**
 * Pending registrations whose DUST *destination* is `dustAddress` — i.e. a
 * Cardano wallet was just registered to generate DUST for this Midnight wallet.
 * Lets the Midnight side show "incoming DUST pending" even though the
 * registration is bound to a different (Cardano) stake credential. Expired
 * records are pruned as a side effect.
 */
export function getDustPendingForDestination(dustAddress: string): DustPendingRecord[] {
  if (!dustAddress) return [];
  const all = readAll();
  const now = Date.now();
  const out: DustPendingRecord[] = [];
  let mutated = false;
  for (const [stake, rec] of Object.entries(all)) {
    if (now - rec.submittedAt > TTL_MS) {
      delete all[stake];
      mutated = true;
      continue;
    }
    if (rec.dustAddress === dustAddress) out.push(rec);
  }
  if (mutated) writeAll(all);
  return out;
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

/**
 * Grace period before a pending record is reconciled against the chain. A
 * freshly-submitted tx needs a moment to be indexed, so we only treat "not
 * on-chain" as a failed submission once the record is older than this.
 */
export const DUST_PENDING_GRACE_MS = 10 * 60 * 1000;

/**
 * Reconcile the pending record for `stakeAddress` against on-chain reality so a
 * submission that never landed cannot block re-registration for the full TTL.
 *
 * A `registered=false` from the indexer is ambiguous during the ~2.5h relay —
 * it's the same whether the registration is genuinely relaying or the tx never
 * confirmed. The distinguisher is whether the submitted tx is actually on-chain.
 *
 * `txExists` must resolve `true` (on-chain) / `false` (definitively absent) and
 * THROW when it cannot determine (network error) — on a throw we keep the record
 * rather than risk clearing a valid, still-relaying registration. Returns the
 * surviving record, or null if there was none or it was cleared as phantom.
 */
export async function reconcileDustPending(
  stakeAddress: string,
  txExists: (txHash: string) => Promise<boolean>,
): Promise<DustPendingRecord | null> {
  const rec = getDustPending(stakeAddress);
  if (!rec) return null;
  // Too fresh to judge — the tx may just not be indexed yet.
  if (Date.now() - rec.submittedAt <= DUST_PENDING_GRACE_MS) return rec;
  try {
    if (!(await txExists(rec.txHash))) {
      clearDustPending(stakeAddress);
      return null;
    }
  } catch {
    // Couldn't confirm; keep the record so a valid registration isn't dropped.
  }
  return rec;
}

/**
 * Reconcile EVERY pending record whose *destination* is `dustAddress` against
 * chain reality. This is the destination-keyed counterpart to
 * `reconcileDustPending`: a Midnight dashboard knows its own dust address but
 * not which Cardano stake credential(s) submitted a registration for it, so
 * it can't call the stake-keyed reconciler directly. This walks the whole
 * pending map instead and reconciles every match.
 *
 * Per record, three independent checks can resolve it, in order:
 * - TTL: a record older than `TTL_MS` is dropped outright, same as
 *   `getDustPendingForDestination`'s expiry (this reconciler reads the map
 *   directly via `readAll()` rather than through that getter, so it must
 *   apply the same prune itself or an expired record would never clear here).
 * - `isResolved(stakeAddress, record)`, when supplied, lets the caller assert
 *   the registration already landed on-chain by some other means (e.g. the
 *   stake now shows up in `useDustPathB`'s live-registered set) — checked
 *   next since it needs no network call and no grace window.
 * - Otherwise, the same grace-window + `txExists` check as
 *   `reconcileDustPending`: too-fresh records are left alone, and a record
 *   older than the grace window is dropped once `txExists` definitively
 *   reports the submitted tx never landed. A throw from `txExists` (couldn't
 *   determine) keeps the record, same as the stake-keyed version.
 */
export async function reconcileDustPendingForDestination(
  dustAddress: string,
  txExists: (txHash: string) => Promise<boolean>,
  isResolved?: (stakeAddress: string, record: DustPendingRecord) => boolean,
): Promise<void> {
  if (!dustAddress) return;
  const all = readAll();
  let mutated = false;
  for (const [stakeAddress, rec] of Object.entries(all)) {
    if (rec.dustAddress !== dustAddress) continue;
    if (Date.now() - rec.submittedAt > TTL_MS) {
      delete all[stakeAddress];
      mutated = true;
      continue;
    }
    if (isResolved?.(stakeAddress, rec)) {
      delete all[stakeAddress];
      mutated = true;
      continue;
    }
    // Too fresh to judge — the tx may just not be indexed yet.
    if (Date.now() - rec.submittedAt <= DUST_PENDING_GRACE_MS) continue;
    try {
      if (!(await txExists(rec.txHash))) {
        delete all[stakeAddress];
        mutated = true;
      }
    } catch {
      // Couldn't confirm; keep the record so a valid registration isn't dropped.
    }
  }
  if (mutated) writeAll(all);
}
