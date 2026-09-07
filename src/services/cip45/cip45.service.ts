import { Mutex } from 'async-mutex';
import { watch } from 'vue';
import { CardanoPeerConnect } from '@fabianbormann/cardano-peer-connect';
import type { PeerConnectStorage, IConnectMessage } from '@fabianbormann/cardano-peer-connect';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { walletStore } from '@/stores/walletStore';
import { parseCip45Input } from './qr';
import type { Cip45Pairing, Cip45Session, Cip45WalletContext, Cip45Authorization } from './types';
import { CIP45_REVOKED, walletContext, sameWallet } from './authorization';

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
  private publishOriginalApi: () => void;
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
    this.publishOriginalApi = this.injectApi;
    this.injectApi = () => {};
  }

  // Discovery can only start a fresh attempt for a pairing belonging to this wallet.
  public override connect(identifier: string): string {
    this.service.reconnect(this, identifier);
    return identifier;
  }

  public openConnection(identifier: string): void { super.connect(identifier); }

  // The SDK injects the API before onConnect. Publish only after the background
  // accepts the wallet-bound session, otherwise the dApp can race activation.
  public publishApi(): void { this.publishOriginalApi(); }

  private invoke = async <T,>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const session = this.service.authorizedSession(this);
    const response = (await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.CIP45_INVOKE,
      data: { method, params, authorization: session.authorization,
        dapp: { name: session.dappName, url: session.dappUrl } },
    })) as { data?: { success: boolean; result?: T; error?: unknown } };
    // Do not deliver a response from a connection revoked while the RPC was running.
    this.service.authorizedSession(this);
    if (!response?.data?.success) {
      throw response?.data?.error ?? { code: -2, info: 'CIP-45 invoke failed' };
    }
    return response.data.result as T;
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

interface PairingAttempt {
  context: Cip45WalletContext;
  peerId: string;
  generation: number;
  authorization?: Cip45Authorization;
  cancel?: () => void;
  revoke?: () => void;
}

class Cip45Service {
  private wallet: GeroPeerConnect | null = null;
  private owner: Cip45WalletContext | null = null;
  private session: Cip45Session | null = null;
  private attempt: PairingAttempt | null = null;
  private generation = 0;
  private pairingsCache: Cip45Pairing[] = [];
  private storageMutex = new Mutex();
  private initMutex = new Mutex();

  constructor() {
    watch(() => [walletStore.loggedWallet?.id, walletStore.loggedWallet?.chain,
      walletStore.loggedWallet?.network, walletStore.isLocked], () => {
      const current = walletContext(walletStore.loggedWallet);
      // UI hydration may briefly clear the wallet during signing. Calls fail
      // closed during that interval; background logout/lock independently revokes.
      if (walletStore.isLocked || (current && this.owner && !sameWallet(current, this.owner))) {
        this.invalidate();
      }
    }, { flush: 'sync' });
    window.addEventListener('beforeunload', () => this.invalidate());
  }

  private currentContext(): Cip45WalletContext {
    const context = walletContext(walletStore.loggedWallet);
    if (!context || walletStore.isLocked) throw new Error(CIP45_REVOKED);
    return context;
  }

  private assertAttempt(attempt: PairingAttempt): void {
    if (this.attempt !== attempt || attempt.generation !== this.generation
      || !sameWallet(attempt.context, this.currentContext())) throw new Error(CIP45_REVOKED);
  }

  authorizedSession(peer: GeroPeerConnect): Cip45Session {
    if (peer !== this.wallet || !this.session
      || !sameWallet(this.session.authorization, this.currentContext())) throw new Error(CIP45_REVOKED);
    return this.session;
  }

  isSessionPeerAllowed(): boolean {
    try { return !!this.wallet && !!this.authorizedSession(this.wallet); } catch { return false; }
  }

  isAllowedPeerSync(peerId: string): boolean {
    const context = walletContext(walletStore.loggedWallet);
    return !!context && !walletStore.isLocked && this.pairingsCache.some(p =>
      p.walletId === context.walletId && p.dappPeerId === peerId);
  }

  async isAllowedPeer(peerId: string): Promise<boolean> {
    await this.loadPairings();
    return this.isAllowedPeerSync(peerId);
  }

  async getPairings(): Promise<Cip45Pairing[]> {
    await this.loadPairings();
    const context = walletContext(walletStore.loggedWallet);
    return this.pairingsCache.filter(p => p.walletId === context?.walletId);
  }

  private async loadPairings(): Promise<void> {
    await this.storageMutex.runExclusive(async () => {
      const stored = await chrome.storage.local.get(PAIRINGS_KEY);
      this.pairingsCache = (stored?.[PAIRINGS_KEY] as Cip45Pairing[]) ?? [];
    });
  }

  private endGrant(authorization?: Cip45Authorization): void {
    if (authorization) void Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.CIP45_END_SESSION, data: { authorization },
    }).catch(() => {});
  }

  private invalidate(): void {
    // Revoke before any asynchronous work. Destroy does not wait for a remote ACK.
    this.generation++;
    const attempt = this.attempt;
    this.attempt = null;
    this.endGrant(attempt?.authorization);
    this.endGrant(this.session?.authorization);
    this.session = null;
    const peer = this.wallet;
    this.wallet = null;
    this.owner = null;
    attempt?.revoke?.();
    attempt?.cancel?.();
    try { peer?.destroy(); } catch { /* already closed */ }
  }

  private async beginGrant(attempt: PairingAttempt): Promise<void> {
    this.assertAttempt(attempt);
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.CIP45_BEGIN_SESSION,
      data: { context: attempt.context, dappPeerId: attempt.peerId },
    }) as { data?: { success: boolean; authorization?: Cip45Authorization; error?: string } };
    const authorization = response?.data?.authorization;
    try {
      this.assertAttempt(attempt);
      if (!response?.data?.success || !authorization) throw new Error(response?.data?.error || CIP45_REVOKED);
      attempt.authorization = authorization;
    } catch (error) {
      this.endGrant(authorization);
      throw error;
    }
  }

  private async ensureStarted(context: Cip45WalletContext, generation: number,
    config: Record<string, unknown> = PRIMARY_PEERJS_CONFIG): Promise<GeroPeerConnect> {
    return this.initMutex.runExclusive(async () => {
      const assertCurrent = () => {
        if (generation !== this.generation || !sameWallet(context, this.currentContext())) throw new Error(CIP45_REVOKED);
      };
      assertCurrent();
      if (this.wallet) return this.wallet;
      const stored = await chrome.storage.local.get([PEER_ID_KEY, LIB_STORAGE_KEY]);
      assertCurrent();
      let peerId = stored?.[PEER_ID_KEY] as string | undefined;
      if (!peerId) {
        peerId = `gero-${crypto.randomUUID()}`;
        await chrome.storage.local.set({ [PEER_ID_KEY]: peerId });
        assertCurrent();
      }
      const cache = (stored?.[LIB_STORAGE_KEY] as Record<string, string>) ?? {};
      const persist = () => { void chrome.storage.local.set({ [LIB_STORAGE_KEY]: cache }); };
      const storage: PeerConnectStorage = {
        get: key => cache[key] ?? null,
        set: (key, value) => { cache[key] = value; persist(); },
        remove: key => { delete cache[key]; persist(); },
      };
      const peer = new GeroPeerConnect(this, peerId, storage, config);
      this.wallet = peer;
      this.owner = context;
      const closed = () => { if (this.wallet === peer) this.invalidate(); };
      peer.setOnDisconnect(closed);
      peer.setOnServerShutdown(closed);
      return peer;
    });
  }

  reconnect(peer: GeroPeerConnect, peerId: string): void {
    if (peer !== this.wallet || this.attempt || this.session || !this.isAllowedPeerSync(peerId)) return;
    void this.pair(peerId).catch(() => {});
  }

  async pair(input: string): Promise<void> {
    const { dappPeerId } = parseCip45Input(input);
    const context = this.currentContext(); // Capture ownership before the first await.
    if (this.attempt) throw new Error('A CIP-45 pairing is already in progress');
    this.invalidate();
    const attempt: PairingAttempt = { context, peerId: dappPeerId, generation: this.generation };
    this.owner = context;
    this.attempt = attempt;
    const cancelled = new Promise<never>((_, reject) => {
      attempt.revoke = () => reject(new Error(CIP45_REVOKED));
    });
    try {
      for (const config of [PRIMARY_PEERJS_CONFIG, FALLBACK_PEERJS_CONFIG]) {
        await Promise.race([this.beginGrant(attempt), cancelled]);
        const peer = await Promise.race([this.ensureStarted(context, attempt.generation, config), cancelled]);
        this.assertAttempt(attempt);
        try {
          await this.connectWithTimeout(attempt, peer);
          return;
        } catch (error) {
          this.assertAttempt(attempt);
          if (!(error instanceof Error) || error.message !== 'timeout' || config === FALLBACK_PEERJS_CONFIG) throw error;
          // Detach the old transport before destroying it; late callbacks cannot
          // cancel or authorize the replacement transport using the same attempt.
          this.wallet = null;
          peer.destroy();
          this.endGrant(attempt.authorization);
          attempt.authorization = undefined;
        }
      }
    } catch (error) {
      if (this.attempt === attempt) this.invalidate();
      throw error;
    } finally {
      if (this.attempt === attempt) this.attempt = null;
    }
  }

  private connectWithTimeout(attempt: PairingAttempt, peer: GeroPeerConnect): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let completing = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        attempt.cancel = undefined;
        peer.setOnConnect(() => {});
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => finish(new Error('timeout')), CONNECT_TIMEOUT_MS);
      attempt.cancel = () => finish(new Error(CIP45_REVOKED));
      peer.setOnConnect((message: IConnectMessage) => {
        if (settled || completing || peer !== this.wallet) return;
        completing = true;
        void (async () => {
          this.assertAttempt(attempt);
          if (!message.connected) throw new Error(message.errorMessage || 'rejected');
          if (message.dApp.address !== attempt.peerId) throw new Error('Unexpected CIP-45 peer');
          const session: Cip45Session = {
            authorization: attempt.authorization!, dappPeerId: attempt.peerId,
            dappName: message.dApp.name, dappUrl: message.dApp.url,
            identicon: peer.getIdenticon() ?? null, connectedAt: Date.now(),
          };
          const response = await Messaging.sendToBackgroundFromOptions({
            method: MessageTypes.CIP45_UPDATE_SESSION, data: { status: 'connected', session },
          }) as { data?: { success: boolean } };
          this.assertAttempt(attempt);
          if (settled || peer !== this.wallet || !response?.data?.success) throw new Error(CIP45_REVOKED);
          await this.storageMutex.runExclusive(async () => {
            this.assertAttempt(attempt);
            if (settled || peer !== this.wallet) throw new Error(CIP45_REVOKED);
            const stored = await chrome.storage.local.get(PAIRINGS_KEY);
            this.assertAttempt(attempt);
            if (settled || peer !== this.wallet) throw new Error(CIP45_REVOKED);
            const rows = (stored?.[PAIRINGS_KEY] as Cip45Pairing[]) ?? [];
            if (!rows.some(p => p.walletId === attempt.context.walletId && p.dappPeerId === attempt.peerId)) {
              rows.push({ dappPeerId: attempt.peerId, dappName: session.dappName,
                dappUrl: session.dappUrl, walletId: attempt.context.walletId, pairedAt: Date.now() });
              await chrome.storage.local.set({ [PAIRINGS_KEY]: rows });
            }
            this.pairingsCache = rows;
          });
          this.assertAttempt(attempt);
          if (settled || peer !== this.wallet) throw new Error(CIP45_REVOKED);
          this.session = session;
          peer.publishApi();
          finish();
        })().catch(error => finish(error instanceof Error ? error : new Error(CIP45_REVOKED)));
      });
      try { peer.openConnection(attempt.peerId); } catch (error) {
        finish(error instanceof Error ? error : new Error(CIP45_REVOKED));
      }
    });
  }

  async disconnect(): Promise<void> { this.invalidate(); }

  async removePairing(dappPeerId: string): Promise<void> {
    const context = this.currentContext();
    if (this.session?.dappPeerId === dappPeerId || this.attempt?.peerId === dappPeerId) this.invalidate();
    await this.storageMutex.runExclusive(async () => {
      const stored = await chrome.storage.local.get(PAIRINGS_KEY);
      this.pairingsCache = ((stored?.[PAIRINGS_KEY] as Cip45Pairing[]) ?? []).filter(p =>
        !(p.dappPeerId === dappPeerId && p.walletId === context.walletId));
      await chrome.storage.local.set({ [PAIRINGS_KEY]: this.pairingsCache });
    });
  }

  async resumeIfPaired(): Promise<void> {
    const context = this.currentContext();
    const generation = this.generation;
    this.owner = context;
    await this.loadPairings();
    if (generation !== this.generation || !sameWallet(context, this.currentContext())) return;
    if (this.pairingsCache.some(p => p.walletId === context.walletId)) {
      await this.ensureStarted(context, generation);
    }
  }
}

export const cip45Service = new Cip45Service();
export default cip45Service;
