// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { CoreWallet } from 'midnight-v9-shielded/v2';
import {
  analyzePrivateSwapOffer9, assertCompletedSwap, buildPrivateSwapOffer9, describePrivateSwapOffer9, estimatePrivateSwapExpiry,
  PRIVATE_SWAP_EXPIRY_MARGIN_MS, PRIVATE_SWAP_ROOT_WINDOW_MS, PRIVATE_SWAP_SUPPORTED, PrivateSwapRefusedError,
  samePrivateSwapLegs, takePrivateSwapOffer9, validatePrivateSwapTerms,
  type PrivateSwap9Deps, type PrivateSwapLeg,
} from './midnightPrivateSwap9';
import { IntentInsufficientFundsError, NIGHT_RAW_TOKEN_TYPE } from './midnightConnectorIntent';
import { ledger9Keystore } from './midnightLedger9';
import type { SealedTransaction9 } from './midnightDustSpread9';
import type { MidnightUnshieldedUtxo } from './midnightTypes';

vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

const network = 'preprod';
const endpoints = { sdkNetworkId: network, publicIndexerUrl: 'https://indexer.invalid', publicIndexerWsUrl: 'wss://indexer.invalid' } as never;
const X = 'aa'.repeat(32);
const Y = 'bb'.repeat(32);
const NIGHT = NIGHT_RAW_TOKEN_TYPE;
const NOW = Date.parse('2026-11-24T12:00:00Z');
const params = Buffer.from(ledger.LedgerParameters.initialParameters().serialize()).toString('hex');

const shielded = (type: string, value: bigint | number): PrivateSwapLeg => ({ kind: 'shielded', type, value: String(value) });
const unshielded = (type: string, value: bigint | number): PrivateSwapLeg => ({ kind: 'unshielded', type, value: String(value) });
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const nonce = (n: number) => n.toString(16).padStart(64, '0');

/** A party: its seeds, and the private coins its synced wallet holds. */
function party(tag: number, coins: Array<{ type: string; value: bigint }>, publicNight: bigint[] = []) {
  const zswapSeed = new Uint8Array(32).fill(tag);
  const unshieldedSecretKey = new Uint8Array(32).fill(tag + 100);
  const keystore = ledger9Keystore(unshieldedSecretKey, network);
  const address = keystore.getBech32Address().toString();
  const core = () => {
    const keys = ledger.ZswapSecretKeys.fromSeed(zswapSeed);
    try {
      return coins.reduce((wallet, coin, i) => CoreWallet.apply(wallet, keys, ledger.ZswapOffer.fromOutput(
        ledger.ZswapOutput.new({ nonce: nonce(tag * 1000 + i), type: coin.type, value: coin.value }, 0, keys.coinPublicKey, keys.encryptionPublicKey))),
      CoreWallet.initEmpty(keys, network));
    } finally { keys.clear(); }
  };
  const utxos: MidnightUnshieldedUtxo[] = publicNight.map((value, i) => ({
    owner: address, tokenType: NIGHT, value, intentHash: nonce(tag * 1000 + 500 + i), outputIndex: 0,
    ctime: Math.floor(NOW / 1000) - 3600, initialNonce: '', registeredForDustGeneration: false,
  }));
  return {
    zswapSeed, unshieldedSecretKey, keystore, address, core, utxos,
    wallet: { sdkNetworkId: network, endpoints, zswapSecretKeySeed: zswapSeed, unshieldedSecretKey, utxos,
      sync: { lastSync: NOW, addresses: { unshielded: address } }, proving: { device: true as const } },
  };
}
type Party = ReturnType<typeof party>;

/** Deps over a real SDK core and mock proofs; the fee is left out (no DUST state in a unit test). */
function depsFor(who: Party, overrides: Partial<PrivateSwap9Deps> = {}): PrivateSwap9Deps {
  return {
    withShieldedWallet: async (_args, use) => {
      const keys = ledger.ZswapSecretKeys.fromSeed(who.zswapSeed);
      try { return await use({ network, core: who.core(), keys, assertChainUnchanged: async () => {} }); } finally { keys.clear(); }
    },
    balanceFees: (async (args: { spread: { carrier: ledger.UnprovenTransaction; sign: (tx: ledger.UnprovenTransaction) => ledger.UnprovenTransaction; onBlock: (b: unknown) => void } }) => {
      args.spread.onBlock({ timestamp: NOW, ledgerParameters: params });
      return args.spread.sign(args.spread.carrier);
    }) as never,
    seal: async tx => ledger.Transaction.deserialize('signature', 'proof', 'binding', tx.mockProve().serialize()) as SealedTransaction9,
    now: () => NOW,
    ...overrides,
  };
}

const read = (offerHex: string): SealedTransaction9 => ledger.Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(offerHex, 'hex'));

describe('validatePrivateSwapTerms', () => {
  it('normalizes: lower-case colours, one leg per token summed', () => {
    const result = validatePrivateSwapTerms({ gives: [shielded(X.toUpperCase(), 3), shielded(X, 4)], wants: [unshielded(NIGHT, 9)] });
    expect(result).toEqual({ ok: true, terms: { gives: [shielded(X, 7)], wants: [unshielded(NIGHT, 9)] } });
  });

  it.each([
    ['a give-only swap', { gives: [shielded(X, 1)], wants: [] }, 'giveOnly'],
    ['a want-only swap', { gives: [], wants: [shielded(X, 1)] }, 'wantOnly'],
    ['no private leg', { gives: [unshielded(NIGHT, 1)], wants: [unshielded(Y, 1)] }, 'noPrivateLeg'],
    ['private NIGHT', { gives: [shielded(NIGHT, 1)], wants: [shielded(Y, 1)] }, 'shieldedNight'],
    ['the same token both ways', { gives: [shielded(X, 1)], wants: [shielded(X, 2)] }, 'sameToken'],
    ['too many legs', { gives: [1, 2, 3, 4, 5].map(i => shielded(nonce(i), 1)), wants: [shielded(Y, 1)] }, 'tooManyLegs'],
    ['a zero amount', { gives: [shielded(X, 0)], wants: [shielded(Y, 1)] }, 'request'],
    ['a negative amount', { gives: [{ kind: 'shielded', type: X, value: '-1' }], wants: [shielded(Y, 1)] }, 'request'],
    ['an amount over u128', { gives: [shielded(X, 1n << 128n)], wants: [shielded(Y, 1)] }, 'request'],
    ['a number amount', { gives: [{ kind: 'shielded', type: X, value: 5 }], wants: [shielded(Y, 1)] }, 'request'],
    ['an unknown kind', { gives: [{ kind: 'dust', type: X, value: '1' }], wants: [shielded(Y, 1)] }, 'request'],
    ['a short colour', { gives: [shielded('ab', 1)], wants: [shielded(Y, 1)] }, 'request'],
  ])('refuses %s', (_name, terms, code) => {
    expect(validatePrivateSwapTerms(terms)).toMatchObject({ ok: false, code });
  });

  it('compares legs whatever their order', () => {
    expect(samePrivateSwapLegs([shielded(X, 1), unshielded(Y, 2)], [unshielded(Y, 2), shielded(X, 1)])).toBe(true);
    expect(samePrivateSwapLegs([shielded(X, 1)], [unshielded(X, 1)])).toBe(false);
    expect(samePrivateSwapLegs([shielded(X, 1)], [shielded(X, 2)])).toBe(false);
  });
});

describe('estimatePrivateSwapExpiry', () => {
  const rootBound = NOW + PRIVATE_SWAP_ROOT_WINDOW_MS - PRIVATE_SWAP_EXPIRY_MARGIN_MS;
  it('is the intent TTL when it comes first', () => {
    expect(estimatePrivateSwapExpiry(new Date(NOW + 10 * 60_000), NOW)).toEqual({ expiresAt: NOW + 10 * 60_000, expiry: 'ttl' });
  });
  it('is the root window, less the margin, for a fully shielded offer', () => {
    expect(estimatePrivateSwapExpiry(undefined, NOW)).toEqual({ expiresAt: rootBound, expiry: 'root-window' });
    expect(rootBound - NOW).toBe(55 * 60_000);
  });
  it('is the root window when the TTL outlives it, and unknown without either', () => {
    expect(estimatePrivateSwapExpiry(new Date(rootBound + 1), NOW)).toEqual({ expiresAt: rootBound, expiry: 'root-window' });
    expect(estimatePrivateSwapExpiry(undefined, undefined)).toEqual({ expiry: 'unknown' });
  });
});

describe('a fully private swap, maker and taker', () => {
  const maker = party(1, [{ type: X, value: 300n }, { type: X, value: 5_000n }]);
  const taker = party(2, [{ type: Y, value: 4_000n }]);

  async function makeOffer() {
    return buildPrivateSwapOffer9({ ...maker.wallet, terms: { gives: [shielded(X, 1_000)], wants: [shielded(Y, 1_000)] } }, depsFor(maker));
  }

  it('builds an offer with no intent: its terms, the largest coin, an estimated expiry', async () => {
    const offer = await makeOffer();
    expect(PRIVATE_SWAP_SUPPORTED).toBe(true);
    expect(offer.terms).toEqual({ gives: [shielded(X, 1_000)], wants: [shielded(Y, 1_000)] });
    expect(offer.expiry).toBe('root-window');
    expect(offer.expiresAt).toBe(NOW + 55 * 60_000);
    const tx = read(offer.offerHex);
    expect(tx.intents?.size ?? 0).toBe(0);
    // One input, the 5,000 coin: never the small one first.
    const keys = ledger.ZswapSecretKeys.fromSeed(maker.zswapSeed);
    const big = [...maker.core().state.coins].find(coin => coin.value === 5_000n)!;
    expect(offer.nullifiers).toEqual([ledger.coinNullifier(big, keys.coinSecretKey)]);
    keys.clear();
    // The change and the ask, both to the maker.
    expect(tx.guaranteedOffer?.outputs.length).toBe(2);
  });

  it('describes the offer from the taker\'s side', async () => {
    const offer = await makeOffer();
    expect(describePrivateSwapOffer9(offer.offerHex, network, { now: NOW, seenAt: NOW })).toEqual({
      ok: true,
      offer: { gives: [shielded(X, 1_000)], wants: [shielded(Y, 1_000)] },
      taker: { gives: [shielded(Y, 1_000)], receives: [shielded(X, 1_000)] },
      expiresAt: NOW + 55 * 60_000, expiry: 'root-window',
    });
    expect(describePrivateSwapOffer9(offer.offerHex, network, { now: NOW })).toMatchObject({ ok: true, expiry: 'unknown' });
  });

  it('takes it: the mirror, the fee intent, nothing left open', async () => {
    const offer = await makeOffer();
    const result = await takePrivateSwapOffer9({
      ...taker.wallet, offerHex: offer.offerHex, dustSecretSeed: new Uint8Array(32).fill(9),
      approved: { gives: [shielded(Y, 1_000)], receives: [shielded(X, 1_000)] },
    }, depsFor(taker));
    expect(result.gives).toEqual([shielded(Y, 1_000)]);
    expect(result.receives).toEqual([shielded(X, 1_000)]);
    const merged = read(result.txHex);
    for (const segment of [0, ...merged.intents!.keys()]) {
      for (const [token, value] of merged.imbalances(segment)) if (token.tag !== 'dust') expect(value).toBe(0n);
    }
    // The maker's input and the taker's; the taker's own intent carries the fee.
    expect(merged.guaranteedOffer?.inputs.length).toBe(2);
    expect(merged.intents?.size).toBe(1);
    expect(merged.intents?.get(1)?.ttl.getTime()).toBe(NOW + 30 * 60_000);
  });

  it.each([
    ['a different amount', { gives: [shielded(Y, 999)], receives: [shielded(X, 1_000)] }],
    ['a different receipt', { gives: [shielded(Y, 1_000)], receives: [shielded(X, 1_001)] }],
    ['the public kind', { gives: [unshielded(Y, 1_000)], receives: [shielded(X, 1_000)] }],
    ['an extra leg', { gives: [shielded(Y, 1_000)], receives: [shielded(X, 1_000), unshielded(NIGHT, 1)] }],
    ['nothing', undefined],
  ])('refuses to take what the user did not approve: %s', async (_name, approved) => {
    const offer = await makeOffer();
    const take = takePrivateSwapOffer9({ ...taker.wallet, offerHex: offer.offerHex, dustSecretSeed: new Uint8Array(32), approved: approved as never }, depsFor(taker));
    await expect(take).rejects.toMatchObject({ code: 'terms' });
  });

  it('refuses an offer the maker cannot fund, before proving', async () => {
    const seal = vi.fn();
    await expect(buildPrivateSwapOffer9({ ...maker.wallet, terms: { gives: [shielded(X, 6_000)], wants: [shielded(Y, 1)] } },
      depsFor(maker, { seal }))).rejects.toBeInstanceOf(IntentInsufficientFundsError);
    expect(seal).not.toHaveBeenCalled();
  });

  it('refuses a taker that cannot fund the mirror', async () => {
    const offer = await buildPrivateSwapOffer9({ ...maker.wallet, terms: { gives: [shielded(X, 1_000)], wants: [shielded(Y, 4_001)] } }, depsFor(maker));
    await expect(takePrivateSwapOffer9({
      ...taker.wallet, offerHex: offer.offerHex, dustSecretSeed: new Uint8Array(32),
      approved: { gives: [shielded(Y, 4_001)], receives: [shielded(X, 1_000)] },
    }, depsFor(taker))).rejects.toBeInstanceOf(IntentInsufficientFundsError);
  });

  it('refuses sealed bytes that differ from what was built', async () => {
    const other = party(3, [{ type: X, value: 9_000n }]);
    const forged = await buildPrivateSwapOffer9({ ...other.wallet, terms: { gives: [shielded(X, 2_000)], wants: [shielded(Y, 1_000)] } }, depsFor(other));
    const deps = depsFor(maker, { seal: async () => read(forged.offerHex) });
    await expect(buildPrivateSwapOffer9({ ...maker.wallet, terms: { gives: [shielded(X, 1_000)], wants: [shielded(Y, 1_000)] } }, deps))
      .rejects.toMatchObject({ code: 'terms' });
  });

  it('refuses a completed swap it cannot check against the ledger\'s limits', async () => {
    const offer = await makeOffer();
    const deps = depsFor(taker, {
      balanceFees: (async (args: { spread: { carrier: ledger.UnprovenTransaction; sign: (tx: ledger.UnprovenTransaction) => ledger.UnprovenTransaction } }) =>
        args.spread.sign(args.spread.carrier)) as never,
    });
    await expect(takePrivateSwapOffer9({
      ...taker.wallet, offerHex: offer.offerHex, dustSecretSeed: new Uint8Array(32),
      approved: { gives: [shielded(Y, 1_000)], receives: [shielded(X, 1_000)] },
    }, deps)).rejects.toThrow(/could not be checked/);
  });
});

describe('a swap of public NIGHT for a private token', () => {
  const maker = party(4, [], [20_000_000n]);
  const taker = party(5, [{ type: Y, value: 4_000n }]);
  const terms = { gives: [unshielded(NIGHT, 5_000_000)], wants: [shielded(Y, 2_500)] };

  it('builds an offer whose signed intent bounds it', async () => {
    const offer = await buildPrivateSwapOffer9({ ...maker.wallet, terms }, depsFor(maker));
    expect(offer.terms).toEqual(terms);
    expect(offer.expiry).toBe('ttl');
    expect(offer.expiresAt).toBe(NOW + 55 * 60_000);
    const tx = read(offer.offerHex);
    expect(tx.intents?.size).toBe(1);
    const intent = [...tx.intents!.values()][0];
    expect(intent.guaranteedUnshieldedOffer?.signatures.length).toBe(1);
    // NIGHT change only, to the maker.
    expect(intent.guaranteedUnshieldedOffer?.outputs.map(out => [out.owner, out.value])).toEqual([[maker.keystore.getAddress(), 15_000_000n]]);
  });

  it('refuses a public give the wallet has not synced, and one it cannot cover', async () => {
    await expect(buildPrivateSwapOffer9({ ...maker.wallet, sync: { lastSync: null, addresses: {} }, terms }, depsFor(maker)))
      .rejects.toThrow('MIDNIGHT_WALLET_NOT_SYNCED');
    await expect(buildPrivateSwapOffer9({ ...maker.wallet, terms: { ...terms, gives: [unshielded(NIGHT, 30_000_000)] } }, depsFor(maker)))
      .rejects.toBeInstanceOf(IntentInsufficientFundsError);
  });

  it('is taken with an output-only intent to the taker, within the offer\'s TTL', async () => {
    const offer = await buildPrivateSwapOffer9({ ...maker.wallet, terms }, depsFor(maker));
    const result = await takePrivateSwapOffer9({
      ...taker.wallet, offerHex: offer.offerHex, dustSecretSeed: new Uint8Array(32),
      approved: { gives: [shielded(Y, 2_500)], receives: [unshielded(NIGHT, 5_000_000)] },
    }, depsFor(taker));
    const merged = read(result.txHex);
    expect(merged.intents?.size).toBe(2);
    const offerSegment = [...read(offer.offerHex).intents!.keys()][0];
    const own = [...merged.intents!].find(([segment]) => segment !== offerSegment)![1];
    expect(own.ttl.getTime()).toBe(offer.expiresAt);
    expect(own.guaranteedUnshieldedOffer?.inputs.length).toBe(0);
    expect(own.guaranteedUnshieldedOffer?.outputs.map(out => [out.owner, out.type, out.value]))
      .toEqual([[taker.keystore.getAddress(), NIGHT, 5_000_000n]]);
  });
});

describe('analyzePrivateSwapOffer9 refusals', () => {
  const keys = () => ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(7));
  const outputOffer = (type: string, value: bigint, segment = 0) => {
    const k = keys();
    try { return ledger.ZswapOffer.fromOutput(ledger.ZswapOutput.new({ nonce: nonce(77), type, value }, segment, k.coinPublicKey, k.encryptionPublicKey)); } finally { k.clear(); }
  };
  const nightIn = (value: bigint) => ({ value, owner: ledger9Keystore(new Uint8Array(32).fill(8), network).getPublicKey(), type: NIGHT, intentHash: nonce(1), outputNo: 0 });
  const withIntent = (zswap: ledger.ZswapOffer<ledger.PreProof> | undefined, build: (intent: ledger.UnprovenIntent) => void, ttl = new Date(NOW + 30 * 60_000)) => {
    const intent = ledger.Intent.new(ttl);
    build(intent);
    return ledger.Transaction.fromParts(network, zswap).addIntent({ tag: 'specific', value: 1 }, intent);
  };
  const refusal = (tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>) => {
    try { analyzePrivateSwapOffer9(tx, NOW); return 'accepted'; } catch (error) { return (error as PrivateSwapRefusedError).code ?? (error as Error).message; }
  };

  it('accepts a two-sided guaranteed swap', () => {
    const tx = withIntent(outputOffer(Y, 10n), intent => { intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([nightIn(50n)], [], []); });
    expect(analyzePrivateSwapOffer9(tx, NOW).terms).toEqual({ gives: [unshielded(NIGHT, 50)], wants: [shielded(Y, 10)] });
  });

  it('refuses a want-only and a give-only offer', () => {
    expect(refusal(ledger.Transaction.fromParts(network, outputOffer(Y, 10n)))).toBe('wantOnly');
    expect(refusal(withIntent(undefined, intent => { intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([nightIn(50n)], [], []); }))).toBe('giveOnly');
  });

  it('refuses value in a fallible section', () => {
    expect(refusal(withIntent(outputOffer(Y, 10n), intent => {
      intent.fallibleUnshieldedOffer = ledger.UnshieldedOffer.new([nightIn(50n)], [], []);
    }))).toBe('fallible');
    const fallibleZswap = ledger.Transaction.fromParts(network, undefined, outputOffer(Y, 10n, 1))
      .addIntent({ tag: 'specific', value: 1 }, (() => { const i = ledger.Intent.new(new Date(NOW + 30 * 60_000)); i.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([nightIn(50n)], [], []); return i; })());
    expect(refusal(fallibleZswap)).toBe('fallible');
  });

  it('refuses DUST actions in the offer', () => {
    expect(refusal(withIntent(outputOffer(Y, 10n), intent => {
      intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([nightIn(50n)], [], []);
      intent.dustActions = new ledger.DustActions('signature', 'pre-proof', new Date(NOW), [], []);
    }))).toBe('dust');
  });

  it('refuses a coin owned by a contract', () => {
    const contractCoin = ledger.ZswapOffer.fromOutput(ledger.ZswapOutput.newContractOwned({ nonce: nonce(5), type: Y, value: 10n }, 0, 'cd'.repeat(32)));
    expect(refusal(withIntent(contractCoin, intent => { intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([nightIn(50n)], [], []); }))).toBe('contract');
  });

  it('refuses a private NIGHT leg', () => {
    expect(refusal(withIntent(outputOffer(NIGHT, 10n), intent => { intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([nightIn(50n)], [], []); })))
      .toBe('shieldedNight');
  });

  it.each([
    ['too close to expiry', 60_000],
    ['too far ahead', 3 * 60 * 60_000],
  ])('refuses an intent TTL %s', (_name, ahead) => {
    expect(refusal(withIntent(outputOffer(Y, 10n), intent => { intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([nightIn(50n)], [], []); },
      new Date(NOW + ahead)))).toBe('expiry');
  });
});

describe('describePrivateSwapOffer9 refusals', () => {
  it('refuses bytes that are not an offer, or too many of them', () => {
    expect(describePrivateSwapOffer9('00ff', network)).toMatchObject({ ok: false, code: 'decode' });
    expect(describePrivateSwapOffer9('00'.repeat(300 * 1024), network)).toMatchObject({ ok: false, code: 'size' });
  });

  it('refuses an offer for another network', async () => {
    const maker = party(6, [{ type: X, value: 2_000n }]);
    const offer = await buildPrivateSwapOffer9({ ...maker.wallet, terms: { gives: [shielded(X, 1_000)], wants: [shielded(Y, 1_000)] } }, depsFor(maker));
    expect(describePrivateSwapOffer9(offer.offerHex, 'mainnet', { now: NOW })).toMatchObject({ ok: false, code: 'decode' });
  });

  it('sends a fully public offer to the public flow', () => {
    const intent = ledger.Intent.new(new Date(NOW + 30 * 60_000));
    const owner = ledger9Keystore(new Uint8Array(32).fill(8), network);
    intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
      [{ value: 50n, owner: owner.getPublicKey(), type: NIGHT, intentHash: nonce(1), outputNo: 0 }], [{ value: 9n, owner: owner.getAddress(), type: Y }], []);
    const sealed = ledger.Transaction.fromParts(network).addIntent({ tag: 'specific', value: 1 }, intent).mockProve();
    expect(describePrivateSwapOffer9(hex(sealed.serialize()), network, { now: NOW })).toMatchObject({ ok: false, code: 'noPrivateLeg' });
  });
});

describe('assertCompletedSwap', () => {
  it('refuses a token left open', () => {
    const k = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(7));
    const open = ledger.Transaction.fromParts(network, ledger.ZswapOffer.fromOutput(ledger.ZswapOutput.new({ nonce: nonce(1), type: Y, value: 1n }, 0, k.coinPublicKey, k.encryptionPublicKey)));
    k.clear();
    expect(() => assertCompletedSwap(open, params)).toThrow(/left open/);
  });
});
