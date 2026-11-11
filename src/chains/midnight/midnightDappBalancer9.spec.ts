// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { MidnightBech32m, UnshieldedAddress } from 'midnight-v9-address-format';
import { balanceDappTransaction9, CONNECTOR_MINIMUM_DUST_SPENDS, decodeUnboundTransaction9 } from './midnightDappBalancer9';
import { classifyConnectorSubmission, connectorBalancePrompt, validateConnectorBalanceRequest } from './midnightConnectorBalance';
import { getMidnightEndpoints } from './midnightConfig';
import type { MidnightUnshieldedUtxo } from './midnightTypes';
import { LEDGER8_PROTOCOL_VERSION, LEDGER9_PROTOCOL_VERSION_SAMPLE, useMidnightChains } from '@test/helpers/midnightChains';

// Public synthetic keys and nonexistent UTxOs. Never fund.
const secret = new Uint8Array(32).fill(1);
const key = ledger.signatureVerifyingKey({ tag: 'schnorr', value: Buffer.from(secret).toString('hex') });
const own = ledger.addressFromKey(key);
const shop = ledger.addressFromKey(ledger.signatureVerifyingKey({ tag: 'schnorr', value: '02'.repeat(32) }));
const NIGHT = '00'.repeat(32);

const noProver: ledger.ProvingProvider = {
  check: async () => { throw new Error('unexpected proof-server call'); },
  prove: async () => { throw new Error('unexpected proof-server call'); },
  lookupKey: async () => undefined,
};

/** A dapp's proven, unbound transaction that pays the shop and asks the wallet to fund it. */
async function dappTx(network: string, value = 10n, inputs: ledger.UtxoSpend[] = []): Promise<string> {
  const intent = ledger.Intent.new(new Date(Date.now() + 300_000));
  intent.fallibleUnshieldedOffer = ledger.UnshieldedOffer.new(inputs, [{ value, owner: shop, type: NIGHT }], []);
  const proven = await ledger.Transaction.fromParts(network, undefined, undefined, intent).prove(noProver, ledger.CostModel.initialCostModel());
  return Buffer.from(proven.serialize()).toString('hex');
}

const utxo = (value: bigint, index = 0): MidnightUnshieldedUtxo => ({
  owner: MidnightBech32m.encode('preprod', new UnshieldedAddress(Buffer.from(own, 'hex'))).asString(),
  tokenType: NIGHT, value, intentHash: '11'.repeat(32), outputIndex: index, ctime: 1_700_000_000,
  initialNonce: '', registeredForDustGeneration: false,
});

describe('balanceUnsealedTransaction on a ledger 9 chain', () => {
  const balanceFees = vi.fn();
  const deps = { balanceFees, provingProvider: async () => noProver };
  beforeEach(() => {
    balanceFees.mockReset();
    useMidnightChains({ preprod: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION], mainnet: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION] });
    balanceFees.mockImplementation(async (args: { sdkNetworkId: string }) => ledger.Transaction.fromParts(args.sdkNetworkId));
  });

  const args = async (overrides: Record<string, unknown> = {}) => ({
    sdkNetworkId: 'preprod', endpoints: getMidnightEndpoints('Preprod')!, txHex: await dappTx('preprod'),
    unshieldedSecretKey: secret, dustSecretSeed: new Uint8Array(32).fill(2), utxos: [utxo(100n)],
    proving: { url: 'http://localhost:6301' }, ...overrides,
  });

  it('adds the wallet\'s NIGHT and change, signs only its own input, binds, and asks for two DUST spends', async () => {
    const result = await balanceDappTransaction9(await args(), deps);
    expect(result.contributions).toEqual([{ token: NIGHT, amount: '10' }]);
    const sealed = ledger.Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(result.txHex, 'hex'));
    for (const segment of [0, ...sealed.intents!.keys()]) {
      for (const [token, value] of sealed.imbalances(segment)) if (token.tag === 'unshielded') expect(value).toBe(0n);
    }
    const intent = sealed.intents!.get(1)!;
    const offer = intent.fallibleUnshieldedOffer ?? intent.guaranteedUnshieldedOffer!;
    expect(offer.inputs.map(input => input.value)).toEqual([100n]);
    expect(offer.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ owner: shop, value: 10n }), expect.objectContaining({ owner: own, value: 90n }),
    ]));
    expect(offer.signatures).toHaveLength(1);
    expect(balanceFees).toHaveBeenCalledWith(expect.objectContaining({ sdkNetworkId: 'preprod', minimumDustSpends: CONNECTOR_MINIMUM_DUST_SPENDS }), expect.any(Array));
    expect(CONNECTOR_MINIMUM_DUST_SPENDS).toBe(2);
  });

  it('refuses a transaction that already spends the wallet\'s coins, before any fee is prepared', async () => {
    const spend = { value: 5n, owner: key, type: NIGHT, intentHash: '22'.repeat(32), outputNo: 0 };
    await expect(balanceDappTransaction9(await args({ txHex: await dappTx('preprod', 10n, [spend]) }), deps)).rejects.toThrow('already spends from your wallet');
    expect(balanceFees).not.toHaveBeenCalled();
  });

  it('refuses another network\'s transaction and a chain on ledger 8', async () => {
    await expect(balanceDappTransaction9(await args({ txHex: await dappTx('mainnet') }), deps)).rejects.toThrow();
    useMidnightChains({ preprod: [LEDGER8_PROTOCOL_VERSION, LEDGER8_PROTOCOL_VERSION] });
    await expect(balanceDappTransaction9(await args(), deps)).rejects.toThrow('Midnight Preprod runs ledger 8');
  });

  it('fails cleanly when the wallet cannot cover the transaction', async () => {
    await expect(balanceDappTransaction9(await args({ utxos: [utxo(3n)] }), deps)).rejects.toThrow();
    expect(balanceFees).not.toHaveBeenCalled();
  });

  it('the approval prompt and the request check accept ledger 9', async () => {
    const hex = await dappTx('preprod');
    expect(validateConnectorBalanceRequest({ tx: hex }, 'Preprod')).toMatchObject({ ok: true });
    const prompt = await connectorBalancePrompt(hex, 'preprod', utxo(1n).owner);
    expect(prompt).toMatchObject({ ok: true, contributions: [{ token: NIGHT, amount: '10' }] });
    expect(decodeUnboundTransaction9(hex, 'preprod').intents?.size).toBe(1);
  });
});

describe('submitTransaction judged by the chain\'s ledger', () => {
  it('a sealed ledger 9 transaction goes to submit-proven on a ledger 9 chain', async () => {
    useMidnightChains({ preprod: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION] });
    const bound = ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', Buffer.from(await dappTx('preprod'), 'hex')).bind();
    await expect(classifyConnectorSubmission(Buffer.from(bound.serialize()).toString('hex'), 'preprod')).resolves.toEqual({ kind: 'sealed', ledger: 9 });
    await expect(classifyConnectorSubmission(await dappTx('preprod'), 'preprod')).resolves.toEqual({ kind: 'unsealed', ledger: 9 });
  });

  it('a ledger 9 transaction on a chain still on ledger 8 is named, not sent to be proven', async () => {
    useMidnightChains({ preprod: [LEDGER8_PROTOCOL_VERSION, LEDGER8_PROTOCOL_VERSION] });
    const bound = ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', Buffer.from(await dappTx('preprod'), 'hex')).bind();
    await expect(classifyConnectorSubmission(Buffer.from(bound.serialize()).toString('hex'), 'preprod'))
      .resolves.toEqual({ kind: 'otherLedger', ledger: 8, txLedger: 9 });
  });
});
