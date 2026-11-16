// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { ScaleBigInt } from 'midnight-v9-address-format';
import { balanceLightDust9, dustLedger9 } from './midnightDustLightLedger9';
import {
  DUST_SCAN_ALIGN_BLOCKS, DUST_SCAN_MAX_SLICES, DUST_SCAN_MIN_SLICE_BLOCKS, DUST_SPEND_CONCURRENCY, dustScanSlices,
  dustWarmScanStart, reconstructDustState,
  littleEndianHex, type CollapsedDustTree, type DustLightTransport, type DustSnapshot, type DustSpendTransaction,
} from './midnightDustLightSync';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const root = (value: bigint | undefined) => value === undefined ? null : hex(ScaleBigInt.encode(value));

/** Real ledger-9 transitions supply an independent event-replay oracle. */
function fundedFixture() {
  const key = ledger.DustSecretKey.fromSeed(new Uint8Array(32).fill(73));
  const nightKey = ledger.signatureVerifyingKey(ledger.sampleSigningKey());
  let time = new Date((Math.floor(Date.now() / 1000) - 120) * 1000);
  let chain = ledger.LedgerState.blank('stagenet');
  let local = new ledger.DustLocalState(chain.parameters.dust);
  let height = 0;
  const transactions: DustSpendTransaction[] = [];
  const initial: { coin: ledger.QualifiedDustOutput; generation: ledger.DustGenerationInfo; index: number }[] = [];
  const apply = (tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>) => {
    // Only fixture manufacture bypasses proof/signature/fee validation.
    const strict = new ledger.WellFormedStrictness();
    strict.enforceBalancing = false;
    strict.verifySignatures = false;
    const seconds = BigInt(time.getTime() / 1000);
    const context = new ledger.TransactionContext(chain, { secondsSinceEpoch: seconds,
      secondsSinceEpochErr: 0, lastBlockTime: seconds - 1n, parentBlockHash: '00'.repeat(32) });
    const [next, result] = chain.apply(tx.eraseProofs().wellFormed(chain, strict, time), context);
    expect(result.type, result.error).toBe('success');
    chain = next.postBlockUpdate(time);
    local = local.replayEvents(key, result.events);
    height++;
    for (const event of result.events) {
      if (event.content.tag === 'dustInitialUtxo') {
        const content = event.content as { generationIndex: bigint; generation: ledger.DustGenerationInfo };
        const coin = local.utxos.find(c => c.backingNight === content.generation.nonce);
        if (coin) initial.push({ coin, generation: content.generation, index: Number(content.generationIndex) });
      }
    }
    const nullifiers = result.events.flatMap(event => event.content.tag === 'dustSpendProcessed'
      ? [littleEndianHex((event.content as { nullifier: bigint }).nullifier)] : []);
    if (nullifiers.length) transactions.push({ hash: height.toString(16).padStart(64, '0'), matchedNullifiers: nullifiers,
      protocolVersion: 2_001_100, block: { hash: height.toString(16).padStart(64, '0'), height,
        ledgerParameters: hex(chain.parameters.serialize()) },
      dustLedgerEvents: result.events.map(event => ({ raw: hex(event.serialize()), protocolVersion: 2_001_100 })) });
    time = new Date(time.getTime() + 1000);
  };
  const registration = ledger.Intent.new(new Date(time.getTime() + 300000));
  registration.dustActions = new ledger.DustActions('signature', 'pre-proof', time, [],
    [new ledger.DustRegistration('signature', nightKey, key.publicKey, 0n)]);
  apply(ledger.Transaction.fromParts('stagenet', undefined, undefined, registration));
  const amount = 1_000_000_000_000_000n;
  chain = chain.testingDistributeNight(ledger.addressFromKey(nightKey), amount, time);
  apply(ledger.Transaction.fromRewards(new ledger.ClaimRewardsTransaction('signature-erased', 'stagenet', amount,
    nightKey, 'ab'.repeat(32), new ledger.SignatureErased())));
  for (let i = 0; i < 3; i++) {
    const [, spend] = local.spend(key, local.utxos[0], 1n, time);
    const intent = ledger.Intent.new(new Date(time.getTime() + 300000));
    intent.dustActions = new ledger.DustActions('signature', 'pre-proof', time, [spend], []);
    apply(ledger.Transaction.fromParts('stagenet', undefined, undefined, intent));
  }
  const update = (from: number, to: number): CollapsedDustTree => ({ startIndex: from, endIndex: to,
    protocolVersion: 2_001_100, update: hex(ledger.DustStateMerkleTreeCollapsedUpdate.newFromCommitmentTree(
      chain.dust.utxo, BigInt(from), BigInt(to)).serialize()) });
  const snapshot: DustSnapshot = { version: 1, network: 'midnight-stagenet', block: {
    hash: 'cd'.repeat(32), height, timestamp: time.getTime(), protocolVersion: 2_001_100,
    ledgerParameters: hex(chain.parameters.serialize()), dustGenerationEndIndex: 1, dustCommitmentEndIndex: 4,
    dustGenerationMerkleTreeRoot: root(local.generatingTreeRoot()), dustCommitmentMerkleTreeRoot: root(local.commitmentTreeRoot()),
  }, generations: initial.map(({ coin, generation, index }) => ({ __typename: 'DustGenerationsItem',
    generationMtIndex: index, commitmentMtIndex: Number(coin.mtIndex), owner: hex(ScaleBigInt.encode(key.publicKey)),
    value: generation.value.toString(), initialValue: coin.initialValue.toString(),
    initialNonce: ledger.dustFirstNonce(coin.backingNight, key.publicKey).toString(),
    backingNight: coin.backingNight, ctime: coin.ctime.getTime() / 1000, collapsedMerkleTree: null })) };
  const transport: DustLightTransport = {
    snapshot: vi.fn(async () => snapshot),
    spends: vi.fn(async (_block, prefixes) => ({ nextBlock: null,
      transactions: transactions.filter(tx => tx.matchedNullifiers.some(n => prefixes.some(p => n.startsWith(p)))) })),
    commitments: vi.fn(async (_block, ranges) => ranges.map(r => update(r.startIndex, r.endIndex))),
  };
  return { key, local, snapshot, transport };
}

describe('funded ledger-9 DUST projection', () => {
  it('reconstructs spent descendants and produces spendable witnesses matching full replay', async () => {
    const f = fundedFixture();
    try {
      const { state } = await reconstructDustState(dustLedger9, f.key, 'stagenet', f.transport);
      expect(state.utxos).toEqual(f.local.utxos);
      expect(state.utxos).toHaveLength(1);
      expect(state.utxos[0].seq).toBe(3);
      expect(dustLedger9.roots(state)).toEqual(dustLedger9.roots(f.local));
      const now = new Date();
      expect(state.walletBalance(now)).toBe(f.local.walletBalance(now));
      expect(state.spend(f.key, state.utxos[0], 1n, now)[1].oldNullifier)
        .toBe(ledger.dustNullifier(f.local.utxos[0], f.key));
    } finally { f.key.clear(); }
  });

  it('balances a transaction with the canonical ledger-9 SDK from reconstructed state', async () => {
    const f = fundedFixture();
    try {
      const { state, block } = await reconstructDustState(dustLedger9, f.key, 'stagenet', f.transport);
      const fee = balanceLightDust9(state, f.key, 'stagenet', [ledger.Transaction.fromParts('stagenet')],
        new Date(Date.now() + 300000), new Date(block.timestamp), block.ledgerParameters);
      const spends = [...fee.intents!.values()].flatMap(intent => intent.dustActions?.spends ?? []);
      expect(spends.length).toBeGreaterThan(0);
      expect(spends[0].oldNullifier).toBe(ledger.dustNullifier(f.local.utxos[0], f.key));
      expect(fee.serialize().length).toBeGreaterThan(0);
    } finally { f.key.clear(); }
  });

  // #1452 M6: a chain that crossed the upgrade (mainnet, preprod) answers the
  // spend queries with its whole history, ledger 8 transactions included.
  it.each(['mainnet', 'preprod'])('%s: ignores spend history from before the ledger 9 crossing that touches no owned nullifier', async (network) => {
    const f = fundedFixture();
    try {
      const snapshot = { ...f.snapshot, network: `midnight-${network}` };
      // Before the crossing: ledger 8 bytes no ledger 9 adapter can read, on every page but matching no owned nullifier.
      const preCrossing: DustSpendTransaction = { hash: 'ee'.repeat(32), matchedNullifiers: ['ff'.repeat(32)], protocolVersion: 1_000_000,
        block: { hash: 'ee'.repeat(32), height: 0, ledgerParameters: f.snapshot.block.ledgerParameters },
        dustLedgerEvents: [{ raw: 'deadbeef', protocolVersion: 1_000_000 }] };
      const transport: DustLightTransport = {
        snapshot: vi.fn(async () => snapshot),
        spends: vi.fn(async (block, prefixes, fromBlock, toBlock) => {
          const page = await f.transport.spends(block, prefixes, fromBlock, toBlock);
          return { ...page, transactions: fromBlock === 0 ? [preCrossing, ...page.transactions] : page.transactions };
        }),
        commitments: f.transport.commitments,
      };
      const { state } = await reconstructDustState(dustLedger9, f.key, network, transport);
      expect(state.utxos).toEqual(f.local.utxos);
      expect(dustLedger9.roots(state)).toEqual(dustLedger9.roots(f.local));
    } finally { f.key.clear(); }
  });

  it.each(['mainnet', 'preprod'])('%s: refuses a pre-crossing spend of an owned nullifier: the DUST reset assumption does not hold', async (network) => {
    const f = fundedFixture();
    try {
      const snapshot = { ...f.snapshot, network: `midnight-${network}` };
      const ownedNullifiers = [...new Set((await f.transport.spends(f.snapshot.block, [''], 0, f.snapshot.block.height)).transactions.flatMap(tx => tx.matchedNullifiers))];
      expect(ownedNullifiers.length).toBeGreaterThan(0);
      const preCrossing: DustSpendTransaction = { hash: 'ee'.repeat(32), matchedNullifiers: ownedNullifiers, protocolVersion: 1_000_000,
        block: { hash: 'ee'.repeat(32), height: 0, ledgerParameters: f.snapshot.block.ledgerParameters },
        dustLedgerEvents: [{ raw: 'deadbeef', protocolVersion: 1_000_000 }] };
      const transport: DustLightTransport = {
        snapshot: vi.fn(async () => snapshot),
        spends: vi.fn(async (block, prefixes, fromBlock, toBlock) => {
          const page = await f.transport.spends(block, prefixes, fromBlock, toBlock);
          return { ...page, transactions: fromBlock === 0 ? [preCrossing, ...page.transactions] : page.transactions };
        }),
        commitments: f.transport.commitments,
      };
      await expect(reconstructDustState(dustLedger9, f.key, network, transport)).rejects.toThrow('DUST reset at the ledger crossing does not hold');
    } finally { f.key.clear(); }
  });

  it('a spend page with a malformed protocol version is refused, not taken for another ledger', async () => {
    const f = fundedFixture();
    try {
      const page = await f.transport.spends(f.snapshot.block, [''], 0, f.snapshot.block.height);
      const malformed = page.transactions.map(tx => ({ ...tx, protocolVersion: undefined as unknown as number }));
      const bad: DustLightTransport = { ...f.transport, spends: vi.fn(async (_b, prefixes) => ({ nextBlock: null,
        transactions: malformed.filter(tx => tx.matchedNullifiers.some(n => prefixes.some(p => n.startsWith(p)))) })) };
      await expect(reconstructDustState(dustLedger9, f.key, 'stagenet', bad)).rejects.toThrow('Invalid DUST spend protocol version');
    } finally { f.key.clear(); }
  });

  it('a ledger 8 event inside a ledger 9 owned spend is skipped, not fatal; an unreadable ledger 9 one still is', async () => {
    const f = fundedFixture();
    try {
      const page = await f.transport.spends(f.snapshot.block, [''], 0, f.snapshot.block.height);
      expect(page.transactions.length).toBeGreaterThan(0);
      const withLegacy = page.transactions.map(tx => ({ ...tx, dustLedgerEvents: [{ raw: 'deadbeef', protocolVersion: 1_000_000 }, ...tx.dustLedgerEvents] }));
      const ok: DustLightTransport = { ...f.transport, spends: vi.fn(async (_b, prefixes) => ({ nextBlock: null,
        transactions: withLegacy.filter(tx => tx.matchedNullifiers.some(n => prefixes.some(p => n.startsWith(p)))) })) };
      await expect(reconstructDustState(dustLedger9, f.key, 'stagenet', ok)).resolves.toBeTruthy();
      const broken = page.transactions.map(tx => ({ ...tx, dustLedgerEvents: [{ raw: 'deadbeef', protocolVersion: 2_001_100 }] }));
      const bad: DustLightTransport = { ...f.transport, spends: vi.fn(async (_b, prefixes) => ({ nextBlock: null,
        transactions: broken.filter(tx => tx.matchedNullifiers.some(n => prefixes.some(p => n.startsWith(p)))) })) };
      await expect(reconstructDustState(dustLedger9, f.key, 'stagenet', bad)).rejects.toThrow('Cannot decode an owned DUST spend');
    } finally { f.key.clear(); }
  });

  it('preprod: a registration the upgrade cleared leaves no DUST and asks for no spend history', async () => {
    const key = ledger.DustSecretKey.fromSeed(new Uint8Array(32).fill(74));
    const parameters = ledger.LedgerParameters.initialParameters();
    const transport: DustLightTransport = {
      snapshot: vi.fn(async () => ({ version: 1, network: 'midnight-preprod', generations: [], block: {
        hash: 'cd'.repeat(32), height: 10, timestamp: Date.now(), protocolVersion: 2_001_100,
        ledgerParameters: hex(parameters.serialize()), dustGenerationEndIndex: 0, dustCommitmentEndIndex: 0,
        dustGenerationMerkleTreeRoot: null, dustCommitmentMerkleTreeRoot: null } })),
      spends: vi.fn(), commitments: vi.fn(),
    };
    try {
      const { state } = await reconstructDustState(dustLedger9, key, 'preprod', transport);
      expect(state.utxos).toEqual([]);
      expect(state.walletBalance(new Date())).toBe(0n);
      expect(transport.spends).not.toHaveBeenCalled();
    } finally { key.clear(); }
  });
});

// A full scan of one nullifier prefix took ~150 s on mainnet (2026-11-16):
// each build resumes the spend chains from the last one's checkpoint.
describe('DUST spend checkpoint', () => {
  /** The fixture's transport, answering only spends inside the requested block range, with the ranges recorded. */
  function ranged(f: ReturnType<typeof fundedFixture>) {
    const ranges: [number, number][] = [];
    const transport: DustLightTransport = {
      ...f.transport,
      spends: vi.fn(async (block, prefixes, fromBlock, toBlock) => {
        ranges.push([fromBlock, toBlock]);
        const page = await f.transport.spends(block, prefixes, fromBlock, toBlock);
        return { ...page, transactions: page.transactions.filter(tx => tx.block.height >= fromBlock && tx.block.height <= toBlock) };
      }),
    };
    return { transport, ranges };
  }

  it('a cold build scans every chain from the first block, successors included, and checkpoints below the margin', async () => {
    const f = fundedFixture();
    try {
      const { transport, ranges } = ranged(f);
      // The fixture's spends are at heights 3, 4 and 5 (the snapshot block).
      const { state, checkpoint } = await reconstructDustState(dustLedger9, f.key, 'stagenet', transport, undefined,
        { checkpointMarginBlocks: 1 });
      expect(state.utxos).toEqual(f.local.utxos);
      // Never the successor's own creation block: that would name the wallet's spend to the server.
      expect(ranges.every(([from]) => from === 0)).toBe(true);
      expect(checkpoint?.checkedThrough).toBe(f.snapshot.block.height - 1);
      // The head as of height 4: the spend at height 5 is inside the margin.
      expect(Object.values(checkpoint!.heads).map(head => head.seq)).toEqual([2]);
    } finally { f.key.clear(); }
  });

  it('a warm build scans only after the checkpoint and reaches the same state', async () => {
    const f = fundedFixture();
    try {
      const cold = await reconstructDustState(dustLedger9, f.key, 'stagenet', ranged(f).transport, undefined, { checkpointMarginBlocks: 1 });
      const { transport, ranges } = ranged(f);
      const warm = await reconstructDustState(dustLedger9, f.key, 'stagenet', transport, undefined,
        { checkpoint: JSON.parse(JSON.stringify(cold.checkpoint)), checkpointMarginBlocks: 1, scanAlignBlocks: 0 });
      expect(warm.state.utxos).toEqual(f.local.utxos);
      expect(dustLedger9.roots(warm.state)).toEqual(dustLedger9.roots(f.local));
      expect(ranges.length).toBeGreaterThan(0);
      expect(ranges.every(([from]) => from === cold.checkpoint!.checkedThrough + 1)).toBe(true);
      expect(warm.checkpoint).toEqual(cold.checkpoint);
    } finally { f.key.clear(); }
  });

  it('a checkpoint with every spend applied needs no rescan of older blocks', async () => {
    const f = fundedFixture();
    try {
      const cold = await reconstructDustState(dustLedger9, f.key, 'stagenet', ranged(f).transport, undefined, { checkpointMarginBlocks: 0 });
      expect(Object.values(cold.checkpoint!.heads).map(head => head.seq)).toEqual([3]);
      // The chain moved on one block: the checkpoint is now behind the snapshot.
      const later = { ...f.snapshot, block: { ...f.snapshot.block, height: f.snapshot.block.height + 1 } };
      const { transport, ranges } = ranged(f);
      const warm = await reconstructDustState(dustLedger9, f.key, 'stagenet', { ...transport, snapshot: vi.fn(async () => later) },
        undefined, { checkpoint: cold.checkpoint, checkpointMarginBlocks: 0, scanAlignBlocks: 0 });
      expect(warm.state.utxos).toEqual(f.local.utxos);
      expect(ranges).toEqual([[later.block.height, later.block.height]]);
    } finally { f.key.clear(); }
  });

  it.each([
    ['another chain\'s head', (head: Record<string, unknown>) => ({ ...head, backingNight: 'ff'.repeat(32) })],
    ['a head past the snapshot', (head: Record<string, unknown>) => ({ ...head, mtIndex: '99' })],
    ['a head of another key', (head: Record<string, unknown>) => ({ ...head, owner: '1' })],
    ['a malformed head', () => ({ seq: 'x' })],
  ])('ignores %s and scans that chain from the first block', async (_name, corrupt) => {
    const f = fundedFixture();
    try {
      const cold = await reconstructDustState(dustLedger9, f.key, 'stagenet', ranged(f).transport, undefined, { checkpointMarginBlocks: 1 });
      const heads = Object.fromEntries(Object.entries(cold.checkpoint!.heads)
        .map(([chain, head]) => [chain, corrupt(head as unknown as Record<string, unknown>)]));
      const { transport, ranges } = ranged(f);
      const warm = await reconstructDustState(dustLedger9, f.key, 'stagenet', transport, undefined,
        { checkpoint: { checkedThrough: cold.checkpoint!.checkedThrough, heads } as never, checkpointMarginBlocks: 1 });
      expect(warm.state.utxos).toEqual(f.local.utxos);
      expect(ranges.every(([from]) => from === 0)).toBe(true);
    } finally { f.key.clear(); }
  });

  it('scans a cold chain from the ledger first block when its coin was created on that ledger', async () => {
    const f = fundedFixture();
    try {
      const { transport, ranges } = ranged(f);
      const created = Math.min(...f.snapshot.generations.map(g => (g as { ctime: number }).ctime)) * 1000;
      // The fixture's spends are at heights 3, 4 and 5; its coin was created before them.
      const { state } = await reconstructDustState(dustLedger9, f.key, 'stagenet', transport, undefined,
        { ledgerFirstBlock: { height: 3, timestamp: created } });
      expect(state.utxos).toEqual(f.local.utxos);
      expect(ranges.length).toBeGreaterThan(1);
      expect(ranges.every(([from]) => from === 3)).toBe(true);
    } finally { f.key.clear(); }
  });

  it('scans a coin older than the ledger first block from block 0, where a spend from another ledger is still refused', async () => {
    const f = fundedFixture();
    try {
      const { transport, ranges } = ranged(f);
      const { state } = await reconstructDustState(dustLedger9, f.key, 'stagenet', transport, undefined,
        { ledgerFirstBlock: { height: 3, timestamp: Date.now() + 60_000 } });
      expect(state.utxos).toEqual(f.local.utxos);
      expect(ranges.every(([from]) => from === 0)).toBe(true);
    } finally { f.key.clear(); }
  });

  it('ignores a checkpoint at or past the snapshot (a lagging server)', async () => {
    const f = fundedFixture();
    try {
      const cold = await reconstructDustState(dustLedger9, f.key, 'stagenet', ranged(f).transport, undefined, { checkpointMarginBlocks: 0 });
      const { transport, ranges } = ranged(f);
      const warm = await reconstructDustState(dustLedger9, f.key, 'stagenet', transport, undefined,
        { checkpoint: { ...cold.checkpoint!, checkedThrough: f.snapshot.block.height }, checkpointMarginBlocks: 0 });
      expect(warm.state.utxos).toEqual(f.local.utxos);
      expect(ranges.every(([from]) => from === 0)).toBe(true);
    } finally { f.key.clear(); }
  });
});

describe('DUST checkpoint review fixes', () => {
  it('starts a warm scan on a shared boundary at least one alignment before the first unchecked block', () => {
    expect(dustWarmScanStart(41, 0, 0)).toBe(42);
    expect(dustWarmScanStart(4, 2, 0)).toBe(2);
    const fork = 3_346_139;
    for (const checkedThrough of [3_474_000, 3_484_799, 3_484_800, 3_499_999]) {
      const start = dustWarmScanStart(checkedThrough, DUST_SCAN_ALIGN_BLOCKS, fork);
      expect(start % DUST_SCAN_ALIGN_BLOCKS).toBe(0);
      expect(checkedThrough + 1 - start).toBeGreaterThanOrEqual(DUST_SCAN_ALIGN_BLOCKS);
      expect(checkedThrough + 1 - start).toBeLessThan(2 * DUST_SCAN_ALIGN_BLOCKS);
    }
    // Never below the ledger's first block.
    expect(dustWarmScanStart(fork + 10, DUST_SCAN_ALIGN_BLOCKS, fork)).toBe(fork);
  });

  it('a warm build with alignment scans from the boundary and reaches the same state', async () => {
    const f = fundedFixture();
    try {
      const cold = await reconstructDustState(dustLedger9, f.key, 'stagenet', f.transport, undefined, { checkpointMarginBlocks: 1 });
      const ranges: number[] = [];
      const transport: DustLightTransport = { ...f.transport, spends: vi.fn(async (block, prefixes, fromBlock, toBlock) => {
        ranges.push(fromBlock);
        const page = await f.transport.spends(block, prefixes, fromBlock, toBlock);
        return { ...page, transactions: page.transactions.filter(tx => tx.block.height >= fromBlock && tx.block.height <= toBlock) };
      }) };
      const warm = await reconstructDustState(dustLedger9, f.key, 'stagenet', transport, undefined,
        { checkpoint: cold.checkpoint, checkpointMarginBlocks: 1, scanAlignBlocks: 2 });
      expect(warm.state.utxos).toEqual(f.local.utxos);
      expect(dustLedger9.roots(warm.state)).toEqual(dustLedger9.roots(f.local));
      expect(new Set(ranges)).toEqual(new Set([dustWarmScanStart(cold.checkpoint!.checkedThrough, 2, 0)]));
    } finally { f.key.clear(); }
  });

  it('falls back to a cold scan when a well-formed head is not on the chain, and replaces it', async () => {
    const f = fundedFixture();
    try {
      const cold = await reconstructDustState(dustLedger9, f.key, 'stagenet', f.transport, undefined, { checkpointMarginBlocks: 1 });
      const [[chain, head]] = Object.entries(cold.checkpoint!.heads);
      expect(head.seq).toBeGreaterThan(0);
      // Passes every shape check, but no such coin was ever created: the commitment root cannot match.
      const wrong = { checkedThrough: cold.checkpoint!.checkedThrough, heads: { [chain]: { ...head, nonce: (BigInt(head.nonce) + 1n).toString() } } };
      // The first block each attempt scans from.
      const starts: number[] = [];
      const transport: DustLightTransport = { ...f.transport,
        snapshot: async address => { starts.push(-1); return f.transport.snapshot(address); },
        spends: async (block, prefixes, fromBlock, toBlock) => {
          if (starts.at(-1) === -1) starts[starts.length - 1] = fromBlock;
          return f.transport.spends(block, prefixes, fromBlock, toBlock);
        } };
      const { state, checkpoint } = await reconstructDustState(dustLedger9, f.key, 'stagenet', transport, undefined,
        { checkpoint: wrong, checkpointMarginBlocks: 1, scanAlignBlocks: 0 });
      expect(state.utxos).toEqual(f.local.utxos);
      expect(checkpoint).toEqual(cold.checkpoint);
      // Two resumed attempts fail the root check; the third, cold, succeeds.
      const resumed = cold.checkpoint!.checkedThrough + 1;
      expect(starts).toEqual([resumed, resumed, 0]);
    } finally { f.key.clear(); }
  });
});

describe('sliced DUST spend scans', () => {
  it('splits a range into contiguous slices that depend on the range alone', () => {
    expect(dustScanSlices(0, 5)).toEqual([[0, 5]]);
    expect(dustScanSlices(10, 10 + 2 * DUST_SCAN_MIN_SLICE_BLOCKS - 1)).toEqual([
      [10, 10 + DUST_SCAN_MIN_SLICE_BLOCKS - 1], [10 + DUST_SCAN_MIN_SLICE_BLOCKS, 10 + 2 * DUST_SCAN_MIN_SLICE_BLOCKS - 1]]);
    for (const [from, to] of [[0, 4_000], [3_346_139, 3_480_255], [7, 7 + DUST_SCAN_MIN_SLICE_BLOCKS - 2], [0, 10_000_000]]) {
      const slices = dustScanSlices(from, to);
      expect(slices.length).toBeLessThanOrEqual(DUST_SCAN_MAX_SLICES);
      expect(slices[0][0]).toBe(from);
      expect(slices.at(-1)![1]).toBe(to);
      slices.forEach(([a, b], i) => {
        expect(b).toBeGreaterThanOrEqual(a);
        if (i > 0) expect(a).toBe(slices[i - 1][1] + 1);
        if (slices.length > 1) expect(b - a + 1).toBeGreaterThanOrEqual(DUST_SCAN_MIN_SLICE_BLOCKS);
      });
    }
    expect(dustScanSlices(3_346_139, 3_480_255)).toHaveLength(DUST_SCAN_MAX_SLICES);
    expect(() => dustScanSlices(10, 9)).toThrow('Invalid DUST scan range');
  });

  it('scans a long range in parallel slices, under the request limit, and reaches the same state', async () => {
    const f = fundedFixture();
    try {
      // A tall snapshot: the fixture's spends (heights 3 to 5) sit in the first slice.
      const height = 40_000;
      const snapshot = { ...f.snapshot, block: { ...f.snapshot.block, height } };
      const ranges: [number, number][] = [];
      let inFlight = 0;
      let peak = 0;
      const transport: DustLightTransport = {
        ...f.transport,
        snapshot: vi.fn(async () => snapshot),
        // Answers as the sidecar does: the block after the page while below the tip, null at it.
        spends: vi.fn(async (block, prefixes, fromBlock, toBlock) => {
          ranges.push([fromBlock, toBlock]);
          peak = Math.max(peak, ++inFlight);
          await new Promise(resolve => setTimeout(resolve, 2));
          inFlight--;
          const page = await f.transport.spends(block, prefixes, fromBlock, toBlock);
          return { transactions: page.transactions.filter(tx => tx.block.height >= fromBlock && tx.block.height <= toBlock),
            nextBlock: toBlock < height ? toBlock + 1 : null };
        }),
      };
      const { state } = await reconstructDustState(dustLedger9, f.key, 'stagenet', transport, undefined, { checkpointMarginBlocks: 1 });
      expect(state.utxos).toEqual(f.local.utxos);
      expect(dustLedger9.roots(state)).toEqual(dustLedger9.roots(f.local));
      // Every round asks for the whole range, slice by slice, and never more at once than the limit.
      expect(ranges).toEqual(expect.arrayContaining(dustScanSlices(0, height)));
      expect(new Set(ranges.map(([from]) => from))).toEqual(new Set(dustScanSlices(0, height).map(([from]) => from)));
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(DUST_SPEND_CONCURRENCY);
    } finally { f.key.clear(); }
  });

  it('finds spends in later slices, on slice edges and across pages the server cut short', async () => {
    const f = fundedFixture();
    try {
      const height = 40_000;
      const slices = dustScanSlices(0, height);
      // The fixture's spends at heights 3, 4 and 5 move to a slice's last block, a later slice's first block, and the tip.
      const moved = new Map([[3, slices[0][1]], [4, slices[4][0]], [5, height]]);
      const snapshot = { ...f.snapshot, block: { ...f.snapshot.block, height } };
      let cut = 0;
      const transport: DustLightTransport = { ...f.transport, snapshot: vi.fn(async () => snapshot),
        // Halves a long page as the sidecar does when one is too large.
        spends: vi.fn(async (block, prefixes, fromBlock, toBlock) => {
          const end = toBlock - fromBlock > 1_000 ? fromBlock + Math.floor((toBlock - fromBlock) / 2) : toBlock;
          if (end < toBlock) cut++;
          const page = await f.transport.spends(block, prefixes, fromBlock, toBlock);
          return { nextBlock: end < height ? end + 1 : null, transactions: page.transactions
            .map(tx => ({ ...tx, block: { ...tx.block, height: moved.get(tx.block.height) ?? tx.block.height } }))
            .filter(tx => tx.block.height >= fromBlock && tx.block.height <= end) };
        }) };
      const { state, checkpoint } = await reconstructDustState(dustLedger9, f.key, 'stagenet', transport, undefined, { checkpointMarginBlocks: 1 });
      expect(state.utxos).toEqual(f.local.utxos);
      expect(dustLedger9.roots(state)).toEqual(dustLedger9.roots(f.local));
      expect(cut).toBeGreaterThan(0);
      // The spend at the tip is inside the margin: the head stays at seq 2.
      expect(Object.values(checkpoint!.heads).map(head => head.seq)).toEqual([2]);
    } finally { f.key.clear(); }
  });

  it('refuses a slice the server ends early without a next block', async () => {
    const f = fundedFixture();
    try {
      const height = 40_000;
      const snapshot = { ...f.snapshot, block: { ...f.snapshot.block, height } };
      const transport: DustLightTransport = { ...f.transport, snapshot: vi.fn(async () => snapshot),
        spends: vi.fn(async () => ({ transactions: [], nextBlock: null })) };
      await expect(reconstructDustState(dustLedger9, f.key, 'stagenet', transport)).rejects.toThrow('Invalid DUST spend page cursor');
    } finally { f.key.clear(); }
  });
});
