// src/sidepanel/composables/useSupportChat.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Vue from 'vue';
import { nextTick } from 'vue';
import { createSupportChat, type SupportChatDeps, type SupportWalletSnapshot } from './useSupportChat';
import {
  ChatAuthError,
  ChatRequestError,
  SUPPORT_MAX_FILE_BYTES,
  SUPPORT_MAX_FILES_PER_MESSAGE,
  type SupportApiMessage,
} from '@/api/chatwootSupport.client';
import type { SupportChatIdentity } from '@/services/support/identityCache';
import type { SupportCableOptions } from '@/services/support/actionCable';

const CARDANO_WALLET: SupportWalletSnapshot = {
  id: 1,
  chain: 'Cardano',
  type: 'Normal',
  stakeAddress: 'stake1uexample',
};

const VERIFIED = { identifier: 'v1:aa', identifierHash: 'hh', displayName: 'quiet-dew-4f2a' };

function makeHarness(overrides: Partial<SupportChatDeps> = {}) {
  const store: Record<number, SupportChatIdentity | null> = {};
  const cable = {
    connect: vi.fn(),
    close: vi.fn(),
    isConnected: vi.fn().mockReturnValue(false),
  };
  let cableOptions: SupportCableOptions | null = null;

  const api = {
    ensureContact: vi.fn().mockResolvedValue({ sourceId: 'src-1', pubsubToken: 'tok-1' }),
    createConversation: vi.fn().mockResolvedValue(42),
    listMessages: vi.fn().mockResolvedValue([] as SupportApiMessage[]),
    sendMessage: vi.fn().mockResolvedValue(null),
  };
  const cache = {
    load: vi.fn(async (walletId: number) => store[walletId] ?? null),
    save: vi.fn(async (walletId: number, identity: SupportChatIdentity) => {
      store[walletId] = identity;
    }),
    clear: vi.fn(async (walletId: number) => {
      store[walletId] = null;
    }),
  };
  const promptAuth = vi.fn().mockResolvedValue({ password: 'pw' });
  const requestIdentity = vi.fn().mockResolvedValue(VERIFIED);
  const wallet = vi.fn().mockReturnValue(CARDANO_WALLET);

  const deps: SupportChatDeps = {
    api,
    cache,
    promptAuth,
    requestIdentity,
    wallet,
    createCable: (options) => {
      cableOptions = options;
      return cable;
    },
    ...overrides,
  };

  const chat = createSupportChat(deps);
  return {
    chat,
    api,
    cache,
    store,
    cable,
    promptAuth,
    requestIdentity,
    wallet,
    cableOptions: () => cableOptions,
  };
}

function cached(extra: Partial<SupportChatIdentity> = {}): SupportChatIdentity {
  return { ...VERIFIED, sourceId: 'src-1', pubsubToken: 'tok-1', conversationId: 42, ...extra };
}

/** Drain Vue's watcher queue and any chained promise callbacks. */
async function flushPromises(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A promise plus its resolve/reject, for pausing a mocked call mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useSupportChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('availability', () => {
    it('is available for a Cardano software wallet with a reward address', () => {
      const h = makeHarness();
      expect(h.chat.isAvailable.value).toBe(true);
    });

    it('is unavailable for a hardware wallet (no signable stake key in the background)', () => {
      const h = makeHarness({ wallet: () => ({ ...CARDANO_WALLET, type: 'Ledger' }) });
      expect(h.chat.isAvailable.value).toBe(false);
    });

    it('is unavailable without a reward address (enterprise / non-Cardano chain)', () => {
      expect(makeHarness({ wallet: () => ({ ...CARDANO_WALLET, stakeAddress: '' }) }).chat.isAvailable.value).toBe(false);
      expect(
        makeHarness({ wallet: () => ({ id: 2, chain: 'Bitcoin', type: 'Normal' }) }).chat.isAvailable.value,
      ).toBe(false);
    });

    it('send() on an unavailable wallet returns false with no side effects', async () => {
      const h = makeHarness({ wallet: () => ({ ...CARDANO_WALLET, type: 'Trezor' }) });
      const ok = await h.chat.send('help');
      expect(ok).toBe(false);
      expect(h.chat.messages.value).toEqual([]);
      expect(h.promptAuth).not.toHaveBeenCalled();
      expect(h.requestIdentity).not.toHaveBeenCalled();
      expect(h.api.ensureContact).not.toHaveBeenCalled();
      expect(h.chat.errorKey.value).toBeNull();
    });
  });

  describe('enter()', () => {
    it('stays idle and runs NO handshake when no identity is cached', async () => {
      const h = makeHarness();
      await h.chat.enter();
      expect(h.chat.connectionState.value).toBe('idle');
      expect(h.promptAuth).not.toHaveBeenCalled();
      expect(h.requestIdentity).not.toHaveBeenCalled();
      expect(h.cable.connect).not.toHaveBeenCalled();
    });

    it('loads history and connects the cable when an identity is cached', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      h.api.listMessages.mockResolvedValue([
        { id: 1, role: 'user', text: 'gm', createdAt: 1 },
        { id: 2, role: 'agent', text: 'hi', agentName: 'Ada', createdAt: 2 },
      ]);
      await h.chat.enter();
      expect(h.api.listMessages).toHaveBeenCalledWith('src-1', 42);
      expect(h.chat.messages.value.map((m) => m.id)).toEqual([1, 2]);
      expect(h.cable.connect).toHaveBeenCalledTimes(1);
      expect(h.chat.connectionState.value).toBe('connecting');
      h.cableOptions()?.onState('connected');
      expect(h.chat.connectionState.value).toBe('connected');
    });

    it('is idempotent — a second enter() does not re-open the cable', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      h.cable.isConnected.mockReturnValue(true);
      await h.chat.enter();
      expect(h.cable.connect).toHaveBeenCalledTimes(1);
      expect(h.api.listMessages).toHaveBeenCalledTimes(1);
    });

    it('refetches history when the cable reconnects (gap fill)', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      h.api.listMessages.mockResolvedValue([{ id: 9, role: 'agent', text: 'missed you', createdAt: 9 }]);
      await h.cableOptions()?.onReconnected?.();
      await nextTick();
      expect(h.api.listMessages).toHaveBeenCalledTimes(2);
      expect(h.chat.messages.value.map((m) => m.id)).toEqual([9]);
    });
  });

  describe('first send()', () => {
    it('runs the handshake, verifies the contact, opens a conversation, then sends', async () => {
      const h = makeHarness();
      const ok = await h.chat.send('  my tx is stuck  ');
      expect(ok).toBe(true);

      expect(h.promptAuth).toHaveBeenCalledTimes(1);
      expect(h.requestIdentity).toHaveBeenCalledWith({ password: 'pw' });
      expect(h.api.ensureContact).toHaveBeenCalledWith({
        identifier: 'v1:aa',
        identifierHash: 'hh',
        name: 'quiet-dew-4f2a',
      });
      expect(h.api.createConversation).toHaveBeenCalledWith('src-1');
      expect(h.api.sendMessage).toHaveBeenCalledWith('src-1', 42, 'my tx is stuck');

      // Optimistic echo with a negative (local) id.
      expect(h.chat.messages.value).toHaveLength(1);
      expect(h.chat.messages.value[0].role).toBe('user');
      expect(h.chat.messages.value[0].text).toBe('my tx is stuck');
      expect(h.chat.messages.value[0].id).toBeLessThan(0);
      expect(h.chat.busy.value).toBe(false);
      expect(h.cable.connect).toHaveBeenCalled();
    });

    it('caches identity + contact + conversation so the next send reuses everything', async () => {
      const h = makeHarness();
      await h.chat.send('one');
      await h.chat.send('two');
      expect(h.promptAuth).toHaveBeenCalledTimes(1);
      expect(h.requestIdentity).toHaveBeenCalledTimes(1);
      expect(h.api.ensureContact).toHaveBeenCalledTimes(1);
      expect(h.api.createConversation).toHaveBeenCalledTimes(1);
      expect(h.api.sendMessage).toHaveBeenCalledTimes(2);
      expect(h.store[1]).toMatchObject({ identifier: 'v1:aa', sourceId: 'src-1', conversationId: 42 });
    });

    it('a deliberate cancel returns false with NO error and appends nothing', async () => {
      const h = makeHarness({ promptAuth: vi.fn().mockResolvedValue(null) });
      const ok = await h.chat.send('hello');
      expect(ok).toBe(false);
      expect(h.chat.messages.value).toEqual([]);
      // Cancelling is a choice, not a failure — the dock keeps the draft, no banner.
      expect(h.chat.errorKey.value).toBeNull();
      expect(h.requestIdentity).not.toHaveBeenCalled();
      expect(h.api.ensureContact).not.toHaveBeenCalled();
      expect(h.chat.busy.value).toBe(false);
    });

    it('clears a previous error when a later send is cancelled', async () => {
      const promptAuth = vi.fn().mockRejectedValueOnce(new Error('wrong password')).mockResolvedValue(null);
      const h = makeHarness({ promptAuth });
      expect(await h.chat.send('hello')).toBe(false);
      expect(h.chat.errorKey.value).toBe('support.error.sendFailed');
      expect(await h.chat.send('hello')).toBe(false);
      expect(h.chat.errorKey.value).toBeNull();
    });

    it('an auth FAILURE (prompt throws) returns false with support.error.sendFailed', async () => {
      const h = makeHarness({ promptAuth: vi.fn().mockRejectedValue(new Error('PassKey failed')) });
      expect(await h.chat.send('hello')).toBe(false);
      expect(h.chat.messages.value).toEqual([]);
      expect(h.chat.errorKey.value).toBe('support.error.sendFailed');
      expect(h.requestIdentity).not.toHaveBeenCalled();
    });

    it('treats a not-yet-wired auth prompt as a failure, not a cancel', async () => {
      // No promptAuth dep at all -> the module default, which throws until the
      // dock calls setSupportAuthPrompt().
      const h = makeHarness({ promptAuth: undefined });
      expect(await h.chat.send('hello')).toBe(false);
      expect(h.chat.errorKey.value).toBe('support.error.sendFailed');
    });

    it('returns false and appends NOTHING when the handshake itself fails', async () => {
      const h = makeHarness({ requestIdentity: vi.fn().mockResolvedValue(null) });
      expect(await h.chat.send('hello')).toBe(false);
      expect(h.chat.messages.value).toEqual([]);
      expect(h.chat.errorKey.value).toBe('support.error.sendFailed');
    });

    it('rolls back the optimistic message when the send request fails', async () => {
      const h = makeHarness();
      h.api.sendMessage.mockRejectedValue(new Error('network down'));
      expect(await h.chat.send('hello')).toBe(false);
      expect(h.chat.messages.value).toEqual([]);
      expect(h.chat.errorKey.value).toBe('support.error.sendFailed');
    });

    it('reconciles the optimistic echo with the id the send POST returned', async () => {
      const h = makeHarness();
      h.api.sendMessage.mockResolvedValue({ id: 31, role: 'user', text: 'my tx is stuck', createdAt: 31000 });
      expect(await h.chat.send('my tx is stuck')).toBe(true);
      // The cable is not subscribed yet on a first send, so the POST response is
      // what promotes the local echo to a real message.
      expect(h.chat.messages.value).toEqual([
        { id: 31, clientId: -1, role: 'user', text: 'my tx is stuck', agentName: undefined, createdAt: 31000 },
      ]);
    });

    it('keeps the optimistic clientId as a stable list key through reconciliation', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      h.api.sendMessage.mockResolvedValue({ id: 31, role: 'user', text: 'gm', createdAt: 31000 });

      await h.chat.send('gm');
      const reconciled = h.chat.messages.value[0];
      // Server id for identity, original negative id for the UI's :key — a key
      // change here makes Vue tear down and re-animate the user's own bubble.
      expect(reconciled.id).toBe(31);
      expect(reconciled.clientId).toBe(-1);

      // A gap-fill that re-lists the same message must not re-key it either.
      h.api.listMessages.mockResolvedValue([{ id: 31, role: 'user', text: 'gm', createdAt: 31000 }]);
      await h.cableOptions()?.onReconnected?.();
      await flushPromises(2);
      expect(h.chat.messages.value).toHaveLength(1);
      expect(h.chat.messages.value[0]).toMatchObject({ id: 31, clientId: -1 });
    });

    it('leaves clientId undefined for messages that never had an optimistic twin', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      h.api.listMessages.mockResolvedValue([{ id: 5, role: 'agent', text: 'hi', createdAt: 5 }]);
      await h.chat.enter();
      h.cableOptions()?.onMessage({ id: 6, role: 'agent', text: 'still here?', createdAt: 6 });
      expect(h.chat.messages.value.map((m) => m.clientId)).toEqual([undefined, undefined]);
    });

    it('does not duplicate when the cable later broadcasts the same message', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      h.api.sendMessage.mockResolvedValue({ id: 31, role: 'user', text: 'gm', createdAt: 31000 });
      await h.chat.send('gm');
      h.cableOptions()?.onMessage({ id: 31, role: 'user', text: 'gm', createdAt: 31000 });
      expect(h.chat.messages.value.map((m) => m.id)).toEqual([31]);
    });

    it('keeps the optimistic echo when the POST returns no message body', async () => {
      const h = makeHarness();
      h.api.sendMessage.mockResolvedValue(null);
      expect(await h.chat.send('gm')).toBe(true);
      expect(h.chat.messages.value).toHaveLength(1);
      expect(h.chat.messages.value[0].id).toBeLessThan(0);
    });

    it('ignores blank input', async () => {
      const h = makeHarness();
      expect(await h.chat.send('   ')).toBe(false);
      expect(h.promptAuth).not.toHaveBeenCalled();
      expect(h.chat.messages.value).toEqual([]);
    });
  });

  describe('send() with files', () => {
    function makeFile(name: string, size: number): File {
      const file = new File([new Uint8Array(1)], name);
      Object.defineProperty(file, 'size', { value: size });
      return file;
    }

    it('rejects more than SUPPORT_MAX_FILES_PER_MESSAGE files with no network call', async () => {
      const h = makeHarness();
      const files = Array.from({ length: SUPPORT_MAX_FILES_PER_MESSAGE + 1 }, (_, i) => makeFile(`f${i}.png`, 10));
      const ok = await h.chat.send('', files);
      expect(ok).toBe(false);
      expect(h.chat.errorKey.value).toBe('support.error.tooManyFiles');
      expect(h.promptAuth).not.toHaveBeenCalled();
      expect(h.requestIdentity).not.toHaveBeenCalled();
      expect(h.api.sendMessage).not.toHaveBeenCalled();
      expect(h.chat.messages.value).toEqual([]);
      expect(h.chat.busy.value).toBe(false);
    });

    it('rejects a file over SUPPORT_MAX_FILE_BYTES with no network call', async () => {
      const h = makeHarness();
      const files = [makeFile('big.bin', SUPPORT_MAX_FILE_BYTES + 1)];
      const ok = await h.chat.send('', files);
      expect(ok).toBe(false);
      expect(h.chat.errorKey.value).toBe('support.error.fileTooLarge');
      expect(h.promptAuth).not.toHaveBeenCalled();
      expect(h.requestIdentity).not.toHaveBeenCalled();
      expect(h.api.sendMessage).not.toHaveBeenCalled();
      expect(h.chat.messages.value).toEqual([]);
      expect(h.chat.busy.value).toBe(false);
    });

    it('sends files-only with no negative-id optimistic entry ever appearing', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      const file = makeFile('a.png', 10);
      h.api.sendMessage.mockImplementation(async () => {
        // Mid-flight: no optimistic bubble should exist while the upload is in flight.
        expect(h.chat.messages.value.some((m) => m.id < 0)).toBe(false);
        return {
          id: 50,
          role: 'user',
          text: '',
          createdAt: 50000,
          attachments: [{ id: 1, fileType: 'image', dataUrl: 'https://cdn.example.test/y.png' }],
        };
      });

      const ok = await h.chat.send('', [file]);

      expect(ok).toBe(true);
      expect(h.chat.messages.value.some((m) => m.id < 0)).toBe(false);
      expect(h.chat.messages.value).toHaveLength(1);
      expect(h.chat.messages.value[0]).toMatchObject({
        id: 50,
        attachments: [{ id: 1, fileType: 'image', dataUrl: 'https://cdn.example.test/y.png' }],
      });
      expect(h.api.sendMessage).toHaveBeenCalledWith('src-1', 42, '', [file]);
    });

    it('runs the handshake on the first-ever send when files are attached', async () => {
      const h = makeHarness();
      const file = makeFile('a.png', 10);
      h.api.sendMessage.mockResolvedValue({ id: 51, role: 'user', text: 'here', createdAt: 51000 });

      const ok = await h.chat.send('here', [file]);

      expect(ok).toBe(true);
      expect(h.promptAuth).toHaveBeenCalledTimes(1);
      expect(h.api.ensureContact).toHaveBeenCalledTimes(1);
      expect(h.api.createConversation).toHaveBeenCalledTimes(1);
      expect(h.api.sendMessage).toHaveBeenCalledWith('src-1', 42, 'here', [file]);
    });

    it('a files send failure keeps existing sendFailed semantics, with no orphan bubble', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      const file = makeFile('a.png', 10);
      h.api.sendMessage.mockRejectedValue(new Error('network down'));

      const ok = await h.chat.send('', [file]);

      expect(ok).toBe(false);
      expect(h.chat.errorKey.value).toBe('support.error.sendFailed');
      expect(h.chat.messages.value).toEqual([]);
      expect(h.chat.busy.value).toBe(false);
    });
  });

  describe('missing Chatwoot session recovery', () => {
    it('stops connecting after a history 404 and recreates the chat only on the next send', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      h.api.listMessages.mockRejectedValueOnce(new ChatRequestError('missing conversation', 404));

      await h.chat.enter();

      expect(h.chat.connectionState.value).toBe('idle');
      expect(h.chat.errorKey.value).toBe('support.error.sessionExpired');
      expect(h.store[1]).toEqual(VERIFIED);
      expect(h.cable.connect).not.toHaveBeenCalled();
      expect(h.api.ensureContact).not.toHaveBeenCalled();
      expect(h.api.createConversation).not.toHaveBeenCalled();

      h.api.ensureContact.mockResolvedValue({ sourceId: 'fresh-source', pubsubToken: 'fresh-token' });
      h.api.createConversation.mockResolvedValue(43);
      expect(await h.chat.send('please help')).toBe(true);
      expect(h.api.sendMessage).toHaveBeenCalledWith('fresh-source', 43, 'please help');
      expect(h.cableOptions()?.pubsubToken).toBe('fresh-token');
      expect(h.promptAuth).not.toHaveBeenCalled();
      expect(h.requestIdentity).not.toHaveBeenCalled();
      expect(h.chat.errorKey.value).toBeNull();
    });

    it('retries a missing conversation once and reconciles the message into the new thread', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      h.api.sendMessage.mockRejectedValueOnce(new ChatRequestError('missing conversation', 404));
      h.api.sendMessage.mockResolvedValueOnce({ id: 90, role: 'user', text: 'hello', createdAt: 90 });
      h.api.ensureContact.mockResolvedValue({ sourceId: 'fresh-source', pubsubToken: 'fresh-token' });
      h.api.createConversation.mockResolvedValue(43);

      expect(await h.chat.send('hello')).toBe(true);
      expect(h.api.sendMessage).toHaveBeenNthCalledWith(1, 'src-1', 42, 'hello');
      expect(h.api.sendMessage).toHaveBeenNthCalledWith(2, 'fresh-source', 43, 'hello');
      expect(h.chat.messages.value).toHaveLength(1);
      expect(h.chat.messages.value[0].id).toBe(90);
      expect(h.store[1]).toMatchObject({ ...VERIFIED, sourceId: 'fresh-source', conversationId: 43 });
      expect(h.promptAuth).not.toHaveBeenCalled();
    });

    it('recovers a deleted contact when conversation creation returns 404', async () => {
      const h = makeHarness();
      h.store[1] = cached({ conversationId: undefined });
      h.api.createConversation.mockRejectedValueOnce(new ChatRequestError('missing contact', 404));
      h.api.ensureContact.mockResolvedValue({ sourceId: 'fresh-source', pubsubToken: 'fresh-token' });
      expect(await h.chat.send('hello')).toBe(true);
      expect(h.api.ensureContact).toHaveBeenCalledTimes(1);
      expect(h.api.createConversation).toHaveBeenNthCalledWith(2, 'fresh-source');
      expect(h.api.sendMessage).toHaveBeenCalledTimes(1);
      expect(h.promptAuth).not.toHaveBeenCalled();
    });

    it('stops after one failed retry and leaves the draft unsent', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      h.api.sendMessage.mockRejectedValue(new ChatRequestError('still missing', 404));
      expect(await h.chat.send('hello')).toBe(false);
      expect(h.api.sendMessage).toHaveBeenCalledTimes(2);
      expect(h.store[1]).toEqual(VERIFIED);
      expect(h.chat.messages.value).toEqual([]);
      expect(h.chat.connectionState.value).toBe('unavailable');
      expect(h.chat.errorKey.value).toBe('support.error.unavailable');
      expect(h.chat.busy.value).toBe(false);
    });

    it('keeps cached handles on transient history errors and exposes an unavailable state', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      h.api.listMessages.mockRejectedValueOnce(new ChatRequestError('server unavailable', 503));
      await h.chat.enter();
      expect(h.store[1]).toEqual(cached());
      expect(h.chat.connectionState.value).toBe('unavailable');
      expect(h.chat.errorKey.value).toBe('support.error.unavailable');
      expect(h.cable.connect).not.toHaveBeenCalled();
      await h.chat.enter();
      expect(h.chat.errorKey.value).toBeNull();
      expect(h.cable.connect).toHaveBeenCalledTimes(1);
    });

    it('never retries an ambiguous failed send that could have reached the server', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      h.api.sendMessage.mockRejectedValue(new ChatRequestError('gateway timeout', 504));
      expect(await h.chat.send('hello')).toBe(false);
      expect(h.api.sendMessage).toHaveBeenCalledTimes(1);
      expect(h.api.ensureContact).not.toHaveBeenCalled();
      expect(h.store[1]).toEqual(cached());
    });

    it('ignores a late history 404 after a send has already recovered the conversation', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      const history = deferred<SupportApiMessage[]>();
      h.api.listMessages.mockReturnValueOnce(history.promise);
      const entering = h.chat.enter();
      await flushPromises(2);
      h.api.sendMessage.mockRejectedValueOnce(new ChatRequestError('missing', 404));
      h.api.createConversation.mockResolvedValue(43);
      expect(await h.chat.send('hello')).toBe(true);
      history.reject(new ChatRequestError('old conversation missing', 404));
      await entering;
      expect(h.store[1]?.conversationId).toBe(43);
      expect(h.chat.errorKey.value).toBeNull();
      expect(h.chat.messages.value.map((m) => m.text)).toEqual(['hello']);
    });

    it('disconnects on a reconnect history 404 and ignores callbacks from the retired cable', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      const oldCable = h.cableOptions()!;
      h.api.listMessages.mockRejectedValueOnce(new ChatRequestError('missing', 404));
      oldCable.onReconnected?.();
      await flushPromises(2);
      oldCable.onState('connected');
      oldCable.onMessage({ id: 80, role: 'agent', text: 'old thread', createdAt: 80 });
      oldCable.onReconnected?.();
      expect(h.cable.close).toHaveBeenCalledTimes(1);
      expect(h.chat.connectionState.value).toBe('idle');
      expect(h.chat.messages.value).toEqual([]);
      expect(h.api.listMessages).toHaveBeenCalledTimes(2);
    });

    it('does not clear another wallet when a history 404 arrives after switching', async () => {
      const active = Vue.observable({ wallet: CARDANO_WALLET as SupportWalletSnapshot });
      const h = makeHarness({ wallet: () => active.wallet });
      h.store[1] = cached();
      h.store[2] = cached({ identifier: 'v1:bb', sourceId: 'src-2', conversationId: 77 });
      const history = deferred<SupportApiMessage[]>();
      h.api.listMessages.mockReturnValueOnce(history.promise);
      const entering = h.chat.enter();
      await flushPromises(2);
      active.wallet = { ...CARDANO_WALLET, id: 2 };
      await flushPromises(2);
      history.reject(new ChatRequestError('missing', 404));
      await entering;
      expect(h.store[2]?.conversationId).toBe(77);
      expect(h.chat.errorKey.value).toBeNull();
      expect(h.cache.save).not.toHaveBeenCalled();
    });
  });

  describe('ChatAuthError recovery', () => {
    it('clears the cache, re-handshakes ONCE and retries the send', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      h.api.sendMessage.mockRejectedValueOnce(new ChatAuthError('rejected'));
      h.requestIdentity.mockResolvedValue({ ...VERIFIED, identifier: 'v1:new', identifierHash: 'h2' });

      const ok = await h.chat.send('hi again');

      expect(ok).toBe(true);
      expect(h.cache.clear).toHaveBeenCalledWith(1);
      expect(h.requestIdentity).toHaveBeenCalledTimes(1);
      expect(h.api.ensureContact).toHaveBeenCalledWith({
        identifier: 'v1:new',
        identifierHash: 'h2',
        name: 'quiet-dew-4f2a',
      });
      expect(h.api.sendMessage).toHaveBeenCalledTimes(2);
      expect(h.chat.messages.value.map((m) => m.text)).toEqual(['hi again']);
      expect(h.chat.errorKey.value).toBeNull();
    });

    it('gives up with support.error.unavailable when the retry is rejected too', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      h.api.sendMessage.mockRejectedValue(new ChatAuthError('rejected'));

      const ok = await h.chat.send('hi again');

      expect(ok).toBe(false);
      expect(h.requestIdentity).toHaveBeenCalledTimes(1); // exactly one silent re-handshake
      expect(h.api.sendMessage).toHaveBeenCalledTimes(2); // original + one retry
      expect(h.chat.errorKey.value).toBe('support.error.unavailable');
      expect(h.chat.messages.value).toEqual([]);
    });

    it('gives up when the re-handshake cannot authenticate', async () => {
      const h = makeHarness({ promptAuth: vi.fn().mockResolvedValue(null) });
      h.store[1] = cached();
      h.api.sendMessage.mockRejectedValue(new ChatAuthError('rejected'));
      expect(await h.chat.send('hi')).toBe(false);
      expect(h.chat.errorKey.value).toBe('support.error.unavailable');
    });

    it('carries the display name over to the rebuilt contact when the fresh identity has none', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      h.api.sendMessage.mockRejectedValueOnce(new ChatAuthError('rejected'));
      // Nexus returned a new identifier but no pseudonym — keep the one the agent
      // already knows this person by.
      h.requestIdentity.mockResolvedValue({ identifier: 'v1:new', identifierHash: 'h2', displayName: '' });

      expect(await h.chat.send('hi again')).toBe(true);

      expect(h.api.ensureContact).toHaveBeenCalledWith({
        identifier: 'v1:new',
        identifierHash: 'h2',
        name: 'quiet-dew-4f2a',
      });
    });

    it('persists the carried-over display name as part of recovery, not just on the next write', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      h.api.sendMessage.mockRejectedValue(new ChatAuthError('rejected'));
      h.requestIdentity.mockResolvedValue({ identifier: 'v1:new', identifierHash: 'h2', displayName: '' });
      // Fail right after the re-handshake so recovery's own persist is the ONLY
      // thing that can have written the carried-over name to the cache.
      h.api.ensureContact.mockRejectedValue(new Error('network down'));

      expect(await h.chat.send('hi again')).toBe(false);

      expect(h.store[1]).toMatchObject({ identifier: 'v1:new', displayName: 'quiet-dew-4f2a' });
    });
  });

  describe('incoming messages', () => {
    it('appends agent messages from the cable and counts them as unread until markSeen()', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      const opts = h.cableOptions();
      opts?.onMessage({ id: 5, role: 'agent', text: 'on it', agentName: 'Ada', createdAt: 5 });
      opts?.onMessage({ id: 6, role: 'agent', text: 'fixed', agentName: 'Ada', createdAt: 6 });
      expect(h.chat.unread.value).toBe(2);
      expect(h.chat.messages.value.map((m) => m.text)).toEqual(['on it', 'fixed']);
      h.chat.markSeen();
      expect(h.chat.unread.value).toBe(0);
    });

    it('does not count the user\'s own echoed message as unread, and dedupes by id', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      const opts = h.cableOptions();
      opts?.onMessage({ id: 7, role: 'user', text: 'gm', createdAt: 7 });
      opts?.onMessage({ id: 7, role: 'user', text: 'gm', createdAt: 7 });
      expect(h.chat.unread.value).toBe(0);
      expect(h.chat.messages.value.filter((m) => m.id === 7)).toHaveLength(1);
    });

    it('replaces the optimistic echo when the same text comes back from the server', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      await h.chat.send('gm');
      expect(h.chat.messages.value[0].id).toBeLessThan(0);
      h.cableOptions()?.onMessage({ id: 21, role: 'user', text: 'gm', createdAt: 21 });
      expect(h.chat.messages.value).toHaveLength(1);
      expect(h.chat.messages.value[0].id).toBe(21);
    });

    it('maps cable state onto connectionState', async () => {
      const h = makeHarness();
      h.store[1] = cached();
      await h.chat.enter();
      const opts = h.cableOptions();
      opts?.onState('reconnecting');
      expect(h.chat.connectionState.value).toBe('reconnecting');
      opts?.onState('unavailable');
      expect(h.chat.connectionState.value).toBe('unavailable');
    });
  });

  describe('wallet switch', () => {
    it('resets the thread and re-reads the cache for the new wallet', async () => {
      const active = Vue.observable({ wallet: CARDANO_WALLET as SupportWalletSnapshot });
      const h = makeHarness({ wallet: () => active.wallet });
      h.store[1] = cached();
      h.store[2] = cached({ identifier: 'v1:bb', sourceId: 'src-2', conversationId: 77 });
      h.api.listMessages.mockResolvedValue([{ id: 1, role: 'user', text: 'wallet one', createdAt: 1 }]);
      await h.chat.enter();
      h.chat.unread.value = 3;
      expect(h.chat.messages.value).toHaveLength(1);

      active.wallet = { id: 2, chain: 'Cardano', type: 'Normal', stakeAddress: 'stake1uother' };
      h.api.listMessages.mockResolvedValue([{ id: 8, role: 'user', text: 'wallet two', createdAt: 8 }]);
      await flushPromises();

      expect(h.cable.close).toHaveBeenCalled();
      expect(h.chat.unread.value).toBe(0);
      expect(h.api.listMessages).toHaveBeenLastCalledWith('src-2', 77);
      expect(h.chat.messages.value.map((m) => m.text)).toEqual(['wallet two']);
    });

    it('a switch mid-send never touches the new wallet (no cross-wallet write or delivery)', async () => {
      const active = Vue.observable({ wallet: CARDANO_WALLET as SupportWalletSnapshot });
      const h = makeHarness({ wallet: () => active.wallet });
      // Wallet 1 has an identity but no contact yet, so the send must call
      // ensureContact — which is where we freeze it.
      h.store[1] = { ...VERIFIED };
      h.store[2] = cached({ identifier: 'v1:bb', identifierHash: 'h2', sourceId: 'src-2', conversationId: 77 });
      const contact = deferred<{ sourceId: string; pubsubToken: string }>();
      h.api.ensureContact.mockReturnValue(contact.promise);

      const pending = h.chat.send('for wallet one');
      await flushPromises(2);
      expect(h.api.ensureContact).toHaveBeenCalledTimes(1);

      // The user switches wallets while the contact round-trip is in flight.
      active.wallet = { id: 2, chain: 'Cardano', type: 'Normal', stakeAddress: 'stake1uother' };
      await flushPromises();
      contact.resolve({ sourceId: 'src-1', pubsubToken: 'tok-1' });

      expect(await pending).toBe(false);

      // Wallet 2's cached identity is untouched, and nothing was written under its id.
      expect(h.store[2]).toMatchObject({ identifier: 'v1:bb', sourceId: 'src-2', conversationId: 77 });
      expect(h.cache.save).not.toHaveBeenCalledWith(2, expect.anything());
      expect(h.cache.clear).not.toHaveBeenCalled();
      // Wallet 1's message never reached any conversation.
      expect(h.api.sendMessage).not.toHaveBeenCalled();
      // And wallet 2's thread shows neither the message nor an error.
      expect(h.chat.messages.value).toEqual([]);
      expect(h.chat.errorKey.value).toBeNull();
      expect(h.chat.busy.value).toBe(false);
    });

    it('a switch mid-send never wipes the new wallet\'s cache during ChatAuthError recovery', async () => {
      const active = Vue.observable({ wallet: CARDANO_WALLET as SupportWalletSnapshot });
      const h = makeHarness({ wallet: () => active.wallet });
      h.store[1] = cached();
      h.store[2] = cached({ identifier: 'v1:bb', sourceId: 'src-2', conversationId: 77 });
      const post = deferred<never>();
      h.api.sendMessage.mockReturnValue(post.promise);

      const pending = h.chat.send('for wallet one');
      await flushPromises(2);

      active.wallet = { id: 2, chain: 'Cardano', type: 'Normal', stakeAddress: 'stake1uother' };
      await flushPromises();
      post.reject(new ChatAuthError('rejected'));

      expect(await pending).toBe(false);
      // Recovery would normally clear the cache — but only ever for the wallet the
      // send belonged to, and here it must not run at all.
      expect(h.cache.clear).not.toHaveBeenCalledWith(2);
      expect(h.store[2]).toMatchObject({ identifier: 'v1:bb' });
      expect(h.chat.errorKey.value).toBeNull();
    });

    it('leaves no orphan optimistic bubble when a switch abandons the send after the POST', async () => {
      const active = Vue.observable({ wallet: CARDANO_WALLET as SupportWalletSnapshot });
      const h = makeHarness({ wallet: () => active.wallet });
      h.store[1] = cached();
      h.store[2] = cached({ identifier: 'v1:bb', sourceId: 'src-2', conversationId: 77 });
      const post = deferred<SupportApiMessage>();
      h.api.sendMessage.mockReturnValue(post.promise);

      const pending = h.chat.send('for wallet one');
      await flushPromises(2);
      // The bubble is on screen optimistically while the POST is in flight.
      expect(h.chat.messages.value.map((m) => m.text)).toEqual(['for wallet one']);

      active.wallet = { id: 2, chain: 'Cardano', type: 'Normal', stakeAddress: 'stake1uother' };
      await flushPromises();
      // The POST itself SUCCEEDS here — the send is abandoned only by the
      // ownership check that follows it, which deliberately reports no error
      // (the thread it belonged to no longer exists). This is the one shape
      // where a rollback keyed on `errorKey` would never fire; keying it on
      // "did this text actually get delivered" is what makes the cleanup local
      // instead of leaning on resetThread having replaced the array.
      post.resolve({ id: 31, role: 'user', text: 'for wallet one', createdAt: 31000 });

      expect(await pending).toBe(false);
      expect(h.chat.messages.value).toEqual([]);
      expect(h.chat.errorKey.value).toBeNull();
      expect(h.chat.busy.value).toBe(false);
    });

    it('a send after a switch uses the NEW wallet identity', async () => {
      let current: SupportWalletSnapshot = CARDANO_WALLET;
      const h = makeHarness({ wallet: () => current });
      h.store[1] = cached();
      h.store[2] = cached({ identifier: 'v1:bb', identifierHash: 'h2', sourceId: 'src-2', conversationId: 77 });
      await h.chat.enter();
      current = { id: 2, chain: 'Cardano', type: 'Normal', stakeAddress: 'stake1uother' };
      await h.chat.send('hello from wallet two');
      expect(h.api.sendMessage).toHaveBeenCalledWith('src-2', 77, 'hello from wallet two');
      expect(h.promptAuth).not.toHaveBeenCalled();
    });
  });
});
