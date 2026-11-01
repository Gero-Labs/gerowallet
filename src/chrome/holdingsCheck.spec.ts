import { describe, expect, it, vi } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import {
  CONFIRM_GRACE_MS,
  HoldingsCheck,
  koiosAccountTotalSource,
  koiosOutputSource,
  type AccountTotalSource,
  type IndexedOutput,
  type OutputSource,
} from './holdingsCheck';

const OWN = 'addr1qx42424242424242424242424242424242424242424242kvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxqjhw070';
const OTHER = 'addr1qxamhwamhwamhwamhwamhwamhwamhwamhwamhwamhw7venxvenxvenxvenxvenxvenxvenxvenxvenxvenxq2paaha';
const TOKEN = `${'a'.repeat(56)}474552`;
const STAKE = 'stake1uyduqml3cmvy0j8cn3w6qesakn5sqvmfxcgeavuv760r7qqt0am6z';

const tx = (n: number) => n.toString(16).padStart(64, '0');
const ref = (n: number) => `${tx(n)}#0`;

function utxo(n: number, coins: bigint, assets?: [string, bigint][]): Cardano.Utxo {
  return [
    { txId: Cardano.TransactionId(tx(n)), index: 0, address: OWN as Cardano.PaymentAddress },
    { address: OWN as Cardano.PaymentAddress, value: { coins, assets: assets ? new Map(assets.map(([u, q]) => [Cardano.AssetId(u), q])) : undefined } },
  ] as Cardano.Utxo;
}

function indexed(coins: bigint, extra: Partial<IndexedOutput> = {}): IndexedOutput {
  return { address: OWN, coins, assets: new Map(), spent: false, ...extra };
}

/** An indexer that knows exactly `known` (by ref). */
function indexer(known: Map<string, IndexedOutput>): OutputSource & ReturnType<typeof vi.fn> {
  return vi.fn(async (refs: string[]) => new Map(refs.filter((r) => known.has(r)).map((r) => [r, known.get(r)!]))) as never;
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('HoldingsCheck: outputs', () => {
  it('confirms what the indexer has, and asks about it only once', async () => {
    const source = indexer(new Map([[ref(1), indexed(5_000_000n)]]));
    const check = new HoldingsCheck(source, null);
    expect(await check.run([utxo(1, 5_000_000n)], null)).toBe(false);
    await check.run([utxo(1, 5_000_000n)], null);
    expect(source).toHaveBeenCalledTimes(1);
    expect(check.hides(ref(1))).toBe(false);
    expect(check.warning).toBeNull();
    expect(check.pending).toBe(false);
  });

  it('hides at once an output the indexer has with a different address or value, and warns', async () => {
    const check = new HoldingsCheck(indexer(new Map([
      [ref(1), indexed(5_000_000n)],
      [ref(2), indexed(5_000_000n, { address: OTHER })],
      [ref(3), indexed(5_000_000n, { assets: new Map([[TOKEN, 1n]]) })],
    ])), null);
    const changed = await check.run([utxo(1, 500_000_000_000n), utxo(2, 5_000_000n), utxo(3, 5_000_000n, [[TOKEN, 999n]])], null);
    expect(changed).toBe(true);
    expect([1, 2, 3].map((n) => check.hides(ref(n)))).toEqual([true, true, true]);
    expect(check.warning).toEqual({ chainTotal: null });
  });

  it('gives an unknown output the grace period, then hides it and warns (a fabricated UTxO)', async () => {
    const c = clock();
    const check = new HoldingsCheck(indexer(new Map()), null, c.now);
    const fake = utxo(9, 500_000_000_000n);

    expect(await check.run([fake], null)).toBe(false);
    expect(check.hides(ref(9))).toBe(false);
    expect(check.pending).toBe(true);

    c.advance(CONFIRM_GRACE_MS - 1);
    expect(await check.run([fake], null)).toBe(false);
    c.advance(1);
    expect(await check.run([fake], null)).toBe(true);
    expect(check.hides(ref(9))).toBe(true);
    expect(check.warning).not.toBeNull();
    expect(check.pending).toBe(false);
  });

  it('keeps an output the indexer confirms within the grace period (it was just behind)', async () => {
    const c = clock();
    const known = new Map<string, IndexedOutput>();
    const check = new HoldingsCheck(indexer(known), null, c.now);
    await check.run([utxo(1, 5_000_000n)], null);
    c.advance(30_000);
    known.set(ref(1), indexed(5_000_000n));
    await check.run([utxo(1, 5_000_000n)], null);
    c.advance(CONFIRM_GRACE_MS);
    await check.run([utxo(1, 5_000_000n)], null);
    expect(check.hides(ref(1))).toBe(false);
    expect(check.warning).toBeNull();
  });

  it('still catches a fabricated output swapped for a new one before the grace period ends', async () => {
    const c = clock();
    const check = new HoldingsCheck(indexer(new Map()), null, c.now);
    await check.run([utxo(9, 500_000_000_000n)], null);
    c.advance(CONFIRM_GRACE_MS - 1_000);
    await check.run([utxo(10, 500_000_000_000n)], null);
    c.advance(1_000);
    expect(await check.run([utxo(10, 500_000_000_000n)], null)).toBe(true);
    expect(check.warning).not.toBeNull();
  });

  it('does not warn about an output spent and gone before the indexer caught up', async () => {
    const c = clock();
    const known = new Map<string, IndexedOutput>();
    const check = new HoldingsCheck(indexer(known), null, c.now);
    await check.run([utxo(1, 5_000_000n)], null);
    known.set(ref(1), indexed(5_000_000n, { spent: true }));
    c.advance(30_000);
    await check.run([], null);
    c.advance(CONFIRM_GRACE_MS);
    await check.run([], null);
    expect(check.warning).toBeNull();
    expect(check.pending).toBe(false);
  });

  it('hides an output the backend keeps reporting long after the indexer saw it spent', async () => {
    const c = clock();
    const check = new HoldingsCheck(indexer(new Map([[ref(1), indexed(5_000_000n, { spent: true })]])), null, c.now);
    await check.run([utxo(1, 5_000_000n)], null);
    c.advance(CONFIRM_GRACE_MS);
    expect(await check.run([utxo(1, 5_000_000n)], null)).toBe(true);
    expect(check.hides(ref(1))).toBe(true);
  });

  it('changes nothing while the indexer cannot be reached', async () => {
    const c = clock();
    const down: OutputSource = async () => { throw new Error('Koios down'); };
    const check = new HoldingsCheck(down, null, c.now);
    await check.run([utxo(9, 500_000_000_000n)], null);
    c.advance(10 * CONFIRM_GRACE_MS);
    expect(await check.run([utxo(9, 500_000_000_000n)], null)).toBe(false);
    expect(check.hides(ref(9))).toBe(false);
    expect(check.warning).toBeNull();
  });
});

describe('HoldingsCheck: the account total', () => {
  const total = (value: bigint | Error): AccountTotalSource & ReturnType<typeof vi.fn> =>
    vi.fn(async () => { if (value instanceof Error) throw value; return value; }) as never;
  const noOutputs = indexer(new Map());

  it('warns when the backend total differs from the indexer for the whole grace period, and gives the chain figure', async () => {
    const c = clock();
    const check = new HoldingsCheck(noOutputs, total(70_066_389n), c.now);
    expect(await check.run([], { stakeAddress: STAKE, claimedTotal: 500_070_066_389n })).toBe(false);
    c.advance(CONFIRM_GRACE_MS / 2);
    // A total that keeps changing does not restart the clock.
    await check.run([], { stakeAddress: STAKE, claimedTotal: 600_070_066_389n });
    c.advance(CONFIRM_GRACE_MS / 2);
    expect(await check.run([], { stakeAddress: STAKE, claimedTotal: 700_070_066_389n })).toBe(true);
    expect(check.warning).toEqual({ chainTotal: '70066389' });
  });

  it('lets a mismatch that clears within the grace period pass (the indexer was behind)', async () => {
    const c = clock();
    const chain = total(70_066_389n);
    const check = new HoldingsCheck(noOutputs, chain, c.now);
    await check.run([], { stakeAddress: STAKE, claimedTotal: 75_066_389n });
    chain.mockResolvedValue(75_066_389n);
    c.advance(30_000);
    await check.run([], { stakeAddress: STAKE, claimedTotal: 75_066_389n });
    c.advance(CONFIRM_GRACE_MS);
    await check.run([], { stakeAddress: STAKE, claimedTotal: 75_066_389n });
    expect(check.warning).toBeNull();
    expect(check.pending).toBe(false);
  });

  it('compares nothing when the indexer cannot be reached', async () => {
    const c = clock();
    const check = new HoldingsCheck(noOutputs, total(new Error('down')), c.now);
    await check.run([], { stakeAddress: STAKE, claimedTotal: 1n });
    c.advance(10 * CONFIRM_GRACE_MS);
    expect(await check.run([], { stakeAddress: STAKE, claimedTotal: 1n })).toBe(false);
    expect(check.warning).toBeNull();
  });
});

describe('Koios sources', () => {
  it('reads utxo_info rows, assets included, keyed by ref', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{
      tx_hash: tx(1), tx_index: 0, address: OWN, value: '1758480', is_spent: false,
      asset_list: [{ policy_id: 'a'.repeat(56), asset_name: '474552', quantity: '64424119', decimals: 6 }],
    }])));
    const source = koiosOutputSource('Mainnet', fetchImpl as unknown as typeof fetch)!;
    const found = await source([ref(1)]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.koios.rest/api/v1/utxo_info');
    expect(JSON.parse(String(init.body))).toEqual({ _utxo_refs: [ref(1)], _extended: true });
    expect(found.get(ref(1))).toEqual({ address: OWN, coins: 1_758_480n, assets: new Map([[TOKEN, 64_424_119n]]), spent: false });
  });

  it('reads account_info total_balance', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ stake_address: STAKE, total_balance: '70066389', utxo: '70066389' }])));
    expect(await koiosAccountTotalSource('Mainnet', fetchImpl as unknown as typeof fetch)!(STAKE)).toBe(70_066_389n);
  });

  it('serves no network Koios does not index', () => {
    expect(koiosOutputSource('Sanchonet')).toBeNull();
    expect(koiosAccountTotalSource(undefined)).toBeNull();
  });
});
