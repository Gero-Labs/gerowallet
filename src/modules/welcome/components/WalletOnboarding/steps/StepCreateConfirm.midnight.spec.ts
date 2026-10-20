import 'fake-indexeddb/auto';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StepCreateConfirm from './StepCreateConfirm.vue';
import networks from '@/utils/networks';
import { Blockchain, Network, Theme, type Wallet } from '@/models/types';
import { createNewWallet, getAllWallets, getDb } from '@/db/gero-db';
import { getDb as getWalletDb } from '@/db/wallet-db';

const { login, setError, addresses } = vi.hoisted(() => ({
  login: vi.fn(async () => ({})),
  setError: vi.fn(),
  addresses: { unshielded: 'synthetic-unshielded', shielded: 'synthetic-shielded', dust: 'synthetic-dust' },
}));

// The UI and database/encryption code are real. Only address derivation,
// physical credential registration and the post-create background login stop
// at their boundaries; no test writes the backup flag it later asserts.
vi.mock('@/chains/midnight/midnightKeyManager', () => ({ deriveMidnightAddresses: vi.fn(async () => addresses) }));
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
