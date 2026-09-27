import { beforeEach, describe, expect, it } from 'vitest';
import { hasReferralOptIn, rememberReferralOptIn } from './referralOptIn';

describe('referral opt-in', () => {
  beforeEach(() => localStorage.clear());

  it('is off until the user has asked for a code', () => {
    expect(hasReferralOptIn('Preprod', 'addr_test1a')).toBe(false);
  });

  it('is remembered per network and address', () => {
    rememberReferralOptIn('Preprod', 'addr_test1a');

    expect(hasReferralOptIn('Preprod', 'addr_test1a')).toBe(true);
    expect(hasReferralOptIn('Preprod', 'addr_test1b')).toBe(false);
    expect(hasReferralOptIn('Mainnet', 'addr_test1a')).toBe(false);
  });
});
