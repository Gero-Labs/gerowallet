import * as Ably from 'ably';
import { debugLog } from '@/utils/debug';
// @ts-ignore - No types available for tiny-fifo-cache
import FIFOCache from 'tiny-fifo-cache';
import LoadingState from '@/stores/loading';
import { Api } from '@/api/api';
import messageReconstructionService from '@/services/messageReconstruction.service';

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
      authCallback: this.handleAuthCallback.bind(this),
      // Optimization: Faster connection parameters
      realtimeRequestTimeout: 5000, // Reduce from default 10s to 5s
      disconnectedRetryTimeout: 3000, // Faster reconnection attempts
      suspendedRetryTimeout: 5000, // Faster recovery from suspension
    };

    this.client = new Ably.Realtime(clientOptions);
  }

  private handleAuthCallback(tokenParams: Ably.TokenParams, callback: Ably.StandardCallback<Ably.TokenDetails | string>): void {
    if (!this.authParams) {
      console.error('❌ Ably auth params not set');
      const errorInfo: Ably.ErrorInfo = {
        message: 'Ably: not yet authenticated',
        code: 40140,
        statusCode: 401
      } as Ably.ErrorInfo;
      return callback(errorInfo, null);
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
      const errorInfo: Ably.ErrorInfo = {
        message: 'API instance not initialized',
        code: 40000,
        statusCode: 400
      } as Ably.ErrorInfo;
      return callback(errorInfo, null);
    }

    debugLog('🔑 Fetching fresh Ably token for address:', this.authParams.address);
    this.api.ablyToken(this.authParams.address)
      .then(res => {
        const tokenData = typeof res.data === 'string' ? res.data : res.data.token;

        // Log the raw token data for debugging
        console.log('🔍 Raw Ably token data:', {
          type: typeof tokenData,
          isString: typeof tokenData === 'string',
          length: typeof tokenData === 'string' ? tokenData.length : 'N/A',
          preview: typeof tokenData === 'string' ? tokenData.substring(0, 100) + '...' : tokenData
        });

        // Parse token to check expiration (if it's a JWT-style token)
        try {
          if (typeof tokenData === 'string') {
            // Try to parse as token request (JSON string)
            const parsed = JSON.parse(tokenData);
            console.log('🔍 Parsed Ably token:', parsed);
            if (parsed.timestamp) {
              const tokenAge = Date.now() - parsed.timestamp;
              console.log('✅ Fresh Ably token obtained, age:', tokenAge, 'ms');
              console.log('🔍 Token expiry check:', {
                timestamp: parsed.timestamp,
                ttl: parsed.ttl,
                expiresAt: parsed.timestamp + (parsed.ttl * 1000),
                now: Date.now(),
                isExpired: (parsed.timestamp + (parsed.ttl * 1000)) < Date.now()
              });
            }
          }
        } catch (e) {
          // Not JSON, probably a plain token string
          debugLog('✅ Fresh Ably token obtained (plain format)');
        }

        callback(null, tokenData);
      })
      .catch(err => {
        console.error('❌ Ably token fetch failed:', err.message || err);
        const errorInfo: Ably.ErrorInfo = {
          message: err.message || 'Token fetch failed',
          code: 40140,
          statusCode: 401
        } as Ably.ErrorInfo;
        callback(errorInfo, null);
      });
  }

  public setApi(api: Api): void {
    this.api = api;
  }

  private setupConnectionListeners(): void {
    this.client.connection.on('connecting', () => {
      LoadingState.setConnecting(true);
      debugLog('🔌 Ably connecting...');
    });

    this.client.connection.on('connected', (connectionStateChange: Ably.ConnectionStateChange) => {
      console.log('✅ Ably connected event fired, state:', connectionStateChange.current);
      LoadingState.setText('');
      LoadingState.setConnected(true);
      LoadingState.setConnecting(false);
      debugLog('✅ Ably connected');
    });

    this.client.connection.on('disconnected', (connectionStateChange: Ably.ConnectionStateChange) => {
      const reason = connectionStateChange.reason;

      // Check if disconnection is due to token expiration
      if (reason && (reason.message?.includes('token') || reason.code === 40142)) {
        console.warn('🔑 Ably token expired, will automatically renew on reconnection');
      } else {
        console.warn('❌ Ably disconnected:', reason);
      }

      LoadingState.setText('Wallet is Disconnected from the Network.<br>Reconnecting ...');
      LoadingState.setConnected(false);
      LoadingState.setConnecting(false);
    });

    this.client.connection.on('failed', (connectionStateChange: Ably.ConnectionStateChange) => {
      console.error('❌ Ably connection failed:', connectionStateChange.reason || connectionStateChange);
      LoadingState.setConnected(false);
      LoadingState.setConnecting(false);
    });

    this.client.connection.on('suspended', (connectionStateChange: Ably.ConnectionStateChange) => {
      console.warn('⚠️ Ably connection suspended:', connectionStateChange.reason);
      LoadingState.setConnecting(false);
    });
  }

  public connect(): void {
    // Force fresh authentication by recreating the client
    // This ensures clean auth state without accessing private properties
    this.client.connect();
  }

  public close(): void {
    try {
      this.unsubscribeAll();
      this.client.connection?.close();
      this.client.close();
      // DON'T clear api here - it will be set immediately after by setApi()
      // this.api = null;

      // Clear any pending message chunks
      messageReconstructionService.clearAll();
    } catch (e) {
      console.warn('Error closing Ably connection:', e);
    }
  }

  public setAuthParams(chain: string, network: string, address: string): void {
    debugLog('🔐 Setting auth params:', { chain, network, address });
    this.authParams = { chain, network, address };
    // ALWAYS recreate client when setting auth params for fresh state
    this.close();
    this.recreateClient();
  }

  private recreateClient(): void {
    this.createClient();
    this.setupConnectionListeners();
  }

  private waitForConnectionReady(timeoutMs: number = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const currentState = this.client.connection.state;

      if (currentState === 'connected') {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        console.warn(`⏰ Ably connection timeout after ${timeoutMs}ms, state: ${this.client.connection.state}`);
        reject(new Error(`Connection timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const onConnected = () => {
        clearTimeout(timeout);
        this.client.connection.off('connected', onConnected);
        this.client.connection.off('failed', onFailed);
        resolve();
      };

      const onFailed = (error: any) => {
        console.error('❌ Ably connection failed:', error.reason || error.message || error);
        clearTimeout(timeout);
        this.client.connection.off('connected', onConnected);
        this.client.connection.off('failed', onFailed);
        reject(new Error(`Connection failed: ${error.reason || error.message || error}`));
      };

      this.client.connection.on('connected', onConnected);
      this.client.connection.on('failed', onFailed);
    });
  }

  private waitForChannelReady(channel: Ably.RealtimeChannel, timeoutMs: number = 5000): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const currentState = channel.state;

      if (currentState === 'attached') {
        resolve();
        return;
      }

      // If channel is already in failed state, don't wait - reject immediately
      if (currentState === 'failed') {
        reject(new Error('Channel is in failed state'));
        return;
      }

      // If channel is in initialized state, force attachment
      if (currentState === 'initialized') {
        try {
          await channel.attach();
        } catch (attachError) {
          console.warn('⚠️ Failed to force channel attachment:', attachError);
        }
      }

      const timeout = setTimeout(() => {
        const finalState = channel.state;
        if (finalState === 'failed') {
          console.warn(`⏰ Channel timeout - failed state: ${finalState}`);
          reject(new Error(`Channel failed during timeout`));
        } else {
          // For other states, resolve to continue
          resolve();
        }
      }, timeoutMs);

      const onAttached = () => {
        clearTimeout(timeout);
        channel.off('attached', onAttached);
        channel.off('failed', onFailed);
        resolve();
      };

      const onFailed = (error: any) => {
        console.warn('❌ Channel failed:', error.reason || error.message || error);
        clearTimeout(timeout);
        channel.off('attached', onAttached);
        channel.off('failed', onFailed);
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

      if (!this.subscribedChannels.has(privateChan)) {
        // Wait for connection to be ready before subscribing
        this.waitForConnectionReady().then(() => {
          const channel: Ably.RealtimeChannel = this.client.channels.get(privateChan);

          // Wait for channel to be ready before subscribing
          this.waitForChannelReady(channel).then(() => {
            // Subscribe to messages
            channel.subscribe(async (msg: Ably.InboundMessage) => {
              // Handle specific message types
              switch (msg.name) {
                case 'SYNC':
                  if (handlers.onSync) {
                    await handlers.onSync(msg);
                  }
                  break;
                case 'SYNC_CHUNK':
                  // Handle chunked messages
                  try {
                    const chunk = JSON.parse(msg.data);
                    debugLog('📦 Received SYNC_CHUNK on private channel:', chunk);

                    const reconstructedMessage = messageReconstructionService.processChunk(chunk);
                    if (reconstructedMessage) {
                      // Message is complete, handle based on original message type
                      if (chunk.message_type === 'SYNC' && handlers.onSync) {
                        // Create a mock Ably message for backward compatibility
                        const mockMessage: Ably.InboundMessage = {
                          ...msg,
                          name: 'SYNC',
                          data: JSON.stringify(reconstructedMessage)
                        };
                        await handlers.onSync(mockMessage);
                      }
                      // Add other message type handlers as needed
                    }
                  } catch (error) {
                    console.error('❌ Failed to process SYNC_CHUNK:', error);
                  }
                  break;
                default:
                  if (handlers.onMessage) {
                    await handlers.onMessage(msg);
                  }
              }
            }).then(() => {
              this.subscribedChannels.set(privateChan, channel);
              resolve();
            }).catch(subscribeError => {
              console.warn(`Failed to subscribe to private channel:`, subscribeError.message || subscribeError);
              resolve(); // Don't reject, just continue without this channel
            });

            // Add critical error listeners
            channel.on('failed', (stateChange) => {
              console.warn(`⚠️ Private channel access denied:`, stateChange.reason || stateChange);
            });

          }).catch(channelError => {
            console.warn(`Private channel failed to reach ready state:`, channelError.message || channelError);
            resolve();
          });
        }).catch(connectionError => {
          console.warn(`Private channel connection failed:`, connectionError.message || connectionError);
          resolve();
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
    return new Promise((resolve) => {
      const groupChan: string = `${chain}.${network}`;

      if (!this.subscribedChannels.has(groupChan)) {
        // Wait for connection to be ready before subscribing
        this.waitForConnectionReady().then(() => {
          const channel: Ably.RealtimeChannel = this.client.channels.get(groupChan);

          // Wait for channel to be ready before subscribing
          this.waitForChannelReady(channel).then(() => {
            channel.subscribe(async (msg: Ably.InboundMessage) => {
              switch (msg.name) {
                case 'TIP':
                  if (handlers.onTip) {
                    await handlers.onTip(msg);
                  }
                  break;
                default:
                  if (handlers.onMessage) {
                    await handlers.onMessage(msg);
                  }
              }
            }).then(() => {
              this.subscribedChannels.set(groupChan, channel);
              resolve();
            }).catch(subscribeError => {
              console.warn(`Failed to subscribe to group channel:`, subscribeError.message || subscribeError);
              resolve();
            });

            // Add critical error handling
            channel.on('failed', (stateChange) => {
              console.warn(`⚠️ Group channel access denied:`, stateChange.reason || stateChange);
            });

          }).catch(channelError => {
            console.warn(`Group channel failed to reach ready state:`, channelError.message || channelError);
            resolve();
          });
        }).catch(connectionError => {
          console.warn(`Group channel connection failed:`, connectionError.message || connectionError);
          resolve();
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
      await this.client.channels.get(syncChannel).publish('SYNC', JSON.stringify(data));
    } catch (error) {
      console.warn(`⚠️ Failed to publish to sync channel:`, error);
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
