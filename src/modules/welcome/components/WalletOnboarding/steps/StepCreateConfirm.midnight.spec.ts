import 'fake-indexeddb/auto';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StepCreateConfirm from './StepCreateConfirm.vue';
import networks from '@/utils/networks';
import { Blockchain, Network, Theme, type Wallet } from '@/models/types';
import { createAccountWallet, createNewWallet, getAllWallets, getDb } from '@/db/gero-db';
import { getDb as getWalletDb } from '@/db/wallet-db';

const { login, setError, addresses, addressesAt, deriveMidnightAddresses } = vi.hoisted(() => {
  const addresses = { unshielded: 'synthetic-unshielded', shielded: 'synthetic-shielded', dust: 'synthetic-dust' };
  /** Account N's synthetic addresses; account #0's are `addresses`. */
  const addressesAt = (account = 0) => (account === 0 ? addresses
    : { unshielded: `synthetic-unshielded-${account}`, shielded: `synthetic-shielded-${account}`, dust: `synthetic-dust-${account}` });
  return {
    login: vi.fn(async () => ({})),
    setError: vi.fn(),
    addresses,
    addressesAt,
    deriveMidnightAddresses: vi.fn(async (_mnemonic: string, _network: string, account?: number) => addressesAt(account)),
  };
});

// The UI and database/encryption code are real. Only address derivation,
// physical credential registration and the post-create background login stop
// at their boundaries; no test writes the backup flag it later asserts.
vi.mock('@/chains/midnight/midnightKeyManager', () => ({
  deriveMidnightAddresses,
  deriveMidnightAccountPublicKey: async (mnemonic: string, network: string, account: number) =>
    JSON.stringify(await deriveMidnightAddresses(mnemonic, network, account)),
}));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: login } }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key, tc: (key: string) => key } }));
vi.mock('@/shared/utils/webauthn-prf', async importOriginal => ({
  ...await importOriginal<typeof import('@/shared/utils/webauthn-prf')>(),
  registerWebAuthnCredentialWithPrf: vi.fn(async () => ({
    credentialId: 'c3ludGhldGljLWNyZWRlbnRpYWw=', prfEnabled: true,
    prfOutput: new Uint8Array(32).fill(7).buffer, transports: ['internal'],
  })),
}));
vi.mock('@/stores/geroStore', () => ({ default: {
  createNewWallet: async (...args: Parameters<typeof createNewWallet>) => {
    const id = await createNewWallet(...args);
    return (await getAllWallets())[id];
  },
  addAccounts: async (parentId: number, accounts: Parameters<typeof createAccountWallet>[1][]) => {
    const created: Wallet[] = [];
    for (const account of accounts) created.push(await createAccountWallet(parentId, account));
    return created;
  },
} }));

beforeEach(async () => {
  vi.clearAllMocks();
  await (await getDb()).table('wallets').clear();
});

async function backupStatus(id: number) {
  const rows = await (await getWalletDb(id)).table('config').toArray();
  return rows.find((row: { key: string; value: unknown }) => row.key === 'backup')?.value;
}

describe('Midnight recovery phrase backup on creation (#1333)', () => {
  for (const securityMethod of ['password', 'prf'] as const) {
    it(`keeps a new ${securityMethod} wallet pending backup in the real database`, async () => {
      const wrapper = mount(StepCreateConfirm, {
        props: { name: 'Synthetic Midnight', securityMethod, network: networks.resolveNetwork(Blockchain.MIDNIGHT, Network.PREPROD) },
        global: {
          plugins: [createTestVuetify()],
          config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key, $router: { push: vi.fn(async () => {}) }, $snackbar: { setError } }) },
        },
      });
      try {
        for (const input of wrapper.findAll('input[type=password]')) await input.setValue('Valid-Pass-123!');
        for (const box of wrapper.findAll('input[type=checkbox]')) await box.setValue(true);
        const button = wrapper.find('button.step-next');
        await vi.waitFor(() => expect(button.attributes('disabled')).toBeUndefined());
        await button.trigger('click');
        await vi.waitFor(() => expect(login).toHaveBeenCalled(), { timeout: 10_000 });
        await flushPromises();
        expect(setError).not.toHaveBeenCalled();
        const wallets = Object.values(await getAllWallets()) as Wallet[];
        expect(wallets).toHaveLength(1);
        expect(wallets[0].encryptionMethod).toBe(securityMethod);
        expect(securityMethod === 'prf' ? wallets[0].prfEncryptedMnemonic : wallets[0].encryptedMnemonic).toBeTruthy();
        expect(await backupStatus(wallets[0].id)).toBe(false);
      } finally { wrapper.unmount(); }
    });
  }

  it('continues to mark a typed recovery phrase as restored', async () => {
    const mnemonic = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
    const id = await createNewWallet('Restored Midnight', 'icon', Theme.GERO, mnemonic, 'Valid-Pass-123!', Blockchain.MIDNIGHT, Network.PREPROD, undefined, { midnightAddresses: addresses });
    expect(await backupStatus(id)).toBe(true);
  });
});

describe('creating a Midnight wallet with several accounts (#1330)', () => {
  it('derives every account from the one generated phrase and adds them under account #0', async () => {
    const wrapper = mount(StepCreateConfirm, {
      props: { name: 'Synthetic Midnight', securityMethod: 'password', accountCount: 3, network: networks.resolveNetwork(Blockchain.MIDNIGHT, Network.PREPROD) },
      global: {
        plugins: [createTestVuetify()],
        config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key, $router: { push: vi.fn(async () => {}) }, $snackbar: { setError } }) },
      },
    });
    try {
      for (const input of wrapper.findAll('input[type=password]')) await input.setValue('Valid-Pass-123!');
      for (const box of wrapper.findAll('input[type=checkbox]')) await box.setValue(true);
      const button = wrapper.find('button.step-next');
      await vi.waitFor(() => expect(button.attributes('disabled')).toBeUndefined());
      await button.trigger('click');
      await vi.waitFor(() => expect(login).toHaveBeenCalled(), { timeout: 10_000 });
      await flushPromises();

      expect(setError).not.toHaveBeenCalled();
      const phrases = new Set(deriveMidnightAddresses.mock.calls.map(([mnemonic]) => mnemonic));
      expect(phrases.size).toBe(1);
      const wallets = (Object.values(await getAllWallets()) as Wallet[]).sort((a, b) => (a.accountIndex ?? 0) - (b.accountIndex ?? 0));
      expect(wallets.map((wallet) => wallet.accountIndex ?? 0)).toEqual([0, 1, 2]);
      const [head, ...others] = wallets;
      expect(JSON.parse(head.publicKey!).unshielded).toBe(addresses.unshielded);
      expect(head.encryptedMnemonic).toBeTruthy();
      for (const [i, account] of others.entries()) {
        expect(account.parentWalletId).toBe(head.id);
        expect(JSON.parse(account.publicKey!)).toEqual(addressesAt(i + 1));
        expect(account.encryptedMnemonic).toBeUndefined();
      }
      // The phrase is new, so the wallet still asks for its backup.
      expect(await backupStatus(head.id)).toBe(false);
    } finally { wrapper.unmount(); }
  });
});
