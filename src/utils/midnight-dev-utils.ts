/**
 * Midnight Development Utilities
 *
 * This file contains utilities for developing and testing Midnight blockchain integration
 * without requiring full wallet implementation.
 */

import { getDb } from '@/db/gero-db';
import { Blockchain, Network, WalletType } from '@/models/types';
import Dexie from 'dexie';

/**
 * Creates a mock Midnight wallet for development and testing
 * This wallet has fake keys and is only meant for UI development
 *
 * @param walletName - Name for the wallet (default: 'Mock Midnight Wallet')
 * @param icon - Icon color for the wallet (default: 'deep-purple')
 * @returns {Promise<number>} The wallet ID
 */
export async function createMockMidnightWallet(
  walletName: string = 'Mock Midnight Wallet',
  icon: string = 'deep-purple'
): Promise<number> {
  const db: Dexie = await getDb();

  // Check if mock wallet already exists
  const existingWallets = await db['wallets'].toArray();
  const mockWalletExists = existingWallets.some(w =>
    w.chain === Blockchain.MIDNIGHT && w.name === walletName
  );

  if (mockWalletExists) {
    console.log(`Mock Midnight wallet "${walletName}" already exists`);
    const mockWallet = existingWallets.find(w =>
      w.chain === Blockchain.MIDNIGHT && w.name === walletName
    );
    return mockWallet.id;
  }

  // Get latest order
  const orderArray = await db['wallets'].orderBy('order').reverse().limit(1).keys();
  let order = 1;
  if (Array.isArray(orderArray) && orderArray.length) {
    order = (orderArray[0] as number) + 1;
  }

  // Create mock wallet entry
  // NOTE: This uses fake encrypted keys - DO NOT use in production
  const walletId = await db['wallets'].add({
    name: walletName,
    icon: icon,
    type: WalletType.Normal,
    theme: 'gero',
    order,
    // Mock encrypted data - these are not real keys!
    encryptedPrivateKey: `MOCK_ENCRYPTED_PRIVATE_KEY_${walletName.toUpperCase().replace(/\s/g, '_')}`,
    encryptedMnemonic: `MOCK_ENCRYPTED_MNEMONIC_${walletName.toUpperCase().replace(/\s/g, '_')}`,
    publicKey: `xpub_mock_midnight_${walletName.toLowerCase().replace(/\s/g, '_')}`,
    passwordLastUpdate: new Date(),
    chain: Blockchain.MIDNIGHT,
    network: Network.PREVIEW
  });

  console.log(`✅ Mock Midnight wallet "${walletName}" created with ID:`, walletId);
  console.log('⚠️ WARNING: This wallet uses fake keys and is for UI development only!');

  return walletId;
}

/**
 * Creates two mock Midnight wallets for testing DUST delegation
 * Wallet A (Alice) - The requester
 * Wallet B (Bob) - The funder
 *
 * @returns {Promise<{walletA: number, walletB: number}>} The wallet IDs
 */
export async function createDelegationTestWallets(): Promise<{walletA: number, walletB: number}> {
  console.log('🌙 Creating delegation test wallets...');

  const walletA = await createMockMidnightWallet('Alice (Requester)', 'purple');
  const walletB = await createMockMidnightWallet('Bob (Funder)', 'indigo');

  console.log('✅ Delegation test wallets created:');
  console.log('   Alice (Requester) ID:', walletA);
  console.log('   Bob (Funder) ID:', walletB);
  console.log('\n📋 Testing flow:');
  console.log('   1. Login to Alice → Request delegation from Bob\'s address');
  console.log('   2. Login to Bob → See notification → Approve request');
  console.log('   3. Login to Alice → See approval notification');

  return { walletA, walletB };
}

/**
 * Removes the mock Midnight wallet from the database
 *
 * @returns {Promise<void>}
 */
export async function removeMockMidnightWallet(): Promise<void> {
  const db: Dexie = await getDb();

  const wallets = await db['wallets'].toArray();
  const mockWallet = wallets.find(w =>
    w.chain === Blockchain.MIDNIGHT && w.name === 'Mock Midnight Wallet'
  );

  if (mockWallet) {
    await db['wallets'].delete(mockWallet.id);
    console.log('✅ Mock Midnight wallet removed');
  } else {
    console.log('No mock Midnight wallet found');
  }
}

/**
 * Initialize mock Midnight wallet on app startup (for development)
 * Call this from your app initialization code during development
 *
 * NOTE: Always creates the mock wallet regardless of NODE_ENV since Midnight Preview
 * network is a test network and this wallet is required for UI development/testing
 */
export async function initMockMidnightWalletForDev(): Promise<void> {
  try {
    await createMockMidnightWallet();
  } catch (error) {
    console.error('Error creating mock Midnight wallet:', error);
  }
}

// For console access during development
if (typeof window !== 'undefined') {
  (window as any).midnightDevUtils = {
    createMockWallet: createMockMidnightWallet,
    removeMockWallet: removeMockMidnightWallet,
    createDelegationTestWallets: createDelegationTestWallets,
  };
}
