import Dexie from 'dexie';
import { geroDBSchema, geroDBVersion, walletDBSchema, walletDBVersion, geroWalletDbName } from '@/db/schema';
import * as bip39 from 'bip39';
import { Currency, WalletType } from '@/models/types';
import { clearDbCache } from '@/db/wallet-db';
import { addNewGeroWallet, generateEncryptedWalletData, generateDeterministicSeed, generateWalletKeysFromSeed } from '@/db/helpers';

let cachedDb: Dexie | null = null;

export async function getDb() {
  if (cachedDb) {
    return cachedDb;
  }

  const db: Dexie = new Dexie(geroWalletDbName);

  // Upgrade
  db.version(10).stores({
    wallets: '++id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network',
    config: '++id, key, value',
    provider: '++id, [name+chain+network], baseUrl, apiKey',
  }).upgrade(async (tx) => {
    console.log('Upgrading database schema to version 11...', tx);
    try {
      const oldWallets = await tx.table('conceptualWallet').toArray();
      const keys = await tx.table('key').toArray();
      const publicKeyMap: Map<number, string> = new Map();
      const encryptedPrivateKeyMap: Map<number, string> = new Map();
      for (const key of keys) {
        const id = key.conceptualWalletId;
        if (key.hash.includes('xpub')) {
          publicKeyMap.set(id, key.hash);
        } else if (key.isEncrypted) {
          encryptedPrivateKeyMap.set(id, key.hash)
        }
      }

      // Check if the old table exists. If so, we are upgrading from the old version.
      if (oldWallets) {
        console.log('Migrating data from old schema (v9.2) to new schema (v10)...');

        for (const oldWallet of oldWallets) {
          const walletId = oldWallet.conceptualWalletId;
          // Map fields from the old schema to the new one.
          // For example:
          const newWallet = {
            id: walletId,
            name: oldWallet.name,
            icon: oldWallet.color,  // Default or map using your own logic
            type: oldWallet.walletType || 'Normal',
            theme: 'gero',
            order: oldWallet.listOrder,
            encryptedPrivateKey: encryptedPrivateKeyMap.get(walletId),
            publicKey: publicKeyMap.get(walletId),
            passwordLastUpdate: new Date(),
            chain: 'Cardano',
            network: 'Mainnet',
          };

          // Add the new wallet into the new wallets table.
          await tx.table('wallets').add(newWallet);
        }
      }
    } catch (error) {
      console.error('Error migrating data from old schema to new schema:', error);
    }
  });

  db.version(geroDBVersion).stores(geroDBSchema)

  await db.open().catch(err => {
    console.error(`Failed to open database: ${err.stack || err}`);
  });

  cachedDb = db;
  return db;
}

export async function setConfiguration(key, value) {
  const db: Dexie = await getDb();
  const configuration = await db['config'].where({ key: key }).first();
  if (!configuration) {
    await db['config'].put({
      key: key,
      value: value
    });
  } else {
    configuration.value = value;
    await db['config'].put(configuration);
  }
}

export async function getLatestWalletByOrder() {
  const db: Dexie = await getDb();
  const orderArray = await db['wallets'].orderBy('order').reverse().limit(1).keys();
  if (Array.isArray(orderArray) && orderArray.length) {
    return orderArray[0];
  }
  return null;
}

export async function getAllWallets() {
  const db: Dexie = await getDb();
  const wallets = await db['wallets'].toArray();
  const walletsMap = {};
  wallets.forEach(wallet => {
    walletsMap[wallet.id] = wallet;
  });
  return walletsMap;
}

export async function createNewWalletDb(walletId: number | string, hasEncryptedMnemonic: boolean, isRestore: boolean = false) {
  const walletName = typeof walletId === 'number' ? `wallet-${walletId}` : walletId;
  const db = new Dexie(walletName);
  db.version(walletDBVersion).stores(walletDBSchema)
  db.open().catch(err => {
    console.error(`Failed to open database: ${err.stack || err}`);
  });
  await db['config'].toArray().then(async rows => {
    if (rows.length === 0) {
      const initialData = [
        { key: 'currency', value: Currency.USD.short },
        { key: 'txAutoSubmit', value: true },
        { key: 'useSidePanel', value: true },
        { key: 'tokenAllocationSort', value: { by: 'allocation', desc: true } },
        { key: 'hideScamTokens', value: false },
        { key: 'hideUnratedTokens', value: false },
        { key: 'hideUnverifiedTokens', value: false },
        { key: 'stakingProView', value: false },
        { key: 'locale', value: 'us' },
      ]
      if (hasEncryptedMnemonic) {
        if (isRestore) {
          initialData.push({ key: 'backup', value: true })
        } else {
          initialData.push({ key: 'backup', value: false })
        }
      }
      await db['config'].bulkAdd(initialData).catch(error => {
        console.error('Error adding initial data:', error);
      });
    }
  });
}

export async function createNewWallet(name, icon, theme, mnemonic: string, password, chain, network) {
  let isRestore = true;
  if (!mnemonic) {
    isRestore = false;
    mnemonic = bip39.generateMnemonic(256);
  }

  const { encryptedPrivateKey, encryptedMnemonic, publicKey } = await generateEncryptedWalletData(mnemonic, password);
  const passwordLastUpdate = new Date();
  const walletId = await addNewGeroWallet({
    name,
    icon,
    type: WalletType.Normal,
    theme,
    encryptedPrivateKey,
    encryptedMnemonic,
    publicKey,
    passwordLastUpdate,
    chain,
    network
  });

  await createNewWalletDb(walletId, !!encryptedMnemonic, isRestore);
  return walletId;
}

export async function createNewHardwareWallet(wallet: any) {
  const db: Dexie = await getDb();
  let order = await getLatestWalletByOrder();
  if (order == null) {
    order = 1;
  } else {
    order++;
  }
  const walletId = await db['wallets'].add({
    ...wallet,
    order: order,
    passwordLastUpdate: new Date(),
  });
  await createNewWalletDb(walletId, !!wallet.encryptedMnemonic);
  return walletId;
}

export async function createNewGoogleWallet(name: string, icon: string, theme: string, password: string, chain: string, network: string, jwt: string) {
  const db: Dexie = await getDb();
  let order = await getLatestWalletByOrder();
  if (order == null) {
    order = 1;
  } else {
    order++;
  }
  
  // Validate and parse JWT token
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error('Invalid JWT token format');
  }
  
  const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  const userId = payload.email;
  
  if (!userId || !payload.email_verified) {
    throw new Error('Invalid or unverified Google account');
  }

  // Generate deterministic wallet keys from Google user ID + password
  // This approach provides:
  // 1. Deterministic key derivation (same user + password = same keys)
  // 2. User password protection
  // 3. Backup/recovery capability
  const deterministicSeed = await generateDeterministicSeed(userId, password);
  const { encryptedPrivateKey, publicKey } = await generateWalletKeysFromSeed(deterministicSeed, password);
  
  const walletId = await db['wallets'].add({
    name,
    icon,
    type: WalletType.Google,
    theme,
    order,
    encryptedPrivateKey,
    publicKey,
    passwordLastUpdate: new Date(),
    chain,
    network,
    userId,
    // Store additional Google-specific metadata
    googleJwtIssuer: payload.iss,
    googleAccountCreatedAt: new Date(),
  });
  
  await createNewWalletDb(walletId, true, false); // hasEncryptedMnemonic=true for Google wallets
  return walletId;
}

export async function deleteWallet(walletId: number | string) {
  const db: Dexie = await getDb();
  const walletName = typeof walletId === 'number' ? `wallet-${walletId}` : walletId;
  const numericWalletId = typeof walletId === 'number' ? walletId : parseInt(walletId);

  // Clear the cache before deleting
  clearDbCache(numericWalletId);

  await db['wallets'].delete(walletId)
  await Dexie.delete(walletName).catch(err => {
    console.error(`Failed to delete database '${walletName}': ${err.stack || err}`);
  });
}

/**
 * Set wallet name in the database
 * @param walletId - The wallet ID
 * @param name - The new wallet name
 */
export async function setWalletName(walletId: number, name: string): Promise<void> {
  const db: Dexie = await getDb();
  await db['wallets'].update(walletId, { name });
}

/**
 * Set wallet icon in the database
 * @param walletId - The wallet ID
 * @param icon - The new wallet icon
 */
export async function setWalletIcon(walletId: number, icon: string): Promise<void> {
  const db: Dexie = await getDb();
  await db['wallets'].update(walletId, { icon });
}

/**
 * Update private key and mnemonic in the database
 * @param walletId - The wallet ID
 * @param encryptedPrivateKey - The new encrypted private key
 * @param encryptedMnemonic - The new encrypted mnemonic (optional)
 */
export async function updatePrivateKeyAndMnemonic(
  walletId: number,
  encryptedPrivateKey: string,
  encryptedMnemonic?: string | null
): Promise<void> {
  const db: Dexie = await getDb();
  const updateData: any = {
    encryptedPrivateKey,
    passwordLastUpdate: new Date()
  };

  if (encryptedMnemonic !== undefined) {
    updateData.encryptedMnemonic = encryptedMnemonic;
  }

  await db['wallets'].update(walletId, updateData);
}

/**
 * Recover Google wallet by re-deriving keys from user credentials
 * This allows users to recover their wallet if they remember their Google account and password
 * @param userId - Google user email/ID
 * @param password - User's spending password
 * @param chain - Blockchain (e.g., 'Cardano')
 * @param network - Network (e.g., 'Mainnet')
 */
export async function recoverGoogleWallet(
  userId: string, 
  password: string, 
  chain: string, 
  network: string
): Promise<{ walletId: number; keys: { encryptedPrivateKey: string; publicKey: string } }> {
  const db: Dexie = await getDb();
  
  // Check if wallet already exists
  const existingWallet = await db['wallets'].where('userId').equals(userId).first();
  if (existingWallet) {
    throw new Error('Wallet already exists for this Google account');
  }
  
  // Re-derive keys using the same deterministic process
  const deterministicSeed = await generateDeterministicSeed(userId, password);
  const { encryptedPrivateKey, publicKey } = await generateWalletKeysFromSeed(deterministicSeed, password);
  
  // Create recovered wallet
  let order = await getLatestWalletByOrder();
  if (order == null) {
    order = 1;
  } else {
    order++;
  }
  
  const walletId = await db['wallets'].add({
    name: userId.split('@')[0], // Use email prefix as default name
    icon: '', // Default icon
    type: WalletType.Google,
    theme: 'gero',
    order,
    encryptedPrivateKey,
    publicKey,
    passwordLastUpdate: new Date(),
    chain,
    network,
    userId,
    googleAccountRecoveredAt: new Date(),
  });
  
  await createNewWalletDb(walletId, true, true); // isRestore=true for recovered wallets
  
  return { walletId, keys: { encryptedPrivateKey, publicKey } };
}

/**
 * Validate Google wallet credentials without creating a wallet
 * This can be used to verify credentials before wallet creation/recovery
 * @param userId - Google user email/ID
 * @param password - User's spending password
 * @param existingPublicKey - Optional: compare against existing public key for validation
 */
export async function validateGoogleWalletCredentials(
  userId: string, 
  password: string, 
  existingPublicKey?: string
): Promise<{ isValid: boolean; publicKey: string }> {
  try {
    const deterministicSeed = await generateDeterministicSeed(userId, password);
    const { publicKey } = await generateWalletKeysFromSeed(deterministicSeed, password);
    
    const isValid = existingPublicKey ? publicKey === existingPublicKey : true;
    
    return { isValid, publicKey };
  } catch (error) {
    console.error('Error validating Google wallet credentials:', error);
    return { isValid: false, publicKey: '' };
  }
}
