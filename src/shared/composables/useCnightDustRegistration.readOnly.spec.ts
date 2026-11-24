// A network read-only in GeroWallet (midnightConfig.ts): the cNIGHT DUST
// registration goes through its Nexus routes, which take no writes, so every
// action answers before credentials are used or anything is built.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';

const { api, decrypt, derive } = vi.hoisted(() => ({
  api: { buildDustRegistrationTx: vi.fn(), buildDustDeregistrationTx: vi.fn(), buildDustUpdateTx: vi.fn() },
  decrypt: vi.fn(() => 'the phrase'),
  derive: vi.fn(),
}));
vi.mock('@/stores/walletStore', async () => ({
  walletStore: (await import('vue')).reactive({ loggedWallet: null, tokens: {}, keys: { payment: [{ cred: 'payment-key-hash' }] }, utxos: [] }),
}));
vi.mock('@/stores/geroStore', () => ({ geroStore: { wallets: {} } }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => api, DustAlreadyRegisteredError: class extends Error {} }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('@/shared/utils/crypto', () => ({ decrypt, SecretPurpose: { Mnemonic: 'mnemonic' } }));
vi.mock('@/chains/midnight/midnightKeyManager', () => ({ deriveMidnightAddresses: derive, dustAddressToHex: () => 'hex' }));
vi.mock('@/shared/composables/useDustPending', () => ({
  clearDustPending: vi.fn(), getDustPending: vi.fn(() => null), markDustPending: vi.fn(), reconcileDustPending: vi.fn(),
}));

import { useCnightDustRegistration } from './useCnightDustRegistration';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network, WalletType } from '@/models/types';

const HELD = 'DUST registration on Midnight Preview isn\'t available in GeroWallet yet.';
const logIn = (network: string) => {
  (walletStore as unknown as { loggedWallet: unknown }).loggedWallet = reactive({
    id: 1, chain: Blockchain.CARDANO, network, type: WalletType.Normal, encryptionMethod: 'password',
    encryptedMnemonic: 'sealed', baseAddress: 'addr_test1base', stakeAddress: 'stake_test1stake',
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  api.buildDustRegistrationTx.mockResolvedValue({ status: 'incomplete', note: 'stop here' });
  derive.mockResolvedValue({ dust: 'mn_dust_preprod1x' });
});

describe('cNIGHT DUST registration on a read-only network', () => {
  it('every action answers with the reason, before the phrase is decrypted or Nexus asked', async () => {
    logIn(Network.PREVIEW);
    const flow = useCnightDustRegistration();
    expect(flow.writesHeld.value).toBe(true);
    expect(flow.writesHeldText.value).toBe(HELD);
    for (const result of [
      await flow.register({ password: 'right' }),
      await flow.deregister({ password: 'right' }),
      await flow.deregisterOutpoint({ password: 'right' }, 'aa'.repeat(32), 0),
      await flow.migrateDustAddressToOwn({ password: 'right' }),
    ]) expect(result).toEqual({ status: 'error', message: HELD });
    expect(decrypt).not.toHaveBeenCalled();
    for (const route of Object.values(api)) expect(route).not.toHaveBeenCalled();
  });

  it('a network with open writes goes on to build', async () => {
    logIn(Network.PREPROD);
    const flow = useCnightDustRegistration();
    expect(flow.writesHeld.value).toBe(false);
    expect(flow.writesHeldText.value).toBe('');
    await flow.register({ password: 'right' });
    expect(api.buildDustRegistrationTx).toHaveBeenCalledOnce();
  });
});
