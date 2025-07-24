import * as Ably from 'ably';
// @ts-ignore - No types available for tiny-fifo-cache
import FIFOCache from 'tiny-fifo-cache';
import LoadingState from '@/stores/loading';
import { Api } from '@/api/api';

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
    console.debug('🏗️ Creating new Ably client instance');
    this.client = new Ably.Realtime({
      autoConnect: false,
      closeOnUnload: false,
      queueMessages: false,
      authCallback: (tokenParams, callback) => {
        console.debug('🔐 ================== AUTH CALLBACK TRIGGERED ==================');
        console.debug('🔐 Ably auth callback called with params:', tokenParams);
        console.debug('🔐 Auth params at callback time:', this.authParams);
        console.debug('🔐 API instance at callback time:', !!this.api);

        if (!this.authParams) {
          console.error('❌ No auth params set');
          return callback('Ably: not yet authenticated', null);
        }

        console.debug('🔐 Fetching token with auth params:', this.authParams);

        if (!this.api) {
          console.error('❌ API instance not set');
          return callback('API instance not initialized', null);
        }

        console.debug('🌐 Making API call to /api/ably/token endpoint...');
        this.api.ablyToken(this.authParams.address)
          .then(res => {
            console.debug('✅ Token received successfully', res.data);
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

    // Listen for all connection state changes
    this.client.connection.on((connectionStateChange: Ably.ConnectionStateChange) => {
      console.debug('🔄 Connection state changed:', {
        previous: connectionStateChange.previous,
        current: connectionStateChange.current,
        reason: connectionStateChange.reason,
        retryIn: connectionStateChange.retryIn
      });
    });
  }

  public connect(): void {
    console.debug('🔄 Attempting to connect to Ably...');
    console.debug('🔍 Auth params at connect time:', this.authParams);
    console.debug('🔍 API instance at connect time:', !!this.api);
    console.debug('🔍 Current connection state:', this.client.connection.state);
    this.client.connect();
  }

  public close(): void {
    try {
      console.debug('🔄 Closing Ably connection...');
      // Clear all subscribed channels first
      this.unsubscribeAll();
      // Close the connection
      this.client.connection?.close();
      this.client.close();
      // Reset auth params to force re-authentication on next connect
      this.authParams = null;
      this.api = null;
    } catch (e) {
      console.debug(e);
    }
  }

  public setAuthParams(chain: string, network: string, address: string): void {
    // If switching to a different address, recreate the client to avoid clientId mismatch
    if (this.authParams && this.authParams.address !== address) {
      console.debug('🔄 Address changed, recreating Ably client to avoid clientId mismatch');
      this.close();
      this.recreateClient();
    }
    this.authParams = { chain, network, address };
  }

  private recreateClient(): void {
    console.debug('🏗️ Recreating Ably client instance');
    this.client = new Ably.Realtime({
      autoConnect: false,
      closeOnUnload: false,
      queueMessages: false,
      authCallback: (tokenParams, callback) => {
        console.debug('🔐 ================== AUTH CALLBACK TRIGGERED ==================');
        console.debug('🔐 Ably auth callback called with params:', tokenParams);
        console.debug('🔐 Auth params at callback time:', this.authParams);
        console.debug('🔐 API instance at callback time:', !!this.api);

        if (!this.authParams) {
          console.error('❌ No auth params set');
          return callback('Ably: not yet authenticated', null);
        }

        console.debug('🔐 Fetching token with auth params:', this.authParams);

        if (!this.api) {
          console.error('❌ API instance not set');
          return callback('API instance not initialized', null);
        }

        console.debug('🌐 Making API call to /api/ably/token endpoint...');
        this.api.ablyToken(this.authParams.address)
          .then(res => {
            console.debug('✅ Token received successfully', res.data);
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

  public subscribeToPrivateChannel(
    address: string,
    handlers: {
      onSync?: AblyMessageHandler;
      onMessage?: AblyMessageHandler;
    }
  ): Promise<void> {
    return new Promise((resolve) => {
      const privateChan = address;
      console.debug('🔐 Attempting to subscribe to private channel:', privateChan);
      console.debug('🔐 Connection state before subscription:', this.client.connection.state);

      if (!this.subscribedChannels.has(privateChan)) {
        console.debug('🔐 Getting channel for private subscription...');
        const channel: Ably.RealtimeChannel = this.client.channels.get(privateChan);
        console.debug('🔐 Channel obtained, setting up subscription...');

        // Subscribe to messages (like group channel does)
        channel.subscribe(async (msg: Ably.InboundMessage) => {
          console.debug(`📨 RAW message received on private channel ${privateChan}:`, {
            name: msg.name,
            data: msg.data,
            timestamp: msg.timestamp,
            clientId: msg.clientId,
            connectionId: msg.connectionId
          });

          // Handle specific message types
          switch (msg.name) {
            case 'SYNC':
              console.debug('🔄 Processing SYNC message');
              if (handlers.onSync) {
                await handlers.onSync(msg);
              }
              break;
            default:
              console.debug(`📬 Received message type: ${msg.name}`, msg.data);
              if (handlers.onMessage) {
                await handlers.onMessage(msg);
              }
          }
        }).catch(subscribeError => {
          console.warn(`Failed to subscribe to private channel ${privateChan}:`, subscribeError);
        });

        // Add channel state listeners for debugging
        channel.on('attached', () => {
          console.debug(`✅ Private channel ${privateChan} attached successfully`);
        });

        channel.on('detached', () => {
          console.debug(`❌ Private channel ${privateChan} detached`);
        });

        channel.on('failed', (error) => {
          console.warn(`⚠️ Private channel ${privateChan} access denied - continuing without realtime updates:`, error);
          // Don't throw or reject - just continue without this channel
        });

        this.subscribedChannels.set(privateChan, channel);
        console.debug(`📝 Subscribed to private channel: ${privateChan}`);
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
              console.debug('🔄 Processing TIP message');
              if (handlers.onTip) {
                handlers.onTip(msg);
              }
              break;
            default:
              console.debug('▶ Group: ' + msg.name, msg.data);
              if (handlers.onMessage) {
                await handlers.onMessage(msg);
              }
          }
        }).catch(subscribeError => {
          console.warn(`Failed to subscribe to group channel ${groupChan}:`, subscribeError);
        });

        // Add error handling for group channel
        channel.on('failed', (error) => {
          console.warn(`⚠️ Group channel ${groupChan} access denied - continuing without realtime updates:`, error);
          // Don't throw or reject - just continue without this channel
        });

        channel.on('detached', () => {
          console.debug(`❌ Group channel ${groupChan} detached`);
        });

        this.subscribedChannels.set(groupChan, channel);
        console.debug('Subscribed to group channel: ', groupChan);
      }
      resolve();
    });
  }

  public async publishToSyncChannel(chain: string, network: string, data: any): Promise<void> {
    const syncChannel: string = `${chain.toUpperCase()}.${network.toUpperCase()}.SYNC`;
    console.debug('Syncing...');
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
