import { getMidnightEndpoints } from './midnightConfig';
import { resolveMidnightChain } from './midnightChainLedger';
import { debugLog } from '@/utils/debug';
import { startMidnightPrivateSync, stopMidnightPrivateSync } from './midnightPrivateSync';

let epoch = 0;
let pending: { walletId: number; network: string; seed: Uint8Array } | undefined;
/** Which loop `activateMidnightPrivateSession` last started, so `clear` stops the right one. */
let activeLedger: 8 | 9 | undefined;

/** Capture before credential work so a later lock invalidates an in-flight derivation. */
export function midnightPrivateSessionEpoch(): number { return epoch; }

/**
 * Which private-sync loop serves `network`, from what its chain reports: a
 * chain on ledger 8 has `midnightPrivateSync8.ts`; a chain on ledger 9 has
 * `midnightPrivateSync.ts`, with wallet SDK 2's fork-aware wallet when the
 * chain crossed the upgrade (mainnet, preprod: ledger 8 history first,
 * #1452 M9). A network whose chain can't be read has none.
 */
async function privateSyncLedger(network: string): Promise<{ ledger: 8 | 9; forking: boolean } | undefined> {
  try {
    const chain = await resolveMidnightChain(network);
    if (chain.ledger === 8) return { ledger: 8, forking: false };
    // A chain that crossed the upgrade has ledger 8 history: the fork-aware wallet reads both.
    return { ledger: 9, forking: !chain.bornOnLedger9 };
  } catch (error) {
    debugLog('Midnight private sync: the chain\'s ledger could not be read', error);
    return undefined;
  }
}

export function prepareMidnightPrivateSession(walletId: number, network: string, seed: Uint8Array, expectedEpoch: number): void {
  if (epoch !== expectedEpoch || !getMidnightEndpoints(network)) return;
  pending?.seed.fill(0);
  pending = { walletId, network, seed: new Uint8Array(seed) };
}

/** Called only after the matching wallet is logged in and unlocked. */
export async function activateMidnightPrivateSession(walletId: number, network: string): Promise<void> {
  if (!pending || pending.walletId !== walletId || pending.network !== network) return;
  const prepared = pending;
  pending = undefined;
  const sessionEpoch = epoch;
  try {
    const endpoints = getMidnightEndpoints(network);
    if (!endpoints) return;
    const args = { walletId: String(walletId), network, endpoints, seed: prepared.seed };
    const route = await privateSyncLedger(network);
    // A lock or wallet switch while the chain was read clears the session.
    if (pending !== undefined || epoch !== sessionEpoch) return;
    if (route === undefined) return;
    if (route.ledger === 9) {
      activeLedger = 9;
      await startMidnightPrivateSync({ ...args, forking: route.forking });
    } else {
      // Lazy: the ledger-8 loop pulls in the stores, which the ledger-9 path
      // and its callers never need at import time.
      activeLedger = 8;
      const { startMidnightPrivateSync8 } = await import('./midnightPrivateSync8');
      await startMidnightPrivateSync8(args);
    }
  } finally { prepared.seed.fill(0); }
}

export async function clearMidnightPrivateSession(outgoingWalletId?: number): Promise<void> {
  epoch += 1;
  if (pending && (outgoingWalletId === undefined || pending.walletId === outgoingWalletId)) {
    pending.seed.fill(0);
    pending = undefined;
  }
  const ledgerToStop = activeLedger;
  activeLedger = undefined;
  await stopMidnightPrivateSync();
  if (ledgerToStop === 8) {
    const { stopMidnightPrivateSync8 } = await import('./midnightPrivateSync8');
    await stopMidnightPrivateSync8();
  }
}
