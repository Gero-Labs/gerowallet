// One verified CIP-113 transfer may be signed once: the exact transaction id, by the wallet it
// was prepared for, spending only the programmable UTxOs that were chosen, within five minutes.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CIP113_ALLOWANCE_TTL_MS,
  clearCip113SignAllowance,
  consumeCip113SignAllowance,
  grantCip113SignAllowance,
  hasCip113SignAllowance,
} from './cip113Allowance';

const TX = 'a'.repeat(64);
const REF = `${'b'.repeat(64)}#0`;
const OTHER_REF = `${'c'.repeat(64)}#1`;
const NOW = 1_000_000;

describe('CIP-113 sign allowance', () => {
  beforeEach(() => clearCip113SignAllowance());

  it('allows the exact transaction once', () => {
    grantCip113SignAllowance(7, TX, [REF], NOW);
    expect(hasCip113SignAllowance(7, TX, [REF], NOW)).toBe(true);
    expect(consumeCip113SignAllowance(7, TX, [REF], NOW)).toBe(true);
    expect(consumeCip113SignAllowance(7, TX, [REF], NOW)).toBe(false);
  });

  it('allows nothing before a grant', () => {
    expect(hasCip113SignAllowance(7, TX, [REF], NOW)).toBe(false);
    expect(consumeCip113SignAllowance(7, TX, [REF], NOW)).toBe(false);
  });

  it('refuses another transaction, another wallet, an unchosen UTxO or no programmable input', () => {
    grantCip113SignAllowance(7, TX, [REF], NOW);
    expect(hasCip113SignAllowance(7, 'd'.repeat(64), [REF], NOW)).toBe(false);
    expect(hasCip113SignAllowance(8, TX, [REF], NOW)).toBe(false);
    expect(hasCip113SignAllowance(7, TX, [REF, OTHER_REF], NOW)).toBe(false);
    expect(hasCip113SignAllowance(7, TX, [], NOW)).toBe(false);
  });

  it('is used up by a refused attempt too, so a probe cannot keep it alive', () => {
    grantCip113SignAllowance(7, TX, [REF], NOW);
    expect(consumeCip113SignAllowance(7, 'd'.repeat(64), [REF], NOW)).toBe(false);
    expect(hasCip113SignAllowance(7, TX, [REF], NOW)).toBe(false);
  });

  it('expires after five minutes', () => {
    grantCip113SignAllowance(7, TX, [REF], NOW);
    expect(hasCip113SignAllowance(7, TX, [REF], NOW + CIP113_ALLOWANCE_TTL_MS - 1)).toBe(true);
    expect(consumeCip113SignAllowance(7, TX, [REF], NOW + CIP113_ALLOWANCE_TTL_MS)).toBe(false);
  });

  it('keeps one slot: a new grant replaces the old one', () => {
    grantCip113SignAllowance(7, TX, [REF], NOW);
    grantCip113SignAllowance(7, 'd'.repeat(64), [OTHER_REF], NOW);
    expect(hasCip113SignAllowance(7, TX, [REF], NOW)).toBe(false);
    expect(hasCip113SignAllowance(7, 'd'.repeat(64), [OTHER_REF], NOW)).toBe(true);
  });
});
