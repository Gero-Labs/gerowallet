import Dexie from 'dexie';
import { geroDBSchema, geroDBVersion, walletDBSchema, walletDBVersion } from '@/db/schema';
import * as bip39 from 'bip39';
import { encrypt } from '@/shared/utils/crypto';
import * as Crypto from '@cardano-sdk/crypto';
import { HARDENED, CoinTypes, Currency, WalletType, WalletTypePurpose } from '@/models/types';
import { bech32, bech32m } from 'bech32';
import { clearDbCache } from '@/db/wallet-db';
import { encryptPrivateKey } from '@/chrome/serialization';
import { resolvePrivateKey } from '@/shared/utils/resolver';

let cachedDb: Dexie | null = null;

export async function getDb() {
  if (cachedDb) {
    return cachedDb;
  }

  const db: Dexie = new Dexie('GeroWalletDatabase');

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

export async function createNewWalletDb(walletId: number|string, hasEncryptedMnemonic: boolean, isRestore: boolean = false) {
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
  const encryptedMnemonic: string = encrypt(mnemonic, password);
  const rootKey: Crypto.Bip32PrivateKey = resolvePrivateKey(mnemonic);
  const encryptedPrivateKey: string = encryptPrivateKey(rootKey, password);
  const accountIndex = 0;
  const bip32Ed25519: Crypto.Bip32Ed25519 = await Crypto.SodiumBip32Ed25519.create();
  const xpubHex: Crypto.Bip32PublicKeyHex = bip32Ed25519.getBip32PublicKey(rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + accountIndex]).hex());
  let words: number[]
  try {
    words = bech32.toWords(Buffer.from(xpubHex, 'hex'))
  } catch (e) {
    words = bech32m.toWords(Buffer.from(xpubHex, 'hex'));
  }
  const publicKey = bech32.encode('xpub', words, 120);

  const db: Dexie = await getDb();
  let order = await getLatestWalletByOrder();
  if (order == null) {
    order = 1;
  } else {
    order++;
  }
  const walletId = await db['wallets'].add({
    name,
    icon,
    type: WalletType.Normal,
    theme,
    order,
    encryptedPrivateKey,
    encryptedMnemonic,
    publicKey,
    passwordLastUpdate: new Date(),
    chain,
    network
  });
  await createNewWalletDb(walletId, !!encryptedMnemonic, isRestore);
  return walletId;
}

export async function  createNewHardwareWallet(wallet: any) {
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
  const parts = jwt.split(".");
  const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  const userId = payload.email;
  const walletId = await db['wallets'].add({
    name,
    icon,
    type: WalletType.Google,
    theme,
    order,
    encryptedPrivateKey: null,
    publicKey: null,
    passwordLastUpdate: new Date(),
    chain,
    network,
    userId,
  });
  await createNewWalletDb(walletId, false);
  return walletId;
}

export async function deleteWallet(walletId: number|string) {
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
