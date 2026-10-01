import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { buildTxApprovalSummary, formatLovelace, type ApprovalContext } from './txApprovalSummary';

const OWN_ADDR = 'addr_test1qpdmx56dml9qtej5vxhejju492w9pfv7j9270wjh0pfe9hdzqxa4r35qhuqx29n693k4gqukhk3lfw37xkp4egvh6raq4d4rzj';
const CHANGE_ADDR = 'addr_test1qqy44ytv354nqrs0f3hfsecj45w623wgqskt7nx84qd8v6lgxeg90kc8dfzpcg9xl8nuhvdesgq5cz6ejq83vk60hpns2c2kwh';
const EXT_ADDR = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';
const MAINNET_ADDR = 'addr1q8xf2scs38ttgmhmgpuxv73fcckwa65r56rptlhv3akdyty0wdhwf8eevhfg8cxc6r70ncprncasd2x87x7q9ezxe95q37pkan';
const OWN_REWARD = 'stake_test1uqxk54m7j3q6mrkevcunryrwf4p7e68c93cjk8gzxkhlkpsxyz';
const FOREIGN_REWARD = 'stake_test1uq3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsw4fsh7';
const POOL = 'pool12yscr8j3zs34ewxrwlk0p2w5uvgcnrzywpp78ddjsj8kxd530f9';

const OWN_STAKE_HASH = 'a'.repeat(56);
const FOREIGN_STAKE_HASH = 'b'.repeat(56);
const OWN_DREP_HASH = 'c'.repeat(56);
const FOREIGN_DREP_HASH = 'd'.repeat(56);
const OWN_PAYMENT_HASH = 'e'.repeat(56);
const TX_ID = '0'.repeat(63) + '1';

const ctx = (over: Partial<ApprovalContext> = {}): ApprovalContext => ({
  paymentAddresses: new Set([OWN_ADDR]),
  changeAddresses: new Set([CHANGE_ADDR]),
  ownPaymentKeyHashes: new Set([OWN_PAYMENT_HASH]),
  ownStakeKeyHashes: new Set([OWN_STAKE_HASH]),
  ownRewardAccounts: new Set([OWN_REWARD]),
  ownDrepKeyHashes: new Set([OWN_DREP_HASH]),
  ownCcHotKeyHashes: new Set(),
  walletNetworkId: Cardano.NetworkId.Testnet,
  resolveAsset: () => ({ name: 'Token', decimals: 0 }),
  ...over,
});

const out = (address: string, coins: bigint) => ({ address, value: { coins } });
const tx = (body: Record<string, unknown>) =>
  ({ id: TX_ID, body: { inputs: [], outputs: [], fee: 170_000n, ...body }, witness: {} }) as unknown as Cardano.Tx;
const keyCred = (hash: string) => ({ type: Cardano.CredentialType.KeyHash, hash });

describe('buildTxApprovalSummary', () => {
  it('classifies outputs and computes totals in bigint', () => {
    const s = buildTxApprovalSummary(tx({ outputs: [out(EXT_ADDR, 5_000_000n), out(CHANGE_ADDR, 1_234_567n)] }), ctx());
    expect(s.outputs.map(o => o.kind)).toEqual(['external', 'change']);
    expect(s.totals.totalSendingAda).toBe('5.00');
    expect(s.totals.youPayAda).toBe('5.17');
    expect(s.isInternal).toBe(false);
  });

  it('shows every vote, and marks only the wallet’s own DRep voter as its own', () => {
    const s = buildTxApprovalSummary(tx({
      outputs: [out(CHANGE_ADDR, 2_000_000n)],
      votingProcedures: [
        { voter: { __typename: Cardano.VoterType.dRepKeyHash, credential: keyCred(OWN_DREP_HASH) },
          votes: [{ actionId: { id: TX_ID, actionIndex: 0 }, votingProcedure: { vote: Cardano.Vote.yes, anchor: null } }] },
        { voter: { __typename: Cardano.VoterType.dRepKeyHash, credential: keyCred(FOREIGN_DREP_HASH) },
          votes: [{ actionId: { id: TX_ID, actionIndex: 3 }, votingProcedure: { vote: Cardano.Vote.no, anchor: null } }] },
      ],
    }), ctx());
    expect(s.votes).toEqual([
      { voterType: Cardano.VoterType.dRepKeyHash, voterHash: OWN_DREP_HASH, isOwnVoter: true, actions: [{ txId: TX_ID, index: 0, vote: 'yes' }] },
      { voterType: Cardano.VoterType.dRepKeyHash, voterHash: FOREIGN_DREP_HASH, isOwnVoter: false, actions: [{ txId: TX_ID, index: 3, vote: 'no' }] },
    ]);
    // A vote-only tx whose outputs all return to the wallet is NOT an internal transfer.
    expect(s.isInternal).toBe(false);
  });

  it('shows proposals with their deposit and return account', () => {
    const s = buildTxApprovalSummary(tx({
      proposalProcedures: [{ deposit: 100_000_000_000n, rewardAccount: FOREIGN_REWARD, governanceAction: { __typename: Cardano.GovernanceActionType.info_action }, anchor: {} }],
    }), ctx());
    expect(s.proposals).toEqual([{ actionType: 'info_action', depositAda: '100000.00', rewardAccount: FOREIGN_REWARD, isOwnRewardAccount: false }]);
  });

  it('names the exact DRep and full pool id, and flags a foreign stake credential', () => {
    const s = buildTxApprovalSummary(tx({
      certificates: [
        { __typename: Cardano.CertificateType.VoteDelegation, stakeCredential: keyCred(OWN_STAKE_HASH), dRep: keyCred(FOREIGN_DREP_HASH) },
        { __typename: Cardano.CertificateType.StakeDelegation, stakeCredential: keyCred(FOREIGN_STAKE_HASH), poolId: POOL },
        { __typename: Cardano.CertificateType.VoteDelegation, stakeCredential: keyCred(OWN_STAKE_HASH), dRep: { __typename: 'AlwaysAbstain' } },
      ],
    }), ctx());
    expect(s.certificates[0].drepId).toBe(String(Cardano.DRepID.cip129FromCredential(keyCred(FOREIGN_DREP_HASH) as Cardano.Credential)));
    expect(s.certificates[0].stakeCredentialIsOwn).toBe(true);
    expect(s.certificates[1].poolId).toBe(POOL);
    expect(s.certificates[1].stakeCredentialIsOwn).toBe(false);
    expect(s.certificates[2].drepSentinel).toBe('alwaysAbstain');
    expect(s.hasForeignStakeCertificate).toBe(true);
  });

  it('lists withdrawals per account; only the wallet’s own offset what it pays', () => {
    const s = buildTxApprovalSummary(tx({
      outputs: [out(EXT_ADDR, 10_000_000n)],
      withdrawals: [
        { stakeAddress: OWN_REWARD, quantity: 1_000_000n },
        { stakeAddress: FOREIGN_REWARD, quantity: 9_000_000n },
      ],
    }), ctx());
    expect(s.withdrawals.map(w => [w.rewardAccount, w.isOwn])).toEqual([[OWN_REWARD, true], [FOREIGN_REWARD, false]]);
    expect(s.totals.ownWithdrawalAda).toBe('1.00');
    // 10 sent + 0.17 fee - 1 own withdrawal (the foreign 9 ADA never offsets the user's cost)
    expect(s.totals.youPayAda).toBe('9.17');
  });

  it('shows collateral return, total collateral, reference inputs, required signers and validity start', () => {
    const s = buildTxApprovalSummary(tx({
      collaterals: [{ txId: TX_ID, index: 0 }],
      collateralReturn: out(EXT_ADDR, 4_000_000n),
      totalCollateral: 5_000_000n,
      referenceInputs: [{ txId: TX_ID, index: 1 }, { txId: TX_ID, index: 2 }],
      requiredExtraSignatures: [OWN_PAYMENT_HASH, 'f'.repeat(56)],
      validityInterval: { invalidBefore: 1000, invalidHereafter: 2000 },
    }), ctx());
    expect(s.collateralReturn?.kind).toBe('external');
    expect(s.collateralReturn?.ada).toBe('4.00');
    expect(s.totalCollateralAda).toBe('5.00');
    expect(s.referenceInputCount).toBe(2);
    expect(s.requiredSigners).toEqual([{ keyHash: OWN_PAYMENT_HASH, isOwn: true }, { keyHash: 'f'.repeat(56), isOwn: false }]);
    expect(s.validityStartSlot).toBe(1000);
    expect(s.ttlSlot).toBe(2000);
  });

  it('flags a body network id or any output (own included) on another network', () => {
    expect(buildTxApprovalSummary(tx({ networkId: Cardano.NetworkId.Mainnet }), ctx()).bodyNetworkMismatch).toBe(true);
    expect(buildTxApprovalSummary(tx({ networkId: Cardano.NetworkId.Testnet }), ctx()).bodyNetworkMismatch).toBe(false);
    expect(buildTxApprovalSummary(tx({ outputs: [out(MAINNET_ADDR, 1n)] }), ctx()).outputNetworkMismatch).toBe(true);
    expect(buildTxApprovalSummary(tx({ collateralReturn: out(MAINNET_ADDR, 1n) }), ctx()).outputNetworkMismatch).toBe(true);
    expect(buildTxApprovalSummary(tx({ outputs: [out(EXT_ADDR, 1n)] }), ctx()).outputNetworkMismatch).toBe(false);
  });

  it('treats an all-own transfer with nothing else as internal', () => {
    const s = buildTxApprovalSummary(tx({ outputs: [out(OWN_ADDR, 3_000_000n)] }), ctx());
    expect(s.isInternal).toBe(true);
    expect(s.totals.youPayAda).toBe('0.17');
  });
});

describe('formatLovelace', () => {
  it('formats with bigint precision and at least two decimals', () => {
    expect(formatLovelace(0n)).toBe('0.00');
    expect(formatLovelace(1_500_000n)).toBe('1.50');
    expect(formatLovelace(1_234_567n)).toBe('1.234567');
    expect(formatLovelace(45_000_000_000_000_001n)).toBe('45000000000.000001');
  });
});
