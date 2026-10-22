import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SENT_FEE_PAYMENT_TTL_MS, adoptSentFeePayment, loadSentFeePayments, pruneSentFeePayments, rememberSentFeePayment,
  resetSentFeePaymentsForTests, sentFeePayment,
} from './cardFeePayments';

const TX = 'b5a2e0c02d51d6f4676ddd12bff8883cc09a30fa8305520f1f2093f72d084f26';
const NOW = Date.parse('2026-10-22T11:00:00Z');

let stored: Record<string, unknown>;

function stubStorage(overrides: Partial<{ get: () => Promise<unknown>; set: () => Promise<void> }> = {}): void {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: overrides.get ?? (async (key: string) => ({ [key]: stored[key] })),
        set: overrides.set ?? (async (items: Record<string, unknown>) => { Object.assign(stored, items); }),
      },
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  stored = {};
  resetSentFeePaymentsForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('pruneSentFeePayments', () => {
  it('keeps well-formed entries younger than a week', () => {
    const value = {
      fresh: { txId: TX, sentAt: NOW - 60_000 },
      old: { txId: TX, sentAt: NOW - SENT_FEE_PAYMENT_TTL_MS },
      badTx: { txId: 'not-a-hash', sentAt: NOW },
      noTime: { txId: TX },
    };
    expect(pruneSentFeePayments(value, NOW)).toEqual({ fresh: { txId: TX, sentAt: NOW - 60_000 } });
    expect(pruneSentFeePayments(null, NOW)).toEqual({});
  });
});

describe('sent fee payments', () => {
  it('remembers a payment per order and persists it', async () => {
    stubStorage();
    await rememberSentFeePayment('order-1', TX);
    expect(sentFeePayment('order-1')).toEqual({ txId: TX, sentAt: NOW });
    expect(sentFeePayment('order-2')).toBeNull();
    expect(stored['cardSentFeePayments']).toEqual({ 'order-1': { txId: TX, sentAt: NOW } });
  });

  it('reads back what an earlier page stored, minus expired entries', async () => {
    stored['cardSentFeePayments'] = {
      'order-1': { txId: TX, sentAt: NOW - 60_000 },
      'order-old': { txId: TX, sentAt: NOW - SENT_FEE_PAYMENT_TTL_MS - 1 },
    };
    stubStorage();
    await loadSentFeePayments();
    expect(sentFeePayment('order-1')?.txId).toBe(TX);
    expect(sentFeePayment('order-old')).toBeNull();
  });

  it('still knows about the payment for this page when storage fails', async () => {
    stubStorage({ set: async () => { throw new Error('quota'); } });
    await rememberSentFeePayment('order-1', TX);
    expect(sentFeePayment('order-1')?.txId).toBe(TX);
  });

  it('adopts a payment another device recorded, unless this browser knows one', async () => {
    stubStorage();
    await adoptSentFeePayment('order-1', { txId: TX, sentAt: NOW - 60_000 });
    expect(sentFeePayment('order-1')).toEqual({ txId: TX, sentAt: NOW - 60_000 });
    expect(stored['cardSentFeePayments']).toEqual({ 'order-1': { txId: TX, sentAt: NOW - 60_000 } });

    const other = 'a'.repeat(64);
    await adoptSentFeePayment('order-1', { txId: other, sentAt: NOW });
    expect(sentFeePayment('order-1')?.txId).toBe(TX);

    await adoptSentFeePayment('order-old', { txId: other, sentAt: NOW - SENT_FEE_PAYMENT_TTL_MS - 1 });
    expect(sentFeePayment('order-old')).toBeNull();
  });

  it('ignores a missing order or transaction', async () => {
    stubStorage();
    await rememberSentFeePayment(undefined, TX);
    await rememberSentFeePayment('order-1', '');
    expect(stored).toEqual({});
    expect(sentFeePayment(undefined)).toBeNull();
  });
});
