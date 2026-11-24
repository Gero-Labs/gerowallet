// @vitest-environment node
// Reading a swap offer on ledger 9: every figure comes from the sealed bytes.
import { describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { readSwapOffer9, sameSwapLegs, swapOfferFacts9, SwapOfferWrongNetworkError, swapTakeRefusal } from './midnightSwap9';
import { encodeSwapOffer, SwapOfferFormatError, swapOfferId } from './midnightSwapOffer';
import { ledger9Keystore, signLedger9Intents } from './midnightLedger9';

vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

// Public synthetic keys and nonexistent UTxOs. Never fund.
const NIGHT = '00'.repeat(32);
const TOKEN = 'ab'.repeat(32);
const maker = ledger9Keystore(new Uint8Array(32).fill(7), 'preprod');
const taker = ledger9Keystore(new Uint8Array(32).fill(1), 'preprod');

const noProver: ledger.ProvingProvider = {
  check: async () => { throw new Error('unexpected proof-server call'); },
  prove: async () => { throw new Error('unexpected proof-server call'); },
  lookupKey: async () => undefined,
};

/** A maker offer: 18 NIGHT in, 8 back as change and 5,000 TOKEN asked, so 10 NIGHT offered for 5,000 TOKEN. */
async function makerOffer(opts: { network?: string; ttl?: Date; fallible?: boolean; ask?: boolean } = {}): Promise<Uint8Array> {
  const network = opts.network ?? 'preprod';
  const keystore = ledger9Keystore(new Uint8Array(32).fill(7), network);
  const intent = ledger.Intent.new(opts.ttl ?? new Date(Date.now() + 30 * 60_000));
  const outputs = [{ value: 8n, owner: keystore.getAddress(), type: NIGHT }];
  if (opts.ask !== false) outputs.push({ value: 5_000n, owner: keystore.getAddress(), type: TOKEN });
  const offer = ledger.UnshieldedOffer.new(
    [{ value: 18n, owner: keystore.getPublicKey(), type: NIGHT, intentHash: '33'.repeat(32), outputNo: 4 }], outputs, []);
  if (opts.fallible) intent.fallibleUnshieldedOffer = offer;
  else intent.guaranteedUnshieldedOffer = offer;
  const proven = await ledger.Transaction.fromParts(network).addIntent({ tag: 'specific', value: 7 }, intent)
    .prove(noProver, ledger.CostModel.initialCostModel());
  return signLedger9Intents(proven, keystore).bind().serialize();
}

describe('readSwapOffer9 + swapOfferFacts9', () => {
  it('reads gives, wants, expiry, coins and the maker intent from the bytes', async () => {
    const ttl = new Date(Date.now() + 30 * 60_000);
    const bytes = await makerOffer({ ttl });
    const { tx, bytes: read } = readSwapOffer9(encodeSwapOffer(bytes), 'preprod');
    expect(read).toEqual(bytes);
    const facts = swapOfferFacts9(tx, read);
    expect(facts.offerId).toBe(swapOfferId(bytes));
    expect(facts.makerGives).toEqual([{ tokenType: NIGHT, amount: '10' }]);
    expect(facts.makerWants).toEqual([{ tokenType: TOKEN, amount: '5000' }]);
    // The ledger keeps TTLs to the second.
    expect(Math.abs((facts.expiresAt ?? 0) - ttl.getTime())).toBeLessThan(1_000);
    expect(facts.inputs).toEqual([`${'33'.repeat(32)}#4`]);
    expect(facts.inputOwners).toEqual([String(maker.getAddress()).toLowerCase()]);
    expect(facts.payees).toEqual([String(maker.getAddress()).toLowerCase()]);
    // Guaranteed outputs are created under the guaranteed segment's hash, not the intent's own segment id.
    expect(facts.intentHashes).toEqual([String(tx.intents!.get(7)!.intentHash(0)).toLowerCase()]);
    expect(facts.intentHashes[0]).not.toBe(String(tx.intents!.get(7)!.intentHash(7)).toLowerCase());
    expect(facts.unsupported).toBeUndefined();
  });

  it('refuses an offer of another network and a string that is not an offer', async () => {
    const bytes = await makerOffer({ network: 'preview' });
    expect(() => readSwapOffer9(encodeSwapOffer(bytes), 'preprod')).toThrow(SwapOfferWrongNetworkError);
    expect(() => readSwapOffer9(encodeSwapOffer(Uint8Array.from([1, 2, 3])), 'preprod')).toThrow(SwapOfferFormatError);
    expect(() => readSwapOffer9('mn_addr_preprod1abc', 'preprod')).toThrow(SwapOfferFormatError);
  });

  it('flags a fallible section and an offer that asks for nothing', async () => {
    const fallible = readSwapOffer9(encodeSwapOffer(await makerOffer({ fallible: true })), 'preprod');
    expect(swapOfferFacts9(fallible.tx, fallible.bytes).unsupported).toBe('fallible');
    const giveOnly = readSwapOffer9(encodeSwapOffer(await makerOffer({ ask: false })), 'preprod');
    expect(swapOfferFacts9(giveOnly.tx, giveOnly.bytes).unsupported).toBe('giveOnly');
  });
});

describe('swapTakeRefusal', () => {
  const now = Date.now();
  const factsOf = async (opts: Parameters<typeof makerOffer>[0] = {}) => {
    const read = readSwapOffer9(encodeSwapOffer(await makerOffer(opts)), 'preprod');
    return swapOfferFacts9(read.tx, read.bytes);
  };
  const takerHex = String(taker.getAddress());

  it('lets another wallet take a live offer', async () => {
    expect(swapTakeRefusal(await factsOf(), takerHex, now)).toBeUndefined();
  });

  it('refuses the maker\'s own offer', async () => {
    expect(swapTakeRefusal(await factsOf(), String(maker.getAddress()).toUpperCase(), now)).toBe('SWAP_OFFER_OWN');
  });

  it('refuses an offer about to expire, and one that lives too long', async () => {
    expect(swapTakeRefusal(await factsOf({ ttl: new Date(now + 60_000) }), takerHex, now)).toBe('SWAP_OFFER_EXPIRED');
    expect(swapTakeRefusal(await factsOf({ ttl: new Date(now + 3 * 3_600_000) }), takerHex, now)).toBe('SWAP_OFFER_TOO_LONG');
  });

  it('refuses a give-only and a fallible offer', async () => {
    expect(swapTakeRefusal(await factsOf({ ask: false }), takerHex, now)).toBe('SWAP_OFFER_GIVE_ONLY');
    expect(swapTakeRefusal(await factsOf({ fallible: true }), takerHex, now)).toBe('SWAP_OFFER_UNSUPPORTED');
  });
});

describe('sameSwapLegs', () => {
  it('compares legs in any order, token type case-insensitively', () => {
    const a = [{ tokenType: TOKEN, amount: '5' }, { tokenType: NIGHT, amount: '1' }];
    expect(sameSwapLegs(a, [{ tokenType: NIGHT, amount: '1' }, { tokenType: TOKEN.toUpperCase(), amount: '5' }])).toBe(true);
    expect(sameSwapLegs(a, [{ tokenType: NIGHT, amount: '1' }])).toBe(false);
    expect(sameSwapLegs(a, [{ tokenType: NIGHT, amount: '1' }, { tokenType: TOKEN, amount: '6' }])).toBe(false);
  });
});
