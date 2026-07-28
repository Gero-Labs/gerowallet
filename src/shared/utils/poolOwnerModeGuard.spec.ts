import { describe, it, expect } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { assertOwnerModeShape } from './poolOwnerModeGuard';

const HOT = 'addr1_hot';
const LEDGER = 'addr1_ledger';

const poolRegCert = { __typename: Cardano.CertificateType.PoolRegistration } as unknown as Cardano.Certificate;
const stakeDelegationCert = { __typename: Cardano.CertificateType.StakeDelegation } as unknown as Cardano.Certificate;

const address = (bech32: string) => bech32 as unknown as Cardano.PaymentAddress;

const baseTx = (over: Partial<Cardano.TxBody> = {}): Cardano.Tx => ({
  body: {
    inputs: [{ txId: 'tx1' as unknown as Cardano.TransactionId, index: 0 }],
    outputs: [{ address: address(HOT), value: { coins: 0n } }],
    certificates: [poolRegCert],
    withdrawals: undefined,
    mint: undefined,
    ...over,
  },
} as unknown as Cardano.Tx);

describe('assertOwnerModeShape', () => {
  const ledgerSet = new Set([LEDGER]);
  const hotInputAddresses = [HOT];

  it('passes for a well-formed owner-mode tx (hot input + hot change + single pool-reg cert)', () => {
    expect(() => assertOwnerModeShape(baseTx(), ledgerSet, hotInputAddresses)).not.toThrow();
  });
  it('rejects a device-owned (Ledger) input', () => {
    expect(() => assertOwnerModeShape(baseTx(), ledgerSet, [LEDGER]))
      .toThrow('owner-mode/device-input');
  });
  it('rejects a device-owned (Ledger) output', () => {
    expect(() => assertOwnerModeShape(baseTx({ outputs: [{ address: address(LEDGER), value: { coins: 0n } }] }), ledgerSet, hotInputAddresses))
      .toThrow('owner-mode/device-output');
  });
  it('rejects more than one certificate', () => {
    expect(() => assertOwnerModeShape(baseTx({ certificates: [poolRegCert, poolRegCert] }), ledgerSet, hotInputAddresses))
      .toThrow('owner-mode/multiple-certs');
  });
  it('rejects a non-pool-reg certificate', () => {
    expect(() => assertOwnerModeShape(baseTx({ certificates: [stakeDelegationCert] }), ledgerSet, hotInputAddresses))
      .toThrow('owner-mode/not-pool-reg');
  });
  it('rejects withdrawals', () => {
    expect(() => assertOwnerModeShape(
      baseTx({ withdrawals: [{}] as unknown as Cardano.Withdrawal[] }), ledgerSet, hotInputAddresses))
      .toThrow('owner-mode/withdrawals');
  });
  it('rejects a mint', () => {
    expect(() => assertOwnerModeShape(
      baseTx({ mint: new Map([['someAssetId' as unknown as Cardano.AssetId, 1n]]) }), ledgerSet, hotInputAddresses))
      .toThrow('owner-mode/mint');
  });
});
