// The maker's offer records with private (shielded) legs: status from the
// private sync's coins (by nullifier and commitment), and the private coins set
// aside for open offers.
import { describe, expect, it } from 'vitest';
import {
  deriveSwapOfferStatus, hasPrivateLeg, readSwapOfferRecords, reservedSwapNullifiers, type MidnightSwapOfferRecord,
} from './midnightSwapRecords';

const NOW = 1_800_000_000_000;
const SPENT = '11'.repeat(32);
const CHANGE = '22'.repeat(32);
const ASKED = '33'.repeat(32);

const record = (over: Partial<MidnightSwapOfferRecord> = {}): MidnightSwapOfferRecord => ({
  offerId: 'cc'.repeat(32),
  offer: 'swapoffer1test',
  network: 'Preprod',
  owner: 'mn_addr_preprod1maker',
  gives: [{ tokenType: 'aa'.repeat(32), amount: '1000', shielded: true }],
  wants: [{ tokenType: 'bb'.repeat(32), amount: '1000', shielded: true }],
  createdAt: NOW - 60_000,
  expiresAt: NOW + 30 * 60_000,
  expiry: 'root-window',
  inputs: [],
  intentHash: '',
  nullifiers: [SPENT],
  commitments: [CHANGE, ASKED],
  status: 'open',
  ...over,
});

const view = (privateCoins?: { nullifiers: string[]; commitments: string[] }) => ({
  lastSync: NOW - 1_000,
  utxos: [],
  privateCoins: privateCoins && { nullifiers: new Set(privateCoins.nullifiers), commitments: new Set(privateCoins.commitments) },
});

describe('a fully private offer', () => {
  it('is open while its coin is held, and only the clock speaks without a private view', () => {
    expect(deriveSwapOfferStatus(record(), view({ nullifiers: [SPENT], commitments: [] }), NOW)).toBe('open');
    expect(deriveSwapOfferStatus(record(), view(), NOW)).toBe('open');
    expect(deriveSwapOfferStatus(record(), view(), NOW + 31 * 60_000)).toBe('expired');
    // A public sync alone says nothing about private coins.
    expect(deriveSwapOfferStatus(record(), { lastSync: null, utxos: [] }, NOW)).toBe('open');
  });

  it('is cancelled once its coin is spent and nothing arrived, taken once a coin it created arrives', () => {
    expect(deriveSwapOfferStatus(record(), view({ nullifiers: [], commitments: [] }), NOW)).toBe('cancelled');
    expect(deriveSwapOfferStatus(record(), view({ nullifiers: [], commitments: [ASKED] }), NOW)).toBe('taken');
    expect(deriveSwapOfferStatus(record({ status: 'cancelled' }), view({ nullifiers: [], commitments: [CHANGE] }), NOW)).toBe('taken');
  });
});

describe('an offer of public NIGHT for a private token', () => {
  const mixed = record({
    gives: [{ tokenType: '00'.repeat(32), amount: '5' }],
    nullifiers: [],
    commitments: [ASKED],
    inputs: [`${'aa'.repeat(32)}#0`],
    intentHash: 'dd'.repeat(32),
    expiry: 'ttl',
  });

  it('needs both views: its public coin and the private coin it asked for', () => {
    expect(deriveSwapOfferStatus(mixed, { lastSync: NOW, utxos: [{ intentHash: 'aa'.repeat(32), outputIndex: 0 }] }, NOW)).toBe('open');
    expect(deriveSwapOfferStatus(mixed, { ...view({ nullifiers: [], commitments: [] }), utxos: [{ intentHash: 'aa'.repeat(32), outputIndex: 0 }] }, NOW)).toBe('open');
    expect(deriveSwapOfferStatus(mixed, view({ nullifiers: [], commitments: [] }), NOW)).toBe('cancelled');
    expect(deriveSwapOfferStatus(mixed, view({ nullifiers: [], commitments: [ASKED] }), NOW)).toBe('taken');
    expect(hasPrivateLeg(mixed)).toBe(true);
    expect(hasPrivateLeg({ gives: mixed.gives, wants: [] })).toBe(false);
  });
});

describe('reservedSwapNullifiers', () => {
  it('sets aside the private coins of open, unexpired offers only', () => {
    const reserved = reservedSwapNullifiers([
      record(),
      record({ offerId: 'dd'.repeat(32), nullifiers: ['44'.repeat(32)], status: 'taken' }),
      record({ offerId: 'ee'.repeat(32), nullifiers: ['55'.repeat(32)], expiresAt: NOW - 1 }),
    ], NOW);
    expect([...reserved]).toEqual([SPENT]);
  });
});

describe('readSwapOfferRecords with private legs', () => {
  it('keeps a well-formed private record and drops malformed ones', () => {
    expect(readSwapOfferRecords([record()])).toHaveLength(1);
    expect(readSwapOfferRecords([record({ nullifiers: ['not hex'] })])).toHaveLength(0);
    expect(readSwapOfferRecords([record({ expiry: 'soon' as never })])).toHaveLength(0);
    expect(readSwapOfferRecords([record({ gives: [{ tokenType: 'aa'.repeat(32), amount: '1', shielded: 'yes' as never }] })])).toHaveLength(0);
    // Nothing to watch: never readable as taken or cancelled.
    expect(readSwapOfferRecords([record({ nullifiers: [] })])).toHaveLength(0);
  });
});
