// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as legacy from '@midnight-ntwrk/ledger-v8';
import { DustAddress, UnshieldedAddress, MidnightBech32m } from '@midnightntwrk/wallet-sdk-address-format';
import fixture from './fixtures/nexus-ledger-signing.json';
import {
  decodeUnprovenMidnightTransaction,
  midnightAddressDecoder,
  rawTokenOf,
  verifyMidnightDustRegistration,
  verifyMidnightTransfer,
  type MidnightTxView,
} from './midnightBuiltTxGuard';

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
    it(`accepts the real ${vector.network} build of ${vector.count} input(s) (${vector.token.slice(0, 4)})`, async () => {
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
  it('accepts the real stagenet registration build', async () => {
    const tx = await decodeUnprovenMidnightTransaction(fixture.registration.network, fixture.registration.unprovenTxHex);
    expect(verifyMidnightDustRegistration(tx, own, REGISTERED_DUST_KEY)).toEqual([]);
    expect(verifyMidnightDustRegistration(tx, own, REGISTERED_DUST_KEY + 1n)).toEqual(['registrationMismatch']);
  });

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
