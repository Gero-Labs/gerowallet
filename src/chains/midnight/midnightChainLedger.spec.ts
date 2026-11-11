// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import {
  LEDGER9_PROTOCOL_VERSION, MIDNIGHT_LEDGER_UNKNOWN, MidnightLedgerUnknownError, forgetMidnightLedgersForTests,
  knownMidnightLedger, ledgerForProtocolVersion, midnightLedgerOrNewest, midnightLedgerVersion, noteMidnightProtocolVersion,
} from './midnightLedger';
import { MIDNIGHT_LEDGER_QUERY, readMidnightChainLedger, resolveMidnightChain, resolveMidnightLedger } from './midnightChainLedger';
import { deserializeLedger9Transaction, signLedger9Transaction } from './midnightLedger9';
import { isLedger9Network, midnightProofServerTag, midnightProofServerTagForLedger } from './midnightConfig';

const networks = ['mainnet', 'Mainnet', 'midnight-mainnet', 'preprod', 'Preprod', 'preview', 'stagenet', 'Stagenet', 'testnet', 'undeployed'];
const endpoints = { publicIndexerUrl: 'https://indexer.invalid/graphql', sdkNetworkId: 'preprod' as const };

function indexerAnswer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => forgetMidnightLedgersForTests());
afterEach(() => vi.unstubAllGlobals());

describe('ledger selection by protocol version, never by network name', () => {
  it.each(networks)('%s: 1999999 selects ledger 8 and 2000000 selects ledger 9', (network) => {
    noteMidnightProtocolVersion(network, 1_999_999);
    expect(midnightLedgerVersion(network)).toBe(8);
    noteMidnightProtocolVersion(network, 2_000_000);
    expect(midnightLedgerVersion(network)).toBe(9);
  });

  it.each(networks)('%s: an unread chain fails closed with a readable refusal', (network) => {
    expect(() => midnightLedgerVersion(network)).toThrow(MidnightLedgerUnknownError);
    expect(() => midnightLedgerVersion(network)).toThrow(MIDNIGHT_LEDGER_UNKNOWN);
    expect(knownMidnightLedger(network)).toBeUndefined();
  });

  it('treats the fork version as wallet SDK 2 does, and refuses nonsense', () => {
    expect(LEDGER9_PROTOCOL_VERSION).toBe(2_000_000);
    expect(ledgerForProtocolVersion(0)).toBe(8);
    expect(ledgerForProtocolVersion(2_001_100)).toBe(9);
    for (const bad of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => ledgerForProtocolVersion(bad)).toThrow('Invalid');
  });

  it('follows a network that changes ledger without changing its name (preprod, in place)', () => {
    noteMidnightProtocolVersion('Preprod', 1_999_999, 1_000_000);
    expect(midnightLedgerVersion('preprod')).toBe(8);
    noteMidnightProtocolVersion('midnight-preprod', 2_001_100);
    expect(midnightLedgerVersion('Preprod')).toBe(9);
  });

  it('shows the newest ledger only where nothing is built: the pages, before a read', () => {
    expect(midnightLedgerOrNewest('Mainnet')).toBe(9);
    expect(isLedger9Network('Mainnet')).toBe(true);
    noteMidnightProtocolVersion('Mainnet', 1_999_999);
    expect(isLedger9Network('Mainnet')).toBe(false);
    expect(midnightProofServerTag('Mainnet')).toBe(midnightProofServerTagForLedger(8));
    expect(midnightProofServerTag('Stagenet')).toBe(midnightProofServerTagForLedger(9));
  });
});

describe('reading the chain', () => {
  it('asks the indexer for the tip and the first block in one query and records both', async () => {
    const fetchMock = vi.fn().mockResolvedValue(indexerAnswer({ data: { tip: { protocolVersion: 2_001_100 }, genesis: { protocolVersion: 1_000_000 } } }));
    vi.stubGlobal('fetch', fetchMock);
    const chain = await readMidnightChainLedger(endpoints);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ query: MIDNIGHT_LEDGER_QUERY });
    expect(chain).toMatchObject({ protocolVersion: 2_001_100, ledger: 9, bornOnLedger9: false });
    expect(midnightLedgerVersion('Preprod')).toBe(9);
  });

  it('knows a chain born on ledger 9', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(indexerAnswer({ data: { tip: { protocolVersion: 2_001_100 }, genesis: { protocolVersion: 2_001_100 } } })));
    await expect(readMidnightChainLedger(endpoints)).resolves.toMatchObject({ bornOnLedger9: true });
  });

  it.each([
    ['an HTTP error', indexerAnswer({}, 503)],
    ['GraphQL errors', indexerAnswer({ errors: [{ message: 'nope' }], data: null })],
    ['no protocol version', indexerAnswer({ data: { tip: {} } })],
    ['a non-integer version', indexerAnswer({ data: { tip: { protocolVersion: '2000000' } } })],
    ['not JSON', new Response('<html>', { status: 200 })],
  ])('fails closed on %s', async (_name, response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(readMidnightChainLedger(endpoints)).rejects.toThrow(MidnightLedgerUnknownError);
    expect(knownMidnightLedger('preprod')).toBeUndefined();
  });

  it('fails closed for a network the wallet has no endpoints for', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(resolveMidnightLedger('Unknownnet')).rejects.toThrow(MidnightLedgerUnknownError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses a fresh read and shares one in flight', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => indexerAnswer({ data: { tip: { protocolVersion: 2_001_100 }, genesis: { protocolVersion: 1 } } }));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([resolveMidnightLedger('Preprod'), resolveMidnightLedger('midnight-preprod')]);
    expect([a, b]).toEqual([9, 9]);
    await resolveMidnightLedger('preprod');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await resolveMidnightChain('Preprod', { maxAgeMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('the ledger 9 path on every network', () => {
  const secret = new Uint8Array(32).fill(1);
  const key = ledger.signatureVerifyingKey({ tag: 'schnorr', value: Buffer.from(secret).toString('hex') });
  function transfer(network: string) {
    const intent = ledger.Intent.new(new Date('2030-01-01T00:00:00Z'));
    intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([
      { value: 10n, owner: key, type: '00'.repeat(32), intentHash: '11'.repeat(32), outputNo: 0 },
    ], [{ value: 10n, owner: ledger.addressFromKey(key), type: '00'.repeat(32) }], []);
    return Buffer.from(ledger.Transaction.fromParts(network, undefined, undefined, intent).serialize()).toString('hex');
  }

  it.each(['mainnet', 'preprod', 'preview', 'stagenet'])('%s on ledger 9 signs its own ledger 9 transaction', (network) => {
    noteMidnightProtocolVersion(network, 2_001_100);
    const signed = deserializeLedger9Transaction(network, signLedger9Transaction(network, transfer(network), secret));
    const intent = signed.intents!.get(1)!;
    expect(ledger.verifySignature(key, intent.signatureData(1), intent.guaranteedUnshieldedOffer!.signatures[0].value)).toBe(true);
  });

  it('refuses another network\'s transaction and names the wallet\'s own network and ledger', () => {
    noteMidnightProtocolVersion('preprod', 2_001_100);
    noteMidnightProtocolVersion('mainnet', 1_999_999);
    expect(() => signLedger9Transaction('preprod', transfer('mainnet'), secret)).toThrow();
    expect(() => deserializeLedger9Transaction('mainnet', transfer('mainnet'))).toThrow('Midnight Mainnet runs ledger 8');
    expect(() => deserializeLedger9Transaction('mainnet', transfer('mainnet'))).not.toThrow(/Stagenet/);
  });
});
