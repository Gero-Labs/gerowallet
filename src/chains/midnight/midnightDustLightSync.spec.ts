// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as ledger9 from '@midnightntwrk/ledger-v9';
import { ScaleBigInt } from '@midnightntwrk/wallet-sdk-address-format';
import { dustLedger8, balanceLightDust8 } from './midnightDustLightLedger8';
import { dustLedger9 } from './midnightDustLightLedger9';
import { reconstructDustState, littleEndianHex, dustNullifierPrefix, type DustSnapshot, type DustLightTransport, type DustSpendTransaction, type CollapsedDustTree } from './midnightDustLightSync';

const encoded = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const root = (value: bigint | undefined) => value === undefined ? null : encoded(ScaleBigInt.encode(value));

/** Build actual ledger events and indexer projections from an in-memory ledger.
 * Fee/proof/signature checks are disabled only while manufacturing test blocks. */
function fixture(spendCount = 0, foreign = false, decay = false) {
  const key = ledger.DustSecretKey.fromSeed(new Uint8Array(32).fill(41));
  const night = ledger.signatureVerifyingKey(ledger.sampleSigningKey());
  const start = Math.floor(Date.now() / 1000) - 120;
  let time = new Date(start * 1000);
  let chain = ledger.LedgerState.blank('mainnet');
  let local = new ledger.DustLocalState(chain.parameters.dust);
  let height = 0;
  const transactions: DustSpendTransaction[] = [];
  const initial: { coin: ledger.QualifiedDustOutput; generation: ledger.DustGenerationInfo; index: number }[] = [];
  const apply = (tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>) => {
    const strict = new ledger.WellFormedStrictness();
    strict.enforceBalancing = false;
    strict.verifySignatures = false;
    const context = new ledger.TransactionContext(chain, { secondsSinceEpoch: BigInt(time.getTime() / 1000),
      secondsSinceEpochErr: 0, lastBlockTime: BigInt(time.getTime() / 1000 - 1), parentBlockHash: '00'.repeat(32) });
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
    const nullifiers = result.events.flatMap(e => e.content.tag === 'dustSpendProcessed'
      ? [littleEndianHex((e.content as { nullifier: bigint }).nullifier)] : []);
    if (nullifiers.length) transactions.push({ hash: height.toString(16).padStart(64, '0'), matchedNullifiers: nullifiers,
      protocolVersion: 1, block: { hash: height.toString(16).padStart(64, '0'), height, ledgerParameters: encoded(chain.parameters.serialize()) },
      dustLedgerEvents: result.events.map(e => ({ raw: encoded(e.serialize()), protocolVersion: 1 })) });
    time = new Date(time.getTime() + 1000);
  };
  const register = (publicKey: bigint, nightKey: string) => {
    const intent = ledger.Intent.new(new Date(time.getTime() + 300000));
    intent.dustActions = new ledger.DustActions('signature', 'pre-proof', time, [], [new ledger.DustRegistration('signature', nightKey, publicKey, 0n)]);
    apply(ledger.Transaction.fromParts('mainnet', undefined, undefined, intent));
    const amount = 1_000_000_000_000_000n;
    chain = chain.testingDistributeNight(ledger.addressFromKey(nightKey), amount, time);
    apply(ledger.Transaction.fromRewards(new ledger.ClaimRewardsTransaction('signature-erased', 'mainnet', amount,
      nightKey, height.toString(16).padStart(64, '0'), new ledger.SignatureErased())));
  };
  if (foreign) register(ledger.DustSecretKey.fromSeed(new Uint8Array(32).fill(19)).publicKey, ledger.signatureVerifyingKey(ledger.sampleSigningKey()));
  register(key.publicKey, night);
  if (foreign) register(ledger.DustSecretKey.fromSeed(new Uint8Array(32).fill(20)).publicKey, ledger.signatureVerifyingKey(ledger.sampleSigningKey()));
  for (let i = 0; i < spendCount; i++) {
    const [, spend] = local.spend(key, local.utxos[0], 1n, time);
    const intent = ledger.Intent.new(new Date(time.getTime() + 300000));
    intent.dustActions = new ledger.DustActions('signature', 'pre-proof', time, [spend], []);
    apply(ledger.Transaction.fromParts('mainnet', undefined, undefined, intent));
  }
  if (decay) {
    const ownedNight = [...chain.utxo.utxos.values()].find(u => u.owner === ledger.addressFromKey(night))!;
    const intent = ledger.Intent.new(new Date(time.getTime() + 300000));
    intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([{ ...ownedNight, owner: night }],
      [{ owner: ledger.addressFromKey(ledger.signatureVerifyingKey(ledger.sampleSigningKey())),
        value: ownedNight.value, type: ownedNight.type }], []);
    apply(ledger.Transaction.fromParts('mainnet', undefined, undefined, intent));
    expect(local.generationInfo(local.utxos[0])!.dtime).toBeInstanceOf(Date);
  }
  const genCount = foreign ? 3 : 1;
  const commitmentCount = genCount + spendCount;
  const update = (kind: 'generation' | 'commitment', from: number, to: number): CollapsedDustTree => ({
    startIndex: from, endIndex: to, protocolVersion: 1,
    update: encoded((kind === 'generation'
      ? ledger.DustStateMerkleTreeCollapsedUpdate.newFromGenerationTree(chain.dust.generation, BigInt(from), BigInt(to))
      : ledger.DustStateMerkleTreeCollapsedUpdate.newFromCommitmentTree(chain.dust.utxo, BigInt(from), BigInt(to))).serialize()),
  });
  const snapshot: DustSnapshot = { version: 1, network: 'midnight-mainnet', block: {
    hash: 'aa'.repeat(32), height, timestamp: time.getTime(), protocolVersion: 1, ledgerParameters: encoded(chain.parameters.serialize()),
    dustGenerationEndIndex: genCount, dustCommitmentEndIndex: commitmentCount,
    dustGenerationMerkleTreeRoot: root(local.generatingTreeRoot()), dustCommitmentMerkleTreeRoot: root(local.commitmentTreeRoot()),
  }, generations: initial.map(({ coin, generation, index }) => ({ __typename: 'DustGenerationsItem',
    generationMtIndex: index, commitmentMtIndex: Number(coin.mtIndex), owner: encoded(ScaleBigInt.encode(key.publicKey)),
    value: generation.value.toString(), initialValue: coin.initialValue.toString(), initialNonce: ledger9.dustFirstNonce(coin.backingNight, key.publicKey).toString(),
    backingNight: coin.backingNight, ctime: coin.ctime.getTime() / 1000, collapsedMerkleTree: foreign ? update('generation', 0, 0) : null,
  })) };
  if (foreign) snapshot.generations.push({ __typename: 'DustGenerationsProgress', highestIndex: genCount - 1, collapsedMerkleTree: update('generation', 2, 2) });
  if (decay) snapshot.generations.unshift({ __typename: 'DustGenerationDtimeUpdateItem', generationMtIndex: foreign ? 1 : 0,
    owner: encoded(ScaleBigInt.encode(key.publicKey)), nightUtxoHash: local.utxos[0].backingNight,
    newDtime: local.generationInfo(local.utxos[0])!.dtime!.getTime() / 1000 });
  const transport: DustLightTransport = {
    snapshot: vi.fn(async () => snapshot),
    spends: vi.fn(async (_block, prefixes) => ({ nextBlock: null,
      transactions: transactions.filter(tx => tx.matchedNullifiers.some(n => prefixes.some(p => n.startsWith(p)))) })),
    commitments: vi.fn(async (_block, ranges) => ranges.map(r => update('commitment', r.startIndex, r.endIndex))),
  };
  return { key, local, snapshot, transport, transactions };
}

describe('compact DUST sync with the real ledger', () => {
  it('re-anchors a transient projection mismatch and bounds persistent failures', async () => {
    const f = fixture();
    try {
      const stale = { ...f.snapshot, block: { ...f.snapshot.block, dustGenerationMerkleTreeRoot: '00' } };
      f.transport.snapshot = vi.fn().mockResolvedValueOnce(stale).mockResolvedValue(f.snapshot);
      expect((await reconstructDustState(dustLedger8, f.key, 'mainnet', f.transport)).state.utxos).toEqual(f.local.utxos);
      expect(f.transport.snapshot).toHaveBeenCalledTimes(2);
      f.transport.snapshot = vi.fn().mockResolvedValue(stale);
      await expect(reconstructDustState(dustLedger8, f.key, 'mainnet', f.transport)).rejects.toThrow('root verification');
      expect(f.transport.snapshot).toHaveBeenCalledTimes(3);
    } finally { f.key.clear(); }
  });
  it('follows bounded pages without skipping owned spends and rejects stalled cursors', async () => {
    const f = fixture(3, true);
    const split = f.transactions[1].block.height;
    f.transport.spends = vi.fn(async (block, prefixes, fromBlock) => {
      expect(prefixes).toHaveLength(1);
      const nextBlock = fromBlock === 0 ? split : null;
      return { nextBlock, transactions: f.transactions.filter(tx => tx.block.height >= fromBlock
        && tx.block.height < (nextBlock ?? block.height + 1)
        && tx.matchedNullifiers.some(n => n.startsWith(prefixes[0]))) };
    });
    try {
      const { state } = await reconstructDustState(dustLedger8, f.key, 'mainnet', f.transport);
      expect(state.utxos).toEqual(f.local.utxos);
      expect(vi.mocked(f.transport.spends).mock.calls.some(call => call[2] === split)).toBe(true);
      f.transport.spends = vi.fn(async () => ({ nextBlock: 0, transactions: [] }));
      await expect(reconstructDustState(dustLedger8, f.key, 'mainnet', f.transport)).rejects.toThrow('page cursor');
    } finally { f.key.clear(); }
  });
  it('preserves decay after backing NIGHT is spent, including an earlier DUST spend chain', async () => {
    const f = fixture(3, true, true);
    try {
      const { state } = await reconstructDustState(dustLedger8, f.key, 'mainnet', f.transport);
      expect(state.utxos).toEqual(f.local.utxos);
      expect(state.generationInfo(state.utxos[0])).toEqual(f.local.generationInfo(f.local.utxos[0]));
      const future = new Date(Date.now() + 86400000);
      expect(state.walletBalance(future)).toBe(f.local.walletBalance(future));
    } finally { f.key.clear(); }
  });
  it.each([0, 1, 50])('matches full event replay after %i spends', async count => {
    const f = fixture(count, true);
    try {
      const { state } = await reconstructDustState(dustLedger8, f.key, 'mainnet', f.transport);
      expect(state.utxos).toEqual(f.local.utxos);
      expect(state.walletBalance(new Date())).toBe(f.local.walletBalance(new Date()));
      expect(dustLedger8.roots(state)).toEqual(dustLedger8.roots(f.local));
      expect(state.spend(f.key, state.utxos[0], 1n, new Date())[1].oldNullifier).toBe(ledger.dustNullifier(f.local.utxos[0], f.key));
    } finally { f.key.clear(); }
  });

  it('uses the canonical SDK fee algorithm on reconstructed state', async () => {
    const f = fixture();
    try {
      const { state, block } = await reconstructDustState(dustLedger8, f.key, 'mainnet', f.transport);
      const fee = balanceLightDust8(state, f.key, 'mainnet', [ledger.Transaction.fromParts('mainnet')],
        new Date(Date.now() + 300000), new Date(block.timestamp), block.ledgerParameters);
      expect([...fee.intents!.values()].flatMap(i => i.dustActions?.spends ?? []).length).toBeGreaterThan(0);
    } finally { f.key.clear(); }
  });

  it('refuses tampered roots and unsupported owned spends', async () => {
    const f = fixture(1);
    try {
      const original = f.snapshot.block.dustGenerationMerkleTreeRoot;
      f.snapshot.block.dustGenerationMerkleTreeRoot = '00';
      await expect(reconstructDustState(dustLedger8, f.key, 'mainnet', f.transport)).rejects.toThrow('generation root');
      f.snapshot.block.dustGenerationMerkleTreeRoot = original;
      f.transactions[0].dustLedgerEvents = [{ raw: '00', protocolVersion: 999 }];
      await expect(reconstructDustState(dustLedger8, f.key, 'mainnet', f.transport)).rejects.toThrow('owned DUST spend');
    } finally { f.key.clear(); }
  });

  it('supports an empty ledger-9 wallet without a replay or negative index', async () => {
    const key = ledger9.DustSecretKey.fromSeed(new Uint8Array(32).fill(17));
    const state = new ledger9.DustLocalState(ledger9.LedgerParameters.initialParameters().dust);
    const transport = { snapshot: async () => ({ version: 1, network: 'midnight-stagenet', generations: [], block: {
      hash: 'bb'.repeat(32), height: 0, timestamp: Date.now(), protocolVersion: 1,
      ledgerParameters: encoded(ledger9.LedgerParameters.initialParameters().serialize()),
      dustGenerationEndIndex: 0, dustCommitmentEndIndex: 0, dustGenerationMerkleTreeRoot: null, dustCommitmentMerkleTreeRoot: null,
    } }), spends: vi.fn(), commitments: vi.fn() };
    try {
      const result = await reconstructDustState(dustLedger9, key, 'stagenet', transport);
      expect(dustLedger9.roots(result.state)).toEqual(dustLedger9.roots(state));
      expect(transport.spends).not.toHaveBeenCalled();
      expect(transport.commitments).not.toHaveBeenCalled();
    } finally { key.clear(); }
  });

  it('avoids the old indexer ff-prefix upper-bound bug', () => {
    expect(dustNullifierPrefix(0x12ffn, 10000)).toBe('ff');
    expect(dustNullifierPrefix(0x12ffffn, 10000)).toBe('ff');
    expect(dustNullifierPrefix(0x12ffffffn, 10000)).toBe('ff');
    expect(() => dustNullifierPrefix(0x12ffffffffn, 10000)).toThrow('unsupported');
    expect(dustNullifierPrefix(0xff12n, 100_000_000)).toBe('12');
    expect(() => dustNullifierPrefix((1n << 256n) - 1n, 10000)).toThrow('unsupported');
  });
});
