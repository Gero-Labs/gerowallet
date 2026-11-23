// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RSABSSA } from '@cloudflare/blindrsa-ts';
import { resetPrivateStoreForTest } from '@/utils/privateStore';
import {
  STATION_MAX_BATCH, addVouchers, batchIssuedToday, blindBatch, countFreeVouchers, dropVoucher, finalizeBatch, importStationKey,
  noteBatchIssued, releaseVoucher, reserveVoucher, utcDay, voucherKeyUsable,
} from './midnightStationVouchers';

const suite = RSABSSA.SHA384.PSS.Randomized();
const NOW = Date.parse('2026-11-22T10:00:00Z');
const DAY = 86_400_000;
const NET = 'Preprod';
const STAKE = 'stake_test1uexample';
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const raw = (text: string) => Uint8Array.from(Buffer.from(text, 'base64'));

let serverKey: CryptoKey;
let publicKeyBase64: string;
/** What the gateway does: sign each blinded message without seeing the token. */
const serverSign = async (blinded: string[]) => Promise.all(blinded.map(async item => b64(await suite.blindSign(serverKey, raw(item)))));

beforeAll(async () => {
  const pair = await suite.generateKey({ publicExponent: Uint8Array.from([1, 0, 1]), modulusLength: 2048 });
  serverKey = pair.privateKey;
  publicKeyBase64 = b64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
});

beforeEach(async () => {
  resetPrivateStoreForTest();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('gero-private-store');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

async function issue(count: number, keyId = '2026-11-22') {
  const key = await importStationKey(publicKeyBase64);
  const pending = await blindBatch(key, count);
  return finalizeBatch(key, keyId, pending, await serverSign(pending.blinded));
}

describe('station vouchers: blind signatures', () => {
  it('a batch unblinds to vouchers any holder of the public key can verify', async () => {
    const vouchers = await issue(3);
    expect(vouchers).toHaveLength(3);
    const verifyKey = await crypto.subtle.importKey('spki', raw(publicKeyBase64), { name: 'RSA-PSS', hash: 'SHA-384' }, false, ['verify']);
    for (const voucher of vouchers) {
      expect(voucher.keyId).toBe('2026-11-22');
      expect(raw(voucher.message)).toHaveLength(64);
      // The gateway's check: a plain RSA-PSS signature over the message.
      expect(await crypto.subtle.verify({ name: 'RSA-PSS', saltLength: 48 }, verifyKey, raw(voucher.signature), raw(voucher.message))).toBe(true);
    }
    expect(new Set(vouchers.map(voucher => voucher.message)).size).toBe(3);
  });

  it('what the server sees does not contain the token it later receives', async () => {
    const key = await importStationKey(publicKeyBase64);
    const pending = await blindBatch(key, 1);
    const [voucher] = await finalizeBatch(key, '2026-11-22', pending, await serverSign(pending.blinded));
    expect(pending.blinded[0]).not.toBe(voucher.message);
    expect(pending.blinded[0]).not.toBe(voucher.signature);
  });

  it('refuses a wrong blind signature, a short answer and a bad batch size', async () => {
    const key = await importStationKey(publicKeyBase64);
    const pending = await blindBatch(key, 2);
    const signed = await serverSign(pending.blinded);
    await expect(finalizeBatch(key, '2026-11-22', pending, [signed[1], signed[0]])).rejects.toThrow();
    await expect(finalizeBatch(key, '2026-11-22', pending, [signed[0]])).rejects.toThrow('different number');
    await expect(blindBatch(key, 0)).rejects.toThrow('batch size');
    await expect(blindBatch(key, STATION_MAX_BATCH + 1)).rejects.toThrow('batch size');
  });

  it('refuses a key that is not a 2048-bit or longer RSA key', async () => {
    const small = await suite.generateKey({ publicExponent: Uint8Array.from([1, 0, 1]), modulusLength: 1024 });
    const spki = b64(new Uint8Array(await crypto.subtle.exportKey('spki', small.publicKey)));
    await expect(importStationKey(spki)).rejects.toThrow('too short');
    // Only the standard public exponent 65537: an unusual one is not a key Gero's station would publish.
    const odd = await suite.generateKey({ publicExponent: Uint8Array.from([3]), modulusLength: 2048 });
    const oddSpki = b64(new Uint8Array(await crypto.subtle.exportKey('spki', odd.publicKey)));
    await expect(importStationKey(oddSpki)).rejects.toThrow('public exponent');
    await expect(importStationKey('bm90IGEga2V5')).rejects.toThrow();
  });
});

describe('station vouchers: validity', () => {
  it('a key is good on its UTC day and the next', () => {
    expect(utcDay(NOW)).toBe('2026-11-22');
    expect(voucherKeyUsable('2026-11-22', NOW)).toBe(true);
    expect(voucherKeyUsable('2026-11-21', NOW)).toBe(true);
    expect(voucherKeyUsable('2026-11-20', NOW)).toBe(false);
    expect(voucherKeyUsable('2026-11-23', NOW)).toBe(false);
    expect(voucherKeyUsable('yesterday', NOW)).toBe(false);
  });
});

describe('station vouchers: the store', () => {
  it('counts what is free, per network and stake address', async () => {
    await addVouchers(NET, STAKE, await issue(3), NOW);
    expect(await countFreeVouchers(NET, STAKE, NOW)).toBe(3);
    expect(await countFreeVouchers(NET, 'stake_test1uother', NOW)).toBe(0);
    expect(await countFreeVouchers('Mainnet', STAKE, NOW)).toBe(0);
  });

  it('forgets vouchers whose key has expired', async () => {
    await addVouchers(NET, STAKE, await issue(2), NOW);
    expect(await countFreeVouchers(NET, STAKE, NOW + DAY)).toBe(2);
    expect(await countFreeVouchers(NET, STAKE, NOW + 2 * DAY)).toBe(0);
  });

  it('reserves one voucher per transaction, and the same one again for the same transaction', async () => {
    await addVouchers(NET, STAKE, await issue(2), NOW);
    const first = await reserveVoucher(NET, STAKE, 'tx-a', NOW + 300_000, NOW);
    const again = await reserveVoucher(NET, STAKE, 'tx-a', NOW + 300_000, NOW);
    const second = await reserveVoucher(NET, STAKE, 'tx-b', NOW + 300_000, NOW);
    expect(again!.message).toBe(first!.message);
    expect(second!.message).not.toBe(first!.message);
    expect(await reserveVoucher(NET, STAKE, 'tx-c', NOW + 300_000, NOW)).toBeNull();
    expect(await countFreeVouchers(NET, STAKE, NOW)).toBe(0);
  });

  it('a reservation lapses, can be released, and a spent voucher is dropped', async () => {
    await addVouchers(NET, STAKE, await issue(2), NOW);
    const first = await reserveVoucher(NET, STAKE, 'tx-a', NOW + 300_000, NOW);
    expect(await countFreeVouchers(NET, STAKE, NOW + 300_001)).toBe(2);
    await releaseVoucher(NET, STAKE, first!.message, NOW);
    expect(await countFreeVouchers(NET, STAKE, NOW)).toBe(2);
    await dropVoucher(NET, STAKE, first!.message, NOW);
    expect(await countFreeVouchers(NET, STAKE, NOW)).toBe(1);
  });
});

// The server gives a stake key one batch per UTC day, and its challenge no longer says whether
// today's was taken (that told anyone who asked that the stake key uses the station). So the
// wallet remembers it.
describe('station vouchers: the issued day', () => {
  it('remembers the day a batch was issued, per network and stake address, until the next UTC day', async () => {
    expect(await batchIssuedToday(NET, STAKE, NOW)).toBe(false);
    await noteBatchIssued(NET, STAKE, '2026-11-22');
    expect(await batchIssuedToday(NET, STAKE, NOW)).toBe(true);
    expect(await batchIssuedToday(NET, 'stake_test1uother', NOW)).toBe(false);
    expect(await batchIssuedToday('Mainnet', STAKE, NOW)).toBe(false);
    expect(await batchIssuedToday(NET, STAKE, NOW + DAY)).toBe(false);
  });

  it('keeps the vouchers and the issued day apart', async () => {
    await noteBatchIssued(NET, STAKE, '2026-11-22');
    expect(await countFreeVouchers(NET, STAKE, NOW)).toBe(0);
    await addVouchers(NET, STAKE, await issue(2), NOW);
    expect(await countFreeVouchers(NET, STAKE, NOW)).toBe(2);
    expect(await batchIssuedToday(NET, STAKE, NOW)).toBe(true);
  });
});
