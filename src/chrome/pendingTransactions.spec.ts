import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

import { WalletBg } from './walletBg';
import WalletStore, { walletStore } from '@/stores/walletStore';
import { Blockchain, type Wallet } from '@/models/types';

vi.stubGlobal('chrome', {
  alarms: {
    getAll: (cb: (alarms: unknown[]) => void) => cb([]), clear: vi.fn(), create: vi.fn(),
    onAlarm: { addListener: vi.fn(), removeListener: vi.fn(), hasListener: () => false },
  },
  storage: { local: { set: vi.fn(), get: vi.fn() } }, runtime: {},
});

const XPUB = 'acct_xvk14hczmhwlqeadp0f3m7vzgda9suxdpl73hvwzk9jhmfm3kzv05hwhyxdd40a0hac6u39ws58ek3y0kkcvwx08ds6s80qhasqqgmtgyzcreur64';
let sequence = 970000;
const wallets: WalletBg[] = [];

afterEach(async () => {
  for (const wallet of wallets.splice(0)) {
    wallet.unsubscribeAll();
    await (await wallet.getDb()).delete();
  }
});

describe('submitted transaction visibility', () => {
  it.each(['send', 'swap', 'delegation', 'withdrawal'])('stores and publishes a pending %s, then replaces it on confirmation', async (kind) => {
    WalletStore.clearForWalletSwitch();
    const bg = new WalletBg({ id: ++sequence, name: 'pending-test', chain: Blockchain.CARDANO, network: 'Preprod', publicKey: XPUB } as Wallet);
    wallets.push(bg);
    bg.syncService.syncAssets = vi.fn().mockResolvedValue(undefined);
    const input: Cardano.Utxo = [
      { txId: Cardano.TransactionId('1'.repeat(64)), index: 0, address: bg.baseAddress as Cardano.PaymentAddress },
      { address: bg.baseAddress as Cardano.PaymentAddress, value: { coins: 10_000_000n } },
    ];
    await WalletStore.setUtxos([input]);
    await bg.loadTransactions();
    const certificates: Cardano.Certificate[] | undefined = kind === 'delegation' ? [{
      __typename: Cardano.CertificateType.StakeDelegation,
      stakeCredential: Cardano.BaseAddress.fromAddress(Cardano.Address.fromBech32(bg.baseAddress)).getStakeCredential(),
      poolId: Cardano.PoolId.fromKeyHash('a'.repeat(56) as Parameters<typeof Cardano.PoolId.fromKeyHash>[0]),
    }] : undefined;
    const outputs = [{ address: input[1].address, value: { coins: kind === 'swap' ? 8_800_000n : kind === 'withdrawal' ? 10_800_000n : 9_800_000n } }];
    if (kind === 'swap') outputs.push({
      address: Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, {
        type: Cardano.CredentialType.ScriptHash,
        hash: 'b'.repeat(56) as Cardano.Credential['hash'],
      }).toAddress().toBech32(), value: { coins: 1_000_000n },
    });
    const tx = Serialization.Transaction.fromCore({
      body: { inputs: [input[0]], outputs, fee: 200_000n, certificates,
        withdrawals: kind === 'withdrawal' ? [{ stakeAddress: bg.stakeAddress as Cardano.RewardAccount, quantity: 1_000_000n }] : undefined,
      },
      witness: { signatures: new Map() }, isValid: true,
    } as Cardano.Tx);
    const hash = tx.body().hash();
    vi.spyOn(bg.api, 'submitTx').mockResolvedValue(hash);
    expect(await bg.submitTx(tx.toCbor(), [input])).toBe(hash);
    await vi.waitFor(() => expect(walletStore.transactions).toHaveLength(1));
    expect(walletStore.transactions[0]).toMatchObject({ id: hash, pending: true, ada: kind === 'swap' ? -1_200_000 : kind === 'withdrawal' ? 800_000 : -200_000 });
    const db = await bg.getDb();
    const stored = await db.table('transactions').get(hash);
    await bg.setAccountTransactions([{ ...stored, pending: false, block_height: 100, tx_timestamp: stored.tx_timestamp + 20 }]);
    await vi.waitFor(() => expect(walletStore.transactions[0].pending).toBe(false));
    expect(walletStore.transactions).toHaveLength(1);
  });
});
