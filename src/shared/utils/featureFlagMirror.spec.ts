import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetPrivateStoreForTest, setPrivate } from '@/utils/privateStore';
import { FEATURE_FLAG_MIRROR_KEY, readFeatureFlagMirror, writeFeatureFlagMirror } from './featureFlagMirror';
import { refreshEnvelopeV2Flag, setEnvelopeV2EnabledForTest } from './envelopeV2Flag';

const ROOT = join(__dirname, '..', '..', '..');
const local = new Map<string, unknown>();

beforeEach(async () => {
  local.clear();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'ext-id' },
    storage: {
      local: {
        get: async (key: string) => (local.has(key) ? { [key]: local.get(key) } : {}),
        set: async (items: Record<string, unknown>) => { for (const [k, v] of Object.entries(items)) local.set(k, v); },
        remove: async (key: string) => { local.delete(key); },
      },
    },
  };
  setEnvelopeV2EnabledForTest(null);
  resetPrivateStoreForTest();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('gero-private-store');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
});

describe('feature flag mirror', () => {
  it('round-trips the flags through the private store and drops the chrome.storage copy', async () => {
    local.set(FEATURE_FLAG_MIRROR_KEY, { isWalletConnectEnabled: true });
    await writeFeatureFlagMirror({ isWalletConnectEnabled: false, collateralTrustedDapps: ['https://dapp.example'] });
    expect(await readFeatureFlagMirror()).toEqual({ isWalletConnectEnabled: false, collateralTrustedDapps: ['https://dapp.example'] });
    expect(local.has(FEATURE_FLAG_MIRROR_KEY)).toBe(false);
  });

  it('never reads a value planted in chrome.storage.local', async () => {
    local.set(FEATURE_FLAG_MIRROR_KEY, { isKeyEnvelopeV2Enabled: true, collateralTrustedDapps: ['https://evil.example'] });
    expect(await readFeatureFlagMirror()).toEqual({});
    expect(await refreshEnvelopeV2Flag()).toBe(false);
  });

  it('reads as empty when the stored value is not a flag map', async () => {
    await setPrivate(FEATURE_FLAG_MIRROR_KEY, ['not', 'a', 'map']);
    expect(await readFeatureFlagMirror()).toEqual({});
  });

  it('feeds the envelope kill switch', async () => {
    await writeFeatureFlagMirror({ isKeyEnvelopeV2Enabled: true });
    expect(await refreshEnvelopeV2Flag()).toBe(true);
    await writeFeatureFlagMirror({ isKeyEnvelopeV2Enabled: false });
    expect(await refreshEnvelopeV2Flag()).toBe(false);
  });

  it('no worker or store code reads the flags from chrome.storage any more', () => {
    for (const file of ['src/chrome/background.ts', 'src/services/walletManager.service.ts', 'src/shared/utils/envelopeV2Flag.ts', 'src/stores/featureFlagsStore.ts']) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source, file).not.toMatch(/storage\.local\.(get|set)\(\s*(\{\s*)?'?featureFlags/);
    }
  });
});
