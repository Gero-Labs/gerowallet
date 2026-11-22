// @vitest-environment node
// The fee of a swap paid with the fewest DUST spends ledger 9's validation-time
// limit accepts, under real ledger 9 parameters (Preview's, a repo fixture;
// mainnet's of block 3,554,417 gave the same counts on 2026-11-22).
import { describe, expect, it } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { DustSpreadError, spreadLightDust9, type SealedTransaction9 } from './midnightDustSpread9';
import { MIDNIGHT_DUST_COINS_SHORT } from './midnightConnectorIntent';
import { ledger9Keystore, signLedger9Intents } from './midnightLedger9';
import preview from './fixtures/preview-ledger9-parameters.json';

const NIGHT = '00'.repeat(32);
const TOKEN = 'ab'.repeat(32);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const noProver: ledger.ProvingProvider = {
  check: async () => { throw new Error('unexpected proof-server call'); },
  prove: async () => { throw new Error('unexpected proof-server call'); },
  lookupKey: async () => undefined,
};

/** A real ledger 9 chain under Preview's parameters where one DUST key is backed by `coins` NIGHT UTxOs. */
function dustWallet(coins: number) {
  const key = ledger.DustSecretKey.fromSeed(new Uint8Array(32).fill(91));
  const nightKey = ledger.signatureVerifyingKey(ledger.sampleSigningKey());
  let time = new Date((Math.floor(Date.now() / 1000) - 3600) * 1000);
  let chain = ledger.LedgerState.blank('stagenet');
  chain.parameters = ledger.LedgerParameters.deserialize(Buffer.from(preview.ledgerParameters.replace(/^0x/, ''), 'hex'));
  let local = new ledger.DustLocalState(chain.parameters.dust);
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
    time = new Date(time.getTime() + 1000);
  };
  const registration = ledger.Intent.new(new Date(time.getTime() + 300000));
  registration.dustActions = new ledger.DustActions('signature', 'pre-proof', time, [],
    [new ledger.DustRegistration('signature', nightKey, key.publicKey, 0n)]);
  apply(ledger.Transaction.fromParts('stagenet', undefined, undefined, registration));
  for (let index = 0; index < coins; index++) {
    const amount = 1_000_000_000_000_000n;
    chain = chain.testingDistributeNight(ledger.addressFromKey(nightKey), amount, time);
    apply(ledger.Transaction.fromRewards(new ledger.ClaimRewardsTransaction('signature-erased', 'stagenet', amount,
      nightKey, index.toString(16).padStart(2, '0').repeat(32), new ledger.SignatureErased())));
  }
  const now = new Date(time.getTime() + 3_000_000);
  return { key, local, now, chain, parameters: hex(chain.parameters.serialize()) };
}

/** Another party's sealed swap offer: `inputs` NIGHT coins in, 10 NIGHT left over, 5,000 TOKEN asked for. */
async function makerOffer(ttl: Date, inputs: number): Promise<SealedTransaction9> {
  const keystore = ledger9Keystore(new Uint8Array(32).fill(7), 'stagenet');
  const intent = ledger.Intent.new(ttl);
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
    Array.from({ length: inputs }, (_, index) => ({ value: 18n, owner: keystore.getPublicKey(), type: NIGHT, intentHash: '33'.repeat(32), outputNo: index })),
    [{ value: 18n * BigInt(inputs) - 10n, owner: keystore.getAddress(), type: NIGHT }, { value: 5_000n, owner: keystore.getAddress(), type: TOKEN }], []);
  const proven = await ledger.Transaction.fromParts('stagenet').addIntent({ tag: 'specific', value: 7 }, intent)
    .prove(noProver, ledger.CostModel.initialCostModel());
  return ledger.Transaction.deserialize('signature', 'proof', 'binding', signLedger9Intents(proven, keystore).bind().serialize());
}

/** The wallet's own balancing part: its TOKEN coin in, the change and the 10 NIGHT out. Signed, not yet proven. */
function takerCarrier(ttl: Date): ledger.UnprovenTransaction {
  const keystore = ledger9Keystore(new Uint8Array(32).fill(1), 'stagenet');
  const intent = ledger.Intent.new(ttl);
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
    [{ value: 10_000n, owner: keystore.getPublicKey(), type: TOKEN, intentHash: '11'.repeat(32), outputNo: 0 }],
    [{ value: 5_000n, owner: keystore.getAddress(), type: TOKEN }, { value: 10n, owner: keystore.getAddress(), type: NIGHT }], []);
  return signLedger9Intents(ledger.Transaction.fromParts('stagenet').addIntent({ tag: 'specific', value: 1 }, intent), keystore);
}

const spendsOf = (tx: ledger.UnprovenTransaction) => [...(tx.intents?.values() ?? [])].flatMap(intent => intent.dustActions?.spends ?? []);

describe('a swap fee paid with the fewest DUST spends that fit the validation-time limit', () => {
  it('one input on each side: one spend, inside the wallet\'s own intent, and the ledger finds it paid', async () => {
    const w = dustWallet(8);
    try {
      const ttl = new Date(w.now.getTime() + 300_000);
      const maker = await makerOffer(ttl, 1);
      const fee = spreadLightDust9(w.local, w.key, 'stagenet', [maker], takerCarrier(ttl), ttl, w.now, w.parameters);
      expect(spendsOf(fee)).toHaveLength(1);
      // Still one intent, still the wallet's signed input.
      expect([...fee.intents!.keys()]).toEqual([1]);
      expect(fee.intents!.get(1)!.guaranteedUnshieldedOffer!.signatures).toHaveLength(1);
      const params = ledger.LedgerParameters.deserialize(Buffer.from(w.parameters, 'hex'));
      const mock: SealedTransaction9 = ledger.Transaction.deserialize('signature', 'proof', 'binding', fee.mockProve().serialize());
      expect(() => maker.merge(mock).cost(params, true)).not.toThrow();
      // Well formed with the fee balanced, against the chain the DUST came from.
      const strict = new ledger.WellFormedStrictness();
      strict.verifySignatures = false;
      strict.verifyContractProofs = false;
      strict.verifyNativeProofs = false;
      expect(() => maker.eraseProofs().merge(fee.eraseProofs()).wellFormed(w.chain, strict, w.now)).not.toThrow();
    } finally { w.key.clear(); }
  });

  it('a second signed input on the other side: four spends, from four different coins', async () => {
    const w = dustWallet(8);
    try {
      const ttl = new Date(w.now.getTime() + 300_000);
      const maker = await makerOffer(ttl, 2);
      const fee = spreadLightDust9(w.local, w.key, 'stagenet', [maker], takerCarrier(ttl), ttl, w.now, w.parameters);
      const spends = spendsOf(fee);
      expect(spends).toHaveLength(4);
      expect(new Set(spends.map(spend => spend.oldNullifier)).size).toBe(4);
      // The first coin pays; the others spend one unit each.
      expect(spends.filter(spend => spend.vFee === 1n)).toHaveLength(3);
      // Capped below what fits, or held in too few coins: refused, with the code the UI translates.
      expect(() => spreadLightDust9(w.local, w.key, 'stagenet', [maker], takerCarrier(ttl), ttl, w.now, w.parameters, { maximumSpends: 3 }))
        .toThrow(DustSpreadError);
    } finally { w.key.clear(); }
    const few = dustWallet(2);
    try {
      const ttl = new Date(few.now.getTime() + 300_000);
      let thrown: unknown;
      try { spreadLightDust9(few.local, few.key, 'stagenet', [await makerOffer(ttl, 2)], takerCarrier(ttl), ttl, few.now, few.parameters); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(DustSpreadError);
      expect((thrown as DustSpreadError).message).toBe(MIDNIGHT_DUST_COINS_SHORT);
      expect((thrown as DustSpreadError).coinsWithDust).toBe(2);
    } finally { few.key.clear(); }
  });

  it('with no carrier, pays from a new intent in a free segment', async () => {
    const w = dustWallet(8);
    try {
      const ttl = new Date(w.now.getTime() + 300_000);
      // A balanced part of one's own (nothing for the wallet to add) still needs its fee.
      const keystore = ledger9Keystore(new Uint8Array(32).fill(7), 'stagenet');
      const intent = ledger.Intent.new(ttl);
      intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
        [{ value: 18n, owner: keystore.getPublicKey(), type: NIGHT, intentHash: '33'.repeat(32), outputNo: 0 }],
        [{ value: 18n, owner: keystore.getAddress(), type: NIGHT }], []);
      const proven = await ledger.Transaction.fromParts('stagenet').addIntent({ tag: 'specific', value: 1 }, intent)
        .prove(noProver, ledger.CostModel.initialCostModel());
      const balanced: SealedTransaction9 = ledger.Transaction.deserialize('signature', 'proof', 'binding', signLedger9Intents(proven, keystore).bind().serialize());
      const fee = spreadLightDust9(w.local, w.key, 'stagenet', [balanced], undefined, ttl, w.now, w.parameters);
      expect([...fee.intents!.keys()]).toEqual([2]);
      expect(spendsOf(fee).length).toBeGreaterThanOrEqual(1);
    } finally { w.key.clear(); }
  });
});
