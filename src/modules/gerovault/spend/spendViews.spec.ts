// The two spend screens driven as a user would, with a chain reader provided to them: the
// proposer builds, checks the sheet, signs and saves the bundle; a cosigner opens the file, signs
// and saves a signature file; the proposer adds it and submits through the reader at threshold.
// Signing runs on keys generated here; only the password check is replaced. Errors and file
// results are composed in script with the English messages; template text shows its keys.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import type { VaultChainReader, VaultRecord } from '@/modules/gerovault/contracts';
import { GEROVAULT_IMPORT_SIGNATURES_ROUTE, GEROVAULT_SPEND_ROUTE, GEROVAULT_VAULT_ROUTE } from '@/modules/gerovault/gerovaultRoutes';
import GerovaultSpend from '@/modules/gerovault/views/GerovaultSpend.vue';
import GerovaultImportSignatures from '@/modules/gerovault/views/GerovaultImportSignatures.vue';
import { VAULT_CHAIN_READER_KEY } from './chainReader';
import { clearSpendSession, spendSession, spendSessionKey } from './spendSession';
import { TEST_PARAMS, fundingTransaction, lovelaceOutput, payeeAddress, testOwner, testReader, testVaultRecord, type TestOwner } from './__fixtures__/testVault';

const files = vi.hoisted(() => ({ saved: [] as { name: string; text: string }[] }));
vi.mock('./files', async (original) => ({
  ...(await original<typeof import('./files')>()),
  saveTextFile: (name: string, text: string) => files.saved.push({ name, text }),
}));

const store = vi.hoisted(() => ({ records: new Map<number, VaultRecord[]>() }));
vi.mock('@/db/vaultStore', () => ({
  vaultStore: {
    get: async (walletId: number, vaultId: string) => store.records.get(walletId)?.find(r => r.vaultId === vaultId),
    list: async (walletId: number) => store.records.get(walletId) ?? [],
  },
}));

// The background's password check stands in as "the password is right"; the rest is real.
const keys = vi.hoisted(() => ({ rootKey: new Uint8Array() as Uint8Array }));
vi.mock('./signer', async (original) => {
  const real = await original<typeof import('./signer')>();
  return {
    ...real,
    signWithSpendingPassword: (input: Parameters<typeof real.signWithSpendingPassword>[0]) => real.signWithSpendingPassword(input, {
      verifyPassword: async (password: string) => password === 'right',
      openRootKey: async () => Uint8Array.from(keys.rootKey),
    }),
  };
});

enableAutoUnmount(afterEach);

const TIP = 90_000_000;
const $t = (key: string, params?: Record<string, unknown>): string => (params ? `${key} ${JSON.stringify(params)}` : key);
const blank = { render: () => null };

let owners: TestOwner[];
let records: VaultRecord[];
let reader: VaultChainReader;
let submitted: string[];

beforeAll(async () => {
  owners = [await testOwner(1), await testOwner(2), await testOwner(3)];
  records = await Promise.all(owners.map((_, i) => testVaultRecord(owners, 2, i, { name: 'Ops' })));
});

beforeEach(async () => {
  files.saved.length = 0;
  for (const walletId of [10, 11, 12]) clearSpendSession(spendSessionKey(walletId, records[0].vaultId));
  const base = (await import('./vaultSpendContext')).vaultBaseAddress('preprod', records[0].paymentScriptHash, records[0].stakeScriptHash).bech32;
  const funding = fundingTransaction([lovelaceOutput(base, 40_000_000n), lovelaceOutput(base, 30_000_000n)]);
  ({ reader, submitted } = testReader([funding]));
  networkStore.epochParams = { ...TEST_PARAMS } as never;
  networkStore.tip = { slot: TIP, time: 0, epoch: 1, epoch_slot: 0 } as never;
});

/** Opens `path` as the wallet of owner `who`. */
async function openAs(who: number, path: string): Promise<VueWrapper> {
  walletStore.loggedWallet = { id: 10 + who, network: 'Preprod', type: 'Normal', encryptionMethod: 'password', encryptedPrivateKey: 'sealed' };
  store.records.set(10 + who, [records[who]]);
  keys.rootKey = owners[who].rootKey;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: blank },
      { path: '/vaults/:vaultId', name: GEROVAULT_VAULT_ROUTE, component: blank },
      { path: '/vaults/:vaultId/spend', name: GEROVAULT_SPEND_ROUTE, component: GerovaultSpend },
      { path: '/vaults/:vaultId/import-signatures', name: GEROVAULT_IMPORT_SIGNATURES_ROUTE, component: GerovaultImportSignatures },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    attachTo: document.body,
    global: {
      plugins: [createTestVuetify(), router],
      provide: { [VAULT_CHAIN_READER_KEY as symbol]: () => reader },
      config: { globalProperties: mockGlobalProperties({ $t }) },
    },
  });
  await settle();
  return wrapper;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await flushPromises();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function signWith(wrapper: VueWrapper, password: string): Promise<void> {
  await wrapper.get('[data-test="sign-panel"] input[type="password"]').setValue(password);
  await wrapper.get('[data-test="sign-panel"] form').trigger('submit');
  await settle();
}

async function chooseFile(wrapper: VueWrapper, selector: string, name: string, text: string): Promise<void> {
  const input = wrapper.get(selector).element as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], name, { type: 'application/json' })] });
  await wrapper.get(selector).trigger('change');
  await settle();
}

describe('GeroVault spend screens', () => {
  it('proposes, collects a cosigner signature by file and submits at threshold through the reader', async () => {
    // The proposer builds 25 ADA to a payee and reviews the sheet.
    const spend = await openAs(0, `/vaults/${records[0].vaultId}/spend`);
    expect(reader.utxos).toHaveBeenCalled();
    await spend.get('[data-test="recipient-address"] input').setValue(payeeAddress());
    await spend.get('[data-test="recipient-ada"] input').setValue('25');
    await spend.get('[data-test="spend-form"] form').trigger('submit');
    await settle();
    expect(reader.txCbor).toHaveBeenCalled();
    expect(spend.find('[data-test="build-error"]').exists()).toBe(false);
    const sheet = spend.get('[data-test="approval-sheet"]');
    expect(sheet.find('[data-test="sheet-proven"]').exists()).toBe(true);
    expect(sheet.text()).toContain(payeeAddress().slice(0, 5));
    expect(spend.get('[data-test="signers-progress"]').text()).toContain('"collected":0');

    // A wrong password signs nothing; the right one adds this wallet's signature.
    await signWith(spend, 'wrong');
    expect(spend.get('[data-test="sign-error"]').text()).toContain('spending password was not accepted');
    await signWith(spend, 'right');
    expect(spend.get('[data-test="signers-progress"]').text()).toContain('"collected":1');
    await spend.get('[data-test="save-bundle"]').trigger('click');
    expect(files.saved).toHaveLength(1);
    expect(files.saved[0].name).toMatch(/\.gvtx\.json$/);
    const bundleText = files.saved[0].text;
    spend.unmount();

    // The proposer's spend goes on at the signatures screen; the cosigner's wallet has none of it.
    const proposerSession = spendSession(spendSessionKey(10, records[0].vaultId));
    expect(proposerSession?.collection.signatures).toHaveLength(1);

    // A cosigner opens the file on their own device, checks it and signs.
    const cosigner = await openAs(1, `/vaults/${records[1].vaultId}/import-signatures`);
    await chooseFile(cosigner, '[data-test="bundle-input"]', 'proposal.gvtx.json', bundleText);
    expect(cosigner.find('[data-test="open-error"]').exists()).toBe(false);
    expect(cosigner.get('[data-test="approval-sheet"]').find('[data-test="sheet-proven"]').exists()).toBe(true);
    await signWith(cosigner, 'right');
    await cosigner.get('[data-test="save-signature"]').trigger('click');
    const witnessText = files.saved[1].text;
    expect(files.saved[1].name).toMatch(/\.gvsig\.json$/);
    expect(cosigner.get('[data-test="submit"]').attributes('disabled')).toBeDefined();
    cosigner.unmount();

    // Back as the proposer: the signature file is added and the transaction submitted.
    const collect = await openAs(0, `/vaults/${records[0].vaultId}/import-signatures`);
    expect(collect.get('[data-test="submit"]').attributes('disabled')).toBeDefined();
    await chooseFile(collect, '[data-test="witness-input"]', 'cosigner.gvsig.json', witnessText);
    expect(collect.get('[data-test="import-results"]').text()).toContain('cosigner.gvsig.json: signature from');
    expect(collect.get('[data-test="signers-progress"]').text()).toContain('"collected":2');
    await collect.get('[data-test="submit"]').trigger('click');
    await settle();
    expect(reader.submit).toHaveBeenCalledTimes(1);
    expect(submitted).toHaveLength(1);
    expect(collect.get('[data-test="submitted"]').text()).toContain(proposerSession!.bundle.txId);
  });

  it('refuses a file that is not a vault transaction', async () => {
    const collect = await openAs(0, `/vaults/${records[0].vaultId}/import-signatures`);
    await chooseFile(collect, '[data-test="bundle-input"]', 'nonsense.json', '{"type":"something else"}');
    expect(collect.get('[data-test="open-error"]').text()).toContain('not a vault transaction');
  });

  it('tells a hardware wallet that vault signing is not available yet', async () => {
    const spend = await openAs(0, `/vaults/${records[0].vaultId}/spend`);
    walletStore.loggedWallet = { ...walletStore.loggedWallet, type: 'Ledger' };
    await spend.get('[data-test="recipient-address"] input').setValue(payeeAddress());
    await spend.get('[data-test="recipient-ada"] input').setValue('5');
    await spend.get('[data-test="spend-form"] form').trigger('submit');
    await settle();
    expect(spend.get('[data-test="sign-not-yet"]').text()).toContain('gerovault.spend.sign.hardwareNotYet');
    expect(spend.find('[data-test="sign-button"]').exists()).toBe(false);
  });

  it('shows a form error for an address on another network', async () => {
    const spend = await openAs(0, `/vaults/${records[0].vaultId}/spend`);
    await spend.get('[data-test="recipient-address"] input').setValue('addr1vxs6pcvhlmf0wjgcuy0slzyrywl7wqv6nsytu3wu6h9vr0q4cxgrh');
    await spend.get('[data-test="recipient-ada"] input').setValue('5');
    await spend.get('[data-test="spend-form"] form').trigger('submit');
    await settle();
    expect(spend.get('[data-test="recipient"]').text()).toContain('full address on the vault');
    expect(reader.txCbor).not.toHaveBeenCalled();
  });
});
