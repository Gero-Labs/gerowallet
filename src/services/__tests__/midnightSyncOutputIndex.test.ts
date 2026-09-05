/**
 * `resolveOutputIndex` is the boundary guard that stops a malformed gero-sync
 * output from being given a fabricated dedup key. Index 0 is the case that
 * must survive: it is a real, common output position, and skipping it would
 * silently drop UTxOs.
 */
import { describe, it, expect } from 'vitest';
import { resolveOutputIndex } from '../midnight-sync.service';

describe('resolveOutputIndex', () => {
  it('keeps a legitimate index 0 (camelCase and snake_case)', () => {
    expect(resolveOutputIndex({ outputIndex: 0 })).toBe(0);
    expect(resolveOutputIndex({ output_index: 0 })).toBe(0);
  });

  it('keeps non-zero indices from either casing', () => {
    expect(resolveOutputIndex({ outputIndex: 3 })).toBe(3);
    expect(resolveOutputIndex({ output_index: 7 })).toBe(7);
  });

  it('prefers camelCase when both are present', () => {
    expect(resolveOutputIndex({ outputIndex: 2, output_index: 9 })).toBe(2);
  });

  it('falls back to snake_case when camelCase is absent', () => {
    expect(resolveOutputIndex({ outputIndex: undefined, output_index: 4 })).toBe(4);
  });

  it('returns null rather than defaulting to 0 when the index is unusable', () => {
    expect(resolveOutputIndex({})).toBeNull();
    expect(resolveOutputIndex({ outputIndex: undefined })).toBeNull();
    expect(resolveOutputIndex({ outputIndex: null as unknown as number })).toBeNull();
    expect(resolveOutputIndex({ outputIndex: '1' as unknown as number })).toBeNull();
    expect(resolveOutputIndex({ outputIndex: NaN })).toBeNull();
    expect(resolveOutputIndex({ outputIndex: 1.5 })).toBeNull();
  });
});
