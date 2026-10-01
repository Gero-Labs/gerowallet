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
      protocolVersion: 2, block: { hash: height.toString(16).padStart(64, '0'), height,
        ledgerParameters: hex(chain.parameters.serialize()) },
      dustLedgerEvents: result.events.map(event => ({ raw: hex(event.serialize()), protocolVersion: 2 })) });
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
    protocolVersion: 2, update: hex(ledger.DustStateMerkleTreeCollapsedUpdate.newFromCommitmentTree(
      chain.dust.utxo, BigInt(from), BigInt(to)).serialize()) });
  const snapshot: DustSnapshot = { version: 1, network: 'midnight-stagenet', block: {
    hash: 'cd'.repeat(32), height, timestamp: time.getTime(), protocolVersion: 2,
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
      const fee = balanceLightDust9(state, f.key, [ledger.Transaction.fromParts('stagenet')],
        new Date(Date.now() + 300000), new Date(block.timestamp), block.ledgerParameters);
      const spends = [...fee.intents!.values()].flatMap(intent => intent.dustActions?.spends ?? []);
      expect(spends.length).toBeGreaterThan(0);
      expect(spends[0].oldNullifier).toBe(ledger.dustNullifier(f.local.utxos[0], f.key));
      expect(fee.serialize().length).toBeGreaterThan(0);
    } finally { f.key.clear(); }
  });
});
