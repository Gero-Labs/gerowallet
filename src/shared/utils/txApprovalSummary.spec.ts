import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import { inlineDatumFromCbor } from '@/shared/utils/utxoCbor';
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
  listingFees: new Map(),
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
// deployments' script hashes, and it must READ what a created listing says (its datum), because
// anyone can list an NFT with an owner and seller of their choosing. Never from data the dApp
// supplied about the wallet's own listings.
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
  const STRANGER_KEY = '77'.repeat(28);
  const ADA = 1_000_000n;
  // Deployment v1 parameters: 100 bps, 1.5 ADA minimum fee, 5 ADA cap.
  const FEES = { feeBps: 100, minFeeLovelace: 1_500_000n, maxFeeLovelace: 5_000_000n };

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

  // ---- a listing datum, encoded by hand (test side; the contract's indefinite-length form) ----
  const hex2 = (n: number) => n.toString(16).padStart(2, '0');
  const bstr = (h: string) => `58${hex2(h.length / 2)}${h}`;
  const NONE = 'd87a80';
  const uint = (n: bigint): string => {
    if (n < 24n) return n.toString(16).padStart(2, '0');
    if (n < 0x100n) return `18${n.toString(16).padStart(2, '0')}`;
    if (n < 0x10000n) return `19${n.toString(16).padStart(4, '0')}`;
    if (n < 0x100000000n) return `1a${n.toString(16).padStart(8, '0')}`;
    return `1b${n.toString(16).padStart(16, '0')}`;
  };
  const constr = (index: 0 | 1, fields: string[]) => `${index === 0 ? 'd879' : 'd87a'}9f${fields.join('')}ff`;
  const credentialData = (c: Cardano.Credential) => constr(c.type === Cardano.CredentialType.KeyHash ? 0 : 1, [bstr(c.hash)]);
  const addressData = (bech32: string): string => {
    const address = Cardano.Address.fromBech32(bech32);
    const base = address.asBase();
    if (base) return constr(0, [credentialData(base.getPaymentCredential()), constr(0, [constr(0, [credentialData(base.getStakeCredential())])])]);
    return constr(0, [credentialData(address.asEnterprise()!.getPaymentCredential()), NONE]);
  };
  interface DatumParts { owner: string; seller: string; price: bigint; royalties: Array<[string, bigint]>; buyer: string | null }
  const datumHex = (over: Partial<DatumParts> = {}): string => {
    const d: DatumParts = { owner: OWN_PAYMENT_HASH, seller: OWN_ADDR, price: 25n * ADA, royalties: [], buyer: null, ...over };
    return constr(0, [
      bstr(d.owner),
      addressData(d.seller),
      uint(d.price),
      `9f${d.royalties.map(([address, lovelace]) => constr(0, [addressData(address), uint(lovelace)])).join('')}ff`,
      d.buyer === null ? NONE : constr(0, [bstr(d.buyer)]),
    ]);
  };
  // Valid addresses a datum can carry (EXT_ADDR above is a fixture string, not a parseable address).
  const ROYALTY_ADDR = keyAddress('88'.repeat(28));
  const FOREIGN_SELLER = keyAddress(STRANGER_KEY);

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
    listingFees: new Map([[LISTING_SCRIPT, FEES]]),
    resolveAsset: (unit) => ({ name: unit === NFT ? 'Gero Cat #7' : 'Token', decimals: 0 }),
    ...over,
  });
  const nftOut = (address: string, unit = NFT) =>
    ({ address, value: { coins: 2_000_000n, assets: new Map([[unit, 1n]]) } });
  /** An output at the listing script holding the NFT, with an inline datum. */
  const listedOut = (cbor: string, unit = NFT, address = baseAt(LISTING_SCRIPT)) =>
    ({ address, value: { coins: 2_000_000n, assets: new Map([[unit, 1n]]) }, datum: inlineDatumFromCbor(HexBlob(cbor)) });
  const created = (output: Record<string, unknown>, over: Partial<ApprovalContext> = {}) =>
    buildTxApprovalSummary(tx({ inputs: [{ txId: TX_ID, index: 0 }], outputs: [output, out(CHANGE_ADDR, 9_000_000n)] }), market({ ownListings: new Map(), ...over }));

  describe('spending the wallet\'s own listing', () => {
    it('lists each own listing an input spends, with its NFT and its listed price from the stored datum', () => {
      const s = buildTxApprovalSummary(tx({
        inputs: [{ txId: TX_ID, index: 0 }, { txId: LISTING_TX, index: 0 }],
        outputs: [nftOut(OWN_ADDR), out(CHANGE_ADDR, 9_000_000n)],
      }), market());
      expect(s.listedInputs).toEqual([{ ref: OWN_REF, unit: NFT, label: 'Gero Cat #7', priceLovelace: 25_000_000n, nftLeavesWallet: false }]);
      expect(s.createsListing).toBe(false);
      expect(s.createdListingCount).toBe(0);
      expect(s.requiresMarketAck).toBe(false);
    });

    it('lists several spent listings in input order, once each', () => {
      const second = `${'c3'.repeat(32)}#2`;
      const s = buildTxApprovalSummary(tx({
        inputs: [{ txId: 'c3'.repeat(32), index: 2 }, { txId: LISTING_TX, index: 0 }],
        outputs: [nftOut(OWN_ADDR), nftOut(OWN_ADDR, OTHER_NFT)],
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
      expect(s.requiresMarketAck).toBe(false);
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

    it('never takes the price or the NFT from the transaction: a datum the dApp attaches changes nothing', () => {
      const forged = tx({
        inputs: [{ txId: LISTING_TX, index: 0 }],
        outputs: [{ address: OWN_ADDR, value: { coins: 2_000_000n }, datum: { __typename: 'inline', price: 1n } }],
      });
      const s = buildTxApprovalSummary(forged, market());
      expect(s.listedInputs[0]).toMatchObject({ unit: NFT, priceLovelace: 25_000_000n });
    });
  });

  describe('where a spent listing\'s NFT goes', () => {
    const cancelTo = (output: Record<string, unknown> | null, over: Partial<ApprovalContext> = {}) => buildTxApprovalSummary(tx({
      inputs: [{ txId: TX_ID, index: 0 }, { txId: LISTING_TX, index: 0 }],
      outputs: [...(output ? [output] : []), out(CHANGE_ADDR, 9_000_000n)],
    }), market(over));

    it('is fine when it lands in one of the wallet\'s own addresses (receive or change)', () => {
      for (const address of [OWN_ADDR, CHANGE_ADDR]) {
        const s = cancelTo(nftOut(address));
        expect(s.listedInputs[0].nftLeavesWallet).toBe(false);
        expect(s.requiresMarketAck).toBe(false);
      }
    });

    it('is a loud warning, and blocks until acknowledged, when a cancel sends it to a stranger', () => {
      const s = cancelTo(nftOut(EXT_ADDR));
      expect(s.listedInputs[0].nftLeavesWallet).toBe(true);
      expect(s.requiresMarketAck).toBe(true);
    });

    it('is a warning when it lands in no output at all (burned or dropped)', () => {
      const s = cancelTo(null);
      expect(s.listedInputs[0].nftLeavesWallet).toBe(true);
      expect(s.requiresMarketAck).toBe(true);
    });

    it('is a warning when another asset lands at the wallet but not the listed NFT', () => {
      const s = cancelTo(nftOut(OWN_ADDR, OTHER_NFT));
      expect(s.listedInputs[0].nftLeavesWallet).toBe(true);
    });

    it('is fine in a reprice: into a new listing of the wallet\'s own', () => {
      const s = buildTxApprovalSummary(tx({
        inputs: [{ txId: TX_ID, index: 0 }, { txId: LISTING_TX, index: 0 }],
        outputs: [listedOut(datumHex({ price: 30n * ADA })), out(CHANGE_ADDR, 9_000_000n)],
      }), market());
      expect(s.listedInputs[0].nftLeavesWallet).toBe(false);
      expect(s.createdListings[0].paysSomeoneElse).toBe(false);
      expect(s.requiresMarketAck).toBe(false);
    });

    it('is a warning in a "reprice" that changes the owner: the NFT lands in a listing that is not the wallet\'s', () => {
      const s = buildTxApprovalSummary(tx({
        inputs: [{ txId: TX_ID, index: 0 }, { txId: LISTING_TX, index: 0 }],
        outputs: [listedOut(datumHex({ owner: STRANGER_KEY })), out(CHANGE_ADDR, 9_000_000n)],
      }), market());
      expect(s.createdListings[0]).toMatchObject({ datum: 'ok', ownerIsOwn: false, sellerIsOwn: true, paysSomeoneElse: true });
      expect(s.listedInputs[0].nftLeavesWallet).toBe(true);
      expect(s.requiresMarketAck).toBe(true);
    });

    it('is a warning when it lands in a script listing that carries no readable terms', () => {
      const s = cancelTo({ address: baseAt(LISTING_SCRIPT), value: { coins: 2_000_000n, assets: new Map([[NFT, 1n]]) } });
      expect(s.listedInputs[0].nftLeavesWallet).toBe(true);
    });
  });

  describe('creating a listing', () => {
    it('flags an output at a listing script and counts it', () => {
      const s = created(nftOut(baseAt(LISTING_SCRIPT)));
      expect(s.createsListing).toBe(true);
      expect(s.createdListingCount).toBe(1);
      expect(s.createdListings.map((l) => l.outputIndex)).toEqual([0]);
      expect(s.listedInputs).toEqual([]);
    });

    it('flags it whatever the stake part: the wallet\'s own, another key, none, or a pointer', () => {
      for (const address of [baseAt(LISTING_SCRIPT, STAKE_A), baseAt(LISTING_SCRIPT, STAKE_B), enterpriseAt(LISTING_SCRIPT), pointerAt(LISTING_SCRIPT)]) {
        const s = buildTxApprovalSummary(tx({ outputs: [nftOut(address)] }), market());
        expect(s.createsListing).toBe(true);
        expect(s.createdListingCount).toBe(1);
      }
    });

    it('counts every output at a listing script, with its own output index', () => {
      const s = buildTxApprovalSummary(tx({
        outputs: [nftOut(baseAt(LISTING_SCRIPT)), out(CHANGE_ADDR, 1_000_000n), nftOut(enterpriseAt(LISTING_SCRIPT), OTHER_NFT), nftOut(baseAt(LISTING_SCRIPT, STAKE_B), OTHER_NFT)],
      }), market());
      expect(s.createsListing).toBe(true);
      expect(s.createdListingCount).toBe(3);
      expect(s.createdListings.map((l) => l.outputIndex)).toEqual([0, 2, 3]);
    });

    it('is silent for a key address, another script and a key credential carrying the script\'s bytes', () => {
      const s = buildTxApprovalSummary(tx({
        outputs: [out(EXT_ADDR, 5_000_000n), out(baseAt(OTHER_SCRIPT), 2_000_000n), out(enterpriseAt(OTHER_SCRIPT), 2_000_000n), out(keyAddress(LISTING_SCRIPT), 2_000_000n)],
      }), market());
      expect(s.createsListing).toBe(false);
      expect(s.createdListingCount).toBe(0);
      expect(s.createdListings).toEqual([]);
    });

    it('says nothing about a script that is not a configured deployment (no hashes configured)', () => {
      const s = buildTxApprovalSummary(tx({ outputs: [nftOut(baseAt(LISTING_SCRIPT))] }), market({ listingScriptHashes: new Set() }));
      expect(s.createsListing).toBe(false);
    });
  });

  describe('what a created listing\'s datum says', () => {
    it('shows the price and the seller share of one that names the wallet as owner and seller', () => {
      const s = created(listedOut(datumHex({ price: 25n * ADA })));
      expect(s.createdListings).toEqual([{
        outputIndex: 0,
        datum: 'ok',
        priceLovelace: 25_000_000n,
        royaltyCount: 0,
        royaltyTotalLovelace: 0n,
        // 25 ADA at 100 bps is 0.25 ADA, so the 1.5 ADA minimum fee applies: 25 - 1.5.
        sellerShareLovelace: 23_500_000n,
        ownerIsOwn: true,
        sellerIsOwn: true,
        hasBuyer: false,
        paysSomeoneElse: false,
        tooManyRoyalties: false,
        highRoyalties: false,
        lowSellerShare: false,
      }]);
      expect(s.requiresMarketAck).toBe(false);
    });

    it('warns, and blocks, when the owner is not one of the wallet\'s payment keys', () => {
      const s = created(listedOut(datumHex({ owner: STRANGER_KEY })));
      expect(s.createdListings[0]).toMatchObject({ datum: 'ok', ownerIsOwn: false, sellerIsOwn: true, paysSomeoneElse: true });
      expect(s.requiresMarketAck).toBe(true);
    });

    it('warns, and blocks, when the seller address is not one of the wallet\'s addresses', () => {
      const s = created(listedOut(datumHex({ seller: FOREIGN_SELLER })));
      expect(s.createdListings[0]).toMatchObject({ datum: 'ok', ownerIsOwn: true, sellerIsOwn: false, paysSomeoneElse: true });
      expect(s.requiresMarketAck).toBe(true);
    });

    it('accepts a seller at the wallet\'s change address, and an owner that is a change key', () => {
      const s = created(listedOut(datumHex({ seller: CHANGE_ADDR })), { ownPaymentKeyHashes: new Set([OWN_PAYMENT_HASH, KEY_HASH]) });
      expect(s.createdListings[0]).toMatchObject({ sellerIsOwn: true, paysSomeoneElse: false });
      expect(created(listedOut(datumHex({ owner: KEY_HASH })), { ownPaymentKeyHashes: new Set([OWN_PAYMENT_HASH, KEY_HASH]) }).createdListings[0].ownerIsOwn).toBe(true);
    });

    it('warns when the output carries a datum HASH: the terms are not in the transaction', () => {
      const s = created({ address: baseAt(LISTING_SCRIPT), value: { coins: 2_000_000n, assets: new Map([[NFT, 1n]]) }, datumHash: '3'.repeat(64) });
      expect(s.createdListings[0]).toMatchObject({ datum: 'datumHash', priceLovelace: null, paysSomeoneElse: true });
      expect(s.requiresMarketAck).toBe(true);
    });

    it('warns when the output carries no datum at all', () => {
      const s = created({ address: baseAt(LISTING_SCRIPT), value: { coins: 2_000_000n, assets: new Map([[NFT, 1n]]) } });
      expect(s.createdListings[0]).toMatchObject({ datum: 'missing', priceLovelace: null, sellerShareLovelace: null, paysSomeoneElse: true });
      expect(s.requiresMarketAck).toBe(true);
    });

    it('warns when the datum is not a listing, and never throws on one', () => {
      const wrongShape = created(listedOut('d8799f01ff'));
      expect(wrongShape.createdListings[0]).toMatchObject({ datum: 'undecodable', priceLovelace: null, paysSomeoneElse: true });
      expect(wrongShape.requiresMarketAck).toBe(true);
      // Not even hex, a Core datum without bytes, and bytes after the datum: each is just "undecodable".
      const notHex = created({ address: baseAt(LISTING_SCRIPT), value: { coins: 2_000_000n }, datum: { cbor: 'not hex' } });
      expect(notHex.createdListings[0].datum).toBe('undecodable');
      const noBytes = created({ address: baseAt(LISTING_SCRIPT), value: { coins: 2_000_000n }, datum: 42n });
      expect(noBytes.createdListings[0].datum).toBe('undecodable');
      const trailing = created(listedOut(`${datumHex()}00`));
      expect(trailing.createdListings[0].datum).toBe('undecodable');
    });

    it('treats every created listing as undecodable when the wallet\'s network is unknown', () => {
      const s = created(listedOut(datumHex()), { walletNetworkId: null });
      expect(s.createdListings[0]).toMatchObject({ datum: 'undecodable', priceLovelace: null, paysSomeoneElse: true });
      expect(s.requiresMarketAck).toBe(true);
    });

    it('shows how many royalties and what they total, without a warning when they are modest', () => {
      const royalties: Array<[string, bigint]> = [[ROYALTY_ADDR, 2n * ADA], [ROYALTY_ADDR, 2n * ADA], [ROYALTY_ADDR, 2n * ADA]];
      const s = created(listedOut(datumHex({ price: 100n * ADA, royalties })));
      expect(s.createdListings[0]).toMatchObject({
        royaltyCount: 3,
        royaltyTotalLovelace: 6_000_000n,
        // 100 ADA at 100 bps is 1 ADA, under the 1.5 ADA minimum: 100 - 1.5 - 6.
        sellerShareLovelace: 92_500_000n,
        tooManyRoyalties: false,
        highRoyalties: false,
        lowSellerShare: false,
        paysSomeoneElse: false,
      });
      expect(s.requiresMarketAck).toBe(false);
    });

    it('warns, and blocks, above three royalty payees', () => {
      const royalties: Array<[string, bigint]> = [[ROYALTY_ADDR, ADA], [ROYALTY_ADDR, ADA], [ROYALTY_ADDR, ADA], [ROYALTY_ADDR, ADA]];
      const s = created(listedOut(datumHex({ price: 100n * ADA, royalties })));
      expect(s.createdListings[0]).toMatchObject({ royaltyCount: 4, tooManyRoyalties: true, highRoyalties: false, paysSomeoneElse: false });
      expect(s.requiresMarketAck).toBe(true);
    });

    it('warns, and blocks, when royalties take more than 10% of the price (10% itself is fine)', () => {
      const atCap = created(listedOut(datumHex({ price: 100n * ADA, royalties: [[ROYALTY_ADDR, 10n * ADA]] })));
      expect(atCap.createdListings[0].highRoyalties).toBe(false);
      expect(atCap.requiresMarketAck).toBe(false);
      const over = created(listedOut(datumHex({ price: 100n * ADA, royalties: [[ROYALTY_ADDR, 10n * ADA + 1n]] })));
      expect(over.createdListings[0]).toMatchObject({ highRoyalties: true, tooManyRoyalties: false });
      expect(over.requiresMarketAck).toBe(true);
    });

    it('warns, and blocks, when the seller\'s share is at or below the minimum', () => {
      // 100 ADA at 98.5% is a 98.5 ADA fee: the seller keeps exactly 1.5 ADA.
      const fees = new Map([[LISTING_SCRIPT, { feeBps: 9850, minFeeLovelace: 0n, maxFeeLovelace: null }]]);
      const atFloor = created(listedOut(datumHex({ price: 100n * ADA })), { listingFees: fees });
      expect(atFloor.createdListings[0]).toMatchObject({ sellerShareLovelace: 1_500_000n, lowSellerShare: true, highRoyalties: false });
      expect(atFloor.requiresMarketAck).toBe(true);
      const above = created(listedOut(datumHex({ price: 100n * ADA })), { listingFees: new Map([[LISTING_SCRIPT, { feeBps: 9849, minFeeLovelace: 0n, maxFeeLovelace: null }]]) });
      expect(above.createdListings[0]).toMatchObject({ sellerShareLovelace: 1_510_000n, lowSellerShare: false });
      // A share below nothing (royalties and fee above the price) is below the floor too.
      const negative = created(listedOut(datumHex({ price: 5n * ADA, royalties: [[ROYALTY_ADDR, 5n * ADA]] })));
      expect(negative.createdListings[0].lowSellerShare).toBe(true);
    });

    it('fails closed when the deployment\'s fee parameters are unknown: no share, and a warning', () => {
      const s = created(listedOut(datumHex()), { listingFees: new Map() });
      expect(s.createdListings[0]).toMatchObject({ datum: 'ok', sellerShareLovelace: null, lowSellerShare: true });
      expect(s.requiresMarketAck).toBe(true);
    });

    it('notes a private listing (a named buyer) without blocking', () => {
      const s = created(listedOut(datumHex({ buyer: STRANGER_KEY })));
      expect(s.createdListings[0]).toMatchObject({ hasBuyer: true, paysSomeoneElse: false });
      expect(s.requiresMarketAck).toBe(false);
    });

    it('judges each created listing on its own datum', () => {
      const s = buildTxApprovalSummary(tx({
        inputs: [{ txId: TX_ID, index: 0 }],
        outputs: [listedOut(datumHex()), listedOut(datumHex({ owner: STRANGER_KEY }), OTHER_NFT), out(CHANGE_ADDR, 9_000_000n)],
      }), market({ ownListings: new Map() }));
      expect(s.createdListings.map((l) => [l.outputIndex, l.paysSomeoneElse])).toEqual([[0, false], [1, true]]);
      expect(s.requiresMarketAck).toBe(true);
    });
  });

  it('shows both when a transaction reprices: spends the listing and creates its replacement', () => {
    const s = buildTxApprovalSummary(tx({
      inputs: [{ txId: TX_ID, index: 0 }, { txId: LISTING_TX, index: 0 }],
      outputs: [listedOut(datumHex({ price: 30n * ADA })), out(CHANGE_ADDR, 9_000_000n)],
    }), market());
    expect(s.listedInputs.map((l) => l.ref)).toEqual([OWN_REF]);
    expect(s.createsListing).toBe(true);
    expect(s.createdListingCount).toBe(1);
    expect(s.createdListings[0].priceLovelace).toBe(30_000_000n);
  });

  it('reads the same from real CBOR: input refs, addresses and the inline datum as the signer decodes them', () => {
    const core = tx({
      inputs: [{ txId: TX_ID, index: 0 }, { txId: LISTING_TX, index: 0 }],
      outputs: [listedOut(datumHex({ price: 30n * ADA, royalties: [[ROYALTY_ADDR, 3n * ADA]] })), out(CHANGE_ADDR, 9_000_000n)],
    });
    const fromCbor = Serialization.Transaction.fromCbor(Serialization.Transaction.fromCore(core).toCbor()).toCore();
    const s = buildTxApprovalSummary(fromCbor, market());
    expect(s.listedInputs.map((l) => l.ref)).toEqual([OWN_REF]);
    expect(s.createdListingCount).toBe(1);
    expect(s.createdListings[0]).toMatchObject({
      datum: 'ok', priceLovelace: 30_000_000n, royaltyCount: 1, royaltyTotalLovelace: 3_000_000n, ownerIsOwn: true, sellerIsOwn: true, paysSomeoneElse: false,
    });
    expect(s.listedInputs[0].nftLeavesWallet).toBe(false);
    // A datum HASH survives the round trip as a hash.
    const hashed = tx({ outputs: [{ address: baseAt(LISTING_SCRIPT), value: { coins: 2_000_000n, assets: new Map([[NFT, 1n]]) }, datumHash: '3'.repeat(64) }] });
    const hashedBack = Serialization.Transaction.fromCbor(Serialization.Transaction.fromCore(hashed).toCbor()).toCore();
    expect(buildTxApprovalSummary(hashedBack, market()).createdListings[0].datum).toBe('datumHash');
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
      expect(s.createdListings).toEqual([]);
      expect(s.requiresMarketAck).toBe(false);
    });

    it('is otherwise identical with and without the market context', () => {
      const withMarket = buildTxApprovalSummary(tx(body), market());
      const without = buildTxApprovalSummary(tx(body), ctx());
      expect(withMarket).toEqual(without);
    });
  });

  describe('approvalMarketContext', () => {
    const deployment = (scriptHash: string, over: Partial<typeof FEES> = {}) => ({ scriptHash, ...FEES, ...over });

    it('revives the store\'s decimal-string bigints and keys the listings by lower-case reference', () => {
      const stored = [{
        ref: OWN_REF.toUpperCase(),
        unit: NFT,
        depositLovelace: '2000000',
        deploymentVersion: 1,
        datum: { owner: OWN_PAYMENT_HASH, sellerAddress: OWN_ADDR, price: '25000000', royalties: [{ address: ROYALTY_ADDR, lovelace: '500000' }], buyer: null },
      }];
      const result = approvalMarketContext(stored, [deployment(LISTING_SCRIPT.toUpperCase())]);
      expect([...result.ownListings.keys()]).toEqual([OWN_REF]);
      const listing = result.ownListings.get(OWN_REF);
      expect(listing?.datum.price).toBe(25_000_000n);
      expect(listing?.datum.royalties[0].lovelace).toBe(500_000n);
      expect([...result.listingScriptHashes]).toEqual([LISTING_SCRIPT]);
    });

    it('carries each deployment\'s fee parameters, by lower-case script hash', () => {
      const result = approvalMarketContext([], [
        deployment(LISTING_SCRIPT.toUpperCase()),
        deployment(OTHER_SCRIPT, { feeBps: 250, minFeeLovelace: 2_000_000n, maxFeeLovelace: null }),
      ]);
      expect(result.listingFees.get(LISTING_SCRIPT)).toEqual(FEES);
      expect(result.listingFees.get(OTHER_SCRIPT)).toEqual({ feeBps: 250, minFeeLovelace: 2_000_000n, maxFeeLovelace: null });
      expect(result.listingFees.size).toBe(2);
    });

    it('is empty for nothing stored and no deployments, and skips a malformed row', () => {
      for (const empty of [undefined, null, [], 'x']) {
        const result = approvalMarketContext(empty, []);
        expect(result.ownListings.size).toBe(0);
        expect(result.listingScriptHashes.size).toBe(0);
        expect(result.listingFees.size).toBe(0);
      }
      expect(approvalMarketContext([{ ref: 'x' }], []).ownListings.size).toBe(0);
    });

    it('reaches the summary through approvalContextFromKeys (the market part is required)', () => {
      const keys = { payment: [{ address: OWN_ADDR, cred: OWN_PAYMENT_HASH }], change: [{ address: CHANGE_ADDR, cred: OWN_PAYMENT_HASH }] };
      const resolve = () => ({ name: 'Token', decimals: 0 });
      const withMarket = approvalContextFromKeys(keys, Cardano.NetworkId.Testnet, resolve, {
        market: approvalMarketContext([ownListing(OWN_REF, NFT, 25_000_000n)], [deployment(LISTING_SCRIPT)]),
      });
      expect(withMarket.ownListings.get(OWN_REF)?.unit).toBe(NFT);
      expect(withMarket.listingScriptHashes.has(LISTING_SCRIPT)).toBe(true);
      expect(withMarket.listingFees.get(LISTING_SCRIPT)).toEqual(FEES);
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
