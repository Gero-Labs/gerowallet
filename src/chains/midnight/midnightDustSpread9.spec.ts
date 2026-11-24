// @vitest-environment node
// The fee of a swap paid with the fewest DUST spends ledger 9's validation-time
// limit accepts, under real ledger 9 parameters (Preview's, a repo fixture;
// mainnet's of block 3,554,417 gave the same counts on 2026-11-22).
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { CoreWallet, CoinsAndBalances, Keys } from 'midnight-v9-dust-wallet/v2';
import { DustSpreadError, spreadLightDust9, type SealedTransaction9 } from './midnightDustSpread9';
import { MIDNIGHT_DUST_COINS_SHORT } from './midnightConnectorIntent';
import { ledger9Keystore, signLedger9Intents, type Ledger9SignableTransaction } from './midnightLedger9';
import preview from './fixtures/preview-ledger9-parameters.json';

const NIGHT = '00'.repeat(32);
const TOKEN = 'ab'.repeat(32);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const noProver: ledger.ProvingProvider = {
  check: async () => { throw new Error('unexpected proof-server call'); },
  prove: async () => { throw new Error('unexpected proof-server call'); },
  lookupKey: async () => undefined,
};

/**
 * A real ledger 9 chain under Preview's parameters where the wallet's DUST key
 * is backed by `coins` NIGHT UTxOs and, with `makerCoins`, a second key (the
 * other party's) by that many.
 */
function dustWallet(coins: number, makerCoins = 0) {
  const key = ledger.DustSecretKey.fromSeed(new Uint8Array(32).fill(91));
  const nightKey = ledger.signatureVerifyingKey(ledger.sampleSigningKey());
  const makerKey = ledger.DustSecretKey.fromSeed(new Uint8Array(32).fill(92));
  const makerNightKey = ledger.signatureVerifyingKey(ledger.sampleSigningKey());
  let time = new Date((Math.floor(Date.now() / 1000) - 3600) * 1000);
  let chain = ledger.LedgerState.blank('preview');
  chain.parameters = ledger.LedgerParameters.deserialize(Buffer.from(preview.ledgerParameters.replace(/^0x/, ''), 'hex'));
  let local = new ledger.DustLocalState(chain.parameters.dust);
  let makerLocal = new ledger.DustLocalState(chain.parameters.dust);
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
    makerLocal = makerLocal.replayEvents(makerKey, result.events);
    time = new Date(time.getTime() + 1000);
  };
  const backed = [[nightKey, key, coins], [makerNightKey, makerKey, makerCoins]] as const;
  for (const [night, dust, count] of backed) {
    if (count === 0) continue;
    const registration = ledger.Intent.new(new Date(time.getTime() + 300000));
    registration.dustActions = new ledger.DustActions('signature', 'pre-proof', time, [],
      [new ledger.DustRegistration('signature', night, dust.publicKey, 0n)]);
    apply(ledger.Transaction.fromParts('preview', undefined, undefined, registration));
    for (let index = 0; index < count; index++) {
      const amount = 1_000_000_000_000_000n;
      chain = chain.testingDistributeNight(ledger.addressFromKey(night), amount, time);
      apply(ledger.Transaction.fromRewards(new ledger.ClaimRewardsTransaction('signature-erased', 'preview', amount,
        night, (dust === key ? index : 0x80 + index).toString(16).padStart(2, '0').repeat(32), new ledger.SignatureErased())));
    }
  }
  const now = new Date(time.getTime() + 3_000_000);
  const clear = () => { key.clear(); makerKey.clear(); };
  return { key, local, makerKey, makerLocal, now, chain, parameters: hex(chain.parameters.serialize()), clear };
}

const params = (w: { parameters: string }) => ledger.LedgerParameters.deserialize(Buffer.from(w.parameters, 'hex'));
const asSealed = (tx: ledger.UnprovenTransaction): SealedTransaction9 =>
  ledger.Transaction.deserialize('signature', 'proof', 'binding', tx.mockProve().serialize());

/**
 * Well formed against the chain the DUST came from, the fee balanced. (Never
 * on a `mockProve`d part: its binding commitment is not a real one, and the
 * ledger says so.)
 */
function expectWellFormed(w: ReturnType<typeof dustWallet>, parts: Array<ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>>) {
  const strict = new ledger.WellFormedStrictness();
  strict.verifyContractProofs = false;
  strict.verifyNativeProofs = false;
  const erased = parts.map(part => part.eraseProofs() as ledger.Transaction<ledger.SignatureEnabled, ledger.NoProof, ledger.Bindingish>);
  const merged = erased.reduce((sum, part) => sum.merge(part));
  expect(() => merged.wellFormed(w.chain, strict, w.now)).not.toThrow();
}

/**
 * Proves `tx` through `prove` (so `bind` then makes a real binding
 * commitment, unlike `mockProve`'s) with the mock proof `mockProve` makes in
 * place of each DUST spend's proof: enough for proofs that are not verified.
 */
async function proveWithMockProofs(tx: ledger.UnprovenTransaction) {
  const [mocked] = [...(tx.mockProve().intents?.values() ?? [])].flatMap(intent => intent.dustActions?.spends ?? []);
  const prover: ledger.ProvingProvider = {
    check: async () => [], prove: async () => mocked.proof.serialize(), lookupKey: async () => undefined,
  };
  return tx.prove(prover, ledger.CostModel.initialCostModel());
}

/**
 * Every input of the wallet's intent in segment 1 carries a valid signature
 * over that intent as it now is. Checked here because `wellFormed` does not
 * check unshielded signatures (the ledger checks them against the spent UTxO
 * when it applies the transaction, and the fixture's UTxOs do not exist).
 */
function expectSignedByTaker(tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>) {
  const intent = tx.intents!.get(1)!;
  const offer = intent.guaranteedUnshieldedOffer!;
  expect(offer.signatures).toHaveLength(offer.inputs.length);
  for (const signature of offer.signatures) {
    expect(ledger.verifySignature(takerKeystore().getPublicKey(), intent.signatureData(1), signature.value)).toBe(true);
  }
}

/** The maker's offer of {@link makerOffer} with a DUST spend of `vFee` from the maker's key inside its own intent. */
async function makerOfferPaying(w: ReturnType<typeof dustWallet>, ttl: Date, vFee: (largest: bigint) => bigint): Promise<SealedTransaction9> {
  const keystore = ledger9Keystore(new Uint8Array(32).fill(7), 'preview');
  const keysCapability = Keys.makeDefaultKeysCapability();
  const wallet = CoreWallet.init(w.makerLocal, w.makerKey, 'preview');
  const [coin] = CoinsAndBalances.makeDefaultCoinsAndBalancesCapability({}, () => ({ keysCapability }))
    .getAvailableCoinsWithGeneratedDust(wallet, w.now).toSorted((a, b) => (a.value > b.value ? -1 : 1));
  const [spends] = CoreWallet.spendCoins(wallet, w.makerKey, [{ token: coin.token, value: vFee(coin.value) }], w.now);
  const intent = ledger.Intent.new(ttl);
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
    [{ value: 18n, owner: keystore.getPublicKey(), type: NIGHT, intentHash: '33'.repeat(32), outputNo: 0 }],
    [{ value: 8n, owner: keystore.getAddress(), type: NIGHT }, { value: 5_000n, owner: keystore.getAddress(), type: TOKEN }], []);
  intent.dustActions = new ledger.DustActions('signature', 'pre-proof', w.now, [...spends], []);
  const proven = await proveWithMockProofs(signLedger9Intents(ledger.Transaction.fromParts('preview').addIntent({ tag: 'specific', value: 7 }, intent), keystore));
  return ledger.Transaction.deserialize('signature', 'proof', 'binding', proven.bind().serialize());
}

/** Another party's sealed swap offer: `inputs` NIGHT coins in, 10 NIGHT left over, 5,000 TOKEN asked for. */
async function makerOffer(ttl: Date, inputs: number): Promise<SealedTransaction9> {
  const keystore = ledger9Keystore(new Uint8Array(32).fill(7), 'preview');
  const intent = ledger.Intent.new(ttl);
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
    Array.from({ length: inputs }, (_, index) => ({ value: 18n, owner: keystore.getPublicKey(), type: NIGHT, intentHash: '33'.repeat(32), outputNo: index })),
    [{ value: 18n * BigInt(inputs) - 10n, owner: keystore.getAddress(), type: NIGHT }, { value: 5_000n, owner: keystore.getAddress(), type: TOKEN }], []);
  const proven = await ledger.Transaction.fromParts('preview').addIntent({ tag: 'specific', value: 7 }, intent)
    .prove(noProver, ledger.CostModel.initialCostModel());
  return ledger.Transaction.deserialize('signature', 'proof', 'binding', signLedger9Intents(proven, keystore).bind().serialize());
}

const takerKeystore = () => ledger9Keystore(new Uint8Array(32).fill(1), 'preview');

/**
 * The wallet's own balancing part: its TOKEN coin in, the change and the 10
 * NIGHT out. Unsigned, as `balanceFinalizedTransaction` hands it over; the
 * spread signs it through {@link sign} once its DUST actions are in.
 */
function takerCarrier(ttl: Date): ledger.UnprovenTransaction {
  const keystore = takerKeystore();
  const intent = ledger.Intent.new(ttl);
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
    [{ value: 10_000n, owner: keystore.getPublicKey(), type: TOKEN, intentHash: '11'.repeat(32), outputNo: 0 }],
    [{ value: 5_000n, owner: keystore.getAddress(), type: TOKEN }, { value: 10n, owner: keystore.getAddress(), type: NIGHT }], []);
  return ledger.Transaction.fromParts('preview').addIntent({ tag: 'specific', value: 1 }, intent);
}
const sign = <T extends Ledger9SignableTransaction>(tx: T): T => signLedger9Intents(tx, takerKeystore());

const spendsOf = (tx: ledger.UnprovenTransaction) => [...(tx.intents?.values() ?? [])].flatMap(intent => intent.dustActions?.spends ?? []);
const paidBy = (tx: ledger.UnprovenTransaction) => spendsOf(tx).reduce((sum, spend) => sum + spend.vFee, 0n);

afterEach(() => { vi.restoreAllMocks(); });

describe('a swap fee paid with the fewest DUST spends that fit the validation-time limit', () => {
  it('one input on each side: one spend, inside the wallet\'s own intent, signed after it, and the ledger finds it paid', async () => {
    const w = dustWallet(8);
    try {
      const ttl = new Date(w.now.getTime() + 300_000);
      const maker = await makerOffer(ttl, 1);
      const fee = spreadLightDust9(w.local, w.key, 'preview', [maker], takerCarrier(ttl), ttl, w.now, w.parameters, { sign });
      expect(spendsOf(fee)).toHaveLength(1);
      // Still one intent, now with the wallet's input signed.
      expect([...fee.intents!.keys()]).toEqual([1]);
      // The signature is made over the intent WITH its DUST spend: one made
      // before the spend was added would not verify.
      expectSignedByTaker(fee);
      const early = sign(takerCarrier(ttl)).intents!.get(1)!.guaranteedUnshieldedOffer!.signatures[0];
      expect(ledger.verifySignature(takerKeystore().getPublicKey(), fee.intents!.get(1)!.signatureData(1), early.value)).toBe(false);
      expect(() => maker.merge(asSealed(fee)).cost(params(w), true)).not.toThrow();
      // The fee is balanced against the chain the DUST came from.
      expectWellFormed(w, [maker, fee]);
      // Signed before proving, then proven, signed again and bound as the
      // pipeline does: the second pass leaves the signature as it is, it still
      // verifies, and the bound result is well formed.
      const bound = sign(await proveWithMockProofs(fee)).bind();
      expect(hex(bound.intents!.get(1)!.guaranteedUnshieldedOffer!.signatures[0].serialize()))
        .toBe(hex(fee.intents!.get(1)!.guaranteedUnshieldedOffer!.signatures[0].serialize()));
      expectSignedByTaker(bound);
      expectWellFormed(w, [maker, bound]);
    } finally { w.clear(); }
  });

  it('a second signed input on the other side: four spends, from four different coins', async () => {
    const w = dustWallet(8);
    try {
      const ttl = new Date(w.now.getTime() + 300_000);
      const maker = await makerOffer(ttl, 2);
      const fee = spreadLightDust9(w.local, w.key, 'preview', [maker], takerCarrier(ttl), ttl, w.now, w.parameters, { sign });
      const spends = spendsOf(fee);
      expect(spends).toHaveLength(4);
      expect(new Set(spends.map(spend => spend.oldNullifier)).size).toBe(4);
      // The first coin pays; the others spend one unit each.
      expect(spends.filter(spend => spend.vFee === 1n)).toHaveLength(3);
      expectSignedByTaker(fee);
      expectWellFormed(w, [maker, fee]);
      // Capped below what fits, or held in too few coins: refused, with the
      // code the UI translates. (Refused, not rethrown: the ledger's real
      // over-the-limit error is the one the spread recognises.)
      expect(() => spreadLightDust9(w.local, w.key, 'preview', [maker], takerCarrier(ttl), ttl, w.now, w.parameters, { maximumSpends: 3, sign }))
        .toThrow(DustSpreadError);
    } finally { w.clear(); }
    const few = dustWallet(2);
    try {
      const ttl = new Date(few.now.getTime() + 300_000);
      let thrown: unknown;
      try { spreadLightDust9(few.local, few.key, 'preview', [await makerOffer(ttl, 2)], takerCarrier(ttl), ttl, few.now, few.parameters, { sign }); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(DustSpreadError);
      expect((thrown as DustSpreadError).message).toBe(MIDNIGHT_DUST_COINS_SHORT);
      expect((thrown as DustSpreadError).coinsWithDust).toBe(2);
    } finally { few.clear(); }
  });

  it('an offer that pays its own fee: the wallet pays only the rest, and the ledger finds the whole fee paid', async () => {
    const w = dustWallet(8, 2);
    try {
      const ttl = new Date(w.now.getTime() + 300_000);
      const bare = await makerOffer(ttl, 1);
      const alone = spreadLightDust9(w.local, w.key, 'preview', [bare], takerCarrier(ttl), ttl, w.now, w.parameters, { sign });
      // The offer's own fee (with the DUST spend it is about to carry), paid by the maker as makeIntent with payFees does.
      const ownFee = (await makerOfferPaying(w, ttl, () => 1n)).feesWithMargin(params(w), 1);
      const paying = await makerOfferPaying(w, ttl, () => ownFee);
      const fee = spreadLightDust9(w.local, w.key, 'preview', [paying], takerCarrier(ttl), ttl, w.now, w.parameters, { sign });
      expect(spendsOf(fee).length).toBeGreaterThanOrEqual(1);
      // Clearly less: about the offer's own fee less.
      expect(paidBy(fee)).toBeLessThan(paidBy(alone) - ownFee / 2n);
      expectSignedByTaker(fee);
      expectWellFormed(w, [paying, fee]);
    } finally { w.clear(); }
  });

  it('nothing left to pay: the carrier comes back signed with no DUST action, and without a carrier an empty transaction', async () => {
    const w = dustWallet(8, 2);
    try {
      const ttl = new Date(w.now.getTime() + 300_000);
      // The offer pays far more than the whole swap's fee.
      const paying = await makerOfferPaying(w, ttl, largest => largest);
      const fee = spreadLightDust9(w.local, w.key, 'preview', [paying], takerCarrier(ttl), ttl, w.now, w.parameters, { sign });
      expect(spendsOf(fee)).toHaveLength(0);
      expect(fee.intents!.get(1)!.dustActions).toBeUndefined();
      expectSignedByTaker(fee);
      expectWellFormed(w, [paying, fee]);

      const none = spreadLightDust9(w.local, w.key, 'preview', [paying], undefined, ttl, w.now, w.parameters, { sign });
      expect(none.intents?.size ?? 0).toBe(0);
      // Proven, bound and merged as the pipeline does: the offer comes out unchanged.
      const proven = await none.prove(noProver, ledger.CostModel.initialCostModel());
      const merged = paying.merge(sign(proven).bind());
      expect(hex(merged.serialize())).toBe(hex(paying.serialize()));
    } finally { w.clear(); }
  });

  it('only the ledger\'s over-the-limit refusal means "try another count": any other failure is not "too few coins"', async () => {
    const w = dustWallet(8);
    try {
      const ttl = new Date(w.now.getTime() + 300_000);
      const maker = await makerOffer(ttl, 1);
      vi.spyOn(ledger.Transaction.prototype, 'cost').mockImplementation(() => { throw new Error('cost model unavailable'); });
      expect(() => spreadLightDust9(w.local, w.key, 'preview', [maker], takerCarrier(ttl), ttl, w.now, w.parameters, { sign }))
        .toThrow('cost model unavailable');
      vi.restoreAllMocks();
      expect(() => spreadLightDust9(w.local, w.key, 'preview', [maker], takerCarrier(ttl), ttl, w.now, w.parameters,
        { sign: () => { throw new Error('signing failed'); } })).toThrow('signing failed');
    } finally { w.clear(); }
  });

  it('with no carrier, pays from a new intent in a free segment', async () => {
    const w = dustWallet(8);
    try {
      const ttl = new Date(w.now.getTime() + 300_000);
      // A balanced part of one's own (nothing for the wallet to add) still needs its fee.
      const keystore = ledger9Keystore(new Uint8Array(32).fill(7), 'preview');
      const intent = ledger.Intent.new(ttl);
      intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
        [{ value: 18n, owner: keystore.getPublicKey(), type: NIGHT, intentHash: '33'.repeat(32), outputNo: 0 }],
        [{ value: 18n, owner: keystore.getAddress(), type: NIGHT }], []);
      const proven = await ledger.Transaction.fromParts('preview').addIntent({ tag: 'specific', value: 1 }, intent)
        .prove(noProver, ledger.CostModel.initialCostModel());
      const balanced: SealedTransaction9 = ledger.Transaction.deserialize('signature', 'proof', 'binding', signLedger9Intents(proven, keystore).bind().serialize());
      const fee = spreadLightDust9(w.local, w.key, 'preview', [balanced], undefined, ttl, w.now, w.parameters);
      expect([...fee.intents!.keys()]).toEqual([2]);
      expect(spendsOf(fee).length).toBeGreaterThanOrEqual(1);
    } finally { w.clear(); }
  });
});
