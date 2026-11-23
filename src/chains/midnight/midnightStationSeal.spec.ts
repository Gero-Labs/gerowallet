// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import {
  MIDNIGHT_STATION_TX_SHAPE, MIDNIGHT_STATION_TX_UNBALANCED, sealTransferForStation,
} from './midnightStationSeal';
import { MIDNIGHT_LEDGER_CHANGED } from './midnightLedger';
import { LEDGER8_PROTOCOL_VERSION, LEDGER9_PROTOCOL_VERSION_SAMPLE, useMidnightChains } from '@test/helpers/midnightChains';

vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

// Public synthetic keys and nonexistent UTxOs. Never fund.
const secret = new Uint8Array(32).fill(1);
const key = ledger.signatureVerifyingKey({ tag: 'schnorr', value: Buffer.from(secret).toString('hex') });
const own = ledger.addressFromKey(key);
const strangerKey = ledger.signatureVerifyingKey({ tag: 'schnorr', value: '02'.repeat(32) });
const stranger = ledger.addressFromKey(strangerKey);
const NIGHT = '00'.repeat(32);
const NETWORK = 'preprod';

type Sealed = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.Binding>;
const sealedOf = (hex: string): Sealed => ledger.Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(hex, 'hex'));
const hexOf = (tx: { serialize(): Uint8Array }) => Buffer.from(tx.serialize()).toString('hex');
const ttl = () => new Date(Date.now() + 300_000);

/** A send as Nexus builds it: one intent, 50 in, `paid` to a stranger, `change` back. */
function transfer(options: { paid?: bigint; change?: bigint; section?: 'fallible' | 'guaranteed' } = {}) {
  const { paid = 30n, change = 20n, section = 'fallible' } = options;
  const offer = ledger.UnshieldedOffer.new(
    [{ value: 50n, owner: key, type: NIGHT, intentHash: '11'.repeat(32), outputNo: 0 }],
    [{ value: paid, owner: stranger, type: NIGHT }, { value: change, owner: own, type: NIGHT }], []);
  const intent = ledger.Intent.new(ttl());
  if (section === 'fallible') intent.fallibleUnshieldedOffer = offer; else intent.guaranteedUnshieldedOffer = offer;
  return ledger.Transaction.fromParts(NETWORK, undefined, undefined, intent);
}
const args = (tx: { serialize(): Uint8Array }) => ({ sdkNetworkId: NETWORK, unprovenTxHex: hexOf(tx), unshieldedSecretKey: secret });

describe('sealing a fee-less send for the fee station', () => {
  beforeEach(() => {
    useMidnightChains({ preprod: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION] });
  });

  it('seals a balanced send: signed by the wallet, proven and bound, with no DUST in it', async () => {
    const result = await sealTransferForStation(args(transfer()));
    const tx = sealedOf(result.sealedTxHex);
    const [segment, intent] = [...tx.intents!.entries()][0];
    expect(intent.dustActions).toBeUndefined();
    const offer = intent.fallibleUnshieldedOffer!;
    expect(offer.signatures).toHaveLength(1);
    expect(ledger.verifySignature(key, intent.signatureData(segment), offer.signatures[0].value)).toBe(true);
    expect(result.identifiers.length).toBeGreaterThan(0);
    expect(result.identifiers.every(id => /^[0-9a-f]+$/.test(id))).toBe(true);
  });

  it('its identifiers survive a merge with another sealed transaction (how a lost reply is found)', async () => {
    const result = await sealTransferForStation(args(transfer()));
    // Stands in for the station's fee transaction: another party's sealed intent on another segment.
    const otherIntent = ledger.Intent.new(ttl());
    otherIntent.fallibleUnshieldedOffer = ledger.UnshieldedOffer.new(
      [{ value: 5n, owner: strangerKey, type: NIGHT, intentHash: '22'.repeat(32), outputNo: 0 }],
      [{ value: 5n, owner: stranger, type: NIGHT }], []);
    const other = ledger.Transaction.fromParts(NETWORK).addIntent({ tag: 'specific', value: 9 } as never, otherIntent);
    const noProver: ledger.ProvingProvider = { check: async () => { throw new Error('no'); }, prove: async () => { throw new Error('no'); }, lookupKey: async () => undefined };
    const otherSealed = (await other.prove(noProver, ledger.CostModel.initialCostModel())).bind();
    const merged = sealedOf(result.sealedTxHex).merge(sealedOf(hexOf(otherSealed)));
    const mergedIds = merged.identifiers().map(id => String(id).toLowerCase().replace(/^0x/, ''));
    for (const id of result.identifiers) expect(mergedIds).toContain(id);
  });

  it('refuses a send that leaves a surplus: the merging party could take it', async () => {
    await expect(sealTransferForStation(args(transfer({ paid: 30n, change: 10n })))).rejects.toThrow(MIDNIGHT_STATION_TX_UNBALANCED);
    await expect(sealTransferForStation(args(transfer({ paid: 30n, change: 10n, section: 'guaranteed' })))).rejects.toThrow(MIDNIGHT_STATION_TX_UNBALANCED);
  });

  it('refuses a transaction that already carries DUST actions, or more than one intent', async () => {
    const withDust = transfer();
    const intent = withDust.intents!.get(1)!;
    intent.dustActions = new ledger.DustActions('signature', 'pre-proof', new Date(), [], []);
    withDust.intents = withDust.intents!.set(1, intent);
    await expect(sealTransferForStation(args(withDust))).rejects.toThrow(MIDNIGHT_STATION_TX_SHAPE);

    const second = ledger.Intent.new(ttl());
    second.fallibleUnshieldedOffer = ledger.UnshieldedOffer.new(
      [{ value: 5n, owner: key, type: NIGHT, intentHash: '33'.repeat(32), outputNo: 0 }], [{ value: 5n, owner: own, type: NIGHT }], []);
    const two = transfer().merge(ledger.Transaction.fromParts(NETWORK).addIntent({ tag: 'specific', value: 9 } as never, second));
    await expect(sealTransferForStation(args(two))).rejects.toThrow(MIDNIGHT_STATION_TX_SHAPE);
  });

  it('refuses an input of another key: nothing is signed', async () => {
    const offer = ledger.UnshieldedOffer.new(
      [{ value: 50n, owner: strangerKey, type: NIGHT, intentHash: '11'.repeat(32), outputNo: 0 }], [{ value: 50n, owner: own, type: NIGHT }], []);
    const intent = ledger.Intent.new(ttl());
    intent.fallibleUnshieldedOffer = offer;
    await expect(sealTransferForStation(args(ledger.Transaction.fromParts(NETWORK, undefined, undefined, intent))))
      .rejects.toThrow('unsigned input belonging to another key');
  });

  it('refuses on a chain that runs ledger 8', async () => {
    useMidnightChains({ preprod: [LEDGER8_PROTOCOL_VERSION, LEDGER8_PROTOCOL_VERSION] });
    await expect(sealTransferForStation(args(transfer()))).rejects.toThrow(MIDNIGHT_LEDGER_CHANGED);
  });
});
