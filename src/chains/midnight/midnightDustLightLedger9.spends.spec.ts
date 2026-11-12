// @vitest-environment node
// Ledger 9 can reject a contract call whose fee is paid with exactly one DUST
// spend (OutsideTimeToDismiss, midnight-ledger#838). The connector asks for two.
import { describe, expect, it } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { balanceLightDust9 } from './midnightDustLightLedger9';
import signing from './fixtures/nexus-ledger-signing.json';
import preview from './fixtures/preview-ledger9-parameters.json';
import { MIDNIGHT_DUST_FEE_CEILING, dustShortForFee } from './midnightFeeEstimate';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

/** A real ledger 9 chain where one DUST key is backed by `rewards.length` NIGHT UTxOs. */
function dustWallet(rewards: bigint[]) {
  const key = ledger.DustSecretKey.fromSeed(new Uint8Array(32).fill(91));
  const nightKey = ledger.signatureVerifyingKey(ledger.sampleSigningKey());
  let time = new Date((Math.floor(Date.now() / 1000) - 3600) * 1000);
  let chain = ledger.LedgerState.blank('stagenet');
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
  rewards.forEach((amount, index) => {
    chain = chain.testingDistributeNight(ledger.addressFromKey(nightKey), amount, time);
    apply(ledger.Transaction.fromRewards(new ledger.ClaimRewardsTransaction('signature-erased', 'stagenet', amount,
      nightKey, index.toString(16).padStart(2, '0').repeat(32), new ledger.SignatureErased())));
  });
  // Let both coins generate.
  const now = new Date(time.getTime() + 3_000_000);
  /** The ledger's own check: well formed, fees balanced, against the chain at `now`. */
  const balanced = (tx: ledger.UnprovenTransaction) => {
    const strict = new ledger.WellFormedStrictness();
    strict.verifySignatures = false;
    strict.verifyContractProofs = false;
    strict.verifyNativeProofs = false;
    tx.eraseProofs().wellFormed(chain, strict, now);
  };
  return { key, local, now, balanced, parameters: hex(chain.parameters.serialize()) };
}

function spends(tx: ledger.UnprovenTransaction): ledger.DustSpend<ledger.PreProof>[] {
  return [...(tx.intents?.values() ?? [])].flatMap(intent => intent.dustActions?.spends ?? []);
}

describe('connector fees paid with two or more DUST spends', () => {
  const amount = 1_000_000_000_000_000n;
  const fee = (w: ReturnType<typeof dustWallet>, minimumSpends?: number) => balanceLightDust9(
    w.local, w.key, 'stagenet', [ledger.Transaction.fromParts('stagenet')],
    new Date(w.now.getTime() + 300_000), w.now, w.parameters, { minimumSpends });

  it('takes one coin by default, two when asked, from a wallet with two coins', () => {
    const w = dustWallet([amount, amount]);
    try {
      expect(w.local.utxos).toHaveLength(2);
      expect(spends(fee(w))).toHaveLength(1);
      const spread = spends(fee(w, 2));
      expect(spread).toHaveLength(2);
      expect(new Set(spread.map(spend => spend.oldNullifier)).size).toBe(2);
      // The two spends still pay at least what the single one did (the fee only grows with each spend).
      expect(spread.reduce((sum, spend) => sum + spend.vFee, 0n)).toBeGreaterThanOrEqual(spends(fee(w))[0].vFee);
      // And the ledger finds both balanced (and an unpaid transaction not).
      const unpaid = ledger.Transaction.fromParts('stagenet', undefined, undefined, ledger.Intent.new(new Date(w.now.getTime() + 300_000)));
      expect(() => w.balanced(unpaid)).toThrow();
      expect(() => w.balanced(fee(w))).not.toThrow();
      expect(() => w.balanced(fee(w, 2))).not.toThrow();
    } finally { w.key.clear(); }
  });

  it('keeps the single spend when the wallet has one coin', () => {
    const w = dustWallet([amount]);
    try {
      expect(spends(fee(w, 2))).toHaveLength(1);
    } finally { w.key.clear(); }
  });
});

// #1452 M14: the review's fee estimate (midnightFeeEstimate.ts) against real
// ledger 9 parameters (Preview's) and real Nexus builds.
describe('ledger 9 fees for an unshielded send', () => {
  it.each([1, 2])('a %i-input NIGHT transfer costs well over the old "< 0.000001" and under 1 DUST', (count) => {
    const w = dustWallet([1_000_000_000_000_000n]);
    try {
      const vector = signing.transfers.find(t => t.network === 'stagenet' && t.count === count && t.token === '00'.repeat(32))!;
      const tx: ledger.UnprovenTransaction = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', Buffer.from(vector.unprovenTxHex, 'hex'));
      const paid = spends(balanceLightDust9(w.local, w.key, 'stagenet', [tx], new Date(w.now.getTime() + 300_000), w.now, preview.ledgerParameters))
        .reduce((sum, spend) => sum + spend.vFee, 0n);
      const DUST = 10n ** 15n;
      expect(paid).toBeGreaterThan(DUST / 1_000_000n);
      expect(paid).toBeLessThan(DUST);
      // The review's low-DUST warning starts at the bound the measured fee stays under.
      expect(MIDNIGHT_DUST_FEE_CEILING).toBe(DUST);
      expect([dustShortForFee(DUST - 1n), dustShortForFee(DUST)]).toEqual([true, false]);
    } finally { w.key.clear(); }
  });
});

