// A Cardano account registering its cNIGHT for DUST sends it, by default, to the
// same account of its recovery phrase on Midnight: Midnight account #N's Cardano
// twin is Cardano account #N, so both flows name the same pair (issue 1330).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';

const { api, deriveMidnightAddresses, wallets } = vi.hoisted(() => ({
  api: { buildDustRegistrationTx: vi.fn() },
  deriveMidnightAddresses: vi.fn(),
  wallets: {} as Record<number, unknown>,
}));
vi.mock('@/stores/walletStore', async () => ({
  walletStore: (await import('vue')).reactive({ loggedWallet: null, tokens: {}, keys: { payment: [{ cred: 'payment-key-hash' }] }, utxos: [] }),
}));
vi.mock('@/stores/geroStore', () => ({ geroStore: { get wallets() { return wallets; } } }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => api, DustAlreadyRegisteredError: class extends Error {} }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('@/shared/utils/crypto', () => ({ decrypt: () => 'the phrase', SecretPurpose: { Mnemonic: 'mnemonic' } }));
vi.mock('@/chains/midnight/midnightKeyManager', () => ({ deriveMidnightAddresses, dustAddressToHex: (address: string) => `hex-of-${address}` }));
vi.mock('@/shared/composables/useDustPending', () => ({
  clearDustPending: vi.fn(), getDustPending: vi.fn(() => null), markDustPending: vi.fn(), reconcileDustPending: vi.fn(),
}));

import { useCnightDustRegistration } from './useCnightDustRegistration';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network, WalletType } from '@/models/types';

const cardano = { chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal, encryptionMethod: 'password', baseAddress: 'addr_test1base', stakeAddress: 'stake_test1stake' };

beforeEach(() => {
  vi.clearAllMocks();
  deriveMidnightAddresses.mockImplementation(async (_phrase: string, _network: string, account = 0) => ({ dust: `mn_dust-addr_preprod1account${account}` }));
  // Stop once the request is built: the destination is all these tests read.
  api.buildDustRegistrationTx.mockResolvedValue({ status: 'incomplete', note: 'stop here' });
});

async function registerFrom(account: Record<string, unknown>) {
  (walletStore as unknown as { loggedWallet: unknown }).loggedWallet = reactive({ ...cardano, encryptedMnemonic: 'sealed', ...account });
  await useCnightDustRegistration().register({ password: 'right' });
  return api.buildDustRegistrationTx.mock.calls[0]?.[0]?.dustAddressHex;
}

describe('the default DUST destination of a Cardano account', () => {
  it('is the same account of the phrase on Midnight', async () => {
    const destination = await registerFrom({ id: 2, accountIndex: 1, parentWalletId: 1, secretsWalletId: 1 });

    expect(deriveMidnightAddresses).toHaveBeenCalledWith('the phrase', Network.PREPROD, 1);
    expect(destination).toBe('hex-of-mn_dust-addr_preprod1account1');
  });

  it('stays Midnight account #0 for account #0', async () => {
    const destination = await registerFrom({ id: 1 });

    expect(destination).toBe('hex-of-mn_dust-addr_preprod1account0');
  });
});

describe('the Midnight wallets offered as a destination', () => {
  it('name an added account with its wallet', () => {
    (walletStore as unknown as { loggedWallet: unknown }).loggedWallet = reactive({ ...cardano, id: 9 });
    const night = { chain: Blockchain.MIDNIGHT, network: Network.PREPROD, type: WalletType.Normal };
    Object.assign(wallets, {
      5: { id: 5, name: 'Night', ...night, publicKey: JSON.stringify({ dust: 'mn_dust-addr_preprod1zero' }) },
      6: { id: 6, name: 'Account #1', ...night, accountIndex: 1, parentWalletId: 5, publicKey: JSON.stringify({ dust: 'mn_dust-addr_preprod1one' }) },
    });

    const labels = useCnightDustRegistration().destinationOptions.value.map((option) => option.label);

    expect(labels).toContain('Night');
    expect(labels).toContain('Night · Account #1');
  });
});
