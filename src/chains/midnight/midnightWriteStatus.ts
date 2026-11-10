/**
 * The status read that drives the write gate (midnightWriteGate.ts), and the
 * check the send and registration paths run before they ask for anything.
 */
import { getMidnightApi } from '@/api/midnight-api';
import { MIDNIGHT_NETWORK_UPGRADING, MidnightApiError } from '@/api/midnightApiError';
import { debugLog } from '@/utils/debug';
import { isMidnightNetworkUpgrading, midnightGateKey, noteMidnightNetworkUpgrading, noteMidnightWritesOpen } from './midnightWriteGate';

/** How often a Midnight wallet session re-reads the status. */
export const MIDNIGHT_STATUS_POLL_MS = 5 * 60_000;
/** A read this recent is reused rather than repeated. */
const STATUS_FRESH_MS = 30_000;

const lastRead = new Map<string, number>();
/** Networks whose server has no status route: not asked again in this context. */
const unsupported = new Set<string>();
const inFlight = new Map<string, Promise<void>>();

/**
 * Read the server's status for `network` and apply it to the gate. `writesOpen:
 * false` with reason NETWORK_UPGRADING (or no reason) pauses the network;
 * `writesOpen: true` opens it. Other reasons are left to their own states. A
 * failed or missing read changes nothing.
 */
export function refreshMidnightWriteStatus(network: string, options: { force?: boolean } = {}): Promise<void> {
  const key = midnightGateKey(network);
  if (!key || unsupported.has(key)) return Promise.resolve();
  if (!options.force && Date.now() - (lastRead.get(key) ?? 0) < STATUS_FRESH_MS) return Promise.resolve();
  const running = inFlight.get(key);
  if (running) return running;
  const read = (async () => {
    try {
      const status = await getMidnightApi(network).getWriteStatus();
      lastRead.set(key, Date.now());
      if (status.kind === 'unknown') {
        if (status.unsupported) unsupported.add(key);
        return;
      }
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
  unsupported.clear();
  inFlight.clear();
}
