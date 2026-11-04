import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import * as Vue from 'vue';
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import * as MS from '@emurgo/cardano-message-signing-browser';
import vectors from '@/shared/utils/signedResponse.vectors.json';
import { WalletType } from '@/models/types';
import { MessageTypes } from '@/models/MessageTypes';

vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.reactive({ loggedWallet: null as unknown, keys: null as unknown }) }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { state: { flags: {} } } }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn(), setSuccess: vi.fn() } }));
vi.mock('@/plugins/hardwareLoading', () => ({ default: { begin: vi.fn(), end: vi.fn() } }));
vi.mock('@/shared/utils/ledger', () => ({ default: { createKnownAddressesFromKeys: vi.fn(() => []), signData: vi.fn() } }));
vi.mock('@/shared/utils/trezorDispatch', () => ({ dispatchTrezor: vi.fn() }));
vi.mock('@/shared/utils/walletAccount', () => ({ accountIndexFromKeys: vi.fn(() => 0) }));
vi.mock('@/utils/networks', () => ({ default: { resolveNetwork: vi.fn(() => ({ networkId: 1 })) } }));
vi.mock('@/shared/components/CopyButton.vue', () => ({ default: { name: 'CopyButtonStub', props: ['value', 'small'], render: () => Vue.h('span') } }));
vi.mock('@/shared/components/ToggleSwitch.vue', () => ({ default: { name: 'ToggleStub', render: () => Vue.h('div') } }));
const translate = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: translate }) }));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import SigningCeremony from './SigningCeremony.vue';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import ledger from '@/shared/utils/ledger';
import snackbar from '@/plugins/snackbar';

enableAutoUnmount(afterEach);

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const ROOT_SEED = hexToBytes(vectors.root.seedHex);
const STAKE = 'stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zctvm3rc';

/** What a device returns from signData over `payloadHex`: a COSE_Sign1 and the COSE_Key. */
async function deviceSign(payloadHex: string, seed: Uint8Array = ROOT_SEED) {
  const protectedMap = MS.HeaderMap.new();
  protectedMap.set_algorithm_id(MS.Label.from_algorithm_id(MS.AlgorithmId.EdDSA));
  const builder = MS.COSESign1Builder.new(MS.Headers.new(MS.ProtectedHeaderMap.new(protectedMap), MS.HeaderMap.new()), hexToBytes(payloadHex), false);
  const signature = toHex(builder.build(await ed25519.signAsync(builder.make_data_to_sign().to_bytes(), seed)).to_bytes());
  const key = MS.COSEKey.new(MS.Label.from_key_type(MS.KeyType.OKP));
  key.set_header(MS.Label.new_int(MS.Int.new_negative(MS.BigNum.from_str('2'))), MS.CBORValue.new_bytes(await ed25519.getPublicKeyAsync(seed)));
  return { signature, key: toHex(key.to_bytes()) };
}

function login(type: string, chain = 'Cardano') {
  walletStore.loggedWallet = { id: 7, type, chain, network: 'Mainnet' };
  walletStore.keys = { stake: [{ address: STAKE, cred: 'c', path: "m/1852'/1815'/0'/2/0" }] } as unknown as typeof walletStore.keys;
}

let wrapper: VueWrapper;
function mountPage() {
  wrapper = mount(SigningCeremony, {
    global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: translate }) } },
  });
  return wrapper;
}

async function fill(testId: string, value: string) {
  await wrapper.find(`[data-testid="${testId}"] input`).setValue(value);
}

const statementText = () => wrapper.find('[data-testid="ceremony-statement"]').text();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
});

afterEach(() => vi.useRealTimers());

describe('SigningCeremony', () => {
  it('builds the delegation text from the fields: today, 90 days, the default host', async () => {
    login(WalletType.Ledger);
    mountPage();
    expect(statementText()).toBe('');
    await fill('ceremony-kid', 'backend-2026-11');
    await fill('ceremony-key', vectors.signingPublicKeyHex);
    expect(statementText()).toBe(
      `gero-signing/v1|delegation|kid=backend-2026-11|service=gero-backend|hosts=api.gerowallet.io|from=2026-11-03|until=2027-02-01|key=${vectors.signingPublicKeyHex}`,
    );
  });

  it('signs with the stake key on a Ledger, checks the signature and prints the entry', async () => {
    login(WalletType.Ledger);
    vi.mocked(ledger.signData).mockImplementation(async (_address: string, payloadHex: string) => {
      const signed = await deviceSign(payloadHex);
      return { signatureHex: signed.signature, signingPublicKeyHex: signed.key, addressFieldHex: '' };
    });
    mountPage();
    await fill('ceremony-kid', 'backend-2026-11');
    await fill('ceremony-key', vectors.signingPublicKeyHex);
    const statement = statementText();
    await wrapper.find('[data-testid="ceremony-sign"]').trigger('click');
    await vi.waitFor(async () => {
      await flushPromises();
      expect(wrapper.find('[data-testid="ceremony-result"]').exists()).toBe(true);
    });
    const [address, payloadHex] = vi.mocked(ledger.signData).mock.calls[0];
    expect(address).toBe(STAKE);
    expect(Buffer.from(payloadHex, 'hex').toString('utf8')).toBe(statement);
    expect(wrapper.find('[data-testid="ceremony-root-key"]').text()).toBe(vectors.root.publicKeyHex);
    expect(wrapper.find('[data-testid="ceremony-pinned"]').text()).toBe('signingCeremony.notPinned');
    const entry = JSON.parse(wrapper.find('[data-testid="ceremony-entry"]').text()) as { statement: string; coseSign1: string };
    expect(entry.statement).toBe(statement);
    expect(snackbar.setError).not.toHaveBeenCalled();
  });

  it('prints nothing when the device signed something else', async () => {
    login(WalletType.Ledger);
    vi.mocked(ledger.signData).mockImplementation(async () => {
      const signed = await deviceSign(Buffer.from('another text').toString('hex'));
      return { signatureHex: signed.signature, signingPublicKeyHex: signed.key, addressFieldHex: '' };
    });
    mountPage();
    await fill('ceremony-kid', 'backend-2026-11');
    await fill('ceremony-key', vectors.signingPublicKeyHex);
    await wrapper.find('[data-testid="ceremony-sign"]').trigger('click');
    await vi.waitFor(() => expect(snackbar.setError).toHaveBeenCalledWith('signingCeremony.notVerified'));
    expect(wrapper.find('[data-testid="ceremony-result"]').exists()).toBe(false);
  });

  it('signs a revocation on a Trezor through the extension', async () => {
    login(WalletType.Trezor);
    vi.mocked(Messaging.sendToBackgroundFromOptions).mockImplementation(async (message) => {
      const signed = await deviceSign((message as unknown as { data: { payload: string } }).data.payload);
      return { data: { success: true, signatureData: { signatureHex: signed.signature, signingPublicKeyHex: signed.key } } };
    });
    mountPage();
    await wrapper.find('[data-testid="ceremony-kind"] button:nth-child(2)').trigger('click');
    await fill('ceremony-revoked', 'backend-2026-08, backend-2026-05');
    expect(statementText()).toBe('gero-signing/v1|revocation|issued=2026-11-03|revoked=backend-2026-08,backend-2026-05');
    await wrapper.find('[data-testid="ceremony-sign"]').trigger('click');
    await vi.waitFor(async () => {
      await flushPromises();
      expect(wrapper.find('[data-testid="ceremony-result"]').exists()).toBe(true);
    });
    expect(vi.mocked(Messaging.sendToBackgroundFromOptions).mock.calls[0][0]).toMatchObject({
      method: MessageTypes.TREZOR,
      data: { method: 'signData', address: STAKE },
    });
  });

  it('refuses a software wallet and any chain but Cardano', async () => {
    for (const [type, chain] of [[WalletType.Normal, 'Cardano'], [WalletType.Ledger, 'Bitcoin']]) {
      login(type, chain);
      mountPage();
      await fill('ceremony-kid', 'backend-2026-11');
      await fill('ceremony-key', vectors.signingPublicKeyHex);
      expect(wrapper.find('[data-testid="ceremony-unsupported"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="ceremony-sign"]').attributes('disabled')).toBeDefined();
      wrapper.unmount();
    }
  });

  it('refuses a statement too long for a Ledger to show', async () => {
    login(WalletType.Ledger);
    mountPage();
    await fill('ceremony-kid', 'k'.repeat(32));
    await fill('ceremony-key', vectors.signingPublicKeyHex);
    expect(statementText()).toBe('');
    expect(wrapper.find('[data-testid="ceremony-statement-error"]').text()).toContain('signingCeremony.tooLong');
    expect(wrapper.find('[data-testid="ceremony-sign"]').attributes('disabled')).toBeDefined();
  });
});
