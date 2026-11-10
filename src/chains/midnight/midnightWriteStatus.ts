/**
 * The status read that drives the write gate (midnightWriteGate.ts), and the
 * check the send and registration paths run before they ask for anything.
 */
import { getMidnightApi } from '@/api/midnight-api';
import { MIDNIGHT_NETWORK_UPGRADING, MidnightApiError } from '@/api/midnightApiError';
import { debugLog } from '@/utils/debug';
import {
  clearMidnightStatusPause, isMidnightNetworkUpgrading, midnightGateKey, noteMidnightNetworkUpgrading, noteMidnightWritesOpen,
} from './midnightWriteGate';

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
 * Read the server's status for `network` and apply it to the gate. `writesOpen:
 * false` with reason NETWORK_UPGRADING (or no reason) pauses the network;
 * `writesOpen: true` opens it. Other reasons are left to their own states. A
 * 404 (no status route) clears a pause an earlier read set, and the network is
 * asked again after {@link MIDNIGHT_STATUS_UNSUPPORTED_RETRY_MS}. A failed read
 * changes nothing.
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
      if (status.kind === 'open') {
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
 * Throws the readable network upgrade error when `network` is paused. With
 * `refresh`, reads the status first: the one cheap call that lets a shielded
 * send stop before its sync and proving.
 */
export async function assertMidnightWritesOpen(network: string, options: { refresh?: boolean } = {}): Promise<void> {
  if (options.refresh) await refreshMidnightWriteStatus(network);
  if (await isMidnightNetworkUpgrading(network)) {
    throw new MidnightApiError('networkUpgrading', { errorCode: MIDNIGHT_NETWORK_UPGRADING }, network);
  }
}

/** Test hook. */
export function resetMidnightWriteStatusForTests(): void {
  lastRead.clear();
  unsupportedUntil.clear();
  inFlight.clear();
}
