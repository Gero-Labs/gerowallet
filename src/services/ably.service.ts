import * as Ably from 'ably';
import FIFOCache from 'tiny-fifo-cache';
import LoadingState from '@/stores/loading';
import { Api } from '@/api/api';

// @ts-ignore
const backendUrl: string = import.meta.env.VITE_BACKEND_URL;

const tips = new FIFOCache<string, boolean>(10);

interface AuthParams {
  chain: string;
  network: string;
  address: string;
}

interface AblyMessageHandler {
  (msg: Ably.InboundMessage): Promise<void>;
}

class AblyService {
  private client: Ably.Realtime;
  private subscribedChannels: Map<string, Ably.RealtimeChannel> = new Map();
  private authParams: AuthParams | null = null;
  private api: Api | null = null;

  constructor() {
    this.client = new Ably.Realtime({
      autoConnect: false,
      closeOnUnload: false,
      queueMessages: false,
      authCallback: (tokenParams, callback) => {
        console.log('🔐 Ably auth callback called with params:', tokenParams);

        if (!this.authParams) {
          console.error('❌ No auth params set');
          return callback('Ably: not yet authenticated', null);
        }

        console.log('🔐 Fetching token with auth params:', this.authParams);

        if (!this.api) {
          console.error('❌ API instance not set');
          return callback('API instance not initialized', null);
        }

        this.api.ablyToken(this.authParams.address)
          .then(res => {
            console.log('✅ Token received successfully', res.data);
            // Handle both string and object responses from backend
            const tokenData = typeof res.data === 'string' ? res.data : res.data.token;
            callback(null, tokenData);
          })
          .catch(err => {
            console.error('❌ Token fetch failed:', err);
            callback(err.message || 'Token fetch failed', null);
          });
      }
    });

    this.setupConnectionListeners();
  }

  public setApi(api: Api): void {
    this.api = api;
  }

  private setupConnectionListeners(): void {
    this.client.connection.on('connecting', () => {
      console.info('🔄 Ably connecting...');
    });

    this.client.connection.on('connected', (connectionStateChange: Ably.ConnectionStateChange) => {
      console.info('✅ Ably connected!', connectionStateChange);
      if (connectionStateChange.current === 'connected') {
        LoadingState.setText('');
        LoadingState.setConnected(true);
      }
    });

    this.client.connection.on('disconnected', (connectionStateChange: Ably.ConnectionStateChange) => {
      console.info('❌ Ably disconnected', connectionStateChange);
      LoadingState.setText('Wallet is Disconnected from the Network.<br>Reconnecting ...');
      LoadingState.setConnected(false);
    });

    this.client.connection.on('failed', (connectionStateChange: Ably.ConnectionStateChange) => {
      console.error('❌ Ably connection failed', connectionStateChange);
    });

    this.client.connection.on('suspended', (connectionStateChange: Ably.ConnectionStateChange) => {
      console.warn('⚠️ Ably connection suspended', connectionStateChange);
    });

    this.client.connection.on('closing', () => {
      console.info('🔄 Ably connection closing...');
    });

    this.client.connection.on('closed', () => {
      console.info('❌ Ably connection closed');
    });
  }

  public connect(): void {
    console.log('🔄 Attempting to connect to Ably...');
    this.client.connect();
  }

  public close(): void {
    try {
      this.client.connection?.close();
      this.client.close();
    } catch (e) {
      console.log(e);
    }
  }

  public setAuthParams(chain: string, network: string, address: string): void {
    this.authParams = { chain, network, address };
  }

  public subscribeToPrivateChannel(
    address: string,
    handlers: {
      onSync?: AblyMessageHandler;
      onMessage?: AblyMessageHandler;
    }
  ): Promise<void> {
    return new Promise((resolve) => {
      const privateChan = address;
      console.log('🔐 Attempting to subscribe to private channel:', privateChan);

      if (!this.subscribedChannels.has(privateChan)) {
        const channel: Ably.RealtimeChannel = this.client.channels.get(privateChan);

        // Subscribe to messages (like group channel does)
        channel.subscribe(async (msg: Ably.InboundMessage) => {
          console.log(`📨 RAW message received on private channel ${privateChan}:`, {
            name: msg.name,
            data: msg.data,
            timestamp: msg.timestamp,
            clientId: msg.clientId,
            connectionId: msg.connectionId
          });

          // Handle specific message types
          switch (msg.name) {
            case 'SYNC':
              console.log('🔄 Processing SYNC message');
              if (handlers.onSync) {
                await handlers.onSync(msg);
              }
              break;
            default:
              console.log(`📬 Received message type: ${msg.name}`, msg.data);
              if (handlers.onMessage) {
                await handlers.onMessage(msg);
              }
          }
        });

        // Add channel state listeners for debugging
        channel.on('attached', () => {
          console.log(`✅ Private channel ${privateChan} attached successfully`);
        });

        channel.on('detached', () => {
          console.log(`❌ Private channel ${privateChan} detached`);
        });

        channel.on('failed', (error) => {
          console.error(`❌ Private channel ${privateChan} failed:`, error);
        });

        this.subscribedChannels.set(privateChan, channel);
        console.log(`📝 Subscribed to private channel: ${privateChan}`);
      }

      // Resolve immediately like group channel does
      resolve();
    });
  }

  public subscribeToGroupChannel(
    chain: string,
    network: string,
    handlers: {
      onTip?: AblyMessageHandler;
      onMessage?: AblyMessageHandler;
    }
  ): Promise<void> {
    return new Promise((resolve) => {
      const groupChan: string = `${chain}.${network}`;
      if (!this.subscribedChannels.has(groupChan)) {
        const channel: Ably.RealtimeChannel = this.client.channels.get(groupChan);

        channel.subscribe(async (msg: Ably.InboundMessage) => {
          switch (msg.name) {
            case 'TIP':
              console.log('🔄 Processing TIP message');
              if (handlers.onTip) {
                handlers.onTip(msg);
              }
              break;
            default:
              console.log('▶ Group: ' + msg.name, msg.data);
              if (handlers.onMessage) {
                await handlers.onMessage(msg);
              }
          }
        });

        this.subscribedChannels.set(groupChan, channel);
        console.log('Subscribed to group channel: ', groupChan);
      }
      resolve();
    });
  }

  public async publishToSyncChannel(chain: string, network: string, data: any): Promise<void> {
    const syncChannel: string = `${chain.toUpperCase()}.${network.toUpperCase()}.SYNC`;
    console.log('Syncing...');
    await this.client.channels.get(syncChannel).publish('SYNC', JSON.stringify(data));
  }

  public unsubscribeAll(): void {
    this.subscribedChannels.forEach((channel: Ably.RealtimeChannel) => {
      channel.unsubscribe();
    });
    this.subscribedChannels.clear();
  }

  public isTipProcessed(hash: string): boolean {
    return tips.get(hash) || false;
  }

  public markTipAsProcessed(hash: string): void {
    tips.put(hash, true);
  }
}

// Export singleton instance
export const ablyService = new AblyService();
export default ablyService;
