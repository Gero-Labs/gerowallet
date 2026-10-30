import { describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { historySource, koiosSource, outputRef, proveOutputs, provenOutput, sameOutput } from './provenInputs';

const keyCred = (c: string) => ({ type: Cardano.CredentialType.KeyHash, hash: c.repeat(56) as Cardano.Credential['hash'] });
const base = (pay: string, stake: string) =>
  Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Testnet, keyCred(pay), keyCred(stake)).toAddress().toBech32();
const OWN = base('a', 'b');
const OTHER = base('c', 'd');
const TOKEN = `${'a'.repeat(56)}474552` as Cardano.AssetId;

/** Real transaction CBOR paying `coins` to OWN (output 0) and 2 ADA to OTHER (output 1). */
function creatingTx(coins: bigint, opts: { invalid?: boolean; seed?: string } = {}) {
  const core = {
    id: '0'.repeat(64),
    body: {
      inputs: [{ txId: (opts.seed ?? '1').repeat(64), index: 0 }],
      outputs: [
        { address: OWN, value: { coins, assets: new Map([[TOKEN, 7n]]) } },
        { address: OTHER, value: { coins: 2_000_000n } },
      ],
      fee: 200_000n,
      ...(opts.invalid ? { collateralReturn: { address: OWN, value: { coins: 4_000_000n } } } : {}),
    },
    witness: { signatures: new Map() },
    ...(opts.invalid ? { isValid: false } : {}),
  } as unknown as Cardano.Tx;
  const tx = Serialization.Transaction.fromCore(core);
  return { cbor: tx.toCbor(), hash: String(tx.getId()) };
}

describe('provenOutput', () => {
  it('reads an output from CBOR that hashes to the claimed transaction id', () => {
    const { cbor, hash } = creatingTx(100_000_000n);
    const out = provenOutput(cbor, hash, 0);
    expect(String(out?.address)).toBe(OWN);
    expect(out?.value.coins).toBe(100_000_000n);
    expect(out?.value.assets?.get(TOKEN)).toBe(7n);
  });

  it('rejects CBOR of another transaction served under the claimed id (a tampered value)', () => {
    const real = creatingTx(1_000_000_000n);
    const tampered = creatingTx(1_000_000n); // same shape, smaller value: a different body, so a different id
    expect(provenOutput(tampered.cbor, real.hash, 0)).toBeNull();
  });

  it('rejects an index the transaction did not create, and undecodable CBOR', () => {
    const { cbor, hash } = creatingTx(5_000_000n);
    expect(provenOutput(cbor, hash, 2)).toBeNull();
    expect(provenOutput('deadbeef', hash, 0)).toBeNull();
  });

  it('a transaction whose scripts failed created only its collateral return', () => {
    const { cbor, hash } = creatingTx(5_000_000n, { invalid: true });
    expect(provenOutput(cbor, hash, 0)).toBeNull();
    expect(provenOutput(cbor, hash, 2)?.value.coins).toBe(4_000_000n);
  });
});

describe('proveOutputs', () => {
  it('proves from the wallet history first and fetches only what is missing', async () => {
    const a = creatingTx(10_000_000n, { seed: '2' });
    const b = creatingTx(20_000_000n, { seed: '3' });
    const fetchMore = vi.fn(async (hashes: string[]) => new Map(hashes.filter((h) => h === b.hash).map((h) => [h, b.cbor])));
    const { proven, unproven } = await proveOutputs(
      [`${a.hash}#0`, `${b.hash}#1`],
      [historySource([{ tx_hash: a.hash, cbor: a.cbor }]), fetchMore],
    );
    expect(unproven).toEqual([]);
    expect(proven.get(`${a.hash}#0`)?.value.coins).toBe(10_000_000n);
    expect(String(proven.get(`${b.hash}#1`)?.address)).toBe(OTHER);
    expect(fetchMore).toHaveBeenCalledWith([b.hash]);
  });

  it('ignores a source that serves the wrong CBOR and moves on to the next', async () => {
    const real = creatingTx(1_000_000_000n, { seed: '4' });
    const lie = creatingTx(1_000_000n, { seed: '4' });
    const { proven, unproven } = await proveOutputs([`${real.hash}#0`], [
      async () => new Map([[real.hash, lie.cbor]]),
      async () => { throw new Error('offline'); },
      async () => new Map([[real.hash, real.cbor]]),
    ]);
    expect(unproven).toEqual([]);
    expect(proven.get(`${real.hash}#0`)?.value.coins).toBe(1_000_000_000n);
  });

  it('reports what no source can prove', async () => {
    const a = creatingTx(1n, { seed: '5' });
    const { proven, unproven } = await proveOutputs([`${a.hash}#0`, 'not-a-ref'], [async () => new Map()]);
    expect(proven.size).toBe(0);
    expect(unproven.sort()).toEqual([`${a.hash}#0`, 'not-a-ref'].sort());
  });
});

describe('koiosSource', () => {
  it('asks Koios tx_cbor for the hashes, on the wallet\'s network', async () => {
    const a = creatingTx(3n, { seed: '6' });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ tx_hash: a.hash.toUpperCase(), cbor: a.cbor }]), { status: 200 }));
    const found = await koiosSource('Preprod', fetchImpl as unknown as typeof fetch)([a.hash]);
    expect(found.get(a.hash)).toBe(a.cbor);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://preprod.koios.rest/api/v1/tx_cbor');
    expect(JSON.parse(String(init.body))).toEqual({ _tx_hashes: [a.hash] });
    expect(init.credentials).toBe('omit');
  });

  it('has nothing for a network Koios does not serve', async () => {
    const fetchImpl = vi.fn();
    expect((await koiosSource('Stagenet', fetchImpl as unknown as typeof fetch)(['a'.repeat(64)])).size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails on an error answer, so the next source is tried', async () => {
    const fetchImpl = vi.fn(async () => new Response('busy', { status: 429 }));
    await expect(koiosSource('Mainnet', fetchImpl as unknown as typeof fetch)(['a'.repeat(64)])).rejects.toThrow('429');
  });
});

describe('sameOutput / outputRef', () => {
  it('compares address and value, tokens included', () => {
    const a = { address: OWN, value: { coins: 5n, assets: new Map([[TOKEN, 1n]]) } } as unknown as Cardano.TxOut;
    expect(sameOutput(a, { ...a })).toBe(true);
    expect(sameOutput(a, { ...a, value: { coins: 5n } } as Cardano.TxOut)).toBe(false);
    expect(sameOutput(a, { ...a, address: OTHER } as Cardano.TxOut)).toBe(false);
  });

  it('formats refs the way txIntentGuard does', () => {
    expect(outputRef({ txId: 'AB'.repeat(32), index: 3 })).toBe(`${'ab'.repeat(32)}#3`);
  });
});
