// @vitest-environment node
//
// The pinned key material, checked against the real files and the real zkir
// prover. A real DUST-spend preimage (built with the ledger from fixed test
// keys, no chain) is `check`ed on every run; set MIDNIGHT_PROVE=1 to also
// prove it and print timings, and MIDNIGHT_ZK_KEYS_DIR=<dir with the hosted
// files> to time the Zswap circuits the shielded flag would use.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from 'node:process';
import { describe, expect, it } from 'vitest';
// Ledger 9 (generation 10 DUST keys) with zkir-v2 2.2.0, which fixes in-process DUST proofs (midnight-ledger#832).
import * as ledger from '@midnightntwrk/ledger-v9';
import * as zkir from '@midnight-ntwrk/zkir-v2';
import {
  allowedMidnightZkCircuits,
  DUST_SPEND_CIRCUIT,
  midnightZkFilesFor,
  MIDNIGHT_SRS_FILES,
  MIDNIGHT_ZK_CIRCUITS,
  type MidnightZkFile,
} from './midnightZkKeys';
import { makePinnedKeyMaterial, MidnightZkKeyError, readVerifiedZkFile } from './midnightZkKeyMaterial';

const BUNDLED_DIR = join(__dirname, '../../assets/midnight-zk');
const HOSTED_DIR = env['MIDNIGHT_ZK_KEYS_DIR'];

async function fetchFromDisk(file: MidnightZkFile): Promise<Uint8Array> {
  const dir = file.source === 'bundled' ? BUNDLED_DIR : HOSTED_DIR;
  if (!dir) throw new Error(`no directory for ${file.name}`);
  return new Uint8Array(await readFile(join(dir, file.name)));
}

const SEED = new Uint8Array(32).map((_, i) => (i * 7 + 1) & 0xff);

/**
 * A DUST fee spend from a real ledger 9 chain: a DUST registration, NIGHT
 * distributed to the registered key, an hour of generation, then a small spend
 * from the wallet's replayed state (no network involved).
 */
function dustSpendFixture(): { tx: ledger.UnprovenTransaction; chain: ledger.LedgerState; now: Date } {
  const sk = ledger.DustSecretKey.fromSeed(SEED);
  const nightKey = ledger.signatureVerifyingKey({ tag: 'schnorr', value: Buffer.from(SEED).toString('hex') });
  let time = new Date('2026-06-01T00:00:00Z');
  let chain = ledger.LedgerState.blank('preprod');
  let local = new ledger.DustLocalState(chain.parameters.dust);
  const apply = (tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>) => {
    // Fixture manufacture only: no proofs or signatures exist yet.
    const strict = new ledger.WellFormedStrictness();
    strict.enforceBalancing = false;
    strict.verifySignatures = false;
    const seconds = BigInt(time.getTime() / 1000);
    const context = new ledger.TransactionContext(chain, { secondsSinceEpoch: seconds,
      secondsSinceEpochErr: 0, lastBlockTime: seconds - 1n, parentBlockHash: '00'.repeat(32) });
    const [next, result] = chain.apply(tx.eraseProofs().wellFormed(chain, strict, time), context);
    if (result.type !== 'success') throw new Error(`fixture transaction failed: ${result.error}`);
    chain = next.postBlockUpdate(time);
    local = local.replayEvents(sk, result.events);
    time = new Date(time.getTime() + 1000);
  };
  const registration = ledger.Intent.new(new Date(time.getTime() + 300_000));
  registration.dustActions = new ledger.DustActions('signature', 'pre-proof', time, [],
    [new ledger.DustRegistration('signature', nightKey, sk.publicKey, 0n)]);
  apply(ledger.Transaction.fromParts('preprod', undefined, undefined, registration));
  const amount = 5_000_000_000n;
  chain = chain.testingDistributeNight(ledger.addressFromKey(nightKey), amount, time);
  apply(ledger.Transaction.fromRewards(new ledger.ClaimRewardsTransaction('signature-erased', 'preprod', amount,
    nightKey, 'ab'.repeat(32), new ledger.SignatureErased())));
  const now = new Date(time.getTime() + 3_600_000);
  const [, spend] = local.spend(sk, local.utxos[0], 1_000n, now);
  const intent = ledger.Intent.new(new Date(now.getTime() + 3_600_000));
  intent.dustActions = new ledger.DustActions<ledger.SignatureEnabled, ledger.PreProof>('signature', 'pre-proof', now, [spend], []);
  sk.clear();
  return { tx: ledger.Transaction.fromParts('preprod', undefined, undefined, intent), chain, now };
}

const dustSpendTx = (): ledger.UnprovenTransaction => dustSpendFixture().tx;

/** A shielded spend of one coin the fixture wallet owns. */
function zswapSpendTx(): ledger.UnprovenTransaction {
  const keys = ledger.ZswapSecretKeys.fromSeed(SEED);
  const type = ledger.shieldedToken().raw;
  const coin = ledger.createShieldedCoinInfo(type, 1_000_000n);
  let state = new ledger.ZswapLocalState();
  state = state.insertCoin(keys, coin);
  const [owned] = [...state.coins];
  const [, input] = state.spend(keys, owned, 0);
  return ledger.Transaction.fromParts('preprod', ledger.ZswapOffer.fromInput(input, type, 1_000_000n));
}

/** Runs `tx.prove` and hands back each preimage the ledger asked to prove, with its key location. */
async function capturePreimages(tx: ledger.UnprovenTransaction): Promise<Array<{ preimage: Uint8Array; keyLocation: string }>> {
  const seen: Array<{ preimage: Uint8Array; keyLocation: string }> = [];
  const capture: ledger.ProvingProvider = {
    lookupKey: async () => undefined,
    check: async () => [],
    prove: async (preimage, keyLocation) => {
      seen.push({ preimage: new Uint8Array(preimage), keyLocation });
      throw new Error('captured');
    },
  };
  await tx.prove(capture, ledger.CostModel.initialCostModel()).catch(() => undefined);
  return seen;
}

describe('midnightZkKeys pins', () => {
  it('are the ledger 9.1.0.1 generation 10 DUST keys', () => {
    expect(DUST_SPEND_CIRCUIT.prover).toMatchObject({ hostPath: 'dust/10/spend.prover', bytes: 2_175_878,
      sha256: '3dff9f54add761350ad02621a425d67fe3d656c8145fef8ef147870489ffdc81' });
    expect(DUST_SPEND_CIRCUIT.verifier).toMatchObject({ hostPath: 'dust/10/spend.verifier', bytes: 1_351,
      sha256: 'd15a1295780549f534287a39c938005e1faa3232be21861573bd0cdb148949cb' });
    expect(DUST_SPEND_CIRCUIT.ir).toMatchObject({ hostPath: 'dust/10/spend.bzkir', bytes: 2_584,
      sha256: 'd211cacb22391b9db60f945787d98c16d344cbb4790246132117084c080399c1' });
  });

  it('match the files shipped in the package', async () => {
    const bundled = midnightZkFilesFor(MIDNIGHT_ZK_CIRCUITS).filter((f) => f.source === 'bundled');
    expect(bundled.map((f) => f.name).sort()).toEqual(
      ['bls_midnight_2p13', 'dust-10-spend.bzkir', 'dust-10-spend.prover', 'dust-10-spend.verifier'],
    );
    for (const file of bundled) {
      await expect(readVerifiedZkFile(fetchFromDisk, file)).resolves.toHaveLength(file.bytes);
    }
  });

  it('keep the SRS sizes the ledger defines (192 * 2^k + 388)', () => {
    for (const [k, file] of Object.entries(MIDNIGHT_SRS_FILES)) {
      expect(file.bytes).toBe(192 * 2 ** Number(k) + 388);
    }
  });

  it('allow only the DUST fee circuit unless shielded proving is asked for', () => {
    expect(allowedMidnightZkCircuits(false).map((c) => c.keyLocation)).toEqual(['midnight/dust/spend']);
    expect(allowedMidnightZkCircuits(true).map((c) => c.keyLocation)).toEqual([
      'midnight/dust/spend', 'midnight/zswap/spend', 'midnight/zswap/output', 'midnight/zswap/sign',
    ]);
  });
});

describe('makePinnedKeyMaterial', () => {
  it('serves the DUST circuit and its k=13 parameters', async () => {
    const km = makePinnedKeyMaterial(fetchFromDisk, zkir, { shielded: false });
    const material = await km.lookupKey(DUST_SPEND_CIRCUIT.keyLocation);
    expect(material?.proverKey).toHaveLength(DUST_SPEND_CIRCUIT.prover.bytes);
    expect(await km.getParams(13)).toHaveLength(MIDNIGHT_SRS_FILES[13].bytes);
  });

  it('has no key for a Zswap or contract circuit without the shielded scope', async () => {
    const km = makePinnedKeyMaterial(fetchFromDisk, zkir, { shielded: false });
    expect(await km.lookupKey('midnight/zswap/spend')).toBeUndefined();
    expect(await km.lookupKey('some-contract/transfer')).toBeUndefined();
    await expect(km.getParams(15)).rejects.toBeInstanceOf(MidnightZkKeyError);
    await expect(km.preload('midnight/zswap/spend')).rejects.toBeInstanceOf(MidnightZkKeyError);
  });

  it('refuses a key file that does not match its pin, and retries the next time', async () => {
    let proverReads = 0;
    const tampered = async (file: MidnightZkFile) => {
      const first = file.name === DUST_SPEND_CIRCUIT.prover.name && (proverReads += 1) === 1;
      const bytes = await fetchFromDisk(file);
      if (first) bytes[100] ^= 0xff;
      return bytes;
    };
    const km = makePinnedKeyMaterial(tampered, zkir, { shielded: false });
    await expect(km.lookupKey(DUST_SPEND_CIRCUIT.keyLocation)).rejects.toThrow(/does not match its pinned hash/);
    await expect(km.lookupKey(DUST_SPEND_CIRCUIT.keyLocation)).resolves.toBeDefined();
  });

  it('refuses a truncated file before hashing it', async () => {
    const short = async (file: MidnightZkFile) => (await fetchFromDisk(file)).subarray(0, 10);
    await expect(readVerifiedZkFile(short, DUST_SPEND_CIRCUIT.ir)).rejects.toThrow(/expected 2584/);
  });

  it('satisfies a real DUST spend witness with zkir (check)', async () => {
    const [{ preimage, keyLocation }] = await capturePreimages(dustSpendTx());
    expect(keyLocation).toBe('midnight/dust/spend');
    const km = makePinnedKeyMaterial(fetchFromDisk, zkir, { shielded: false });
    const result = await zkir.provingProvider(km).check(preimage, keyLocation);
    expect(Array.isArray(result)).toBe(true);
  });

  it.runIf(env['MIDNIGHT_PROVE'] === '1')('proves a real DUST spend on this machine', async () => {
    const km = makePinnedKeyMaterial(fetchFromDisk, zkir, { shielded: false });
    const provider = zkir.provingProvider(km);
    const timings: number[] = [];
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      const proven = await dustSpendTx().prove(provider, ledger.CostModel.initialCostModel());
      timings.push(Math.round(performance.now() - started));
      expect(proven.serialize().length).toBeGreaterThan(2_900);
    }
    console.info(`[midnight-prove] dust/spend ms (cold, warm, warm): ${timings.join(', ')}`);
  }, 180_000);

  // The ledger verifies a Zswap output proof without chain state, so this is the
  // end-to-end check that zkir 2.2.0, the pinned keys and the SRS make proofs the
  // ledger accepts. A DUST spend cannot be checked this way: on a blank state
  // `wellFormed` accepts even a corrupted DUST proof (also on a ledger 9 chain
  // with the spent coin in it: checked), so only a live send verifies it.
  it.runIf(env['MIDNIGHT_PROVE'] === '1' && !!HOSTED_DIR)('makes proofs the ledger verifies, and the ledger rejects a corrupted one', async () => {
    const keys = ledger.ZswapSecretKeys.fromSeed(SEED);
    const type = ledger.shieldedToken().raw;
    const outputTx = () => ledger.Transaction.fromParts('preprod', ledger.ZswapOffer.fromOutput(
      ledger.ZswapOutput.new(ledger.createShieldedCoinInfo(type, 1_000_000n), 0, keys.coinPublicKey, keys.encryptionPublicKey),
      type, 1_000_000n,
    ));
    const strictness = new ledger.WellFormedStrictness();
    strictness.enforceBalancing = false;
    strictness.verifyNativeProofs = true;
    strictness.verifyContractProofs = false;
    strictness.enforceLimits = false;
    strictness.verifySignatures = false;
    const verify = (tx: { wellFormed(state: ledger.LedgerState, strictness: ledger.WellFormedStrictness, tblock: Date): unknown }) =>
      tx.wellFormed(ledger.LedgerState.blank('preprod'), strictness, new Date());

    const provider = zkir.provingProvider(makePinnedKeyMaterial(fetchFromDisk, zkir, { shielded: true }));
    const good = await outputTx().prove(provider, ledger.CostModel.initialCostModel());
    expect(() => verify(good)).not.toThrow();
    const corrupting: ledger.ProvingProvider = {
      lookupKey: provider.lookupKey,
      check: provider.check,
      prove: async (preimage, keyLocation, overwrite) => {
        const proof = await provider.prove(preimage, keyLocation, overwrite);
        proof[proof.length - 40] ^= 0xff;
        return proof;
      },
    };
    const corrupted = await outputTx().prove(corrupting, ledger.CostModel.initialCostModel());
    expect(() => verify(corrupted)).toThrow(/Invalid proof/);
  }, 300_000);

  it.runIf(env['MIDNIGHT_PROVE'] === '1' && !!HOSTED_DIR)('proves a Zswap spend with the shielded scope', async () => {
    const km = makePinnedKeyMaterial(fetchFromDisk, zkir, { shielded: true });
    const started = performance.now();
    const proven = await zswapSpendTx().prove(zkir.provingProvider(km), ledger.CostModel.initialCostModel());
    console.info(`[midnight-prove] zswap/spend ms: ${Math.round(performance.now() - started)}`);
    expect(proven.serialize().length).toBeGreaterThan(4_000);
  }, 600_000);
});
