/**
 * Midnight Mock Data Service
 *
 * Provides realistic mock data for Midnight blockchain development and testing.
 * This includes balances, addresses, transactions, and UTXOs for the mock Midnight wallet.
 *
 * IMPORTANT: This data is for UI development only and should NOT be used in production.
 */

import { Blockchain, Network } from '@/models/types';

/**
 * Midnight-specific balance structure (Five Balance Components)
 * Based on Midnight_Implementation_Guide.html Phase 3
 */
export interface MidnightBalances {
  nightShielded: bigint;      // NIGHT tokens in shielded pool (private)
  nightUnshielded: bigint;    // NIGHT tokens in unshielded pool (public)
  nightRegistered: bigint;    // NIGHT tokens registered for DUST generation
  dust: bigint;               // DUST tokens available (non-transferable, for fees)
  dustGenerating: bigint;     // Projected DUST generation from registered NIGHT
}

/**
 * Midnight address types (Three-Address System)
 */
export interface MidnightAddresses {
  dust: string;       // Dust address (midnightt1dust...)
  shielded: string;   // Shielded address (midnightt1shield...)
  unshielded: string; // Unshielded address (midnightt1...)
}

/**
 * Midnight transaction mock data
 */
export interface MidnightTransaction {
  id: string;
  type: 'send' | 'receive' | 'register_dust' | 'deregister_dust' | 'shield' | 'unshield';
  token: 'NIGHT' | 'DUST';
  amount: bigint;
  from: string;
  to: string;
  timestamp: number;
  status: 'confirmed' | 'pending' | 'failed';
  fee: bigint;
  blockHeight?: number;
  isShielded: boolean; // Whether transaction used ZK proofs
  proofTime?: number;  // Time spent generating ZK proof (ms)
}

/**
 * Mock UTXO for DUST registration UI
 */
export interface MidnightUTXO {
  txHash: string;
  outputIndex: number;
  address: string;
  value: bigint; // NIGHT tokens
  registeredForDust: boolean;
  dustGenerated: bigint; // Amount of DUST generated so far
  registrationTime?: number; // When it was registered
}

/**
 * Generate mock Midnight balances with realistic values
 */
export function getMockMidnightBalances(): MidnightBalances {
  return {
    // 1,234.567890 NIGHT shielded (12 decimals = 10^12)
    nightShielded: BigInt(1234567890000000),

    // 5,678.123456 NIGHT unshielded
    nightUnshielded: BigInt(5678123456000000),

    // 3,000.000000 NIGHT registered for DUST generation
    nightRegistered: BigInt(3000000000000000),

    // 45.678901 DUST available
    dust: BigInt(45678901000000),

    // 750.000000 DUST generated so far (50% of max cap of 1500)
    // With 3000 NIGHT registered, max DUST = 1500 (50% cap)
    // At 0.5 DUST per day per NIGHT, this represents ~12 hours of generation
    dustGenerating: BigInt(750000000000000),
  };
}

/**
 * Generate a simple hash from a string for creating unique mock addresses
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36).padStart(8, '0');
}

/**
 * Generate mock Midnight addresses (testnet Preview format)
 * @param walletIdentifier - Unique identifier for the wallet (name or publicKey)
 */
export function getMockMidnightAddresses(walletIdentifier?: string): MidnightAddresses {
  // Generate unique suffix based on wallet identifier
  const suffix = walletIdentifier ? simpleHash(walletIdentifier) : 'default0';

  return {
    // Mock dust address (bech32m format) - mn_addr_undeployed prefix for delegation compatibility
    dust: `mn_addr_undeployed1dust${suffix}qyx2ymk0sa79uyap0vdvz3ayxglz5nx0ktc9792gljeaha664arus97u6mw`,

    // Mock shielded address
    shielded: `mn_addr_undeployed1shield${suffix}qyx2ymk0sa79uyap0vdvz3ayxglz5nx0ktc9792gljeaha664arus97u6mw`,

    // Mock unshielded address (standard) - This is used as baseAddress for delegation
    unshielded: `mn_addr_undeployed1${suffix}qyx2ymk0sa79uyap0vdvz3ayxglz5nx0ktc9792gljeaha664arus97u6mw`,
  };
}

/**
 * Generate mock Midnight transactions
 * @param walletIdentifier - Unique identifier for the wallet (name or publicKey)
 */
export function getMockMidnightTransactions(walletIdentifier?: string): MidnightTransaction[] {
  const now = Date.now();
  const addresses = getMockMidnightAddresses(walletIdentifier);

  return [
    {
      id: 'tx_mock_midnight_001',
      type: 'receive',
      token: 'NIGHT',
      amount: BigInt(1000000000000000), // 1,000 NIGHT
      from: 'midnightt1mock_sender_address_1',
      to: addresses.unshielded,
      timestamp: now - 3600000 * 24 * 5, // 5 days ago
      status: 'confirmed',
      fee: BigInt(150000000000), // 0.15 DUST fee
      blockHeight: 12345,
      isShielded: false,
    },
    {
      id: 'tx_mock_midnight_002',
      type: 'register_dust',
      token: 'NIGHT',
      amount: BigInt(3000000000000000), // 3,000 NIGHT registered
      from: addresses.unshielded,
      to: addresses.unshielded, // Registration is self-transaction
      timestamp: now - 3600000 * 24 * 4, // 4 days ago
      status: 'confirmed',
      fee: BigInt(100000000000), // 0.1 DUST fee
      blockHeight: 12456,
      isShielded: false,
    },
    {
      id: 'tx_mock_midnight_003',
      type: 'shield',
      token: 'NIGHT',
      amount: BigInt(500000000000000), // 500 NIGHT
      from: addresses.unshielded,
      to: addresses.shielded,
      timestamp: now - 3600000 * 24 * 3, // 3 days ago
      status: 'confirmed',
      fee: BigInt(200000000000), // 0.2 DUST fee
      blockHeight: 12567,
      isShielded: true,
      proofTime: 12340, // 12.34 seconds to generate ZK proof
    },
    {
      id: 'tx_mock_midnight_004',
      type: 'send',
      token: 'NIGHT',
      amount: BigInt(250000000000000), // 250 NIGHT
      from: addresses.shielded,
      to: 'midnightt1shield_mock_recipient_1',
      timestamp: now - 3600000 * 24 * 2, // 2 days ago
      status: 'confirmed',
      fee: BigInt(180000000000), // 0.18 DUST fee
      blockHeight: 12678,
      isShielded: true,
      proofTime: 10850, // 10.85 seconds
    },
    {
      id: 'tx_mock_midnight_005',
      type: 'receive',
      token: 'NIGHT',
      amount: BigInt(750000000000000), // 750 NIGHT
      from: 'midnightt1shield_mock_sender_2',
      to: addresses.shielded,
      timestamp: now - 3600000 * 24 * 1, // 1 day ago
      status: 'confirmed',
      fee: BigInt(0), // Receiver doesn't pay fee
      blockHeight: 12789,
      isShielded: true,
    },
    {
      id: 'tx_mock_midnight_006',
      type: 'send',
      token: 'NIGHT',
      amount: BigInt(100000000000000), // 100 NIGHT
      from: addresses.unshielded,
      to: 'midnightt1mock_recipient_3',
      timestamp: now - 3600000 * 6, // 6 hours ago
      status: 'confirmed',
      fee: BigInt(120000000000), // 0.12 DUST fee
      blockHeight: 12890,
      isShielded: false,
    },
    {
      id: 'tx_mock_midnight_007',
      type: 'unshield',
      token: 'NIGHT',
      amount: BigInt(200000000000000), // 200 NIGHT
      from: addresses.shielded,
      to: addresses.unshielded,
      timestamp: now - 3600000 * 3, // 3 hours ago
      status: 'pending',
      fee: BigInt(150000000000), // 0.15 DUST fee
      isShielded: true,
      proofTime: 11200, // 11.2 seconds
    },
  ];
}

/**
 * Generate mock UTXOs for DUST registration UI
 * @param walletIdentifier - Unique identifier for the wallet (name or publicKey)
 */
export function getMockMidnightUTXOs(walletIdentifier?: string): MidnightUTXO[] {
  const now = Date.now();
  const addresses = getMockMidnightAddresses(walletIdentifier);

  return [
    {
      txHash: 'mock_tx_hash_utxo_001',
      outputIndex: 0,
      address: addresses.unshielded,
      value: BigInt(2000000000000000), // 2,000 NIGHT
      registeredForDust: true,
      dustGenerated: BigInt(8000000000000), // 8 DUST generated so far
      registrationTime: now - 3600000 * 24 * 4, // 4 days ago
    },
    {
      txHash: 'mock_tx_hash_utxo_002',
      outputIndex: 1,
      address: addresses.unshielded,
      value: BigInt(1000000000000000), // 1,000 NIGHT
      registeredForDust: true,
      dustGenerated: BigInt(4000000000000), // 4 DUST generated
      registrationTime: now - 3600000 * 24 * 4, // 4 days ago
    },
    {
      txHash: 'mock_tx_hash_utxo_003',
      outputIndex: 0,
      address: addresses.unshielded,
      value: BigInt(1500000000000000), // 1,500 NIGHT
      registeredForDust: false, // Not registered yet
      dustGenerated: BigInt(0),
    },
    {
      txHash: 'mock_tx_hash_utxo_004',
      outputIndex: 2,
      address: addresses.unshielded,
      value: BigInt(500000000000000), // 500 NIGHT
      registeredForDust: false,
      dustGenerated: BigInt(0),
    },
    {
      txHash: 'mock_tx_hash_utxo_005',
      outputIndex: 0,
      address: addresses.unshielded,
      value: BigInt(1178123456000000), // 1,178.123456 NIGHT (remaining unshielded balance)
      registeredForDust: false,
      dustGenerated: BigInt(0),
    },
  ];
}

/**
 * Check if a wallet is a Midnight mock wallet
 */
export function isMidnightMockWallet(wallet: any): boolean {
  return wallet.chain === Blockchain.MIDNIGHT &&
         wallet.network === Network.PREVIEW &&
         (wallet.name?.includes('Mock Midnight') ||
          wallet.name === 'Alice (Requester)' ||
          wallet.name === 'Bob (Funder)');
}

/**
 * Get complete mock data package for Midnight wallet
 * @param wallet - The wallet object to generate mock data for
 */
export function getMockMidnightWalletData(wallet?: any) {
  // Use wallet name or publicKey as identifier for unique addresses
  const identifier = wallet?.name || wallet?.publicKey || 'default';

  return {
    balances: getMockMidnightBalances(),
    addresses: getMockMidnightAddresses(identifier),
    transactions: getMockMidnightTransactions(identifier),
    utxos: getMockMidnightUTXOs(identifier),

    // Additional metadata
    metadata: {
      lastSync: Date.now(),
      blockHeight: 12890,
      networkStatus: 'connected',
      // DUST generation rate: 0.5 DUST per day per NIGHT (from Midnight docs)
      // This means 1 NIGHT generates 0.5 DUST per day
      // With max cap of 50% registered NIGHT, full generation takes ~1 day
      dustGenerationRate: 0.5,
    }
  };
}

/**
 * Format NIGHT amount for display (12 decimals)
 */
export function formatNight(value: bigint): string {
  const night = Number(value) / 1e12;
  return night.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Format DUST amount for display (12 decimals)
 */
export function formatDust(value: bigint): string {
  const dust = Number(value) / 1e12;
  return dust.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Console logging utilities for debugging
 */
export function logMockMidnightData() {
  console.group('🌙 Midnight Mock Data Summary');

  const data = getMockMidnightWalletData(); // Uses default identifier

  console.log('📊 Balances:');
  console.log(`  NIGHT Shielded: ${formatNight(data.balances.nightShielded)} tNIGHT`);
  console.log(`  NIGHT Unshielded: ${formatNight(data.balances.nightUnshielded)} tNIGHT`);
  console.log(`  NIGHT Registered: ${formatNight(data.balances.nightRegistered)} tNIGHT`);
  console.log(`  DUST Available: ${formatDust(data.balances.dust)} tDUST`);
  console.log(`  DUST Generating: ${formatDust(data.balances.dustGenerating)} tDUST`);

  console.log('\n📍 Addresses:');
  console.log(`  Dust: ${data.addresses.dust.substring(0, 30)}...`);
  console.log(`  Shielded: ${data.addresses.shielded.substring(0, 30)}...`);
  console.log(`  Unshielded: ${data.addresses.unshielded.substring(0, 30)}...`);

  console.log(`\n📜 Transactions: ${data.transactions.length} total`);
  console.log(`💎 UTXOs: ${data.utxos.length} total (${data.utxos.filter(u => u.registeredForDust).length} registered for DUST)`);

  console.groupEnd();
}

/**
 * Log addresses for delegation testing
 * Useful for getting addresses to use when testing delegation requests
 */
export function logDelegationTestAddresses() {
  console.group('🌙 Midnight Delegation Test Addresses');

  const aliceData = getMockMidnightWalletData({ name: 'Alice (Requester)' });
  const bobData = getMockMidnightWalletData({ name: 'Bob (Funder)' });

  console.log('👩 Alice (Requester):');
  console.log(`  Address: ${aliceData.addresses.unshielded}`);
  console.log('  Alice will REQUEST delegation from Bob');

  console.log('\n👨 Bob (Funder):');
  console.log(`  Address: ${bobData.addresses.unshielded}`);
  console.log('  Use this when requesting delegation FROM Bob');

  console.log('\n📋 Testing Flow:');
  console.log('  1. Login to Alice → Click "Request Delegation"');
  console.log(`  2. Enter Bob's address: ${bobData.addresses.unshielded}`);
  console.log('  3. Login to Bob → See notification → Approve');
  console.log('  4. Login to Alice → See approval notification');

  console.groupEnd();

  return {
    alice: aliceData.addresses.unshielded,
    bob: bobData.addresses.unshielded,
  };
}

// Expose to window for console access during development
if (typeof window !== 'undefined') {
  (window as any).midnightMockData = {
    getBalances: getMockMidnightBalances,
    getAddresses: getMockMidnightAddresses,
    getTransactions: getMockMidnightTransactions,
    getUTXOs: getMockMidnightUTXOs,
    getData: getMockMidnightWalletData,
    log: logMockMidnightData,
    logDelegationAddresses: logDelegationTestAddresses,
    formatNight,
    formatDust,
  };
}
