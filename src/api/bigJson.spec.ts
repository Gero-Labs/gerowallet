import { describe, it, expect } from 'vitest';
import { parseBigJson } from '@/api/bigJson';

describe('parseBigJson', () => {
  it('preserves an integer beyond Number.MAX_SAFE_INTEGER as a string', () => {
    const parsed = parseBigJson('{"yesVotePower":25000000000000001}');
    expect(parsed.yesVotePower).toBe('25000000000000001');
  });

  it('proves the hazard is real — JSON.parse loses the same value', () => {
    expect(JSON.parse('{"yesVotePower":25000000000000001}').yesVotePower).toBe(25000000000000000);
  });

  it('leaves small integers as numbers', () => {
    const parsed = parseBigJson('{"page":1,"pageSize":50,"index":0}');
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(50);
    expect(parsed.index).toBe(0);
  });

  it('leaves floats alone, including long ones', () => {
    const parsed = parseBigJson('{"yesPct":66.91234567890123}');
    expect(typeof parsed.yesPct).toBe('number');
    expect(parsed.yesPct).toBeCloseTo(66.91234567890123);
  });

  it('does not corrupt digits inside string values', () => {
    const parsed = parseBigJson('{"txHash":"941502b0aa104c850d1979232594459ad5be55bd7b18b6285bbaa32d5566213d"}');
    expect(parsed.txHash).toBe('941502b0aa104c850d1979232594459ad5be55bd7b18b6285bbaa32d5566213d');
  });

  it('does not corrupt a long digit run inside a string', () => {
    const parsed = parseBigJson('{"note":"25000000000000001"}');
    expect(parsed.note).toBe('25000000000000001');
  });

  it('handles nested objects and arrays', () => {
    const parsed = parseBigJson('{"items":[{"deposit":100000000000000000},{"deposit":5}]}');
    expect(parsed.items[0].deposit).toBe('100000000000000000');
    expect(parsed.items[1].deposit).toBe(5);
  });

  it('handles null and an empty body', () => {
    expect(parseBigJson('null')).toBeNull();
    expect(parseBigJson('')).toBeNull();
  });

  it('returns null rather than throwing on malformed JSON', () => {
    expect(parseBigJson('{oops')).toBeNull();
  });
});
