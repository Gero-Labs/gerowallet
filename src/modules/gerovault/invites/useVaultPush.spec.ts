// A vault push that arrives while a page is open: the inbox row the worker wrote is the signal.
import { describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, reactive } from 'vue';
import type { NotifyInboxItem } from '@/stores/notifyInboxStore';
import { newVaultPushes, useVaultPush, vaultPushMarks } from './useVaultPush';

const SETUP = 'a1'.repeat(16);
const row = (over: Partial<NotifyInboxItem> = {}): NotifyInboxItem => ({
  e: 'e1', t: 'vault_response', c: 'vault_invite', d: 'vault', x: { setupId: SETUP }, walletId: null, walletName: null,
  title: 'A cosigner answered', body: 'Dana joined Ops', ts: 1000, readAt: null, needsYou: false, ...over,
});

describe('vault push marks', () => {
  it('reads only vault rows, with their type and a well-formed setup id', () => {
    const marks = vaultPushMarks([
      row(),
      row({ e: 'e2', t: 'vault_invite', x: { setupId: 'not hex', ref: 'x' } }),
      row({ e: 'e3', t: 'received', d: 'activity' }),
      row({ e: 'e4', d: 'vault', t: 'something_else' }),
    ]);
    expect([...marks.keys()]).toEqual(['e1', 'e2']);
    expect(marks.get('e1')?.event).toEqual({ t: 'vault_response', setupId: SETUP });
    expect(marks.get('e2')?.event).toEqual({ t: 'vault_invite' });
  });

  it('a new row and a repeated push are new; an unchanged or read row is not', () => {
    const before = vaultPushMarks([row()]);
    expect(newVaultPushes(before, vaultPushMarks([row({ readAt: 5 })]))).toEqual([]);
    expect(newVaultPushes(before, vaultPushMarks([row({ ts: 2000 })]))).toEqual([{ t: 'vault_response', setupId: SETUP }]);
    expect(newVaultPushes(before, vaultPushMarks([row(), row({ e: 'e9', t: 'vault_invite' })]))).toEqual([{ t: 'vault_invite', setupId: SETUP }]);
  });
});

describe('useVaultPush', () => {
  function inbox(items: NotifyInboxItem[], loaded = true) {
    const state = reactive({ items, loaded });
    return { state, source: { items: () => state.items, loaded: () => state.loaded } };
  }

  it('calls back for a push that arrives, not for the rows already there', async () => {
    const { state, source } = inbox([row()]);
    const onPush = vi.fn();
    const scope = effectScope();
    scope.run(() => useVaultPush(onPush, source));
    await nextTick();
    expect(onPush).not.toHaveBeenCalled();

    state.items = [row({ e: 'e2', t: 'vault_invite', ts: 3000 }), row()];
    await nextTick();
    expect(onPush).toHaveBeenCalledTimes(1);
    expect(onPush).toHaveBeenLastCalledWith({ t: 'vault_invite', setupId: SETUP });

    // Marking it read changes the row but is no push; a second answer for the same setup is.
    state.items = state.items.map(i => ({ ...i, readAt: 9 }));
    await nextTick();
    expect(onPush).toHaveBeenCalledTimes(1);
    state.items = [row({ ts: 4000 }), state.items[0]];
    await nextTick();
    expect(onPush).toHaveBeenCalledTimes(2);
    expect(onPush).toHaveBeenLastCalledWith({ t: 'vault_response', setupId: SETUP });

    scope.stop();
    state.items = [row({ ts: 5000 })];
    await nextTick();
    expect(onPush).toHaveBeenCalledTimes(2);
  });

  it('takes the inbox as it first loads as the baseline', async () => {
    const { state, source } = inbox([], false);
    const onPush = vi.fn();
    const scope = effectScope();
    scope.run(() => useVaultPush(onPush, source));
    state.items = [row()];
    state.loaded = true;
    await nextTick();
    expect(onPush).not.toHaveBeenCalled();
    state.items = [row({ ts: 2000 })];
    await nextTick();
    expect(onPush).toHaveBeenCalledTimes(1);
    scope.stop();
  });
});
