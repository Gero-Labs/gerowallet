import Dexie from 'dexie';

export interface ZkFoldWallet {
  id?: number;
  email: string;
  userId: string;
  proofId?: string;
  isActivated: boolean;
  walletId?: number; // Reference to main wallet ID in gero-db
  activatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

let cachedDb: Dexie | null = null;

/**
 * Get zkFold database instance
 */
export async function getZkFoldDb(): Promise<Dexie> {
  if (cachedDb) {
    return cachedDb;
  }

  const db = new Dexie('ZkFoldWalletDatabase');

  // Version 1: Initial schema
  db.version(1).stores({
    wallets: '++id, email, userId, proofId, isActivated, walletId, activatedAt, createdAt, updatedAt'
  });

  await db.open().catch(err => {
    console.error(`Failed to open ZkFold database: ${err.stack || err}`);
  });

  cachedDb = db;
  return db;
}

/**
 * Get zkFold wallet by email
 */
export async function getZkFoldWalletByEmail(email: string): Promise<ZkFoldWallet | undefined> {
  const db = await getZkFoldDb();
  return await db['wallets'].where({ email }).first();
}

/**
 * Get zkFold wallet by userId
 */
export async function getZkFoldWalletByUserId(userId: string): Promise<ZkFoldWallet | undefined> {
  const db = await getZkFoldDb();
  return await db['wallets'].where({ userId }).first();
}

/**
 * Get zkFold wallet by walletId (reference to main wallet)
 */
export async function getZkFoldWalletByWalletId(walletId: number): Promise<ZkFoldWallet | undefined> {
  const db = await getZkFoldDb();
  return await db['wallets'].where({ walletId }).first();
}

/**
 * Create or update zkFold wallet
 */
export async function upsertZkFoldWallet(data: Partial<ZkFoldWallet>): Promise<number> {
  const db = await getZkFoldDb();

  // Check if wallet exists
  const existing = await getZkFoldWalletByEmail(data.email!);

  const now = new Date();

  if (existing) {
    // Update existing wallet
    const updated: ZkFoldWallet = {
      ...existing,
      ...data,
      updatedAt: now
    };
    await db['wallets'].put(updated);
    console.log('✅ Updated zkFold wallet:', existing.id);
    return existing.id!;
  } else {
    // Create new wallet
    const newWallet: ZkFoldWallet = {
      email: data.email!,
      userId: data.userId!,
      proofId: data.proofId,
      isActivated: data.isActivated || false,
      walletId: data.walletId,
      activatedAt: data.activatedAt,
      createdAt: now,
      updatedAt: now
    };
    const id = await db['wallets'].add(newWallet);
    console.log('✅ Created zkFold wallet:', id);
    return id as number;
  }
}

/**
 * Store proofId for a wallet
 */
export async function storeProofId(email: string, proofId: string): Promise<void> {
  const db = await getZkFoldDb();
  const wallet = await getZkFoldWalletByEmail(email);

  if (!wallet) {
    throw new Error(`zkFold wallet not found for email: ${email}`);
  }

  await db['wallets'].update(wallet.id!, {
    proofId,
    updatedAt: new Date()
  });

  console.log('✅ Stored proofId for:', email);
}

/**
 * Mark wallet as activated
 */
export async function markWalletAsActivated(email: string, walletId?: number): Promise<void> {
  const db = await getZkFoldDb();
  const wallet = await getZkFoldWalletByEmail(email);

  if (!wallet) {
    throw new Error(`zkFold wallet not found for email: ${email}`);
  }

  const updates: Partial<ZkFoldWallet> = {
    isActivated: true,
    activatedAt: new Date(),
    updatedAt: new Date()
  };

  if (walletId !== undefined) {
    updates.walletId = walletId;
  }

  await db['wallets'].update(wallet.id!, updates);

  console.log('✅ Marked zkFold wallet as activated:', email);
}

/**
 * Check if wallet is activated
 */
export async function isWalletActivated(email: string): Promise<boolean> {
  const wallet = await getZkFoldWalletByEmail(email);
  return wallet?.isActivated || false;
}

/**
 * Get all zkFold wallets
 */
export async function getAllZkFoldWallets(): Promise<ZkFoldWallet[]> {
  const db = await getZkFoldDb();
  return await db['wallets'].toArray();
}

/**
 * Delete zkFold wallet by email
 */
export async function deleteZkFoldWallet(email: string): Promise<void> {
  const db = await getZkFoldDb();
  const wallet = await getZkFoldWalletByEmail(email);

  if (wallet) {
    await db['wallets'].delete(wallet.id!);
    console.log('✅ Deleted zkFold wallet:', email);
  }
}

/**
 * Clear all zkFold wallets (for testing or reset)
 */
export async function clearAllZkFoldWallets(): Promise<void> {
  const db = await getZkFoldDb();
  await db['wallets'].clear();
  console.log('✅ Cleared all zkFold wallets');
}

/**
 * Clear the database cache (useful for testing)
 */
export function clearZkFoldDbCache(): void {
  cachedDb = null;
}