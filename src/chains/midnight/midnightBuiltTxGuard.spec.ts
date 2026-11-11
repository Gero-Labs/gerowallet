// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as legacy from '@midnight-ntwrk/ledger-v8';
import { DustAddress, UnshieldedAddress, MidnightBech32m } from '@midnightntwrk/wallet-sdk-address-format';
import fixture from './fixtures/nexus-ledger-signing.json';
import * as ledger9 from '@midnightntwrk/ledger-v9';
import {
  MIDNIGHT_BUILT_TX_LEDGER_UNSUPPORTED,
  MIDNIGHT_BUILT_TX_MISMATCH,
  MIDNIGHT_BUILT_TX_UNREADABLE,
  MidnightBuiltTxUnreadableError,
  assertMidnightDustRegistrationMatches,
  assertMidnightTransferMatches,
  decodeUnprovenMidnightTransaction,
  midnightAddressDecoder,
  rawTokenOf,
  verifyMidnightDustRegistration,
  verifyMidnightTransfer,
  type MidnightTxView,
} from './midnightBuiltTxGuard';
import { LEDGER8_PROTOCOL_VERSION, LEDGER9_PROTOCOL_VERSION_SAMPLE, useMidnightChains } from '@test/helpers/midnightChains';

/** Mainnet and preprod crossed the upgrade; Preview and Stagenet were born on ledger 9. */
const onLedger9 = () => useMidnightChains({
  mainnet: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION],
  preprod: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION],
  preview: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER9_PROTOCOL_VERSION_SAMPLE],
  stagenet: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER9_PROTOCOL_VERSION_SAMPLE],
});

// Nexus-built fixtures (synthetic key, nonexistent UTxOs): each transfer sends 10
// units to the sender's own address and returns the rest as change.
const OWN_KEY = fixture.publicKey;
const OWN_ADDRESS = legacy.addressFromKey(OWN_KEY);
const own = { ownKeyHex: OWN_KEY, ownAddressHex: OWN_ADDRESS };
const REGISTERED_DUST_KEY = 28963646160245915482633823116396969940187912662686407789611979145798472113864n;
const ATTACKER = 'ab'.repeat(32);
const NIGHT = '0'.repeat(64);

type Offer = { inputs: Array<{ owner: unknown; type: string; value: bigint }>; outputs: Array<{ owner: string; type: string; value: bigint }> };
const view = (offer: Offer, extra: Record<string, unknown> = {}): MidnightTxView =>
  ({ intents: new Map([[1, { fallibleUnshieldedOffer: offer, actions: [], dustActions: undefined, ...extra }]]) });
const input = (value: bigint, owner: unknown = OWN_KEY) => ({ owner, type: NIGHT, value });
const output = (owner: string, value: bigint, type = NIGHT) => ({ owner, type, value });
const send = (recipientHex: string, amount: bigint) => [{ recipientHex, tokenRaw: NIGHT, amount }];

describe('Nexus-built Midnight send check', () => {
  for (const vector of fixture.transfers) {
    it(`accepts the real ledger 9 ${vector.network} build of ${vector.count} input(s) (${vector.token.slice(0, 4)})`, async () => {
      onLedger9();
      const tx = await decodeUnprovenMidnightTransaction(vector.network, vector.unprovenTxHex);
      expect(verifyMidnightTransfer(tx, own, [{ recipientHex: OWN_ADDRESS, tokenRaw: vector.token, amount: 10n }])).toEqual([]);
      expect(verifyMidnightTransfer(tx, own, [{ recipientHex: ATTACKER, tokenRaw: vector.token, amount: 10n }])).toContain('missingOutput');
      expect(verifyMidnightTransfer(tx, own, [{ recipientHex: OWN_ADDRESS, tokenRaw: vector.token, amount: 11n }])).toContain('missingOutput');
    });
  }

  // A chain still below the ledger 9 fork takes the ledger 8 path.
  for (const vector of fixture.ledger8Transfers.transfers) {
    it(`accepts the real ledger 8 ${vector.network} build of ${vector.count} input(s) (${vector.token.slice(0, 4)})`, async () => {
      const tx = await decodeUnprovenMidnightTransaction(vector.network, vector.unprovenTxHex);
      expect(verifyMidnightTransfer(tx, own, [{ recipientHex: OWN_ADDRESS, tokenRaw: vector.token, amount: 10n }])).toEqual([]);
      // The same build does not pass for a send to someone else, or of another amount.
      expect(verifyMidnightTransfer(tx, own, [{ recipientHex: ATTACKER, tokenRaw: vector.token, amount: 10n }])).toContain('missingOutput');
      expect(verifyMidnightTransfer(tx, own, [{ recipientHex: OWN_ADDRESS, tokenRaw: vector.token, amount: 11n }])).toContain('missingOutput');
    });
  }

  const RECIPIENT = 'cd'.repeat(32);
  it('refuses an extra output to someone else', () => {
    const tx = view({ inputs: [input(100n)], outputs: [output(RECIPIENT, 10n), output(ATTACKER, 80n), output(OWN_ADDRESS, 10n)] });
    expect(verifyMidnightTransfer(tx, own, send(RECIPIENT, 10n))).toEqual(['foreignOutput']);
  });

  it('refuses a swapped recipient and an inflated amount', () => {
    const swapped = view({ inputs: [input(100n)], outputs: [output(ATTACKER, 10n), output(OWN_ADDRESS, 90n)] });
    expect(verifyMidnightTransfer(swapped, own, send(RECIPIENT, 10n))).toEqual(expect.arrayContaining(['missingOutput', 'foreignOutput']));
    const inflated = view({ inputs: [input(100n)], outputs: [output(RECIPIENT, 90n), output(OWN_ADDRESS, 10n)] });
    expect(verifyMidnightTransfer(inflated, own, send(RECIPIENT, 10n))).toEqual(expect.arrayContaining(['missingOutput', 'foreignOutput']));
  });

  it('refuses inputs that are not the wallet\'s, a contract call, a DUST action or a shielded offer', () => {
    const ok = { inputs: [input(100n)], outputs: [output(RECIPIENT, 10n), output(OWN_ADDRESS, 90n)] };
    expect(verifyMidnightTransfer(view({ ...ok, inputs: [input(100n, { tag: 'schnorr', value: 'ef'.repeat(32) })] }), own, send(RECIPIENT, 10n)))
      .toContain('foreignInput');
    expect(verifyMidnightTransfer(view(ok, { actions: [{}] }), own, send(RECIPIENT, 10n))).toContain('contractAction');
    expect(verifyMidnightTransfer(view(ok, { dustActions: { registrations: [{}], spends: [] } }), own, send(RECIPIENT, 10n))).toContain('dustAction');
    expect(verifyMidnightTransfer({ ...view(ok), guaranteedOffer: {} }, own, send(RECIPIENT, 10n))).toContain('shieldedOffer');
  });

  it('accepts a ledger-9 verifying key and either offer section', () => {
    const tx = { intents: new Map([[1, { guaranteedUnshieldedOffer: { inputs: [input(100n, { tag: 'schnorr', value: OWN_KEY })], outputs: [output(RECIPIENT, 10n), output(OWN_ADDRESS, 90n)] }, actions: [] }]]) };
    expect(verifyMidnightTransfer(tx, own, send(RECIPIENT, 10n))).toEqual([]);
  });
});

describe('Nexus-built native NIGHT DUST registration check', () => {
  for (const vector of fixture.registrations) {
    it(`accepts the real ledger 9 ${vector.network} registration build`, async () => {
      onLedger9();
      const tx = await decodeUnprovenMidnightTransaction(vector.network, vector.unprovenTxHex);
      expect(verifyMidnightDustRegistration(tx, own, REGISTERED_DUST_KEY)).toEqual([]);
      expect(verifyMidnightDustRegistration(tx, own, REGISTERED_DUST_KEY + 1n)).toEqual(['registrationMismatch']);
    });
  }

  const registration = (nightKey: unknown = OWN_KEY, dustAddress = 7n) => ({ registrations: [{ nightKey, dustAddress }], spends: [] });
  it('refuses a registration that moves NIGHT away or registers someone else\'s key', () => {
    const away = view({ inputs: [input(100n)], outputs: [output(ATTACKER, 100n)] }, { dustActions: registration() });
    expect(verifyMidnightDustRegistration(away, own, 7n)).toContain('foreignOutput');
    const burned = view({ inputs: [input(100n)], outputs: [output(OWN_ADDRESS, 60n)] }, { dustActions: registration() });
    expect(verifyMidnightDustRegistration(burned, own, 7n)).toContain('valueNotPreserved');
    const otherKey = view({ inputs: [input(100n)], outputs: [output(OWN_ADDRESS, 100n)] }, { dustActions: registration('ef'.repeat(32)) });
    expect(verifyMidnightDustRegistration(otherKey, own, 7n)).toContain('registrationMismatch');
    const none = view({ inputs: [input(100n)], outputs: [output(OWN_ADDRESS, 100n)] });
    expect(verifyMidnightDustRegistration(none, own, 7n)).toContain('noRegistration');
  });
});

describe('Midnight address and token decoding for the check', () => {
  it('the derived keys name the wallet the way the ledger does', async () => {
    // walletBg checks against derived.publicKeyHex / derived.addressHex, which come
    // from this keystore; they must equal an input's owner key and an output's owner.
    const { midnightKeystore, schnorrHex } = await import('./midnightLedger');
    for (const network of ['preprod', 'stagenet']) {
      const keystore = await midnightKeystore(Uint8Array.from(Buffer.from(fixture.secret, 'hex')), network);
      expect(schnorrHex(keystore.getPublicKey()).toLowerCase()).toBe(OWN_KEY.toLowerCase());
      expect(String(keystore.getAddress()).toLowerCase()).toBe(OWN_ADDRESS.toLowerCase());
    }
  });

  it('decodes unshielded and DUST addresses to the ledger values the check compares', async () => {
    const decode = await midnightAddressDecoder('preprod');
    const bech = MidnightBech32m.encode('preprod', new UnshieldedAddress(Buffer.from(OWN_ADDRESS, 'hex'))).asString();
    expect(decode.unshieldedHex(bech)).toBe(OWN_ADDRESS.toLowerCase());
    expect(decode.dustPublicKey(DustAddress.encodePublicKey('preprod', REGISTERED_DUST_KEY))).toBe(REGISTERED_DUST_KEY);
  });

  it('maps NIGHT to the all-zero colour and refuses anything that is not a colour', () => {
    expect(rawTokenOf('NIGHT')).toBe(NIGHT);
    expect(rawTokenOf('AB'.repeat(32))).toBe('ab'.repeat(32));
    expect(() => rawTokenOf('USDM')).toThrow();
  });
});

describe('a built transaction that cannot be read is refused apart from one that does not match', () => {
  // Both refusals throw before walletBg reaches its signing call (midnightBuiltTxChecks.spec.ts
  // pins that order), so nothing is signed in either case.
  const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
  const ownBech = (network: string) => MidnightBech32m.encode(network, new UnshieldedAddress(Buffer.from(OWN_ADDRESS, 'hex'))).asString();
  const toSelf = (network: string, amount = '10') => [{ address: ownBech(network), amount, token: 'NIGHT' }];
  const nightVector = (network: string) => fixture.ledger8Transfers.transfers.find((v) => v.network === network && v.token === NIGHT)!;
  const nightVector9 = (network: string) => fixture.transfers.find((v) => v.network === network && v.token === NIGHT)!;
  const registration9 = (network: string) => fixture.registrations.find((v) => v.network === network)!;
  const dustAddress = (network: string) => DustAddress.encodePublicKey(network, REGISTERED_DUST_KEY);

  it.each(['mainnet', 'preprod', 'preview'])('%s on ledger 9: content that differs is MIDNIGHT_BUILT_TX_MISMATCH', async (network) => {
    onLedger9();
    const vector = nightVector9(network);
    await expect(assertMidnightTransferMatches(network, vector.unprovenTxHex, own, toSelf(network))).resolves.toBeUndefined();
    await expect(assertMidnightTransferMatches(network, vector.unprovenTxHex, own, toSelf(network, '11')))
      .rejects.toThrow(MIDNIGHT_BUILT_TX_MISMATCH);
  });

  it.each(['mainnet', 'preprod'])('%s on ledger 9: a ledger 8 build is MIDNIGHT_BUILT_TX_UNREADABLE (no newer ledger to name)', async (network) => {
    onLedger9();
    await expect(assertMidnightTransferMatches(network, nightVector(network).unprovenTxHex, own, toSelf(network)))
      .rejects.toThrow(MIDNIGHT_BUILT_TX_UNREADABLE);
    await expect(assertMidnightTransferMatches(network, 'deadbeef', own, toSelf(network))).rejects.toThrow(MIDNIGHT_BUILT_TX_UNREADABLE);
  });

  it.each(['mainnet', 'preprod', 'preview'])('%s on ledger 9: the real registration passes and another network\'s does not', async (network) => {
    onLedger9();
    await expect(assertMidnightDustRegistrationMatches(network, registration9(network).unprovenTxHex, own, dustAddress(network))).resolves.toBeUndefined();
    const other = network === 'mainnet' ? 'preprod' : 'mainnet';
    await expect(assertMidnightDustRegistrationMatches(network, registration9(other).unprovenTxHex, own, dustAddress(network))).rejects.toThrow();
  });

  it.each(['mainnet', 'preprod'])('%s: content that differs is still MIDNIGHT_BUILT_TX_MISMATCH', async (network) => {
    const vector = nightVector(network);
    await expect(assertMidnightTransferMatches(network, vector.unprovenTxHex, own, toSelf(network))).resolves.toBeUndefined();
    await expect(assertMidnightTransferMatches(network, vector.unprovenTxHex, own, toSelf(network, '11')))
      .rejects.toThrow(MIDNIGHT_BUILT_TX_MISMATCH);
  });

  it.each(['mainnet', 'preprod', 'stagenet'])('%s: bytes no ledger reads are MIDNIGHT_BUILT_TX_UNREADABLE', async (network) => {
    await expect(assertMidnightTransferMatches(network, 'deadbeef', own, toSelf(network))).rejects.toThrow(MIDNIGHT_BUILT_TX_UNREADABLE);
    await expect(assertMidnightTransferMatches(network, 'not hex', own, toSelf(network))).rejects.toThrow(MIDNIGHT_BUILT_TX_UNREADABLE);
  });

  it.each(['mainnet', 'preprod'])('%s: a ledger-9 transaction for the network is MIDNIGHT_BUILT_TX_LEDGER_UNSUPPORTED', async (network) => {
    const hex = hexOf(ledger9.Transaction.fromParts(network).serialize());
    await expect(assertMidnightTransferMatches(network, hex, own, toSelf(network))).rejects.toThrow(MIDNIGHT_BUILT_TX_LEDGER_UNSUPPORTED);
    await expect(assertMidnightDustRegistrationMatches(network, hex, own, dustAddress(network))).rejects.toThrow(MIDNIGHT_BUILT_TX_LEDGER_UNSUPPORTED);
  });

  it('a ledger-9 transaction for another network is not read as an upgrade', async () => {
    const hex = hexOf(ledger9.Transaction.fromParts('stagenet').serialize());
    await expect(assertMidnightTransferMatches('mainnet', hex, own, toSelf('mainnet'))).rejects.toThrow(MIDNIGHT_BUILT_TX_UNREADABLE);
  });

  it('a ledger-8 transaction for another network decodes, so it is a mismatch', async () => {
    const hex = hexOf(legacy.Transaction.fromParts('preprod').serialize());
    await expect(assertMidnightTransferMatches('mainnet', hex, own, toSelf('mainnet'))).rejects.toThrow(MIDNIGHT_BUILT_TX_MISMATCH);
  });

  it('a DUST registration that cannot be read is MIDNIGHT_BUILT_TX_UNREADABLE', async () => {
    await expect(assertMidnightDustRegistrationMatches('stagenet', 'deadbeef', own, dustAddress('stagenet'))).rejects.toThrow(MIDNIGHT_BUILT_TX_UNREADABLE);
    await expect(assertMidnightDustRegistrationMatches('stagenet', registration9('stagenet').unprovenTxHex, own, dustAddress('stagenet')))
      .resolves.toBeUndefined();
  });

  it('decoding reports which unreadable case it is', async () => {
    await expect(decodeUnprovenMidnightTransaction('preprod', 'deadbeef')).rejects.toBeInstanceOf(MidnightBuiltTxUnreadableError);
    const newer = await decodeUnprovenMidnightTransaction('preprod', hexOf(ledger9.Transaction.fromParts('preprod').serialize())).catch((e: unknown) => e);
    expect(newer).toMatchObject({ newerLedger: true, message: MIDNIGHT_BUILT_TX_LEDGER_UNSUPPORTED });
  });
});
