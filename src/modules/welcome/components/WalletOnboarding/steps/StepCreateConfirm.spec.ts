import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StepCreateConfirm from './StepCreateConfirm.vue';
import networks, { type NetworkInfo } from '@/utils/networks';
import { Blockchain, Network } from '@/models/types';
import { deriveAccountXpubsFromMnemonic } from '@/shared/utils/softwareAccounts';

const { createNewWallet, addAccounts, sendToBackground } = vi.hoisted(() => ({
  createNewWallet: vi.fn(),
  addAccounts: vi.fn(async () => []),
  sendToBackground: vi.fn(async () => ({})),
}));

vi.mock('@/stores/geroStore', () => ({ default: { createNewWallet, addAccounts } }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: sendToBackground } }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key, tc: (key: string, count: number) => `${key}:${count}` } }));

const cardano = networks.resolveNetwork(Blockchain.CARDANO, Network.PREPROD);
const bitcoin = networks.resolveNetwork(Blockchain.BITCOIN, Network.TESTNET);
const setError = vi.fn();

/** The wallet gero-db would store: account #0 of the phrase it was given, or of its own. */
const storedWallet = (publicKey?: string) => async (...args: unknown[]) => {
  const [mnemonic, chain, network] = [args[3] as string | null, args[5] as string, args[6] as string];
  const own = mnemonic ? (await deriveAccountXpubsFromMnemonic(mnemonic, [0], { chain, network }))[0].publicKey : 'xpub-generated-inside';
  return { id: 7, publicKey: publicKey ?? own };
};

/** Fill the password path and press Create. */
const create = async (props: { network: NetworkInfo; accountCount?: number }) => {
  const wrapper = mount(StepCreateConfirm, {
    props: { securityMethod: 'password' as const, name: 'Daily', ...props },
    global: {
      plugins: [createTestVuetify()],
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key, $router: { push: vi.fn(async () => {}) }, $snackbar: { setError } }) },
    },
  });
  for (const input of wrapper.findAll('input[type=password]')) await input.setValue('Valid-Pass-123!');
  for (const box of wrapper.findAll('input[type=checkbox]')) await box.setValue(true);
  const button = wrapper.find('button.step-next');
  await vi.waitFor(() => expect(button.attributes('disabled')).toBeUndefined());
  await button.trigger('click');
  await vi.waitFor(() => expect(sendToBackground).toHaveBeenCalled());
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  vi.clearAllMocks();
  createNewWallet.mockImplementation(storedWallet());
});

describe('creating a wallet with several accounts', () => {
  it('reads every account from the phrase it hands gero-db, as a new phrase, and adds the others before login', async () => {
    const wrapper = await create({ network: cardano, accountCount: 3 });
    try {
      const [, , , mnemonic, , , , , options] = createNewWallet.mock.calls[0];
      expect((mnemonic as string).split(' ')).toHaveLength(24);
      expect(options).toMatchObject({ generatedMnemonic: true });

      const [, one, two] = await deriveAccountXpubsFromMnemonic(mnemonic as string, [0, 1, 2]);
      expect(addAccounts).toHaveBeenCalledWith(7, [
        { name: 'accounts.label', publicKey: one.publicKey, accountIndex: 1 },
        { name: 'accounts.label', publicKey: two.publicKey, accountIndex: 2 },
      ]);
      expect(addAccounts.mock.invocationCallOrder[0]).toBeLessThan(sendToBackground.mock.invocationCallOrder[0]);
      expect(setError).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('reads Bitcoin accounts as Bitcoin xpubs', async () => {
    const wrapper = await create({ network: bitcoin, accountCount: 2 });
    try {
      const mnemonic = createNewWallet.mock.calls[0][3] as string;
      const [, one] = await deriveAccountXpubsFromMnemonic(mnemonic, [0, 1], { chain: Blockchain.BITCOIN, network: Network.TESTNET });
      expect(addAccounts).toHaveBeenCalledWith(7, [{ name: 'accounts.label', publicKey: one.publicKey, accountIndex: 1 }]);
    } finally { wrapper.unmount(); }
  });

  it('leaves one account exactly as before: gero-db makes the phrase, nothing else is added', async () => {
    const wrapper = await create({ network: cardano });
    try {
      const [, , , mnemonic, , , , , options] = createNewWallet.mock.calls[0];
      expect(mnemonic).toBeNull();
      expect((options as { generatedMnemonic?: boolean } | undefined)?.generatedMnemonic).toBeUndefined();
      expect(addAccounts).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('adds nothing when the stored account #0 is not the one read from the phrase, and still logs in', async () => {
    createNewWallet.mockImplementation(storedWallet('xpub-someone-else'));
    const wrapper = await create({ network: cardano, accountCount: 3 });
    try {
      expect(addAccounts).not.toHaveBeenCalled();
      expect(setError).toHaveBeenCalledWith('accounts.addLaterCreate');
      expect(sendToBackground).toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
});
