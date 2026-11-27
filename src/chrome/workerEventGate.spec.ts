import { describe, expect, it, vi } from 'vitest';
import { createWorkerEventGate } from './workerEventGate';

function fakeEvent() {
  const extended: Array<Promise<unknown>> = [];
  return { extended, event: { waitUntil: (p: Promise<unknown>) => { extended.push(p); } } };
}

describe('workerEventGate', () => {
  it('holds an event that arrives before its handler, inside waitUntil, and releases it once the handler is installed', async () => {
    const gate = createWorkerEventGate();
    const { extended, event } = fakeEvent();

    gate.listener('push')(event);
    // waitUntil is called during dispatch, before any handler exists.
    expect(extended).toHaveLength(1);

    const handler = vi.fn(async () => 'done');
    let settled = false;
    void extended[0].then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.setHandler('push', handler);
    await extended[0];
    expect(handler).toHaveBeenCalledWith(event);
    expect(settled).toBe(true);
  });

  it('runs an installed handler in the dispatch turn, before waitUntil (a synthetic event has no usable one)', () => {
    const gate = createWorkerEventGate();
    const handler = vi.fn(async () => undefined);
    gate.setHandler('notificationclick', handler);

    gate.listener('notificationclick')({});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('releases every held event of that type, in order, and only that type', async () => {
    const gate = createWorkerEventGate();
    const a = fakeEvent();
    const b = fakeEvent();
    const other = fakeEvent();
    gate.listener('push')(a.event);
    gate.listener('push')(b.event);
    gate.listener('pushsubscriptionchange')(other.event);

    const seen: unknown[] = [];
    gate.setHandler('push', (async (event: unknown) => { seen.push(event); }) as never);
    await Promise.all([a.extended[0], b.extended[0]]);
    expect(seen).toEqual([a.event, b.event]);

    const change = vi.fn(async () => undefined);
    gate.setHandler('pushsubscriptionchange', change);
    await other.extended[0];
    expect(change).toHaveBeenCalledWith(other.event);
  });

  it('never rejects the promise handed to waitUntil, even when the handler fails', async () => {
    const gate = createWorkerEventGate();
    gate.setHandler('push', async () => { throw new Error('boom'); });
    const { extended, event } = fakeEvent();
    gate.listener('push')(event);
    await expect(extended[0]).resolves.toBeUndefined();
  });

  it('survives an event whose waitUntil throws', () => {
    const gate = createWorkerEventGate();
    const handler = vi.fn(async () => undefined);
    gate.setHandler('push', handler);
    expect(() => gate.listener('push')({ waitUntil: () => { throw new Error('not extendable'); } })).not.toThrow();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
