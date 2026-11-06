// NOTIFY_WATCH_LISTINGS: the page asks the worker to have gero-sync watch a Gero market listing for
// a sale. A page is untrusted input, so the worker decides everything that matters itself: the
// wallet is the LOGGED one (a walletId the page sends is only checked, never used), the listing is
// one the worker verified (it remembers each verified list, reprice and migrate output) or one of
// the wallet's own verified listings, and the owner key is that listing's datum owner and a payment
// key of the logged account. What goes to gero-sync is built here, never copied from the request.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SENDER, TARGET } from '@/chrome/config';
import type { Keys } from '@/models/types';
import type { OwnListing } from './ownListings';
import {
  LISTING_WATCH_MAX_REFS,
  REMEMBERED_LISTING_MAX,
  REMEMBERED_LISTING_TTL_MS,
  forgetVerifiedListings,
  rememberVerifiedListing,
  watchListingsHandler,
  type ListingWatchDeps,
} from './listingWatch';

const OWNER = '18'.repeat(28);
const OWNER_B = 'b5'.repeat(28);
const STRANGER = '77'.repeat(28);
const TX = 'ab'.repeat(32);
const OTHER_TX = 'cd'.repeat(32);
const REF = `${TX}#1`;

const KEYS: Partial<Keys> = {
  payment: [{ address: 'addr_test1pay', cred: OWNER, path: "m/1852'/1815'/0'/0/0" }],
  change: [{ address: 'addr_test1chg', cred: OWNER_B, path: "m/1852'/1815'/0'/1/0" }],
  stake: [{ address: '', cred: '5c'.repeat(28), path: "m/1852'/1815'/0'/2/0" }],
};

const OWN_LISTING = {
  ref: `${OTHER_TX}#0`,
  unit: `${'aa'.repeat(28)}4e4654`,
  datum: { owner: OWNER_B, sellerAddress: 'addr_test1pay', price: 10_000_000n, royalties: [], buyer: null },
  depositLovelace: '1550000',
  deploymentVersion: 1,
} as OwnListing;

type Reply = { id: unknown; data: Record<string, unknown>; target: string; sender: string };

function rig(over: { wallet?: { id: number; chain: string; network: string; type: string } | null; keys?: Partial<Keys> | null; listed?: OwnListing[]; watch?: ListingWatchDeps['watch']; derived?: ListingWatchDeps['derivedPaymentKeyHashes'] } = {}) {
  const watch = vi.fn(over.watch ?? (async () => ({ result: 'ok' as const, watching: 1 })));
  const order: string[] = [];
  const deps: ListingWatchDeps = {
    booted: async () => { order.push('booted'); },
    getWallet: () => { order.push('getWallet'); return over.wallet === undefined ? { id: 4, chain: 'Cardano', network: 'Preprod', type: 'Normal' } : over.wallet; },
    getState: () => ({ keys: over.keys === undefined ? KEYS : over.keys, listedListings: over.listed ?? [] }),
    ...(over.derived ? { derivedPaymentKeyHashes: over.derived } : {}),
    watch,
  };
  const replies: Reply[] = [];
  const run = async (data: unknown) => {
    await watchListingsHandler(deps)({ id: 'req-1', data }, (r) => replies.push(r as Reply));
    return replies;
  };
  return { deps, watch, replies, run, order };
}

beforeEach(() => {
  forgetVerifiedListings();
});

describe('a listing the worker verified', () => {
  it('is registered for the LOGGED wallet with the verified datum owner, and nothing else from the request', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    const r = rig();

    const replies = await r.run({ walletId: 4, listingRefs: [REF], extra: 'ignored', stakeAddress: 'stake1evil' });

    expect(r.watch).toHaveBeenCalledTimes(1);
    expect(r.watch).toHaveBeenCalledWith({ walletId: 4, ownerPkh: OWNER, listingRefs: [REF] });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toEqual({ id: 'req-1', data: { success: true, result: { result: 'ok', watching: 1 } }, target: TARGET, sender: SENDER.extension });
  });

  it('waits for the worker to restore the wallet before it reads it', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    const r = rig();
    await r.run({ listingRefs: [REF] });
    expect(r.order.slice(0, 2)).toEqual(['booted', 'getWallet']);
  });

  it('accepts the owner the page names when it is the verified one (any letter case)', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    const r = rig();
    await r.run({ walletId: 4, ownerPkh: OWNER.toUpperCase(), listingRefs: [REF] });
    expect(r.watch).toHaveBeenCalledWith({ walletId: 4, ownerPkh: OWNER, listingRefs: [REF] });
  });

  it('takes the listing output index it was told by the verified summary, never 0', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    const r = rig();
    await r.run({ listingRefs: [`${TX}#0`] });
    expect(r.watch).not.toHaveBeenCalled();
    await r.run({ listingRefs: [REF] });
    expect(r.watch).toHaveBeenCalledTimes(1);
  });

  it('reports a device without a push registration as not_registered, and the reply is still a success', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    const r = rig({ watch: async () => ({ result: 'not_registered' }) });
    const [reply] = await r.run({ listingRefs: [REF] });
    expect(reply.data).toEqual({ success: true, result: { result: 'not_registered' } });
  });

  it('reports a server refusal (a 422 limit_exceeded, say) as failed, never as a throw', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    const r = rig({ watch: async () => ({ result: 'failed' }) });
    const [reply] = await r.run({ listingRefs: [REF] });
    expect(reply.data).toEqual({ success: false, result: { result: 'failed' } });
  });

  it('answers once, as failed, when the registration throws', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    const r = rig({ watch: async () => { throw new Error('socket closed'); } });
    const replies = await r.run({ listingRefs: [REF] });
    expect(replies).toHaveLength(1);
    expect(replies[0].data).toMatchObject({ success: false, result: { result: 'failed' } });
    expect(JSON.stringify(replies[0])).not.toContain('socket closed');
  });
});

describe('one of the wallet\'s own verified listings (a later registration, after the worker restarted)', () => {
  it('is accepted with the datum owner', async () => {
    const r = rig({ listed: [OWN_LISTING] });
    await r.run({ listingRefs: [OWN_LISTING.ref] });
    expect(r.watch).toHaveBeenCalledWith({ walletId: 4, ownerPkh: OWNER_B, listingRefs: [OWN_LISTING.ref] });
  });
});

describe('what a hostile or buggy page cannot get registered', () => {
  const refuses = async (r: ReturnType<typeof rig>, data: unknown) => {
    const replies = await r.run(data);
    expect(r.watch).not.toHaveBeenCalled();
    expect(replies).toHaveLength(1);
    expect(replies[0].data).toMatchObject({ success: false, result: { result: 'failed' } });
    expect(typeof replies[0].data['errorCode']).toBe('string');
    return replies[0].data['errorCode'];
  };

  it('a walletId that is not the logged wallet\'s is refused, not used', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    rememberVerifiedListing(99, TX, 1, OWNER);
    expect(await refuses(rig(), { walletId: 99, listingRefs: [REF] })).toBe('WALLET_CHANGED');
  });

  it('a walletId of the wrong type is refused', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    expect(await refuses(rig(), { walletId: '4', listingRefs: [REF] })).toBe('WALLET_CHANGED');
  });

  it('a listing the worker never verified for this wallet is refused (deny by default)', async () => {
    expect(await refuses(rig(), { listingRefs: [REF] })).toBe('NOT_VERIFIED');
  });

  it('a listing verified for ANOTHER wallet is refused', async () => {
    rememberVerifiedListing(5, TX, 1, OWNER);
    expect(await refuses(rig(), { listingRefs: [REF] })).toBe('NOT_VERIFIED');
  });

  it('a verification that has expired is refused', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER, 1_000);
    vi.useFakeTimers();
    vi.setSystemTime(1_000 + REMEMBERED_LISTING_TTL_MS + 1);
    try {
      expect(await refuses(rig(), { listingRefs: [REF] })).toBe('NOT_VERIFIED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('an ownerPkh other than the verified datum owner is refused, even when it is another key of the wallet', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    expect(await refuses(rig(), { ownerPkh: OWNER_B, listingRefs: [REF] })).toBe('OWNER');
    expect(await refuses(rig(), { ownerPkh: STRANGER, listingRefs: [REF] })).toBe('OWNER');
  });

  it('a malformed ownerPkh is refused as an invalid request', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    for (const ownerPkh of ['', 'xyz', OWNER.slice(2), `${OWNER}00`, 5, null, {}]) {
      expect(await refuses(rig(), { ownerPkh, listingRefs: [REF] })).toBe('INVALID_REQUEST');
    }
  });

  it('a verified owner that is not a payment key of the logged account is refused', async () => {
    // The verification said STRANGER, but the key set of this account has no such key.
    rememberVerifiedListing(4, TX, 1, STRANGER);
    expect(await refuses(rig(), { listingRefs: [REF] })).toBe('OWNER');
  });

  describe('a key derived from the xpub counts as the account\'s, as it does when the wallet recognises its listings', () => {
    const DERIVED = 'd4'.repeat(28);

    it('a listing owned by a derived key the key set has not caught up with registers', async () => {
      rememberVerifiedListing(4, TX, 1, DERIVED);
      const r = rig({ derived: () => [DERIVED, OWNER] });
      await r.run({ listingRefs: [REF] });
      expect(r.watch).toHaveBeenCalledWith({ walletId: 4, ownerPkh: DERIVED, listingRefs: [REF] });
    });

    it('a reprice of a listing recognised through a derived key (and found in the wallet\'s own listings) registers', async () => {
      const own = { ...OWN_LISTING, datum: { ...OWN_LISTING.datum, owner: DERIVED } } as OwnListing;
      const r = rig({ listed: [own], derived: () => [DERIVED] });
      await r.run({ listingRefs: [own.ref] });
      expect(r.watch).toHaveBeenCalledWith({ walletId: 4, ownerPkh: DERIVED, listingRefs: [own.ref] });
    });

    it('is still refused when neither the key set nor the derived keys hold the owner', async () => {
      rememberVerifiedListing(4, TX, 1, DERIVED);
      expect(await refuses(rig({ derived: () => [OWNER] }), { listingRefs: [REF] })).toBe('OWNER');
    });

    it('a derivation that fails leaves the key set to decide', async () => {
      rememberVerifiedListing(4, TX, 1, OWNER);
      const r = rig({ derived: () => { throw new Error('no xpub'); } });
      await r.run({ listingRefs: [REF] });
      expect(r.watch).toHaveBeenCalledWith({ walletId: 4, ownerPkh: OWNER, listingRefs: [REF] });
      rememberVerifiedListing(4, TX, 2, DERIVED);
      expect(await refuses(rig({ derived: () => { throw new Error('no xpub'); } }), { listingRefs: [`${TX}#2`] })).toBe('OWNER');
    });

    it('a malformed derived hash is not a key', async () => {
      rememberVerifiedListing(4, TX, 1, DERIVED);
      expect(await refuses(rig({ derived: () => ['zz', DERIVED.slice(2), '', 5 as unknown as string] }), { listingRefs: [REF] })).toBe('OWNER');
    });
  });

  it('the account\'s stake key is not an owner', async () => {
    rememberVerifiedListing(4, TX, 1, '5c'.repeat(28));
    expect(await refuses(rig(), { listingRefs: [REF] })).toBe('OWNER');
  });

  it('a key set the worker does not hold yet refuses', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    expect(await refuses(rig({ keys: null }), { listingRefs: [REF] })).toBe('OWNER');
  });

  it.each([
    ['no list', {}],
    ['not a list', { listingRefs: REF }],
    ['an empty list', { listingRefs: [] }],
    ['a number', { listingRefs: [3] }],
    ['an upper-case hash', { listingRefs: [`${TX.toUpperCase()}#1`] }],
    ['a short hash', { listingRefs: [`${TX.slice(1)}#1`] }],
    ['no index', { listingRefs: [TX] }],
    ['an index with a leading zero', { listingRefs: [`${TX}#01`] }],
    ['a negative index', { listingRefs: [`${TX}#-1`] }],
    ['a six-digit index', { listingRefs: [`${TX}#100000`] }],
    ['a trailing newline', { listingRefs: [`${TX}#1\n`] }],
    ['a padded ref', { listingRefs: [` ${TX}#1`] }],
    ['a duplicate', { listingRefs: [REF, REF] }],
  ])('refuses %s', async (_name, data) => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    expect(await refuses(rig(), data)).toBe('INVALID_REQUEST');
  });

  it(`refuses more than ${LISTING_WATCH_MAX_REFS} refs at once`, async () => {
    const refs = Array.from({ length: LISTING_WATCH_MAX_REFS + 1 }, (_, i) => `${TX}#${i}`);
    for (let i = 0; i < refs.length; i++) rememberVerifiedListing(4, TX, i, OWNER);
    expect(refs.length).toBeGreaterThan(LISTING_WATCH_MAX_REFS);
    expect(await refuses(rig(), { listingRefs: refs })).toBe('INVALID_REQUEST');
  });

  it('refuses refs under two different owners in one request', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    rememberVerifiedListing(4, OTHER_TX, 0, OWNER_B);
    expect(await refuses(rig(), { listingRefs: [REF, `${OTHER_TX}#0`] })).toBe('OWNER');
  });

  it.each([null, undefined, 'x', 7, [], [REF]])('refuses a request whose data is %j', async (data) => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    expect(await refuses(rig(), data)).toBe('INVALID_REQUEST');
  });

  it('refuses with no wallet logged in, and for a wallet that is not Cardano', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    expect(await refuses(rig({ wallet: null }), { listingRefs: [REF] })).toBe('WALLET_UNSUPPORTED');
    expect(await refuses(rig({ wallet: { id: 4, chain: 'Bitcoin', network: 'Mainnet', type: 'Normal' } }), { listingRefs: [REF] })).toBe('WALLET_UNSUPPORTED');
  });

  it('answers once even when the reply itself throws', async () => {
    rememberVerifiedListing(4, TX, 1, OWNER);
    const r = rig();
    let calls = 0;
    await watchListingsHandler(r.deps)({ id: 1, data: { listingRefs: [REF] } }, () => { calls += 1; throw new Error('port closed'); });
    expect(calls).toBe(1);
  });
});

describe('the memory of verified listings', () => {
  it('holds a bounded number, dropping the oldest', async () => {
    for (let i = 0; i < REMEMBERED_LISTING_MAX + 5; i++) rememberVerifiedListing(4, TX, i, OWNER);
    const r = rig();
    await r.run({ listingRefs: [`${TX}#0`] });
    expect(r.watch).not.toHaveBeenCalled();
    await r.run({ listingRefs: [`${TX}#${REMEMBERED_LISTING_MAX + 4}`] });
    expect(r.watch).toHaveBeenCalledTimes(1);
  });

  it('ignores an entry that is not a transaction id, an output index or a key hash', async () => {
    rememberVerifiedListing(4, 'nothex', 1, OWNER);
    rememberVerifiedListing(4, TX, -1, OWNER);
    rememberVerifiedListing(4, TX, 1.5, OWNER);
    rememberVerifiedListing(4, TX, 1, 'short');
    const r = rig();
    await r.run({ listingRefs: [REF] });
    expect(r.watch).not.toHaveBeenCalled();
  });
});
