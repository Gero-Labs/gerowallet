import { encryptPrivateKey } from '@/chrome/serialization';
import { resolvePrivateKey } from '@/shared/utils/resolver';
import { encrypt } from '@/shared/utils/crypto';
import * as Crypto from '@cardano-sdk/crypto';
import { bech32, bech32m } from 'bech32';
import { HARDENED, CoinTypes, WalletTypePurpose } from '@/models/types';
import Dexie from 'dexie';
import { getDb, getLatestWalletByOrder } from '../gero-db';

export async function generateEncryptedWalletData(mnemonic, password) {
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
    return { encryptedPrivateKey, encryptedMnemonic, publicKey };
}

/**
 * Generate deterministic seed from Google user ID and password
 * This provides consistent key derivation for the same user
 */
export async function generateDeterministicSeed(userId: string, password: string): Promise<string> {
    // Use PBKDF2 to derive a deterministic seed from userId + password
    // This ensures the same user with the same password always gets the same keys
    const encoder = new TextEncoder();
    const saltData = encoder.encode(`gero-wallet-google-${userId}`);
    const passwordData = encoder.encode(password);
    
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        passwordData,
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: saltData,
            iterations: 100000, // Standard security practice
            hash: 'SHA-256'
        },
        keyMaterial,
        256 // 32 bytes for entropy
    );
    
    return Array.from(new Uint8Array(derivedBits))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Generate wallet keys from deterministic seed
 * This creates proper Cardano keys from the deterministic seed
 */
export async function generateWalletKeysFromSeed(seed: string, password: string): Promise<{
    encryptedPrivateKey: string;
    publicKey: string;
}> {
    // Convert hex seed to entropy and generate root key directly
    const entropy = Buffer.from(seed, 'hex');
    
    // Use the Cardano SDK to create proper BIP32 keys from entropy
    // This follows the same pattern as resolvePrivateKey function
    const rootKey: Crypto.Bip32PrivateKey = Crypto.Bip32PrivateKey.fromBip39Entropy(entropy, '');

    // Encrypt the private key with user password
    const encryptedPrivateKey: string = encryptPrivateKey(rootKey, password);
    
    // Generate public key following Cardano standards
    const accountIndex = 0;
    const bip32Ed25519: Crypto.Bip32Ed25519 = await Crypto.SodiumBip32Ed25519.create();
    const xpubHex: Crypto.Bip32PublicKeyHex = bip32Ed25519.getBip32PublicKey(
        rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + accountIndex]).hex()
    );
    
    let words: number[];
    try {
        words = bech32.toWords(Buffer.from(xpubHex, 'hex'));
    } catch (e) {
        words = bech32m.toWords(Buffer.from(xpubHex, 'hex'));
    }
    const publicKey = bech32.encode('xpub', words, 120);
    
    return { encryptedPrivateKey, publicKey };
}

export async function addNewGeroWallet({
    name,
    icon,
    type,
    theme,
    encryptedPrivateKey,
    encryptedMnemonic,
    publicKey,
    passwordLastUpdate,
    chain,
    network
}: {
    name: string;
    icon: string;
    type: string;
    theme: string;
    encryptedPrivateKey: string;
    encryptedMnemonic: string;
    publicKey: string;
    passwordLastUpdate: Date;
    chain: string;
    network: string;
}) {
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
        type,
        theme,
        order,
        encryptedPrivateKey,
        encryptedMnemonic,
        publicKey,
        passwordLastUpdate,
        chain,
        network
    });

    return walletId;
}