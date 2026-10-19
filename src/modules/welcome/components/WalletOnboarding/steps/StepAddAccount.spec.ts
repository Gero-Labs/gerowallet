import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import networks from '@/utils/networks';
import { Blockchain, Network, WalletType, type Wallet } from '@/models/types';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  addAccounts: vi.fn(),
  push: vi.fn(async () => undefined),
  discover: vi.fn(),
  discoverBitcoin: vi.fn(),
  prf: vi.fn(),
  decryptPrf: vi.fn(),
  decryptPhrase: vi.fn(),
  derive: vi.fn(),
  deriveFromPhrase: vi.fn(),
  wallets: {} as Record<number, unknown>,
}));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn() } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: mocks.send } }));
vi.mock('@/stores/geroStore', () => ({ default: { addAccounts: mocks.addAccounts }, geroStore: { get wallets() { return mocks.wallets; } } }));
vi.mock('@/shared/utils/accountDiscovery', () => ({ discoverAccounts: mocks.discover, discoverBitcoinAccounts: mocks.discoverBitcoin }));
vi.mock('@/shared/utils/passkeyPrf', () => ({ evaluateWalletPrf: mocks.prf }));
vi.mock('@/shared/utils/webauthn-prf', () => ({ decryptPrivateKeyWithPrf: mocks.decryptPrf, decryptMnemonicWithPrfOutput: mocks.decryptPhrase }));
vi.mock('@/shared/utils/softwareAccounts', () => ({ deriveAccountXpubs: mocks.derive, deriveAccountXpubsFromMnemonic: mocks.deriveFromPhrase }));
vi.mock('@cardano-sdk/crypto', () => ({ Bip32PrivateKey: { fromBytes: (bytes: Uint8Array) => ({ bytes }) } }));

import StepAddAccount from './StepAddAccount.vue';

const network = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);
const base = { chain: Blockchain.CARDANO, network: Network.MAINNET, publicKey: 'xpub-0' };
const daily: Wallet = { id: 1, name: 'Daily', type: WalletType.Normal, encryptionMethod: 'password', encryptedPrivateKey: 'sealed', ...base };
const added = { id: 2, name: 'Account #1', type: WalletType.Normal, ...base, publicKey: 'xpub-1', accountIndex: 1, parentWalletId: 1 };

function render(wallet: Wallet) {
  mocks.wallets = { 1: daily, 2: added, [wallet.id]: wallet };
  mocks.discover.mockImplementation(async (_c: string, _n: string, accounts: { accountIndex: number }[]) =>
    accounts.map((account) => ({ ...account, address: 'addr1qxyz', activity: 'unused', balance: '0' })));
  mocks.addAccounts.mockImplementation(async (_id: number, accounts: { accountIndex: number }[]) => accounts.map((a) => ({ id: 40 + a.accountIndex, ...a })));
  return mount(StepAddAccount, {
    props: { network, wallet },
    global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
}
const continueButton = (wrapper: ReturnType<typeof render>) => wrapper.find('button.step-next');

afterEach(() => vi.clearAllMocks());

describe('adding an account to a recovery-phrase wallet', () => {
  it('finds the next free account with the spending password, then adds it and opens it', async () => {
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKey: 'xpub-2' } });
    const wrapper = render(daily);
    expect(wrapper.text()).toContain('accounts.addingAccountTo');

    await wrapper.find('input[type=password]').setValue('right');
    await continueButton(wrapper).trigger('click');
    await flushPromises();

    expect(mocks.send).toHaveBeenCalledWith({ method: 'DERIVE_ACCOUNT_XPUB', data: { walletId: 1, accountIndex: 2, password: 'right' } });
    expect(wrapper.text()).toContain('accounts.label');

    await continueButton(wrapper).trigger('click');
    await flushPromises();

    expect(mocks.addAccounts).toHaveBeenCalledWith(1, [{ name: 'accounts.label', publicKey: 'xpub-2', accountIndex: 2 }]);
    expect(mocks.send).toHaveBeenLastCalledWith({ method: 'LOGIN', data: { wallet: expect.objectContaining({ id: 42 }) } });
    expect(mocks.push).toHaveBeenCalledWith('/');
  });

  it('says so when the password is wrong, and clears it', async () => {
    mocks.send.mockResolvedValueOnce({ data: { success: false, error: 'wrong-password' } });
    const wrapper = render(daily);
    await wrapper.find('input[type=password]').setValue('wrong');
    await continueButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('errors.wrongPassword');
    expect((wrapper.find('input[type=password]').element as HTMLInputElement).value).toBe('');
    expect(mocks.addAccounts).not.toHaveBeenCalled();
  });
});

describe('adding an account to a Google wallet', () => {
  const google: Wallet = { id: 3, name: 'Google', type: WalletType.Google, encryptionMethod: 'mpc', ...base };

  it('uses the unlocked session straight away', async () => {
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKey: 'xpub-1' } });
    render(google);
    await flushPromises();

    expect(mocks.send).toHaveBeenCalledWith({ method: 'DERIVE_ACCOUNT_XPUB', data: { walletId: 3, accountIndex: 1 } });
    expect(mocks.discover).toHaveBeenCalled();
  });

  it('asks to unlock the wallet first when its session is gone', async () => {
    mocks.send.mockResolvedValueOnce({ data: { success: false, error: 'locked' } });
    const wrapper = render(google);
    await flushPromises();

    expect(wrapper.text()).toContain('accounts.unlockToAdd');
  });
});

describe('adding an account to a PassKey wallet', () => {
  const passkey: Wallet = { id: 4, name: 'PassKey', type: WalletType.Normal, encryptionMethod: 'prf', prfEncryptedPrivateKey: 'prf-sealed', webAuthnCredentialId: 'cred', ...base };

  it('derives in the page and wipes the root key', async () => {
    const root = new Uint8Array([7, 7, 7]);
    const prf = new ArrayBuffer(4);
    new Uint8Array(prf).fill(9);
    mocks.prf.mockResolvedValueOnce(prf);
    mocks.decryptPrf.mockResolvedValueOnce(root);
    mocks.derive.mockResolvedValueOnce([{ accountIndex: 0, publicKey: 'XPUB-0' }, { accountIndex: 1, publicKey: 'xpub-1' }]);
    const wrapper = render(passkey);
    await continueButton(wrapper).trigger('click');
    await flushPromises();

    expect(mocks.decryptPrf).toHaveBeenCalledWith('prf-sealed', 'cred', '4', prf);
    expect(mocks.derive).toHaveBeenCalledWith({ bytes: root }, [0, 1]);
    expect(mocks.send).not.toHaveBeenCalled();
    expect([...root, ...new Uint8Array(prf)].every((byte) => byte === 0)).toBe(true);
    expect(wrapper.text()).toContain('accounts.label');
  });

  it('refuses a PassKey that opens another wallet’s key', async () => {
    mocks.prf.mockResolvedValueOnce(new ArrayBuffer(4));
    mocks.decryptPrf.mockResolvedValueOnce(new Uint8Array(3));
    mocks.derive.mockResolvedValueOnce([{ accountIndex: 0, publicKey: 'xpub-other' }, { accountIndex: 1, publicKey: 'xpub-1' }]);
    const wrapper = render(passkey);
    await continueButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('errors.unknownError');
    expect(mocks.discover).not.toHaveBeenCalled();
  });
});

describe('adding an account to a Bitcoin wallet', () => {
  const btcBase = { chain: Blockchain.BITCOIN, network: Network.TESTNET, addressType: 'segwit', publicKey: 'xpubBTC0' };
  const btc: Wallet = { id: 5, name: 'Savings', type: WalletType.Normal, encryptionMethod: 'password', encryptedMnemonic: 'sealed', ...btcBase };

  it('previews the account with the Bitcoin probe', async () => {
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKey: 'xpubBTC1' } });
    mocks.discoverBitcoin.mockResolvedValueOnce([{ accountIndex: 1, publicKey: 'xpubBTC1', keys: [], address: 'tb1qaccount1', stakeAddress: '', activity: 'unused' }]);
    const wrapper = render(btc);
    await wrapper.find('input[type=password]').setValue('right');
    await continueButton(wrapper).trigger('click');
    await flushPromises();

    expect(mocks.send).toHaveBeenCalledWith({ method: 'DERIVE_ACCOUNT_XPUB', data: { walletId: 5, accountIndex: 1, password: 'right' } });
    expect(mocks.discoverBitcoin).toHaveBeenCalledWith(Network.TESTNET, 'segwit', [{ accountIndex: 1, publicKey: 'xpubBTC1', keys: [] }]);
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it('derives a PassKey wallet’s account from its recovery phrase, checked exactly against the stored xpub', async () => {
    const passkeyBtc: Wallet = { ...btc, id: 6, encryptionMethod: 'prf', prfEncryptedMnemonic: 'prf-phrase', webAuthnCredentialId: 'cred', encryptedMnemonic: undefined };
    const prf = new ArrayBuffer(4);
    new Uint8Array(prf).fill(9);
    mocks.prf.mockResolvedValueOnce(prf);
    mocks.decryptPhrase.mockResolvedValueOnce('the phrase');
    mocks.deriveFromPhrase.mockResolvedValueOnce([{ accountIndex: 0, publicKey: 'xpubBTC0', keys: [] }, { accountIndex: 1, publicKey: 'xpubBTC1', keys: [] }]);
    mocks.discoverBitcoin.mockResolvedValueOnce([{ accountIndex: 1, publicKey: 'xpubBTC1', keys: [], address: 'tb1qaccount1', stakeAddress: '', activity: 'used' }]);
    const wrapper = render(passkeyBtc);
    await continueButton(wrapper).trigger('click');
    await flushPromises();

    expect(mocks.decryptPhrase).toHaveBeenCalledWith('prf-phrase', prf, 'cred', '6');
    expect(mocks.deriveFromPhrase).toHaveBeenCalledWith('the phrase', [0, 1], { chain: Blockchain.BITCOIN, network: Network.TESTNET, addressType: 'segwit' });
    expect(mocks.decryptPrf).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(new Uint8Array(prf).every((byte) => byte === 0)).toBe(true);
    expect(wrapper.text()).toContain('accounts.used');
  });

  it('refuses a phrase whose account #0 differs from the stored xpub only in case', async () => {
    const passkeyBtc: Wallet = { ...btc, id: 6, encryptionMethod: 'prf', prfEncryptedMnemonic: 'prf-phrase', webAuthnCredentialId: 'cred' };
    mocks.prf.mockResolvedValueOnce(new ArrayBuffer(4));
    mocks.decryptPhrase.mockResolvedValueOnce('another phrase');
    mocks.deriveFromPhrase.mockResolvedValueOnce([{ accountIndex: 0, publicKey: 'XPUBBTC0', keys: [] }, { accountIndex: 1, publicKey: 'xpubBTC1', keys: [] }]);
    const wrapper = render(passkeyBtc);
    await continueButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('errors.unknownError');
    expect(mocks.discoverBitcoin).not.toHaveBeenCalled();
  });
});
