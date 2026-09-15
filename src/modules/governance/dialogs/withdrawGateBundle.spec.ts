import { describe, it, expect, vi } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import {
  buildAbstainWithdrawalBundle,
  buildAbstainWithdrawalTx,
  isAlwaysAbstainDelegation,
  type BuildTxFn,
} from './withdrawGateBundle';

const STAKE_KEY_HASH = '00'.repeat(28);
const STAKE_ADDRESS = 'stake1uyehkck0lajq8gr28t9uxnuvgcqrc6ry3z7ashvvfz9c4qs7cmnwj';

function bundleInput(overrides: Partial<Parameters<typeof buildAbstainWithdrawalBundle>[0]> = {}) {
  return {
    stakeKeyHash: STAKE_KEY_HASH,
    stakeAddress: STAKE_ADDRESS,
    withdrawableAmount: '412390000',
    registered: true,
    ...overrides,
  };
}

describe('buildAbstainWithdrawalBundle', () => {
  it('bundles the always-abstain certificate WITH the withdrawal', () => {
    const bundle = buildAbstainWithdrawalBundle(bundleInput());

    // The whole point of the gate's second path: one body, both things.
    expect(bundle.certificates).toHaveLength(1);
    expect(isAlwaysAbstainDelegation(bundle.certificates[0])).toBe(true);
    expect(bundle.withdrawals).toEqual([
      { stakeAddress: STAKE_ADDRESS, quantity: 412390000n },
    ]);
  });

  it('delegates the vote, never the stake', () => {
    const [certificate] = buildAbstainWithdrawalBundle(bundleInput()).certificates;
    expect(certificate.__typename).toBe(Cardano.CertificateType.VoteDelegation);
    expect(certificate.__typename).not.toBe(Cardano.CertificateType.StakeVoteDelegation);
    expect((certificate as Cardano.VoteDelegationCertificate).stakeCredential).toEqual({
      type: Cardano.CredentialType.KeyHash,
      hash: STAKE_KEY_HASH,
    });
  });

  it('keeps a reward balance beyond Number.MAX_SAFE_INTEGER exact', () => {
    const huge = '90071992547409910';
    expect(Number(huge).toString()).not.toBe(huge); // the bug this guards against

    const bundle = buildAbstainWithdrawalBundle(bundleInput({ withdrawableAmount: huge }));
    expect(bundle.withdrawals[0].quantity).toBe(90071992547409910n);
  });

  it('attaches no deposit and no registration when the key is already registered', () => {
    const bundle = buildAbstainWithdrawalBundle(bundleInput({ stakeKeyDeposit: '2000000' }));
    expect(bundle.implicitCoin).toBe(0n);
    expect(
      bundle.certificates.some(c => c.__typename === Cardano.CertificateType.Registration),
    ).toBe(false);
  });

  it('registers the key first, funded by the deposit, when it is not registered', () => {
    const bundle = buildAbstainWithdrawalBundle(
      bundleInput({ registered: false, stakeKeyDeposit: '2000000' }),
    );

    expect(bundle.certificates).toHaveLength(2);
    // Registration must precede the delegation it enables.
    expect(bundle.certificates[0].__typename).toBe(Cardano.CertificateType.Registration);
    expect(isAlwaysAbstainDelegation(bundle.certificates[1])).toBe(true);
    expect(bundle.implicitCoin).toBe(2000000n);
    // Separate certificates, not the combined Conway form Trezor cannot sign.
    expect(
      bundle.certificates.some(
        c => c.__typename === Cardano.CertificateType.VoteRegistrationDelegation,
      ),
    ).toBe(false);
  });

  it('still takes the position when there is nothing to withdraw', () => {
    for (const amount of ['0', '', null, undefined]) {
      const bundle = buildAbstainWithdrawalBundle(bundleInput({ withdrawableAmount: amount }));
      expect(bundle.withdrawals).toEqual([]);
      expect(isAlwaysAbstainDelegation(bundle.certificates[0])).toBe(true);
    }
  });

  it('treats an unparseable balance as nothing to withdraw rather than throwing', () => {
    const bundle = buildAbstainWithdrawalBundle(bundleInput({ withdrawableAmount: '4.12 ADA' }));
    expect(bundle.withdrawals).toEqual([]);
  });
});

describe('buildAbstainWithdrawalTx', () => {
  it('hands the builder ONE body carrying both the certificate and the withdrawal', async () => {
    // Stands in for buildCardanoTransaction, which copies `certificates` and
    // `withdrawals` straight onto the body (src/shared/utils/builder.ts).
    const buildTx: BuildTxFn = vi.fn(async params => ({
      body: {
        certificates: params['certificates'],
        withdrawals: params['withdrawals'],
        fee: 179000n,
      },
    }) as unknown as Cardano.Tx);

    const tx = await buildAbstainWithdrawalTx(
      bundleInput(),
      {
        utxos: [],
        epochParams: { stakeKeyDeposit: 2000000 },
        changeAddress: 'addr1_change',
        tip: { slot: 1 },
        walletContext: { keys: null, stakeAddress: STAKE_ADDRESS, accountIndex: 0 },
      },
      buildTx,
    );

    expect(buildTx).toHaveBeenCalledTimes(1);
    const body = tx.body as unknown as {
      certificates: Cardano.Certificate[];
      withdrawals: Cardano.Withdrawal[];
    };
    expect(body.certificates.some(isAlwaysAbstainDelegation)).toBe(true);
    expect(body.withdrawals[0].quantity).toBe(412390000n);
  });

  it('passes the registration deposit through as implicitCoin', async () => {
    const seen: Parameters<BuildTxFn>[0][] = [];
    const buildTx: BuildTxFn = async params => {
      seen.push(params);
      return { body: { fee: 0n } } as unknown as Cardano.Tx;
    };

    await buildAbstainWithdrawalTx(
      bundleInput({ registered: false, stakeKeyDeposit: '2000000' }),
      { utxos: [], epochParams: {}, changeAddress: 'addr1_change', tip: {} },
      buildTx,
    );

    expect(seen[0]).toMatchObject({ implicitCoin: 2000000n });
  });
});

describe('isAlwaysAbstainDelegation', () => {
  it('does not mistake a no-confidence delegation for abstain', () => {
    const certificate = {
      __typename: Cardano.CertificateType.VoteDelegation,
      stakeCredential: { type: Cardano.CredentialType.KeyHash, hash: STAKE_KEY_HASH },
      dRep: { __typename: 'AlwaysNoConfidence' },
    } as unknown as Cardano.Certificate;
    expect(isAlwaysAbstainDelegation(certificate)).toBe(false);
  });

  it('does not mistake a delegation to a real DRep for abstain', () => {
    const certificate = {
      __typename: Cardano.CertificateType.VoteDelegation,
      stakeCredential: { type: Cardano.CredentialType.KeyHash, hash: STAKE_KEY_HASH },
      dRep: { type: Cardano.CredentialType.KeyHash, hash: '11'.repeat(28) },
    } as unknown as Cardano.Certificate;
    expect(isAlwaysAbstainDelegation(certificate)).toBe(false);
  });
});
