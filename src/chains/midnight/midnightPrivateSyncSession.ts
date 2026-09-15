import { getMidnightEndpoints } from './midnightConfig';
import { midnightLedgerVersion } from './midnightLedger';
import { startMidnightPrivateSync, stopMidnightPrivateSync } from './midnightPrivateSync';

let epoch = 0;
let pending: { walletId: number; network: string; seed: Uint8Array } | undefined;
/** Which loop `activateMidnightPrivateSession` last started, so `clear` stops the right one. */
let activeLedger: 8 | 9 | undefined;

/** Capture before credential work so a later lock invalidates an in-flight derivation. */
export function midnightPrivateSessionEpoch(): number { return epoch; }

/**
 * Which private-sync loop serves `network`: ledger 9 (Stagenet) has
 * `midnightPrivateSync.ts`, ledger 8 (Preprod, Mainnet) has
 * `midnightPrivateSync8.ts`; anything else has no private sync.
 */
function privateSyncLedger(network: string): 8 | 9 | undefined {
  try { return midnightLedgerVersion(network); } catch { return undefined; }
}

export function prepareMidnightPrivateSession(walletId: number, network: string, seed: Uint8Array, expectedEpoch: number): void {
  if (epoch !== expectedEpoch || privateSyncLedger(network) === undefined) return;
  pending?.seed.fill(0);
  pending = { walletId, network, seed: new Uint8Array(seed) };
}

/** Called only after the matching wallet is logged in and unlocked. */
export async function activateMidnightPrivateSession(walletId: number, network: string): Promise<void> {
  if (!pending || pending.walletId !== walletId || pending.network !== network) return;
  const prepared = pending;
  pending = undefined;
  try {
    const endpoints = getMidnightEndpoints(network);
    if (!endpoints) return;
    const args = { walletId: String(walletId), network, endpoints, seed: prepared.seed };
    if (privateSyncLedger(network) === 9) {
      activeLedger = 9;
      await startMidnightPrivateSync(args);
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
