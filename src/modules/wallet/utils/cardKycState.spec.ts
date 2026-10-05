import { describe, expect, it } from 'vitest';
import { kycStatusToCardState } from './cardKycState';

describe('kycStatusToCardState', () => {
  it.each([
    ['registered', 'new'],
    ['verification_started', 'pending'],
    ['verified', 'pending'],
    ['approved', 'approved'],
    ['rejected', 'auth'],
    ['verification_failed', 'new'],
    ['something_new', 'new'],
    [undefined, 'new'],
  ])('%s → %s', (status, state) => {
    expect(kycStatusToCardState(status)).toBe(state);
  });
});
