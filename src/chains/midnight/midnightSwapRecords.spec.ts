// The maker's offer records: status from the wallet's coins, reserved coins, pruning.
import { describe, expect, it } from 'vitest';
import {
  deriveSwapOfferStatus, MIDNIGHT_SWAP_RECORD_KEEP_MS, MIDNIGHT_SWAP_RECORD_MAX, readSwapOfferRecords, refreshSwapOfferRecords,
  reservedSwapCoins, withoutReservedCoins, type MidnightSwapOfferRecord,
} from './midnightSwapRecords';

const NOW = 1_800_000_000_000;
const coin = (intentHash: string, outputIndex: number) => ({ intentHash, outputIndex });
const OFFERED = 'aa'.repeat(32);
const MAKER_INTENT = 'bb'.repeat(32);

const record = (over: Partial<MidnightSwapOfferRecord> = {}): MidnightSwapOfferRecord => ({
  offerId: 'cc'.repeat(32),
  offer: 'swapoffer1test',
  network: 'Preprod',
  owner: 'mn_addr_preprod1maker',
  gives: [{ tokenType: '00'.repeat(32), amount: '100000000' }],
  wants: [{ tokenType: 'ab'.repeat(32), amount: '2000' }],
  createdAt: NOW - 60_000,
  expiresAt: NOW + 30 * 60_000,
  inputs: [`${OFFERED}#0`, `${OFFERED}#2`],
  intentHash: MAKER_INTENT,
  status: 'open',
  ...over,
});

const synced = (utxos: Array<{ intentHash: string; outputIndex: number }>) => ({ lastSync: NOW - 1_000, utxos });

describe('deriveSwapOfferStatus', () => {
  it('is open while every offered coin is held and the TTL is ahead', () => {
    expect(deriveSwapOfferStatus(record(), synced([coin(OFFERED, 0), coin(OFFERED.toUpperCase(), 2)]), NOW)).toBe('open');
  });

  it('is expired once the TTL passes with the coins still held', () => {
    expect(deriveSwapOfferStatus(record(), synced([coin(OFFERED, 0), coin(OFFERED, 2)]), NOW + 31 * 60_000)).toBe('expired');
  });

  it('is taken when an output of the maker intent arrives', () => {
    expect(deriveSwapOfferStatus(record(), synced([coin(MAKER_INTENT, 1)]), NOW)).toBe('taken');
  });

  it('is cancelled when an offered coin goes and nothing arrives', () => {
    expect(deriveSwapOfferStatus(record(), synced([coin(OFFERED, 0)]), NOW)).toBe('cancelled');
    expect(deriveSwapOfferStatus(record({ withdrawTxHash: 'dd'.repeat(32) }), synced([]), NOW + 40 * 60_000)).toBe('cancelled');
  });

  it('says expired for coins first seen spent after the TTL', () => {
    expect(deriveSwapOfferStatus(record(), synced([]), NOW + 40 * 60_000)).toBe('expired');
  });

  it('uses only the clock before a sync', () => {
    expect(deriveSwapOfferStatus(record(), { lastSync: null, utxos: [] }, NOW)).toBe('open');
    expect(deriveSwapOfferStatus(record(), { lastSync: null, utxos: [] }, NOW + 31 * 60_000)).toBe('expired');
  });

  it('keeps a terminal status', () => {
    expect(deriveSwapOfferStatus(record({ status: 'taken' }), synced([coin(OFFERED, 0), coin(OFFERED, 2)]), NOW)).toBe('taken');
  });
});

describe('refreshSwapOfferRecords', () => {
  it('stamps a newly settled offer and reports the change', () => {
    const { records, changed } = refreshSwapOfferRecords([record()], synced([coin(MAKER_INTENT, 0)]), NOW);
    expect(changed).toBe(true);
    expect(records[0]).toMatchObject({ status: 'taken', settledAt: NOW });
  });

  it('reports no change when nothing moved', () => {
    expect(refreshSwapOfferRecords([record()], synced([coin(OFFERED, 0), coin(OFFERED, 2)]), NOW).changed).toBe(false);
  });

  it('drops settled offers after a week and keeps the newest when over the cap', () => {
    const old = record({ status: 'expired', settledAt: NOW - MIDNIGHT_SWAP_RECORD_KEEP_MS - 1 });
    expect(refreshSwapOfferRecords([old], synced([]), NOW).records).toEqual([]);
    const many = Array.from({ length: MIDNIGHT_SWAP_RECORD_MAX + 3 }, (_, i) =>
      record({ offerId: i.toString(16).padStart(64, '0'), createdAt: NOW - i, status: 'expired', settledAt: NOW }));
    const { records } = refreshSwapOfferRecords(many, synced([]), NOW);
    expect(records).toHaveLength(MIDNIGHT_SWAP_RECORD_MAX);
    expect(records[0].createdAt).toBe(NOW);
  });
});

describe('reserved coins', () => {
  it('reserves the coins of open, unexpired offers only', () => {
    const open = record();
    const expired = record({ inputs: ['ee'.repeat(32) + '#0'], expiresAt: NOW - 1 });
    const taken = record({ inputs: ['ff'.repeat(32) + '#0'], status: 'taken' });
    expect([...reservedSwapCoins([open, expired, taken], NOW)]).toEqual([`${OFFERED}#0`, `${OFFERED}#2`]);
  });

  it('removes reserved coins from a coin list, whatever the hash case', () => {
    const utxos = [coin(OFFERED.toUpperCase(), 0), coin(OFFERED, 1), coin(OFFERED, 2)];
    expect(withoutReservedCoins(utxos, reservedSwapCoins([record()], NOW))).toEqual([coin(OFFERED, 1)]);
  });
});

describe('readSwapOfferRecords', () => {
  it('keeps well-formed records and drops anything else', () => {
    const good = record();
    expect(readSwapOfferRecords([good, { ...good, status: 'weird' }, { ...good, inputs: ['nope'] }, null, 'x'])).toEqual([good]);
    expect(readSwapOfferRecords('not a list')).toEqual([]);
  });
});
