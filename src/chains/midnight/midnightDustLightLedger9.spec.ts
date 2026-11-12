// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { ScaleBigInt } from 'midnight-v9-address-format';
import { balanceLightDust9, dustLedger9 } from './midnightDustLightLedger9';
import { reconstructDustState, littleEndianHex, type CollapsedDustTree, type DustLightTransport,
  type DustSnapshot, type DustSpendTransaction } from './midnightDustLightSync';

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
  it.each(['mainnet', 'preprod'])('%s: ignores spend history from before the ledger 9 crossing, even one matching an owned nullifier', async (network) => {
    const f = fundedFixture();
    try {
      const snapshot = { ...f.snapshot, network: `midnight-${network}` };
      const ownedNullifiers = [...new Set((await f.transport.spends(f.snapshot.block, [''], 0, f.snapshot.block.height)).transactions.flatMap(tx => tx.matchedNullifiers))];
      expect(ownedNullifiers.length).toBeGreaterThan(0);
      // Before the crossing: ledger 8 bytes no ledger 9 adapter can read, matching the owned chain's nullifiers.
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
      const { state } = await reconstructDustState(dustLedger9, f.key, network, transport);
      expect(state.utxos).toEqual(f.local.utxos);
      expect(dustLedger9.roots(state)).toEqual(dustLedger9.roots(f.local));
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
