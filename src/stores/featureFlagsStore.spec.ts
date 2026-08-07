import { featureFlagsStore } from '@/stores/featureFlagsStore';

test('isTrezorWebUsbEnabled defaults to false', () => {
  expect(featureFlagsStore.state.flags.isTrezorWebUsbEnabled).toBe(false);
});
