import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: send } }));
vi.mock('@/models/MessageTypes', () => ({ MessageTypes: { SUBMIT_TX: 'SUBMIT_TX' } }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('@/modules/swap/composables/utxoToCip30Hex', () => ({
  utxoToCip30Hex: (u: [{ index: number }]) => `hex${u[0].index}`,
}));

const WALLET_UTXOS = [[{ txId: 'a', index: 0 }], [{ txId: 'a', index: 1 }]];
const wallet: { loggedWallet: Record<string, unknown> | null; utxos: unknown[] } = {
  loggedWallet: null,
  utxos: [],
};
vi.mock('@/stores/walletStore', () => ({ walletStore: wallet }));

const buildOrder = vi.fn();
vi.mock('../services/realfiOrders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/realfiOrders')>()),
  buildOrder: (...args: unknown[]) => buildOrder(...args),
}));

const { useRealFiOrder, SigningCancelled } = await import('./useRealFiOrder');
const { RealFiOrderError } = await import('../services/realfiOrders');

const STAKE = { kind: 'stake', amount: '5000000' } as const;

describe('useRealFiOrder', () => {
  const signTx = vi.fn();

  beforeEach(() => {
    wallet.loggedWallet = { network: 'Preprod', baseAddress: 'addr_test1qbase' };
    wallet.utxos = WALLET_UTXOS;
    buildOrder.mockReset().mockResolvedValue({ txCbor: '84a4unsigned', txHash: 'h' });
    signTx.mockReset().mockResolvedValue('a100witness');
    send.mockReset().mockResolvedValue({ data: { txId: 'tx-on-chain' } });
  });

  it('builds from every wallet UTxO, signs those exact bytes, and submits them', async () => {
    const order = useRealFiOrder({ signTx });

    await expect(order.run(STAKE)).resolves.toBe('tx-on-chain');

    expect(buildOrder).toHaveBeenCalledWith(STAKE, {
      network: 'Preprod',
      changeAddress: 'addr_test1qbase',
      utxos: ['hex0', 'hex1'],
    });
    expect(signTx).toHaveBeenCalledWith('84a4unsigned');
    // Opaque: the unsigned CBOR goes to the background untouched, with the witnesses beside it.
    expect(send).toHaveBeenCalledWith({
      method: 'SUBMIT_TX',
      data: { txCbor: '84a4unsigned', witnessHex: 'a100witness', utxos: WALLET_UTXOS },
    });
    expect(order.stage.value).toBe('done');
    expect(order.txId.value).toBe('tx-on-chain');
  });

  it('stops at a refused build and keeps the reason and reference', async () => {
    buildOrder.mockRejectedValue(new RealFiOrderError('not-authorized', 'srv-corr-1'));
    const order = useRealFiOrder({ signTx });

    await expect(order.run(STAKE)).resolves.toBeNull();

    expect(order.stage.value).toBe('error');
    expect(order.error.value).toMatchObject({ reason: 'not-authorized', correlationId: 'srv-corr-1' });
    expect(signTx).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('treats a dismissed prompt as a change of mind, not a failure', async () => {
    signTx.mockRejectedValue(new SigningCancelled());
    const order = useRealFiOrder({ signTx });

    await expect(order.run(STAKE)).resolves.toBeNull();

    expect(order.stage.value).toBe('idle');
    expect(order.error.value).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("recognises the shared signer's own dismissals", async () => {
    signTx.mockRejectedValue(new Error('PassKey authentication cancelled'));
    const order = useRealFiOrder({ signTx });

    await order.run(STAKE);

    expect(order.stage.value).toBe('idle');
  });

  it('says so when the password was wrong', async () => {
    signTx.mockRejectedValue(new Error('Invalid spending password'));
    const order = useRealFiOrder({ signTx });

    await order.run(STAKE);

    expect(order.error.value?.reason).toBe('wrong-password');
  });

  it('reports a rejected submission as such', async () => {
    send.mockResolvedValue({ data: { error: 'BadInputsUTxO' } });
    const order = useRealFiOrder({ signTx });

    await expect(order.run(STAKE)).resolves.toBeNull();

    expect(order.error.value?.reason).toBe('submit-failed');
  });

  it('builds nothing without the wallet address', async () => {
    wallet.loggedWallet = { network: 'Preprod' };
    const order = useRealFiOrder({ signTx });

    await order.run(STAKE);

    expect(buildOrder).not.toHaveBeenCalled();
    expect(order.error.value?.reason).toBe('build-failed');
  });

  it('ignores a second order while one is in flight', async () => {
    let release: (v: unknown) => void = () => {};
    buildOrder.mockReturnValue(new Promise((r) => (release = r)));
    const order = useRealFiOrder({ signTx });

    const first = order.run(STAKE);
    await expect(order.run(STAKE)).resolves.toBeNull();
    release({ txCbor: '84a4unsigned', txHash: 'h' });
    await first;

    expect(buildOrder).toHaveBeenCalledTimes(1);
  });
});
