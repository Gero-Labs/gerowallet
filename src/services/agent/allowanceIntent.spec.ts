// src/services/agent/allowanceIntent.spec.ts
import { describe, it, expect } from 'vitest';
import { parseAllowanceIntent } from './allowanceIntent';

describe('parseAllowanceIntent', () => {
  it('matches "set up an agent allowance"', () => {
    const r = parseAllowanceIntent('set up an agent allowance');
    expect(r).not.toBeNull();
    expect(r?.type).toBe('allowance');
  });

  it('matches "agent allowance"', () => {
    const r = parseAllowanceIntent('agent allowance');
    expect(r).not.toBeNull();
  });

  it('matches "show my allowance"', () => {
    const r = parseAllowanceIntent('show my allowance');
    expect(r).not.toBeNull();
  });

  it('matches "spending allowance"', () => {
    const r = parseAllowanceIntent('what is my spending allowance');
    expect(r).not.toBeNull();
  });

  it('matches case-insensitively', () => {
    const r = parseAllowanceIntent('Set Up An Agent Allowance');
    expect(r).not.toBeNull();
  });

  it('returns null for unrelated text', () => {
    expect(parseAllowanceIntent('swap ADA for SNEK')).toBeNull();
    expect(parseAllowanceIntent('delegate to GENS')).toBeNull();
    expect(parseAllowanceIntent('')).toBeNull();
  });
});
