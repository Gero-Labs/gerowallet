import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { StationCode, StationStatus } from '@/chains/midnight/midnightStationConfig';
import MidnightStationFeeNote from './MidnightStationFeeNote.vue';

const $t = (key: string, args?: Record<string, unknown>) => (args ? `${key}:${JSON.stringify(args)}` : key);
const mountWith = (props: { status: StationStatus | null; useStation: boolean }) => mount(MidnightStationFeeNote, {
  props,
  global: {
    config: { globalProperties: mockGlobalProperties({ $t }) },
    stubs: {
      'v-icon': true,
      'v-checkbox': {
        props: ['modelValue', 'label'], emits: ['update:modelValue'],
        template: '<label><input type="checkbox" data-test="station-use" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />{{ label }}</label>',
      },
    },
  },
});

describe('MidnightStationFeeNote', () => {
  it('offers the station with the sends left today', () => {
    const wrapper = mountWith({ status: { available: true, remaining: 3 }, useStation: true });
    expect(wrapper.text()).toContain('midnight.station.cover');
    expect(wrapper.text()).toContain('midnight.station.remaining:{"n":3}');
    expect((wrapper.get('[data-test="station-use"]').element as HTMLInputElement).checked).toBe(true);
  });

  it('before the day\'s first send it says what the allowance is', () => {
    const wrapper = mountWith({ status: { available: true, remaining: 0, allowance: 5 }, useStation: true });
    expect(wrapper.text()).toContain('midnight.station.firstToday:{"n":5}');
    expect(wrapper.text()).not.toContain('midnight.station.remaining');
  });

  it('lets the user turn it off', async () => {
    const wrapper = mountWith({ status: { available: true, remaining: 3 }, useStation: true });
    await wrapper.get('[data-test="station-use"]').setValue(false);
    expect(wrapper.emitted('update:useStation')).toEqual([[false]]);
  });

  it('opens "how this works", which says it is not anonymous', async () => {
    const wrapper = mountWith({ status: { available: true, remaining: 3 }, useStation: true });
    expect(wrapper.find('[data-test="station-how-body"]').exists()).toBe(false);
    await wrapper.get('[data-test="station-how"]').trigger('click');
    expect(wrapper.get('[data-test="station-how-body"]').text()).toBe('midnight.station.howBody');
    expect(wrapper.get('[data-test="station-how"]').attributes('aria-expanded')).toBe('true');
  });

  it.each([
    ['NOT_REGISTERED', 'midnight.station.reason.notStaking'],
    ['NOT_DELEGATED', 'midnight.station.reason.notStaking'],
    ['ALREADY_ISSUED', 'midnight.station.reason.usedUp'],
  ])('says why not for %s, with no switch', (reason, key) => {
    const wrapper = mountWith({ status: { available: false, remaining: 0, reason: reason as StationCode }, useStation: true });
    expect(wrapper.get('[data-test="station-reason"]').text()).toBe(key);
    expect(wrapper.find('[data-test="station-use"]').exists()).toBe(false);
  });

  it('names the stake needed, in ADA', () => {
    const wrapper = mountWith({ status: { available: false, remaining: 0, reason: 'BELOW_THRESHOLD', thresholdLovelace: '100000000' }, useStation: true });
    expect(wrapper.get('[data-test="station-reason"]').text()).toBe('midnight.station.reason.belowThreshold:{"amount":"100"}');
  });

  it('draws nothing for a reason the user cannot act on, or no status', () => {
    expect(mountWith({ status: { available: false, remaining: 0, reason: 'STATION_OFF' }, useStation: true }).find('[data-test="station-note"]').exists()).toBe(false);
    expect(mountWith({ status: null, useStation: true }).find('[data-test="station-note"]').exists()).toBe(false);
  });
});
