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
import * as ledger from '@midnight-ntwrk/ledger-v8';
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

/** A DUST fee spend: one generating NIGHT UTxO, one DUST output, spent for a small fee (iOS proverSpikeCore fixture). */
function dustSpendTx(): ledger.UnprovenTransaction {
  const params = ledger.LedgerParameters.initialParameters().dust;
  const sk = ledger.DustSecretKey.fromSeed(SEED);
  const created = new Date('2026-06-01T00:00:00Z');
  const now = new Date('2026-06-08T00:00:00Z');
  const backingNight = '11'.repeat(32);
  const generation: ledger.DustGenerationInfo = { value: 5_000_000_000n, owner: sk.publicKey, nonce: backingNight, dtime: undefined };
  const qdo: ledger.QualifiedDustOutput = {
    initialValue: 1_000_000n, owner: sk.publicKey, nonce: 42n, seq: 0, ctime: created, backingNight, mtIndex: 0n,
  };
  let state = new ledger.DustLocalState(params);
  state = state.insertGenerationInfo(0n, generation, backingNight);
  state = state.insertCommitment(0n, qdo, true);
  state = state.addUtxo(ledger.dustNullifier(qdo, sk), qdo);
  const available = ledger.updatedValue(created, qdo.initialValue, generation, now, params);
  const [, spend] = state.spend(sk, qdo, available < 1_000n ? available : 1_000n, now);
  const actions = new ledger.DustActions<ledger.SignatureEnabled, ledger.PreProof>('signature', 'pre-proof', now, [spend], []);
  const intent = ledger.Intent.new(new Date(now.getTime() + 3_600_000));
  intent.dustActions = actions;
  return ledger.Transaction.fromParts('preprod', undefined, undefined, intent);
}

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
  it('match the files shipped in the package', async () => {
    const bundled = midnightZkFilesFor(MIDNIGHT_ZK_CIRCUITS).filter((f) => f.source === 'bundled');
    expect(bundled.map((f) => f.name).sort()).toEqual(
      ['bls_midnight_2p13', 'dust-9-spend.bzkir', 'dust-9-spend.prover', 'dust-9-spend.verifier'],
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
    await expect(readVerifiedZkFile(short, DUST_SPEND_CIRCUIT.ir)).rejects.toThrow(/expected 2555/);
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
  // end-to-end check that zkir 2.1.0, the pinned keys and the SRS make proofs the
  // ledger accepts. A DUST spend cannot be checked this way: on a blank state
  // `wellFormed` accepts even a corrupted DUST proof, so only a live send verifies it.
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
