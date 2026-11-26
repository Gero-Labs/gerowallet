// The create screen, driven through its controls: who may open it, then template, cosigners,
// verify and save against the real vault store (fake IndexedDB). Test keys only; the background
// key request and the chain reader are stand-ins.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, reactive } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { multisigAccountPublicKey, type MultisigAccountPublicKey } from '@/shared/gerovault';
import { testAccounts } from '@/shared/gerovault/__fixtures__/manifest';
import { Blockchain, Network, WalletType } from '@/models/types';

const mocks = vi.hoisted(() => ({
  account: undefined as unknown,
  history: vi.fn(),
  request: vi.fn(),
}));

vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({ loggedWallet: null as unknown }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/gerovault/create/ownAccountKey', () => ({
  requestMultisigAccountKey: mocks.request,
  passKeyMultisigAccountKey: vi.fn(),
}));
vi.mock('@/modules/gerovault/chain/vaultChainReader', () => ({
  createVaultChainReader: () => ({ history: mocks.history }),
}));
// The registration dialog signs through the wallet's own signing path, covered by registrationTx.spec.ts.
vi.mock('@/modules/gerovault/create/RegistrationDialog.vue', () => ({ default: { template: '<div data-test="registration-dialog" />' } }));
vi.mock('@/shared/components/AnimatedQRScanner.vue', () => ({ default: { template: '<div />' } }));

import { walletStore } from '@/stores/walletStore';
import { clearDbCache } from '@/db/wallet-db';
import { vaultStore } from '@/db/vaultStore';
import { ownVaultKeys, shareText } from '@/modules/gerovault/create/createVault';
import { OwnAccountKeyError } from '@/modules/gerovault/create/ownAccountKeyFlow';
import GerovaultCreate from './GerovaultCreate.vue';

enableAutoUnmount(afterEach);

const WALLET_ID = 531200;
let accounts: MultisigAccountPublicKey[];
let texts: string[];

beforeAll(async () => {
  accounts = (await testAccounts()).map(a => multisigAccountPublicKey(a.toPublic().hex()));
  texts = await Promise.all(accounts.map(async (a, i) => shareText((await ownVaultKeys(a, { index: i + 1, reused: false })).encoded)));
});

beforeEach(() => {
  localStorage.clear();
  mocks.request.mockReset().mockImplementation(async (_walletId: number, password?: string) => {
    if (password !== 'right') throw new OwnAccountKeyError('wrong-password');
    return accounts[0];
  });
  mocks.history.mockReset().mockResolvedValue([]);
  (walletStore as unknown as { loggedWallet: unknown }).loggedWallet = reactive({
    id: WALLET_ID,
    chain: Blockchain.CARDANO,
    network: Network.PREPROD,
    type: WalletType.Normal,
    encryptionMethod: 'password',
  });
});

afterEach(async () => {
  clearDbCache(WALLET_ID);
  await Dexie.delete(`wallet-${WALLET_ID}`);
});

const $t = (key: string, values?: Record<string, unknown>): string => (values ? `${key} ${JSON.stringify(values)}` : key);

async function mountCreate() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/vaults', name: 'gerovault', component: { render: () => null } },
      { path: '/vaults/create', name: 'gerovaultCreate', component: GerovaultCreate },
      { path: '/vaults/:vaultId', name: 'gerovaultVault', component: { render: () => null } },
    ],
  });
  await router.push('/vaults/create');
  await router.isReady();
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    global: { plugins: [createTestVuetify(), router], config: { globalProperties: mockGlobalProperties({ $t }) } },
  });
  await flushPromises();
  return { wrapper, router };
}

const byTest = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${id}"]`);

async function click(wrapper: VueWrapper, id: string): Promise<void> {
  await byTest(wrapper, id).trigger('click');
  await flushPromises();
}

async function unlock(wrapper: VueWrapper, password: string): Promise<void> {
  const calls = mocks.request.mock.calls.length;
  await type(wrapper, '[data-test="create-password"]', password);
  await click(wrapper, 'create-unlock');
  await vi.waitFor(() => expect(mocks.request.mock.calls.length).toBe(calls + 1));
  await flushPromises();
}

async function type(wrapper: VueWrapper, selector: string, value: string): Promise<void> {
  const field = wrapper.find(`${selector} input, ${selector} textarea`);
  await field.setValue(value);
  await flushPromises();
}

describe('who may create a vault here', () => {
  it.each([
    ['a mainnet wallet', { network: Network.MAINNET }, 'gerovault.create.unavailable.network'],
    ['a hardware wallet', { type: WalletType.Ledger }, 'gerovault.create.unavailable.wallet'],
    ['an added account', { accountIndex: 1 }, 'gerovault.create.unavailable.wallet'],
  ])('refuses %s and says why', async (_name, overrides, key) => {
    Object.assign((walletStore as unknown as { loggedWallet: object }).loggedWallet, overrides);
    const { wrapper } = await mountCreate();
    expect(byTest(wrapper, 'create-unavailable').text()).toContain('gerovault.createUnavailable');
    expect(wrapper.text()).toContain(key);
    expect(byTest(wrapper, 'create-continue').exists()).toBe(false);
  });
});

describe('creating a vault', () => {
  async function toCosigners() {
    const mounted = await mountCreate();
    const { wrapper } = mounted;
    expect(wrapper.text()).toContain('gerovault.create.template.title');
    await click(wrapper, 'create-continue');
    expect(byTest(wrapper, 'create-own').exists()).toBe(true);
    return mounted;
  }

  async function fillCosigners(wrapper: VueWrapper): Promise<void> {
    await unlock(wrapper, 'right');
    await vi.waitFor(() => expect(byTest(wrapper, 'create-own-keys').text()).toBe(texts[0]));
    for (const [n, label, keys] of [[2, 'Dana', texts[1]], [3, 'Yuval', texts[2]]] as const) {
      await type(wrapper, `[data-test="create-cosigner-${n}"] [data-test="create-cosigner-label"]`, label);
      await type(wrapper, `[data-test="create-cosigner-${n}"] [data-test="create-cosigner-keys"]`, keys);
    }
    await vi.waitFor(() => expect(wrapper.findAll('[data-test="create-cosigner-ready"]')).toHaveLength(2));
  }

  it('asks for the acknowledgement before an all-owners vault', async () => {
    const { wrapper } = await mountCreate();
    await byTest(wrapper, 'create-threshold').get('[data-test="count-increase"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('gerovault.create.template.allOwnersWarning');
    expect(byTest(wrapper, 'create-continue').attributes('disabled')).toBeDefined();
    await byTest(wrapper, 'create-acknowledge').find('input').setValue(true);
    await flushPromises();
    expect(byTest(wrapper, 'create-continue').attributes('disabled')).toBeUndefined();
  });

  it('says when the password is wrong, and shows the keys to share once it is right', async () => {
    const { wrapper } = await toCosigners();
    await unlock(wrapper, 'wrong');
    await vi.waitFor(() => expect(wrapper.text()).toContain('gerovault.create.own.problem.wrongPassword'));
    expect(mocks.request).toHaveBeenCalledWith(WALLET_ID, 'wrong');
    await unlock(wrapper, 'right');
    await vi.waitFor(() => expect(byTest(wrapper, 'create-own-keys').text()).toBe(texts[0]));
  });

  it('flags a cosigner who sent this wallet\'s own keys and keeps Continue off', async () => {
    const { wrapper } = await toCosigners();
    await unlock(wrapper, 'right');
    await vi.waitFor(() => expect(byTest(wrapper, 'create-own-keys').exists()).toBe(true));
    await type(wrapper, '[data-test="create-cosigner-2"] [data-test="create-cosigner-label"]', 'Me');
    await type(wrapper, '[data-test="create-cosigner-2"] [data-test="create-cosigner-keys"]', texts[0]);
    await vi.waitFor(() => expect(wrapper.text()).toContain('gerovault.create.cosigner.problem.sameAsYours'));
    expect(byTest(wrapper, 'create-continue').attributes('disabled')).toBeDefined();
  });

  it('verifies, keeps funding closed, saves, and shows the technical layer on demand', async () => {
    mocks.history.mockResolvedValue([{ txHash: 'ab'.repeat(32), blockHeight: 1, blockTime: 1 }]);
    const { wrapper } = await toCosigners();
    await fillCosigners(wrapper);
    await click(wrapper, 'create-continue');

    const groups = byTest(wrapper, 'create-verify-number').findAll('li');
    expect(groups).toHaveLength(8);
    for (const group of groups) expect(group.text()).toMatch(/^[0-9]{5}$/);
    expect(wrapper.text()).toContain('gerovault.create.verify.notRecoveryWords');
    expect(byTest(wrapper, 'create-verify-qr').exists()).toBe(true);
    await vi.waitFor(() => expect(byTest(wrapper, 'create-address-used').exists()).toBe(true));

    // Dana read the same number: confirm it.
    await click(wrapper, 'create-number-match');
    await click(wrapper, 'create-number-yes');
    expect(wrapper.text()).toContain('gerovault.create.holders.state.byNumber');
    expect(wrapper.text()).toContain('gerovault.create.holders.progress {"verified":1,"total":2}');
    expect(byTest(wrapper, 'create-fund').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('gerovault.create.funding.closed');

    // The technical layer: the full vault id and the scripts.
    expect(byTest(wrapper, 'create-vault-details').exists()).toBe(false);
    await wrapper.get('[role="switch"]').trigger('click');
    expect(byTest(wrapper, 'create-vault-details').exists()).toBe(true);

    await click(wrapper, 'create-save');
    await vi.waitFor(() => expect(byTest(wrapper, 'create-saved').exists()).toBe(true));
    const [stored] = await vaultStore.list(WALLET_ID);
    expect(stored).toMatchObject({ status: 'accepted', ownIndex: 1, origin: 'created' });
    expect(stored.verifications.map(r => r.method)).toEqual(['number']);
    expect(byTest(wrapper, 'create-open').attributes('href')).toContain(stored.vaultId);
    expect(byTest(wrapper, 'create-back').attributes('disabled')).toBeDefined();

    await click(wrapper, 'create-register');
    expect(byTest(wrapper, 'registration-dialog').exists()).toBe(true);
  });
});
