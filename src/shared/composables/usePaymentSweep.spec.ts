// One payment, from a wallet whose largest UTxOs one request carries cannot cover it: as a
// sweep (merges, then the payment), or one transaction when they can.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cardano } from '@cardano-sdk/core';

interface NexusInput { txHash: string; outputIndex: number; lovelace: string }
interface NexusRequest { outputs: { address: string; lovelace: string }[]; utxos: NexusInput[]; selectAll?: boolean }

const mocks = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock('@/api/nexus-tx-api', async () => {
  const selection = await vi.importActual<typeof import('@/api/nexusInputSelection')>('@/api/nexusInputSelection');
  return {
    nexusTxApi: { buildTransferTx: mocks.build },
    cardanoUtxoToNexusInput: (utxo: Cardano.Utxo) => ({ txHash: utxo[0].txId, outputIndex: utxo[0].index, lovelace: String(utxo[1].value.coins) }),
    requiredAssetsFromOutputs: () => new Map(),
    selectInputCandidates: selection.selectInputCandidates,
  };
});
vi.mock('@cardano-sdk/core', () => ({ Serialization: { Transaction: { fromCbor: (cbor: string) => ({ toCore: () => JSON.parse(cbor) }) } } }));
vi.mock('@cardano-sdk/util', () => ({ HexBlob: (value: string) => value }));
vi.mock('@/stores/walletStore', () => ({
  walletStore: { loggedWallet: { network: 'Preprod' }, keys: { payment: [{ address: 'own' }] } },
}));

import i18n from '@/plugins/i18n';
import { usePaymentSweep } from './usePaymentSweep';

const txId = (n: number) => n.toString(16).padStart(64, '0');
const utxo = (n: number, coins: number) => [{ txId: txId(n), index: 0 }, { address: 'own', value: { coins } }] as unknown as Cardano.Utxo;
// 205 UTxOs of about 1 ADA: five more than one request carries, about 200 ADA in its candidates.
const wallet = Array.from({ length: 205 }, (_, n) => utxo(n, 1_000_000 + n));
const pay = (ada: number) => ({ outputs: [{ address: 'card', lovelace: String(ada * 1_000_000) }], changeAddress: 'own' });

const isMerge = (request: NexusRequest) => request.outputs.length === 1 && request.outputs[0].address === 'own' && request.outputs[0].lovelace === '0';
const requests = () => mocks.build.mock.calls.map(([request]) => request as NexusRequest);

/** Answers like Nexus: a merge pays its whole batch, less the fee, to its one output; a payment it cannot cover is refused in Nexus's words. */
async function likeNexus(request: NexusRequest) {
  const available = request.utxos.reduce((sum, input) => sum + Number(input.lovelace), 0);
  if (isMerge(request)) {
    return { tx_cbor: JSON.stringify({ id: `merge-${request.utxos[0].txHash.slice(-4)}`, body: { outputs: [{ address: 'own', value: { coins: available - 200 } }], fee: '200' } }) };
  }
  const required = request.outputs.reduce((sum, output) => sum + Number(output.lovelace), 0) + 200;
  if (available < required) {
    throw new Error(`Insufficient ADA. Required: ${required / 1e6} ADA (${required} lovelace), available: ${available / 1e6} ADA (${available} lovelace)`);
  }
  return { tx_cbor: JSON.stringify({ id: `payment-${mocks.build.mock.calls.length}`, body: { inputs: request.utxos, outputs: request.outputs, fee: '200' } }) };
}

beforeEach(() => {
  mocks.build.mockReset().mockImplementation(likeNexus);
});

describe('usePaymentSweep', () => {
  it('builds one transaction when the largest UTxOs cover the payment', async () => {
    const sweep = usePaymentSweep();
    await sweep.build(pay(50), wallet, true);
    expect(requests()).toHaveLength(1);
    expect(requests()[0].utxos).toHaveLength(200);
    expect(requests()[0].selectAll).toBeUndefined();
    expect(sweep.sweep.value).toBeNull();
    expect(sweep.prerequisites.value).toBeNull();
  });

  it('sends a payment the largest UTxOs cannot cover as merges and one payment of every candidate', async () => {
    const sweep = usePaymentSweep();
    const tx = await sweep.build(pay(203), wallet, true);
    expect(requests().filter(isMerge)).toHaveLength(1);
    const payment = requests().at(-1)!;
    expect(isMerge(payment)).toBe(false);
    expect(payment.selectAll).toBe(true);
    expect(payment.utxos).toHaveLength(200);
    expect(payment.utxos.some((input) => input.txHash.startsWith('merge-'))).toBe(true);
    expect(sweep.prerequisites.value?.cbors).toHaveLength(1);
    expect(sweep.payment.value?.tx).toBe(tx);
  });

  it('returns the same payment for the same request, without asking Nexus again', async () => {
    const sweep = usePaymentSweep();
    const first = await sweep.build(pay(203), wallet, true);
    const calls = mocks.build.mock.calls.length;
    expect(await sweep.build(pay(203), wallet, true)).toBe(first);
    expect(mocks.build.mock.calls.length).toBe(calls);
  });

  it('says the balance is spread when the wallet cannot sign a sweep', async () => {
    const sweep = usePaymentSweep();
    await expect(sweep.build(pay(203), wallet, false)).rejects.toThrow(i18n.t('send.inputLimitFragmented', { count: 205, max: 200 }) as string);
    expect(requests().some(isMerge)).toBe(false);
  });

  it('passes on a refusal the whole wallet cannot close', async () => {
    const sweep = usePaymentSweep();
    await expect(sweep.build(pay(300), wallet, true)).rejects.toThrow(/^Insufficient ADA/);
    expect(requests().some(isMerge)).toBe(false);
  });

  // Merging the whole wallet into itself, as a swap needs before it can take a large amount.
  it('consolidates the wallet: the merges, then everything to its own address, once', async () => {
    const sweep = usePaymentSweep();
    const tx = await sweep.consolidate(wallet);
    const [merge, final] = requests();
    expect(requests()).toHaveLength(2);
    expect(merge.selectAll).toBe(true);
    expect(final).toEqual(expect.objectContaining({ outputs: [{ address: 'own', lovelace: '0' }], changeAddress: 'own', selectAll: true }));
    expect(final.utxos).toHaveLength(200);
    expect(final.utxos.some((input) => input.txHash.startsWith('merge-'))).toBe(true);
    expect(sweep.prerequisites.value?.cbors).toHaveLength(1);
    expect(await sweep.consolidate(wallet)).toBe(tx);
    expect(requests()).toHaveLength(2);
  });

  it('consolidates a wallet one request carries in a single transaction', async () => {
    const sweep = usePaymentSweep();
    await sweep.consolidate(wallet.slice(0, 150));
    expect(requests()).toHaveLength(1);
    expect(requests()[0]).toEqual(expect.objectContaining({ outputs: [{ address: 'own', lovelace: '0' }], selectAll: true }));
    expect(requests()[0].utxos).toHaveLength(150);
    expect(sweep.prerequisites.value).toBeNull();
  });

  it('counts the merges while they are built, and gives them up on reset', async () => {
    let release!: () => void;
    mocks.build.mockImplementation(async (request: NexusRequest) => {
      if (isMerge(request)) await new Promise<void>((resolve) => { release = resolve; });
      return likeNexus(request);
    });
    const sweep = usePaymentSweep();
    const building = sweep.build(pay(203), wallet, true);
    await vi.waitFor(() => expect(sweep.preparing.value).toEqual({ built: 0, total: 1, utxoCount: 205, waiting: false }));
    sweep.reset();
    release();
    await expect(building).rejects.toThrow();
    expect(sweep.preparing.value).toBeNull();
    expect(sweep.sweep.value).toBeNull();
    expect(sweep.payment.value).toBeNull();
  });
});
