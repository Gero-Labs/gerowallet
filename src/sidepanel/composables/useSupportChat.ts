// src/sidepanel/composables/useSupportChat.ts
//
// Non-custodial live support chat — state machine + orchestration.
//
// Identity is the wallet's stake address, pseudonymized by Nexus: the background
// signs a Nexus-issued challenge with the stake key (CIP-8) exactly once per
// wallet, and Nexus returns a Chatwoot identifier + HMAC + display name. From
// there the side panel talks straight to Chatwoot's public Client API (REST +
// ActionCable). Everything is cached per wallet, so the signature prompt happens
// once, ever.
//
// This module never imports i18n: it only ever exposes an i18n KEY (`errorKey`)
// and lets the UI render it. It also never logs identifiers, tokens, or
// addresses.
//
// NOT flag-gated by design. `isAvailable` answers "can this wallet sign the
// handshake", which is a capability question; whether the feature is offered at
// all is `featureFlags.isLiveChatEnabled()`, checked by the UI that owns the
// entry point. Keeping the two separate means the flag has exactly one owner and
// this composable stays testable without a flag store.
//
// Structural model: `useAgentDock.ts` — an injectable factory plus a singleton.

import { computed, ref, watch, type Ref } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Blockchain, WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';
import {
  ChatAuthError,
  ChatRequestError,
  chatwootSupportApi,
  SUPPORT_MAX_FILE_BYTES,
  SUPPORT_MAX_FILES_PER_MESSAGE,
  type SupportApiMessage,
  type SupportAttachment,
  type SupportContact,
  type SupportContactIdentity,
} from '@/api/chatwootSupport.client';
import {
  createSupportCable,
  type SupportCable,
  type SupportCableOptions,
  type SupportCableState,
} from '@/services/support/actionCable';
import {
  supportIdentityCache,
  type SupportChatIdentity,
  type SupportChatVerifiedIdentity,
  type SupportIdentityCache,
} from '@/services/support/identityCache';

// Re-exported so the UI's file-picker validation imports the SAME caps/type this
// module enforces, rather than a local mirror that could drift out of sync.
export { SUPPORT_MAX_FILE_BYTES, SUPPORT_MAX_FILES_PER_MESSAGE, type SupportAttachment } from '@/api/chatwootSupport.client';

export type SupportConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

export interface SupportMessage {
  /** Chatwoot message id; NEGATIVE for an optimistic local echo not yet confirmed. */
  id: number;
  /**
   * Stable client-side list key. Set on an optimistic echo (its original negative
   * id) and carried onto the reconciled message when the server id arrives, so the
   * UI's `:key` does not change under it — otherwise Vue tears down and re-animates
   * the user's own bubble on every send. Undefined for messages that never had an
   * optimistic twin (history and cable arrivals).
   */
  clientId?: number;
  role: 'user' | 'agent';
  text: string;
  agentName?: string;
  /** epoch ms */
  createdAt: number;
  attachments?: SupportAttachment[];
}

export interface SupportChat {
  messages: Ref<SupportMessage[]>;
  /** A send is in flight. */
  busy: Ref<boolean>;
  connectionState: Ref<SupportConnectionState>;
  /** Incoming agent messages since the last markSeen(). */
  unread: Ref<number>;
  /** False when the wallet has no signable stake key (hardware / non-Cardano). */
  isAvailable: Ref<boolean>;
  /**
   * i18n KEY only — the UI renders it. One of `support.error.unavailable`,
   * `support.error.sendFailed`, `support.error.fileTooLarge` (a file exceeds
   * {@link SUPPORT_MAX_FILE_BYTES}), or `support.error.tooManyFiles` (more than
   * {@link SUPPORT_MAX_FILES_PER_MESSAGE} files in one send).
   */
  errorKey: Ref<string | null>;
  /** Idempotent: load history (only if an identity is cached) and connect the cable. */
  enter(): Promise<void>;
  /** false = not sent (auth cancelled/failed/invalid) → the UI keeps the draft. */
  send(text: string, files?: File[]): Promise<boolean>;
  markSeen(): void;
}

/** Credentials the background needs to unlock the stake key for the handshake. */
export interface SupportAuthInput {
  /** Spending password (software wallets). */
  password?: string;
  /** Pre-decrypted root key bytes (PRF / PassKey wallets), as a plain array for messaging. */
  privateKeyBytes?: number[];
}

/** The wallet facts the chat needs. Mirrors `walletStore.loggedWallet`. */
export interface SupportWalletSnapshot {
  id: number;
  chain?: string;
  type?: string;
  stakeAddress?: string;
}

/** The Chatwoot surface the composable depends on (injectable for tests). */
export interface SupportChatApi {
  ensureContact(identity: SupportContactIdentity): Promise<SupportContact>;
  createConversation(sourceId: string): Promise<number>;
  listMessages(sourceId: string, conversationId: number): Promise<SupportApiMessage[]>;
  sendMessage(
    sourceId: string,
    conversationId: number,
    content: string,
    files?: File[],
  ): Promise<SupportApiMessage | null>;
}

export interface SupportChatDeps {
  api?: SupportChatApi;
  cache?: SupportIdentityCache;
  createCable?: (options: SupportCableOptions) => SupportCable;
  /** Runs the stake-key handshake in the background. null = could not authenticate. */
  requestIdentity?: (auth: SupportAuthInput) => Promise<SupportChatVerifiedIdentity | null>;
  /**
   * Collects spending auth for the one-time handshake. Resolving null means the
   * user CANCELLED (no error shown); throwing means auth FAILED. The default
   * throws until the dock wires a prompt in — see {@link setSupportAuthPrompt}.
   */
  promptAuth?: () => Promise<SupportAuthInput | null>;
  wallet?: () => SupportWalletSnapshot | null;
}

/**
 * Result of establishing an identity. `cancelled` and `failed` both stop the send,
 * but only `failed` is worth surfacing as an error — see {@link setSupportAuthPrompt}.
 */
type IdentityOutcome =
  | { status: 'ok'; identity: SupportChatIdentity }
  | { status: 'cancelled' }
  | { status: 'failed' };

/** Which wallet's thread an in-flight async operation belongs to. */
interface ThreadSession {
  /** Wallet id captured when the operation started — the ONLY id it may write to. */
  owner: number;
  /** Thread generation, bumped on every reset, so a switch-back is still detected. */
  gen: number;
}

/**
 * Thrown (and swallowed) when the wallet changed mid-operation. Not an error the
 * user should see: the thread it belonged to no longer exists on screen.
 */
class StaleSessionError extends Error {
  constructor() {
    super('Support chat session superseded');
    this.name = 'StaleSessionError';
  }
}

/**
 * Wallet types whose stake key the BACKGROUND can unlock for the handshake.
 * `Normal` covers both password and PRF/PassKey wallets. Hardware wallets
 * (Ledger/Trezor/Keystone) have no decryptable key here, and MPC `Google` wallets
 * would need the MPC session share path (`resolveSignPrivateKeyBytes`), so both
 * are reported as unavailable rather than failing halfway through a send.
 *
 * Fails CLOSED: a record with no `type` at all is treated as not-signable rather
 * than assumed to be a software wallet.
 */
const SIGNABLE_WALLET_TYPES = new Set<string>([WalletType.Normal]);

/** Ask the background to run challenge → CIP-8 sign → verify. */
async function backgroundRequestIdentity(auth: SupportAuthInput): Promise<SupportChatVerifiedIdentity | null> {
  try {
    const response = (await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SUPPORT_CHAT_AUTH,
      data: { password: auth.password, privateKeyBytes: auth.privateKeyBytes },
    })) as { data?: { success?: boolean; identity?: SupportChatVerifiedIdentity } } | null;
    const result = response?.data;
    if (!result?.success || !result.identity?.identifier) return null;
    return result.identity;
  } catch (error) {
    debugLog('supportChat: handshake message failed', error);
    return null;
  }
}

/**
 * Spending-auth prompt for the one-time handshake.
 *
 * The stake key can only be unlocked with the spending password (or a PassKey PRF
 * secret), and collecting either needs UI this module must not own.
 *
 * CONTRACT — the two outcomes are NOT the same and must be signalled differently:
 * <ul>
 *   <li>resolve `null` = the user deliberately CANCELLED. `send()` returns false
 *       and leaves `errorKey` null, so the dock keeps the draft without flashing
 *       an error banner at someone who just changed their mind.</li>
 *   <li>THROW = auth genuinely failed (wrong password, PassKey error, no prompt
 *       wired yet). `send()` returns false with `support.error.sendFailed`.</li>
 * </ul>
 * Resolving an auth object means "proceed with these credentials".
 */
let authPrompt: (() => Promise<SupportAuthInput | null>) | null = null;

/** Wire the spending-auth prompt (called once by the UI layer that owns the dialog). */
export function setSupportAuthPrompt(prompt: (() => Promise<SupportAuthInput | null>) | null): void {
  authPrompt = prompt;
}

function defaultPromptAuth(): Promise<SupportAuthInput | null> {
  // No prompt wired yet is a FAILURE, not a user cancel — the send could never
  // have succeeded, so the dock should say so rather than silently swallow it.
  if (!authPrompt) return Promise.reject(new Error('Support chat auth prompt not wired'));
  return authPrompt();
}

function defaultWallet(): SupportWalletSnapshot | null {
  const logged = walletStore.loggedWallet as SupportWalletSnapshot | null;
  return logged && typeof logged.id === 'number' ? logged : null;
}

export function createSupportChat(deps: SupportChatDeps = {}): SupportChat {
  const api: SupportChatApi = deps.api ?? chatwootSupportApi;
  const cache: SupportIdentityCache = deps.cache ?? supportIdentityCache;
  const makeCable = deps.createCable ?? createSupportCable;
  const requestIdentity = deps.requestIdentity ?? backgroundRequestIdentity;
  const promptAuth = deps.promptAuth ?? defaultPromptAuth;
  const readWallet = deps.wallet ?? defaultWallet;

  const messages: Ref<SupportMessage[]> = ref([]);
  const busy: Ref<boolean> = ref(false);
  const connectionState: Ref<SupportConnectionState> = ref<SupportConnectionState>('idle');
  const unread: Ref<number> = ref(0);
  const errorKey: Ref<string | null> = ref<string | null>(null);

  const isAvailable = computed<boolean>(() => {
    const wallet = readWallet();
    if (!wallet) return false;
    if (wallet.chain !== Blockchain.CARDANO) return false;
    if (!wallet.stakeAddress || !wallet.stakeAddress.startsWith('stake1')) return false;
    return !!wallet.type && SIGNABLE_WALLET_TYPES.has(wallet.type);
  });

  let identity: SupportChatIdentity | null = null;
  let cable: SupportCable | null = null;
  let cableGeneration = 0;
  let entered = false;
  let walletId: number | null = null;
  let nextLocalId = 1;
  /** Bumped by every thread reset; see {@link ThreadSession}. */
  let generation = 0;

  /**
   * Snapshot of "which wallet's thread am I working on". Every async operation
   * takes one at entry and re-checks it after each await, because a wallet switch
   * can land mid-flight and re-point `walletId`/`identity` underneath it. Without
   * this, an in-flight send could persist wallet A's identity under wallet B's id,
   * post A's message into B's conversation, or wipe B's healthy cache.
   */
  function beginSession(): ThreadSession | null {
    return walletId === null ? null : { owner: walletId, gen: generation };
  }

  function isStale(session: ThreadSession): boolean {
    return walletId !== session.owner || generation !== session.gen;
  }

  /** Abort the in-flight operation if the thread it belongs to is gone. */
  function assertOwn(session: ThreadSession): void {
    if (isStale(session)) throw new StaleSessionError();
  }

  function setError(key: string | null): void {
    errorKey.value = key;
  }

  function disconnectCable(): void {
    cableGeneration += 1;
    cable?.close();
    cable = null;
  }

  function resetThread(): void {
    generation += 1;
    disconnectCable();
    identity = null;
    entered = false;
    messages.value = [];
    unread.value = 0;
    connectionState.value = 'idle';
    setError(null);
  }

  /** Append (or reconcile) a message that arrived from the server. */
  function ingest(message: SupportMessage, countUnread = true): void {
    // Already present (e.g. a gap-fill re-listing it): keep the entry we have, so
    // a reconciled message does not lose its clientId and change the UI's key.
    if (messages.value.some((m) => m.id === message.id)) return;
    if (message.role === 'user') {
      // Reconcile our own optimistic echo instead of showing the text twice, and
      // carry its clientId across so the UI's list key survives the id swap.
      const index = messages.value.findIndex((m) => m.id < 0 && m.text === message.text);
      if (index !== -1) {
        const local = messages.value[index];
        messages.value.splice(index, 1, { ...message, clientId: local.clientId ?? local.id });
        return;
      }
    }
    messages.value.push(message);
    if (countUnread && message.role === 'agent') unread.value += 1;
  }

  /**
   * Merge server history into the thread.
   *
   * MERGE, never replace: an optimistic echo or a cable message can land while the
   * fetch is in flight, and assigning the response would drop it. `countUnread` is
   * false for the initial load (the user is opening the thread, so old agent
   * messages are not "new") and true for a reconnect gap-fill, where anything that
   * arrived while the socket was down genuinely is unseen.
   */
  async function loadHistory(session: ThreadSession, countUnread: boolean): Promise<boolean> {
    const sourceId = identity?.sourceId;
    const conversationId = identity?.conversationId;
    if (!sourceId || !conversationId) return true;
    // A send can replace a deleted conversation while this request is pending.
    const isCurrent = () =>
      !isStale(session) && identity?.sourceId === sourceId && identity?.conversationId === conversationId;
    let history: SupportMessage[];
    try {
      history = await api.listMessages(sourceId, conversationId);
    } catch (error) {
      if (!isCurrent()) return false;
      debugLog('supportChat: history fetch failed', error);
      if (isMissingChatSession(error)) {
        await discardChatSession(session);
        if (!isStale(session) && !identity?.conversationId) setError('support.error.sessionExpired');
      } else {
        connectionState.value = 'unavailable';
        setError('support.error.unavailable');
      }
      return false;
    }
    if (!isCurrent()) return false;
    for (const message of history) ingest(message, countUnread);
    messages.value.sort((a, b) => a.createdAt - b.createdAt);
    return true;
  }

  function connectCable(session: ThreadSession): void {
    // Every caller already checks, but make the safety local rather than
    // emergent: opening a socket for a thread that no longer exists would
    // subscribe the new wallet's UI to the old wallet's conversation.
    if (isStale(session)) return;
    if (!identity?.pubsubToken) return;
    if (cable) {
      cable.connect();
      return;
    }
    const cableSession = cableGeneration;
    const isCurrentCable = () => !isStale(session) && cableSession === cableGeneration;
    cable = makeCable({
      pubsubToken: identity.pubsubToken,
      // Read at dispatch time: the conversation is created lazily and may not
      // exist yet when the cable comes up.
      activeConversationId: () => identity?.conversationId,
      onMessage: (message) => {
        if (!isCurrentCable()) return;
        ingest(message);
      },
      onState: (state: SupportCableState) => {
        if (!isCurrentCable()) return;
        connectionState.value = state;
      },
      // Broadcasts during a drop are not replayed, so refill from REST — and count
      // what we missed as unread.
      onReconnected: () => {
        if (!isCurrentCable()) return;
        void loadHistory(session, true);
      },
    });
    cable.connect();
    connectionState.value = 'connecting';
  }

  /**
   * Re-point state at whichever wallet is active now. Returns the active id.
   * `autoReenter` is only set by the watcher: when an operation triggers the
   * switch it re-reads the new wallet's cache on its own, so re-entering there
   * would just duplicate the work.
   */
  function syncWallet(autoReenter = false): number | null {
    const current = readWallet();
    const id = current?.id ?? null;
    if (id !== walletId) {
      const hadEntered = entered;
      resetThread();
      walletId = id;
      if (autoReenter && hadEntered && id !== null) void enter();
    }
    return walletId;
  }

  /**
   * Persist whatever we know about the identity so the next session skips the
   * handshake. Writes to the session's OWNER id, never to whatever wallet happens
   * to be active when the write lands.
   */
  async function persist(session: ThreadSession): Promise<void> {
    if (isStale(session) || !identity) return;
    await cache.save(session.owner, identity);
  }

  function isMissingChatSession(error: unknown): boolean {
    return error instanceof ChatRequestError && error.status === 404;
  }

  /** Keep the signed identity, but forget handles that Chatwoot no longer has. */
  async function discardChatSession(session: ThreadSession): Promise<void> {
    assertOwn(session);
    if (!identity) return;
    const { identifier, identifierHash, displayName } = identity;
    disconnectCable();
    identity = { identifier, identifierHash, displayName };
    // Keep any in-flight draft echo so a recovered send can reconcile it once.
    messages.value = messages.value.filter((message) => message.id < 0);
    unread.value = 0;
    connectionState.value = 'idle';
    await persist(session);
  }

  /**
   * Run the one-time stake-key handshake.
   *
   * `cancelled` (the prompt resolved null) is deliberately NOT `failed`: the user
   * chose not to authenticate, which is not an error worth rendering.
   */
  async function handshake(session: ThreadSession): Promise<IdentityOutcome> {
    let auth: SupportAuthInput | null;
    try {
      auth = await promptAuth();
    } catch (error) {
      debugLog('supportChat: auth prompt failed', error);
      return { status: 'failed' };
    }
    assertOwn(session); // the user may have switched wallets at the prompt
    if (!auth) return { status: 'cancelled' };
    const verified = await requestIdentity(auth);
    assertOwn(session);
    if (!verified?.identifier) return { status: 'failed' };
    identity = { ...verified };
    await persist(session);
    return { status: 'ok', identity };
  }

  /** Cached identity, or the handshake result. */
  async function ensureIdentity(session: ThreadSession): Promise<IdentityOutcome> {
    if (identity?.identifier) return { status: 'ok', identity };
    const cachedIdentity = await cache.load(session.owner);
    assertOwn(session);
    if (cachedIdentity?.identifier) {
      identity = cachedIdentity;
      return { status: 'ok', identity };
    }
    return handshake(session);
  }

  /**
   * Contact + conversation, created lazily. `ensureContact` does the POST **and**
   * the mandatory PATCH — without the PATCH the contact is never hmac_verified and
   * silently loses its history across sessions.
   */
  async function ensureConversation(session: ThreadSession): Promise<SupportChatIdentity> {
    assertOwn(session);
    // Work off a local snapshot so a concurrent reset can never leave us
    // dereferencing a half-cleared identity.
    let current = identity;
    if (!current) throw new ChatAuthError('No support identity');

    if (!current.sourceId || !current.pubsubToken) {
      const contact = await api.ensureContact({
        identifier: current.identifier,
        identifierHash: current.identifierHash,
        name: current.displayName,
      });
      // The switch can land while the contact round-trip is in flight; without
      // this, wallet A's contact would be written over wallet B's identity.
      assertOwn(session);
      current = { ...current, sourceId: contact.sourceId, pubsubToken: contact.pubsubToken };
      identity = current;
      await persist(session);
      assertOwn(session);
    }

    if (!current.conversationId) {
      const conversationId = await api.createConversation(current.sourceId as string);
      assertOwn(session);
      current = { ...current, conversationId };
      identity = current;
      await persist(session);
      assertOwn(session);
    }
    return current;
  }

  /**
   * Rebuild the identity from scratch after Chatwoot rejected the current one
   * (rotated/stale HMAC). Runs at most ONCE per send — a genuinely bad identity
   * would otherwise loop forever.
   */
  async function recoverIdentity(session: ThreadSession): Promise<boolean> {
    // Guarded + owner-scoped: a mid-flight switch must never wipe the cache of the
    // wallet that is now active — its identity is perfectly healthy.
    assertOwn(session);
    await cache.clear(session.owner);
    assertOwn(session);
    const displayName = identity?.displayName;
    identity = null;
    disconnectCable();
    const outcome = await handshake(session);
    if (outcome.status !== 'ok') return false;
    // Keep the pseudonym the agent already knows this person by if the fresh
    // handshake didn't return one — and persist it, or the cache keeps the blank.
    if (!outcome.identity.displayName && displayName) {
      identity = { ...outcome.identity, displayName };
      await persist(session);
    }
    return true;
  }

  async function enter(): Promise<void> {
    syncWallet();
    const session = beginSession();
    if (!session || !isAvailable.value) return;
    if (entered && cable?.isConnected()) return;
    entered = true;
    setError(null);

    if (!identity?.identifier) {
      const cachedIdentity = await cache.load(session.owner);
      if (isStale(session)) return;
      // No identity yet → stay idle. The handshake (and its signature prompt)
      // only ever happens on an explicit send.
      if (!cachedIdentity?.identifier) return;
      identity = cachedIdentity;
    }
    if (!identity.sourceId || !identity.pubsubToken) return;

    connectionState.value = 'connecting';
    // Opening the thread is not "receiving" — history must not inflate the badge.
    if (!(await loadHistory(session, false))) return;
    if (isStale(session)) return;
    connectCable(session);
  }

  async function deliver(text: string, session: ThreadSession, files?: File[]): Promise<void> {
    const target = await ensureConversation(session);
    // Call with exactly 3 args when there are no files — keeps the call shape
    // byte-identical to the pre-attachments API for callers/mocks that assert on it.
    const sent = files
      ? await api.sendMessage(target.sourceId as string, target.conversationId as number, text, files)
      : await api.sendMessage(target.sourceId as string, target.conversationId as number, text);
    assertOwn(session); // the POST landed in the OLD thread; don't paint it into the new one
    // Reconcile the optimistic echo with the server's id/timestamp immediately.
    // The cable is not necessarily subscribed yet on a first send, so waiting for
    // the broadcast would leave a negative local id in the thread until the next
    // history load. `ingest` dedupes, so a later broadcast of the same id is a no-op.
    if (sent) ingest(sent);
  }

  async function send(text: string, files?: File[]): Promise<boolean> {
    // Validated FIRST, before any network call or handshake — an oversized or
    // over-count attachment is a client-side mistake the user can fix without
    // ever touching the wallet's signing flow.
    const fileList = files && files.length > 0 ? files : undefined;
    if (fileList && fileList.length > SUPPORT_MAX_FILES_PER_MESSAGE) {
      setError('support.error.tooManyFiles');
      return false;
    }
    if (fileList && fileList.some((file) => file.size > SUPPORT_MAX_FILE_BYTES)) {
      setError('support.error.fileTooLarge');
      return false;
    }

    syncWallet();
    const trimmed = (text || '').trim();
    if (!trimmed && !fileList) return false;
    if (busy.value) return false;
    const session = beginSession();
    if (!session || !isAvailable.value) return false;

    busy.value = true;
    setError(null);
    let optimistic: SupportMessage | null = null;
    /** Did the text actually reach Chatwoot? Drives the rollback in `finally`. */
    let delivered = false;
    try {
      const known = await ensureIdentity(session);
      if (known.status !== 'ok') {
        // A deliberate cancel is not an error — the dock just keeps the draft.
        if (known.status === 'failed') setError('support.error.sendFailed');
        return false;
      }

      // Files present: skip the optimistic echo entirely (`busy` covers the UX
      // while the upload is in flight) so no negative-id bubble is ever shown —
      // the server response, with its real id and server-built attachments, is
      // what lands via `ingest` below.
      if (!fileList) {
        // The negative id doubles as the stable client key: `ingest` carries it
        // onto the reconciled message, so the bubble is never re-keyed mid-send.
        const localId = -nextLocalId++;
        optimistic = { id: localId, clientId: localId, role: 'user', text: trimmed, createdAt: Date.now() };
        messages.value.push(optimistic);
      }

      try {
        await deliver(trimmed, session, fileList);
        delivered = true;
      } catch (error) {
        if (isMissingChatSession(error)) {
          // A 404 guarantees this attempt did not deliver. Rebuild the contact
          // and conversation once, using the already-verified wallet identity.
          await discardChatSession(session);
        } else if (error instanceof ChatAuthError) {
          debugLog('supportChat: identity rejected, re-running handshake');
          if (!(await recoverIdentity(session))) {
            setError('support.error.unavailable');
            return false;
          }
        } else {
          throw error;
        }
        try {
          await deliver(trimmed, session, fileList);
          delivered = true;
        } catch (retryError) {
          if (retryError instanceof StaleSessionError) throw retryError;
          if (isMissingChatSession(retryError)) await discardChatSession(session);
          assertOwn(session);
          debugLog('supportChat: retry after recovery failed', retryError);
          connectionState.value = 'unavailable';
          setError('support.error.unavailable');
          return false;
        }
      }

      entered = true;
      connectCable(session);
      return true;
    } catch (error) {
      // The wallet changed under us: the thread this send belonged to is gone, so
      // there is nothing to report and nothing left to clean up.
      if (error instanceof StaleSessionError) {
        debugLog('supportChat: send abandoned after wallet switch');
        return false;
      }
      debugLog('supportChat: send failed', error);
      setError('support.error.sendFailed');
      return false;
    } finally {
      // A message that never reached Chatwoot must not linger in the thread —
      // send() returned false and the UI still owns the draft. Keyed on DELIVERY,
      // not on `errorKey`: a stale-session abort reports no error at all (its
      // thread is gone), and a concurrent reset can clear the key before this
      // runs, either of which would strand the bubble. Safe on the success path
      // too — a reconciled echo was spliced out already, so indexOf is -1.
      if (optimistic && !delivered) {
        const index = messages.value.indexOf(optimistic);
        if (index !== -1) messages.value.splice(index, 1);
      }
      busy.value = false;
    }
  }

  function markSeen(): void {
    unread.value = 0;
  }

  // Wallet switch while the dock is open: drop the old thread and re-enter for the
  // new wallet (a different wallet is a different, unlinkable support identity).
  watch(
    () => readWallet()?.id ?? null,
    () => {
      syncWallet(true);
    },
  );

  walletId = readWallet()?.id ?? null;

  return { messages, busy, connectionState, unread, isAvailable, errorKey, enter, send, markSeen };
}

/** Singleton shared by the dock UI so the thread survives route changes. */
export const supportChat: SupportChat = createSupportChat();
