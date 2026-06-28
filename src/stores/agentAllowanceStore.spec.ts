// src/stores/agentAllowanceStore.spec.ts
import { describe, it, expect } from 'vitest';
import { serializeState, deserializeState } from './agentAllowanceStore';
import type { AllowanceConfig } from '@/services/agent/allowancePolicy';
import type { SpendRecord } from '@/services/agent/allowancePolicy';

const NOW = 1_750_000_000_000;

const cfg: AllowanceConfig = {
  status: 'active',
  totalBudgetLovelace: 100_000000n,
  perPaymentCapLovelace: 10_000000n,
  dailyCapLovelace: 30_000000n,
  allowlistPayees: ['agentX'],
  allowlistCategories: ['data'],
  expiresAt: NOW + 86_400_000,
};

const ledger: SpendRecord[] = [
  { ts: NOW - 1000, amountLovelace: 5_000000n },
  { ts: NOW - 2000, amountLovelace: 3_000000n },
];

describe('serializeState / deserializeState (bigint round-trip)', () => {
  it('round-trips a state with config and non-empty ledger', () => {
    const serialized = serializeState({ config: cfg, ledger });
    const restored = deserializeState(serialized);
    expect(restored.config).not.toBeNull();
    expect(restored.config!.totalBudgetLovelace).toBe(100_000000n);
    expect(restored.config!.perPaymentCapLovelace).toBe(10_000000n);
    expect(restored.config!.dailyCapLovelace).toBe(30_000000n);
    expect(restored.config!.status).toBe('active');
    expect(restored.config!.allowlistPayees).toEqual(['agentX']);
    expect(restored.config!.allowlistCategories).toEqual(['data']);
    expect(restored.config!.expiresAt).toBe(NOW + 86_400_000);
    expect(restored.ledger).toHaveLength(2);
    expect(restored.ledger[0].amountLovelace).toBe(5_000000n);
    expect(restored.ledger[1].amountLovelace).toBe(3_000000n);
  });

  it('round-trips a null config', () => {
    const serialized = serializeState({ config: null, ledger: [] });
    const restored = deserializeState(serialized);
    expect(restored.config).toBeNull();
    expect(restored.ledger).toHaveLength(0);
  });

  it('serialized bigints are stored as strings (not bigint)', () => {
    const serialized = serializeState({ config: cfg, ledger });
    expect(typeof serialized.config!.totalBudgetLovelace).toBe('string');
    expect(typeof serialized.config!.perPaymentCapLovelace).toBe('string');
    expect(typeof serialized.config!.dailyCapLovelace).toBe('string');
    expect(typeof serialized.ledger[0].amountLovelace).toBe('string');
  });

  it('preserves large lovelace values without precision loss', () => {
    const bigCfg: AllowanceConfig = {
      ...cfg,
      totalBudgetLovelace: 999_999_999_999_999n,
      perPaymentCapLovelace: 123_456_789_012n,
      dailyCapLovelace: 987_654_321_000n,
    };
    const bigLedger: SpendRecord[] = [{ ts: NOW, amountLovelace: 888_888_888_888n }];
    const restored = deserializeState(serializeState({ config: bigCfg, ledger: bigLedger }));
    expect(restored.config!.totalBudgetLovelace).toBe(999_999_999_999_999n);
    expect(restored.config!.perPaymentCapLovelace).toBe(123_456_789_012n);
    expect(restored.config!.dailyCapLovelace).toBe(987_654_321_000n);
    expect(restored.ledger[0].amountLovelace).toBe(888_888_888_888n);
  });
});
