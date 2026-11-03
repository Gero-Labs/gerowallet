import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import {
  approvalContextFromKeys,
  approvalMarketContext,
  buildTxApprovalSummary,
  formatLovelace,
  type ApprovalContext,
} from './txApprovalSummary';

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
  ownListings: new Map(),
  listingScriptHashes: new Set(),
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

  it('shows a treasury donation, counts it in what the user pays and never calls the tx internal', () => {
    const s = buildTxApprovalSummary(tx({ outputs: [out(CHANGE_ADDR, 2_000_000n)], donation: 50_000_000n }), ctx());
    expect(s.treasuryDonationAda).toBe('50.00');
    expect(s.totals.youPayAda).toBe('50.17');
    expect(s.isInternal).toBe(false);
    expect(buildTxApprovalSummary(tx({ outputs: [out(CHANGE_ADDR, 2_000_000n)] }), ctx()).treasuryDonationAda).toBeNull();
  });

  it('reads the donation from real CBOR (body field 22), not only from a core object', () => {
    const core = tx({ inputs: [{ txId: TX_ID, index: 0 }], outputs: [out(CHANGE_ADDR, 2_000_000n)], donation: 7_000_000n });
    const fromCbor = Serialization.Transaction.fromCbor(Serialization.Transaction.fromCore(core).toCbor()).toCore();
    expect(buildTxApprovalSummary(fromCbor, ctx()).treasuryDonationAda).toBe('7.00');
  });

  it('treats an all-own transfer with nothing else as internal', () => {
    const s = buildTxApprovalSummary(tx({ outputs: [out(OWN_ADDR, 3_000_000n)] }), ctx());
    expect(s.isInternal).toBe(true);
    expect(s.totals.youPayAda).toBe('0.17');
  });
});

describe('buildTxApprovalSummary: what actually leaves the wallet', () => {
  const ownUtxo = (index: number, coins: bigint) =>
    [{ txId: TX_ID, index }, { address: OWN_ADDR, value: { coins } }] as unknown as Cardano.Utxo;
  const poolRegistration = (rewardAccount: string) => ({
    __typename: Cardano.CertificateType.PoolRegistration,
    poolParameters: { id: POOL, rewardAccount, owners: [], pledge: 0n, cost: 340_000_000n, margin: { numerator: 0, denominator: 1 }, relays: [], vrf: '0'.repeat(64) },
  });
  const deposits = { stakeKey: 2_000_000n, pool: 500_000_000n };

  it('counts a pool deposit refunded to someone else, and asks for an acknowledgement', () => {
    // 600 ADA in, 99.83 ADA back as change: the 500 ADA deposit and the fee leave the wallet.
    const s = buildTxApprovalSummary(tx({
      inputs: [{ txId: TX_ID, index: 0 }],
      outputs: [out(CHANGE_ADDR, 99_830_000n)],
      certificates: [poolRegistration(FOREIGN_REWARD)],
    }), ctx({ ownUtxos: [ownUtxo(0, 600_000_000n)], deposits }));
    expect(s.totals.youPayAda).toBe('500.17');
    expect(s.certificates[0]).toMatchObject({ poolId: POOL, depositAda: '500.00', depositDirection: 'paid', refundAccount: FOREIGN_REWARD, refundIsOwn: false });
    expect(s.requiresForeignValueAck).toBe(true);
  });

  it('includes deposits in the estimate when the wallet’s UTxOs are unknown', () => {
    const s = buildTxApprovalSummary(tx({ outputs: [out(CHANGE_ADDR, 1n)], certificates: [poolRegistration(FOREIGN_REWARD)] }), ctx({ deposits }));
    expect(s.totals.youPayAda).toBe('500.17');
    // The wallet's own pool: no acknowledgement needed.
    expect(buildTxApprovalSummary(tx({ certificates: [poolRegistration(OWN_REWARD)] }), ctx({ deposits })).requiresForeignValueAck).toBe(false);
  });

  it('flags a DRep registration for someone else’s DRep and counts its deposit', () => {
    const reg = (hash: string) => ({ __typename: Cardano.CertificateType.RegisterDelegateRepresentative, dRepCredential: keyCred(hash), deposit: 500_000_000n, anchor: null });
    const foreign = buildTxApprovalSummary(tx({ certificates: [reg(FOREIGN_DREP_HASH)] }), ctx());
    expect(foreign.certificates[0].refundIsOwn).toBe(false);
    expect(foreign.totals.youPayAda).toBe('500.17');
    expect(foreign.requiresForeignValueAck).toBe(true);
    expect(buildTxApprovalSummary(tx({ certificates: [reg(OWN_DREP_HASH)] }), ctx()).requiresForeignValueAck).toBe(false);
  });

  it('flags a governance proposal whose deposit is refunded to someone else', () => {
    const s = buildTxApprovalSummary(tx({
      proposalProcedures: [{ deposit: 100_000_000_000n, rewardAccount: FOREIGN_REWARD, governanceAction: { __typename: Cardano.GovernanceActionType.info_action }, anchor: {} }],
    }), ctx());
    expect(s.totals.youPayAda).toBe('100000.17');
    expect(s.requiresForeignValueAck).toBe(true);
  });

  it('shows all of the wallet’s collateral at risk when it returns to someone else', () => {
    const body = {
      inputs: [{ txId: TX_ID, index: 0 }],
      outputs: [out(CHANGE_ADDR, 9_830_000n)],
      collaterals: [{ txId: TX_ID, index: 1 }],
      totalCollateral: 1_000_000n,
    };
    const utxos = [ownUtxo(0, 10_000_000n), ownUtxo(1, 50_000_000n)];
    const foreign = buildTxApprovalSummary(tx({ ...body, collateralReturn: out(EXT_ADDR, 49_000_000n) }), ctx({ ownUtxos: utxos }));
    expect(foreign.collateralAtRiskAda).toBe('50.00');
    expect(foreign.requiresForeignValueAck).toBe(true);
    const own = buildTxApprovalSummary(tx({ ...body, collateralReturn: out(CHANGE_ADDR, 49_000_000n) }), ctx({ ownUtxos: utxos }));
    expect(own.collateralAtRiskAda).toBe('1.00');
    expect(own.requiresForeignValueAck).toBe(false);
  });

  it('does not ask about a collateral return when the collateral is not the wallet’s', () => {
    const s = buildTxApprovalSummary(tx({
      inputs: [{ txId: TX_ID, index: 0 }],
      outputs: [out(CHANGE_ADDR, 9_830_000n)],
      collaterals: [{ txId: '7'.repeat(64), index: 0 }],
      collateralReturn: out(EXT_ADDR, 4_000_000n),
    }), ctx({ ownUtxos: [ownUtxo(0, 10_000_000n)] }));
    expect(s.requiresForeignValueAck).toBe(false);
  });

  it('is exact with the wallet’s inputs known, and an estimate (named) with an unknown one', () => {
    const body = { inputs: [{ txId: TX_ID, index: 0 }, { txId: TX_ID, index: 1 }], outputs: [out(EXT_ADDR, 5_000_000n), out(CHANGE_ADDR, 14_830_000n)] };
    const exact = buildTxApprovalSummary(tx(body), ctx({ ownUtxos: [ownUtxo(0, 10_000_000n), ownUtxo(1, 10_000_000n)] }));
    expect(exact.totals.youPayAda).toBe('5.17');
    expect(exact.unmatchedInputCount).toBe(0);
    const partial = buildTxApprovalSummary(tx(body), ctx({ ownUtxos: [ownUtxo(0, 10_000_000n)] }));
    expect(partial.unmatchedInputCount).toBe(1);
    expect(partial.totals.youPayAda).toBe('5.17');
  });

  it('never counts a script input as the wallet’s or as unmatched', () => {
    // Buying from a script listing: the listing's 2 ADA input is not the wallet's.
    const s = buildTxApprovalSummary(tx({
      inputs: [{ txId: TX_ID, index: 0 }, { txId: '8'.repeat(64), index: 0 }],
      outputs: [out(EXT_ADDR, 12_000_000n), out(CHANGE_ADDR, 9_830_000n)],
    }), ctx({ ownUtxos: [ownUtxo(0, 20_000_000n)] }));
    expect(s.unmatchedInputCount).toBe(1);
    const withRedeemer = { ...tx({
      inputs: [{ txId: TX_ID, index: 0 }, { txId: '8'.repeat(64), index: 0 }],
      outputs: [out(EXT_ADDR, 12_000_000n), out(CHANGE_ADDR, 9_830_000n)],
    }), witness: { redeemers: [{ purpose: Cardano.RedeemerPurpose.spend, index: 1, data: {}, executionUnits: { memory: 0, steps: 0 } }] } } as unknown as Cardano.Tx;
    const listing = buildTxApprovalSummary(withRedeemer, ctx({ ownUtxos: [ownUtxo(0, 20_000_000n)] }));
    expect(listing.unmatchedInputCount).toBe(0);
    expect(listing.totals.youPayAda).toBe('10.17');
  });
});

// A dApp-built transaction that spends the wallet's own Gero listing, or puts something at a
// Gero listing script, is signable once the user approves it (dApp market pass), so its approval
// preview is the only protection: it must say so, from the wallet's own stored listings and the
// deployments' script hashes, never from anything the dApp supplied.
describe('buildTxApprovalSummary: Gero market listings', () => {
  const LISTING_SCRIPT = '9'.repeat(56);
  const OTHER_SCRIPT = '7'.repeat(56);
  const NFT = `${'b'.repeat(56)}${Buffer.from('Gero Cat #7').toString('hex')}`;
  const OTHER_NFT = `${'c'.repeat(56)}${Buffer.from('Gero Cat #8').toString('hex')}`;
  const LISTING_TX = 'a1'.repeat(32);
  const OTHER_LISTING_TX = 'b2'.repeat(32);
  const OWN_REF = `${LISTING_TX}#0`;
  const FOREIGN_REF = `${OTHER_LISTING_TX}#4`;
  const KEY_HASH = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c';
  const STAKE_A = '2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c';
  const STAKE_B = '4142434445464748494a4b4c4d4e4f505152535455565758595a5b5c';

  const key = (hash: string) => ({ hash: Hash28ByteBase16(hash), type: Cardano.CredentialType.KeyHash });
  const script = (hash: string) => ({ hash: Hash28ByteBase16(hash), type: Cardano.CredentialType.ScriptHash });
  const baseAt = (hash: string, stake = STAKE_A) =>
    Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Testnet, script(hash), key(stake)).toAddress().toBech32();
  const enterpriseAt = (hash: string) =>
    Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, script(hash)).toAddress().toBech32();
  // By hand, as marketGuard.spec does: header 0x50 is a pointer address with a script payment
  // part on a testnet, then the hash and the pointer's three naturals.
  const pointerAt = (hash: string) => Cardano.Address.fromBytes(HexBlob(`50${hash}010203`)).toBech32();
  const keyAddress = (hash = KEY_HASH) =>
    Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Testnet, key(hash), key(STAKE_A)).toAddress().toBech32();

  const ownListing = (ref: string, unit: string, price: bigint): OwnListing => ({
    ref,
    unit,
    datum: { owner: OWN_PAYMENT_HASH, sellerAddress: OWN_ADDR, price, royalties: [], buyer: null },
    depositLovelace: '2000000',
    deploymentVersion: 1,
  });
  const market = (over: Partial<ApprovalContext> = {}) => ctx({
    ownListings: new Map([[OWN_REF, ownListing(OWN_REF, NFT, 25_000_000n)]]),
    listingScriptHashes: new Set([LISTING_SCRIPT]),
    resolveAsset: (unit) => ({ name: unit === NFT ? 'Gero Cat #7' : 'Token', decimals: 0 }),
    ...over,
  });
  const nftOut = (address: string, unit = NFT) =>
    ({ address, value: { coins: 2_000_000n, assets: new Map([[unit, 1n]]) } });

  describe('spending the wallet\'s own listing', () => {
    it('lists each own listing an input spends, with its NFT and its listed price from the stored datum', () => {
      const s = buildTxApprovalSummary(tx({
        inputs: [{ txId: TX_ID, index: 0 }, { txId: LISTING_TX, index: 0 }],
        outputs: [nftOut(OWN_ADDR), out(CHANGE_ADDR, 9_000_000n)],
      }), market());
      expect(s.listedInputs).toEqual([{ ref: OWN_REF, unit: NFT, label: 'Gero Cat #7', priceLovelace: 25_000_000n }]);
      expect(s.createsListing).toBe(false);
      expect(s.createdListingCount).toBe(0);
    });

    it('lists several spent listings in input order, once each', () => {
      const second = `${'c3'.repeat(32)}#2`;
      const s = buildTxApprovalSummary(tx({
        inputs: [{ txId: 'c3'.repeat(32), index: 2 }, { txId: LISTING_TX, index: 0 }],
      }), market({
        ownListings: new Map([
          [OWN_REF, ownListing(OWN_REF, NFT, 25_000_000n)],
          [second, ownListing(second, OTHER_NFT, 7_500_000n)],
        ]),
      }));
      expect(s.listedInputs.map((l) => [l.ref, l.unit, l.priceLovelace])).toEqual([
        [second, OTHER_NFT, 7_500_000n],
        [OWN_REF, NFT, 25_000_000n],
      ]);
    });

    it('does not call a listing that is not the wallet\'s "your listing" (a stranger\'s, or a fake naming it)', () => {
      // FOREIGN_REF is a listing UTxO at the script, but the wallet's own-listing check (owner AND
      // seller must be the wallet) did not accept it, so it is not in ownListings.
      const s = buildTxApprovalSummary(tx({
        inputs: [{ txId: TX_ID, index: 0 }, { txId: OTHER_LISTING_TX, index: 4 }],
        outputs: [nftOut(OWN_ADDR, OTHER_NFT), out(CHANGE_ADDR, 9_000_000n)],
      }), market());
      expect(FOREIGN_REF).not.toBe(OWN_REF);
      expect(s.listedInputs).toEqual([]);
      expect(s.createsListing).toBe(false);
    });

    it('matches the input by reference whatever the case of the stored key', () => {
      const s = buildTxApprovalSummary(tx({ inputs: [{ txId: LISTING_TX, index: 0 }] }), market({
        ownListings: new Map([[OWN_REF.toUpperCase(), ownListing(OWN_REF, NFT, 25_000_000n)]]),
      }));
      expect(s.listedInputs).toHaveLength(1);
    });

    it('does not count reading a listing (reference input) or its output index as a spend', () => {
      const s = buildTxApprovalSummary(tx({
        inputs: [{ txId: TX_ID, index: 0 }, { txId: LISTING_TX, index: 1 }],
        referenceInputs: [{ txId: LISTING_TX, index: 0 }],
      }), market());
      expect(s.listedInputs).toEqual([]);
    });

    it('never takes the price or the NFT from the transaction: a datum the dApp attached changes nothing', () => {
      // The listing's own input has no datum in the transaction at all; what is shown is the wallet's
      // stored listing, so a dApp cannot understate the price by putting another datum in the body.
      const forged = tx({
        inputs: [{ txId: LISTING_TX, index: 0 }],
        outputs: [{ address: OWN_ADDR, value: { coins: 2_000_000n }, datum: { __typename: 'inline', price: 1n } }],
      });
      const s = buildTxApprovalSummary(forged, market());
      expect(s.listedInputs[0]).toMatchObject({ unit: NFT, priceLovelace: 25_000_000n });
    });
  });

  describe('creating a listing', () => {
    it('flags an output at a listing script and counts it', () => {
      const s = buildTxApprovalSummary(tx({
        inputs: [{ txId: TX_ID, index: 0 }],
        outputs: [nftOut(baseAt(LISTING_SCRIPT)), out(CHANGE_ADDR, 9_000_000n)],
      }), market({ ownListings: new Map() }));
      expect(s.createsListing).toBe(true);
      expect(s.createdListingCount).toBe(1);
      expect(s.listedInputs).toEqual([]);
    });

    it('flags it whatever the stake part: the wallet\'s own, another key, none, or a pointer', () => {
      for (const address of [baseAt(LISTING_SCRIPT, STAKE_A), baseAt(LISTING_SCRIPT, STAKE_B), enterpriseAt(LISTING_SCRIPT), pointerAt(LISTING_SCRIPT)]) {
        const s = buildTxApprovalSummary(tx({ outputs: [nftOut(address)] }), market());
        expect(s.createsListing).toBe(true);
        expect(s.createdListingCount).toBe(1);
      }
    });

    it('counts every output at a listing script when there are several', () => {
      const s = buildTxApprovalSummary(tx({
        outputs: [nftOut(baseAt(LISTING_SCRIPT)), out(CHANGE_ADDR, 1_000_000n), nftOut(enterpriseAt(LISTING_SCRIPT), OTHER_NFT), nftOut(baseAt(LISTING_SCRIPT, STAKE_B), OTHER_NFT)],
      }), market());
      expect(s.createsListing).toBe(true);
      expect(s.createdListingCount).toBe(3);
    });

    it('is silent for a key address, another script and a key credential carrying the script\'s bytes', () => {
      const s = buildTxApprovalSummary(tx({
        outputs: [out(EXT_ADDR, 5_000_000n), out(baseAt(OTHER_SCRIPT), 2_000_000n), out(enterpriseAt(OTHER_SCRIPT), 2_000_000n), out(keyAddress(LISTING_SCRIPT), 2_000_000n)],
      }), market());
      expect(s.createsListing).toBe(false);
      expect(s.createdListingCount).toBe(0);
    });

    it('says nothing about a script that is not a configured deployment (no hashes configured)', () => {
      const s = buildTxApprovalSummary(tx({ outputs: [nftOut(baseAt(LISTING_SCRIPT))] }), market({ listingScriptHashes: new Set() }));
      expect(s.createsListing).toBe(false);
    });
  });

  it('shows both when a transaction reprices: spends the listing and creates its replacement', () => {
    const s = buildTxApprovalSummary(tx({
      inputs: [{ txId: TX_ID, index: 0 }, { txId: LISTING_TX, index: 0 }],
      outputs: [nftOut(baseAt(LISTING_SCRIPT)), out(CHANGE_ADDR, 9_000_000n)],
    }), market());
    expect(s.listedInputs.map((l) => l.ref)).toEqual([OWN_REF]);
    expect(s.createsListing).toBe(true);
    expect(s.createdListingCount).toBe(1);
  });

  it('reads the same from real CBOR: input refs and addresses as the signer decodes them', () => {
    const core = tx({
      inputs: [{ txId: TX_ID, index: 0 }, { txId: LISTING_TX, index: 0 }],
      outputs: [nftOut(baseAt(LISTING_SCRIPT)), out(CHANGE_ADDR, 9_000_000n)],
    });
    const fromCbor = Serialization.Transaction.fromCbor(Serialization.Transaction.fromCore(core).toCbor()).toCore();
    const s = buildTxApprovalSummary(fromCbor, market());
    expect(s.listedInputs.map((l) => l.ref)).toEqual([OWN_REF]);
    expect(s.createdListingCount).toBe(1);
  });

  describe('a transaction that touches no listing', () => {
    const body = {
      inputs: [{ txId: TX_ID, index: 0 }],
      outputs: [out(EXT_ADDR, 5_000_000n), out(CHANGE_ADDR, 1_234_567n)],
    };

    it('shows no listing effect even when the wallet has listings and the script is configured', () => {
      const s = buildTxApprovalSummary(tx(body), market());
      expect(s.listedInputs).toEqual([]);
      expect(s.createsListing).toBe(false);
      expect(s.createdListingCount).toBe(0);
    });

    it('is otherwise identical with and without the market context', () => {
      const withMarket = buildTxApprovalSummary(tx(body), market());
      const without = buildTxApprovalSummary(tx(body), ctx());
      expect(withMarket).toEqual(without);
    });
  });

  describe('approvalMarketContext', () => {
    it('revives the store\'s decimal-string bigints and keys the listings by lower-case reference', () => {
      const stored = [{
        ref: OWN_REF.toUpperCase(),
        unit: NFT,
        depositLovelace: '2000000',
        deploymentVersion: 1,
        datum: { owner: OWN_PAYMENT_HASH, sellerAddress: OWN_ADDR, price: '25000000', royalties: [{ address: EXT_ADDR, lovelace: '500000' }], buyer: null },
      }];
      const result = approvalMarketContext(stored, [{ scriptHash: LISTING_SCRIPT.toUpperCase() }]);
      expect([...result.ownListings.keys()]).toEqual([OWN_REF]);
      const listing = result.ownListings.get(OWN_REF);
      expect(listing?.datum.price).toBe(25_000_000n);
      expect(listing?.datum.royalties[0].lovelace).toBe(500_000n);
      expect([...result.listingScriptHashes]).toEqual([LISTING_SCRIPT]);
    });

    it('is empty for nothing stored and no deployments, and skips a malformed row', () => {
      for (const empty of [undefined, null, [], 'x']) {
        const result = approvalMarketContext(empty, []);
        expect(result.ownListings.size).toBe(0);
        expect(result.listingScriptHashes.size).toBe(0);
      }
      expect(approvalMarketContext([{ ref: 'x' }], []).ownListings.size).toBe(0);
    });

    it('reaches the summary through approvalContextFromKeys, and defaults to none', () => {
      const keys = { payment: [{ address: OWN_ADDR, cred: OWN_PAYMENT_HASH }], change: [{ address: CHANGE_ADDR, cred: OWN_PAYMENT_HASH }] };
      const resolve = () => ({ name: 'Token', decimals: 0 });
      const withMarket = approvalContextFromKeys(keys, Cardano.NetworkId.Testnet, resolve, {
        market: approvalMarketContext([ownListing(OWN_REF, NFT, 25_000_000n)], [{ scriptHash: LISTING_SCRIPT }]),
      });
      expect(withMarket.ownListings.get(OWN_REF)?.unit).toBe(NFT);
      expect(withMarket.listingScriptHashes.has(LISTING_SCRIPT)).toBe(true);
      const bare = approvalContextFromKeys(keys, Cardano.NetworkId.Testnet, resolve);
      expect(bare.ownListings.size).toBe(0);
      expect(bare.listingScriptHashes.size).toBe(0);
    });
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
