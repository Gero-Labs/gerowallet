// The sheet shows a transaction's validity start next to its expiry, whenever it has one.
import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import type { SpendReviewReady } from '../review';
import SpendApprovalSheet from './SpendApprovalSheet.vue';

enableAutoUnmount(afterEach);

const $t = (key: string, params?: Record<string, unknown>): string => (params ? `${key} ${JSON.stringify(params)}` : key);

const review = (invalidBefore: number | null): SpendReviewReady => ({
  status: 'ready',
  txId: 'ab'.repeat(32),
  inputCount: 1,
  outputs: [],
  leaves: { lovelace: 1_000_000n, tokens: [] },
  change: { lovelace: 0n, tokens: [] },
  fee: 180_000n,
  invalidHereafter: 140_000_000,
  invalidBefore,
  warnings: [],
  summary: {} as SpendReviewReady['summary'],
});

const mountSheet = (invalidBefore: number | null, details = false) => mount(SpendApprovalSheet, {
  props: { review: review(invalidBefore), network: 'preprod', paymentScriptHash: 'cd'.repeat(28), details },
  global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t }) } },
});

describe('the approval sheet\'s validity start', () => {
  it('shows when the transaction becomes valid, with the slot in the Details layer', () => {
    const wrapper = mountSheet(139_990_000, true);
    const row = wrapper.get('[data-test="sheet-valid-from"]');
    expect(row.text()).toContain('gerovault.spend.sheet.validFrom');
    expect(row.text()).toContain('"slot":139990000');
  });

  it('shows no such row for a transaction valid from the start', () => {
    expect(mountSheet(null).find('[data-test="sheet-valid-from"]').exists()).toBe(false);
  });
});
