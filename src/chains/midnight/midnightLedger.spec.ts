// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as legacy from '@midnight-ntwrk/ledger-v8';
import * as ledger from '@midnightntwrk/ledger-v9';
import {
  midnightKeystore, midnightLedgerVersion, requireMidnightLedger8,
  schnorrHex, validateMidnightSigningSegments,
} from './midnightLedger';
import { deserializeLedger9Transaction, signLedger9Transaction } from './midnightLedger9';

// Public synthetic vectors. Never fund these keys.
const secret = new Uint8Array(32).fill(1);
const hexSecret = Buffer.from(secret).toString('hex');
const ttl = new Date('2030-01-01T00:00:00Z');
const key = ledger.signatureVerifyingKey({ tag: 'schnorr', value: hexSecret });

function fixture(registration = false) {
  const intent = ledger.Intent.new(ttl);
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([
    { value: 10n, owner: key, type: '00'.repeat(32), intentHash: '11'.repeat(32), outputNo: 0 },
  ], [{ value: 10n, owner: ledger.addressFromKey(key), type: '00'.repeat(32) }], []);
  if (registration) {
    intent.dustActions = new ledger.DustActions('signature', 'pre-proof', new Date('2029-12-31T00:00:00Z'), [], [
      new ledger.DustRegistration('signature', key, undefined, 0n),
    ]);
  }
  const tx = ledger.Transaction.fromParts('stagenet', undefined, undefined, intent);
  return Buffer.from(tx.serialize()).toString('hex');
}

describe('Midnight ledger isolation with real WASM', () => {
  it.each([['Mainnet', 8], ['Preprod', 8], ['Stagenet', 9]])('selects %s explicitly', (network, version) => {
    expect(midnightLedgerVersion(network as string)).toBe(version);
  });

  it('rejects unknown networks and ledger-8-only operations on Stagenet', () => {
    expect(() => midnightLedgerVersion('preview')).toThrow('Unsupported');
    expect(() => requireMidnightLedger8('stagenet', 'Shielding')).toThrow('ledger 9');
    expect(() => requireMidnightLedger8('preprod', 'Shielding')).not.toThrow();
    expect(() => deserializeLedger9Transaction('mainnet', fixture())).toThrow('Stagenet');
  });

  it('preserves legacy Schnorr public key/address identity with tagged v9 keys', async () => {
    const old = await midnightKeystore(secret, 'mainnet');
    const current = await midnightKeystore(secret, 'stagenet');
    expect(schnorrHex(current.getPublicKey())).toBe(schnorrHex(old.getPublicKey()));
    expect(current.getAddress()).toBe(old.getAddress());
    expect(schnorrHex(current.getPublicKey())).toBe('1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f');
    expect(() => schnorrHex({ tag: 'ecdsa', value: 'ab' })).toThrow('Schnorr');
  });

  it('signs the canonical v9 envelope and rejects a tampered payload', () => {
    const signed = deserializeLedger9Transaction('stagenet', signLedger9Transaction('stagenet', fixture(), secret));
    const intent = signed.intents!.get(1)!;
    const signature = intent.guaranteedUnshieldedOffer!.signatures[0].value;
    const payload = intent.signatureData(1);
    expect(ledger.verifySignature(key, payload, signature)).toBe(true);
    payload[payload.length - 1] ^= 1;
    expect(ledger.verifySignature(key, payload, signature)).toBe(false);
  });

  it('retains an existing signature without duplicating it', () => {
    const first = signLedger9Transaction('stagenet', fixture(), secret);
    expect(signLedger9Transaction('stagenet', first, secret)).toBe(first);
  });

  it('refuses to sign another key\'s unsigned input', () => {
    expect(() => signLedger9Transaction('stagenet', fixture(), new Uint8Array(32).fill(2))).toThrow('another key');
  });

  it('rejects a ledger-9 envelope carrying another network ID before signing', async () => {
    const tx = ledger.Transaction.fromParts('mainnet');
    const hex = Buffer.from(tx.serialize()).toString('hex');
    expect(() => signLedger9Transaction('stagenet', hex, secret)).toThrow('network');
    await expect(validateMidnightSigningSegments('stagenet', hex, [])).rejects.toThrow('network');
  });

  it('validates supplied DUST signing payloads against their transaction', async () => {
    const hex = fixture(true);
    const payload = Buffer.from(deserializeLedger9Transaction('stagenet', hex).intents!.get(1)!.signatureData(1)).toString('hex');
    const segments = [{ index: 1, role: 'NightExternal' as const, dataHex: payload }];
    await expect(validateMidnightSigningSegments('stagenet', hex, segments)).resolves.toBeUndefined();
    await expect(validateMidnightSigningSegments('stagenet', undefined, segments)).rejects.toThrow('requires');
    await expect(validateMidnightSigningSegments('stagenet', hex, [{ ...segments[0], dataHex: '00' }])).rejects.toThrow('does not match');
    await expect(validateMidnightSigningSegments('stagenet', hex, [segments[0], segments[0]])).rejects.toThrow('Duplicate');
    await expect(validateMidnightSigningSegments('stagenet', hex, [])).rejects.toThrow('one native DUST');
    await expect(validateMidnightSigningSegments('stagenet', fixture(), segments)).rejects.toThrow('one native DUST');
  });

  it('rejects the wrong ledger line in both directions and still signs legacy envelopes', async () => {
    const oldKey = legacy.signatureVerifyingKey(hexSecret);
    const oldIntent = legacy.Intent.new(ttl);
    oldIntent.guaranteedUnshieldedOffer = legacy.UnshieldedOffer.new([
      { value: 10n, owner: oldKey, type: '00'.repeat(32), intentHash: '11'.repeat(32), outputNo: 0 },
    ], [{ value: 10n, owner: legacy.addressFromKey(oldKey), type: '00'.repeat(32) }], []);
    const oldTx = legacy.Transaction.fromParts('preprod', undefined, undefined, oldIntent);
    const oldHex = Buffer.from(oldTx.serialize()).toString('hex');
    expect(() => deserializeLedger9Transaction('stagenet', oldHex)).toThrow();
    expect(() => legacy.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', Buffer.from(fixture(), 'hex'))).toThrow();
    const payload = oldIntent.signatureData(1);
    const sig = legacy.signData(hexSecret, payload);
    expect(legacy.verifySignature(oldKey, payload, sig)).toBe(true);
    await expect(validateMidnightSigningSegments('preprod', oldHex, [
      { index: 1, role: 'NightExternal', dataHex: Buffer.from(payload).toString('hex') },
    ])).resolves.toBeUndefined();
  });
});
