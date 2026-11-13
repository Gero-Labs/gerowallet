import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WalletType } from '@/models/types';
import { votingCapability, useVoting, resetDrepRegistration } from '@/shared/composables/useVoting';

const CRED = '463796d2a39623a5441e9eab1594c2d21f96d2a544f49f82bc023bff';
const TX_A = '941502b0aa104c850d1979232594459ad5be55bd7b18b6285bbaa32d5566213d';

let { mockWalletStore, mockNetworkStore, mockBuildCardanoTransaction, mockGetDRepById } = vi.hoisted(() => {
  const mockBuildCardanoTransaction = vi.fn();
  const mockGetDRepById = vi.fn();
  const mockWalletStore: Record<string, unknown> = {};
  const mockNetworkStore: Record<string, unknown> = {};
  return { mockWalletStore, mockNetworkStore, mockBuildCardanoTransaction, mockGetDRepById };
});

vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: (mockWalletStore = reactive(mockWalletStore)) };
});
vi.mock('@/stores/networkStore', async () => {
  const { reactive } = await import('vue');
  return { networkStore: (mockNetworkStore = reactive(mockNetworkStore)) };
});
vi.mock('@/shared/utils/builder', () => ({ buildCardanoTransaction: mockBuildCardanoTransaction }));
vi.mock('@/api/blockchain-api', () => ({ default: { getDRepById: mockGetDRepById } }));

function resetStores() {
  Object.assign(mockWalletStore, {
    loggedWallet: { type: WalletType.Normal, chain: 'cardano', network: 'preprod', stakeAddress: 'stake_test1abc' },
    utxos: [],
    keys: {
      payment: [{ address: 'addr_test1payment', cred: 'cred_payment', path: "m/1852'/1815'/0'/0/0" }],
      change: [],
      stake: [{ address: 'stake_test1abc', cred: 'cred_stake', path: "m/1852'/1815'/0'/2/0" }],
      drep105: [],
      drep129: [{ address: CRED, cred: CRED, path: "m/1852'/1815'/0'/3/0" }],
      ccCold: [],
      ccHot: [],
      script: [],
    },
  });
  Object.assign(mockNetworkStore, {
    epochParams: { stakeKeyDeposit: '2000000' },
    tip: { slot: 1000, time: 1 },
  });
}

describe('votingCapability', () => {
  it('software (Normal) wallets can vote and batch on any network', () => {
    expect(votingCapability(WalletType.Normal, 'mainnet')).toEqual({ canVote: true, canBatch: true });
    expect(votingCapability(WalletType.Normal, 'preprod')).toEqual({ canVote: true, canBatch: true });
  });

  it('Google (MPC software) wallets can vote and batch', () => {
    expect(votingCapability(WalletType.Google, 'preprod')).toEqual({ canVote: true, canBatch: true });
  });

  it('an untyped legacy wallet is treated as software', () => {
    expect(votingCapability(undefined, 'mainnet')).toEqual({ canVote: true, canBatch: true });
  });

  it('Ledger on mainnet votes one at a time, never batched', () => {
    expect(votingCapability(WalletType.Ledger, 'mainnet')).toEqual({
      canVote: true,
      canBatch: false,
      reasonKey: 'governance.ledgerSingleVoteOnly',
    });
  });

  it('Ledger on preprod cannot vote at all (hardcoded mainnet chainId in ledger.ts)', () => {
    expect(votingCapability(WalletType.Ledger, 'preprod')).toEqual({
      canVote: false,
      canBatch: false,
      reasonKey: 'governance.ledgerPreprodUnsupported',
    });
  });

  it('Trezor cannot vote', () => {
    expect(votingCapability(WalletType.Trezor, 'mainnet')).toEqual({
      canVote: false,
      canBatch: false,
      reasonKey: 'governance.trezorVotingUnsupported',
    });
  });

  it('Keystone cannot vote', () => {
    expect(votingCapability(WalletType.Keystone, 'mainnet')).toEqual({
      canVote: false,
      canBatch: false,
      reasonKey: 'governance.keystoneVotingUnsupported',
    });
  });

  it('Watch wallets are read-only', () => {
    expect(votingCapability(WalletType.Watch, 'mainnet')).toEqual({
      canVote: false,
      canBatch: false,
      reasonKey: 'governance.watchWalletReadOnly',
    });
  });
});

describe('useVoting castVotes', () => {
  beforeEach(() => {
    resetStores();
    mockBuildCardanoTransaction.mockReset();
    mockBuildCardanoTransaction.mockResolvedValue({ id: 'unsigned-tx' });
    resetDrepRegistration();
    mockGetDRepById.mockReset();
    mockGetDRepById.mockResolvedValue({ registered: true });
  });

  it('builds the voting procedures from the drep129 key and hands them to the builder', async () => {
    const { castVotes } = useVoting();
    const tx = await castVotes([{ govActionId: `${TX_A}#0`, choice: 'Yes' }]);

    expect(tx).toEqual({ id: 'unsigned-tx' });
    expect(mockBuildCardanoTransaction).toHaveBeenCalledTimes(1);

    const args = mockBuildCardanoTransaction.mock.calls[0][0];
    expect(args.votingProcedures).toHaveLength(1);
    expect(args.votingProcedures[0].voter.credential.hash).toBe(CRED);
    expect(args.votingProcedures[0].votes).toHaveLength(1);
    expect(args.votingProcedures[0].votes[0].actionId).toEqual({ id: TX_A, actionIndex: 0 });
  });

  it('mirrors the delegation flow: change address, tip, epoch params and wallet context', async () => {
    const { castVotes } = useVoting();
    await castVotes([{ govActionId: `${TX_A}#0`, choice: 'Abstain' }]);

    const args = mockBuildCardanoTransaction.mock.calls[0][0];
    expect(args.changeAddress).toBe('addr_test1payment');
    expect(args.epochParams).toEqual({ stakeKeyDeposit: '2000000' });
    expect(args.tip).toEqual({ slot: 1000, time: 1 });
    expect(args.walletContext).toEqual({ keys: (mockWalletStore as { keys: unknown }).keys });
  });

  it('batches several votes into one voter group', async () => {
    const { castVotes } = useVoting();
    await castVotes([
      { govActionId: `${TX_A}#0`, choice: 'Yes' },
      { govActionId: `${'a'.repeat(64)}#2`, choice: 'No' },
    ]);

    const args = mockBuildCardanoTransaction.mock.calls[0][0];
    expect(args.votingProcedures).toHaveLength(1);
    expect(args.votingProcedures[0].votes).toHaveLength(2);
  });

  it('does not sign or submit — it returns exactly what the builder produced', async () => {
    const unsigned = { id: 'unsigned-tx', witness: { signatures: new Map() } };
    mockBuildCardanoTransaction.mockResolvedValue(unsigned);
    const { castVotes } = useVoting();
    await expect(castVotes([{ govActionId: `${TX_A}#0`, choice: 'Yes' }])).resolves.toBe(unsigned);
  });

  it('throws a clean error for a Watch wallet instead of building', async () => {
    (mockWalletStore as { loggedWallet: { type: string } }).loggedWallet.type = WalletType.Watch;
    const { castVotes } = useVoting();
    await expect(castVotes([{ govActionId: `${TX_A}#0`, choice: 'Yes' }])).rejects.toThrow(/cannot cast votes/i);
    expect(mockBuildCardanoTransaction).not.toHaveBeenCalled();
  });

  it('throws a clean error when the wallet has no drep129 key (empty array guard)', async () => {
    (mockWalletStore as { keys: { drep129: unknown[] } }).keys.drep129 = [];
    const { castVotes } = useVoting();
    await expect(castVotes([{ govActionId: `${TX_A}#0`, choice: 'Yes' }])).rejects.toThrow(/drep/i);
    expect(mockBuildCardanoTransaction).not.toHaveBeenCalled();
  });

  it('throws when epoch parameters are missing', async () => {
    (mockNetworkStore as { epochParams: unknown }).epochParams = null;
    const { castVotes } = useVoting();
    await expect(castVotes([{ govActionId: `${TX_A}#0`, choice: 'Yes' }])).rejects.toThrow(/epoch/i);
  });

  it('exposes the capability of the logged wallet', () => {
    (mockWalletStore as { loggedWallet: { type: string; network: string } }).loggedWallet = {
      type: WalletType.Ledger,
      network: 'preprod',
    } as never;
    const { capability } = useVoting();
    expect(capability.value.canVote).toBe(false);
    expect(capability.value.reasonKey).toBe('governance.ledgerPreprodUnsupported');
  });
});

describe('useVoting DRep registration gate (#1091)', () => {
  beforeEach(() => {
    resetStores();
    resetDrepRegistration();
    mockBuildCardanoTransaction.mockReset();
    mockBuildCardanoTransaction.mockResolvedValue({ id: 'unsigned-tx' });
    mockGetDRepById.mockReset();
  });

  it('a derived DRep key with no on-chain record is not registered, and castVotes rejects', async () => {
    mockGetDRepById.mockResolvedValue(null);
    const { castVotes, isRegisteredDrep, loadDrepRegistration } = useVoting();
    await expect(loadDrepRegistration()).resolves.toBe(false);
    expect(isRegisteredDrep.value).toBe(false);
    await expect(castVotes([{ govActionId: `${TX_A}#0`, choice: 'Yes' }])).rejects.toThrow(/not registered/i);
    expect(mockBuildCardanoTransaction).not.toHaveBeenCalled();
  });

  it('a retired DRep (registered: false) is not registered', async () => {
    mockGetDRepById.mockResolvedValue({ registered: false, active: false });
    const { castVotes, isRegisteredDrep, loadDrepRegistration } = useVoting();
    await loadDrepRegistration();
    expect(isRegisteredDrep.value).toBe(false);
    await expect(castVotes([{ govActionId: `${TX_A}#0`, choice: 'Yes' }])).rejects.toThrow(/not registered/i);
  });

  it('an inactive but registered DRep may still vote', async () => {
    mockGetDRepById.mockResolvedValue({ registered: true, active: false });
    const { castVotes, isRegisteredDrep, loadDrepRegistration } = useVoting();
    await loadDrepRegistration();
    expect(isRegisteredDrep.value).toBe(true);
    await expect(castVotes([{ govActionId: `${TX_A}#0`, choice: 'Yes' }])).resolves.toEqual({ id: 'unsigned-tx' });
  });

  it('a lookup failure reads as unregistered and is retried on the next call', async () => {
    mockGetDRepById.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ registered: true });
    const { isRegisteredDrep, loadDrepRegistration } = useVoting();
    await expect(loadDrepRegistration()).resolves.toBe(false);
    expect(isRegisteredDrep.value).toBe(false);
    await expect(loadDrepRegistration()).resolves.toBe(true);
    expect(isRegisteredDrep.value).toBe(true);
  });

  it('shares one answer between callers and never carries it to another wallet', async () => {
    mockGetDRepById.mockResolvedValue({ registered: true });
    await useVoting().loadDrepRegistration();
    expect(useVoting().isRegisteredDrep.value).toBe(true);

    (mockWalletStore as { keys: { drep129: unknown[] } }).keys.drep129 = [
      { address: 'b'.repeat(56), cred: 'b'.repeat(56), path: "m/1852'/1815'/1'/3/0" },
    ];
    expect(useVoting().isRegisteredDrep.value).toBe(false);
  });

  it('castVotes looks the registration up itself when no caller has', async () => {
    mockGetDRepById.mockResolvedValue({ registered: true });
    const { castVotes } = useVoting();
    await castVotes([{ govActionId: `${TX_A}#0`, choice: 'Yes' }]);
    expect(mockGetDRepById).toHaveBeenCalledWith(CRED, 'cardano', 'preprod');
  });
});
