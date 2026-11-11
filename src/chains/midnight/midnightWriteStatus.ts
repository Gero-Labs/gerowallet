/**
 * The status read that drives the write gate (midnightWriteGate.ts), and the
 * check the send and registration paths run before they ask for anything.
 */
import { getMidnightApi, type MidnightWriteStatus } from '@/api/midnight-api';
import { CLIENT_UPDATE_REQUIRED, MIDNIGHT_NETWORK_UPGRADING, MidnightApiError } from '@/api/midnightApiError';
import { debugLog } from '@/utils/debug';
import {
  clearMidnightStatusPause, midnightGateKey, midnightWriteBlock, noteMidnightNetworkUpgrading, noteMidnightUpdateRequired,
  noteMidnightWritesOpen,
} from './midnightWriteGate';
import { extensionVersion, isVersionBelow } from './midnightClientVersion';
import { midnightLedgerVersion } from './midnightLedger';

/** The ledger this build signs with on `network`, or null for a network it doesn't know. */
function buildLedger(network: string): number | null {
  try {
    return midnightLedgerVersion(network);
  } catch {
    return null;
  }
}

/**
 * Whether a status read closes sends to this build, and on what evidence:
 * the reason CLIENT_UPDATE_REQUIRED (open or closed), or, only while writes
 * are open, a ledger above the one this build signs with on the network or a
 * minimum extension version above this build. While the server is closed for
 * the network upgrade, a newer ledger or minimum is what the next build will
 * meet, not something an update can fix today: that is "network upgrade".
 * `minVersion` is returned only when the minimum is the sole cause, so the
 * entry stops holding a build that has since updated past it.
 */
export function updateRequiredBy(
  status: Exclude<MidnightWriteStatus, { kind: 'unknown' }>,
  network: string,
  version: string = extensionVersion(),
): { minVersion?: string } | null {
  const ledger = buildLedger(network);
  const byReason = status.reason === CLIENT_UPDATE_REQUIRED;
  const open = status.kind === 'open';
  const byLedger = open && status.ledger !== undefined && ledger !== null && status.ledger > ledger;
  const byVersion = open && !!status.minExtensionVersion && !!version && isVersionBelow(version, status.minExtensionVersion);
  if (byReason || byLedger) return {};
  return byVersion ? { minVersion: status.minExtensionVersion } : null;
}

/** How often a Midnight wallet session re-reads the status. */
export const MIDNIGHT_STATUS_POLL_MS = 5 * 60_000;
/** A read this recent is reused rather than repeated. */
const STATUS_FRESH_MS = 30_000;
/** After a 404 (no status route), how long before this context asks again. */
export const MIDNIGHT_STATUS_UNSUPPORTED_RETRY_MS = 30 * 60_000;

const lastRead = new Map<string, number>();
/** Networks whose server answered 404 for the status route → when to ask again. */
const unsupportedUntil = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

/**
 * Read the server's status for `network` and apply it to the gate. First, does
 * it close sends to this build ({@link updateRequiredBy}): then "update
 * required", which takes precedence. Otherwise `writesOpen:
 * false` with reason NETWORK_UPGRADING (or no reason) pauses the network;
 * `writesOpen: true` opens it. Other reasons are left to their own states. A
 * 404 (no status route) clears a pause an earlier read set, and the network is
 * asked again after {@link MIDNIGHT_STATUS_UNSUPPORTED_RETRY_MS}. A failed read
 * changes nothing. A server that sends no minimum version and no ledger
 * leaves "update required" to the 501's reason.
 */
export function refreshMidnightWriteStatus(network: string, options: { force?: boolean } = {}): Promise<void> {
  const key = midnightGateKey(network);
  if (!key || (unsupportedUntil.get(key) ?? 0) > Date.now()) return Promise.resolve();
  if (!options.force && Date.now() - (lastRead.get(key) ?? 0) < STATUS_FRESH_MS) return Promise.resolve();
  const running = inFlight.get(key);
  if (running) return running;
  const read = (async () => {
    try {
      const status = await getMidnightApi(network).getWriteStatus();
      lastRead.set(key, Date.now());
      if (status.kind === 'unknown') {
        if (status.unsupported) {
          // No status route: a pause an earlier read set has no source any more.
          unsupportedUntil.set(key, Date.now() + MIDNIGHT_STATUS_UNSUPPORTED_RETRY_MS);
          await clearMidnightStatusPause(network);
        }
        return;
      }
      unsupportedUntil.delete(key);
      const update = updateRequiredBy(status, network);
      if (update) {
        await noteMidnightUpdateRequired(network, 'status', update);
      } else if (status.kind === 'open') {
        await noteMidnightWritesOpen(network);
      } else if (!status.reason || status.reason === 'NETWORK_UPGRADING') {
        await noteMidnightNetworkUpgrading(network, 'status');
      }
    } catch (error) {
      debugLog('Midnight write status read failed; the gate is unchanged', error);
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, read);
  return read;
}

/**
 * Throws the readable error when writes on `network` are held: the network
 * upgrade, or "update required". With `refresh`, reads the status first: the
 * one cheap call that lets a shielded send stop before its sync and proving.
 */
export async function assertMidnightWritesOpen(network: string, options: { refresh?: boolean } = {}): Promise<void> {
  if (options.refresh) await refreshMidnightWriteStatus(network);
  const block = await midnightWriteBlock(network);
  if (block === 'updateRequired') {
    throw new MidnightApiError('updateRequired', { errorCode: MIDNIGHT_NETWORK_UPGRADING, reason: CLIENT_UPDATE_REQUIRED }, network);
  }
  if (block === 'networkUpgrading') {
    throw new MidnightApiError('networkUpgrading', { errorCode: MIDNIGHT_NETWORK_UPGRADING }, network);
  }
}

/** Test hook. */
export function resetMidnightWriteStatusForTests(): void {
  lastRead.clear();
  unsupportedUntil.clear();
  inFlight.clear();
}
