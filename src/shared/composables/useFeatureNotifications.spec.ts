import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('../../../package.json', () => ({
  version: '2.7.3',
}));

vi.mock('@/stores/featureFlagsStore');

// Import after mocks are set up
import { isFeatureNew, markFeatureAsSeen, hasNewFeaturesInPath, resetAllFeatureNotifications } from './useFeatureNotifications';
import { featureFlagsStore } from '@/stores/featureFlagsStore';

beforeEach(() => {
  // Clear localStorage before each test
  localStorage.clear();
  // Reset all feature notifications
  resetAllFeatureNotifications();
});

test('Submit API badge is not shown when flag is off', () => {
  // Mock featureFlagsStore with flag OFF
  vi.mocked(featureFlagsStore.isSubmitApiEnabled).mockReturnValue(false);

  expect(isFeatureNew('settings.advanced.submitApi')).toBe(false);
  expect(hasNewFeaturesInPath(['settings', 'advanced'])).toBe(false);
});

test('Submit API badge is shown when flag is on', () => {
  // Mock featureFlagsStore with flag ON
  vi.mocked(featureFlagsStore.isSubmitApiEnabled).mockReturnValue(true);

  expect(isFeatureNew('settings.advanced.submitApi')).toBe(true);
  expect(hasNewFeaturesInPath(['settings', 'advanced'])).toBe(true);
});

test('Submit API badge disappears after marking as seen', () => {
  // Mock featureFlagsStore with flag ON
  vi.mocked(featureFlagsStore.isSubmitApiEnabled).mockReturnValue(true);

  // Initially should be new
  expect(isFeatureNew('settings.advanced.submitApi')).toBe(true);
  expect(hasNewFeaturesInPath(['settings', 'advanced'])).toBe(true);

  // Mark as seen
  markFeatureAsSeen('settings.advanced.submitApi');

  // Should no longer be new
  expect(isFeatureNew('settings.advanced.submitApi')).toBe(false);
  expect(hasNewFeaturesInPath(['settings', 'advanced'])).toBe(false);
});
