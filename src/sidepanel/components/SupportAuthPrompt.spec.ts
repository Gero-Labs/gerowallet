import { mockGlobalProperties } from '@test/helpers/globalProperties';
// src/sidepanel/components/SupportAuthPrompt.spec.ts
//
// The component is a thin shell over `useSupportAuthPrompt` (covered in its own
// spec), so the only thing worth asserting here is the part the shell owns: that
// MOUNTING it wires the singleton into useSupportChat's `promptAuth` hook, and
// destroying it unwires that hook again. Everything visual is stubbed — Vuetify
// is not installed on this test's Vue instance, and TransactionAuthSection would
// drag Dexie in with it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import * as Vue from 'vue';
// @ts-ignore — tsconfig has no `*.vue` module shim, so `tsc` cannot resolve an
// SFC imported from a .ts file. Vite/vitest resolve it fine; this keeps the
// repo's typecheck error count where it was.
import SupportAuthPrompt from './SupportAuthPrompt.vue';
import { supportAuthPrompt } from '@/sidepanel/composables/useSupportAuthPrompt';
import { createSupportChat, setSupportAuthPrompt, type SupportChat } from '@/sidepanel/composables/useSupportChat';

const $t = (key: string): string => key;

function makeChat(): SupportChat {
  return createSupportChat({
    api: {
      ensureContact: vi.fn().mockResolvedValue({ sourceId: 'src-1', pubsubToken: 'tok-1' }),
      createConversation: vi.fn().mockResolvedValue(42),
      listMessages: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue(null),
    },
    cache: { load: vi.fn().mockResolvedValue(null), save: vi.fn(), clear: vi.fn() },
    createCable: () => ({ connect: vi.fn(), close: vi.fn(), isConnected: () => false }),
    requestIdentity: vi.fn().mockResolvedValue({ identifier: 'v1:aa', identifierHash: 'hh', displayName: 'x' }),
    wallet: () => ({ id: 1, chain: 'Cardano', type: 'Normal', stakeAddress: 'stake1uexample' }),
  });
}

function mountPrompt(): VueWrapper {
  return mount(SupportAuthPrompt, { global: { config: { globalProperties: mockGlobalProperties({ $t }) }, stubs: { 'v-dialog': true, 'v-icon': true, TransactionAuthSection: true } } });
}

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  setSupportAuthPrompt(null);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  setSupportAuthPrompt(null);
});

describe('SupportAuthPrompt', () => {
  it('registers the auth prompt on mount, so a first send opens it instead of failing', async () => {
    wrapper = mountPrompt();
    const chat = makeChat();

    const sending = chat.send('my tx is stuck');
    await Vue.nextTick();
    await Vue.nextTick();

    expect(supportAuthPrompt.isOpen.value).toBe(true);

    supportAuthPrompt.cancel();
    // Cancelling is not a failure: the dock keeps the draft and shows no banner.
    expect(await sending).toBe(false);
    expect(chat.errorKey.value).toBeNull();
  });

  it('unregisters on destroy, so a later send is a failure rather than a silent no-op', async () => {
    wrapper = mountPrompt();
    wrapper.unmount();
    wrapper = null;

    const chat = makeChat();
    expect(await chat.send('hello')).toBe(false);
    expect(supportAuthPrompt.isOpen.value).toBe(false);
    expect(chat.errorKey.value).toBe('support.error.sendFailed');
  });
});
