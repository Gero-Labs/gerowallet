import { Mutex } from 'async-mutex';
import { watch } from 'vue';
import { CardanoPeerConnect } from '@fabianbormann/cardano-peer-connect';
import type { PeerConnectStorage, IConnectMessage } from '@fabianbormann/cardano-peer-connect';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { walletStore } from '@/stores/walletStore';
import { parseCip45Input } from './qr';
import type { Cip45Pairing, Cip45Session, Cip45Status } from './types';

const PAIRINGS_KEY = 'cip45Pairings';
const PEER_ID_KEY = 'cip45PeerId';
const LIB_STORAGE_KEY = 'cip45LibStorage';
const CONNECT_TIMEOUT_MS = 15_000;

const PRIMARY_PEERJS_CONFIG = {
  host: import.meta.env['VITE_PEERJS_HOST'] || 'peerjs.dev.ecosyseng.cf-deployments.org',
  port: Number(import.meta.env['VITE_PEERJS_PORT'] || 443),
  path: import.meta.env['VITE_PEERJS_PATH'] || '/',
  secure: true,
};
const FALLBACK_PEERJS_CONFIG = {}; // peerjs public cloud defaults

class GeroPeerConnect extends CardanoPeerConnect {
  constructor(
    private service: Cip45Service,
    peerId: string,
    storage: PeerConnectStorage,
    peerJsConfig: Record<string, unknown>,
  ) {
    super(
      {
        name: 'gerowallet-p2p',
        version: chrome.runtime.getManifest().version,
        icon: 'https://gerowallet.io/images/logo.svg',
        requestAutoconnect: true,
      },
      // `peerjs`'s `PeerOptions` isn't re-exported from the package root and
      // isn't a direct dependency of this repo, so cast structurally rather
      // than reaching into a transitive dependency's types (or using `any`,
      // which this repo's eslint config forbids).
      { peerId, storage, peerJsConfig: peerJsConfig as never, logLevel: 'warn' },
    );
  }

  /** Discovery-reconnect gate: only paired (or actively-pairing) dApps may trigger a dial-out. */
  public override connect(identifier: string): string {
    if (!this.service.isAllowedPeerSync(identifier)) {
      console.warn('CIP-45: refusing connection to unknown peer', identifier);
      return '';
    }
    return super.connect(identifier);
  }

  /**
   * Adaptation vs. the brief: `Promise<any>` on the shared invoke helper trips
   * this repo's `@typescript-eslint/no-explicit-any` (error, no test-file
   * exemption). Made generic instead — each override below carries an
   * explicit return type matching the abstract CIP-30 method it implements,
   * so TS infers `T` from that contextual return type rather than needing an
   * `any` escape hatch.
   */
  private invoke = async <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    // Belt-and-braces vs. FIX 1's wallet-switch watcher: the watcher's
    // disconnect() is async and best-effort, so a request already in flight
    // (or one that races the watcher between the wallet-id change and the
    // disconnect landing) must not be forwarded to a session that no longer
    // belongs to the logged-in wallet.
    if (!this.service.isSessionPeerAllowed()) {
      throw { code: -3, info: 'Wallet changed — pairing not authorized' };
    }
    const response = (await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.CIP45_INVOKE,
      data: { method, params, dapp: this.service.currentDappInfo() },
    })) as { data?: { success: boolean; result?: T; error?: unknown } };
    if (!response?.data?.success) {
      throw response?.data?.error ?? { code: -2, info: 'CIP-45 invoke failed' };
    }
    return response.data!.result as T;
  };

  protected override getNetworkId(): Promise<number> { return this.invoke('getNetworkId'); }
  protected override getUtxos(amount?: string, paginate?: unknown): Promise<string[] | null> { return this.invoke('getUtxos', { amount, paginate }); }
  protected override getCollateral(params?: { amount?: string }): Promise<string[] | null> { return this.invoke('getCollateral', params ?? {}); }
  protected override getBalance(): Promise<string> { return this.invoke('getBalance'); }
  protected override getUsedAddresses(): Promise<string[]> { return this.invoke('getUsedAddresses'); }
  protected override getUnusedAddresses(): Promise<string[]> { return this.invoke('getUnusedAddresses'); }
  protected override getChangeAddress(): Promise<string> { return this.invoke('getChangeAddress'); }
  protected override getRewardAddresses(): Promise<string[]> { return this.invoke('getRewardAddresses'); }
  protected override signTx(tx: string, partialSign: boolean): Promise<string> { return this.invoke('signTx', { tx, partialSign }); }
  protected override signData(addr: string, payload: string): Promise<{ key: string; signature: string }> { return this.invoke('signData', { addr, payload }); }
  protected override submitTx(tx: string): Promise<string> { return this.invoke('submitTx', { tx }); }
}

class Cip45Service {
  private wallet: GeroPeerConnect | null = null;
  private session: Cip45Session | null = null;
  private pendingPeerId: string | null = null;
  private pairingsCache: Cip45Pairing[] = [];
  private startedWithFallback = false;
  /**
   * Fix round 1, finding 1: `ensureStarted()` used to check `if (this.wallet)
   * return;` and then cross four `await` points before assigning
   * `this.wallet`, so a `pair()` call racing App.vue's 3s-deferred
   * `resumeIfPaired()` (or any two concurrent callers) could both pass the
   * guard and construct two `GeroPeerConnect` instances — orphaning one live
   * peer connection and double-registering `onDisconnect`/`onServerShutdown`/
   * `beforeunload` handlers. Serialize init through the same `async-mutex`
   * pattern `walletConnect.service.ts` uses (`initMutex.runExclusive`, with
   * the guard re-checked *inside* the critical section) so concurrent callers
   * await the same initialization instead of racing it.
   */
  private initMutex = new Mutex();

  /**
   * Fix round 2, finding 1: a live CIP-45 session used to survive a wallet
   * switch, so a dApp paired to wallet A kept reading wallet B once the user
   * switched. Guards `registerWalletSwitchWatch()` so it's wired exactly
   * once per service instance even though `startWallet()` itself runs more
   * than once (e.g. `restartWithFallback()`'s primary→fallback retry).
   */
  private walletSwitchWatchStarted = false;

  /**
   * Tears down a live session the moment the logged-in wallet changes.
   * `walletStore` is a `Vue.observable` (see stores/walletStore.ts), so
   * Vue 2.7's standalone `watch()` can track `loggedWallet?.id` outside a
   * component. Best-effort: a session-teardown failure here must not become
   * an unhandled rejection or block the wallet switch itself.
   */
  private registerWalletSwitchWatch(): void {
    if (this.walletSwitchWatchStarted) return;
    this.walletSwitchWatchStarted = true;
    watch(
      () => walletStore.loggedWallet?.id,
      () => {
        if (this.session) {
          this.disconnect().catch(() => { /* best effort */ });
        }
      },
    );
  }

  currentDappInfo(): { name: string; url: string } | undefined {
    return this.session ? { name: this.session.dappName, url: this.session.dappUrl } : undefined;
  }

  isAllowedPeerSync(peerId: string): boolean {
    return this.pendingPeerId === peerId
      || this.activePairings().some(p => p.dappPeerId === peerId);
  }

  /**
   * Fix round 2, finding 1 (belt-and-braces): the wallet-switch watcher in
   * `startWallet()` tears the session down on a wallet switch, but that
   * disconnect is async/best-effort. `GeroPeerConnect.invoke()` calls this
   * first so a CIP-30 request already in flight (or racing the watcher)
   * can't be served against a session paired to a wallet that's no longer
   * logged in.
   */
  isSessionPeerAllowed(): boolean {
    return !this.session || this.isAllowedPeerSync(this.session.dappPeerId);
  }

  async isAllowedPeer(peerId: string): Promise<boolean> {
    await this.loadPairings();
    return this.isAllowedPeerSync(peerId);
  }

  async getPairings(): Promise<Cip45Pairing[]> {
    await this.loadPairings();
    return this.activePairings();
  }

  /**
   * Fix round 1, finding 2: `pairingsCache` holds every wallet's pairings
   * (each entry carries its own `walletId`), but `isAllowedPeerSync()`,
   * `getPairings()`, and `resumeIfPaired()` used to read the flat cache
   * directly — after a wallet switch, wallet A's paired dApp would still
   * pass wallet B's discovery-reconnect gate. Every READ that decides "is
   * this dApp allowed to reach the currently logged-in wallet" goes through
   * this helper instead. The on-disk list stays flat (unscoped) by design —
   * `removePairing()` still operates on it by peerId — and wallet-switch
   * auto-disconnect is explicitly out of scope for this fix.
   */
  private activePairings(): Cip45Pairing[] {
    const walletId = this.currentWalletId();
    return this.pairingsCache.filter(p => p.walletId === walletId);
  }

  private currentWalletId(): string {
    return String((walletStore.loggedWallet as { id?: unknown } | null)?.id ?? '');
  }

  private async loadPairings(): Promise<void> {
    const stored = await chrome.storage.local.get(PAIRINGS_KEY);
    this.pairingsCache = (stored?.[PAIRINGS_KEY] as Cip45Pairing[]) ?? [];
  }

  private async savePairings(): Promise<void> {
    await chrome.storage.local.set({ [PAIRINGS_KEY]: this.pairingsCache });
  }

  private async buildLibStorage(): Promise<PeerConnectStorage> {
    // The library's storage interface is sync; back it with a write-through
    // in-memory cache preloaded from chrome.storage.local.
    const stored = await chrome.storage.local.get(LIB_STORAGE_KEY);
    const cache: Record<string, string> = (stored?.[LIB_STORAGE_KEY] as Record<string, string>) ?? {};
    const persist = () => { chrome.storage.local.set({ [LIB_STORAGE_KEY]: cache }); };
    return {
      get: (key) => cache[key] ?? null,
      set: (key, value) => { cache[key] = value; persist(); },
      remove: (key) => { delete cache[key]; persist(); },
    };
  }

  private async ensureStarted(peerJsConfig: Record<string, unknown> = PRIMARY_PEERJS_CONFIG): Promise<void> {
    if (this.wallet) return;
    await this.initMutex.runExclusive(async () => {
      // Re-check: another caller may have finished init while we waited for the lock.
      if (this.wallet) return;
      await this.startWallet(peerJsConfig);
    });
  }

  /**
   * Tears the current peer down and rebuilds it against the fallback peerjs
   * config, all inside the same `initMutex` critical section as
   * `ensureStarted()` — so a concurrent `ensureStarted()`/`resumeIfPaired()`
   * call can't observe `this.wallet` mid-teardown (already destroyed, not
   * yet nulled, or nulled but not yet rebuilt) and either dial out on a dead
   * peer or race the rebuild. `startWallet()` itself must not go through
   * `ensureStarted()` here — `Mutex` isn't reentrant, so calling back into
   * `runExclusive` from inside an already-held critical section would
   * deadlock.
   */
  private async restartWithFallback(): Promise<void> {
    await this.initMutex.runExclusive(async () => {
      try { this.wallet?.destroy(); } catch { /* best effort */ }
      this.wallet = null;
      this.startedWithFallback = true;
      await this.startWallet(FALLBACK_PEERJS_CONFIG);
    });
  }

  /** Assumes `initMutex` is already held by the caller. */
  private async startWallet(peerJsConfig: Record<string, unknown>): Promise<void> {
    await this.loadPairings();

    const stored = await chrome.storage.local.get(PEER_ID_KEY);
    let peerId = stored?.[PEER_ID_KEY] as string | undefined;
    if (!peerId) {
      peerId = `gero-${crypto.randomUUID()}`;
      await chrome.storage.local.set({ [PEER_ID_KEY]: peerId });
    }

    const storage = await this.buildLibStorage();
    this.wallet = new GeroPeerConnect(this, peerId, storage, peerJsConfig);
    this.registerWalletSwitchWatch();

    this.setConnectHandler((message) => {
      if (!message.connected) return;
      this.session = {
        dappPeerId: message.dApp.address,
        dappName: message.dApp.name,
        dappUrl: message.dApp.url,
        identicon: this.wallet?.getIdenticon() ?? null,
        connectedAt: Date.now(),
      };
      this.recordPairing(message.dApp.address, message.dApp.name, message.dApp.url);
      this.pushSession('connected', this.session);
    });
    this.wallet.setOnDisconnect(() => {
      this.session = null;
      this.pushSession('disconnected', null);
    });
    this.wallet.setOnServerShutdown(() => {
      this.session = null;
      this.pushSession('disconnected', null);
    });

    window.addEventListener('beforeunload', () => {
      try { this.wallet?.destroy(); } catch { /* best effort */ }
    });
  }

  private recordPairing(dappPeerId: string, dappName: string, dappUrl: string): void {
    const walletId = this.currentWalletId();
    // Fix round 2, finding 3: the on-disk list is flat (every wallet's
    // pairings share it — see activePairings() above), but de-duping by bare
    // dappPeerId meant a dApp already paired under wallet A never persisted
    // a record for wallet B, so wallet B's reconnect gate (isAllowedPeerSync
    // → activePairings(), scoped by walletId) would then refuse a dApp it
    // just connected to. De-dupe by the (dappPeerId, walletId) pair instead.
    if (!this.pairingsCache.some(p => p.dappPeerId === dappPeerId && p.walletId === walletId)) {
      this.pairingsCache.push({ dappPeerId, dappName, dappUrl, walletId, pairedAt: Date.now() });
      this.savePairings();
    }
  }

  private async pushSession(status: Cip45Status, session: Cip45Session | null): Promise<void> {
    try {
      await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.CIP45_UPDATE_SESSION,
        data: { status, session },
      });
    } catch {
      // The store update is cosmetic; never fail the connection over it.
    }
  }

  /** Pair with a dApp from a scanned QR payload or a pasted peer id. */
  async pair(input: string): Promise<void> {
    const { dappPeerId } = parseCip45Input(input); // throws 'invalid' / 'stale'
    // Fix round 2, finding 2: `startedWithFallback` used to be set once and
    // never reset, so once ANY pair() attempt in this service's lifetime had
    // fallen back, every later pair() attempt lost its one retry forever —
    // even a brand new pairing with no relation to the earlier failure.
    // Scope the flag to a single pair() attempt sequence instead.
    this.startedWithFallback = false;
    await this.ensureStarted();
    this.pendingPeerId = dappPeerId;
    this.pushSession('connecting', null);

    try {
      await this.connectWithTimeout(dappPeerId);
    } catch (primaryError) {
      // Fix round 2, finding 2: retry only on the 15s connect timeout
      // (signaling-level failure) — a dApp-side rejection surfaces as
      // Error(message.errorMessage || 'rejected') from connectWithTimeout
      // and must propagate immediately, not trigger a fallback retry.
      const isTimeout = primaryError instanceof Error && primaryError.message === 'timeout';
      if (!isTimeout || this.startedWithFallback) throw primaryError;
      // One retry against the peerjs public cloud (signaling-level failure).
      console.warn('CIP-45: primary signaling failed, retrying via public cloud', primaryError);
      await this.restartWithFallback();
      this.pendingPeerId = dappPeerId;
      await this.connectWithTimeout(dappPeerId);
    } finally {
      this.pendingPeerId = null;
    }
  }

  private connectWithTimeout(dappPeerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('timeout'));
      }, CONNECT_TIMEOUT_MS);

      const previous = this.standingOnConnect;
      this.setConnectHandler((message) => {
        clearTimeout(timer);
        previous?.(message);
        if (message.connected) resolve();
        else reject(new Error(message.errorMessage || 'rejected'));
      });

      this.wallet!.connect(dappPeerId);
    });
  }

  /**
   * Adaptation vs. the brief: the brief reads the standing handler back off
   * the live instance with `this.wallet!['onConnect']`. That bracket read
   * does type-check (TS's `protected` visibility check is bypassed by
   * element-access syntax, unlike `.onConnect`), and against the *real*
   * library it would work, since its `setOnConnect` assigns `this.onConnect
   * = cb` internally (confirmed in the published bundle) with a no-op
   * default from the constructor. But the brief's own spec mock does not
   * mirror that internal assignment — its `setOnConnect` only stashes the
   * callback into the test's external `callbacks` bag, so `wallet['onConnect']`
   * would read back `undefined` and crash the very case Step 1 tests for
   * ("pair() connects... and records the pairing on success" — confirmed by
   * running the literal brief snippet: `TypeError: previous is not a
   * function`). `Cip45Service` tracks its own reference to the standing
   * handler instead, updated every time it calls `setOnConnect`, so
   * `connectWithTimeout()` can wrap-and-chain it without depending on the
   * peer-connect instance's internal field bookkeeping.
   */
  private standingOnConnect: ((message: IConnectMessage) => void) | null = null;

  private setConnectHandler(handler: (message: IConnectMessage) => void): void {
    this.standingOnConnect = handler;
    this.wallet!.setOnConnect(handler);
  }

  async disconnect(): Promise<void> {
    try { this.wallet?.disconnect(''); } catch { /* not connected */ }
    this.session = null;
    this.pushSession('idle', null);
  }

  async removePairing(dappPeerId: string): Promise<void> {
    await this.loadPairings();
    this.pairingsCache = this.pairingsCache.filter(p => p.dappPeerId !== dappPeerId);
    await this.savePairings();
    if (this.session?.dappPeerId === dappPeerId) await this.disconnect();
  }

  /** Start the discovery peer if this wallet has pairings, so dApps can auto-reconnect. */
  async resumeIfPaired(): Promise<void> {
    await this.loadPairings();
    if (this.activePairings().length > 0) {
      await this.ensureStarted();
      this.pushSession(this.session ? 'connected' : 'idle', this.session);
    }
  }
}

export const cip45Service = new Cip45Service();
export default cip45Service;
