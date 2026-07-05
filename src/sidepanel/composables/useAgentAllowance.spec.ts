// src/sidepanel/composables/useAgentAllowance.spec.ts
import { describe, it, expect } from 'vitest';
import { createAgentAllowance } from './useAgentAllowance';
import type { AllowanceConfig, SpendRecord } from '@/services/agent/allowancePolicy';

const NOW = 1_750_000_000_000;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Fake store (mirrors the agentAllowanceStore shape)
// ---------------------------------------------------------------------------

interface AllowanceState {
  config: AllowanceConfig | null;
  ledger: SpendRecord[];
}

function fakeStore(initial: Partial<AllowanceState> = {}) {
  const state: AllowanceState = { config: null, ledger: [], ...initial };
  return {
    get config() { return state.config; },
    get ledger() { return state.ledger; },
    setConfig(cfg: AllowanceConfig) { state.config = cfg; },
    patchConfig(partial: Partial<AllowanceConfig>) {
      if (state.config) state.config = { ...state.config, ...partial };
    },
    pause() {
      if (state.config) state.config = { ...state.config, status: 'paused' };
    },
    resume() {
      if (state.config) state.config = { ...state.config, status: 'active' };
    },
    revoke() {
      if (state.config) state.config = { ...state.config, status: 'revoked' };
    },
    recordSpend(record: SpendRecord) {
      state.ledger = [record, ...state.ledger].slice(0, 100);
    },
    clear() {
      state.config = null;
      state.ledger = [];
    },
  };
}

// ---------------------------------------------------------------------------
// Valid config fixture
// ---------------------------------------------------------------------------

const goodCfg = (): Omit<AllowanceConfig, 'status'> => ({
  totalBudgetLovelace: 100_000000n,
  perPaymentCapLovelace: 10_000000n,
  dailyCapLovelace: 30_000000n,
  allowlistPayees: ['agentX'],
  allowlistCategories: ['data'],
  expiresAt: NOW + DAY,
});

// ---------------------------------------------------------------------------
// createAllowance validation
// ---------------------------------------------------------------------------

describe('createAgentAllowance - createAllowance validation', () => {
  it('accepts a valid config', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    const result = a.createAllowance(goodCfg());
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(store.config).not.toBeNull();
  });

  it('rejects zero totalBudgetLovelace', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    const r = a.createAllowance({ ...goodCfg(), totalBudgetLovelace: 0n });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/total budget/i);
  });

  it('rejects zero perPaymentCapLovelace', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    const r = a.createAllowance({ ...goodCfg(), perPaymentCapLovelace: 0n });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/per-payment/i);
  });

  it('rejects zero dailyCapLovelace', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    const r = a.createAllowance({ ...goodCfg(), dailyCapLovelace: 0n });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/daily/i);
  });

  it('rejects when both allowlistPayees and allowlistCategories are empty', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    const r = a.createAllowance({ ...goodCfg(), allowlistPayees: [], allowlistCategories: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/allow.?list/i);
  });

  it('accepts when only categories are provided (payees empty)', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    const r = a.createAllowance({ ...goodCfg(), allowlistPayees: [], allowlistCategories: ['data'] });
    expect(r.ok).toBe(true);
  });

  it('accepts when only payees are provided (categories empty)', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    const r = a.createAllowance({ ...goodCfg(), allowlistPayees: ['agentX'], allowlistCategories: [] });
    expect(r.ok).toBe(true);
  });

  it('rejects a wildcard category "*"', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    const r = a.createAllowance({ ...goodCfg(), allowlistCategories: ['*'] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/wildcard/i);
  });

  it('rejects an expiry in the past', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    const r = a.createAllowance({ ...goodCfg(), expiresAt: NOW - 1 });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/expir/i);
  });

  it('does not set config on validation failure', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    a.createAllowance({ ...goodCfg(), totalBudgetLovelace: 0n });
    expect(store.config).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// requestPayment
// ---------------------------------------------------------------------------

describe('createAgentAllowance - requestPayment', () => {
  it('allows and records a payment within all caps', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    a.createAllowance(goodCfg());

    const verdict = a.requestPayment({ payee: 'agentX', category: 'data', amountLovelace: 5_000000n });
    expect(verdict.allowed).toBe(true);
    expect(store.ledger).toHaveLength(1);
    expect(store.ledger[0].amountLovelace).toBe(5_000000n);
  });

  it('denies and does NOT record when over per-payment cap', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    a.createAllowance(goodCfg());

    const verdict = a.requestPayment({ payee: 'agentX', category: 'data', amountLovelace: 11_000000n });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/per-payment/i);
    expect(store.ledger).toHaveLength(0);
  });

  it('denies and does NOT record when over daily cap', () => {
    const priorLedger: SpendRecord[] = [{ ts: NOW - 1000, amountLovelace: 28_000000n }];
    const store = fakeStore({ ledger: priorLedger });
    const a = createAgentAllowance({ store, now: () => NOW });
    a.createAllowance(goodCfg());

    const verdict = a.requestPayment({ payee: 'agentX', category: 'data', amountLovelace: 5_000000n });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/daily/i);
    expect(store.ledger).toHaveLength(1); // unchanged
  });

  it('denies when no config is set', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    const verdict = a.requestPayment({ payee: 'agentX', category: 'data', amountLovelace: 1_000000n });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/no allowance/i);
  });

  it('denies when paused', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    a.createAllowance(goodCfg());
    a.pause();

    const verdict = a.requestPayment({ payee: 'agentX', category: 'data', amountLovelace: 5_000000n });
    expect(verdict.allowed).toBe(false);
    expect(store.ledger).toHaveLength(0);
  });

  it('allows again after resume', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    a.createAllowance(goodCfg());
    a.pause();
    a.resume();

    const verdict = a.requestPayment({ payee: 'agentX', category: 'data', amountLovelace: 5_000000n });
    expect(verdict.allowed).toBe(true);
  });

  it('denies after revoke', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    a.createAllowance(goodCfg());
    a.revoke();

    const verdict = a.requestPayment({ payee: 'agentX', category: 'data', amountLovelace: 5_000000n });
    expect(verdict.allowed).toBe(false);
    expect(store.ledger).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// remaining computed
// ---------------------------------------------------------------------------

describe('createAgentAllowance - remaining', () => {
  it('returns nulls when no config is set', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    expect(a.remaining.value.total).toBeNull();
    expect(a.remaining.value.today).toBeNull();
    expect(a.remaining.value.perPayment).toBeNull();
  });

  it('computes remaining total correctly after a spend', () => {
    const priorLedger: SpendRecord[] = [{ ts: NOW - 3 * DAY, amountLovelace: 40_000000n }];
    const store = fakeStore({ ledger: priorLedger });
    const a = createAgentAllowance({ store, now: () => NOW });
    a.createAllowance(goodCfg());
    // totalBudget = 100 ADA, spent = 40 ADA -> remaining = 60 ADA
    expect(a.remaining.value.total).toBe(60_000000n);
  });

  it('computes remaining today correctly (rolling 24h window)', () => {
    // 28 ADA spent in last 24h -> 2 ADA remaining today (dailyCap = 30)
    const priorLedger: SpendRecord[] = [{ ts: NOW - 1000, amountLovelace: 28_000000n }];
    const store = fakeStore({ ledger: priorLedger });
    const a = createAgentAllowance({ store, now: () => NOW });
    a.createAllowance(goodCfg());
    expect(a.remaining.value.today).toBe(2_000000n);
  });

  it('computes perPayment as the configured cap', () => {
    const store = fakeStore();
    const a = createAgentAllowance({ store, now: () => NOW });
    a.createAllowance(goodCfg());
    expect(a.remaining.value.perPayment).toBe(10_000000n);
  });
});
