import { expect, test, vi } from 'vitest';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import featureFlagService from '@/services/featureFlag.service';
import { writeFeatureFlagMirror } from '@/shared/utils/featureFlagMirror';

// The background's copy of the flags lives in the extension-only private store, not chrome.storage.local.
vi.mock('@/shared/utils/featureFlagMirror', () => ({ writeFeatureFlagMirror: vi.fn(async () => undefined) }));

vi.mock('@/services/featureFlag.service', () => ({
  default: {
    initialize: vi.fn(async () => undefined),
    getFlag: vi.fn((_key: string, fallback: unknown) => fallback),
    onFlagChange: vi.fn(),
    isReady: vi.fn(() => true),
    onReady: vi.fn(),
  },
}));

test('isTrezorWebUsbEnabled defaults to false', () => {
  expect(featureFlagsStore.state.flags.isTrezorWebUsbEnabled).toBe(false);
});

test('exposes isGovernanceEnabled, defaulting to false', () => {
  expect(featureFlagsStore.isGovernanceEnabled()).toBe(false);
});

test('exposes isGovernanceVotingEnabled, defaulting to false', () => {
  expect(featureFlagsStore.isGovernanceVotingEnabled()).toBe(false);
});

test('reflects a remote isGovernanceEnabled flag once loaded', () => {
  vi.mocked(featureFlagService.getFlag).mockImplementation((key: string, fallback: unknown) =>
    key === 'isGovernanceEnabled' ? true : fallback,
  );
  featureFlagsStore.loadFlags();
  expect(featureFlagsStore.isGovernanceEnabled()).toBe(true);
});

test('reflects a remote isGovernanceVotingEnabled flag once loaded', () => {
  vi.mocked(featureFlagService.getFlag).mockImplementation((key: string, fallback: unknown) =>
    key === 'isGovernanceVotingEnabled' ? true : fallback,
  );
  featureFlagsStore.loadFlags();
  expect(featureFlagsStore.isGovernanceVotingEnabled()).toBe(true);
});

test('reset() turns isGovernanceVotingEnabled back off', () => {
  featureFlagsStore.reset();
  expect(featureFlagsStore.isGovernanceVotingEnabled()).toBe(false);
});

test('exposes isCip45Enabled, defaulting to false', () => {
  expect(featureFlagsStore.isCip45Enabled()).toBe(false);
});

test('reflects a remote isCip45Enabled flag once loaded', () => {
  vi.mocked(featureFlagService.getFlag).mockImplementation((key: string, fallback: unknown) =>
    key === 'isCip45Enabled' ? true : fallback,
  );
  featureFlagsStore.loadFlags();
  expect(featureFlagsStore.isCip45Enabled()).toBe(true);
});

test('reset() turns isCip45Enabled back off', () => {
  featureFlagsStore.reset();
  expect(featureFlagsStore.isCip45Enabled()).toBe(false);
});

test('exposes isSubmitApiEnabled, defaulting to false', () => {
  featureFlagsStore.reset();
  expect(featureFlagsStore.isSubmitApiEnabled()).toBe(false);
});

test('reflects a remote isSubmitApiEnabled flag once loaded', () => {
  vi.mocked(featureFlagService.getFlag).mockImplementation((key: string, fallback: unknown) =>
    key === 'isSubmitApiEnabled' ? true : fallback,
  );
  featureFlagsStore.loadFlags();
  expect(featureFlagsStore.isSubmitApiEnabled()).toBe(true);
});

test('reset() turns isSubmitApiEnabled back off', () => {
  featureFlagsStore.reset();
  expect(featureFlagsStore.isSubmitApiEnabled()).toBe(false);
});

test('exposes isMultiAccountEnabled, defaulting to false', () => {
  featureFlagsStore.reset();
  expect(featureFlagsStore.isMultiAccountEnabled()).toBe(false);
});

test('reflects a remote isMultiAccountEnabled flag once loaded, and follows a live flip', () => {
  vi.mocked(featureFlagService.getFlag).mockImplementation((key: string, fallback: unknown) =>
    key === 'isMultiAccountEnabled' ? true : fallback,
  );
  featureFlagsStore.loadFlags();
  expect(featureFlagsStore.isMultiAccountEnabled()).toBe(true);

  featureFlagsStore.subscribeToFlagChanges();
  const listener = vi.mocked(featureFlagService.onFlagChange).mock.calls.find(([key]) => key === 'isMultiAccountEnabled')?.[1];
  listener?.(false, true);
  expect(featureFlagsStore.isMultiAccountEnabled()).toBe(false);
});

test('reset() turns isMultiAccountEnabled back off', () => {
  featureFlagsStore.reset();
  expect(featureFlagsStore.isMultiAccountEnabled()).toBe(false);
});

test('exposes isCip113Enabled, defaulting to false, following the remote flag and a live flip', () => {
  featureFlagsStore.reset();
  expect(featureFlagsStore.isCip113Enabled()).toBe(false);

  vi.mocked(featureFlagService.getFlag).mockImplementation((key: string, fallback: unknown) =>
    key === 'isCip113Enabled' ? true : fallback,
  );
  featureFlagsStore.loadFlags();
  expect(featureFlagsStore.isCip113Enabled()).toBe(true);

  featureFlagsStore.subscribeToFlagChanges();
  const listener = vi.mocked(featureFlagService.onFlagChange).mock.calls.find(([key]) => key === 'isCip113Enabled')?.[1];
  listener?.(false, true);
  expect(featureFlagsStore.isCip113Enabled()).toBe(false);

  featureFlagsStore.reset();
  expect(featureFlagsStore.isCip113Enabled()).toBe(false);
});

// After a failed first fetch the service retries (issue 1195); the store must
// pick the real values up then, and must not hand the background all-off
// fallbacks in the meantime.
test('does not mirror fallback values to the background before the service has flags', () => {
  const set = vi.mocked(writeFeatureFlagMirror);
  set.mockClear();
  vi.stubGlobal('chrome', { runtime: { id: 'gero' } });
  vi.mocked(featureFlagService.isReady).mockReturnValue(false);

  featureFlagsStore.loadFlags();
  expect(set).not.toHaveBeenCalled();

  vi.mocked(featureFlagService.isReady).mockReturnValue(true);
  featureFlagsStore.loadFlags();
  expect(set).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

test('loads the flags once a retry gets them after a failed first fetch', async () => {
  const set = vi.mocked(writeFeatureFlagMirror);
  set.mockClear();
  vi.stubGlobal('chrome', { runtime: { id: 'gero' } });
  featureFlagsStore.reset();
  vi.mocked(featureFlagService.getFlag).mockImplementation((_key: string, fallback: unknown) => fallback);
  vi.mocked(featureFlagService.isReady).mockReturnValue(false);

  await featureFlagsStore.initialize('https://flags.test');
  expect(featureFlagsStore.isGovernanceEnabled()).toBe(false);
  expect(set).not.toHaveBeenCalled();
  const onReady = vi.mocked(featureFlagService.onReady).mock.calls.at(-1)?.[0];
  expect(onReady).toBeTypeOf('function');

  vi.mocked(featureFlagService.isReady).mockReturnValue(true);
  vi.mocked(featureFlagService.getFlag).mockImplementation((key: string, fallback: unknown) =>
    key === 'isGovernanceEnabled' ? true : fallback,
  );
  onReady?.();

  expect(featureFlagsStore.isGovernanceEnabled()).toBe(true);
  expect(set).toHaveBeenLastCalledWith(expect.objectContaining({ isGovernanceEnabled: true }));
  featureFlagsStore.reset();
  vi.unstubAllGlobals();
});
