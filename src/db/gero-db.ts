import Dexie from 'dexie';
import { geroDBSchema, geroDBVersion, walletDBSchema, walletDBVersion } from '@/db/schema';
import * as bip39 from 'bip39';
import { encrypt, encryptPrivateKey } from '@/shared/utils/crypto';
import { Blockchain, CoinTypes, Currency, HARDENED, Wallet, WalletType, WalletTypePurpose } from '@/models/types';
import { bech32, bech32m } from 'bech32';
import { clearDbCache } from '@/db/wallet-db';
import { resolvePrivateKey } from '@/shared/utils/resolver';
import { Bip32Ed25519, Bip32PrivateKey, Bip32PublicKeyHex, SodiumBip32Ed25519 } from '@cardano-sdk/crypto';

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

  // Version 14: Add PRF encryption support (optional fields for new wallets only)
  // No migration needed - all new fields are optional
  db.version(14).stores({
    wallets:
      '++id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network, userId, encryptionMethod, webAuthnCredentialId',
    config: '++id, key, value',
    provider: '++id, [name+chain+network], baseUrl, apiKey',
  });

  // Version 15: Add addressType field for Bitcoin support
  db.version(geroDBVersion).stores(geroDBSchema).upgrade(async (tx) => {
    console.log('Upgrading GeroWalletDatabase to v15: Adding addressType field...');
    try {
      const wallets = await tx.table('wallets').toArray();

      for (const wallet of wallets) {
        let addressType: string;

        // Determine addressType based on chain
        if (wallet.chain === 'Cardano' || wallet.chain === 'Apex Fusion Prime' || wallet.chain === 'Apex Fusion Vector') {
          addressType = 'shelley';  // Cardano base addresses
        } else if (wallet.chain === 'Bitcoin') {
          addressType = 'segwit';   // Default Bitcoin address type (P2WPKH)
        } else {
          addressType = 'unknown';  // Fallback for future chains
        }

        // Update wallet record with new field
        await tx.table('wallets').update(wallet.id, { addressType });
      }

      console.log('✅ GeroWalletDatabase v15 migration complete');
    } catch (error) {
      console.error('❌ GeroWalletDatabase v15 migration failed:', error);
      throw error;
    }
  });

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

/**
 * Get the next available wallet ID
 *
 * This is the single source of truth for wallet ID allocation.
 * Used for PRF wallets where the ID must be known before wallet creation
 * (needed for PRF salt generation during credential registration).
 *
 * @returns Promise<number> - Next available wallet ID
 * @throws Error if database is unavailable or operation fails
 */
export async function getNextWalletId(): Promise<number> {
  try {
    const db: Dexie = await getDb();
    const maxWallet = await db['wallets'].orderBy('id').last();
    return (maxWallet?.id || 0) + 1;
  } catch (error) {
    console.error('Failed to get next wallet ID:', error);
    throw new Error('Unable to access wallet database. Please check browser permissions and try again.');
  }
}

export async function getAllWallets() {
  const db: Dexie = await getDb();
  const wallets = await db['wallets'].toArray();
  const walletsMap = {};
  wallets.forEach((wallet: Wallet) => {
    walletsMap[wallet.id] = wallet;
  });
  return walletsMap;
}

export async function createNewWalletDb(walletId: number|string, hasEncryptedMnemonic: boolean, isRestore: boolean = false) {
  const walletName = typeof walletId === 'number' ? `wallet-${walletId}` : walletId;
  const db = new Dexie(walletName);

  // For new wallets, just use the latest version
  // Migration paths are only needed when opening existing wallets (handled in wallet-db.ts getDb())
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

/**
 * Helper function to get default address type by chain
 */
function getDefaultAddressType(chain: string): string {
  switch (chain) {
    case Blockchain.BITCOIN:
      return 'segwit';  // P2WPKH (bc1q...)
    case Blockchain.CARDANO:
    case Blockchain.APEX_PRIME:
    case Blockchain.APEX_VECTOR:
      return 'shelley';
    case Blockchain.MIDNIGHT:
      // Midnight derives 3 role-specific addresses (Zswap shielded, NightExternal
      // unshielded, Dust). The wallet manages all three; the addressType field
      // stores 'unshielded' as the default receive address category.
      return 'unshielded';
    default:
      return 'unknown';
  }
}

/**
 * Create a new wallet with password or PRF encryption
 *
 * @param name - Wallet name
 * @param icon - Wallet icon
 * @param theme - Wallet theme
 * @param mnemonic - BIP39 mnemonic (24 words). If empty, generates new one
 * @param password - Spending password
 * @param chain - Blockchain (e.g., 'Cardano', 'Bitcoin')
 * @param network - Network (e.g., 'Mainnet', 'Preprod', 'Testnet')
 * @param addressType - Address type (e.g., 'segwit' for Bitcoin, 'shelley' for Cardano)
 * @param options - Optional PRF encryption options
 * @param options.usePrf - Use PRF encryption instead of password encryption
 * @param options.credentialId - WebAuthn credential ID (required if usePrf is true)
 * @param options.passwordUnlockEnabled - Whether password unlock is enabled (determines if spending password hash is stored)
 * @param options.backupMnemonic - Whether to encrypt mnemonic for backup (default: true)
 * @returns Promise<number> - Wallet ID
 */
export async function createNewWallet(
  name: string,
  icon: string,
  theme: string,
  mnemonic: string,
  password: string,
  chain: string,
  network: string,
  addressType: string = getDefaultAddressType(chain),
  options?: {
    usePrf?: boolean;
    credentialId?: string;
    passwordUnlockEnabled?: boolean;
    backupMnemonic?: boolean;
    prfOutput?: ArrayBuffer; // PRF output from registration (avoids second prompt)
    walletId?: number; // Pre-allocated wallet ID for PRF wallets (must match PRF salt)
    /**
     * For Midnight wallets only. Pre-derived bech32m addresses (3 role-specific
     * ones) computed by the caller in an SDK-aware context. gero-db does not
     * derive these itself — see the Midnight branch above for why.
     */
    midnightAddresses?: { unshielded: string; shielded: string; dust: string };
  }
) {
  let isRestore = true;
  if (!mnemonic) {
    isRestore = false;
    mnemonic = bip39.generateMnemonic(256);
  }

  // Derive keys based on chain
  let rootKey: any;
  let publicKey: string;

  if (chain === Blockchain.BITCOIN) {
    // Bitcoin key derivation
    const { deriveBitcoinAccountXpub, deriveBitcoinRootKey } = await import('@/chains/bitcoin/bitcoinKeyManager');
    rootKey = deriveBitcoinRootKey(mnemonic);
    publicKey = deriveBitcoinAccountXpub(mnemonic, network, addressType);
  } else if (chain === Blockchain.MIDNIGHT) {
    // Midnight key derivation: BIP39 → 64-byte seed. The Midnight SDK
    // (HDWallet + UnshieldedAddress) is intentionally NOT imported here —
    // pulling `@midnightntwrk/wallet-sdk-*` into gero-db.ts would drag the
    // ~10MB ledger-v8 WASM + `effect` runtime into the background service
    // worker bundle. Instead, callers (CreateWallet.vue, RestoreWallet.vue)
    // pre-derive the bech32m addresses in the options context and pass them
    // via `options.midnightAddresses`; gero-db just serializes them onto the
    // wallet record under `publicKey`.
    const seed: Uint8Array = bip39.mnemonicToSeedSync(mnemonic);
    rootKey = { privateKey: seed };
    publicKey = options?.midnightAddresses
      ? JSON.stringify(options.midnightAddresses)
      : JSON.stringify({ unshielded: '', shielded: '', dust: '' });
  } else {
    // Cardano key derivation (existing logic)
    rootKey = resolvePrivateKey(mnemonic);
    publicKey = await derivePublicKeyFromMnemonic(mnemonic);
  }

  const db: Dexie = await getDb();
  let order = await getLatestWalletByOrder();
  if (order == null) {
    order = 1;
  } else {
    order++;
  }

  // Determine if we're using PRF encryption
  const usePrf = options?.usePrf || false;

  if (usePrf) {
    // ============================================================================
    // PRF ENCRYPTION MODE (NEW WALLETS)
    // ============================================================================

    if (!options?.credentialId) {
      throw new Error('Credential ID is required for PRF encryption');
    }

    // Step 1: Get wallet ID (must be pre-allocated for PRF salt consistency)
    // The wallet ID MUST match the one used for PRF salt during credential registration
    let newWalletId: number;
    if (options.walletId !== undefined) {
      // Use pre-allocated ID (ensures PRF salt consistency)
      newWalletId = options.walletId;
    } else {
      // Fallback: Calculate ID (backward compatibility, but risky for race conditions)
      const maxWallet = await db['wallets'].orderBy('id').last();
      newWalletId = (maxWallet?.id || 0) + 1;
      console.warn('[PRF] ⚠️ Wallet ID not provided in options, calculating on-the-fly (potential race condition)');
    }

    // Import PRF encryption functions
    const {
      evaluatePrfForWallet,
      encryptPrivateKeyWithPrf,
      encryptMnemonicWithPrf,
      hashSpendingPassword
    } = await import('@/shared/utils/webauthn-prf');

    // Step 2: Evaluate PRF (only if not provided - avoids second PassKey prompt)
    let prfOutput: ArrayBuffer;
    if (options.prfOutput) {
      prfOutput = options.prfOutput;
    } else {
      prfOutput = await evaluatePrfForWallet(options.credentialId, newWalletId.toString());
    }

    try {
      // Step 3: Encrypt private key using PRF output (no additional prompt)
      // Extract key bytes based on chain
      const keyBytes = (chain === Blockchain.BITCOIN || chain === Blockchain.MIDNIGHT)
        ? rootKey.privateKey  // Bitcoin/Midnight: { privateKey: Uint8Array }
        : rootKey.bytes();    // Cardano: Bip32PrivateKey has bytes() method

      const prfEncryptedPrivateKey = await encryptPrivateKeyWithPrf(
        keyBytes,
        options.credentialId,
        newWalletId.toString(),
        prfOutput // Pass PRF output to avoid re-evaluation
      );

      // Step 4: Optionally encrypt mnemonic using same PRF output (no additional prompt)
      // Default to true unless explicitly disabled
      const shouldBackupMnemonic = options.backupMnemonic !== false;
      const prfEncryptedMnemonic = shouldBackupMnemonic
        ? await encryptMnemonicWithPrf(mnemonic, options.credentialId, newWalletId.toString(), prfOutput)
        : undefined;

      // Step 4: Optionally hash spending password if password unlock is enabled
      const prfSpendingPassword = options.passwordUnlockEnabled
        ? await hashSpendingPassword(password)
        : undefined;

      // Step 5: Insert wallet with pre-allocated ID
      // IndexedDB allows specifying the ID directly
      const walletData = {
        id: newWalletId,
        name,
        icon,
        type: WalletType.Normal,
        theme,
        order,
        publicKey,
        passwordLastUpdate: new Date(),
        chain,
        network,
        addressType,  // Version 15+: Address type
        // PRF encryption fields (Version 14+)
        encryptionMethod: 'prf',
        prfEncryptedPrivateKey,
        prfEncryptedMnemonic,
        webAuthnCredentialId: options.credentialId,
        prfSpendingPassword
      };

      await db['wallets'].add(walletData);

      await createNewWalletDb(newWalletId, !!prfEncryptedMnemonic, isRestore);
      return newWalletId;
    } finally {
      // CRITICAL: Zero all ArrayBuffer references to prevent memory leaks
      // Zero the local prfOutput reference
      if (prfOutput) {
        new Uint8Array(prfOutput).fill(0);
      }

      // Also zero the passed-in prfOutput if it exists and is a different reference
      // (defensive programming - ensures caller's reference is also zeroed)
      if (options?.prfOutput && options.prfOutput !== prfOutput) {
        new Uint8Array(options.prfOutput).fill(0);
      }
    }

  } else {
    // ============================================================================
    // PASSWORD ENCRYPTION MODE (EXISTING WALLETS)
    // ============================================================================
    console.log('🔑 Password Encryption Branch Entered (usePrf was false)');

    const encryptedMnemonic: string = encrypt(mnemonic, password);

    // Encrypt private key based on chain
    let encryptedPrivateKey: string;
    if (chain === Blockchain.BITCOIN || chain === Blockchain.MIDNIGHT) {
      // Bitcoin/Midnight: encrypt raw key bytes (Uint8Array). Same double-encrypt
      // pattern as Cardano's encryptPrivateKey, just without the Bip32PrivateKey wrapper.
      const { encryptWithPassword } = await import('@/shared/utils/crypto');
      const CryptoTS = await import('crypto-ts');
      const keyBytes = rootKey.privateKey;  // Uint8Array
      const encryptedBytes = encryptWithPassword(password, keyBytes);
      encryptedPrivateKey = CryptoTS.AES.encrypt(JSON.stringify(encryptedBytes), password).toString();
    } else {
      // Cardano: Use existing encryptPrivateKey function
      encryptedPrivateKey = encryptPrivateKey(rootKey, password);
    }

    const walletData = {
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
      network,
      addressType,  // Version 15+: Address type
      // Explicitly set encryptionMethod for clarity (optional for backward compatibility)
      encryptionMethod: 'password'
    };

    console.log('💾 Adding PASSWORD wallet to database with fields:', {
      encryptionMethod: walletData.encryptionMethod,
      hasEncryptedPrivateKey: !!walletData.encryptedPrivateKey,
      hasEncryptedMnemonic: !!walletData.encryptedMnemonic
    });

    const walletId = await db['wallets'].add(walletData);

    console.log('✅ Password wallet added to database successfully, ID:', walletId);

    await createNewWalletDb(walletId, !!encryptedMnemonic, isRestore);
    return walletId;
  }
}

export async function createNewHardwareWallet(wallet) {
  // Validate xfp format before creating wallet (for Keystone wallets)
  if (wallet.xfp) {
    if (!/^[0-9a-fA-F]{8}$/.test(wallet.xfp)) {
      throw new Error('Invalid xfp format. Expected 8 hexadecimal characters.');
    }
  }

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

export async function createNewGoogleWallet(
  name: string,
  icon: string,
  theme: string,
  password: string,
  chain: string,
  network: string,
  jwt: string
) {
  const db: Dexie = await getDb();
  let order = await getLatestWalletByOrder();
  if (order == null) {
    order = 1;
  } else {
    order++;
  }

  // Extract user ID from JWT
  const parts = jwt.split(".");
  const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  const userId = payload.email;

  // Generate random 96 bytes for BIP32 Ed25519 key
  // BIP32 private key = 64 bytes (private key) + 32 bytes (chain code)
  const randomBytes = new Uint8Array(96);
  crypto.getRandomValues(randomBytes);
  const rootKey: Bip32PrivateKey = Bip32PrivateKey.fromBytes(Buffer.from(randomBytes));

  // Encrypt the root key with password (more secure than zkFold's plaintext storage)
  const encryptedPrivateKey: string = encryptPrivateKey(rootKey, password);

  // Get the public key for account #0
  const accountIndex = 0;
  const bip32Ed25519: Bip32Ed25519 = await SodiumBip32Ed25519.create();
  const xpubHex: Bip32PublicKeyHex = bip32Ed25519.getBip32PublicKey(
    rootKey.derive([
      WalletTypePurpose.CIP1852,
      CoinTypes.CARDANO,
      HARDENED + accountIndex
    ]).hex()
  );

  // NOTE: We DON'T create the wallet database yet!
  // The wallet DB will be created AFTER successful proof generation
  // This prevents creating orphaned databases if proof generation fails
  // await createNewWalletDb(walletId, false);

  return await db['wallets'].add({
    name,
    icon,
    type: WalletType.Google,
    theme,
    order,
    encryptedPrivateKey,
    publicKey: xpubHex,
    passwordLastUpdate: new Date(),
    chain,
    network,
    userId,
    jwt, // Store JWT for proof generation later
  });
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
  const updateData: { encryptedPrivateKey?: string, encryptedMnemonic?: string, passwordLastUpdate: Date } = {
    encryptedPrivateKey,
    passwordLastUpdate: new Date()
  };

  if (encryptedMnemonic !== undefined) {
    updateData.encryptedMnemonic = encryptedMnemonic;
  }

  await db['wallets'].update(walletId, updateData);
}

export async function getGoogleWalletWithEmail(email: string) {
  const db: Dexie = await getDb();
  const wallets = await db['wallets'].where('userId').equals(email).toArray();
  if (wallets && wallets.length > 0) {
    return wallets[0];
  }
  return null;
}

/**
 * Get Google wallet by userId (same as email for Google wallets)
 */
export async function getGoogleWalletByUserId(userId: string) {
  return await getGoogleWalletWithEmail(userId);
}

/**
 * Check if a Google wallet exists for the given email/userId
 */
export async function googleWalletExists(email: string): Promise<boolean> {
  const wallet = await getGoogleWalletWithEmail(email);
  return wallet !== null;
}

/**
 * Get wallet by public key (xpub)
 * @param publicKey - The public key (xpub) to search for
 * @returns The wallet object if found, null otherwise
 */
export async function getWalletByPublicKey(publicKey: string) {
  const db: Dexie = await getDb();
  const wallets = await db['wallets'].where('publicKey').equals(publicKey).toArray();
  if (wallets && wallets.length > 0) {
    return wallets[0];
  }
  return null;
}

/**
 * Derive BIP32 public key (xpub) from mnemonic phrase
 * @param mnemonic - The mnemonic phrase
 * @returns The public key (xpub) in bech32 format
 */
export async function derivePublicKeyFromMnemonic(mnemonic: string): Promise<string> {
  const rootKey: Bip32PrivateKey = resolvePrivateKey(mnemonic);
  const accountIndex = 0;
  const bip32Ed25519: Bip32Ed25519 = await SodiumBip32Ed25519.create();
  const xpubHex: Bip32PublicKeyHex = bip32Ed25519.getBip32PublicKey(
    rootKey.derive([
      WalletTypePurpose.CIP1852,
      CoinTypes.CARDANO,
      HARDENED + accountIndex
    ]).hex()
  );
  let words: number[];
  try {
    words = bech32.toWords(Buffer.from(xpubHex, 'hex'));
  } catch (e) {
    words = bech32m.toWords(Buffer.from(xpubHex, 'hex'));
  }
  return bech32.encode('xpub', words, 120);
}
