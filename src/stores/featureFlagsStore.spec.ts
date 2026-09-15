import { expect, test, vi } from 'vitest';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import featureFlagService from '@/services/featureFlag.service';

vi.mock('@/services/featureFlag.service', () => ({
  default: {
    getFlag: vi.fn((_key: string, fallback: unknown) => fallback),
    onFlagChange: vi.fn(),
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
