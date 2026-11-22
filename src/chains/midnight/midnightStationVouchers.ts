// Vouchers for Gero's fee station: one pays the DUST fee of one Midnight send.
//
// RFC 9474 blind RSA signatures (RSABSSA-SHA384-PSS-Randomized, through
// @cloudflare/blindrsa-ts): the wallet blinds random tokens, the server signs
// them without seeing them, the wallet unblinds. What it then holds is a plain
// RSA-PSS signature over a message the server has never seen, so redeeming one
// does not say which stake account it was issued to.
//
// Stored in the private store only (privateStore.ts): never chrome.storage.local,
// never broadcast, never logged. Background only.

import { RSABSSA } from '@cloudflare/blindrsa-ts';
import { Mutex } from 'async-mutex';
import { getPrivate, setPrivate } from '@/utils/privateStore';

const suite = RSABSSA.SHA384.PSS.Randomized();
const TOKEN_BYTES = 32;
const DAY_MS = 86_400_000;
/** The most vouchers one batch may hold, whatever the server's allowance says. */
export const STATION_MAX_BATCH = 16;

export interface StationVoucher {
  /** The signing key's UTC day, `YYYY-MM-DD`. */
  keyId: string;
  /** Base64 of the prepared message (the random prefix and the token). */
  message: string;
  /** Base64 of the RSA-PSS signature over the message. */
  signature: string;
  /** The transaction identifier this voucher is held for, while a redemption is in flight. */
  reservedFor?: string;
  /** Epoch ms after which the reservation no longer holds. */
  reservedUntil?: number;
}

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(Buffer.from(text, 'base64'));

/** The day's public key, as the challenge delivers it (base64 SPKI). Throws unless it is RSA of 2048 bits or more. */
export async function importStationKey(spkiBase64: string): Promise<CryptoKey> {
  // Extractable: the library reads the modulus and exponent to blind.
  const key = await crypto.subtle.importKey('spki', fromBase64(spkiBase64), { name: 'RSA-PSS', hash: 'SHA-384' }, true, ['verify']);
  if ((key.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048) throw new Error('The station voucher key is too short');
  return key;
}

/** A batch between blinding and the server's answer. Held in memory only. */
export interface PendingBatch {
  readonly prepared: Uint8Array[];
  readonly inverses: Uint8Array[];
  /** What goes to the server, base64. */
  readonly blinded: string[];
}

export async function blindBatch(key: CryptoKey, count: number): Promise<PendingBatch> {
  if (!Number.isInteger(count) || count < 1 || count > STATION_MAX_BATCH) throw new Error('Invalid voucher batch size');
  const prepared: Uint8Array[] = [];
  const inverses: Uint8Array[] = [];
  const blinded: string[] = [];
  for (let index = 0; index < count; index++) {
    const message = suite.prepare(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
    const { blindedMsg, inv } = await suite.blind(key, message);
    prepared.push(message);
    inverses.push(inv);
    blinded.push(toBase64(blindedMsg));
  }
  return { prepared, inverses, blinded };
}

/** Unblind the server's answer. Throws unless every signature verifies under `key`. */
export async function finalizeBatch(
  key: CryptoKey, keyId: string, pending: PendingBatch, blindSignatures: readonly string[],
): Promise<StationVoucher[]> {
  if (blindSignatures.length !== pending.prepared.length) throw new Error('The station signed a different number of vouchers');
  const vouchers: StationVoucher[] = [];
  for (let index = 0; index < pending.prepared.length; index++) {
    const message = pending.prepared[index];
    const signature = await suite.finalize(key, message, fromBase64(blindSignatures[index]), pending.inverses[index]);
    if (!await suite.verify(key, signature, message)) throw new Error('The station returned an invalid voucher');
    vouchers.push({ keyId, message: toBase64(message), signature: toBase64(signature) });
  }
  return vouchers;
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** A key's vouchers are good on its UTC day and the next (one issued at 23:59 is still usable). */
export function voucherKeyUsable(keyId: string, now: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(keyId)) return false;
  const start = Date.parse(`${keyId}T00:00:00Z`);
  return Number.isFinite(start) && now >= start && now < start + 2 * DAY_MS;
}

// One lock for every read-modify-write: two sends must never take the same voucher.
const lock = new Mutex();
const storeKey = (network: string, stakeAddress: string) => `midnightStationVouchers:${network}:${stakeAddress}`;

function isVoucher(value: unknown): value is StationVoucher {
  const v = value as Partial<StationVoucher> | null;
  return !!v && typeof v.keyId === 'string' && typeof v.message === 'string' && typeof v.signature === 'string'
    && (v.reservedFor === undefined || typeof v.reservedFor === 'string')
    && (v.reservedUntil === undefined || typeof v.reservedUntil === 'number');
}

async function read(network: string, stakeAddress: string, now: number): Promise<StationVoucher[]> {
  const stored = await getPrivate<unknown>(storeKey(network, stakeAddress));
  return (Array.isArray(stored) ? stored : []).filter(isVoucher).filter(voucher => voucherKeyUsable(voucher.keyId, now));
}

const isFree = (voucher: StationVoucher, now: number) => voucher.reservedUntil === undefined || voucher.reservedUntil <= now;

/** Vouchers that can pay for a new transaction now. */
export function countFreeVouchers(network: string, stakeAddress: string, now: number): Promise<number> {
  return lock.runExclusive(async () => (await read(network, stakeAddress, now)).filter(voucher => isFree(voucher, now)).length);
}

export function addVouchers(network: string, stakeAddress: string, vouchers: readonly StationVoucher[], now: number): Promise<void> {
  return lock.runExclusive(async () => {
    await setPrivate(storeKey(network, stakeAddress), [...await read(network, stakeAddress, now), ...vouchers]);
  });
}

/**
 * Hold one voucher for `txIdentifier` until `reservedUntil`: the one already
 * held for it (a repeat of the same transaction reuses its voucher), else a
 * free one. Null when there is none.
 */
export function reserveVoucher(
  network: string, stakeAddress: string, txIdentifier: string, reservedUntil: number, now: number,
): Promise<StationVoucher | null> {
  return lock.runExclusive(async () => {
    const all = await read(network, stakeAddress, now);
    const mine = all.find(voucher => voucher.reservedFor === txIdentifier) ?? all.find(voucher => isFree(voucher, now));
    if (!mine) return null;
    mine.reservedFor = txIdentifier;
    mine.reservedUntil = reservedUntil;
    await setPrivate(storeKey(network, stakeAddress), all);
    return { ...mine };
  });
}

/** The station did not use it: free again. */
export function releaseVoucher(network: string, stakeAddress: string, message: string, now: number): Promise<void> {
  return lock.runExclusive(async () => {
    const all = await read(network, stakeAddress, now);
    for (const voucher of all) {
      if (voucher.message === message) { delete voucher.reservedFor; delete voucher.reservedUntil; }
    }
    await setPrivate(storeKey(network, stakeAddress), all);
  });
}

/** Spent, or refused as spent or invalid: gone. */
export function dropVoucher(network: string, stakeAddress: string, message: string, now: number): Promise<void> {
  return lock.runExclusive(async () => {
    const all = await read(network, stakeAddress, now);
    await setPrivate(storeKey(network, stakeAddress), all.filter(voucher => voucher.message !== message));
  });
}
