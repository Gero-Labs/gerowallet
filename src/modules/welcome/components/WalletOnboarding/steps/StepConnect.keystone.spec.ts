// Pairing a Keystone as a Bitcoin wallet: the device answers the pairing QR with a
// crypto-multi-accounts UR, which used to fail with "Expected a crypto-hdkey response"
// (issue 1326). The step now pairs the account it asked for.
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { CryptoHDKey, CryptoKeypath, CryptoMultiAccounts, PathComponent } from '@keystonehq/bc-ur-registry';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from 'bip39';
import { Blockchain, Network, WalletType } from '@/models/types';
import networks from '@/utils/networks';

// The Keystone registry is externalized to Node and decodes Node Buffers, while the
// sources get the polyfill. Hand the sources Node's Buffer too (the bundles use one Buffer).
vi.mock('vite-plugin-node-polyfills/shims/buffer', async () => {
  const { createRequire: requireFrom } = await import('node:module');
  const { Buffer } = requireFrom(import.meta.url)('node:buffer');
  return { default: Buffer, Buffer };
});

const mocks = vi.hoisted(() => ({ fireSuccess: vi.fn(), setError: vi.fn() }));
vi.mock('@/plugins/snackbar', () => ({ default: { fireSuccess: mocks.fireSuccess, setError: mocks.setError } }));
vi.mock('@/shared/utils/ledger', () => ({ default: {} }));
vi.mock('@/shared/utils/trezorDispatch', () => ({ dispatchTrezor: vi.fn() }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('qr-code-styling', () => ({ default: class { append() {} } }));
vi.mock('@/shared/components/AnimatedQRScanner.vue', () => ({
  default: { name: 'AnimatedQRScanner', props: ['purpose', 'urTypes'], emits: ['scan', 'error', 'progress'], template: '<div class="qr-scanner-stub" />' },
}));

import StepConnect from './StepConnect.vue';

const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');

// Fixed test vector — never used to hold funds.
const root = HDKey.fromMasterSeed(mnemonicToSeedSync('legal winner thank year wave sausage worth useful legal winner thank yellow'));
const FINGERPRINT = NodeBuffer.from(root.fingerprint.toString(16).padStart(8, '0'), 'hex');

/** The Keystone's answer: the account key at m/84'/0'/account', in crypto-multi-accounts. */
function answer(account: number): { type: string; cbor: string } {
  const node = root.derive(`m/84'/0'/${account}'`);
  const key = new CryptoHDKey({
    isMaster: false, key: NodeBuffer.from(node.publicKey!), chainCode: NodeBuffer.from(node.chainCode!),
    origin: new CryptoKeypath([84, 0, account].map((index) => new PathComponent({ index, hardened: true })), FINGERPRINT),
  });
  return { type: 'crypto-multi-accounts', cbor: new CryptoMultiAccounts(FINGERPRINT, [key]).toCBOR().toString('hex') };
}

enableAutoUnmount(afterEach);
afterEach(() => vi.clearAllMocks());

async function scanWithKeystone(ur: { type: string; cbor: string }) {
  const wrapper = mount(StepConnect, {
    props: { network: networks.resolveNetwork(Blockchain.BITCOIN, Network.MAINNET), walletType: WalletType.Keystone },
    global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
  await wrapper.find('button.step-next').trigger('click');
  wrapper.findComponent({ name: 'AnimatedQRScanner' }).vm.$emit('scan', ur);
  await flushPromises();
  return wrapper;
}

describe('pairing a Keystone as a Bitcoin wallet', () => {
  it('pairs the account the QR asked for from the crypto-multi-accounts answer', async () => {
    const wrapper = await scanWithKeystone(answer(0));

    const [[payload]] = wrapper.emitted('connected') as [[{ publicKey: string; xfp: string; keys: Array<{ path: string; publicKey: string }> }]];
    expect(payload.xfp).toBe(FINGERPRINT.toString('hex'));
    expect(payload.keys).toEqual([{ path: "84'/0'/0'", publicKey: NodeBuffer.from(root.derive("m/84'/0'/0'").publicKey!).toString('hex'), chainCode: expect.any(String) }]);
    // The paired xpub derives the account's own addresses.
    expect(HDKey.fromExtendedKey(payload.publicKey).derive('m/0/0').publicKey).toEqual(root.derive("m/84'/0'/0'/0/0").publicKey);
    expect(mocks.setError).not.toHaveBeenCalled();
  });

  it('pairs nothing from an answer for another account', async () => {
    const wrapper = await scanWithKeystone(answer(1));

    expect(wrapper.emitted('connected')).toBeUndefined();
    expect(mocks.setError).toHaveBeenCalledTimes(1);
    expect(mocks.fireSuccess).not.toHaveBeenCalled();
  });
});
