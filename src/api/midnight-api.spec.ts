import { describe, it, expect } from 'vitest';
import { convertDustStatus } from './midnight-api';

describe('convertDustStatus', () => {
  // Captured shape of a real Nexus `dust/status` response (mainnet, verified
  // 2026-07-25 — see docs/superpowers/plans/2026-07-25-dust-battery-path-b.md).
  // The wallet-side conversion from this snake_case wire payload to the
  // camelCase DTO was missing entirely for a full release: every hyphenated
  // field (`dust_address`, `night_balance`, `generation_rate`,
  // `max_capacity`, `current_capacity`, `registration_utxo_tx_hash`,
  // `registration_utxo_output_index`) silently came through as `undefined`,
  // which broke stake matching (useDustSources.ts) and the
  // registrationOutpoint() lookup that deregister()/migrateDustAddressToOwn()
  // depend on. This test pins the conversion against a real captured payload
  // so that regression can't ship undetected again.
  it('converts a registered wire payload to the camelCase DTO', () => {
    const wire = {
      cardano_reward_address: 'stake1u86ndjr6s9vpkpzdtu4fdzlznj4gnx9cet2fcekjuuudntgjprfc5',
      dust_address: 'mn_dust1wvlhuqzu0a2kqnchn33cf2qgsldzw0tl7083zwgzlufmaawr05u56etug5q',
      registered: true,
      night_balance: '1076061710',
      generation_rate: '8895802156570',
      max_capacity: '5380308500000000000',
      current_capacity: '3957088700000000000',
      registration_utxo_tx_hash: '527e9a33aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      registration_utxo_output_index: 0,
    };

    expect(convertDustStatus(wire)).toEqual({
      cardanoRewardAddress: 'stake1u86ndjr6s9vpkpzdtu4fdzlznj4gnx9cet2fcekjuuudntgjprfc5',
      dustAddress: 'mn_dust1wvlhuqzu0a2kqnchn33cf2qgsldzw0tl7083zwgzlufmaawr05u56etug5q',
      registered: true,
      nightBalance: '1076061710',
      generationRate: '8895802156570',
      maxCapacity: '5380308500000000000',
      currentCapacity: '3957088700000000000',
      registrationUtxoTxHash: '527e9a33aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      registrationUtxoOutputIndex: 0,
    });
  });

  it('normalizes an unregistered payload with null/missing optional fields', () => {
    const wire = {
      cardano_reward_address: 'stake1u9xyz0000000000000000000000000000000000000000000000',
      dust_address: null,
      registered: false,
      // night_balance / generation_rate / max_capacity / current_capacity /
      // registration_utxo_tx_hash / registration_utxo_output_index all
      // absent — Nexus omits them rather than sending explicit nulls.
    };

    expect(convertDustStatus(wire)).toStrictEqual({
      cardanoRewardAddress: 'stake1u9xyz0000000000000000000000000000000000000000000000',
      dustAddress: null,
      registered: false,
      nightBalance: undefined,
      generationRate: undefined,
      maxCapacity: undefined,
      currentCapacity: undefined,
      registrationUtxoTxHash: null,
      registrationUtxoOutputIndex: null,
    });
  });
});
