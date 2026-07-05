// src/services/agent/allowancePolicy.spec.ts
import { describe, it, expect } from 'vitest';
import { evaluatePayment, type AllowanceConfig, type SpendRecord } from './allowancePolicy';

const DAY = 86_400_000;
const NOW = 1_000_000_000_000;

const cfg = (over: Partial<AllowanceConfig> = {}): AllowanceConfig => ({
  status: 'active',
  totalBudgetLovelace: 100_000000n,
  perPaymentCapLovelace: 10_000000n,
  dailyCapLovelace: 30_000000n,
  allowlistPayees: ['agentX'],
  allowlistCategories: ['data'],
  expiresAt: NOW + DAY,
  ...over,
});

const req = (over: Partial<{ payee: string; category: string; amountLovelace: bigint }> = {}) => ({
  payee: 'agentX', category: 'data', amountLovelace: 5_000000n, ...over,
});

describe('evaluatePayment', () => {
  it('allows a payment within all limits to an allowlisted payee', () => {
    const v = evaluatePayment(req(), cfg(), [], NOW);
    expect(v.allowed).toBe(true);
  });
  it('denies when the allowance is paused/revoked', () => {
    expect(evaluatePayment(req(), cfg({ status: 'paused' }), [], NOW).allowed).toBe(false);
    expect(evaluatePayment(req(), cfg({ status: 'revoked' }), [], NOW).allowed).toBe(false);
  });
  it('denies when expired', () => {
    const v = evaluatePayment(req(), cfg(), [], NOW + 2 * DAY);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/expired/i);
  });
  it('denies a payee/category not on the allowlist (default-deny)', () => {
    const v = evaluatePayment(req({ payee: 'evil', category: 'other' }), cfg(), [], NOW);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/not on your allow/i);
  });
  it('allows when the category matches even if the payee does not', () => {
    expect(evaluatePayment(req({ payee: 'unknown', category: 'data' }), cfg(), [], NOW).allowed).toBe(true);
  });
  it('denies when over the per-payment cap', () => {
    const v = evaluatePayment(req({ amountLovelace: 11_000000n }), cfg(), [], NOW);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/per-payment/i);
  });
  it('denies when this payment would exceed the rolling 24h daily cap', () => {
    const ledger: SpendRecord[] = [{ ts: NOW - 1000, amountLovelace: 28_000000n }];
    const v = evaluatePayment(req({ amountLovelace: 5_000000n }), cfg(), ledger, NOW);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/daily/i);
  });
  it('ignores spend older than 24h for the daily cap', () => {
    const ledger: SpendRecord[] = [{ ts: NOW - 2 * DAY, amountLovelace: 28_000000n }];
    expect(evaluatePayment(req({ amountLovelace: 5_000000n }), cfg(), ledger, NOW).allowed).toBe(true);
  });
  it('denies when this payment would exceed the total budget', () => {
    const ledger: SpendRecord[] = [{ ts: NOW - 3 * DAY, amountLovelace: 98_000000n }];
    const v = evaluatePayment(req({ amountLovelace: 5_000000n }), cfg(), ledger, NOW);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/total budget/i);
  });
});
