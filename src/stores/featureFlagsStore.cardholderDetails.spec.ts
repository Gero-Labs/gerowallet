import { expect, test, vi } from 'vitest';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import featureFlagService from '@/services/featureFlag.service';

const listeners = vi.hoisted(() => new Map<string, (value: unknown) => void>());

vi.mock('@/services/featureFlag.service', () => ({
  default: {
    getFlag: vi.fn((_key: string, fallback: unknown) => fallback),
    onFlagChange: vi.fn((key: string, listener: (value: unknown) => void) => { listeners.set(key, listener); }),
  },
}));

test('the cardholder-details step is on by default, and after reset()', () => {
  expect(featureFlagsStore.isCardholderDetailsEnabled()).toBe(true);
  featureFlagsStore.reset();
  expect(featureFlagsStore.isCardholderDetailsEnabled()).toBe(true);
});

test('only an explicit false from the flag service turns it off', () => {
  vi.mocked(featureFlagService.getFlag).mockImplementation((key: string, fallback: unknown) =>
    key === 'isCardholderDetailsEnabled' ? false : fallback,
  );
  featureFlagsStore.loadFlags();
  expect(featureFlagsStore.isCardholderDetailsEnabled()).toBe(false);

  vi.mocked(featureFlagService.getFlag).mockImplementation((key: string, fallback: unknown) =>
    key === 'isCardholderDetailsEnabled' ? undefined : fallback,
  );
  featureFlagsStore.loadFlags();
  expect(featureFlagsStore.isCardholderDetailsEnabled()).toBe(true);
});

test('a live flip turns it off and back on without a reload', () => {
  featureFlagsStore.subscribeToFlagChanges();
  const flip = listeners.get('isCardholderDetailsEnabled')!;
  flip(false);
  expect(featureFlagsStore.isCardholderDetailsEnabled()).toBe(false);
  flip(true);
  expect(featureFlagsStore.isCardholderDetailsEnabled()).toBe(true);
  flip(undefined);
  expect(featureFlagsStore.isCardholderDetailsEnabled()).toBe(true);
});
