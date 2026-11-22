// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { MidnightBech32m, UnshieldedAddress } from 'midnight-v9-address-format';
import {
  balanceSealedTransaction9, chooseLargestCoin9, decodeSealedTransaction9, sealedBalancePrompt, SEALED_BALANCE_REFUSALS, summarizeSealed9,
} from './midnightSealedBalancer9';
import { buildConnectorIntent9, type BuildConnectorIntent9Deps } from './midnightIntentBuilder9';
import { CONNECTOR_INTENT_TTL_MS, MIDNIGHT_WALLET_NOT_SYNCED } from './midnightConnectorIntent';
import { ledger9Keystore, signLedger9Intents } from './midnightLedger9';
import { getMidnightEndpoints } from './midnightConfig';
import type { MidnightUnshieldedUtxo } from './midnightTypes';
import { LEDGER8_PROTOCOL_VERSION, LEDGER9_PROTOCOL_VERSION_SAMPLE, useMidnightChains } from '@test/helpers/midnightChains';

vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

// Public synthetic keys and nonexistent UTxOs. Never fund.
const NIGHT = '00'.repeat(32);
const TOKEN = 'ab'.repeat(32);
const secret = new Uint8Array(32).fill(1);
const makerSecret = new Uint8Array(32).fill(7);
const bech32 = (network: string, address: string) => MidnightBech32m.encode(network, new UnshieldedAddress(Buffer.from(address, 'hex'))).asString();
const own = ledger9Keystore(secret, 'preprod');
const maker = ledger9Keystore(makerSecret, 'preprod');
const ownAddress = bech32('preprod', own.getAddress());
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

const noProver: ledger.ProvingProvider = {
  check: async () => { throw new Error('unexpected proof-server call'); },
  prove: async () => { throw new Error('unexpected proof-server call'); },
  lookupKey: async () => undefined,
};

const utxo = (type: string, value: bigint, index: number, owner = ownAddress): MidnightUnshieldedUtxo => ({
  owner, tokenType: type, value, intentHash: '11'.repeat(32), outputIndex: index, ctime: 1_700_000_000,
  initialNonce: '', registeredForDustGeneration: false,
});

/** Another party's sealed swap offer: 18 NIGHT in, 8 back, so 10 NIGHT offered for 5,000 TOKEN. `fallible` puts it in the fallible section. */
async function offer(network = 'preprod', fallible = false, ttl = new Date(Date.now() + 600_000)): Promise<string> {
  const keystore = ledger9Keystore(makerSecret, network);
  const intent = ledger.Intent.new(ttl);
  const unshielded = ledger.UnshieldedOffer.new(
    [{ value: 18n, owner: keystore.getPublicKey(), type: NIGHT, intentHash: '33'.repeat(32), outputNo: 0 }],
    [{ value: 8n, owner: keystore.getAddress(), type: NIGHT }, { value: 5_000n, owner: keystore.getAddress(), type: TOKEN }], []);
  if (fallible) intent.fallibleUnshieldedOffer = unshielded;
  else intent.guaranteedUnshieldedOffer = unshielded;
  const proven = await ledger.Transaction.fromParts(network).addIntent({ tag: 'specific', value: 7 }, intent)
    .prove(noProver, ledger.CostModel.initialCostModel());
  return hex(signLedger9Intents(proven, keystore).bind().serialize());
}

type Spend = { value: bigint; type: string; intentHash: string; outputNo: number };
type Pay = { value: bigint; type: string; to: string };

/**
 * A sealed transaction of one guaranteed offer per `{ segment, ttl }` (and a
 * fallible one with `fallible`), each signed by `signer` (whose coins `inputs` are).
 */
async function sealed(intents: Array<{ segment: number; ttl: Date; inputs: Spend[]; outputs: Pay[]; fallible?: { inputs: Spend[]; outputs: Pay[] } }>,
  signer = maker): Promise<string> {
  let tx = ledger.Transaction.fromParts('preprod');
  const offerOf = (inputs: Spend[], outputs: Pay[]) => ledger.UnshieldedOffer.new(
    inputs.map(input => ({ ...input, owner: signer.getPublicKey() })),
    outputs.map(({ value, type, to }) => ({ value, type, owner: to })), []);
  for (const { segment, ttl, inputs, outputs, fallible } of intents) {
    const intent = ledger.Intent.new(ttl);
    intent.guaranteedUnshieldedOffer = offerOf(inputs, outputs);
    if (fallible) intent.fallibleUnshieldedOffer = offerOf(fallible.inputs, fallible.outputs);
    tx = tx.addIntent({ tag: 'specific', value: segment }, intent);
  }
  const proven = await tx.prove(noProver, ledger.CostModel.initialCostModel());
  return hex(signLedger9Intents(proven, signer).bind().serialize());
}

describe('balanceSealedTransaction on a ledger 9 chain', () => {
  const balanceFees = vi.fn();
  const deps = { balanceFees, provingProvider: async () => noProver };
  beforeEach(() => {
    balanceFees.mockReset();
    useMidnightChains({ preprod: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION], mainnet: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION] });
    // The fee step returns the carrier it was given (the DUST spread itself is midnightDustSpread9.spec.ts).
    balanceFees.mockImplementation(async (args: { spread: { carrier?: ledger.UnprovenTransaction } }) => args.spread.carrier);
  });

  const args = async (overrides: Record<string, unknown> = {}) => ({
    sdkNetworkId: 'preprod', endpoints: getMidnightEndpoints('Preprod')!, txHex: await offer(),
    unshieldedSecretKey: secret, dustSecretSeed: new Uint8Array(32).fill(2),
    utxos: [utxo(TOKEN, 10_000n, 0), utxo(NIGHT, 3n, 1)],
    sync: { lastSync: Date.now(), addresses: { unshielded: ownAddress } },
    proving: { url: 'http://localhost:6301' }, ...overrides,
  });
  const read = (txHex: string) => ledger.Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(txHex, 'hex'));

  it('reads what the wallet gives and receives from the guaranteed section', async () => {
    expect(summarizeSealed9(decodeSealedTransaction9(await offer(), 'preprod'))).toEqual({
      gives: [{ token: TOKEN, amount: '5000' }], receives: [{ token: NIGHT, amount: '10' }], problem: undefined,
    });
  });

  it('adds one signed intent that supplies the deficit and takes the surplus, and leaves the offer untouched', async () => {
    const offered = await offer();
    const result = await balanceSealedTransaction9(await args({ txHex: offered }), deps);
    expect(result.gives).toEqual([{ token: TOKEN, amount: '5000' }]);
    expect(result.receives).toEqual([{ token: NIGHT, amount: '10' }]);
    const merged = read(result.txHex);
    for (const [token, value] of merged.imbalances(0)) if (token.tag === 'unshielded') expect(value).toBe(0n);
    expect([...merged.intents!.keys()].sort((a, b) => a - b)).toEqual([1, 7]);
    const mine = merged.intents!.get(1)!.guaranteedUnshieldedOffer!;
    expect(mine.inputs.map(input => [input.type, input.value])).toEqual([[TOKEN, 10_000n]]);
    expect(mine.outputs.map(output => `${output.type}:${output.value}:${output.owner}`).sort()).toEqual([
      `${NIGHT}:10:${own.getAddress()}`, `${TOKEN}:5000:${own.getAddress()}`,
    ].sort());
    expect(mine.signatures).toHaveLength(1);
    // The other party's intent is byte-for-byte what was handed in.
    expect(hex(merged.intents!.get(7)!.serialize())).toBe(hex(read(offered).intents!.get(7)!.serialize()));
    // The fee is asked for inside the wallet's own intent, priced over the sealed part.
    expect(balanceFees).toHaveBeenCalledOnce();
    const [feeArgs, fixed] = balanceFees.mock.calls[0];
    expect(feeArgs.spread.carrier.intents.get(1).guaranteedUnshieldedOffer.inputs).toHaveLength(1);
    expect(fixed).toHaveLength(1);
    expect(result.dustSpends).toBe(0);
  });

  it('spends the largest coin first, so the swap carries as few signed inputs as it can', async () => {
    const result = await balanceSealedTransaction9(await args({
      utxos: [utxo(TOKEN, 100n, 0), utxo(TOKEN, 200n, 1), utxo(TOKEN, 10_000n, 2)],
    }), deps);
    const mine = read(result.txHex).intents!.get(1)!.guaranteedUnshieldedOffer!;
    expect(mine.inputs.map(input => input.value)).toEqual([10_000n]);
    expect(chooseLargestCoin9([{ value: 1n, type: TOKEN }, { value: 9n, type: TOKEN }, { value: 99n, type: NIGHT }] as ledger.Utxo[], TOKEN)?.value).toBe(9n);
  });

  it('completes an offer made by the wallet\'s own makeIntent builder', async () => {
    const makerAddress = bech32('preprod', maker.getAddress());
    const made = await buildConnectorIntent9({
      sdkNetworkId: 'preprod', endpoints: getMidnightEndpoints('Preprod')!,
      request: {
        inputs: [{ type: NIGHT, value: '10' }],
        outputs: [{ kind: 'unshielded', type: TOKEN, value: '5000', recipient: makerAddress }],
        intentId: 'random', payFees: false,
      },
      // Its own coin: a UTxO is one intent hash and output number, never the wallet's TOKEN coin's.
      unshieldedSecretKey: makerSecret, dustSecretSeed: new Uint8Array(32).fill(2), utxos: [{ ...utxo(NIGHT, 18n, 0, makerAddress), intentHash: '44'.repeat(32) }],
      sync: { lastSync: Date.now(), addresses: { unshielded: makerAddress } }, proving: { url: 'http://localhost:6301' },
    }, { balanceFees: vi.fn(), provingProvider: vi.fn() } as unknown as BuildConnectorIntent9Deps);
    const result = await balanceSealedTransaction9(await args({ txHex: made.txHex }), deps);
    expect(result.gives).toEqual([{ token: TOKEN, amount: '5000' }]);
    expect(result.receives).toEqual([{ token: NIGHT, amount: '10' }]);
    const merged = read(result.txHex);
    for (const [token, value] of merged.imbalances(0)) if (token.tag === 'unshielded') expect(value).toBe(0n);
    expect(merged.intents!.size).toBe(2);
  });

  it('refuses what a sealed transaction cannot have balanced, before any fee is prepared', async () => {
    await expect(balanceSealedTransaction9(await args({ txHex: await offer('preprod', true) }), deps)).rejects.toThrow(SEALED_BALANCE_REFUSALS.fallible);
    await expect(balanceSealedTransaction9(await args({ txHex: await offer('mainnet') }), deps)).rejects.toThrow("invalid network ID - expect 'preprod' found 'mainnet'");
    await expect(balanceSealedTransaction9(await args({ sync: { lastSync: null, addresses: { unshielded: ownAddress } } }), deps)).rejects.toThrow(MIDNIGHT_WALLET_NOT_SYNCED);
    await expect(balanceSealedTransaction9(await args({ utxos: [utxo(TOKEN, 4_999n, 0)] }), deps)).rejects.toThrow(/insufficient/i);
    expect(balanceFees).not.toHaveBeenCalled();
    useMidnightChains({ preprod: [LEDGER8_PROTOCOL_VERSION, LEDGER8_PROTOCOL_VERSION] });
    await expect(balanceSealedTransaction9(await args(), deps)).rejects.toThrow('Midnight Preprod runs ledger 8');
  });

  it('the approval prompt lists gives, receives and whom the sealed part pays', async () => {
    const prompt = await sealedBalancePrompt(await offer(), 'preprod', ownAddress);
    expect(prompt).toEqual({
      ok: true, gives: [{ token: TOKEN, amount: '5000' }], receives: [{ token: NIGHT, amount: '10' }],
      payments: expect.arrayContaining([
        { token: NIGHT, amount: '8', recipient: bech32('preprod', maker.getAddress()) },
        { token: TOKEN, amount: '5000', recipient: bech32('preprod', maker.getAddress()) },
      ]),
    });
    expect(await sealedBalancePrompt(await offer('preprod', true), 'preprod', ownAddress)).toEqual({ ok: false, reason: SEALED_BALANCE_REFUSALS.fallible });
    expect(await sealedBalancePrompt('00ff', 'preprod', ownAddress)).toMatchObject({ ok: false, reason: expect.stringContaining('not a valid sealed ledger 9 transaction') });
    useMidnightChains({ preprod: [LEDGER8_PROTOCOL_VERSION, LEDGER8_PROTOCOL_VERSION] });
    expect(await sealedBalancePrompt(await offer(), 'preprod', ownAddress)).toMatchObject({ ok: false, reason: expect.stringContaining('needs a ledger 9 network') });
  });

  it('hands the spread a signer for the wallet\'s inputs, so the limit is checked on the signed shape', async () => {
    await balanceSealedTransaction9(await args(), deps);
    const [feeArgs] = balanceFees.mock.calls[0];
    const carrier = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', feeArgs.spread.carrier.serialize());
    expect(carrier.intents!.get(1)!.guaranteedUnshieldedOffer!.signatures).toHaveLength(0);
    expect(feeArgs.spread.sign(carrier).intents.get(1).guaranteedUnshieldedOffer.signatures).toHaveLength(1);
  });

  it('refuses an offer that expires too far ahead or too soon, before the prompt and before any fee', async () => {
    const far = await offer('preprod', false, new Date(Date.now() + CONNECTOR_INTENT_TTL_MS + 3 * 60_000));
    const soon = await offer('preprod', false, new Date(Date.now() + 60_000));
    for (const txHex of [far, soon]) {
      expect(await sealedBalancePrompt(txHex, 'preprod', ownAddress)).toEqual({ ok: false, reason: SEALED_BALANCE_REFUSALS.expiry });
      await expect(balanceSealedTransaction9(await args({ txHex }), deps)).rejects.toThrow(SEALED_BALANCE_REFUSALS.expiry);
    }
    expect(balanceFees).not.toHaveBeenCalled();
    // The full makeIntent TTL, and a little over the two minutes, are taken.
    for (const ahead of [CONNECTOR_INTENT_TTL_MS, 3 * 60_000]) {
      expect(await sealedBalancePrompt(await offer('preprod', false, new Date(Date.now() + ahead)), 'preprod', ownAddress)).toMatchObject({ ok: true });
    }
  });

  // Both orders: the SDK takes the TTL of whichever intent the ledger lists first.
  it.each([[3, 7], [7, 3]])('gives the wallet\'s intent the EARLIEST expiry of the sealed part (segment %i expires later)', async (later, earlier) => {
    const txHex = await sealed([
      { segment: later, ttl: new Date(Date.now() + 20 * 60_000), inputs: [{ value: 18n, type: NIGHT, intentHash: '33'.repeat(32), outputNo: 0 }],
        outputs: [{ value: 8n, type: NIGHT, to: maker.getAddress() }, { value: 5_000n, type: TOKEN, to: maker.getAddress() }] },
      { segment: earlier, ttl: new Date(Date.now() + 10 * 60_000), inputs: [{ value: 4n, type: NIGHT, intentHash: '33'.repeat(32), outputNo: 1 }],
        outputs: [{ value: 4n, type: NIGHT, to: maker.getAddress() }] },
    ]);
    const merged = read((await balanceSealedTransaction9(await args({ txHex }), deps)).txHex);
    const [, mine] = [...merged.intents!].find(([segment]) => segment !== 3 && segment !== 7)!;
    const earliest = merged.intents!.get(earlier)!.ttl.getTime();
    expect(merged.intents!.get(later)!.ttl.getTime()).toBeGreaterThan(earliest);
    expect(mine.ttl.getTime()).toBe(earliest);
    expect(balanceFees.mock.calls[0][0].ttl.getTime()).toBe(earliest);
  });

  it('counts what the sealed part pays straight to the wallet as received, not as a payment', async () => {
    const txHex = await sealed([{ segment: 7, ttl: new Date(Date.now() + 600_000),
      inputs: [{ value: 18n, type: NIGHT, intentHash: '33'.repeat(32), outputNo: 0 }],
      outputs: [{ value: 5n, type: NIGHT, to: maker.getAddress() }, { value: 3n, type: NIGHT, to: own.getAddress() }, { value: 5_000n, type: TOKEN, to: maker.getAddress() }] }]);
    expect(await sealedBalancePrompt(txHex, 'preprod', ownAddress)).toEqual({
      ok: true, gives: [{ token: TOKEN, amount: '5000' }],
      // 10 NIGHT of surplus the wallet takes, and 3 the sealed part pays it.
      receives: [{ token: NIGHT, amount: '13' }],
      payments: [
        { token: NIGHT, amount: '5', recipient: bech32('preprod', maker.getAddress()) },
        { token: TOKEN, amount: '5000', recipient: bech32('preprod', maker.getAddress()) },
      ],
    });
  });

  it('never counts what a FALLIBLE section pays the wallet: it can fail after the wallet\'s give went through', async () => {
    const txHex = await sealed([{ segment: 7, ttl: new Date(Date.now() + 600_000),
      inputs: [{ value: 18n, type: NIGHT, intentHash: '33'.repeat(32), outputNo: 0 }],
      outputs: [{ value: 8n, type: NIGHT, to: maker.getAddress() }, { value: 5_000n, type: TOKEN, to: maker.getAddress() }],
      // Balanced on its own, so no refusal; its input may be missing on chain, and then only this section fails.
      fallible: { inputs: [{ value: 3n, type: NIGHT, intentHash: '33'.repeat(32), outputNo: 1 }], outputs: [{ value: 3n, type: NIGHT, to: own.getAddress() }] } }]);
    expect(await sealedBalancePrompt(txHex, 'preprod', ownAddress)).toMatchObject({
      ok: true, gives: [{ token: TOKEN, amount: '5000' }], receives: [{ token: NIGHT, amount: '10' }],
    });
  });

  it('the wallet\'s own earlier offer: its change back is not "received", only the surplus is', async () => {
    // 18 NIGHT of the wallet's in, 8 back as change, 5,000 TOKEN asked: 10 NIGHT offered.
    const txHex = await sealed([{ segment: 7, ttl: new Date(Date.now() + 600_000),
      inputs: [{ value: 18n, type: NIGHT, intentHash: '11'.repeat(32), outputNo: 5 }],
      outputs: [{ value: 8n, type: NIGHT, to: own.getAddress() }, { value: 5_000n, type: TOKEN, to: own.getAddress() }] }], own);
    expect(await sealedBalancePrompt(txHex, 'preprod', ownAddress)).toMatchObject({
      ok: true, gives: [{ token: TOKEN, amount: '5000' }], receives: [{ token: NIGHT, amount: '10' }],
    });
  });

  it('never selects a coin the sealed part already spends (the wallet\'s own earlier offer)', async () => {
    // The wallet's own offer: its 10,000 TOKEN coin #0 in, 15,000 TOKEN out, so 5,000 still to add.
    const txHex = await sealed([{ segment: 7, ttl: new Date(Date.now() + 600_000),
      inputs: [{ value: 10_000n, type: TOKEN, intentHash: '11'.repeat(32), outputNo: 0 }],
      outputs: [{ value: 15_000n, type: TOKEN, to: maker.getAddress() }] }], own);
    const result = await balanceSealedTransaction9(await args({ txHex, utxos: [utxo(TOKEN, 10_000n, 0), utxo(TOKEN, 6_000n, 1)] }), deps);
    const mine = read(result.txHex).intents!.get(1)!.guaranteedUnshieldedOffer!;
    expect(mine.inputs.map(input => [input.outputNo, input.value])).toEqual([[1, 6_000n]]);
  });

  it('a ledger it cannot read is the wallet\'s failure, marked so the dapp is not told its request was wrong', async () => {
    const txHex = await offer();
    useMidnightChains({});
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    try {
      expect(await sealedBalancePrompt(txHex, 'preprod', ownAddress)).toMatchObject({ ok: false, internal: true });
    } finally { vi.unstubAllGlobals(); }
  });
});
