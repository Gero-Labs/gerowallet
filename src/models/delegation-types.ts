/**
 * DUST Fee Delegation Request Types
 *
 * This module defines types for the wallet-to-wallet DUST fee delegation system.
 * Users can request delegation from other wallets to help pay for their DUST registration fees.
 */

export enum DelegationRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  COMPLETED = 'completed',
  DISMISSED = 'dismissed',
}

export enum DelegationRequestType {
  INCOMING = 'incoming', // Requests received from other wallets
  OUTGOING = 'outgoing', // Requests sent to other wallets
}

export interface DelegationRequest {
  id: string; // Unique request ID (generated UUID)
  type: DelegationRequestType; // Incoming or outgoing
  status: DelegationRequestStatus;

  // Requester info
  requesterAddress: string; // Midnight unshielded address of requester
  requesterName?: string; // Optional display name

  // Funder info (wallet receiving the request)
  funderAddress: string; // Midnight unshielded address of funder

  // Request details
  requestedAmount?: string; // Optional: specific NIGHT amount for registration (default: use current balance)
  estimatedFee: string; // Estimated DUST fee for registration (in DUST, 12 decimals)
  message?: string; // Optional message from requester

  // Metadata
  createdAt: number; // Timestamp when request was created
  expiresAt: number; // Timestamp when request expires (24 hours default)
  respondedAt?: number; // Timestamp when request was approved/rejected
  completedAt?: number; // Timestamp when delegation transaction was completed
  dismissedAt?: number; // Timestamp when notification was dismissed

  // Transaction data (populated after approval)
  txHash?: string; // Transaction hash after successful delegation
  txError?: string; // Error message if delegation failed
}

/**
 * Ably message format for delegation requests
 * Sent over Ably channel: `MIDNIGHT.${network}.DELEGATION.${funderAddress}`
 */
export interface DelegationRequestMessage {
  type: 'DELEGATION_REQUEST' | 'DELEGATION_RESPONSE';
  requestId: string;
  requesterAddress: string;
  requesterName?: string;
  funderAddress: string;
  estimatedFee: string;
  message?: string;
  timestamp: number;
  expiresAt: number;

  // For response messages only
  approved?: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Notification data for UI display
 */
export interface DelegationNotification {
  id: string;
  type: 'request' | 'approval' | 'rejection' | 'completion';
  requestId: string;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  actionRequired: boolean; // True if user needs to approve/reject
}
