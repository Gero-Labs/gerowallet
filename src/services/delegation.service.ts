/**
 * Delegation Service
 *
 * Handles DUST fee delegation request messaging via Ably.
 * Manages wallet-to-wallet communication for delegation requests and responses.
 */

import * as Ably from 'ably';
import {
  DelegationRequest,
  DelegationRequestMessage,
  DelegationRequestStatus,
  DelegationRequestType,
} from '@/models/delegation-types';
import {
  addOrUpdateDelegationRequest,
  updateDelegationRequestStatus,
} from '@/stores/delegationStore';
import { debugLog } from '@/utils/debug';
import { isMidnightMockWallet, getMockMidnightAddresses } from '@/utils/midnight-mock-data';
import { getAllWallets } from '@/db/gero-db';
import { addDelegationRequest, updateDelegationRequest } from '@/db/wallet-db';

class DelegationService {
  private ablyClient: Ably.Realtime | null = null;
  private delegationChannel: Ably.RealtimeChannel | null = null;
  private currentAddress: string | null = null;
  private currentNetwork: string | null = null;
  private mockMode: boolean = false;
  private currentWalletId: number | null = null;

  /**
   * Initialize delegation service with Ably client
   */
  public initialize(ablyClient: Ably.Realtime): void {
    this.ablyClient = ablyClient;
    console.log('📋 Delegation service initialized');
  }

  /**
   * Set mock mode for local testing (bypasses Ably)
   */
  public setMockMode(enabled: boolean, walletId?: number): void {
    this.mockMode = enabled;
    this.currentWalletId = walletId || null;
    if (enabled) {
      console.log('🧪 Delegation service: Mock mode enabled for wallet', walletId);
    }
  }

  /**
   * Subscribe to delegation request channel for a specific wallet address
   */
  public async subscribe(network: string, address: string): Promise<void> {
    if (!this.ablyClient) {
      console.warn('⚠️ Delegation service: Ably client not initialized');
      return;
    }

    // Unsubscribe from previous channel if exists
    if (this.delegationChannel) {
      await this.unsubscribe();
    }

    this.currentNetwork = network;
    this.currentAddress = address;

    // Channel name format: MIDNIGHT.{network}.DELEGATION.{address}
    // Example: MIDNIGHT.undeployed.DELEGATION.mn_addr_undeployed1...
    const channelName = `MIDNIGHT.${network}.DELEGATION.${address}`;

    console.log(`📡 Subscribing to delegation channel: ${channelName}`);

    try {
      this.delegationChannel = this.ablyClient.channels.get(channelName);

      // Subscribe to delegation request messages
      this.delegationChannel.subscribe('DELEGATION_REQUEST', this.handleDelegationRequest.bind(this));

      // Subscribe to delegation response messages (for outgoing requests)
      this.delegationChannel.subscribe('DELEGATION_RESPONSE', this.handleDelegationResponse.bind(this));

      console.log(`✅ Subscribed to delegation channel: ${channelName}`);
    } catch (error) {
      console.error('❌ Failed to subscribe to delegation channel:', error);
    }
  }

  /**
   * Unsubscribe from current delegation channel
   */
  public async unsubscribe(): Promise<void> {
    if (this.delegationChannel) {
      try {
        console.log('📡 Unsubscribing from delegation channel');
        await this.delegationChannel.unsubscribe();
        this.delegationChannel = null;
        this.currentAddress = null;
        this.currentNetwork = null;
      } catch (error) {
        console.warn('⚠️ Error unsubscribing from delegation channel:', error);
      }
    }
  }

  /**
   * Handle incoming delegation request
   */
  private async handleDelegationRequest(message: Ably.InboundMessage): Promise<void> {
    try {
      const data = message.data as DelegationRequestMessage;

      console.log('📨 Received delegation request:', data);

      // Validate message
      if (!this.validateDelegationMessage(data, 'DELEGATION_REQUEST')) {
        console.warn('⚠️ Invalid delegation request message, ignoring');
        return;
      }

      // Ensure this request is for the current wallet
      if (data.funderAddress !== this.currentAddress) {
        debugLog('⚠️ Delegation request not for current wallet, ignoring');
        return;
      }

      // Create delegation request object
      const request: DelegationRequest = {
        id: data.requestId,
        type: DelegationRequestType.INCOMING,
        status: DelegationRequestStatus.PENDING,
        requesterAddress: data.requesterAddress,
        requesterName: data.requesterName,
        funderAddress: data.funderAddress,
        estimatedFee: data.estimatedFee,
        message: data.message,
        createdAt: data.timestamp,
        expiresAt: data.expiresAt,
      };

      // Check if request is already expired
      if (request.expiresAt < Date.now()) {
        console.warn('⚠️ Received expired delegation request, marking as expired');
        request.status = DelegationRequestStatus.EXPIRED;
      }

      // Add to store and database
      await addOrUpdateDelegationRequest(request);

      console.log(`✅ Delegation request ${request.id} processed successfully`);
    } catch (error) {
      console.error('❌ Failed to handle delegation request:', error);
    }
  }

  /**
   * Handle delegation response (for outgoing requests)
   */
  private async handleDelegationResponse(message: Ably.InboundMessage): Promise<void> {
    try {
      const data = message.data as DelegationRequestMessage;

      console.log('📨 Received delegation response:', data);

      // Validate message
      if (!this.validateDelegationMessage(data, 'DELEGATION_RESPONSE')) {
        console.warn('⚠️ Invalid delegation response message, ignoring');
        return;
      }

      // Ensure this response is for the current wallet
      if (data.requesterAddress !== this.currentAddress) {
        debugLog('⚠️ Delegation response not for current wallet, ignoring');
        return;
      }

      // Update request status
      const status = data.approved
        ? DelegationRequestStatus.APPROVED
        : DelegationRequestStatus.REJECTED;

      await updateDelegationRequestStatus(data.requestId, status, {
        txHash: data.txHash,
        txError: data.error,
        completedAt: data.approved && data.txHash ? Date.now() : undefined,
      });

      console.log(`✅ Delegation response for ${data.requestId} processed: ${status}`);
    } catch (error) {
      console.error('❌ Failed to handle delegation response:', error);
    }
  }

  /**
   * Send delegation request to a funder wallet
   */
  public async sendDelegationRequest(
    funderAddress: string,
    requesterAddress: string,
    requesterName: string | undefined,
    estimatedFee: string,
    message: string | undefined,
    expiryHours: number = 24
  ): Promise<string> {
    // Generate unique request ID
    const requestId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + expiryHours * 60 * 60 * 1000; // 24 hours default

    // Save as outgoing request in local database
    const outgoingRequest: DelegationRequest = {
      id: requestId,
      type: DelegationRequestType.OUTGOING,
      status: DelegationRequestStatus.PENDING,
      requesterAddress,
      requesterName,
      funderAddress,
      estimatedFee,
      message,
      createdAt: now,
      expiresAt,
    };

    await addOrUpdateDelegationRequest(outgoingRequest);

    // MOCK MODE: Direct database insertion instead of Ably
    if (this.mockMode) {
      console.log('🧪 MOCK MODE: Creating delegation request directly in funder database');

      try {
        // Find funder wallet by address
        const funderWalletId = await this.findWalletIdByAddress(funderAddress);

        if (!funderWalletId) {
          console.warn('⚠️ Mock mode: Funder wallet not found, request saved as outgoing only');
          return requestId;
        }

        // Create incoming request in funder's database
        const incomingRequest: DelegationRequest = {
          id: requestId,
          type: DelegationRequestType.INCOMING,
          status: DelegationRequestStatus.PENDING,
          requesterAddress,
          requesterName,
          funderAddress,
          estimatedFee,
          message,
          createdAt: now,
          expiresAt,
        };

        await addDelegationRequest(funderWalletId, incomingRequest);
        console.log(`✅ MOCK MODE: Delegation request ${requestId} created in both databases`);

        return requestId;
      } catch (error) {
        console.error('❌ MOCK MODE: Failed to create delegation request in funder database:', error);
        // Request still exists in requester's DB as outgoing
        return requestId;
      }
    }

    // REAL MODE: Send via Ably
    if (!this.ablyClient) {
      throw new Error('Ably client not initialized');
    }

    if (!this.currentNetwork) {
      throw new Error('Network not set');
    }

    // Create delegation request message
    const requestMessage: DelegationRequestMessage = {
      type: 'DELEGATION_REQUEST',
      requestId,
      requesterAddress,
      requesterName,
      funderAddress,
      estimatedFee,
      message,
      timestamp: now,
      expiresAt,
    };

    // Channel name for the funder's wallet
    const channelName = `MIDNIGHT.${this.currentNetwork}.DELEGATION.${funderAddress}`;

    console.log(`📤 Sending delegation request to ${channelName}`);

    try {
      const channel = this.ablyClient.channels.get(channelName);
      await channel.publish('DELEGATION_REQUEST', requestMessage);

      console.log(`✅ Delegation request ${requestId} sent successfully`);
      return requestId;
    } catch (error) {
      console.error('❌ Failed to send delegation request:', error);
      throw error;
    }
  }

  /**
   * Send delegation response (approval/rejection)
   */
  public async sendDelegationResponse(
    requestId: string,
    requesterAddress: string,
    funderAddress: string,
    approved: boolean,
    txHash?: string,
    error?: string
  ): Promise<void> {
    // MOCK MODE: Direct database update instead of Ably
    if (this.mockMode) {
      console.log('🧪 MOCK MODE: Updating delegation request directly in requester database');

      try {
        // Find requester wallet by address
        const requesterWalletId = await this.findWalletIdByAddress(requesterAddress);

        if (!requesterWalletId) {
          console.warn('⚠️ Mock mode: Requester wallet not found');
          return;
        }

        // Update outgoing request in requester's database
        const status = approved ? DelegationRequestStatus.APPROVED : DelegationRequestStatus.REJECTED;
        await updateDelegationRequest(requesterWalletId, requestId, {
          status,
          txHash,
          txError: error,
          completedAt: approved && txHash ? Date.now() : undefined,
          respondedAt: Date.now(),
        });

        console.log(`✅ MOCK MODE: Delegation response for ${requestId} updated in requester database`);
        return;
      } catch (err) {
        console.error('❌ MOCK MODE: Failed to update delegation request in requester database:', err);
        return;
      }
    }

    // REAL MODE: Send via Ably
    if (!this.ablyClient) {
      throw new Error('Ably client not initialized');
    }

    if (!this.currentNetwork) {
      throw new Error('Network not set');
    }

    // Create delegation response message
    const responseMessage: DelegationRequestMessage = {
      type: 'DELEGATION_RESPONSE',
      requestId,
      requesterAddress,
      funderAddress,
      estimatedFee: '0', // Not needed in response
      timestamp: Date.now(),
      expiresAt: 0, // Not needed in response
      approved,
      txHash,
      error,
    };

    // Channel name for the requester's wallet
    const channelName = `MIDNIGHT.${this.currentNetwork}.DELEGATION.${requesterAddress}`;

    console.log(`📤 Sending delegation response to ${channelName}`);

    try {
      const channel = this.ablyClient.channels.get(channelName);
      await channel.publish('DELEGATION_RESPONSE', responseMessage);

      console.log(`✅ Delegation response for ${requestId} sent successfully`);
    } catch (error) {
      console.error('❌ Failed to send delegation response:', error);
      throw error;
    }
  }

  /**
   * Validate delegation message structure
   */
  private validateDelegationMessage(
    data: any,
    expectedType: 'DELEGATION_REQUEST' | 'DELEGATION_RESPONSE'
  ): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }

    if (data.type !== expectedType) {
      return false;
    }

    // Required fields for both types
    if (!data.requestId || !data.requesterAddress || !data.funderAddress || !data.timestamp) {
      return false;
    }

    // Additional validation for DELEGATION_REQUEST
    if (expectedType === 'DELEGATION_REQUEST') {
      if (!data.estimatedFee || !data.expiresAt) {
        return false;
      }
    }

    // Additional validation for DELEGATION_RESPONSE
    if (expectedType === 'DELEGATION_RESPONSE') {
      if (typeof data.approved !== 'boolean') {
        return false;
      }
    }

    return true;
  }

  /**
   * Find wallet ID by address (for mock mode)
   * Checks wallet's baseAddress against mock addresses
   */
  private async findWalletIdByAddress(address: string): Promise<number | null> {
    try {
      const walletsMap = await getAllWallets();

      for (const [walletId, wallet] of Object.entries(walletsMap)) {
        // Check if this is a mock Midnight wallet
        if (isMidnightMockWallet(wallet)) {
          const mockAddresses = getMockMidnightAddresses((wallet as any).name);

          // Check if any of the mock addresses match
          if (mockAddresses.unshielded === address ||
              mockAddresses.shielded === address ||
              mockAddresses.dust === address) {
            return parseInt(walletId);
          }
        }
      }

      return null;
    } catch (error) {
      console.error('❌ Failed to find wallet by address:', error);
      return null;
    }
  }

  /**
   * Clean up service
   */
  public async cleanup(): Promise<void> {
    await this.unsubscribe();
    this.ablyClient = null;
    this.mockMode = false;
    this.currentWalletId = null;
    console.log('🧹 Delegation service cleaned up');
  }
}

// Singleton instance
const delegationService = new DelegationService();

export default delegationService;
