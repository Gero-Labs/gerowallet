import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', () => ({
  default: { create: () => ({ post, interceptors: { response: { use: () => undefined } } }) },
  AxiosError: class AxiosError extends Error {},
}));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));

const { nexusTxApi } = await import('./nexus-tx-api');

const net = Cardano.NetworkId.Testnet;
const keyCred = (c: string) => ({ type: Cardano.CredentialType.KeyHash, hash: c.repeat(56) as Cardano.Credential['hash'] });
const base = (pay: string, stake: string) =>
  Cardano.BaseAddress.fromCredentials(net, keyCred(pay), keyCred(stake)).toAddress().toBech32();
const OWN = base('a', 'b');
const RECIPIENT = base('d', 'e');
const ATTACKER = base('f', 'f');
const STAKE = Cardano.RewardAddress.fromCredentials(net, keyCred('b')).toAddress().toBech32();
const POOL = Cardano.PoolId.fromKeyHash('2'.repeat(56) as never);
const OTHER_POOL = Cardano.PoolId.fromKeyHash('3'.repeat(56) as never);
const TX = '9'.repeat(64);
const UTXO = { txHash: TX, outputIndex: 0, address: OWN, lovelace: '100000000' };

/** Real transaction CBOR, as Nexus returns it. */
function cbor(body: Partial<Cardano.TxBody>): string {
  const core = {
    id: TX,
    body: { inputs: [{ txId: TX, index: 0 }], outputs: [], fee: 200_000n, ...body },
    witness: { signatures: new Map() },
  } as unknown as Cardano.Tx;
  return Serialization.Transaction.fromCore(core).toCbor();
}
const out = (address: string, coins: bigint) => ({ address: address as Cardano.PaymentAddress, value: { coins } });
const nexusReturns = (txCbor: string) => post.mockResolvedValueOnce({ data: { tx_cbor: txCbor, tx_hash: TX } });

describe('nexusTxApi refuses a built transaction that differs from the request', () => {
  beforeEach(() => post.mockReset());

  const transfer = { outputs: [{ address: RECIPIENT, lovelace: '5000000' }], changeAddress: OWN, utxos: [UTXO] };

  it('returns a transfer that is exactly what was asked for', async () => {
    const txCbor = cbor({ outputs: [out(RECIPIENT, 5_000_000n), out(OWN, 94_800_000n)] });
    nexusReturns(txCbor);
    await expect(nexusTxApi.buildTransferTx(transfer, 'Preprod')).resolves.toMatchObject({ tx_cbor: txCbor });
  });

  it('refuses a transfer with an extra output to someone else', async () => {
    nexusReturns(cbor({ outputs: [out(RECIPIENT, 5_000_000n), out(ATTACKER, 90_000_000n), out(OWN, 4_800_000n)] }));
    await expect(nexusTxApi.buildTransferTx(transfer, 'Preprod'))
      .rejects.toMatchObject({ name: 'TxIntentMismatchError', message: 'txGuard.builtTxMismatch', violations: ['foreignOutput'] });
  });

  it('refuses a transfer that pays a different address', async () => {
    nexusReturns(cbor({ outputs: [out(ATTACKER, 5_000_000n), out(OWN, 94_800_000n)] }));
    await expect(nexusTxApi.buildTransferTx(transfer, 'Preprod')).rejects.toMatchObject({ name: 'TxIntentMismatchError' });
  });

  it('refuses a transfer carrying a delegation certificate', async () => {
    nexusReturns(cbor({
      outputs: [out(RECIPIENT, 5_000_000n), out(OWN, 94_800_000n)],
      certificates: [{ __typename: Cardano.CertificateType.StakeDelegation, stakeCredential: keyCred('b'), poolId: OTHER_POOL }],
    }));
    await expect(nexusTxApi.buildTransferTx(transfer, 'Preprod')).rejects.toMatchObject({ violations: ['unexpectedCertificate'] });
  });

  it('refuses a withdrawal with an output to someone else', async () => {
    nexusReturns(cbor({ outputs: [out(ATTACKER, 99_000_000n)], withdrawals: [{ stakeAddress: STAKE as Cardano.RewardAccount, quantity: 1_000_000n }] }));
    await expect(nexusTxApi.buildWithdrawalTx({ stakeAddress: STAKE, amount: '1000000', changeAddress: OWN, utxos: [UTXO] }, 'Preprod'))
      .rejects.toMatchObject({ violations: ['foreignOutput'] });
  });

  it('accepts a delegation to the chosen pool and refuses one to another pool', async () => {
    const request = { stakeAddress: STAKE, poolId: POOL, changeAddress: OWN, utxos: [UTXO] };
    const deleg = (pool: Cardano.PoolId) => cbor({
      outputs: [out(OWN, 99_800_000n)],
      certificates: [{ __typename: Cardano.CertificateType.StakeDelegation, stakeCredential: keyCred('b'), poolId: pool }],
    });
    nexusReturns(deleg(POOL));
    await expect(nexusTxApi.buildDelegationTx(request, 'Preprod')).resolves.toBeTruthy();
    nexusReturns(deleg(OTHER_POOL));
    await expect(nexusTxApi.buildDelegationTx(request, 'Preprod')).rejects.toMatchObject({ violations: ['unexpectedCertificate'] });
  });

  it('does not take an address in the UTxO list as the wallet\'s change', async () => {
    // gero-sync lists a UTxO at the attacker's address; Nexus pays the attacker as "change".
    const poisoned = { ...transfer, utxos: [UTXO, { txHash: TX, outputIndex: 1, address: ATTACKER, lovelace: '1000000' }] };
    nexusReturns(cbor({ outputs: [out(RECIPIENT, 5_000_000n), out(ATTACKER, 94_800_000n)] }));
    await expect(nexusTxApi.buildTransferTx(poisoned, 'Preprod')).rejects.toMatchObject({ violations: ['foreignOutput'] });
  });

  it('refuses CBOR it cannot decode, and leaves an empty build to the caller', async () => {
    post.mockResolvedValueOnce({ data: { tx_cbor: 'deadbeef', tx_hash: TX } });
    await expect(nexusTxApi.buildTransferTx(transfer, 'Preprod')).rejects.toMatchObject({ name: 'TxIntentMismatchError' });
    post.mockResolvedValueOnce({ data: { tx_cbor: '', tx_hash: '' } });
    await expect(nexusTxApi.buildTransferTx(transfer, 'Preprod')).resolves.toMatchObject({ tx_cbor: '' });
  });
});
