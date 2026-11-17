// The note when Max cannot sweep: what it sends, and what stays behind for now.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';

vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
    tc: (key: string) => key,
  }),
}));

import MaxLimitNote from './MaxLimitNote.vue';

enableAutoUnmount(afterEach);

describe('MaxLimitNote', () => {
  it('names the amount Max sends and the UTxOs it leaves behind', () => {
    const wrapper = mount(MaxLimitNote, {
      props: { amount: '₳1,199.995686', total: 2144, max: 200, remaining: 1944 },
      global: { plugins: [createTestVuetify()] },
    });
    const note = wrapper.get('.max-limit-note');
    expect(note.attributes('aria-label')).toBe('send.inputLimitMaxTitle{"amount":"₳1,199.995686"}');
    expect(note.get('.max-limit-note__title').text()).toBe('send.inputLimitMaxTitle{"amount":"₳1,199.995686"}');
    expect(note.get('.max-limit-note__body').text()).toBe('send.inputLimitMaxNote{"total":2144,"max":200,"remaining":1944}');
    expect(note.get('.v-icon').attributes('aria-hidden')).toBe('true');
  });
});
