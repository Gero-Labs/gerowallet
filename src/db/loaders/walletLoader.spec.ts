import { describe, it, expect } from 'vitest';
import { TransactionsLoader } from './walletLoader';

type Amount = { unit: string; quantity: number };
type Utxo = { tx_hash?: string; output_index?: number; address?: string; amount?: Amount[] };

// Surface the pure private methods under test without leaking `any`.
interface LoaderInternals {
  resolveInputAmounts(
    inputs: Utxo[] | undefined,
    outputIndex: Map<string, { address?: string; amount?: unknown[] }>,
  ): Utxo[] | undefined;
  calculateFinalAssets(sent: Map<string, Amount>, received: Map<string, Amount>): Amount[];
}

// The private methods under test are pure and don't touch the DB, so a loader
// with stubbed context is enough.
function makeLoader(): LoaderInternals {
  const ctx = {
    baseAddress: '',
    stakeAddress: '',
    chain: 'Cardano',
    network: 'Mainnet',
    isEnterpriseAddress: () => false,
    networkId: () => 1,
    setUtxosAndAddresses: async () => {},
  };
  return new TransactionsLoader(async () => ({}) as never, ctx as never) as unknown as LoaderInternals;
}

const lovelace = (q: number) => ({ unit: 'lovelace', quantity: q });
const tok = (unit: string, q: number) => ({ unit, quantity: q });

describe('TransactionsLoader.resolveInputAmounts', () => {
  it('backfills native tokens from the producing output for a lovelace-only input', () => {
    const loader = makeLoader();
    const outputIndex = new Map<string, { address?: string; amount?: unknown[] }>([
      ['prev#1', { address: 'addr_own', amount: [lovelace(3255), tok('USDM', 30), tok('A', 5)] }],
    ]);
    const inputs = [{ tx_hash: 'prev', output_index: 1, address: 'addr_own', amount: [lovelace(3255)] }];

    const out = loader.resolveInputAmounts(inputs, outputIndex)!;

    expect(out[0].amount).toHaveLength(3);
    expect(out[0].amount!.map((a) => a.unit)).toContain('USDM');
    // source input is not mutated
    expect(inputs[0].amount).toHaveLength(1);
  });

  it('leaves the input unchanged when the producing tx is not synced', () => {
    const loader = makeLoader();
    const inputs = [{ tx_hash: 'x', output_index: 0, address: 'a', amount: [lovelace(10)] }];

    const out = loader.resolveInputAmounts(inputs, new Map())!;

    expect(out[0]).toBe(inputs[0]);
  });

  it('keeps the input amount when it is already richer than the producing output', () => {
    const loader = makeLoader();
    const outputIndex = new Map([['p#0', { address: 'a', amount: [lovelace(1)] }]]);
    const inputs = [{ tx_hash: 'p', output_index: 0, address: 'a', amount: [lovelace(1), tok('T', 2)] }];

    const out = loader.resolveInputAmounts(inputs, outputIndex)!;

    expect(out[0].amount).toHaveLength(2);
  });

  it('preserves an existing input address over the producing output address', () => {
    const loader = makeLoader();
    const outputIndex = new Map([['p#0', { address: 'addr_producer', amount: [lovelace(2), tok('T', 1)] }]]);
    const inputs = [{ tx_hash: 'p', output_index: 0, address: 'addr_input', amount: [lovelace(2)] }];

    const out = loader.resolveInputAmounts(inputs, outputIndex)!;

    expect(out[0].address).toBe('addr_input');
    expect(out[0].amount).toHaveLength(2); // still gains the token from the producer
  });

  it('returns the value unchanged for empty/undefined inputs', () => {
    const loader = makeLoader();
    expect(loader.resolveInputAmounts(undefined, new Map())).toBeUndefined();
    expect(loader.resolveInputAmounts([], new Map())).toEqual([]);
  });
});

describe('TransactionsLoader.calculateFinalAssets', () => {
  it('nets received against sent per unit; equal token sets cancel (only the delta remains)', () => {
    const loader = makeLoader();
    // Send 10 USDM: own input holds 30 USDM + 5 A; change output returns 20 USDM + 5 A.
    const sent = new Map<string, Amount>([
      ['USDM', tok('USDM', 30)],
      ['A', tok('A', 5)],
    ]);
    const received = new Map<string, Amount>([
      ['USDM', tok('USDM', 20)],
      ['A', tok('A', 5)],
    ]);

    const final = loader.calculateFinalAssets(sent, received);

    expect(final).toHaveLength(1); // A cancels (5-5=0)
    expect(final[0].unit).toBe('USDM');
    expect(final[0].quantity).toBe(-10);
  });

  it('includes sent-only units as negative and received-only units as positive', () => {
    const loader = makeLoader();
    const sent = new Map<string, Amount>([['S', tok('S', 7)]]);
    const received = new Map<string, Amount>([['R', tok('R', 4)]]);

    const final = loader.calculateFinalAssets(sent, received);
    const byUnit = Object.fromEntries(final.map((a) => [a.unit, a.quantity]));

    expect(byUnit).toEqual({ S: -7, R: 4 });
  });
});
