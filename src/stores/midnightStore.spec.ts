// What survives a Midnight wallet switch, and what must not.
//
// `setActive` wipes per-wallet state so the previous wallet's balance and UTxO
// set can't linger behind the new one. The chain tip was swept up in that wipe,
// but a tip is a fact about the NETWORK: two wallets on mainnet see the same
// block. Clearing it left the network tooltip reading "Block: N/A" until the
// first tip event arrived.
//
// The line these cases hold is the other half. A tip from ANOTHER network is not
// merely stale, it is wrong — a testnet height rendered under a mainnet wallet.
// So retention is gated on the address HRP, and these cases exist to keep that
// gate from quietly widening.
import { describe, it, expect, beforeEach } from 'vitest';
import { midnightStore, midnightActions, hydratePrivateSyncProgress, hydratePrivateSyncStatus } from './midnightStore';
import type { MidnightAddresses } from '@/chains/midnight/midnightTypes';

/** A bech32m unshielded address; the data part deliberately carries no `1`. */
const addr = (hrp: string, body: string): MidnightAddresses =>
  ({ dust: '', shielded: '', unshielded: `${hrp}1${body}` }) as MidnightAddresses;

// The real HRPs: background.ts builds `mn_addr1…` for mainnet and
// `mn_addr_<network>1…` for every other Network member (stagenet/preprod/testnet).
const MAINNET_A = addr('mn_addr', 'apsqqzzwwvvee');
const MAINNET_B = addr('mn_addr', 'zzqqwwvvsspp');
const STAGENET = addr('mn_addr_stagenet', 'apsqqzzwwvvee');
const PREPROD = addr('mn_addr_preprod', 'apsqqzzwwvvee');
const TESTNET = addr('mn_addr_testnet', 'zzqqwwvvsspp');

const TIP = { hash: 'block-hash', height: 4321, timestamp: 1_756_000_000_000 };

/** Put the store on `from` with a known tip, then switch to `to`. */
function switchFrom(from: MidnightAddresses, to: MidnightAddresses) {
  midnightActions.setActive(from);
  midnightActions.applyTipUpdate({ ...TIP });
  midnightActions.setActive(to);
}

describe('midnight wallet switch: chain tip', () => {
  it('retains the explicit device prover profile when switching wallet networks', () => {
    const original = { ...midnightStore.proofServer };
    try {
      midnightActions.setProofServer({ ...original, localProfile: 'stagenet' });
      switchFrom(STAGENET, MAINNET_A);
      expect(midnightStore.proofServer.localProfile).toBe('stagenet');
    } finally { midnightActions.setProofServer(original); }
  });
  beforeEach(() => {
    midnightStore.activeWalletKey = null;
    midnightStore.tip = { hash: null, height: 0, timestamp: 0 };
  });

  it('keeps the tip when both wallets are on the same network', () => {
    switchFrom(MAINNET_A, MAINNET_B);
    expect(midnightStore.tip).toEqual(TIP);
  });

  it('clears the tip when the network changes', () => {
    // A mainnet height must never render under a testnet wallet, or the reverse.
    for (const [from, to] of [
      [MAINNET_A, STAGENET],
      [STAGENET, MAINNET_A],
      [STAGENET, PREPROD],
      [PREPROD, TESTNET],
    ] as const) {
      midnightStore.activeWalletKey = null;
      switchFrom(from, to);
      expect(midnightStore.tip.height).toBe(0);
      expect(midnightStore.tip.hash).toBeNull();
    }
  });

  it('does not treat mainnet as a prefix of a testnet', () => {
    // `mn_addr` is a literal prefix of `mn_addr_preview`, so a startsWith-style
    // comparison would call these the same network and leak a mainnet tip onto
    // preview. The HRPs are compared whole.
    switchFrom(MAINNET_A, STAGENET);
    expect(midnightStore.tip.height).toBe(0);
  });

  it('keeps the tip between two wallets on the same testnet', () => {
    switchFrom(STAGENET, addr('mn_addr_stagenet', 'zzqqwwvvsspp'));
    expect(midnightStore.tip).toEqual(TIP);
  });

  it('leaves the tip alone when the same wallet is re-activated', () => {
    // Not a switch at all — no wipe runs, so nothing to gate.
    midnightActions.setActive(MAINNET_A);
    midnightActions.applyTipUpdate({ ...TIP });
    midnightActions.setActive(MAINNET_A);
    expect(midnightStore.tip).toEqual(TIP);
  });

  it('still wipes the per-wallet state it was always wiping', () => {
    // Retaining the tip must not turn into retaining the balance.
    switchFrom(MAINNET_A, MAINNET_B);
    expect(midnightStore.transactions).toEqual([]);
    expect(midnightStore.utxos).toEqual([]);
    expect(midnightStore.lastMidnightTxId).toBeNull();
    expect(midnightStore.lastSync).toBeNull();
  });
});

// The dashboard hydrates its store copy from chrome.storage on cold start. The
// private-note scan can start and finish while no dashboard is open (the side
// panel's dApp prompt starts it), so the status and counters must come back
// from storage too, or the "Private tokens" section boots at `idle` and asks
// the user to unlock a scan that already completed.
describe('private sync hydration (dashboard cold start)', () => {
  it('keeps a known status and boots as idle for anything else', () => {
    expect(hydratePrivateSyncStatus('synced')).toBe('synced');
    expect(hydratePrivateSyncStatus('syncing')).toBe('syncing');
    expect(hydratePrivateSyncStatus('error')).toBe('error');
    expect(hydratePrivateSyncStatus(undefined)).toBe('idle');
    expect(hydratePrivateSyncStatus('done')).toBe('idle');
  });

  it('keeps only well-formed progress counters', () => {
    expect(hydratePrivateSyncProgress({ applied: 5, highest: 9, connected: true })).toEqual({ applied: 5, highest: 9, connected: true });
    expect(hydratePrivateSyncProgress({ applied: 5, highest: 9 })).toEqual({ applied: 5, highest: 9, connected: false });
    expect(hydratePrivateSyncProgress({ applied: '5', highest: 9 })).toBeNull();
    expect(hydratePrivateSyncProgress(null)).toBeNull();
    expect(hydratePrivateSyncProgress(undefined)).toBeNull();
  });
});

// resetChainState runs on every chain-identity change, including the first
// sync after a service-worker restart. It starts no private scan, so it must
// not report one: a PassKey wallet would otherwise show "Synchronizing private
// notes…" with no counter forever, and the connector prompt would offer
// "Share when done" instead of the unlock.
describe('resetChainState and the private scan', () => {
  it('does not claim a private scan is running', () => {
    midnightStore.privateSyncStatus = 'synced';
    midnightStore.privateSyncProgress = { applied: 1, highest: 2, connected: true };
    midnightActions.resetChainState({ network: 'midnight-preprod', generation: 2, genesisHash: 'abc' } as Parameters<typeof midnightActions.resetChainState>[0]);
    expect(midnightStore.privateSyncStatus).toBe('idle');
    expect(midnightStore.privateSyncProgress).toBeNull();
  });
});
