// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { MidnightBech32m, UnshieldedAddress } from 'midnight-v9-address-format';
import { buildConnectorIntent9 } from './midnightIntentBuilder9';
import type { BuildConnectorIntent9Deps } from './midnightIntentBuilder9';
import { CONNECTOR_MINIMUM_DUST_SPENDS } from './midnightDappBalancer9';
import {
  CONNECTOR_INTENT_TTL_MS, IntentInsufficientFundsError, MIDNIGHT_WALLET_NOT_SYNCED, validateConnectorIntentRequest,
} from './midnightConnectorIntent';
import type { ConnectorIntentRequest } from './midnightConnectorIntent';
import { MIDNIGHT_LEDGER_CHANGED, MIDNIGHT_LEDGER_UNKNOWN, forgetMidnightLedgersForTests } from './midnightLedger';
import { getMidnightEndpoints } from './midnightConfig';
import type { MidnightUnshieldedUtxo } from './midnightTypes';
import { LEDGER8_PROTOCOL_VERSION, LEDGER9_PROTOCOL_VERSION_SAMPLE, useMidnightChains } from '@test/helpers/midnightChains';

vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

// Public synthetic keys and nonexistent UTxOs. Never fund.
const secret = new Uint8Array(32).fill(1);
const key = ledger.signatureVerifyingKey({ tag: 'schnorr', value: Buffer.from(secret).toString('hex') });
const own = ledger.addressFromKey(key);
const stranger = ledger.addressFromKey(ledger.signatureVerifyingKey({ tag: 'schnorr', value: '02'.repeat(32) }));
const NIGHT = '00'.repeat(32);
const FOO = 'ab'.repeat(32);

const bech32 = (address: string, network = 'preprod') =>
  MidnightBech32m.encode(network, new UnshieldedAddress(Buffer.from(address, 'hex'))).asString();

const noProver: ledger.ProvingProvider = {
  check: async () => { throw new Error('unexpected proof-server call'); },
  prove: async () => { throw new Error('unexpected proof-server call'); },
  lookupKey: async () => undefined,
};

const utxo = (value: bigint, index = 0, overrides: Partial<MidnightUnshieldedUtxo> = {}): MidnightUnshieldedUtxo => ({
  owner: bech32(own), tokenType: NIGHT, value, intentHash: '11'.repeat(32), outputIndex: index, ctime: 1_700_000_000,
  initialNonce: '', registeredForDustGeneration: false, ...overrides,
});

/** Give 30 NIGHT (from a 50 NIGHT coin, 20 change), want 7 FOO paid to the wallet. */
const REQUEST: ConnectorIntentRequest = {
  inputs: [{ type: NIGHT, value: '30' }],
  outputs: [{ kind: 'unshielded', type: FOO, value: '7', recipient: bech32(own) }],
  intentId: 7,
  payFees: false,
};

type Sealed = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.Binding>;
const sealed = (hex: string): Sealed => ledger.Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(hex, 'hex'));

/** The unshielded imbalances of every segment, summed per colour. */
function imbalances(tx: Sealed): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const segment of [0, ...(tx.intents?.keys() ?? [])]) {
    for (const [token, value] of tx.imbalances(segment)) {
      if (token.tag !== 'unshielded' || value === 0n) continue;
      out[token.raw] = (out[token.raw] ?? 0n) + value;
    }
  }
  return out;
}

describe('makeIntent on a ledger 9 chain', () => {
  const balanceFees = vi.fn();
  const provingProvider = vi.fn(async () => noProver);
  const deps = { balanceFees, provingProvider } as unknown as BuildConnectorIntent9Deps;

  beforeEach(() => {
    balanceFees.mockReset();
    provingProvider.mockClear();
    useMidnightChains({ preprod: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION], mainnet: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION] });
    // An empty fee transaction: nothing to prove, so the proving path runs without a proof server.
    balanceFees.mockImplementation(async (args: { sdkNetworkId: string }) => ledger.Transaction.fromParts(args.sdkNetworkId));
  });

  const args = (overrides: Record<string, unknown> = {}) => ({
    sdkNetworkId: 'preprod', endpoints: getMidnightEndpoints('Preprod')!, request: REQUEST,
    unshieldedSecretKey: secret, dustSecretSeed: new Uint8Array(32).fill(2), utxos: [utxo(50n)],
    sync: { lastSync: 1, addresses: { unshielded: bech32(own) } },
    proving: { url: 'http://localhost:6301' }, ...overrides,
  });

  it('without fees: gives from the wallet\'s coin, wants the request, lands at the requested segment, seals; no fee, no prover', async () => {
    const result = await buildConnectorIntent9(args(), deps);
    expect(result.segmentId).toBe(7);
    expect(balanceFees).not.toHaveBeenCalled();
    expect(provingProvider).not.toHaveBeenCalled();

    const tx = sealed(result.txHex);
    expect([...tx.intents!.keys()]).toEqual([7]);
    // Purposefully imbalanced: +30 NIGHT given, -7 FOO wanted.
    expect(imbalances(tx)).toEqual({ [NIGHT]: 30n, [FOO]: -7n });
    const intent = tx.intents!.get(7)!;
    expect(intent.fallibleUnshieldedOffer).toBeUndefined();
    const offer = intent.guaranteedUnshieldedOffer!;
    expect(offer.inputs.map(input => [input.value, input.owner])).toEqual([[50n, key]]);
    expect(offer.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ owner: own, type: NIGHT, value: 20n }), expect.objectContaining({ owner: own, type: FOO, value: 7n }),
    ]));
    expect(offer.outputs).toHaveLength(2);
  });

  it('signs after the segment move: the signature verifies for the final segment, not the SDK\'s segment 1', async () => {
    const result = await buildConnectorIntent9(args({ request: { ...REQUEST, intentId: 4242 } }), deps);
    const intent = sealed(result.txHex).intents!.get(4242)!;
    const [{ value: signature }] = intent.guaranteedUnshieldedOffer!.signatures;
    expect(ledger.verifySignature(key, intent.signatureData(4242), signature)).toBe(true);
    expect(ledger.verifySignature(key, intent.signatureData(1), signature)).toBe(false);
  });

  it('with fees: pays the DUST fee on the built intent as a connector fee (two spends), proves wallet-side, merges', async () => {
    const result = await buildConnectorIntent9(args({ request: { ...REQUEST, intentId: 'random', payFees: true } }), deps);
    expect(balanceFees).toHaveBeenCalledOnce();
    const [feeArgs, feeTxs] = balanceFees.mock.calls[0];
    expect(feeArgs).toMatchObject({ sdkNetworkId: 'preprod', minimumDustSpends: CONNECTOR_MINIMUM_DUST_SPENDS });
    expect(feeArgs.dustSecretSeed).toEqual(new Uint8Array(32).fill(2));
    expect(feeArgs.ttl.getTime()).toBeGreaterThan(Date.now());
    expect(feeTxs).toHaveLength(1);
    expect([...feeTxs[0].intents.keys()]).toEqual([result.segmentId]);
    expect(provingProvider).toHaveBeenCalledWith({ url: 'http://localhost:6301' }, 'preprod');
    expect(result.segmentId).toBeGreaterThanOrEqual(1);
    expect(result.segmentId).toBeLessThanOrEqual(65_535);
    expect(imbalances(sealed(result.txHex))).toEqual({ [NIGHT]: 30n, [FOO]: -7n });
  });

  it('a want-only intent spends nothing; a want in the colour it gives nets', async () => {
    const wantOnly = await buildConnectorIntent9(args({ request: { ...REQUEST, inputs: [] } }), deps);
    const offer = sealed(wantOnly.txHex).intents!.get(7)!.guaranteedUnshieldedOffer!;
    expect(offer.inputs).toHaveLength(0);
    expect(offer.signatures).toHaveLength(0);
    expect(imbalances(sealed(wantOnly.txHex))).toEqual({ [FOO]: -7n });

    const netted = await buildConnectorIntent9(args({
      request: { ...REQUEST, outputs: [{ kind: 'unshielded', type: NIGHT, value: '10', recipient: bech32(stranger) }] },
    }), deps);
    expect(imbalances(sealed(netted.txHex))).toEqual({ [NIGHT]: 20n });
  });

  it('selects only UTxO rows the wallet\'s own address owns', async () => {
    const foreign = utxo(40n, 1, { owner: bech32(stranger), intentHash: '33'.repeat(32) });
    const result = await buildConnectorIntent9(args({ utxos: [foreign, utxo(50n)] }), deps);
    const offer = sealed(result.txHex).intents!.get(7)!.guaranteedUnshieldedOffer!;
    expect(offer.inputs.map(input => input.value)).toEqual([50n]);
    // A foreign row alone funds nothing.
    await expect(buildConnectorIntent9(args({ utxos: [{ ...foreign, value: 1_000n }] }), deps)).rejects.toBeInstanceOf(IntentInsufficientFundsError);
  });

  it('a give the wallet cannot cover is InsufficientFunds, before any fee work', async () => {
    await expect(buildConnectorIntent9(args({ utxos: [utxo(29n)], request: { ...REQUEST, payFees: true } }), deps))
      .rejects.toBeInstanceOf(IntentInsufficientFundsError);
    expect(balanceFees).not.toHaveBeenCalled();
  });

  it('review S1: refuses before any coin is chosen unless the wallet\'s sync follows the signing key', async () => {
    const paying = { ...REQUEST, payFees: true };
    await expect(buildConnectorIntent9(args({ request: paying, sync: { lastSync: null, addresses: { unshielded: bech32(own) } } }), deps))
      .rejects.toThrow(MIDNIGHT_WALLET_NOT_SYNCED);
    await expect(buildConnectorIntent9(args({ request: paying, sync: { lastSync: 1, addresses: { unshielded: bech32(stranger) } } }), deps))
      .rejects.toThrow(MIDNIGHT_WALLET_NOT_SYNCED);
    await expect(buildConnectorIntent9(args({ request: paying, sync: { lastSync: 1, addresses: {} } }), deps))
      .rejects.toThrow(MIDNIGHT_WALLET_NOT_SYNCED);
    expect(balanceFees).not.toHaveBeenCalled();
  });

  it('follows the chain\'s ledger: unread, ledger 8, and a change while the intent is prepared are typed refusals', async () => {
    forgetMidnightLedgersForTests();
    await expect(buildConnectorIntent9(args(), deps)).rejects.toThrow(MIDNIGHT_LEDGER_UNKNOWN);
    useMidnightChains({ preprod: [LEDGER8_PROTOCOL_VERSION, LEDGER8_PROTOCOL_VERSION] });
    await expect(buildConnectorIntent9(args(), deps)).rejects.toThrow(MIDNIGHT_LEDGER_CHANGED);
    expect(balanceFees).not.toHaveBeenCalled();

    // The chain reports ledger 8 while the fee is being prepared: nothing sealed is handed out.
    useMidnightChains({ preprod: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION] });
    balanceFees.mockImplementation(async (feeArgs: { sdkNetworkId: string }) => {
      useMidnightChains({ preprod: [LEDGER8_PROTOCOL_VERSION, LEDGER8_PROTOCOL_VERSION] });
      return ledger.Transaction.fromParts(feeArgs.sdkNetworkId);
    });
    await expect(buildConnectorIntent9(args({ request: { ...REQUEST, payFees: true } }), deps)).rejects.toThrow(MIDNIGHT_LEDGER_CHANGED);
  });

  it('refuses endpoints of another network', async () => {
    await expect(buildConnectorIntent9(args({ endpoints: getMidnightEndpoints('Mainnet')! }), deps)).rejects.toThrow('endpoint network mismatch');
  });

  it('the request check that gates the prompt accepts the same request on ledger 9', () => {
    const data = {
      desiredInputs: [{ kind: 'unshielded', type: NIGHT, value: '30' }],
      desiredOutputs: [{ kind: 'unshielded', type: FOO, value: '7', recipient: bech32(own) }],
      options: { intentId: 7, payFees: false },
    };
    expect(validateConnectorIntentRequest(data, 'Preprod')).toEqual({ ok: true, ...REQUEST });
  });
});

/**
 * A real ledger 9 chain (no node, nothing submitted): the maker's NIGHT comes
 * from a rewards claim, the intent is built from the chain's own UTxO, and the
 * ledger itself applies the sealed intent with signatures checked.
 */
describe('a sealed ledger 9 intent the ledger accepts', () => {
  const network = 'preprod';

  /** A chain whose blocks start at `startMs` (the chain's clock), with `amount` NIGHT on the maker's address. */
  function chainWithMakerCoin(amount: bigint, startMs = Date.now()) {
    let time = new Date(Math.floor(startMs / 1000) * 1000);
    let chain = ledger.LedgerState.blank(network);
    const apply = (tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>, strict: ledger.WellFormedStrictness) => {
      const seconds = BigInt(Math.floor(time.getTime() / 1000));
      const context = new ledger.TransactionContext(chain, { secondsSinceEpoch: seconds,
        secondsSinceEpochErr: 0, lastBlockTime: seconds - 1n, parentBlockHash: '00'.repeat(32) });
      const [next, result] = chain.apply(tx.wellFormed(chain, strict, time), context);
      chain = next.postBlockUpdate(time);
      time = new Date(time.getTime() + 1000);
      return result;
    };
    // Only fixture manufacture skips the reward claim's signature.
    const manufacture = new ledger.WellFormedStrictness();
    manufacture.enforceBalancing = false;
    manufacture.verifySignatures = false;
    chain = chain.testingDistributeNight(own, amount, time);
    const claimed = apply(ledger.Transaction.fromRewards(new ledger.ClaimRewardsTransaction('signature-erased', network, amount,
      key, '44'.repeat(32), new ledger.SignatureErased())), manufacture);
    expect(claimed.type, claimed.error).toBe('success');
    const rows: MidnightUnshieldedUtxo[] = [...chain.utxo.filter(own)].map(coin => ({
      owner: bech32(own), tokenType: coin.type, value: coin.value, intentHash: coin.intentHash, outputIndex: coin.outputNo,
      ctime: Math.floor(time.getTime() / 1000), initialNonce: '', registeredForDustGeneration: false,
    }));
    return { rows, apply, utxos: () => [...chain.utxo.filter(own)], strangerUtxos: () => [...chain.utxo.filter(stranger)] };
  }
  type Maker = ReturnType<typeof chainWithMakerCoin>;

  /** Give 30 000 NIGHT, want 5 000 of it paid to `stranger`: a 25 000 NIGHT surplus. */
  const REQUEST_ON_CHAIN: ConnectorIntentRequest = {
    inputs: [{ type: NIGHT, value: '30000' }],
    outputs: [{ kind: 'unshielded', type: NIGHT, value: '5000', recipient: bech32(stranger) }],
    intentId: 9,
    payFees: false,
  };

  /** The maker's sealed intent, built with the default TTL by a wallet whose clock runs `clockAheadMs` ahead of the chain. */
  async function makeIntentOn(maker: Maker, options: { clockAheadMs?: number; ttl?: Date } = {}): Promise<Sealed> {
    const real = Date.now();
    // The chain read stays fresh for a skew under a minute, so nothing is fetched.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(real + (options.clockAheadMs ?? 0));
    try {
      const result = await buildConnectorIntent9({
        sdkNetworkId: network, endpoints: getMidnightEndpoints('Preprod')!, request: REQUEST_ON_CHAIN,
        unshieldedSecretKey: secret, dustSecretSeed: new Uint8Array(32).fill(2), utxos: maker.rows,
        sync: { lastSync: 1, addresses: { unshielded: bech32(own) } }, proving: { url: 'http://localhost:6301' }, ttl: options.ttl,
      }, { balanceFees: vi.fn(), provingProvider: vi.fn() } as unknown as BuildConnectorIntent9Deps);
      return sealed(result.txHex);
    } finally {
      clock.mockRestore();
    }
  }

  /** A counterparty takes the 25 000 NIGHT surplus in its own sealed intent; merged, the chain applies the swap. */
  async function fillAndApply(maker: Maker, tx: Sealed) {
    const take = ledger.Intent.new(new Date(Date.now() + 30 * 60_000));
    take.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([], [{ value: 25_000n, owner: stranger, type: NIGHT }], []);
    const counter = (await ledger.Transaction.fromParts(network).addIntent({ tag: 'specific', value: 2 }, take)
      .prove(noProver, ledger.CostModel.initialCostModel())).bind();
    const swap = tx.merge(counter);
    expect(imbalances(swap)).toEqual({});
    // Every signature checked; fees are not part of this check.
    const strict = new ledger.WellFormedStrictness();
    strict.enforceBalancing = false;
    return maker.apply(swap, strict);
  }

  beforeEach(() => {
    useMidnightChains({ preprod: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION] });
  });

  it('spends the chain\'s own coin with a signature valid at the requested segment; balancing is left to the counterparty', async () => {
    // Above the ledger's reward payout threshold.
    const maker = chainWithMakerCoin(100_000n);
    expect(maker.rows).toHaveLength(1);
    const tx = await makeIntentOn(maker);

    // Imbalanced on purpose: the ledger's balancing check refuses it as it stands.
    expect(() => tx.wellFormed(ledger.LedgerState.blank(network), new ledger.WellFormedStrictness(), new Date())).toThrow();

    const applied = await fillAndApply(maker, tx);
    expect(applied.type, applied.error).toBe('success');
    expect(maker.utxos().map(coin => coin.value)).toEqual([70_000n]);
    expect(maker.strangerUtxos().map(coin => coin.value).toSorted((x, y) => Number(x - y))).toEqual([5_000n, 25_000n]);

    // Alone, the imbalanced intent is refused by the chain: it would leave NIGHT unaccounted for.
    const strict = new ledger.WellFormedStrictness();
    strict.enforceBalancing = false;
    const alone = chainWithMakerCoin(100_000n).apply(tx, strict);
    expect(alone.type).toBe('failure');
    expect(alone.error).toMatch(/total supply of night/);
  });

  it('the default TTL keeps a margin under the ledger\'s one-hour cap: a wallet clock 30 s ahead, filled at once, still applies', async () => {
    expect(CONNECTOR_INTENT_TTL_MS).toBe(55 * 60_000);
    const maker = chainWithMakerCoin(100_000n);
    const tx = await makeIntentOn(maker, { clockAheadMs: 30_000 });
    const applied = await fillAndApply(maker, tx);
    expect(applied.type, applied.error).toBe('success');
  });

  it('the cap is the ledger\'s own: an intent expiring more than an hour past the block is refused', async () => {
    const maker = chainWithMakerCoin(100_000n);
    // What a 60-minute TTL built on a clock 30 s ahead would carry.
    const tx = await makeIntentOn(maker, { ttl: new Date(Date.now() + 30_000 + 60 * 60_000) });
    await expect(fillAndApply(maker, tx)).rejects.toThrow(/TTL is too far in the future/);
  });
});
