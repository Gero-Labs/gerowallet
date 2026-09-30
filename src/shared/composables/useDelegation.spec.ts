import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Vue from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Blockchain, Network, WalletType } from '@/models/types';
import { nexusTxApi } from '@/api/nexus-tx-api';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import snackbar from '@/plugins/snackbar';
import { useDelegation } from './useDelegation';
import { useUnstake } from './useUnstake';
import { useDRepDelegation } from '@/modules/governance/composables/useDRepDelegation';

vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.observable({
  loggedWallet: null, account: null, keys: null, utxos: [], collateral: null, transactions: [],
}) }));
vi.mock('@/stores/networkStore', () => ({ networkStore: Vue.observable({ epochParams: { stakeKeyDeposit: '2000000' }, tip: { slot: 100 } }) }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/stakingStore', () => ({ default: {} }));
vi.mock('@/utils/networks', () => ({ default: {} }));
vi.mock('@/shared/utils/builder', () => ({ buildCardanoTransaction: vi.fn() }));
vi.mock('@/api/nexus-tx-api', () => ({
  nexusTxApi: { buildDelegationTx: vi.fn(), buildVoteDelegationTx: vi.fn(), buildStakeRegistrationTx: vi.fn() },
  walletUtxosToNexusInputs: () => [],
  cardanoUtxoToNexusInput: vi.fn(),
}));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: {
  isNexusDelegateEnabled: vi.fn(), isNexusVoteDelegationEnabled: vi.fn(), isNexusUnstakeEnabled: vi.fn(),
} }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn() } }));

const address = 'addr_test1qqy44ytv354nqrs0f3hfsecj45w623wgqskt7nx84qd8v6lgxeg90kc8dfzpcg9xl8nuhvdesgq5cz6ejq83vk60hpns2c2kwh';
const poolId = 'pool1nmfr5j5rnqndprtazre802glpc3h865sy50mxdny65kfgf3e5eh';
const stakeAddress = 'stake_test1ur5rv5zhmvrk53quyzn0ne7tkxucyq2vpdveqrcktd8msec8els9q';
const credential = { type: Cardano.CredentialType.KeyHash, hash: 'e8365057db076a441c20a6f9e7cbb1b982014c0b59900f165b4fb867' as Cardano.Credential['hash'] };

function transaction(certificates: Cardano.Certificate[]): Cardano.Tx {
  return { id: Cardano.TransactionId('0'.repeat(64)), body: { inputs: [], outputs: [{ address: address as Cardano.PaymentAddress, value: { coins: 4000000n } }], fee: 178000n, certificates }, witness: { signatures: new Map() } };
}

function fresh(account: Record<string, unknown>) {
  vi.mocked(Messaging.sendToBackgroundFromOptions).mockResolvedValue({ data: account });
}

describe('stake transaction registration preflight', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.assign(walletStore, {
      loggedWallet: { id: 1, stakeAddress, network: Network.PREPROD, chain: Blockchain.CARDANO, type: WalletType.Normal },
      account: { controlled_amount: '9997276308' }, // The balance-only record from the failed Preprod run.
      keys: { stake: [{ cred: credential.hash }], payment: [{ address }] },
    });
    fresh({ active: true, pool_id: 'pool1existing', drep_id: 'drep_always_abstain' });
    vi.mocked(featureFlagsStore.isNexusDelegateEnabled).mockReturnValue(true);
    vi.mocked(featureFlagsStore.isNexusVoteDelegationEnabled).mockReturnValue(true);
    vi.mocked(featureFlagsStore.isNexusUnstakeEnabled).mockReturnValue(true);
    vi.mocked(nexusTxApi.buildDelegationTx).mockImplementation(async () => ({
      tx_cbor: Serialization.Transaction.fromCore(transaction([{ __typename: Cardano.CertificateType.StakeDelegation, stakeCredential: credential, poolId: Cardano.PoolId(poolId) }])).toCbor(),
      tx_hash: '0'.repeat(64),
    }));
    vi.mocked(nexusTxApi.buildVoteDelegationTx).mockImplementation(async () => ({ tx_cbor: Serialization.Transaction.fromCore(transaction([])).toCbor(), tx_hash: '0'.repeat(64) }));
    vi.mocked(nexusTxApi.buildStakeRegistrationTx).mockImplementation(async () => ({ tx_cbor: Serialization.Transaction.fromCore(transaction([])).toCbor(), tx_hash: '0'.repeat(64) }));
    vi.mocked(buildCardanoTransaction).mockImplementation(async ({ certificates }) => transaction(certificates));
  });

  it('builds pool-only redelegation from a balance-only cache, without a second registration', async () => {
    const delegation = useDelegation();
    await delegation.delegate({ pool_id_bech32: poolId });
    expect(Messaging.sendToBackgroundFromOptions).toHaveBeenCalledWith({ method: MessageTypes.REFRESH_STAKE_ACCOUNT, data: { walletId: 1, stakeAddress, network: Network.PREPROD } });
    expect(nexusTxApi.buildVoteDelegationTx).not.toHaveBeenCalled();
    expect(nexusTxApi.buildDelegationTx).toHaveBeenCalledWith(expect.objectContaining({ stakeAddress, poolId }), Network.PREPROD);
    expect(delegation.txData.value?.body.certificates).toEqual([{ __typename: Cardano.CertificateType.StakeDelegation, stakeCredential: credential, poolId }]);
    expect(delegation.isDelegateDialogOpen.value).toBe(true);
  });

  it.each([[WalletType.Normal, false], [WalletType.Trezor, true]])('omits registration and its deposit in the local %s builder', async (type, nexus) => {
    walletStore.loggedWallet.type = type;
    vi.mocked(featureFlagsStore.isNexusDelegateEnabled).mockReturnValue(nexus as boolean);
    await useDelegation().delegate({ pool_id_bech32: poolId });
    expect(buildCardanoTransaction).toHaveBeenCalledWith(expect.objectContaining({
      implicitCoin: 0n, certificates: [{ __typename: Cardano.CertificateType.StakeDelegation, stakeCredential: credential, poolId }],
    }));
  });

  it('includes the deposit only for an explicitly unregistered key in the local builder', async () => {
    fresh({ active: false, pool_id: null, drep_id: null });
    vi.mocked(featureFlagsStore.isNexusDelegateEnabled).mockReturnValue(false);
    await useDelegation().delegate({ pool_id_bech32: poolId });
    expect(buildCardanoTransaction).toHaveBeenCalledWith(expect.objectContaining({
      implicitCoin: 2000000n, certificates: [expect.objectContaining({ __typename: Cardano.CertificateType.StakeVoteRegistrationDelegation, deposit: 2000000n })],
    }));
  });

  it('does not re-register a stake key when changing its DRep from a thin cache', async () => {
    await useDRepDelegation().delegateToPredefined('noConfidence');
    expect(nexusTxApi.buildVoteDelegationTx).toHaveBeenCalledWith(expect.objectContaining({
      drepId: 'drep_always_no_confidence', includeStakeRegistration: false,
    }), Network.PREPROD);
  });

  it('allows unstaking an already registered wallet whose cached stake state is absent', async () => {
    const unstake = useUnstake();
    await unstake.unstake();
    expect(nexusTxApi.buildStakeRegistrationTx).toHaveBeenCalledWith(expect.objectContaining({ deregister: true, stakeAddress }), Network.PREPROD);
    expect(unstake.unstakeDialog.value).toBe(true);
  });

  it('uses freshly fetched rewards when building a deregistration and withdrawal', async () => {
    fresh({ active: true, drep_id: 'drep_always_abstain', withdrawable_amount: '1000000' });
    await useUnstake().unstake();
    expect(nexusTxApi.buildStakeRegistrationTx).not.toHaveBeenCalled();
    expect(buildCardanoTransaction).toHaveBeenCalledWith(expect.objectContaining({
      implicitCoin: -2000000n, withdrawals: [{ stakeAddress, quantity: 1000000n }],
    }));
  });

  it('registers a fresh key even when the cache still describes an old delegation', async () => {
    walletStore.account = { active: true, drep_id: 'drep_always_abstain' } as typeof walletStore.account;
    fresh({ active: false, pool_id: null, drep_id: null });
    await useDelegation().delegate({ pool_id_bech32: poolId });
    expect(nexusTxApi.buildVoteDelegationTx).toHaveBeenCalledWith(expect.objectContaining({ includeStakeRegistration: true }), Network.PREPROD);
  });

  it('adds Abstain without registration for a registered key that has no DRep', async () => {
    fresh({ active: true, pool_id: null, drep_id: null });
    await useDelegation().delegate({ pool_id_bech32: poolId });
    expect(nexusTxApi.buildVoteDelegationTx).toHaveBeenCalledWith(expect.objectContaining({ includeStakeRegistration: false, drepId: 'drep_always_abstain' }), Network.PREPROD);
  });

  it.each([{ data: { controlled_amount: '20000000' } }, { error: 'offline' }, undefined])('does not build or open signing when stake state is unavailable: %j', async response => {
    vi.mocked(Messaging.sendToBackgroundFromOptions).mockResolvedValue(response);
    const delegation = useDelegation();
    await delegation.delegate({ pool_id_bech32: poolId });
    expect(nexusTxApi.buildDelegationTx).not.toHaveBeenCalled();
    expect(nexusTxApi.buildVoteDelegationTx).not.toHaveBeenCalled();
    expect(buildCardanoTransaction).not.toHaveBeenCalled();
    expect(delegation.isDelegateDialogOpen.value).toBe(false);
    expect(snackbar.setError).toHaveBeenCalled();
  });

  it('discards preflight for a wallet switched during the lookup', async () => {
    vi.mocked(Messaging.sendToBackgroundFromOptions).mockImplementation(async () => {
      walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 2 };
      return { data: { active: true } };
    });
    await useDelegation().delegate({ pool_id_bech32: poolId });
    expect(nexusTxApi.buildDelegationTx).not.toHaveBeenCalled();
    expect(nexusTxApi.buildVoteDelegationTx).not.toHaveBeenCalled();
    expect(snackbar.setError).toHaveBeenCalledWith(expect.stringContaining('staking.walletChanged'));
  });

  it.each([true, false])('discards pool delegation after a wallet switch during the %s Nexus build', async nexus => {
    vi.mocked(featureFlagsStore.isNexusDelegateEnabled).mockReturnValue(nexus);
    const switchWallet = async () => {
      walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 2 };
      return transaction([]);
    };
    vi.mocked(nexusTxApi.buildDelegationTx).mockImplementation(async () => ({
      tx_cbor: Serialization.Transaction.fromCore(await switchWallet()).toCbor(), tx_hash: '0'.repeat(64),
    }));
    vi.mocked(buildCardanoTransaction).mockImplementation(switchWallet);
    const delegation = useDelegation();
    await delegation.delegate({ pool_id_bech32: poolId });
    expect(delegation.txData.value).toBeNull();
    expect(delegation.isDelegateDialogOpen.value).toBe(false);
  });

  it.each([true, false])('discards DRep delegation after a wallet switch during the %s Nexus build', async nexus => {
    vi.mocked(featureFlagsStore.isNexusVoteDelegationEnabled).mockReturnValue(nexus);
    const switchWallet = async () => {
      walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 2 };
      return transaction([]);
    };
    vi.mocked(nexusTxApi.buildVoteDelegationTx).mockImplementation(async () => ({
      tx_cbor: Serialization.Transaction.fromCore(await switchWallet()).toCbor(), tx_hash: '0'.repeat(64),
    }));
    vi.mocked(buildCardanoTransaction).mockImplementation(switchWallet);
    const delegation = useDRepDelegation();
    await delegation.delegateToPredefined('abstain');
    expect(delegation.tx.value).toBeUndefined();
    expect(delegation.isDialogOpen.value).toBe(false);
  });

  it.each([true, false])('discards unstaking after a wallet switch during the %s Nexus build', async nexus => {
    vi.mocked(featureFlagsStore.isNexusUnstakeEnabled).mockReturnValue(nexus);
    const switchWallet = async () => {
      walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 2 };
      return transaction([]);
    };
    vi.mocked(nexusTxApi.buildStakeRegistrationTx).mockImplementation(async () => ({
      tx_cbor: Serialization.Transaction.fromCore(await switchWallet()).toCbor(), tx_hash: '0'.repeat(64),
    }));
    vi.mocked(buildCardanoTransaction).mockImplementation(switchWallet);
    const unstake = useUnstake();
    await unstake.unstake();
    expect(unstake.txData.value).toBeNull();
    expect(unstake.unstakeDialog.value).toBe(false);
  });
});
