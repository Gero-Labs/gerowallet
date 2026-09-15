import { getMidnightEndpoints } from './midnightConfig';
import { startMidnightPrivateSync, stopMidnightPrivateSync } from './midnightPrivateSync';

let epoch = 0;
let pending: { walletId: number; network: string; seed: Uint8Array } | undefined;

/** Capture before credential work so a later lock invalidates an in-flight derivation. */
export function midnightPrivateSessionEpoch(): number { return epoch; }

export function prepareMidnightPrivateSession(walletId: number, network: string, seed: Uint8Array, expectedEpoch: number): void {
  if (epoch !== expectedEpoch || network.toLowerCase() !== 'stagenet') return;
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
    await startMidnightPrivateSync({ walletId: String(walletId), network, endpoints, seed: prepared.seed });
  } finally { prepared.seed.fill(0); }
}

export async function clearMidnightPrivateSession(outgoingWalletId?: number): Promise<void> {
  epoch += 1;
  if (pending && (outgoingWalletId === undefined || pending.walletId === outgoingWalletId)) {
    pending.seed.fill(0);
    pending = undefined;
  }
  await stopMidnightPrivateSync();
}
