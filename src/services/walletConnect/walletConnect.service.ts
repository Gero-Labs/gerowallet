import { Mutex } from 'async-mutex';
import { ChromeStorageAdapter } from './chromeStorageAdapter';
import {
  isCardanoChain, isBitcoinChain,
  CARDANO_METHODS, CARDANO_EVENTS,
  BITCOIN_METHODS, BITCOIN_EVENTS,
  resolveCAIP2Chain, buildCAIP10Account,
} from './chainUtils';
import type { WCSession } from './types';

const METADATA = {
  name: 'Gero Wallet',
  description: 'A Multi-chain Light Wallet Merging Web2 and Web3',
  url: 'https://gerowallet.io',
  icons: ['https://gerowallet.io/images/logo.svg'],
};

class WalletConnectService {
  private walletKit: any = null;
  private initMutex = new Mutex();
  private _initialized = false;

  // Callbacks set by background.ts to handle events
  public onSessionProposal: ((proposal: any) => void) | null = null;
  public onSessionRequest: ((request: any) => void) | null = null;
  public onSessionDelete: ((event: { id: number; topic: string }) => void) | null = null;

  get initialized(): boolean {
    return this._initialized;
  }

  async initialize(): Promise<void> {
    // Prevent double initialization
    if (this._initialized && this.walletKit) return;

    await this.initMutex.runExclusive(async () => {
      if (this._initialized && this.walletKit) return;

      try {
        const projectId = (import.meta as any).env?.VITE_WALLETCONNECT_PROJECT_ID;
        if (!projectId) {
          console.warn('⚠️ WalletConnect: No project ID configured');
          return;
        }

        console.log('🔗 WalletConnect: Initializing...');

        // Dynamic import to lazy-load the SDK (~200-400KB)
        const { WalletKit } = await import('@reown/walletkit');
        const { Core } = await import('@walletconnect/core');

        const core = new Core({
          projectId,
          storage: new ChromeStorageAdapter(),
        });

        this.walletKit = await WalletKit.init({
          core,
          metadata: METADATA,
        });

        this.registerEventHandlers();
        this._initialized = true;

        const sessions = this.walletKit.getActiveSessions();
        const count = Object.keys(sessions).length;
        console.log(`✅ WalletConnect: Initialized (${count} active session${count !== 1 ? 's' : ''})`);
      } catch (error) {
        console.error('❌ WalletConnect: Initialization failed:', error);
        this.walletKit = null;
        this._initialized = false;
      }
    });
  }

  private registerEventHandlers(): void {
    if (!this.walletKit) return;

    this.walletKit.on('session_proposal', (proposal) => {
      console.log('🔗 WalletConnect: Session proposal received:', proposal.params.proposer.metadata.name);
      this.onSessionProposal?.(proposal);
    });

    this.walletKit.on('session_request', (request) => {
      console.log('🔗 WalletConnect: Session request:', request.params.request.method);
      this.onSessionRequest?.(request);
    });

    this.walletKit.on('session_delete', (event) => {
      console.log('🔗 WalletConnect: Session deleted:', event.topic);
      this.onSessionDelete?.(event);
    });

    this.walletKit.on('proposal_expire', (event) => {
      console.log('🔗 WalletConnect: Proposal expired:', event.id);
    });

    this.walletKit.on('session_request_expire', (event) => {
      console.log('🔗 WalletConnect: Request expired:', event.id);
    });
  }

  // ---- Pairing ----

  async pair(uri: string): Promise<void> {
    if (!this.walletKit) throw new Error('WalletConnect not initialized');
    await this.walletKit.pair({ uri });
  }

  // ---- Session Management ----

  async approveSession(
    id: number,
    accounts: { cardano?: string[]; bitcoin?: string[] },
    chain: string,
    network: string,
  ): Promise<any> {
    if (!this.walletKit) throw new Error('WalletConnect not initialized');

    const caip2 = resolveCAIP2Chain(chain, network);
    if (!caip2) throw new Error(`Unsupported chain: ${chain} ${network}`);

    const namespaces: Record<string, any> = {};

    if (accounts.cardano?.length && isCardanoChain(caip2)) {
      const namespace = caip2.split(':')[0]; // 'cip34'
      namespaces[namespace] = {
        chains: [caip2],
        methods: CARDANO_METHODS,
        events: CARDANO_EVENTS,
        accounts: accounts.cardano.map(addr => buildCAIP10Account(caip2, addr)),
      };
    }

    if (accounts.bitcoin?.length && isBitcoinChain(caip2)) {
      const namespace = caip2.split(':')[0]; // 'bip122'
      namespaces[namespace] = {
        chains: [caip2],
        methods: BITCOIN_METHODS,
        events: BITCOIN_EVENTS,
        accounts: accounts.bitcoin.map(addr => buildCAIP10Account(caip2, addr)),
      };
    }

    if (Object.keys(namespaces).length === 0) {
      throw new Error('No valid accounts for the requested chains');
    }

    const session = await this.walletKit.approveSession({ id, namespaces });
    console.log('✅ WalletConnect: Session approved:', session.topic);
    return session;
  }

  async rejectSession(id: number, reason?: string): Promise<void> {
    if (!this.walletKit) throw new Error('WalletConnect not initialized');
    await this.walletKit.rejectSession({
      id,
      reason: {
        code: 4001,
        message: reason || 'User rejected the session',
      },
    });
    console.log('🔗 WalletConnect: Session rejected');
  }

  async disconnectSession(topic: string): Promise<void> {
    if (!this.walletKit) throw new Error('WalletConnect not initialized');
    await this.walletKit.disconnectSession({
      topic,
      reason: { code: 6000, message: 'User disconnected' },
    });
    console.log('🔗 WalletConnect: Session disconnected:', topic);
  }

  async disconnectAllSessions(): Promise<void> {
    if (!this.walletKit) return;
    const sessions = this.walletKit.getActiveSessions();
    for (const topic of Object.keys(sessions)) {
      try {
        await this.disconnectSession(topic);
      } catch (e) {
        console.warn('⚠️ WalletConnect: Failed to disconnect session:', topic, e);
      }
    }
  }

  // ---- Session Request Response ----

  async respondSuccess(topic: string, id: number, result: any): Promise<void> {
    if (!this.walletKit) throw new Error('WalletConnect not initialized');
    await this.walletKit.respondSessionRequest({
      topic,
      response: { id, result, jsonrpc: '2.0' },
    });
  }

  async respondError(topic: string, id: number, code: number, message: string): Promise<void> {
    if (!this.walletKit) throw new Error('WalletConnect not initialized');
    await this.walletKit.respondSessionRequest({
      topic,
      response: {
        id,
        error: { code, message },
        jsonrpc: '2.0',
      },
    });
  }

  // ---- Query ----

  getActiveSessions(): WCSession[] {
    if (!this.walletKit) return [];
    const sessions = this.walletKit.getActiveSessions();
    return Object.values(sessions).map((s: any) => ({
      topic: s.topic,
      peerMeta: s.peer?.metadata || { name: 'Unknown', url: '', icons: [], description: '' },
      chains: Object.values(s.namespaces || {}).flatMap((ns: any) => ns.chains || []),
      methods: Object.values(s.namespaces || {}).flatMap((ns: any) => ns.methods || []),
      events: Object.values(s.namespaces || {}).flatMap((ns: any) => ns.events || []),
      expiry: s.expiry || 0,
      connectedAt: s.expiry ? (s.expiry - 604800) * 1000 : Date.now(), // 7-day sessions
    }));
  }

  getSessionForTopic(topic: string): any | null {
    if (!this.walletKit) return null;
    const sessions = this.walletKit.getActiveSessions();
    return sessions[topic] || null;
  }

  // ---- Ping (keepalive) ----

  async pingAll(): Promise<void> {
    if (!this.walletKit) return;
    try {
      await this.walletKit.core.relayer.transportOpen();
    } catch {
      // Relay reconnection is automatic
    }
  }

  // ---- Cleanup ----

  destroy(): void {
    this.walletKit = null;
    this._initialized = false;
  }
}

// Singleton
export const walletConnectService = new WalletConnectService();
export default walletConnectService;
