// @vitest-environment node
// The worker's swap handlers for offers with private (shielded) legs, against
// the real midnightPrivateSwap9 builder (real ledger 9 objects and SDK cores,
// mock proofs) and a real private store: the page sends legs with their
// `shielded` flag, the worker reads every figure back from the bytes.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { CoreWallet } from 'midnight-v9-shielded/v2';
import { LEDGER8_PROTOCOL_VERSION, LEDGER9_PROTOCOL_VERSION_SAMPLE, useMidnightChains } from '@test/helpers/midnightChains';
import type { SealedTransaction9 } from '@/chains/midnight/midnightDustSpread9';

const X = 'aa'.repeat(32);
const Y = 'bb'.repeat(32);
const NIGHT = '00'.repeat(32);
const network = 'preprod';
const params = Buffer.from(ledger.LedgerParameters.initialParameters().serialize()).toString('hex');
const nonce = (n: number) => n.toString(16).padStart(64, '0');

const state = vi.hoisted(() => ({
  store: {
    lastSync: 1 as number | null,
    addresses: { unshielded: '' as string | null },
    utxos: [] as unknown[],
    sendProgress: null,
    privateSyncStatus: 'synced' as string,
    balances: { shieldedTokens: {} as Record<string, bigint> },
    activeWalletKey: '' as string | null,
  },
  wallet: null as unknown,
  submit: null as unknown as (...args: unknown[]) => Promise<unknown>,
}));

vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('@/chrome/messaging', () => ({ Messaging: {} }));
vi.mock('@/stores/walletStore', () => ({ walletStore: { isLocked: false } }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: state.store, midnightActions: { setSendProgress: vi.fn() } }));
vi.mock('@/services/walletManager.service', () => ({ walletManager: { getWallet: () => state.wallet } }));
vi.mock('@/chains/midnight/midnightWriteGate', () => ({ midnightWriteBlock: async () => null }));
vi.mock('@/chains/midnight/midnightTxIdentifiers', () => ({ midnightTxIdentifiers: async () => ['id'] }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ submitProvenMidnightTx: (...args: unknown[]) => state.submit(...args) }) }));

const { registerMidnightSwapHandlers } = await import('./midnightSwapHandlers');
const { MessageTypes } = await import('@/models/MessageTypes');
const { buildPrivateSwapOffer9, takePrivateSwapOffer9, PrivateSwapRefusedError } = await import('@/chains/midnight/midnightPrivateSwap9');
const { IntentInsufficientFundsError } = await import('@/chains/midnight/midnightConnectorIntent');
const { ledger9Keystore } = await import('@/chains/midnight/midnightLedger9');
const { publishMidnightPrivateCoins } = await import('@/chains/midnight/midnightPrivateCoins');
const { reservedSwapNullifiersFor } = await import('./midnightSwapOfferStore');
const { resetPrivateStoreForTest } = await import('@/utils/privateStore');
const { decodeSwapOffer } = await import('@/chains/midnight/midnightSwapOffer');
type PrivateSwap9Deps = import('@/chains/midnight/midnightPrivateSwap9').PrivateSwap9Deps;

/** A party: its seeds, its private coins, and the WalletBg methods the handlers call, over the real builder. */
function party(tag: number, id: number, coins: Array<{ type: string; value: bigint }>) {
  const zswapSeed = new Uint8Array(32).fill(tag);
  const unshieldedSecretKey = new Uint8Array(32).fill(tag + 100);
  const address = ledger9Keystore(unshieldedSecretKey, network).getBech32Address().toString();
  const core = () => {
    const keys = ledger.ZswapSecretKeys.fromSeed(zswapSeed);
    try {
      return coins.reduce((wallet, coin, i) => CoreWallet.apply(wallet, keys, ledger.ZswapOffer.fromOutput(
        ledger.ZswapOutput.new({ nonce: nonce(tag * 1000 + i), type: coin.type, value: coin.value }, 0, keys.coinPublicKey, keys.encryptionPublicKey))),
      CoreWallet.initEmpty(keys, network));
    } finally { keys.clear(); }
  };
  const deps: PrivateSwap9Deps = {
    withShieldedWallet: async (_args, use) => {
      const keys = ledger.ZswapSecretKeys.fromSeed(zswapSeed);
      try { return await use({ network, core: core(), keys, assertChainUnchanged: async () => {} }); } finally { keys.clear(); }
    },
    balanceFees: (async (args: { spread: { carrier: ledger.UnprovenTransaction; sign: (tx: ledger.UnprovenTransaction) => ledger.UnprovenTransaction; onBlock: (b: unknown) => void } }) => {
      args.spread.onBlock({ timestamp: Date.now(), ledgerParameters: params });
      return args.spread.sign(args.spread.carrier);
    }) as never,
    seal: async tx => ledger.Transaction.deserialize('signature', 'proof', 'binding', tx.mockProve().serialize()) as SealedTransaction9,
    now: () => Date.now(),
  };
  const keys = () => ({
    sdkNetworkId: network, endpoints: { sdkNetworkId: network } as never, zswapSecretKeySeed: zswapSeed, unshieldedSecretKey,
    utxos: [], sync: { lastSync: 1, addresses: { unshielded: address } }, proving: { device: true as const },
  });
  const wallet = {
    id,
    network: 'Preprod',
    chain: 'Midnight',
    buildMidnightConnectorIntent: vi.fn(),
    balanceMidnightConnectorTransaction: vi.fn(),
    buildMidnightPrivateSwapOffer: vi.fn(async (args: { terms: never; ttl?: Date; avoidNullifiers: readonly string[]; onProving?: () => void }) =>
      buildPrivateSwapOffer9({ ...keys(), terms: args.terms, ttl: args.ttl, avoidNullifiers: args.avoidNullifiers, onProving: args.onProving }, deps)),
    takeMidnightPrivateSwapOffer: vi.fn(async (args: { offerHex: string; approved: never; avoidNullifiers: readonly string[]; onProving?: () => void }) =>
      takePrivateSwapOffer9({
        ...keys(), offerHex: args.offerHex, approved: args.approved, avoidNullifiers: args.avoidNullifiers,
        dustSecretSeed: new Uint8Array(32).fill(9), onProving: args.onProving,
      }, deps)),
  };
  /** Log in as this party: its address and private balances in the store. */
  const login = () => {
    state.wallet = wallet;
    state.store.addresses.unshielded = address;
    state.store.activeWalletKey = address;
    state.store.utxos = [];
    const balances: Record<string, bigint> = {};
    for (const coin of coins) balances[coin.type] = (balances[coin.type] ?? 0n) + coin.value;
    state.store.balances.shieldedTokens = balances;
    publishMidnightPrivateCoins(undefined);
  };
  /** The private sync's view of this party's coins, as midnightPrivateSync.ts publishes it. */
  const coinView = (extra: { commitments?: string[]; without?: string[] } = {}) => {
    const k = ledger.ZswapSecretKeys.fromSeed(zswapSeed);
    try {
      const held = [...core().state.coins].map(coin => ledger.coinNullifier(coin, k.coinSecretKey).toLowerCase())
        .filter(nullifier => !(extra.without ?? []).includes(nullifier));
      publishMidnightPrivateCoins({ walletKey: address, nullifiers: new Set(held), commitments: new Set(extra.commitments ?? []), at: Date.now() });
    } finally { k.clear(); }
  };
  return { address, wallet, login, coinView };
}

const maker = party(1, 1, [{ type: X, value: 300n }, { type: X, value: 5_000n }]);
const taker = party(2, 2, [{ type: Y, value: 4_000n }]);
const sX = (amount: string) => ({ tokenType: X, amount, shielded: true });
const sY = (amount: string) => ({ tokenType: Y, amount, shielded: true });

type Leg = { tokenType: string; amount: string; shielded?: boolean };
type Rec = {
  offerId: string; offer: string; gives: Leg[]; wants: Leg[]; inputs: string[]; status: string; expiresAt: number;
  expiry?: string; intentHash: string; nullifiers?: string[]; commitments?: string[];
};
type Answer = {
  success?: boolean; error?: string; txHash?: string; record?: Rec; records?: Rec[];
  inspection?: { pay: Leg[]; get: Leg[]; maker: string | null; refusal?: string; private?: boolean; expiry?: string; expiresAt: number | null };
};
type Handler = (request: { id: number; data?: unknown }, sendResponse: (response: { data: Answer }) => void) => Promise<void>;
const handlers = new Map<string, Handler>();
registerMidnightSwapHandlers({ addToOptions: (method: string, handler: Handler) => handlers.set(method, handler) } as never);

async function call(type: string, data: Record<string, unknown> = {}): Promise<Answer> {
  let answer: Answer = {};
  await handlers.get(type)!({ id: 1, data }, (response) => { answer = response.data; });
  return answer;
}

const makeFullyPrivate = (give = sX('1000'), want = sY('1000')) =>
  call(MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, { give, want, ttlMinutes: 30, password: 'pw' });

beforeEach(async () => {
  vi.clearAllMocks();
  resetPrivateStoreForTest();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('gero-private-store');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  useMidnightChains({ preprod: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION], mainnet: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION] });
  state.store.lastSync = 1;
  state.store.privateSyncStatus = 'synced';
  state.submit = vi.fn(async () => ({ txHash: 'fe'.repeat(32) })) as never;
  maker.login();
});

describe('make a private offer', () => {
  it('builds it through the private builder and records its private coins and estimated expiry', async () => {
    const answer = await makeFullyPrivate();
    expect(answer.success).toBe(true);
    const record = answer.record!;
    expect(record).toMatchObject({ gives: [sX('1000')], wants: [sY('1000')], status: 'open', expiry: 'root-window', intentHash: '', inputs: [] });
    expect(record.nullifiers).toHaveLength(1);
    expect(record.commitments).toHaveLength(2);
    for (const value of [...record.nullifiers!, ...record.commitments!]) expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(record.expiresAt - Date.now()).toBeGreaterThan(54 * 60_000);
    expect(record.expiresAt - Date.now()).toBeLessThanOrEqual(55 * 60_000);
    expect(decodeSwapOffer(record.offer).length).toBeGreaterThan(10_000);
    // A fully private offer has no TTL to set; nothing was set aside yet.
    expect(maker.wallet.buildMidnightPrivateSwapOffer.mock.calls[0][0]).toMatchObject({ ttl: undefined, avoidNullifiers: [] });
    // Its record survives a re-read.
    const list = await call(MessageTypes.MIDNIGHT_SWAP_LIST_OFFERS);
    expect(list.records).toMatchObject([{ offerId: record.offerId, status: 'open' }]);
  });

  it('a second offer is built around the first one\'s private coins', async () => {
    const first = (await makeFullyPrivate(sX('200'))).record!;
    expect([...await reservedSwapNullifiersFor('Preprod', 1)]).toEqual(first.nullifiers);
    const second = (await makeFullyPrivate(sX('200'))).record!;
    expect(maker.wallet.buildMidnightPrivateSwapOffer.mock.calls[1][0].avoidNullifiers).toEqual(first.nullifiers);
    expect(second.nullifiers).not.toEqual(first.nullifiers);
  });

  it('refuses a private NIGHT leg, and more than the private balance before building', async () => {
    expect(await call(MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, { give: { tokenType: NIGHT, amount: '5', shielded: true }, want: sY('1'), ttlMinutes: 30 }))
      .toMatchObject({ success: false, error: 'SWAP_PRIVATE_shieldedNight' });
    expect(await makeFullyPrivate(sX('6000'))).toMatchObject({ success: false, error: 'SWAP_INSUFFICIENT_FUNDS' });
    expect(maker.wallet.buildMidnightPrivateSwapOffer).not.toHaveBeenCalled();
  });

  it('answers the builder\'s refusals with their codes', async () => {
    maker.wallet.buildMidnightPrivateSwapOffer.mockRejectedValueOnce(new PrivateSwapRefusedError('tooManyLegs'));
    expect(await makeFullyPrivate()).toMatchObject({ success: false, error: 'SWAP_PRIVATE_tooManyLegs' });
    maker.wallet.buildMidnightPrivateSwapOffer.mockRejectedValueOnce(new IntentInsufficientFundsError());
    expect(await makeFullyPrivate()).toMatchObject({ success: false, error: 'SWAP_INSUFFICIENT_FUNDS' });
  });
});

describe('the maker\'s private offer, read against the private sync', () => {
  it('is open while its coin is held, cancelled once spent, taken once a coin it created arrives', async () => {
    const record = (await makeFullyPrivate()).record!;
    const status = async () => (await call(MessageTypes.MIDNIGHT_SWAP_LIST_OFFERS)).records![0].status;
    expect(await status()).toBe('open'); // no private view yet: only the clock speaks
    maker.coinView();
    expect(await status()).toBe('open');
    maker.coinView({ without: record.nullifiers });
    expect(await status()).toBe('cancelled');
    maker.coinView({ without: record.nullifiers, commitments: [record.commitments![0]] });
    expect(await status()).toBe('taken');
  });

  it('is not withdrawn from the swap screens', async () => {
    const record = (await makeFullyPrivate()).record!;
    expect(await call(MessageTypes.MIDNIGHT_SWAP_WITHDRAW_OFFER, { offerId: record.offerId, password: 'pw' }))
      .toMatchObject({ success: false, error: 'SWAP_PRIVATE_NO_WITHDRAW' });
  });
});

describe('inspect and take a private offer', () => {
  it('the taker sees describePrivateSwapOffer9\'s terms, an estimated expiry and no public payee', async () => {
    const offer = (await makeFullyPrivate()).record!.offer;
    taker.login();
    const { inspection } = await call(MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER, { offer });
    expect(inspection).toMatchObject({ pay: [sY('1000')], get: [sX('1000')], private: true, expiry: 'root-window', maker: null });
    expect(inspection?.refusal).toBeUndefined();
    expect(inspection!.expiresAt! - Date.now()).toBeGreaterThan(54 * 60_000);
  });

  it('the maker is told it is their own offer: by its record, and by its coins on another device', async () => {
    const offer = (await makeFullyPrivate()).record!.offer;
    expect((await call(MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER, { offer })).inspection).toMatchObject({ refusal: 'SWAP_OFFER_OWN' });
    resetPrivateStoreForTest();
    await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase('gero-private-store'); r.onsuccess = () => resolve(); });
    maker.coinView();
    expect((await call(MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER, { offer })).inspection).toMatchObject({ refusal: 'SWAP_OFFER_OWN' });
  });

  it('a taker without enough of the private token is told so', async () => {
    const offer = (await makeFullyPrivate(sX('1000'), sY('4001'))).record!.offer;
    taker.login();
    expect((await call(MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER, { offer })).inspection).toMatchObject({ refusal: 'SWAP_INSUFFICIENT_FUNDS' });
  });

  it('takes only the terms shown, passing them back as approved, then submits the completed swap', async () => {
    const offer = (await makeFullyPrivate()).record!.offer;
    taker.login();
    const changed = await call(MessageTypes.MIDNIGHT_SWAP_TAKE_OFFER, { offer, expect: { pay: [sY('999')], get: [sX('1000')] }, password: 'pw' });
    expect(changed).toMatchObject({ success: false, error: 'SWAP_OFFER_CHANGED' });
    // The same amounts as a public leg are other terms.
    const publicKind = await call(MessageTypes.MIDNIGHT_SWAP_TAKE_OFFER, { offer, expect: { pay: [{ tokenType: Y, amount: '1000' }], get: [sX('1000')] }, password: 'pw' });
    expect(publicKind).toMatchObject({ success: false, error: 'SWAP_OFFER_CHANGED' });
    expect(taker.wallet.takeMidnightPrivateSwapOffer).not.toHaveBeenCalled();

    const answer = await call(MessageTypes.MIDNIGHT_SWAP_TAKE_OFFER, { offer, expect: { pay: [sY('1000')], get: [sX('1000')] }, password: 'pw' });
    expect(answer).toMatchObject({ success: true });
    expect(taker.wallet.takeMidnightPrivateSwapOffer.mock.calls[0][0]).toMatchObject({
      approved: { gives: [{ kind: 'shielded', type: Y, value: '1000' }], receives: [{ kind: 'shielded', type: X, value: '1000' }] },
      avoidNullifiers: [],
    });
    expect(state.submit).toHaveBeenCalledOnce();
    expect(taker.wallet.balanceMidnightConnectorTransaction).not.toHaveBeenCalled();
  });

  it('answers the builder\'s refusals with their codes', async () => {
    const offer = (await makeFullyPrivate()).record!.offer;
    taker.login();
    const take = () => call(MessageTypes.MIDNIGHT_SWAP_TAKE_OFFER, { offer, expect: { pay: [sY('1000')], get: [sX('1000')] }, password: 'pw' });
    taker.wallet.takeMidnightPrivateSwapOffer.mockRejectedValueOnce(new PrivateSwapRefusedError('own'));
    expect(await take()).toMatchObject({ success: false, error: 'SWAP_PRIVATE_own' });
    taker.wallet.takeMidnightPrivateSwapOffer.mockRejectedValueOnce(new IntentInsufficientFundsError());
    expect(await take()).toMatchObject({ success: false, error: 'SWAP_INSUFFICIENT_FUNDS' });
    state.submit = vi.fn(async () => { throw new Error('Nullifier already present in the ledger'); }) as never;
    expect(await take()).toMatchObject({ success: false, error: 'SWAP_OFFER_GONE' });
  });
});
