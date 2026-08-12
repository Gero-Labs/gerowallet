import { describe, it, expect } from 'vitest';
import { isStakeKeyRegistered } from './stakeRegistration';

describe('isStakeKeyRegistered', () => {
  it('trusts an explicit active: true', () => {
    expect(isStakeKeyRegistered({ active: true })).toBe(true);
  });

  // The bug this predicate exists for: the synced payload has no `active` key
  // at all, so a direct `!account.active` read reports every wallet unregistered.
  it('infers registration from pool_id when active is absent', () => {
    expect(isStakeKeyRegistered({ pool_id: 'pool1abc' })).toBe(true);
  });

  it('infers registration from drep_id when active is absent', () => {
    expect(isStakeKeyRegistered({ drep_id: 'drep1abc' })).toBe(true);
  });

  // Guards the "trust active whenever present" design that nexus flagged as
  // strictly worse: their YACI path derived active from pool delegation alone,
  // so a vote-delegated-only wallet arrives as a present-but-wrong false.
  it('overrides a false active when drep_id proves delegation', () => {
    expect(isStakeKeyRegistered({ active: false, drep_id: 'drep1abc' })).toBe(true);
  });

  it('overrides a false active when pool_id proves delegation', () => {
    expect(isStakeKeyRegistered({ active: false, pool_id: 'pool1abc' })).toBe(true);
  });

  it('reports not registered when active is false with no corroborating id', () => {
    expect(isStakeKeyRegistered({ active: false, pool_id: null, drep_id: null })).toBe(false);
  });

  it('reports not registered when nothing is known', () => {
    expect(isStakeKeyRegistered({})).toBe(false);
  });

  it('treats empty-string ids as absent rather than as evidence', () => {
    expect(isStakeKeyRegistered({ pool_id: '', drep_id: '' })).toBe(false);
  });

  it('fails closed on a missing account', () => {
    expect(isStakeKeyRegistered(undefined)).toBe(false);
    expect(isStakeKeyRegistered(null)).toBe(false);
  });

  // The captured real-world payload from the bug report: registered and
  // delegated, but with no `active` key present anywhere on the object.
  it('handles the captured production payload', () => {
    const captured = {
      controlled_amount: '1234567890',
      drep_id: 'drep1ydpfkyjxzeqvalf6fgvj7lznrk8kcmfnvy9hyl6gr6ez6wgsjaelx',
      pool_id: 'pool12yscr8j3zs34ewxrwlk0p2w5uvgcnrzywpp78ddjsj8kxd530f9',
      rewards_sum: '362637431',
      withdrawable_amount: '11408858',
    };
    expect('active' in captured).toBe(false);
    expect(isStakeKeyRegistered(captured)).toBe(true);
  });
});
