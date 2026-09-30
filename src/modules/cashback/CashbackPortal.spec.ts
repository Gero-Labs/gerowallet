// The Bring portal bridge, end to end from a `SIGN_MESSAGE` postMessage to the
// `SIGNATURE` / `ABORT_SIGN_MESSAGE` reply. The bug these pin: the portal used
// to route its challenge through the CIP-30 `signData` handler as a webpage
// request with no origin, which the connected-site allowlist refused before
// any prompt opened, so every claim silently reset. The prompt is a stub here;
// what is under test is the binding of a request to the wallet it was made
// for, and that exactly one answer reaches the portal.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';
import { Blockchain, Network } from '@/models/types';

/** The prompt, reduced to the two answers it can give. A `<script setup>` import
 *  is not registered by name, so it is mocked as a module rather than stubbed. */
const SignDialogStub = vi.hoisted(() => ({
  name: 'CashbackSignDialogStub',
  props: ['isOpen', 'requestId', 'message', 'address', 'origin'],
  // A render function, not a template: the test build of Vue has no template compiler.
  render(h: (tag: string, data: object) => unknown) {
    return h('div', {
      attrs: {
        'data-testid': 'dialog',
        'data-open': String(this.isOpen),
        'data-request-id': String(this.requestId),
        'data-message': this.message,
        'data-address': this.address,
        'data-origin': this.origin,
      },
    });
  },
}));
vi.mock('./CashbackSignDialog.vue', () => ({ default: SignDialogStub }));
vi.mock('@/api/cashback-api', () => ({
  default: { portal: vi.fn(async () => ({ portalUrl: 'https://portal.bringweb3.io/?token=abc', token: 'tok' })) },
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.observable({ loggedWallet: null as unknown }) }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn(), setSuccess: vi.fn() } }));
const $t = (key: string): string => key;
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: $t }) }));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import CashbackPortal from './CashbackPortal.vue';
import { walletStore } from '@/stores/walletStore';
import snackbar from '@/plugins/snackbar';

const ORIGIN = 'https://portal.bringweb3.io';
const ADDRESS = 'addr1qy44ytv354nqrs0f3hfsecj45w623wgqskt7nx84qd8v6lgxeg90kc8dfzpcg9xl8nuhvdesgq5cz6ejq83vk60hpns2c2kwh';

function mainnetWallet(over: Record<string, unknown> = {}) {
  return { id: 1, chain: Blockchain.CARDANO, network: Network.MAINNET, baseAddress: ADDRESS, type: 'normal', ...over };
}

let wrapper: Wrapper<Vue>;
let postMessage: ReturnType<typeof vi.fn>;

async function mountPortal() {
  wrapper = mount(CashbackPortal, {
    mocks: { $t },
    stubs: { 'v-icon': true, 'v-btn': true, 'v-progress-circular': true },
    attachTo: document.body,
  });
  await flush();
  const frame = wrapper.find('iframe').element as HTMLIFrameElement;
  postMessage = vi.fn();
  // happy-dom gives the iframe a window; the portal compares `event.source` against it.
  Object.defineProperty(frame, 'contentWindow', { value: { postMessage }, configurable: true });
  return frame;
}

async function flush() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await wrapper.vm.$nextTick();
}

function portalMessage(data: unknown, { origin = ORIGIN, source }: { origin?: string; source?: unknown } = {}) {
  const frame = wrapper.find('iframe').element as HTMLIFrameElement;
  const event = new MessageEvent('message', { data, origin });
  Object.defineProperty(event, 'source', { value: source === undefined ? frame.contentWindow : source });
  window.dispatchEvent(event);
  return flush();
}

const signRequest = (messageToSign: unknown = 'Claim 12.5 ADA to addr1... nonce 42') =>
  portalMessage({ from: 'bringweb3', action: 'SIGN_MESSAGE', messageToSign });

function dialog() {
  return wrapper.find('[data-testid="dialog"]');
}

/** The id of the request the prompt is showing right now. */
function shownRequestId(): number {
  return Number(dialog().attributes('data-request-id'));
}

/** Answer as the prompt would: a signature echoes the id it was approved for (the shown one unless given). */
function answer(event: 'signed' | 'close', payload?: { signature: string; key: string; requestId?: number }) {
  const body = event === 'signed' && payload ? { requestId: shownRequestId(), ...payload } : payload;
  wrapper.findComponent({ name: 'CashbackSignDialogStub' }).vm.$emit(event, body);
  return flush();
}

/** Every message the portal has been sent, minus the session bootstrap traffic. */
function replies() {
  return postMessage.mock.calls.map(([message]) => message).filter(m => m.action !== 'SESSION_UPDATE');
}

describe('cashback claim signing bridge', () => {
  beforeAll(() => {
    // happy-dom would otherwise fetch the portal URL for the iframe.
    (window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } })
      .happyDOM.settings.disableIframePageLoading = true;
  });
  beforeEach(() => {
    vi.useFakeTimers();
    walletStore.loggedWallet = mainnetWallet();
  });
  afterEach(() => {
    wrapper?.destroy();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('opens the prompt with the verbatim challenge, bound to the claim address', async () => {
    await mountPortal();
    await signRequest('Claim 12.5 ADA nonce 42');
    expect(dialog().attributes('data-open')).toBe('true');
    expect(dialog().attributes('data-message')).toBe('Claim 12.5 ADA nonce 42');
    expect(dialog().attributes('data-address')).toBe(ADDRESS);
    expect(dialog().attributes('data-origin')).toBe(ORIGIN);
    expect(replies()).toEqual([]);
  });

  it('returns the signature, key and original challenge to the portal origin', async () => {
    await mountPortal();
    await signRequest('Claim 12.5 ADA nonce 42');
    await answer('signed', { signature: 'sig', key: 'key' });
    expect(replies()).toEqual([{ to: 'bringweb3', action: 'SIGNATURE', signature: 'sig', key: 'key', message: 'Claim 12.5 ADA nonce 42' }]);
    expect(postMessage).toHaveBeenLastCalledWith(expect.anything(), ORIGIN);
    expect(dialog().attributes('data-open')).toBe('false');
  });

  it('aborts on decline and keeps the claim retryable', async () => {
    await mountPortal();
    await signRequest();
    await answer('close');
    expect(replies()).toEqual([{ to: 'bringweb3', action: 'ABORT_SIGN_MESSAGE' }]);
    expect(snackbar.setError).not.toHaveBeenCalled();
    await signRequest();
    expect(dialog().attributes('data-open')).toBe('true');
  });

  it('aborts, and never signs, when the wallet changed while the prompt was open', async () => {
    await mountPortal();
    await signRequest();
    walletStore.loggedWallet = mainnetWallet({ id: 2, baseAddress: 'addr1other' });
    await flush();
    expect(replies()).toEqual([{ to: 'bringweb3', action: 'ABORT_SIGN_MESSAGE' }]);
    expect(dialog().attributes('data-open')).toBe('false');
    expect(snackbar.setError).toHaveBeenCalledWith('cashback.signWalletChanged');
    // A late answer from the closed prompt is dropped, not forwarded.
    await answer('signed', { signature: 'sig', key: 'key' });
    expect(replies().filter(m => m.action === 'SIGNATURE')).toEqual([]);
  });

  it('aborts a request that waited too long for approval', async () => {
    await mountPortal();
    await signRequest();
    vi.advanceTimersByTime(5 * 60_000);
    await flush();
    expect(replies()).toEqual([{ to: 'bringweb3', action: 'ABORT_SIGN_MESSAGE' }]);
    expect(snackbar.setError).toHaveBeenCalledWith('cashback.signTimedOut');
    expect(dialog().attributes('data-open')).toBe('false');
  });

  it('answers only the newest request when the portal asks again', async () => {
    await mountPortal();
    await signRequest('first');
    await signRequest('second');
    expect(dialog().attributes('data-message')).toBe('second');
    await answer('signed', { signature: 'sig', key: 'key' });
    expect(replies()).toEqual([expect.objectContaining({ action: 'SIGNATURE', message: 'second' })]);
  });

  it('drops a signature approved for a request the portal has since replaced', async () => {
    await mountPortal();
    await signRequest('first');
    const first = shownRequestId();
    await signRequest('second');
    // The approval for "first" completes late, after "second" took its place.
    await answer('signed', { requestId: first, signature: 'sig-a', key: 'key-a' });
    expect(replies()).toEqual([]);
    expect(dialog().attributes('data-open')).toBe('true');
    expect(dialog().attributes('data-message')).toBe('second');
    await answer('signed', { signature: 'sig-b', key: 'key-b' });
    expect(replies()).toEqual([expect.objectContaining({ action: 'SIGNATURE', signature: 'sig-b', message: 'second' })]);
  });

  it('cancels a pending request when the portal document reloads', async () => {
    await mountPortal();
    await signRequest();
    const stale = shownRequestId();
    await wrapper.find('iframe').trigger('load');
    expect(dialog().attributes('data-open')).toBe('false');
    // The prompt that was open for the old document cannot answer into the new one.
    await answer('signed', { requestId: stale, signature: 'sig', key: 'key' });
    expect(replies()).toEqual([]);
  });

  it.each([
    ['a foreign origin', { origin: 'https://evil.example' }],
    ['another window', { source: { postMessage: vi.fn() } }],
  ])('ignores a SIGN_MESSAGE from %s', async (_name, from) => {
    await mountPortal();
    await portalMessage({ from: 'bringweb3', action: 'SIGN_MESSAGE', messageToSign: 'x' }, from);
    expect(dialog().attributes('data-open')).toBe('false');
    expect(replies()).toEqual([]);
  });

  it.each([
    ['no challenge', {}],
    ['a non-string challenge', { messageToSign: 42 }],
    ['an empty challenge', { messageToSign: '' }],
    ['an oversized challenge', { messageToSign: 'a'.repeat(2049) }],
    ['a control character', { messageToSign: 'claim\u0000hidden' }],
  ])('aborts a request with %s without a prompt', async (_name, data) => {
    await mountPortal();
    await portalMessage({ from: 'bringweb3', action: 'SIGN_MESSAGE', ...data });
    expect(dialog().attributes('data-open')).toBe('false');
    expect(replies()).toEqual([{ to: 'bringweb3', action: 'ABORT_SIGN_MESSAGE' }]);
  });

  it('refuses to sign for a wallet Bring does not support', async () => {
    walletStore.loggedWallet = mainnetWallet({ network: Network.PREPROD });
    await mountPortal();
    await signRequest();
    expect(dialog().attributes('data-open')).toBe('false');
    expect(replies()).toEqual([{ to: 'bringweb3', action: 'ABORT_SIGN_MESSAGE' }]);
    expect(snackbar.setError).toHaveBeenCalledWith('cashback.signUnsupportedNetwork');
  });
});
