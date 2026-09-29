import { describe, expect, it, vi } from 'vitest';
import { Cardano } from '@cardano-sdk/core';

vi.mock('@/shared/composables/useCnightDustRegistration', () => ({
  DUST_MAPPING_VALIDATOR: { Preprod: { scriptHash: '', address: 'addr_test1dustvalidator' } },
}));

import type { StoredTransaction } from '@/models/transaction.types';
import {
  buildClassifyContext,
  buildTxTags,
  buildTxTitle,
  classifyTxKind,
  isDexOrderCancellation,
  isDexTransaction,
  isInternalTransfer,
  isMinswap,
  isPendingTooLong,
  withMinusSign,
} from './transactionClassifier';

const OWN_PAYMENT = 'addr_test1ownpayment';
const OWN_CHANGE = 'addr_test1ownchange';
const OTHER = 'addr_test1someoneelse';
// Minswap V2 order script c3e28c36…, with no stake part and with a wallet's stake key
const MINSWAP_V2_ORDER = 'addr1w8p79rpkcdz8x9d6tft0x0dx5mwuzac2sa4gm8cvkw5hcnqst2ctf';
const MINSWAP_V2_ORDER_STAKED = 'addr1z8p79rpkcdz8x9d6tft0x0dx5mwuzac2sa4gm8cvkw5hcn84xmy84q2crvzy6he2j69798923xvt3jk5n3nd9eecmxks7hfyu8';
const MINSWAP_V2_POOL = 'addr1z84q0denmyep98ph3tmzwsmw0j7zau9ljmsqx6a4rvaau66j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq777e2a';
const MINSWAP_V1_MARKET_ORDER = 'addr1wxn9efv2f6w82hagxqtn62ju4m293tqvw0uhmdl64ch8uwc0h43gt';
const metadata = (...msg: string[]) => ({ auxiliaryData: { blob: { 674: { msg } } } });

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

const ctx = buildClassifyContext(
  { stakeAddress: 'stake_test1me', network: 'Preprod' },
  { payment: [{ address: OWN_PAYMENT }], change: [{ address: OWN_CHANGE }] },
  { alice: { address: OTHER, name: 'Alice' } },
);

const io = (address: string) => ({ address, amount: [{ unit: 'lovelace', quantity: '1000000' }] });

function tx(overrides: Record<string, unknown>): StoredTransaction {
  return {
    id: 'tx1',
    tx_hash: 'tx1',
    tx_timestamp: Math.floor(Date.now() / 1000) - 60,
    pending: false,
    ada: 0,
    sentAmount: 0,
    receivedAmount: 0,
    assets: [],
    sentAssets: [],
    receivedAssets: [],
    utxo: { inputs: [], outputs: [] },
    ...overrides,
  } as unknown as StoredTransaction;
}

describe('transaction titles and types', () => {
  it('titles an all-own-address transaction a self transfer, without an extra Internal tag', () => {
    const item = tx({
      ada: -310000, sentAmount: 310000,
      utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io(OWN_CHANGE), io(OWN_PAYMENT)] },
    });
    expect(isInternalTransfer(item, ctx)).toBe(true);
    expect(buildTxTitle(item, ctx, t)).toBe('transactions.selfTransfer');
    const kind = classifyTxKind(item, ctx);
    expect(kind).toBe('self');
    expect(buildTxTags(item, ctx, t, kind).map((tag) => tag.key)).not.toContain('internal');
  });

  it('never calls a transaction internal without a verifiable output list', () => {
    const item = tx({ utxo: { inputs: [io(OWN_PAYMENT)], outputs: [] } });
    expect(isInternalTransfer(item, ctx)).toBe(false);
  });

  it('classifies received and sent funds, and names a known contact', () => {
    const received = tx({
      ada: 10_000_000, receivedAmount: 10_000_000,
      utxo: { inputs: [io(OTHER)], outputs: [io(OWN_PAYMENT)] },
    });
    expect(buildTxTitle(received, ctx, t)).toBe('transactions.receivedFunds');
    expect(classifyTxKind(received, ctx)).toBe('in');
    expect(buildTxTags(received, ctx, t, 'in')).toContainEqual(
      { key: 'contact-Alice', label: 'Alice', icon: 'mdi-account-outline' },
    );

    const sent = tx({
      ada: -20_000_000, sentAmount: 20_000_000,
      utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io(OTHER), io(OWN_CHANGE)] },
    });
    expect(buildTxTitle(sent, ctx, t)).toBe('transactions.sentFunds');
    expect(classifyTxKind(sent, ctx)).toBe('out');
  });

  it('titles a token receipt that only carries min-UTxO ADA by its tokens', () => {
    const item = tx({
      ada: 1_500_000, receivedAmount: 1_500_000,
      assets: [{ unit: 'abc123', policy_id: 'abc', asset_name: '123', quantity: 5 }],
      utxo: { inputs: [io(OTHER)], outputs: [io(OWN_PAYMENT)] },
    });
    expect(buildTxTitle(item, ctx, t)).toBe('transactions.receivedToken');
    expect(classifyTxKind(item, ctx)).toBe('in');
  });

  describe('DEX orders, fills and cancellations', () => {
    const tagKeys = (item: StoredTransaction) => buildTxTags(item, ctx, t, classifyTxKind(item, ctx)).map((tag) => tag.key);

    it('tags a Gero Swap order on Minswap V2 as Minswap and Gero Swap, never SteelSwap (tx e113f7f1…)', () => {
      const item = tx({
        ada: -15_405_077, sentAmount: 15_405_077,
        utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io(MINSWAP_V2_ORDER), io(OTHER), io(OWN_PAYMENT)] },
        body: { outputs: [] },
        ...metadata('Gero Swap'),
      });
      expect(buildTxTitle(item, ctx, t)).toBe('transactions.dexOrder');
      expect(classifyTxKind(item, ctx)).toBe('swap');
      expect(tagKeys(item)).toEqual(expect.arrayContaining(['minswap', 'geroswap']));
      expect(tagKeys(item)).not.toContain('steelswap');
    });

    it('titles an order spent without its pool a cancellation, not a DEX order (tx cf268634…)', () => {
      const item = tx({
        ada: 13_194_754, receivedAmount: 13_194_754,
        utxo: { inputs: [io(MINSWAP_V2_ORDER), io(OWN_PAYMENT), io(OWN_PAYMENT)], outputs: [io(OWN_PAYMENT)] },
      });
      expect(isDexOrderCancellation(item)).toBe(true);
      expect(buildTxTitle(item, ctx, t)).toBe('transactions.orderCancelled');
      expect(classifyTxKind(item, ctx)).toBe('cancelled');
      expect(tagKeys(item)).toContain('minswap');
      expect(tagKeys(item)).not.toContain('steelswap');
    });

    it('keeps a fill, which spends the pool too, a DEX order', () => {
      const item = tx({
        ada: 13_190_000, receivedAmount: 13_190_000,
        utxo: { inputs: [io(MINSWAP_V2_ORDER), io(MINSWAP_V2_POOL)], outputs: [io(MINSWAP_V2_POOL), io(OWN_PAYMENT)] },
      });
      expect(isDexOrderCancellation(item)).toBe(false);
      expect(buildTxTitle(item, ctx, t)).toBe('transactions.dexOrder');
    });

    it('recognises Minswap orders by script, whatever stake key they carry, and V1 orders too', () => {
      const staked = tx({ utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io(MINSWAP_V2_ORDER_STAKED)] } });
      expect(isMinswap(staked)).toBe(true);
      // That address is one wallet's own Minswap order address, not a DexHunter contract
      expect(tagKeys(staked)).not.toContain('dexhunter');
      expect(isMinswap(tx({ utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io(MINSWAP_V1_MARKET_ORDER)] } }))).toBe(true);
    });

    it('tags SteelSwap from its own 674 message only', () => {
      const item = tx({
        utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io(MINSWAP_V2_ORDER)] },
        body: { outputs: [] },
        ...metadata('CarDeM', 'SteelSwap: 1.18.0'),
      });
      expect(tagKeys(item)).toEqual(expect.arrayContaining(['steelswap', 'minswap']));
      expect(tagKeys(item)).not.toContain('geroswap');
    });
  });

  it('tags a DUST registration by its output to the mapping validator', () => {
    const item = tx({ utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io('addr_test1dustvalidator')] } });
    expect(buildTxTags(item, ctx, t, classifyTxKind(item, ctx)).map((tag) => tag.key)).toContain('dust');
  });

  it('does not take the mainnet DUST mapping validator for a Minswap pool', () => {
    // The validator's real mainnet address; it was once mislabelled as the Minswap V2 pool
    const item = tx({
      ada: -1_990_000, sentAmount: 1_990_000,
      utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io('addr1w9e7ft4rrdd4rkdseguxr9hudfxyytm5ckh2qy0yhz7lfeg9lvhq7')] },
    });
    expect(isMinswap(item)).toBe(false);
    expect(isDexTransaction(item)).toBe(false);
    expect(buildTxTitle(item, ctx, t)).toBe('transactions.sentFunds');
  });

  it('detects a Minswap V2 pool operation by the published pool address', () => {
    const pool = 'addr1z84q0denmyep98ph3tmzwsmw0j7zau9ljmsqx6a4rvaau66j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq777e2a';
    const item = tx({ utxo: { inputs: [io(pool), io(OWN_PAYMENT)], outputs: [io(pool), io(OWN_CHANGE)] } });
    expect(isMinswap(item)).toBe(true);
    expect(buildTxTitle(item, ctx, t)).toBe('transactions.dexOrder');
  });

  it('types certificate transactions as staking or governance', () => {
    const delegation = tx({
      body: { outputs: [], certificates: [{ __typename: Cardano.CertificateType.StakeDelegation, poolId: 'pool1' }] },
    });
    expect(classifyTxKind(delegation, ctx)).toBe('stake');
    expect(buildTxTitle(delegation, ctx, t)).toBe('transactions.delegatingToPool');

    const vote = tx({
      ada: -180000, sentAmount: 180000,
      utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io(OWN_CHANGE)] },
      body: { outputs: [], certificates: [{ __typename: Cardano.CertificateType.VoteDelegation }] },
    });
    const kind = classifyTxKind(vote, ctx);
    expect(kind).toBe('vote');
    expect(buildTxTitle(vote, ctx, t)).toBe('transactions.voteDelegation');
    // Certificates title it, so the all-own-address shape still earns the Internal tag
    expect(buildTxTags(vote, ctx, t, kind).map((tag) => tag.key)).toContain('internal');
  });

  it('marks a pending transaction pending, and failed once it is over an hour old', () => {
    const now = Date.now();
    const fresh = tx({ pending: true, tx_timestamp: Math.floor(now / 1000) - 30 });
    expect(classifyTxKind(fresh, ctx, now)).toBe('pending');
    expect(isPendingTooLong(fresh, now)).toBe(false);

    const stale = tx({ pending: true, tx_timestamp: Math.floor(now / 1000) - 2 * 3600 });
    expect(isPendingTooLong(stale, now)).toBe(true);
    expect(classifyTxKind(stale, ctx, now)).toBe('failed');
  });

  it('titles Bitcoin records by their type field', () => {
    expect(buildTxTitle(tx({ type: 'self' }), ctx, t)).toBe('transactions.selfTransfer');
    expect(buildTxTitle(tx({ type: 'receive' }), ctx, t)).toBe('transactions.receivedFunds');
  });
});

describe('withMinusSign', () => {
  it('swaps the leading hyphen for a real minus sign and leaves positives alone', () => {
    expect(withMinusSign('- ₳1.00')).toBe('− ₳1.00');
    expect(withMinusSign('+ ₳1.00')).toBe('+ ₳1.00');
  });
});
