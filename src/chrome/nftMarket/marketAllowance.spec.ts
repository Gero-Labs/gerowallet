// One verified market transaction may be signed once: the exact transaction id, by the wallet it
// was prepared for, touching only what the verification found, within five minutes. The same
// rules as the CIP-113 allowance (cip113Allowance.spec.ts), in a slot of its own.
import { beforeEach, describe, expect, it } from 'vitest';
import { NFT_MARKET_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import {
  DAPP_MARKET_PASS_MAX,
  DAPP_MARKET_PASS_TTL_MS,
  NFT_MARKET_ALLOWANCE_TTL_MS,
  clearDappMarketPasses,
  clearMarketSignAllowance,
  consumeDappMarketPass,
  consumeMarketAuthorization,
  consumeMarketSignAllowance,
  dropDappMarketPass,
  grantDappMarketPass,
  grantMarketSignAllowance,
  hasDappMarketPass,
  hasMarketAuthorization,
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

// A dApp's own signing request (CIP-30, CIP-45, WalletConnect) is previewed at its approval
// screen, and the page that screen runs in sends the dApp's CBOR as SIGN_TX. The worker, which
// alone saw the request arrive, holds a pass for that exact transaction while the request is open.
// Unlike the single allowance slot, passes are many (the side panel queues several requests).
describe('dApp market pass', () => {
  beforeEach(() => {
    clearDappMarketPasses();
    clearMarketSignAllowance();
  });

  it('allows the exact transaction once, for the wallet the request was made for', () => {
    grantDappMarketPass(7, TX, [CREATES], NOW);
    expect(hasDappMarketPass(7, TX, [CREATES], NOW)).toBe(true);
    expect(consumeDappMarketPass(7, TX, [CREATES], NOW)).toBe(true);
    expect(hasDappMarketPass(7, TX, [CREATES], NOW)).toBe(false);
    expect(consumeDappMarketPass(7, TX, [CREATES], NOW)).toBe(false);
  });

  it('is bound to the transaction id, the wallet and the hits', () => {
    grantDappMarketPass(7, TX, [CREATES], NOW);
    expect(hasDappMarketPass(7, OTHER_TX, [CREATES], NOW)).toBe(false);
    expect(hasDappMarketPass(8, TX, [CREATES], NOW)).toBe(false);
    expect(hasDappMarketPass(7, TX, [CREATES, OTHER_HIT], NOW)).toBe(false);
    expect(hasDappMarketPass(7, TX, [], NOW)).toBe(false);
    // The pass for TX survived all of that.
    expect(hasDappMarketPass(7, TX, [CREATES], NOW)).toBe(true);
  });

  it('holds many at once, and using one leaves the others', () => {
    grantDappMarketPass(7, TX, [CREATES], NOW);
    grantDappMarketPass(7, OTHER_TX, [SPENDS], NOW);
    expect(consumeDappMarketPass(7, TX, [CREATES], NOW)).toBe(true);
    expect(hasDappMarketPass(7, OTHER_TX, [SPENDS], NOW)).toBe(true);
  });

  it('expires', () => {
    expect(DAPP_MARKET_PASS_TTL_MS).toBe(10 * 60_000);
    grantDappMarketPass(7, TX, [CREATES], NOW);
    expect(hasDappMarketPass(7, TX, [CREATES], NOW + DAPP_MARKET_PASS_TTL_MS - 1)).toBe(true);
    expect(consumeDappMarketPass(7, TX, [CREATES], NOW + DAPP_MARKET_PASS_TTL_MS)).toBe(false);
    expect(hasDappMarketPass(7, TX, [CREATES], NOW)).toBe(false);
  });

  it('is dropped when its request is answered, and only that one', () => {
    grantDappMarketPass(7, TX, [CREATES], NOW);
    grantDappMarketPass(7, OTHER_TX, [SPENDS], NOW);
    dropDappMarketPass(7, TX);
    expect(hasDappMarketPass(7, TX, [CREATES], NOW)).toBe(false);
    expect(hasDappMarketPass(7, OTHER_TX, [SPENDS], NOW)).toBe(true);
    // Dropping what is not there is fine.
    expect(() => dropDappMarketPass(7, 'e'.repeat(64))).not.toThrow();
  });

  it('is bounded: past the cap the oldest goes first, and expired ones go before that', () => {
    for (let i = 0; i < DAPP_MARKET_PASS_MAX; i++) grantDappMarketPass(7, `${i}`.padStart(64, '0'), [CREATES], NOW);
    grantDappMarketPass(7, 'f'.repeat(64), [CREATES], NOW);
    expect(hasDappMarketPass(7, '0'.padStart(64, '0'), [CREATES], NOW)).toBe(false);
    expect(hasDappMarketPass(7, '1'.padStart(64, '0'), [CREATES], NOW)).toBe(true);
    expect(hasDappMarketPass(7, 'f'.repeat(64), [CREATES], NOW)).toBe(true);

    clearDappMarketPasses();
    for (let i = 0; i < DAPP_MARKET_PASS_MAX; i++) grantDappMarketPass(7, `${i}`.padStart(64, '0'), [CREATES], NOW);
    // Everything above is expired by now, so a new request evicts none of the live ones.
    const later = NOW + DAPP_MARKET_PASS_TTL_MS + 1;
    grantDappMarketPass(7, 'e'.repeat(64), [CREATES], later);
    grantDappMarketPass(7, 'f'.repeat(64), [CREATES], later);
    expect(hasDappMarketPass(7, 'e'.repeat(64), [CREATES], later)).toBe(true);
    expect(hasDappMarketPass(7, 'f'.repeat(64), [CREATES], later)).toBe(true);
  });

  it('a second request for the same transaction refreshes the pass rather than adding one', () => {
    grantDappMarketPass(7, TX, [CREATES], NOW);
    grantDappMarketPass(7, TX, [CREATES], NOW + 60_000);
    expect(hasDappMarketPass(7, TX, [CREATES], NOW + DAPP_MARKET_PASS_TTL_MS)).toBe(true);
  });

  it('is independent of the single allowance slot', () => {
    grantMarketSignAllowance(7, OTHER_TX, [SPENDS], NOW);
    grantDappMarketPass(7, TX, [CREATES], NOW);
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(false);
    expect(hasDappMarketPass(7, OTHER_TX, [SPENDS], NOW)).toBe(false);
    expect(consumeDappMarketPass(7, TX, [CREATES], NOW)).toBe(true);
    // Using the pass did not touch the page flow's allowance.
    expect(hasMarketSignAllowance(7, OTHER_TX, [SPENDS], NOW)).toBe(true);
  });
});

describe('market authorization: the allowance or a pass', () => {
  beforeEach(() => {
    clearDappMarketPasses();
    clearMarketSignAllowance();
  });

  it('either one authorizes, neither does not', () => {
    expect(hasMarketAuthorization(7, TX, [CREATES], NOW)).toBe(false);
    grantMarketSignAllowance(7, TX, [CREATES], NOW);
    expect(hasMarketAuthorization(7, TX, [CREATES], NOW)).toBe(true);
    clearMarketSignAllowance();
    grantDappMarketPass(7, TX, [CREATES], NOW);
    expect(hasMarketAuthorization(7, TX, [CREATES], NOW)).toBe(true);
  });

  it('checking uses nothing up', () => {
    grantMarketSignAllowance(7, TX, [CREATES], NOW);
    grantDappMarketPass(7, OTHER_TX, [SPENDS], NOW);
    expect(hasMarketAuthorization(7, TX, [CREATES], NOW)).toBe(true);
    expect(hasMarketAuthorization(7, OTHER_TX, [SPENDS], NOW)).toBe(true);
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(true);
    expect(hasDappMarketPass(7, OTHER_TX, [SPENDS], NOW)).toBe(true);
  });

  it('consumes the one that matched and leaves the other alone', () => {
    grantMarketSignAllowance(7, TX, [CREATES], NOW);
    grantDappMarketPass(7, OTHER_TX, [SPENDS], NOW);

    // The pass matches, the allowance slot holds another transaction's grant: it is not emptied.
    expect(consumeMarketAuthorization(7, OTHER_TX, [SPENDS], NOW)).toBe(true);
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(true);
    expect(hasDappMarketPass(7, OTHER_TX, [SPENDS], NOW)).toBe(false);

    // Now the allowance matches.
    grantDappMarketPass(7, OTHER_TX, [SPENDS], NOW);
    expect(consumeMarketAuthorization(7, TX, [CREATES], NOW)).toBe(true);
    expect(hasMarketSignAllowance(7, TX, [CREATES], NOW)).toBe(false);
    expect(hasDappMarketPass(7, OTHER_TX, [SPENDS], NOW)).toBe(true);
  });

  it('is single use whichever it was', () => {
    grantDappMarketPass(7, TX, [CREATES], NOW);
    expect(consumeMarketAuthorization(7, TX, [CREATES], NOW)).toBe(true);
    expect(consumeMarketAuthorization(7, TX, [CREATES], NOW)).toBe(false);
  });

  it('a transaction with a pass and an allowance for it uses the allowance first, then the pass is still open', () => {
    grantMarketSignAllowance(7, TX, [CREATES], NOW);
    grantDappMarketPass(7, TX, [CREATES], NOW);
    expect(consumeMarketAuthorization(7, TX, [CREATES], NOW)).toBe(true);
    expect(hasDappMarketPass(7, TX, [CREATES], NOW)).toBe(true);
  });
});
