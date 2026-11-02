// One verified market transaction may be signed once: the exact transaction id, by the wallet it
// was prepared for, touching only what the verification found, within five minutes. The same
// rules as the CIP-113 allowance (cip113Allowance.spec.ts), in a slot of its own.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  NFT_MARKET_ALLOWANCE_TTL_MS,
  NFT_MARKET_SIGN_REFUSAL_MESSAGE,
  clearMarketSignAllowance,
  consumeMarketSignAllowance,
  grantMarketSignAllowance,
  hasMarketSignAllowance,
} from './marketAllowance';
import { clearCip113SignAllowance, grantCip113SignAllowance, hasCip113SignAllowance } from '@/chrome/cip113Allowance';

const TX = 'a'.repeat(64);
const OTHER_TX = 'd'.repeat(64);
const CREATES = 'creates-listing:0';
const SPENDS = `spends-listing:${'b'.repeat(64)}#0`;
const OTHER_HIT = `spends-listing:${'c'.repeat(64)}#1`;
const NOW = 1_000_000;

describe('NFT market sign allowance', () => {
  beforeEach(() => clearMarketSignAllowance());

  it('names its refusal with a fixed English string', () => {
    expect(NFT_MARKET_SIGN_REFUSAL_MESSAGE).toMatch(/^Gero cannot sign /);
    expect(NFT_MARKET_SIGN_REFUSAL_MESSAGE).not.toBe('');
  });

  it('allows the exact transaction once', () => {
    grantMarketSignAllowance(7, TX, [CREATES], NOW);
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(true);
    expect(consumeMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(true);
    expect(consumeMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(false);
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(false);
  });

  it('allows nothing before a grant', () => {
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(false);
    expect(consumeMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(false);
  });

  it('allows a reprice-shaped transaction: every hit is within what was granted', () => {
    grantMarketSignAllowance(7, TX, [CREATES, SPENDS], NOW);
    expect(hasMarketSignAllowance(7, TX, [CREATES, SPENDS], NOW)).toBe(true);
    // Fewer hits than granted is still inside the grant.
    expect(hasMarketSignAllowance(7, TX, [SPENDS], NOW)).toBe(true);
  });

  it('refuses another transaction, another wallet, an ungranted hit or no hit at all', () => {
    grantMarketSignAllowance(7, TX, [CREATES], NOW);
    expect(hasMarketSignAllowance(7, OTHER_TX, [CREATES], NOW)).toBe(false);
    expect(hasMarketSignAllowance(8, TX, [CREATES], NOW)).toBe(false);
    expect(hasMarketSignAllowance(7, TX, [CREATES, OTHER_HIT], NOW)).toBe(false);
    expect(hasMarketSignAllowance(7, TX, [OTHER_HIT], NOW)).toBe(false);
    expect(hasMarketSignAllowance(7, TX, [], NOW)).toBe(false);
  });

  it('is used up by a refused attempt too, so a probe cannot keep it alive', () => {
    grantMarketSignAllowance(7, TX, [CREATES], NOW);
    expect(consumeMarketSignAllowance(7, OTHER_TX, [CREATES], NOW)).toBe(false);
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(false);
  });

  it('checking does not use it up', () => {
    grantMarketSignAllowance(7, TX, [CREATES], NOW);
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(true);
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(true);
    expect(consumeMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(true);
  });

  it('expires after five minutes', () => {
    expect(NFT_MARKET_ALLOWANCE_TTL_MS).toBe(5 * 60_000);
    grantMarketSignAllowance(7, TX, [CREATES], NOW);
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW + NFT_MARKET_ALLOWANCE_TTL_MS - 1)).toBe(true);
    expect(consumeMarketSignAllowance(7, TX, [CREATES], NOW + NFT_MARKET_ALLOWANCE_TTL_MS)).toBe(false);
    // An expired grant is gone, not just ignored: a later check at an earlier clock still fails.
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(false);
  });

  it('keeps one slot: a new grant replaces the old one', () => {
    grantMarketSignAllowance(7, TX, [CREATES], NOW);
    grantMarketSignAllowance(7, OTHER_TX, [SPENDS], NOW);
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(false);
    expect(hasMarketSignAllowance(7, OTHER_TX, [SPENDS], NOW)).toBe(true);
  });

  it('clear drops the grant', () => {
    grantMarketSignAllowance(7, TX, [CREATES], NOW);
    clearMarketSignAllowance();
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(false);
  });

  it('is independent of the CIP-113 allowance', () => {
    clearCip113SignAllowance();
    grantMarketSignAllowance(7, TX, [CREATES], NOW);
    grantCip113SignAllowance(7, OTHER_TX, [SPENDS], NOW);
    // Neither grant replaces, satisfies or consumes the other.
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(true);
    expect(hasCip113SignAllowance(7, OTHER_TX, [SPENDS], NOW)).toBe(true);
    expect(hasCip113SignAllowance(7, TX, [CREATES], NOW)).toBe(false);
    expect(consumeMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(true);
    expect(hasCip113SignAllowance(7, OTHER_TX, [SPENDS], NOW)).toBe(true);
    clearCip113SignAllowance();
  });
});
