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
      // peerjs's PeerOptions isn't re-exported; cast structurally (eslint forbids any).
      { peerId, storage, peerJsConfig: peerJsConfig as never, logLevel: 'warn' },
    );
  }

  // Discovery-reconnect gate: only paired (or actively-pairing) dApps may dial out.
  public override connect(identifier: string): string {
    if (!this.service.isAllowedPeerSync(identifier)) {
      console.warn('CIP-45: refusing connection to unknown peer', identifier);
      return '';
    }
    return super.connect(identifier);
  }

  // Generic so each override keeps its CIP-30 return type (eslint forbids any).
  private invoke = async <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    // Don't forward a request for a wallet that's no longer logged in.
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
  // Serialize init so concurrent pair()/resumeIfPaired() calls don't build two peers.
  private initMutex = new Mutex();
  private walletSwitchWatchStarted = false;

  // Tear down a live session when the logged-in wallet changes (wired once).
  private registerWalletSwitchWatch(): void {
    if (this.walletSwitchWatchStarted) return;
    this.walletSwitchWatchStarted = true;
    watch(
      () => walletStore.loggedWallet?.id,
      (newId) => {
        // Only a real switch to a different wallet drops the session; transient
        // loggedWallet clears during signing must not (isSessionPeerAllowed re-checks).
        if (newId && this.session && !this.isSessionPeerAllowed()) {
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

  // Request-time gate: block invokes for a session not paired under the active wallet.
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

  // The on-disk list is flat; scope reads to the active wallet by walletId.
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

  // The library's storage is sync; back it with a write-through cache over chrome.storage.
  private async buildLibStorage(): Promise<PeerConnectStorage> {
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
      if (this.wallet) return; // another caller may have finished init while we waited
      await this.startWallet(peerJsConfig);
    });
  }

  // Rebuild on the fallback config inside the same mutex; calls startWallet directly
  // (not ensureStarted) because Mutex isn't reentrant.
  private async restartWithFallback(): Promise<void> {
    await this.initMutex.runExclusive(async () => {
      try { this.wallet?.destroy(); } catch { /* best effort */ }
      this.wallet = null;
      this.startedWithFallback = true;
      await this.startWallet(FALLBACK_PEERJS_CONFIG);
    });
  }

  // Assumes initMutex is already held by the caller.
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
    // De-dupe by (dappPeerId, walletId) so each wallet keeps its own pairing record.
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
    this.startedWithFallback = false; // scope the one retry to this attempt
    await this.ensureStarted();
    this.pendingPeerId = dappPeerId;
    this.pushSession('connecting', null);

    try {
      await this.connectWithTimeout(dappPeerId);
    } catch (primaryError) {
      // Retry only on the connect timeout (signaling failure); a rejection propagates.
      const isTimeout = primaryError instanceof Error && primaryError.message === 'timeout';
      if (!isTimeout || this.startedWithFallback) throw primaryError;
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

  // Track our own reference to the standing onConnect so connectWithTimeout can
  // wrap-and-chain it without reading the peer instance's internal field.
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
