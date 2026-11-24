// @vitest-environment node
// The worker's Midnight swap handlers, against the real ledger 9 builder and a
// real private store: the page sends intent, the worker reads every figure from
// the bytes and the logged wallet's own coins.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { MidnightBech32m, UnshieldedAddress } from 'midnight-v9-address-format';
import { LEDGER8_PROTOCOL_VERSION, LEDGER9_PROTOCOL_VERSION_SAMPLE, useMidnightChains } from '@test/helpers/midnightChains';
import type { MidnightUnshieldedUtxo } from '@/chains/midnight/midnightTypes';

const NIGHT = '00'.repeat(32);
const TOKEN = 'ab'.repeat(32);
// Public synthetic keys and nonexistent UTxOs. Never fund.
const MAKER_SECRET = new Uint8Array(32).fill(1);
const TAKER_SECRET = new Uint8Array(32).fill(2);
const bech32Of = (secret: Uint8Array) => {
  const key = ledger.signatureVerifyingKey({ tag: 'schnorr', value: Buffer.from(secret).toString('hex') });
  return MidnightBech32m.encode('preprod', new UnshieldedAddress(Buffer.from(ledger.addressFromKey(key), 'hex'))).asString();
};
const MAKER = bech32Of(MAKER_SECRET);
const TAKER = bech32Of(TAKER_SECRET);
const coin = (owner: string, tokenType: string, value: bigint, hash: string, index = 0): MidnightUnshieldedUtxo => ({
  owner, tokenType, value, intentHash: hash, outputIndex: index, ctime: 1, initialNonce: '', registeredForDustGeneration: false,
});

const state = vi.hoisted(() => ({
  store: { lastSync: 1 as number | null, addresses: { unshielded: '' as string | null }, utxos: [] as unknown[], sendProgress: null },
  wallet: null as unknown,
  submit: null as unknown as (...args: unknown[]) => Promise<unknown>,
  writeBlock: null as string | null,
}));

vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('@/chrome/messaging', () => ({ Messaging: {} }));
vi.mock('@/stores/walletStore', () => ({ walletStore: { isLocked: false } }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: state.store, midnightActions: { setSendProgress: vi.fn() } }));
vi.mock('@/services/walletManager.service', () => ({ walletManager: { getWallet: () => state.wallet } }));
vi.mock('@/chains/midnight/midnightWriteGate', () => ({ midnightWriteBlock: async () => state.writeBlock }));
vi.mock('@/chains/midnight/midnightTxIdentifiers', () => ({ midnightTxIdentifiers: async () => ['id'] }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ submitProvenMidnightTx: (...args: unknown[]) => state.submit(...args) }) }));

const { registerMidnightSwapHandlers } = await import('./midnightSwapHandlers');
const { MessageTypes } = await import('@/models/MessageTypes');
const { buildConnectorIntent9 } = await import('@/chains/midnight/midnightIntentBuilder9');
const { getMidnightEndpoints } = await import('@/chains/midnight/midnightConfig');
const { reservedSwapCoinsFor } = await import('./midnightSwapOfferStore');
const { resetPrivateStoreForTest } = await import('@/utils/privateStore');
const { decodeSwapOffer } = await import('@/chains/midnight/midnightSwapOffer');

const noProver: ledger.ProvingProvider = {
  check: async () => { throw new Error('unexpected proof-server call'); },
  prove: async () => { throw new Error('unexpected proof-server call'); },
  lookupKey: async () => undefined,
};
const builderDeps = {
  balanceFees: (async (args: { sdkNetworkId: string }) => ledger.Transaction.fromParts(args.sdkNetworkId)) as never,
  provingProvider: async () => noProver,
};

/** The worker's WalletBg, cut to what the handlers call: the real ledger 9 builder over the store's coins. */
function fakeWallet(secret: Uint8Array, id: number, network = 'Preprod') {
  return {
    id,
    network,
    chain: 'Midnight',
    buildMidnightConnectorIntent: vi.fn(async (request, _password, _prf, opts: { ttl?: Date; onlyCoins?: ReadonlySet<string> } = {}) => {
      const coinFilter = opts.onlyCoins ? { only: opts.onlyCoins } : { exclude: await reservedSwapCoinsFor(network, id) };
      const built = await buildConnectorIntent9({
        sdkNetworkId: 'preprod', endpoints: getMidnightEndpoints('Preprod')!, request, unshieldedSecretKey: secret,
        dustSecretSeed: new Uint8Array(32).fill(9), utxos: state.store.utxos as MidnightUnshieldedUtxo[], sync: state.store,
        coinFilter, proving: { device: true }, ttl: opts.ttl,
      }, builderDeps);
      return { tx: built.txHex, segmentId: built.segmentId };
    }),
    balanceMidnightConnectorTransaction: vi.fn(async (txHex: string, _password?: string, _prf?: Uint8Array, _sealed?: boolean) => ({ tx: txHex })),
  };
}

type Leg = { tokenType: string; amount: string };
type Rec = { offerId: string; offer: string; gives: Leg[]; wants: Leg[]; inputs: string[]; status: string; expiresAt: number; owner: string };
/** A handler's answer, as the pages read it. */
type Answer = {
  success?: boolean;
  error?: string;
  txHash?: string;
  record?: Rec;
  records?: Rec[];
  inspection?: { pay: Leg[]; get: Leg[]; maker: string | null; refusal?: string };
};
type Handler = (request: { id: number; data?: unknown }, sendResponse: (response: { data: Answer }) => void) => Promise<void>;
const handlers = new Map<string, Handler>();
registerMidnightSwapHandlers({ addToOptions: (method: string, handler: Handler) => handlers.set(method, handler) } as never);

async function call(type: string, data: Record<string, unknown> = {}): Promise<Answer> {
  let answer: Answer = {};
  await handlers.get(type)!({ id: 1, data }, (response) => { answer = response.data; });
  return answer;
}

const GIVE = { tokenType: NIGHT, amount: '30' };
const WANT = { tokenType: TOKEN, amount: '7' };
const makerCoins = () => [coin(MAKER, NIGHT, 50n, '11'.repeat(32)), coin(MAKER, NIGHT, 40n, '22'.repeat(32))];

function asMaker() {
  state.wallet = fakeWallet(MAKER_SECRET, 1);
  state.store.addresses.unshielded = MAKER;
  state.store.utxos = makerCoins();
}

function asTaker() {
  state.wallet = fakeWallet(TAKER_SECRET, 2);
  state.store.addresses.unshielded = TAKER;
  state.store.utxos = [coin(TAKER, TOKEN, 100n, '33'.repeat(32))];
}

beforeEach(async () => {
  // Each test starts with no stored offers.
  resetPrivateStoreForTest();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('gero-private-store');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  useMidnightChains({ preprod: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION], mainnet: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION] });
  state.store.lastSync = 1;
  state.writeBlock = null;
  state.submit = vi.fn(async () => ({ txHash: 'fe'.repeat(32) })) as never;
  asMaker();
});

describe('make', () => {
  it('seals the requested offer from the wallet\'s coins with no fee, and records it from the bytes', async () => {
    const answer = await call(MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, { give: GIVE, want: WANT, ttlMinutes: 30, password: 'pw' });
    expect(answer.success).toBe(true);
    const record = answer.record!;
    expect(record).toMatchObject({ gives: [GIVE], wants: [WANT], status: 'open', owner: MAKER });
    expect(record.inputs).toHaveLength(1);
    expect(record.expiresAt - Date.now()).toBeGreaterThan(28 * 60_000);
    expect(record.expiresAt - Date.now()).toBeLessThanOrEqual(30 * 60_000 + 1_000);
    expect(decodeSwapOffer(record.offer).length).toBeGreaterThan(0);
    const [request] = (state.wallet as ReturnType<typeof fakeWallet>).buildMidnightConnectorIntent.mock.calls[0];
    expect(request).toMatchObject({ payFees: false, intentId: 'random', outputs: [{ recipient: MAKER, type: TOKEN, value: '7' }] });

    const list = await call(MessageTypes.MIDNIGHT_SWAP_LIST_OFFERS);
    expect(list.records).toHaveLength(1);
    expect([...await reservedSwapCoinsFor('Preprod', 1)]).toEqual(record.inputs);
  });

  it('a second offer leaves the first offer\'s coin alone', async () => {
    const first = (await call(MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, { give: GIVE, want: WANT, ttlMinutes: 10, password: 'pw' })).record!;
    const second = (await call(MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, { give: GIVE, want: WANT, ttlMinutes: 10, password: 'pw' })).record!;
    expect(second.inputs).not.toEqual(first.inputs);
    // Nothing left to give: answered before the wallet is unlocked.
    const third = await call(MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, { give: GIVE, want: WANT, ttlMinutes: 10, password: 'pw' });
    expect(third).toMatchObject({ success: false, error: 'SWAP_INSUFFICIENT_FUNDS' });
  });

  it('refuses outside the network gate, an expiry it does not offer, the same token twice, and before a sync', async () => {
    state.wallet = fakeWallet(MAKER_SECRET, 1, 'Mainnet');
    expect(await call(MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, { give: GIVE, want: WANT, ttlMinutes: 30 })).toMatchObject({ error: 'SWAP_UNAVAILABLE' });
    asMaker();
    expect((await call(MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, { give: GIVE, want: WANT, ttlMinutes: 60 })).success).toBe(false);
    expect((await call(MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, { give: GIVE, want: { ...GIVE, amount: '5' }, ttlMinutes: 30 })).success).toBe(false);
    state.store.lastSync = null;
    expect(await call(MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, { give: GIVE, want: WANT, ttlMinutes: 30 })).toMatchObject({ error: 'MIDNIGHT_WALLET_NOT_SYNCED' });
    expect((state.wallet as ReturnType<typeof fakeWallet>).buildMidnightConnectorIntent).not.toHaveBeenCalled();
  });
});

describe('inspect and take', () => {
  async function makeOffer(): Promise<string> {
    const answer = await call(MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, { give: GIVE, want: WANT, ttlMinutes: 30, password: 'pw' });
    return answer.record!.offer;
  }

  it('the taker sees what they pay and get, read from the bytes, and who the other wallet is', async () => {
    const offer = await makeOffer();
    asTaker();
    const answer = await call(MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER, { offer });
    expect(answer.inspection).toMatchObject({ pay: [WANT], get: [GIVE], maker: MAKER });
    expect(answer.inspection?.refusal).toBeUndefined();
  });

  it('the maker cannot take their own offer; a taker without the asked token is told so', async () => {
    const offer = await makeOffer();
    expect((await call(MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER, { offer })).inspection).toMatchObject({ refusal: 'SWAP_OFFER_OWN' });
    asTaker();
    state.store.utxos = [coin(TAKER, TOKEN, 6n, '33'.repeat(32))];
    expect((await call(MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER, { offer })).inspection).toMatchObject({ refusal: 'SWAP_INSUFFICIENT_FUNDS' });
  });

  it('takes only the terms the page showed, then balances (sealed) and submits', async () => {
    const offer = await makeOffer();
    asTaker();
    const changed = await call(MessageTypes.MIDNIGHT_SWAP_TAKE_OFFER, { offer, expect: { pay: [{ ...WANT, amount: '6' }], get: [GIVE] }, password: 'pw' });
    expect(changed).toMatchObject({ success: false, error: 'SWAP_OFFER_CHANGED' });
    const wallet = state.wallet as ReturnType<typeof fakeWallet>;
    expect(wallet.balanceMidnightConnectorTransaction).not.toHaveBeenCalled();

    const taken = await call(MessageTypes.MIDNIGHT_SWAP_TAKE_OFFER, { offer, expect: { pay: [WANT], get: [GIVE] }, password: 'pw' });
    // The ledger hash history shows, read from the submitted bytes; not submit-proven's extrinsic hash.
    const ledgerHash = ledger.Transaction.deserialize('signature', 'proof', 'binding', decodeSwapOffer(offer)).transactionHash().toLowerCase().replace(/^0x/, '');
    expect(taken).toMatchObject({ success: true, txHash: ledgerHash });
    const [hex, password, , sealed] = wallet.balanceMidnightConnectorTransaction.mock.calls[0];
    expect(Buffer.from(hex as string, 'hex')).toEqual(Buffer.from(decodeSwapOffer(offer)));
    expect(password).toBe('pw');
    expect(sealed).toBe(true);
    expect(state.submit as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
  });

  it('a node refusing spent inputs is SWAP_OFFER_GONE; a paused network refuses before balancing', async () => {
    const offer = await makeOffer();
    asTaker();
    state.submit = vi.fn(async () => { throw new Error('Transaction failed: input already spent'); }) as never;
    expect(await call(MessageTypes.MIDNIGHT_SWAP_TAKE_OFFER, { offer, expect: { pay: [WANT], get: [GIVE] }, password: 'pw' }))
      .toMatchObject({ success: false, error: 'SWAP_OFFER_GONE' });
    state.writeBlock = 'networkUpgrading';
    const wallet = state.wallet as ReturnType<typeof fakeWallet>;
    wallet.balanceMidnightConnectorTransaction.mockClear();
    expect(await call(MessageTypes.MIDNIGHT_SWAP_TAKE_OFFER, { offer, expect: { pay: [WANT], get: [GIVE] }, password: 'pw' }))
      .toMatchObject({ error: 'SWAP_UNAVAILABLE' });
    expect(wallet.balanceMidnightConnectorTransaction).not.toHaveBeenCalled();
  });

  it('a string that is not an offer is SWAP_OFFER_UNREADABLE', async () => {
    expect(await call(MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER, { offer: 'swapoffer1qqqq' })).toMatchObject({ error: 'SWAP_OFFER_UNREADABLE' });
    expect(await call(MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER, { offer: 42 })).toMatchObject({ error: 'SWAP_OFFER_UNREADABLE' });
  });
});

describe('withdraw', () => {
  it('re-sends exactly the offered coins to the wallet, pays the fee, and the offer closes once they are gone', async () => {
    const record = (await call(MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, { give: GIVE, want: WANT, ttlMinutes: 30, password: 'pw' })).record!;
    const wallet = state.wallet as ReturnType<typeof fakeWallet>;
    wallet.buildMidnightConnectorIntent.mockClear();

    const answer = await call(MessageTypes.MIDNIGHT_SWAP_WITHDRAW_OFFER, { offerId: record.offerId, password: 'pw' });
    expect(answer.success).toBe(true);
    expect(answer.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(answer.txHash).not.toBe('fe'.repeat(32));
    const [request, , , opts] = wallet.buildMidnightConnectorIntent.mock.calls[0];
    expect(request).toMatchObject({ payFees: true, outputs: [{ recipient: MAKER, type: NIGHT }] });
    expect([...(opts as { onlyCoins: Set<string> }).onlyCoins]).toEqual(record.inputs);

    // A second withdrawal is refused; once the coins are gone the offer reads as cancelled.
    expect(await call(MessageTypes.MIDNIGHT_SWAP_WITHDRAW_OFFER, { offerId: record.offerId, password: 'pw' })).toMatchObject({ error: 'SWAP_OFFER_NOT_OPEN' });
    state.store.utxos = (state.store.utxos as MidnightUnshieldedUtxo[]).filter(u => `${u.intentHash}#${u.outputIndex}` !== record.inputs[0]);
    const list = await call(MessageTypes.MIDNIGHT_SWAP_LIST_OFFERS);
    expect(list.records?.[0].status).toBe('cancelled');
  });

  it('an unknown offer is SWAP_OFFER_UNKNOWN', async () => {
    expect(await call(MessageTypes.MIDNIGHT_SWAP_WITHDRAW_OFFER, { offerId: 'cd'.repeat(32), password: 'pw' })).toMatchObject({ error: 'SWAP_OFFER_UNKNOWN' });
  });
});
