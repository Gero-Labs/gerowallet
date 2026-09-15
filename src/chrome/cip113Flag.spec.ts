// src/chrome/cip113Flag.spec.ts
//
// The runtime half of the CIP-113 gate. What matters here is the direction it fails in:
// an unreadable or absent mirror must read as OFF, because the build-time deployment list
// is the only other gate and it cannot be changed without a store review.
import { describe, it, expect, beforeEach } from 'vitest';

type StorageListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void;

const listeners: StorageListener[] = [];
let stored: Record<string, unknown> = {};
let getImpl: (key: string) => Promise<Record<string, unknown>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stand-in for the chrome namespace
(globalThis as any).chrome = {
  runtime: { id: 'test-extension' },
  storage: {
    local: { get: (key: string) => getImpl(key) },
    onChanged: { addListener: (fn: StorageListener) => listeners.push(fn) },
  },
};

const { isCip113Enabled, refreshCip113Flag, setCip113EnabledForTest } = await import('./cip113Flag');

function emitChange(flags: Record<string, unknown> | undefined) {
  for (const fn of listeners) fn({ featureFlags: { newValue: flags } }, 'local');
}

describe('CIP-113 runtime kill-switch', () => {
  beforeEach(() => {
    stored = {};
    getImpl = async () => stored;
    setCip113EnabledForTest(false);
  });

  it('reads false when the mirror has no entry', async () => {
    expect(await refreshCip113Flag()).toBe(false);
    expect(isCip113Enabled()).toBe(false);
  });

  it('reads true only for an explicit boolean true', async () => {
    stored = { featureFlags: { isCip113Enabled: true } };
    expect(await refreshCip113Flag()).toBe(true);

    // A truthy string is a malformed flag value, not an opt-in.
    stored = { featureFlags: { isCip113Enabled: 'true' } };
    expect(await refreshCip113Flag()).toBe(false);
  });

  it('falls back to off when the mirror cannot be read', async () => {
    stored = { featureFlags: { isCip113Enabled: true } };
    await refreshCip113Flag();
    expect(isCip113Enabled()).toBe(true);

    getImpl = () => Promise.reject(new Error('storage unavailable'));
    expect(await refreshCip113Flag()).toBe(false);
  });

  it('picks up a live flip without another refresh', async () => {
    stored = { featureFlags: { isCip113Enabled: true } };
    await refreshCip113Flag(); // also registers the storage listener
    expect(isCip113Enabled()).toBe(true);

    emitChange({ isCip113Enabled: false });
    expect(isCip113Enabled()).toBe(false);

    emitChange({ isCip113Enabled: true });
    expect(isCip113Enabled()).toBe(true);

    // A mirror wiped entirely (e.g. storage cleared) reads as off, not as unchanged.
    emitChange(undefined);
    expect(isCip113Enabled()).toBe(false);
  });

  it('ignores changes to other keys and other storage areas', async () => {
    stored = { featureFlags: { isCip113Enabled: true } };
    await refreshCip113Flag();

    for (const fn of listeners) {
      fn({ somethingElse: { newValue: { isCip113Enabled: false } } }, 'local');
      fn({ featureFlags: { newValue: { isCip113Enabled: false } } }, 'sync');
    }
    expect(isCip113Enabled()).toBe(true);
  });
});
