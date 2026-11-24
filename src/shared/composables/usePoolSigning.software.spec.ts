import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { usePoolSigning } from './usePoolSigning';

const calls = vi.hoisted(() => ({ message: vi.fn(), success: vi.fn(), error: vi.fn(), completed: vi.fn() }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: calls.message } }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({
  loggedWallet: { type: 'normal', chain: 'Cardano', network: 'Mainnet' }, utxos: [], keys: {},
}) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/plugins/snackbar', () => ({ default: { fireSuccess: calls.success, setError: calls.error } }));

function pool() {
  const tx: Cardano.Tx = {
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      fee: 180_000n,
      inputs: [{ txId: Cardano.TransactionId('11'.repeat(32)), index: 0 }],
      outputs: [{
        address: Cardano.PaymentAddress('addr_test1vqeux7xwusdju9dvsj8h7mca9aup2k439kfmwy773xxc2hcu7zy99'),
        value: { coins: 2_000_000n },
      }],
    },
    witness: { signatures: new Map() },
  };
  return usePoolSigning({ tx: ref(tx), successMessageKey: 'pool.success', onSuccess: calls.completed });
}

describe('software pool signing', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([undefined, { error: 'Message port closed' }, { data: {} }, { data: { txId: ' ' } }])(
    'keeps the pool dialog open if submission is unconfirmed', async reply => {
      calls.message.mockResolvedValueOnce({ data: { witnesses: 'a10080' } }).mockResolvedValueOnce(reply);
      const flow = pool();
      await flow.handleSign();
      expect(calls.message).toHaveBeenCalledTimes(2);
      expect(flow.isSubmit.value).toBe(false);
      expect(calls.error).toHaveBeenCalledWith('errors.submitUnconfirmed');
      expect(calls.success).not.toHaveBeenCalled();
      expect(calls.completed).not.toHaveBeenCalled();
    },
  );

  it('requires the signing result before submitting and the ID before calling onSuccess', async () => {
    const flow = pool();
    calls.message.mockResolvedValueOnce({ data: { witnesses: ' ' } });
    await flow.handleSign();
    expect(calls.message).toHaveBeenCalledTimes(1);
    calls.message.mockResolvedValueOnce({ data: { witnesses: 'a10080' } }).mockResolvedValueOnce({ data: { txId: 'confirmed-id' } });
    await flow.handleSign();
    expect(flow.isSubmit.value).toBe(true);
    expect(calls.completed).toHaveBeenCalledExactlyOnceWith('confirmed-id');
  });
});
