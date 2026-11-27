// The vault screen's DUST panel and the signatures screen driven as owners would: the proposer
// picks one of this wallet's Midnight DUST addresses and proposes the registration; the sheet names
// it; the proposer's background signs with the payment, stake and collateral keys; a co-owner's
// file adds the second payment and stake signatures; the transaction goes out with the stake
// script, the mapping validator and exactly the threshold of each. Signing runs through the real
// background flow on keys generated here; only messaging, the password check, the stored key and
// the Nexus reads are stood in for.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { geroStore } from '@/stores/geroStore';
import { networkStore } from '@/stores/networkStore';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import type { VaultChainReader, VaultRecord } from '@/modules/gerovault/contracts';
import { GEROVAULT_IMPORT_SIGNATURES_ROUTE, GEROVAULT_VAULT_ROUTE } from '@/modules/gerovault/gerovaultRoutes';
import GerovaultImportSignatures from '@/modules/gerovault/views/GerovaultImportSignatures.vue';
import { VAULT_CHAIN_READER_KEY } from '@/modules/gerovault/spend/chainReader';
import { clearSpendSession, spendSession, spendSessionKey } from '@/modules/gerovault/spend/spendSession';
import { signVaultBundleFlow } from '@/modules/gerovault/spend/signBundleFlow';
import { signingFileText } from '@/modules/gerovault/spend/bundle';
import { witnessKeyHashes } from '@/modules/gerovault/spend/witnesses';
import { fundingTransaction, lovelaceOutput, testOwner, testReader, testVaultRecord, type TestOwner } from '@/modules/gerovault/spend/__fixtures__/testVault';
import { WalletType } from '@/models/types';
import VaultDustPanel from './components/VaultDustPanel.vue';
import { cnightAssetOf, dustAddressOf, mappingValidatorFor } from './mappingValidator';
import { OPERATION_PARAMS, TEST_DUST_HEX, collateralWallet, ownerOfWallet, type CollateralWallet } from './__fixtures__/dustVault';

const files = vi.hoisted(() => ({ saved: [] as { name: string; text: string }[] }));
vi.mock('@/modules/gerovault/spend/files', async (original) => ({
  ...(await original<typeof import('@/modules/gerovault/spend/files')>()),
  saveTextFile: (name: string, text: string) => files.saved.push({ name, text }),
}));

const store = vi.hoisted(() => ({ records: new Map<number, VaultRecord[]>() }));
vi.mock('@/db/vaultStore', () => ({
  vaultStore: {
    get: async (walletId: number, vaultId: string) => store.records.get(walletId)?.find(r => r.vaultId === vaultId),
    list: async (walletId: number) => store.records.get(walletId) ?? [],
  },
}));

const chainState = vi.hoisted(() => ({ registered: true as boolean | null, generation: { registered: false } as Record<string, unknown> }));
vi.mock('./dustChain', async (original) => ({
  ...(await original<typeof import('./dustChain')>()),
  readStakeAccount: async () => ({ registered: chainState.registered, rewards: 0n }),
  readGeneration: async (_network: string, rewardAccount: string) => ({ cardanoRewardAddress: rewardAccount, dustAddress: null, ...chainState.generation }),
}));

const keys = vi.hoisted(() => ({ rootKey: new Uint8Array() as Uint8Array }));
vi.mock('@/modules/gerovault/spend/signClient', async (original) => {
  const real = await original<typeof import('@/modules/gerovault/spend/signClient')>();
  const { signVaultBundleFlow: flow } = await import('@/modules/gerovault/spend/signBundleFlow');
  const { walletStore: wallets } = await import('@/stores/walletStore');
  return {
    ...real,
    requestVaultWitnessFile: (input: Parameters<typeof real.requestVaultWitnessFile>[0]) => real.requestVaultWitnessFile(input, async ({ data }) => {
      try {
        const witnessFile = await flow(data as never, {
          wallet: () => wallets.loggedWallet as never,
          verifyPassword: async (password: string) => password === 'right',
          decryptRootKey: () => Uint8Array.from(keys.rootKey),
          getVault: async (walletId: number, vaultId: string) => store.records.get(walletId)?.find(r => r.vaultId === vaultId),
          acceptedVaults: async (walletId: number) => store.records.get(walletId) ?? [],
          currentSlot: () => TIP,
        });
        return { data: { success: true, witnessFile } };
      } catch (error) {
        const { code, detail } = error as { code?: string; detail?: string };
        return { data: { success: false, error: code, detail } };
      }
    }),
  };
});

enableAutoUnmount(afterEach);

const TIP = 90_000_000;
const $t = (key: string, params?: Record<string, unknown>): string => (params ? `${key} ${JSON.stringify(params)}` : key);
const blank = { render: () => null };
const DUST_ADDRESS = dustAddressOf('preprod', TEST_DUST_HEX);
const CNIGHT = Cardano.AssetId(`${cnightAssetOf('preprod')!.policyId}${cnightAssetOf('preprod')!.assetNameHex}`);

let wallet: CollateralWallet;
let owners: TestOwner[];
let records: VaultRecord[];
let reader: VaultChainReader;
let submitted: string[];
let vaultUtxos: Cardano.Utxo[];

beforeAll(async () => {
  wallet = await collateralWallet();
  owners = [await ownerOfWallet(wallet, 1), await testOwner(2), await testOwner(3)];
  records = await Promise.all(owners.map((_, i) => testVaultRecord(owners, 2, i, { name: 'Treasury' })));
});

beforeEach(async () => {
  files.saved.length = 0;
  clearSpendSession(spendSessionKey(10, records[0].vaultId));
  chainState.registered = true;
  chainState.generation = { registered: false };
  const base = (await import('@/modules/gerovault/spend/vaultSpendContext')).vaultBaseAddress('preprod', records[0].paymentScriptHash, records[0].stakeScriptHash).bech32;
  const funding = fundingTransaction([lovelaceOutput(base, 30_000_000n), lovelaceOutput(base, 2_000_000n, new Map([[CNIGHT, 2_500_000n]]))]);
  const walletFunding = fundingTransaction([lovelaceOutput(wallet.address, 9_000_000n)], 3);
  ({ reader, submitted } = testReader([funding, walletFunding]));
  // The reader answers by address: the vault, the proposer's first address, the validator (empty).
  reader.utxos = vi.fn(async (address: string) => (address === base ? funding.utxos : address === wallet.address ? walletFunding.utxos : []));
  vaultUtxos = funding.utxos;
  networkStore.epochParams = { ...OPERATION_PARAMS } as never;
  networkStore.tip = { slot: TIP, time: 0, epoch: 1, epoch_slot: 0 } as never;
  geroStore.wallets = {
    77: { id: 77, name: 'Night', chain: Blockchain.MIDNIGHT, network: 'Preprod', publicKey: JSON.stringify({ dust: DUST_ADDRESS }) },
  } as never;
});

function loginAs(who: number): void {
  walletStore.loggedWallet = {
    id: 10 + who, network: 'Preprod', type: WalletType.Normal, encryptionMethod: 'password', encryptedPrivateKey: 'sealed', chain: Blockchain.CARDANO,
    ...(who === 0 ? { publicKey: wallet.publicKey, accountIndex: wallet.accountIndex } : {}),
  } as never;
  store.records.set(10 + who, [records[who]]);
  keys.rootKey = owners[who].rootKey;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await flushPromises();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

function global() {
  return {
    plugins: [createTestVuetify()],
    provide: { [VAULT_CHAIN_READER_KEY as symbol]: () => reader },
    config: { globalProperties: mockGlobalProperties({ $t }) },
  };
}

async function openSignatures(who: number): Promise<VueWrapper> {
  loginAs(who);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: blank },
      { path: '/vaults/:vaultId', name: GEROVAULT_VAULT_ROUTE, component: blank },
      { path: '/vaults/:vaultId/import-signatures', name: GEROVAULT_IMPORT_SIGNATURES_ROUTE, component: GerovaultImportSignatures },
    ],
  });
  await router.push(`/vaults/${records[who].vaultId}/import-signatures`);
  await router.isReady();
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), { attachTo: document.body, global: { ...global(), plugins: [createTestVuetify(), router] } });
  await settle();
  return wrapper;
}

describe('the vault DUST panel', () => {
  it('shows the cNIGHT, the stake state and this wallet\'s DUST addresses, and offers no stake registration when there is one', async () => {
    loginAs(0);
    const panel = mount(VaultDustPanel, { props: { record: records[0], utxos: vaultUtxos }, global: global() });
    await settle();
    expect(panel.get('[data-test="vault-dust-cnight"]').text()).toBe('2.5 NIGHT');
    expect(panel.get('[data-test="vault-dust-stake"]').text()).toBe('gerovault.dust.stake.registered');
    expect(panel.get('[data-test="vault-dust-registration"]').text()).toContain('gerovault.dust.registration.none');
    expect(panel.get('[data-test="vault-dust-generation"]').text()).toContain('gerovault.dust.midnight.inactive');
    expect(panel.text()).toContain('gerovault.dust.fact.key');
    expect(panel.text()).toContain('gerovault.dust.fact.forks');
    expect(panel.find('[data-test="vault-dust-register-stake"]').exists()).toBe(false);
  });

  it('asks for the stake registration first when the credential is not registered', async () => {
    chainState.registered = false;
    loginAs(0);
    const panel = mount(VaultDustPanel, { props: { record: records[0], utxos: vaultUtxos }, global: global() });
    await settle();
    expect(panel.find('[data-test="vault-dust-register-stake"]').exists()).toBe(true);
    expect(panel.get('[data-test="vault-dust-register-dust"]').attributes('disabled')).toBeDefined();
  });

  it('is not offered for a candidate vault', async () => {
    loginAs(0);
    const panel = mount(VaultDustPanel, { props: { record: { ...records[0], status: 'candidate' }, utxos: vaultUtxos }, global: global() });
    await settle();
    expect(panel.find('[data-test="vault-dust-unavailable"]').exists()).toBe(true);
  });

  it('proposes the registration, and the owners sign and submit it on the signatures screen', async () => {
    loginAs(0);
    const panel = mount(VaultDustPanel, { props: { record: records[0], utxos: vaultUtxos }, global: global() });
    await settle();
    await panel.get('[data-test="vault-dust-register-dust"]').trigger('click');
    await settle();
    expect(panel.find('[data-test="vault-dust-build-error"]').exists()).toBe(false);
    expect(panel.find('[data-test="vault-dust-proposed"]').exists()).toBe(true);
    await panel.get('[data-test="vault-dust-save"]').trigger('click');
    expect(files.saved[0].name).toMatch(/\.gvtx\.json$/);
    const session = spendSession(spendSessionKey(10, records[0].vaultId))!;
    expect(session).toBeDefined();
    panel.unmount();

    // The co-owner signs on their own device (their background, their keys).
    loginAs(1);
    const theirs = await signVaultBundleFlow({ walletId: 11, vaultId: records[1].vaultId, bundle: session.bundle, password: 'right' }, {
      wallet: () => walletStore.loggedWallet as never,
      verifyPassword: async () => true,
      decryptRootKey: () => Uint8Array.from(owners[1].rootKey),
      getVault: async () => records[1],
      acceptedVaults: async () => [records[1]],
      currentSlot: () => TIP,
    });

    const collect = await openSignatures(0);
    const sheet = collect.get('[data-test="approval-sheet"]');
    expect(sheet.get('[data-test="sheet-operation"]').text()).toContain('gerovault.dust.op.dustRegister');
    expect(sheet.get('[data-test="sheet-dust-address"]').text()).toContain(DUST_ADDRESS.slice(0, 5));
    expect(sheet.get('[data-test="sheet-collateral"]').text()).toContain('gerovault.dust.sheet.collateralOwn');
    expect(collect.get('[data-test="signer-collateral"]').text()).toContain('gerovault.spend.signers.waiting');

    await collect.get('[data-test="sign-panel"] input[type="password"]').setValue('right');
    await collect.get('[data-test="sign-panel"] form').trigger('submit');
    await settle();
    expect(collect.find('[data-test="sign-error"]').exists()).toBe(false);
    expect(collect.get('[data-test="signer-collateral"]').text()).toContain('gerovault.spend.signers.signed');

    const input = collect.get('[data-test="witness-input"]').element as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([signingFileText(theirs)], 'co-owner.gvsig.json', { type: 'application/json' })] });
    await collect.get('[data-test="witness-input"]').trigger('change');
    await settle();
    expect(collect.get('[data-test="signers-progress"]').text()).toContain('"collected":2');
    await collect.get('[data-test="submit"]').trigger('click');
    await settle();
    expect(collect.find('[data-test="submit-error"]').exists()).toBe(false);
    expect(submitted).toHaveLength(1);

    const tx = Serialization.Transaction.fromCbor(submitted[0] as Serialization.TxCBOR);
    expect(tx.witnessSet().plutusV3Scripts()!.toCore().map(s => String(s.bytes))).toEqual([mappingValidatorFor('preprod')!.scriptCbor]);
    expect(tx.witnessSet().nativeScripts()!.size()).toBe(2);
    const hashes = await witnessKeyHashes(submitted[0]);
    expect(hashes).toHaveLength(5);
    expect(hashes).toContain(wallet.paymentKeyHash);
    expect(String(tx.getId())).toBe(session.bundle.txId);
  });
});
