import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PENDING_DREP_DELEGATION_KEY,
  setPendingDRepDelegation,
  takePendingDRepDelegation,
  onPendingDRepDelegation,
} from './pendingDelegation';

type StorageChange = { newValue?: unknown; oldValue?: unknown };
type ChangeListener = (changes: Record<string, StorageChange>, area: string) => void;

let store: Record<string, unknown>;
let changeListeners: ChangeListener[];

beforeEach(() => {
  store = {};
  changeListeners = [];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
        remove: vi.fn(async (key: string) => {
          delete store[key];
        }),
      },
      onChanged: {
        addListener: (fn: ChangeListener) => changeListeners.push(fn),
        removeListener: (fn: ChangeListener) => {
          changeListeners = changeListeners.filter((l) => l !== fn);
        },
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const fireChange = (change: StorageChange, area = 'local') =>
  changeListeners.forEach((l) => l({ [PENDING_DREP_DELEGATION_KEY]: change }, area));

describe('pendingDelegation', () => {
  it('round-trips a DRep handoff', async () => {
    await setPendingDRepDelegation({ kind: 'drep', drep: { id: 'drep1abc', name: 'Alice' } });

    const taken = await takePendingDRepDelegation();
    expect(taken?.kind).toBe('drep');
    expect(taken?.drep?.id).toBe('drep1abc');
  });

  it('is consumed exactly once', async () => {
    await setPendingDRepDelegation({ kind: 'abstain' });

    expect((await takePendingDRepDelegation())?.kind).toBe('abstain');
    // A second reader (e.g. the storage listener racing the mount path) gets
    // nothing, so a handoff can never build the same transaction twice.
    expect(await takePendingDRepDelegation()).toBeNull();
    expect(store[PENDING_DREP_DELEGATION_KEY]).toBeUndefined();
  });

  it('drops (and clears) a handoff older than five minutes', async () => {
    await setPendingDRepDelegation({ kind: 'noConfidence' });
    store[PENDING_DREP_DELEGATION_KEY] = {
      ...(store[PENDING_DREP_DELEGATION_KEY] as object),
      createdAt: Date.now() - 6 * 60 * 1000,
    };

    // An abandoned handoff must never resurface as a signing dialog later.
    expect(await takePendingDRepDelegation()).toBeNull();
    expect(store[PENDING_DREP_DELEGATION_KEY]).toBeUndefined();
  });

  it('drops a drep handoff with no drep id', async () => {
    await setPendingDRepDelegation({ kind: 'drep' });
    expect(await takePendingDRepDelegation()).toBeNull();
  });

  it('notifies a listener on a write and hands it the payload', async () => {
    const handler = vi.fn();
    onPendingDRepDelegation(handler);

    await setPendingDRepDelegation({ kind: 'drep', drep: { id: 'drep1xyz' } });
    fireChange({ newValue: store[PENDING_DREP_DELEGATION_KEY] });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    expect(handler.mock.calls[0][0].drep.id).toBe('drep1xyz');
  });

  it('ignores the removal it performs itself, and other storage areas', async () => {
    const handler = vi.fn();
    onPendingDRepDelegation(handler);

    fireChange({ oldValue: { kind: 'abstain' } }); // the remove() take() performs
    await setPendingDRepDelegation({ kind: 'abstain' });
    fireChange({ newValue: store[PENDING_DREP_DELEGATION_KEY] }, 'sync');

    await new Promise((r) => setTimeout(r, 0));
    expect(handler).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', async () => {
    const handler = vi.fn();
    const stop = onPendingDRepDelegation(handler);
    stop();

    await setPendingDRepDelegation({ kind: 'abstain' });
    fireChange({ newValue: store[PENDING_DREP_DELEGATION_KEY] });

    await new Promise((r) => setTimeout(r, 0));
    expect(handler).not.toHaveBeenCalled();
  });
});
