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
import { midnightStore, midnightActions, hydrateChainIdentity, hydratePrivateSyncProgress, hydratePrivateSyncStatus, hydrateProofServer } from './midnightStore';
import type { MidnightAddresses, MidnightTransaction } from '@/chains/midnight/midnightTypes';

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
      midnightActions.setProofServer({ ...original, localUrlLedger9: 'http://localhost:6399' });
      switchFrom(STAGENET, MAINNET_A);
      expect(midnightStore.proofServer.localUrlLedger9).toBe('http://localhost:6399');
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

// The background restores the chain identity after a service-worker restart;
// without it the first sync message reads as a generation change and the
// private-note checkpoints are wiped (a full rescan after every reload).
describe('chain identity hydration (background restart)', () => {
  const identity = { network: 'midnight-preprod', generation: 3, genesisHash: `0x${'ab'.repeat(32)}` };

  it('keeps an exact, well-formed identity', () => {
    expect(hydrateChainIdentity(identity)).toEqual(identity);
  });

  it('drops anything that is not the persisted shape', () => {
    expect(hydrateChainIdentity(null)).toBeNull();
    expect(hydrateChainIdentity({ ...identity, network: 'cardano-mainnet' })).toBeNull();
    expect(hydrateChainIdentity({ ...identity, generation: 0 })).toBeNull();
    expect(hydrateChainIdentity({ ...identity, generation: '3' })).toBeNull();
    expect(hydrateChainIdentity({ ...identity, genesisHash: 'abc' })).toBeNull();
    expect(hydrateChainIdentity({ ...identity, genesisHash: `0x${'AB'.repeat(32)}` })).toBeNull();
  });
});

// The site-activity record is what mini-Gero's tracker renders; the store
// only folds events through the pure reducer and clears it on a wallet switch.
describe('site activity', () => {
  it('records events into one replaceable record and clears it on a wallet switch', () => {
    midnightStore.siteActivity = null;
    midnightActions.recordSiteActivity('https://dapp.example', { type: 'prove-start' });
    midnightActions.recordSiteActivity('https://dapp.example', { type: 'prove-done' });
    expect(midnightStore.siteActivity).toMatchObject({ origin: 'https://dapp.example', step: 'proving', circuitsStarted: 1, circuitsDone: 1 });
    midnightStore.activeWalletKey = null;
    switchFrom(MAINNET_A, MAINNET_B);
    expect(midnightStore.siteActivity).toBeNull();
    midnightActions.recordSiteActivity('https://dapp.example', { type: 'funding' });
    expect(midnightStore.siteActivity?.step).toBe('funding');
    midnightActions.clearSiteActivity();
    expect(midnightStore.siteActivity).toBeNull();
  });
});

describe('proof server hydration: one local URL per ledger', () => {
  const LEDGER8 = 'http://localhost:6300';
  const LEDGER9 = 'http://localhost:6301';

  it('defaults both ledger URLs when nothing is stored', () => {
    const ps = hydrateProofServer(undefined);
    expect(ps.localUrl).toBe(LEDGER8);
    expect(ps.localUrlLedger9).toBe(LEDGER9);
  });

  it('keeps a stored ledger-9 URL and ignores the retired localProfile once the new field exists', () => {
    const ps = hydrateProofServer({ mode: 'local', localUrl: LEDGER8, localUrlLedger9: 'http://localhost:7000', localProfile: 'stagenet' });
    expect(ps.localUrl).toBe(LEDGER8);
    expect(ps.localUrlLedger9).toBe('http://localhost:7000');
  });

  it('migrates a stored "stagenet" profile: that server moves to the ledger-9 slot', () => {
    // Before this field, localProfile: 'stagenet' meant "the server at
    // localUrl is ledger 9". Keep serving that user's stagenet sends from the
    // same server; the ledger-8 slot returns to its default, where a missing
    // server now reads as "not detected" for THAT network.
    const ps = hydrateProofServer({ mode: 'local', localUrl: 'http://localhost:6300', localProfile: 'stagenet' });
    expect(ps.localUrlLedger9).toBe('http://localhost:6300');
    expect(ps.localUrl).toBe(LEDGER8);
  });

  it('leaves a stored "legacy" profile alone: the server stays in the ledger-8 slot', () => {
    const ps = hydrateProofServer({ mode: 'local', localUrl: 'http://localhost:6400', localProfile: 'legacy' });
    expect(ps.localUrl).toBe('http://localhost:6400');
    expect(ps.localUrlLedger9).toBe(LEDGER9);
  });

  it('falls back to the ledger-9 default when the stored value is not a URL', () => {
    const ps = hydrateProofServer({ mode: 'local', localUrl: LEDGER8, localUrlLedger9: 'not a url' });
    expect(ps.localUrlLedger9).toBe(LEDGER9);
  });
});

describe('history: the optimistic pending row and the confirmed row', () => {
  // The mainnet send of 2026-09-16: the node answered with the Substrate
  // extrinsic hash, the indexer later reported the ledger hash. Two spellings
  // of two DIFFERENT values — only a row keyed on the ledger hash can be
  // replaced in place when gero-sync delivers the confirmed entry.
  const LEDGER = '608a95f738c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7';
  const EXTRINSIC = '0xb12f2a03e5b1a7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2';
  const USDM = 'aa'.repeat(32);

  const row = (over: Partial<MidnightTransaction>): MidnightTransaction => ({
    hash: LEDGER, type: 'send', token: USDM, amount: 2_000_000n, counterparty: 'mn_addr1self',
    timestamp: 1_758_000_000_000, status: 'pending', fee: 0n, isShielded: false, ...over,
  });

  beforeEach(() => midnightActions.setTransactions([]));

  it('replaces a pending row keyed on the ledger hash with the confirmed one, whatever the prefix or case', () => {
    midnightActions.applyTransaction(row({ hash: `0x${LEDGER.toUpperCase()}` }));
    midnightActions.applyTransaction(row({ status: 'confirmed', blockHeight: 2_598_770, amount: 0n }));

    expect(midnightStore.transactions).toHaveLength(1);
    expect(midnightStore.transactions[0].status).toBe('confirmed');
    expect(midnightStore.transactions[0].blockHeight).toBe(2_598_770);
  });

  it('cannot reconcile a pending row keyed on the extrinsic hash: that is the two-row bug', () => {
    midnightActions.applyTransaction(row({ hash: EXTRINSIC }));
    midnightActions.applyTransaction(row({ status: 'confirmed', blockHeight: 2_598_770 }));

    expect(midnightStore.transactions.map(t => t.status).sort()).toEqual(['confirmed', 'pending']);
  });

  it('keeps rows of two colors from one transaction apart', () => {
    midnightActions.applyTransaction(row({ token: 'NIGHT' }));
    midnightActions.applyTransaction(row({ token: USDM }));

    expect(midnightStore.transactions).toHaveLength(2);
  });

  it('drops a shielded pending row once the private scan confirms it, whatever the prefix or case', () => {
    midnightActions.applyTransaction(row({ hash: `0x${LEDGER.toUpperCase()}`, isShielded: true }));
    midnightActions.applyPrivateSnapshot({}, [row({ status: 'confirmed', isShielded: true })]);

    expect(midnightStore.transactions.filter(t => t.isShielded)).toHaveLength(1);
    expect(midnightStore.transactions[0].status).toBe('confirmed');
  });
});

describe('history: a self-transfer keeps the amount the wallet typed', () => {
  // The chain reports a transfer to our own address as net zero — the 2.00
  // payment and the 7.99 change are both just outputs we own — so the synced
  // row arrives with amount 0. The pending row this wallet inserted at send
  // time is the only record of the 2.00.
  const LEDGER = '58d446313ec1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5e450';
  const USDM = 'aa'.repeat(32);
  const row = (over: Partial<MidnightTransaction>): MidnightTransaction => ({
    hash: LEDGER, type: 'self', token: USDM, amount: 0n, counterparty: '',
    timestamp: 1_758_000_000_000, status: 'confirmed', fee: 0n, isShielded: false, ...over,
  });

  beforeEach(() => midnightActions.setTransactions([]));

  it('carries the pending amount into the confirmed self-transfer row', () => {
    midnightActions.applyTransaction(row({ status: 'pending', amount: 2_000_000n, counterparty: 'mn_addr1self' }));
    midnightActions.applyTransaction(row({ blockHeight: 2_599_815 }));

    expect(midnightStore.transactions).toHaveLength(1);
    expect(midnightStore.transactions[0]).toMatchObject({ type: 'self', status: 'confirmed', amount: 2_000_000n, blockHeight: 2_599_815 });
  });

  it('also carries it when the pending row was typed as a plain send (older builds)', () => {
    midnightActions.applyTransaction(row({ type: 'send', status: 'pending', amount: 2_000_000n }));
    midnightActions.applyTransaction(row({}));

    expect(midnightStore.transactions[0]).toMatchObject({ type: 'self', amount: 2_000_000n });
  });

  it('never overrides a real amount, and has nothing to carry without a pending row', () => {
    midnightActions.applyTransaction(row({ type: 'send', status: 'pending', amount: 2_000_000n }));
    midnightActions.applyTransaction(row({ type: 'send', amount: 2_000_000n, counterparty: 'mn_addr1other' }));
    expect(midnightStore.transactions[0]).toMatchObject({ type: 'send', amount: 2_000_000n, counterparty: 'mn_addr1other' });

    midnightActions.setTransactions([]);
    midnightActions.applyTransaction(row({}));
    expect(midnightStore.transactions[0]).toMatchObject({ type: 'self', amount: 0n });
  });
});
