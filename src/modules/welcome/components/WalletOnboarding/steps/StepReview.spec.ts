import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import networks from '@/utils/networks';
import { Blockchain, Network, WalletType } from '@/models/types';
import type { AccountXpub } from '@/shared/utils/walletAccount';

const mocks = vi.hoisted(() => {
  class DuplicateWalletError extends Error {
    constructor(public existingWallet: { name: string }) { super('duplicate'); }
  }
  return { create: vi.fn(), findExisting: vi.fn(), send: vi.fn(), DuplicateWalletError };
});
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string, params?: { index?: number }) => (params?.index !== undefined ? `${key}:${params.index}` : key) } }));
vi.mock('@/stores/geroStore', () => ({ default: { createNewHardwareWallet: mocks.create } }));
vi.mock('@/db/gero-db', () => ({ DuplicateWalletError: mocks.DuplicateWalletError, findExistingWallet: mocks.findExisting }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: mocks.send } }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn(), fireSuccess: vi.fn() } }));

import StepReview from './StepReview.vue';

const network = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);
const account = (accountIndex: number): AccountXpub => ({
  accountIndex, publicKey: `xpub-${accountIndex}`, keys: [{ publicKey: `pk-${accountIndex}`, chainCode: 'cc', path: `m/1852'/1815'/${accountIndex}'` }],
});
const connection = { publicKey: 'xpub-0', keys: [], btSupported: false, xfp: '0a1b2c3d', accounts: [account(0), account(1)] };

let nextId = 50;
function render(accounts: AccountXpub[]) {
  nextId = 50;
  mocks.create.mockImplementation(async (record: Record<string, unknown>) => ({ ...record, id: nextId++ }));
  mocks.send.mockResolvedValue({});
  return mount(StepReview, {
    props: { network, walletType: WalletType.Keystone, connection, name: 'Cold storage', accounts, groupPublicKey: 'xpub-0' },
    global: {
      plugins: [createTestVuetify()],
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key, $router: { push: vi.fn(async () => undefined) } }) },
    },
  });
}

async function create(wrapper: ReturnType<typeof render>) {
  await wrapper.find('input[type=checkbox]').setValue(true);
  await flushPromises();
  await wrapper.find('button.step-next').trigger('click');
  await flushPromises();
  return mocks.create.mock.calls.map(([record]) => record as { name?: string; publicKey?: string; accountIndex?: number; parentWalletId?: number });
}

afterEach(() => vi.clearAllMocks());

describe('adding several accounts', () => {
  it('creates account #0 first, then each account under it', async () => {
    const records = await create(render([account(0), account(1), account(4)]));

    expect(records.map((r) => [r.name, r.publicKey, r.accountIndex, r.parentWalletId])).toEqual([
      ['Cold storage', 'xpub-0', undefined, undefined],
      ['accounts.label:1', 'xpub-1', 1, 50],
      ['accounts.label:4', 'xpub-4', 4, 50],
    ]);
    expect(records[1]).toMatchObject({ type: WalletType.Keystone, chain: Blockchain.CARDANO, network: Network.MAINNET, xfp: '0a1b2c3d' });
    expect(records.every((r) => !('accounts' in r))).toBe(true);
  });

  it('adds the accounts to the stored wallet when account #0 is already in Gero', async () => {
    mocks.findExisting.mockResolvedValue({ id: 7, name: 'Cold storage' });
    const records = await create(render([account(2)]));

    expect(mocks.findExisting).toHaveBeenCalledWith(expect.objectContaining({ publicKey: 'xpub-0' }));
    expect(records.map((r) => [r.accountIndex, r.parentWalletId])).toEqual([[2, 7]]);
  });

  it('skips an account another tab added meanwhile, and logs in to the first one created', async () => {
    mocks.findExisting.mockResolvedValue({ id: 7, name: 'Cold storage' });
    const wrapper = render([account(1), account(2)]);
    mocks.create.mockImplementationOnce(async () => { throw new mocks.DuplicateWalletError({ name: 'Account #1' }); });
    const records = await create(wrapper);

    expect(records.map((r) => r.accountIndex)).toEqual([1, 2]);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ data: { wallet: expect.objectContaining({ accountIndex: 2 }) } }));
  });
});
