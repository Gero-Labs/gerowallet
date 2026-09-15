// The CIP-149 slice of the governance store must be live from LOGIN, because
// its consumer is not a governance view: useWithdrawal.compensationInfo reads
// it from the dashboard StakingCard, which never mounts one. So what is worth
// asserting here is exactly that — the store populates off the wallet alone,
// with no component in sight — plus the two guards the view-scoped hydration
// always had (a failed lookup must not blank a good record; a pending
// delegation is not a commitment) and the login race the bootstrap exists to
// survive (the tx history landing after the account).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Vue from 'vue';
import { Cardano } from '@cardano-sdk/core';

const getDRepById = vi.fn();
vi.mock('@/api/blockchain-api', () => ({ default: { getDRepById: (...args: unknown[]) => getDRepById(...args) } }));

import {
  useGovernanceHydration,
  hydrateGovernanceStore,
  resetDRepRecords,
} from './useGovernanceHydration';
import { walletStore } from '@/stores/walletStore';
import { governanceStore } from '@/stores/governanceStore';
import { extractCip149Compensation } from '@/shared/utils/builder';

/** A confirmed vote delegation carrying a CIP-149 donation rate. */
function delegationTxWithDonation(bps: number, pending = false) {
  return {
    pending,
    block_height: 100,
    body: { certificates: [{ __typename: Cardano.CertificateType.VoteDelegation }] },
    auxiliaryData: { blob: new Map([[3692n, new Map([['donationBasisPoints', bps]])]]) },
  };
}

function loginDelegated(drepId = 'drep1yfrexample'): void {
  walletStore.loggedWallet = { chain: 'Cardano', network: 'Mainnet', stakeAddress: 'stake1uexample' };
  walletStore.account = {
    active: true,
    pool_id: 'pool1abc',
    drep_id: drepId,
    controlled_amount: '23718000000',
    withdrawable_amount: '412390000',
  } as unknown as typeof walletStore.account;
}

/** Let the watcher and the fetch behind it settle. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  await Vue.nextTick();
}

beforeEach(async () => {
  vi.clearAllMocks();
  // Records are memoised per chain/network/id for five minutes, so without this
  // each test would be served the previous test's DRep.
  resetDRepRecords();
  getDRepById.mockResolvedValue(null);
  walletStore.loggedWallet = null;
  walletStore.account = null;
  walletStore.transactions = [];
  // The bootstrap latches on first call and its detached watchers outlive
  // every test in this file; flush the logout they just observed before
  // pinning the store to a known baseline.
  useGovernanceHydration();
  await settle();
  governanceStore.currentDRep = null;
  governanceStore.currentCompensationBps = null;
});

describe('useGovernanceHydration', () => {
  it('populates the store at login, with no governance view mounted', async () => {
    const drepRecord = {
      registered: true,
      votes: [],
      metadata: { meta_json: { body: { paymentAddress: 'addr1qexample' } } },
    };
    getDRepById.mockResolvedValue(drepRecord);
    walletStore.transactions = [delegationTxWithDonation(50)];
    loginDelegated();
    await settle();

    expect(getDRepById).toHaveBeenCalledWith('drep1yfrexample', 'Cardano', 'Mainnet');
    expect(governanceStore.currentDRep).toEqual(drepRecord);
    expect(governanceStore.currentCompensationBps).toBe(50);
  });

  it('recovers the donation rate when the tx history lands after the account', async () => {
    getDRepById.mockResolvedValue({ registered: true, votes: [] });
    loginDelegated();
    await settle();
    // The account arrived first: the committed rate is not knowable yet.
    expect(governanceStore.currentCompensationBps).toBeNull();

    walletStore.transactions = [delegationTxWithDonation(50)];
    await settle();

    expect(governanceStore.currentCompensationBps).toBe(50);
    // The rate is recomputed in memory; the DRep record is not re-fetched.
    expect(getDRepById).toHaveBeenCalledTimes(1);
  });

  it('ignores a pending delegation, which the chain has not agreed to yet', async () => {
    getDRepById.mockResolvedValue({ registered: true, votes: [] });
    loginDelegated();
    walletStore.transactions = [delegationTxWithDonation(50, true)];
    await settle();

    expect(governanceStore.currentCompensationBps).toBeNull();
  });

  it('clears both slots at logout', async () => {
    getDRepById.mockResolvedValue({ registered: true, votes: [] });
    walletStore.transactions = [delegationTxWithDonation(50)];
    loginDelegated();
    await settle();
    expect(governanceStore.currentDRep).not.toBeNull();

    walletStore.account = null;
    walletStore.transactions = [];
    await settle();

    expect(governanceStore.currentDRep).toBeNull();
    expect(governanceStore.currentCompensationBps).toBeNull();
  });

  it('keeps a good record rather than blanking it on a transient lookup failure', async () => {
    const goodRecord = { drep_id: 'drep1yfrexample', registered: true };
    getDRepById.mockResolvedValue(goodRecord);
    loginDelegated();
    await settle();
    expect(governanceStore.currentDRep).toEqual(goodRecord);

    getDRepById.mockRejectedValue(new Error('boom'));
    walletStore.account = {
      ...walletStore.account,
      drep_id: 'drep1yfrother',
    } as unknown as typeof walletStore.account;
    await settle();

    expect(governanceStore.currentDRep).toEqual(goodRecord);
  });

  it('records a keyword choice without a doomed lookup', async () => {
    loginDelegated('drep_always_abstain');
    await settle();

    expect(getDRepById).not.toHaveBeenCalled();
    expect(governanceStore.currentDRep).toEqual({ drep_id: 'drep_always_abstain' });
  });

  it('shares one in-flight lookup between the bootstrap and a mounted view', async () => {
    let resolveFetch!: (record: unknown) => void;
    getDRepById.mockImplementation(() => new Promise(resolve => { resolveFetch = resolve; }));
    loginDelegated();

    // A governance view reacting to the same delegation change calls this
    // directly; both callers must ride the same request.
    const first = hydrateGovernanceStore();
    const second = hydrateGovernanceStore();
    expect(getDRepById).toHaveBeenCalledTimes(1);

    resolveFetch({ registered: true, votes: [] });
    await Promise.all([first, second]);
    await settle();

    expect(getDRepById).toHaveBeenCalledTimes(1);
    expect(governanceStore.currentDRep).toEqual({ registered: true, votes: [] });
  });
});

describe('serialized compensation metadata', () => {
  it('hydrates the same rate after the production Chrome serialization boundary', async () => {
    getDRepById.mockResolvedValue({ registered: true, votes: [] });
    walletStore.transactions = JSON.parse(JSON.stringify([delegationTxWithDonation(50)], (_key, value) => {
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Map) return Object.fromEntries(value);
      return value;
    }));
    loginDelegated();
    await settle();
    expect(governanceStore.currentCompensationBps).toBe(50);
  });
});

describe('compensation metadata input boundaries', () => {
  it.each([
    { blob: new Map([[3692n, new Map([['donationBasisPoints', 0n]])]]) },
    { blob: { '3692': { donationBasisPoints: '0' } } },
  ])('preserves an explicit zero donation', metadata => {
    expect(extractCip149Compensation(metadata)).toBe(0);
  });
  it.each([
    undefined, null, {}, { blob: null }, { blob: [] },
    { blob: { '3692': { donationBasisPoints: true } } },
    { blob: { '3692': { donationBasisPoints: '' } } },
    { blob: { '3692': { donationBasisPoints: 'NaN' } } },
    { blob: { '3692': { donationBasisPoints: -1 } } },
    { blob: { '3692': { donationBasisPoints: 0.5 } } },
  ])('ignores missing or malformed metadata without throwing', metadata => {
    expect(extractCip149Compensation(metadata)).toBeNull();
  });
});
