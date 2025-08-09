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
    this.createClient();
    this.setupConnectionListeners();
  }

  private createClient(): void {
    const clientOptions: Ably.ClientOptions = {
      autoConnect: false,
      closeOnUnload: false,
      queueMessages: false,
      authCallback: this.handleAuthCallback.bind(this)
    };

    this.client = new Ably.Realtime(clientOptions);

    // Also set the authCallback directly on the auth object after creation
    if (this.client.auth) {
      this.client.auth.authOptions = {
        authCallback: this.handleAuthCallback.bind(this)
      };
    }
  }

  private handleAuthCallback(tokenParams: Ably.TokenParams, callback: Ably.StandardCallback<Ably.TokenDetails | string>): void {
    if (!this.authParams) {
      console.error('❌ Ably auth params not set');
      return callback('Ably: not yet authenticated', null);
    }

    // Check for clientId mismatch - ignore the clientId from tokenParams and use our own
    if (tokenParams.clientId && tokenParams.clientId !== this.authParams.address) {
      console.warn('⚠️ ClientId mismatch detected:', {
        received: tokenParams.clientId,
        expected: this.authParams.address
      });
    }

    if (!this.api) {
      console.error('❌ Ably API instance not set');
      return callback('API instance not initialized', null);
    }

    this.api.ablyToken(this.authParams.address)
      .then(res => {
        const tokenData = typeof res.data === 'string' ? res.data : res.data.token;
        callback(null, tokenData);
      })
      .catch(err => {
        console.error('❌ Ably token fetch failed:', err.message || err);
        callback(err.message || 'Token fetch failed', null);
      });
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
    // Clear any existing token details to force fresh authentication via authCallback
    if (this.client.auth?.tokenDetails) {
      this.client.auth.tokenDetails = null;
    }

    // Clear auth method to force using authCallback
    if (this.client.auth) {
      this.client.auth.method = null;

      // Clear any cached clientId to prevent mismatch
      if (this.client.auth.clientId) {
        this.client.auth.clientId = null;
      }
    }

    // Clear clientId from options as well
    if (this.client.options?.clientId) {
      this.client.options.clientId = null;
    }

    this.client.connect();
  }

  public close(): void {
    try {
      this.unsubscribeAll();
      this.client.connection?.close();
      this.client.close();
      this.api = null;
    } catch (e) {
      console.warn('Error closing Ably connection:', e);
    }
  }

  public setAuthParams(chain: string, network: string, address: string): void {
    this.authParams = { chain, network, address };
    // Always recreate the client when setting auth params to ensure completely fresh state
    this.close();
    this.recreateClient();
  }

  private recreateClient(): void {
    this.createClient();
    this.setupConnectionListeners();
  }

  private waitForConnectionReady(timeoutMs: number = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const currentState = this.client.connection.state;
      console.debug(`🔍 Current connection state: ${currentState}`);
      console.debug('🔍 Auth configuration check:', {
        hasAuth: !!this.client.auth,
        hasAuthOptions: !!this.client.auth?.authOptions,
        hasAuthCallback: typeof this.client.auth?.authOptions?.authCallback === 'function',
        authKeys: this.client.auth?.authOptions ? Object.keys(this.client.auth.authOptions) : []
      });

      if (currentState === 'connected') {
        console.debug('✅ Connection already ready');
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        console.warn(`⏰ Connection timeout after ${timeoutMs}ms, current state: ${this.client.connection.state}`);
        console.warn('🔍 Final auth state check:', {
          hasAuth: !!this.client.auth,
          hasAuthOptions: !!this.client.auth?.authOptions,
          hasAuthCallback: typeof this.client.auth?.authOptions?.authCallback === 'function',
          tokenDetails: !!this.client.auth?.tokenDetails
        });
        reject(new Error(`Connection timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const onConnected = () => {
        console.debug('✅ Connection ready!');
        clearTimeout(timeout);
        this.client.connection.off('connected', onConnected);
        this.client.connection.off('failed', onFailed);
        resolve();
      };

      const onFailed = (error: any) => {
        console.error('❌ Connection failed:', error);
        console.error('🔍 Auth state at failure:', {
          hasAuth: !!this.client.auth,
          hasAuthOptions: !!this.client.auth?.authOptions,
          hasAuthCallback: typeof this.client.auth?.authOptions?.authCallback === 'function',
          tokenDetails: !!this.client.auth?.tokenDetails,
          errorMessage: error.message || error.reason || error
        });
        clearTimeout(timeout);
        this.client.connection.off('connected', onConnected);
        this.client.connection.off('failed', onFailed);
        reject(new Error(`Connection failed: ${error.reason || error.message || error}`));
      };

      this.client.connection.on('connected', onConnected);
      this.client.connection.on('failed', onFailed);
    });
  }

  private waitForChannelReady(channel: Ably.RealtimeChannel, timeoutMs: number = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const currentState = channel.state;
      console.debug(`🔍 Current channel state: ${currentState}`);

      if (currentState === 'attached') {
        console.debug('✅ Channel already ready');
        resolve();
        return;
      }

      // If channel is already in failed state, don't wait - reject immediately
      if (currentState === 'failed') {
        console.warn('❌ Channel is already in failed state, skipping subscription');
        reject(new Error('Channel is in failed state'));
        return;
      }

      // If channel is in initialized state, force attachment
      if (currentState === 'initialized') {
        console.debug('🔄 Channel in initialized state, forcing attachment...');
        try {
          channel.attach();
        } catch (attachError) {
          console.warn('⚠️ Failed to force channel attachment:', attachError);
        }
      }

      const timeout = setTimeout(() => {
        const finalState = channel.state;
        console.warn(`⏰ Channel timeout after ${timeoutMs}ms, current state: ${finalState}`);

        // If channel ended up in failed state during timeout, reject
        if (finalState === 'failed') {
          reject(new Error(`Channel failed during timeout, final state: ${finalState}`));
        } else {
          // For other states, resolve to continue
          resolve();
        }
      }, timeoutMs);

      const onAttached = () => {
        console.debug('✅ Channel ready!');
        clearTimeout(timeout);
        channel.off('attached', onAttached);
        channel.off('failed', onFailed);
        resolve();
      };

      const onFailed = (error: any) => {
        console.warn('❌ Channel failed during wait, stopping subscription:', error);
        clearTimeout(timeout);
        channel.off('attached', onAttached);
        channel.off('failed', onFailed);
        // Reject to prevent subscription attempts on failed channels
        reject(new Error(`Channel failed: ${error.reason || error.message || error}`));
      };

      channel.on('attached', onAttached);
      channel.on('failed', onFailed);
    });
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
        // Wait for connection to be ready before subscribing
        this.waitForConnectionReady().then(() => {
          console.debug('🔐 Getting channel for private subscription...');
          const channel: Ably.RealtimeChannel = this.client.channels.get(privateChan);
          console.debug('🔐 Channel obtained, setting up subscription...');

          // Wait for channel to be ready before subscribing
          this.waitForChannelReady(channel).then(() => {
            console.debug(`🔐 Private channel ${privateChan} is ready, subscribing...`);

            // Subscribe to messages
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
                  console.debug('SYNC::🔄 Processing SYNC message');
                  if (handlers.onSync) {
                    await handlers.onSync(msg);
                  }
                  break;
                default:
                  console.debug(`SYNC::📬 Received message type: ${msg.name}`, msg.data);
                  if (handlers.onMessage) {
                    await handlers.onMessage(msg);
                  }
              }
            }).then(() => {
              console.debug(`SYNC::✅ Successfully subscribed to private channel: ${privateChan}`);
              this.subscribedChannels.set(privateChan, channel);
              resolve();
            }).catch(subscribeError => {
              console.warn(`SYNC::Failed to subscribe to private channel ${privateChan}:`, subscribeError);
              resolve(); // Don't reject, just continue without this channel
            });

            // Add channel state listeners for debugging
            channel.on('attached', () => {
              console.debug(`SYNC::✅ Private channel ${privateChan} attached successfully`);
            });

            channel.on('detached', () => {
              console.debug(`SYNC::❌ Private channel ${privateChan} detached`);
            });

            channel.on('failed', (error) => {
              console.warn(`SYNC::⚠️ Private channel ${privateChan} access denied - continuing without realtime updates:`, error);
              // Don't throw or reject - just continue without this channel
            });

          }).catch(channelError => {
            console.warn(`SYNC::Private channel ${privateChan} failed to reach ready state:`, channelError);
            resolve(); // Don't reject, just continue without this channel
          });
        }).catch(connectionError => {
          console.warn(`SYNC::Private channel connection failed to reach ready state:`, connectionError);
          resolve(); // Don't reject, just continue without this channel
        });
      } else {
        resolve();
      }
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
    return new Promise((resolve, reject) => {
      const groupChan: string = `${chain}.${network}`;
      console.debug('🔐 Group channel subscription request:', {
        chain,
        network,
        groupChan,
        authParams: this.authParams
      });

      if (!this.subscribedChannels.has(groupChan)) {
        // Wait for connection to be ready before subscribing
        this.waitForConnectionReady().then(() => {
          const channel: Ably.RealtimeChannel = this.client.channels.get(groupChan);

          // Wait for channel to be ready before subscribing
          this.waitForChannelReady(channel).then(() => {
            console.debug(`📡 Channel ${groupChan} is ready, subscribing...`);

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
            }).then(() => {
              console.debug(`✅ Successfully subscribed to group channel: ${groupChan}`);
              this.subscribedChannels.set(groupChan, channel);
              resolve();
            }).catch(subscribeError => {
              console.warn(`Failed to subscribe to group channel ${groupChan}:`, subscribeError);
              resolve(); // Don't reject, just continue without this channel
            });

            // Add error handling for group channel
            channel.on('failed', (error) => {
              console.warn(`⚠️ Group channel ${groupChan} access denied - continuing without realtime updates:`, error);
              // Don't throw or reject - just continue without this channel
            });

            channel.on('detached', () => {
              console.debug(`❌ Group channel ${groupChan} detached`);
            });

          }).catch(channelError => {
            console.warn(`Channel ${groupChan} failed to reach ready state:`, channelError);
            resolve(); // Don't reject, just continue without this channel
          });
        }).catch(connectionError => {
          console.warn(`Connection failed to reach ready state:`, connectionError);
          resolve(); // Don't reject, just continue without this channel
        });
      } else {
        resolve();
      }
    });
  }

  public async publishToSyncChannel(chain: string, network: string, data: any): Promise<void> {
    const syncChannel: string = `${chain.toUpperCase()}.${network.toUpperCase()}.SYNC`;

    // Check if connection is active before attempting to publish
    const connectionState = this.client?.connection?.state;
    if (!this.client || !connectionState || connectionState === 'closed' || connectionState === 'failed') {
      console.warn(`SYNC::⚠️ Cannot publish to sync channel ${syncChannel}: connection state is ${connectionState}`);
      return;
    }

    if (connectionState !== 'connected') {
      console.warn(`SYNC::⚠️ Cannot publish to sync channel ${syncChannel}: connection not ready (state: ${connectionState})`);
      return;
    }

    try {
      console.debug(`SYNC::📡 Publishing to sync channel ${syncChannel}...`, data);
      await this.client.channels.get(syncChannel).publish('SYNC', JSON.stringify(data));
      console.debug(`SYNC::✅ Successfully published to sync channel ${syncChannel}`);
    } catch (error) {
      console.warn(`SYNC::⚠️ Failed to publish to sync channel ${syncChannel}:`, error);
      // Don't throw - just log the error to prevent breaking the sync process
    }
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
