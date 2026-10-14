import { describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { awaitFreshApproval, StaleApprovalError, useApprovalFreshness } from './useApprovalFreshness';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  const request = ref({ id: 'one', transaction: 'first' });
  const wallet = ref('wallet-a');
  const network = ref('mainnet');
  const open = ref(true);
  let approval!: ReturnType<typeof useApprovalFreshness>;
  const wrapper = mount(defineComponent({
    setup() {
      approval = useApprovalFreshness(() => [request.value, wallet.value, network.value], () => open.value);
      return () => null;
    },
  }));
  return { wrapper, approval, request, wallet, network, open };
}

describe('approval freshness across asynchronous authorization', () => {
  it.each(['request', 'transaction', 'wallet', 'network', 'cancel', 'unmount'] as const)(
    'never dispatches signing after %s changes during validation, and requires fresh approval',
    async change => {
      const h = harness();
      const validation = deferred<boolean>();
      const dispatch = vi.fn();
      const current = h.approval.capture();
      const operation = h.approval.run(async () => {
        if (await awaitFreshApproval(() => validation.promise, current)) {
          await awaitFreshApproval(() => dispatch(), current);
        }
      });
      if (change === 'request') h.request.value = { id: 'two', transaction: 'replacement' };
      if (change === 'transaction') h.request.value.transaction = 'replacement';
      if (change === 'wallet') h.wallet.value = 'wallet-b';
      if (change === 'network') h.network.value = 'preprod';
      if (change === 'cancel') h.approval.invalidate();
      if (change === 'unmount') h.wrapper.unmount();
      validation.resolve(true);
      await operation;
      expect(dispatch).not.toHaveBeenCalled();
      expect(current()).toBe(false);
      if (change !== 'unmount') {
        const fresh = h.approval.capture();
        await h.approval.run(() => awaitFreshApproval(async () => { dispatch(); }, fresh));
        expect(dispatch).toHaveBeenCalledOnce();
        h.wrapper.unmount();
      }
    },
  );

  it('invalidates synchronously even if the context changes away and back in one tick', () => {
    const h = harness();
    const current = h.approval.capture();
    h.network.value = 'preprod';
    h.network.value = 'mainnet';
    expect(current()).toBe(false);
    h.wrapper.unmount();
  });

  it('zeroes a private-key result returned after cancellation', async () => {
    const h = harness();
    const authentication = deferred<Uint8Array>();
    const pending = awaitFreshApproval(() => authentication.promise, h.approval.capture());
    const assertion = expect(pending).rejects.toBeInstanceOf(StaleApprovalError);
    h.open.value = false;
    const bytes = Uint8Array.of(17, 29, 31);
    authentication.resolve(bytes);
    await assertion;
    expect(Array.from(bytes)).toEqual([0, 0, 0]);
    h.wrapper.unmount();
  });

  it('allows at most one pending authorization and releases the flight after failure', async () => {
    const h = harness();
    const validation = deferred<void>();
    const work = vi.fn(() => validation.promise);
    const first = h.approval.run(work);
    await h.approval.run(work);
    expect(work).toHaveBeenCalledOnce();
    validation.resolve();
    await first;
    await expect(h.approval.run(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await h.approval.run(work);
    expect(work).toHaveBeenCalledTimes(2);
    h.wrapper.unmount();
  });
});
