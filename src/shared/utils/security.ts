import * as OTPAuth from 'otpauth';
import { encrypt, decrypt } from '@/shared/utils/crypto';
import cryptoRandomString from 'crypto-random-string';
import { Buffer } from 'buffer';
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha512 } from '@noble/hashes/sha2';

// Constants
export const APP_NAME = 'Gero Dashboard';
export const WEBAUTHN_RELYING_PARTY_NAME = APP_NAME;
export const TOTP_DEFAULT_ISSUER = APP_NAME;

export type UnlockMethod = 'password' | 'pin' | 'pattern' | 'biometrics' | null;

export interface SecurityConfig {
  unlockMethod: UnlockMethod;
  encryptedPinHash?: string;
  encryptedPatternHash?: string;
  webAuthnCredentialId?: string;

  // 2FA
  twoFactorEnabled: boolean;
  encryptedTotpSecret?: string;
  encryptedBackupCodes?: string[];

  // Auto-lock
  autoLockMinutes: number;
  lastActivityTimestamp?: number;
}

/**
 * Hash a PIN code for secure storage using PBKDF2 with salt
 * Protection against rainbow table attacks by using random salt and key derivation
 * @param pin - PIN code (4-6 digits)
 * @returns Hashed PIN in format "salt:hash" (both hex-encoded)
 */
export async function hashPin(pin: string): Promise<string> {
  // Generate random 32-byte salt
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);

  // Derive key using PBKDF2-HMAC-SHA512
  // 100,000 iterations for strong protection against brute force
  // Even with only 10,000-1,000,000 PIN combinations, the time cost makes attacks impractical
  const hash = pbkdf2(sha512, Buffer.from(pin, 'utf8'), salt, {
    c: 100000, // 100,000 iterations (balance between security and UX)
    dkLen: 32  // 256-bit output
  });

  // Return format: salt:hash (hex-encoded)
  return `${Buffer.from(salt).toString('hex')}:${Buffer.from(hash).toString('hex')}`;
}

/**
 * Verify a PIN code against a salted hash
 * @param pin - PIN code to verify
 * @param hashedPin - Previously hashed PIN in format "salt:hash"
 * @returns True if PIN matches
 */
export async function verifyPin(pin: string, hashedPin: string): Promise<boolean> {
  try {
    // Extract salt and hash from stored value
    const [saltHex, expectedHashHex] = hashedPin.split(':');
    if (!saltHex || !expectedHashHex) {
      console.error('Invalid hashed PIN format');
      return false;
    }

    const salt = Buffer.from(saltHex, 'hex');
    const expectedHash = Buffer.from(expectedHashHex, 'hex');

    // Re-derive hash with same salt and iterations
    const actualHash = pbkdf2(sha512, Buffer.from(pin, 'utf8'), salt, {
      c: 100000,
      dkLen: 32
    });

    // Constant-time comparison to prevent timing attacks
    if (actualHash.length !== expectedHash.length) return false;

    let result = 0;
    for (let i = 0; i < actualHash.length; i++) {
      result |= actualHash[i] ^ expectedHash[i];
    }

    return result === 0;
  } catch (error) {
    console.error('PIN verification failed:', error);
    return false;
  }
}

/**
 * Hash a pattern (array of numbers representing dot positions) using PBKDF2 with salt
 * @param pattern - Pattern as array of numbers (e.g., [0, 1, 2, 5, 8])
 * @returns Hashed pattern in format "salt:hash" (both hex-encoded)
 */
export async function hashPattern(pattern: number[]): Promise<string> {
  const patternString = pattern.join('-');
  return await hashPin(patternString);
}

/**
 * Verify a pattern against a salted hash
 * @param pattern - Pattern to verify
 * @param hashedPattern - Previously hashed pattern in format "salt:hash"
 * @returns True if pattern matches
 */
export async function verifyPattern(pattern: number[], hashedPattern: string): Promise<boolean> {
  const patternString = pattern.join('-');
  return await verifyPin(patternString, hashedPattern);
}

/**
 * Generate a new TOTP secret
 * @returns Base32-encoded secret
 */
export function generateTotpSecret(): string {
  // Use OTPAuth's Secret class to generate a proper base32-encoded secret
  // 20 bytes = 160 bits (standard TOTP secret size)
  const secret = new OTPAuth.Secret({ size: 20 });
  return secret.base32;
}

/**
 * Create a TOTP instance with a secret
 * @param secret - Base32-encoded secret
 * @param issuer - Issuer name (default: from TOTP_DEFAULT_ISSUER constant)
 * @param label - Account label (wallet name)
 * @returns OTPAuth.TOTP instance
 */
export function createTotp(secret: string, issuer: string = TOTP_DEFAULT_ISSUER, label: string = 'Wallet'): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret)
  });
}

/**
 * Generate a TOTP code from a secret
 * @param secret - Base32-encoded secret
 * @returns 6-digit TOTP code
 */
export function generateTotpCode(secret: string): string {
  const totp = createTotp(secret);
  return totp.generate();
}

/**
 * Verify a TOTP code against a secret
 * @param code - 6-digit code to verify
 * @param secret - Base32-encoded secret
 * @param window - Time window for validation (default: 1 = ±30 seconds)
 * @returns True if code is valid
 */
export function verifyTotpCode(code: string, secret: string, window: number = 1): boolean {
  try {
    const totp = createTotp(secret);
    const delta = totp.validate({ token: code, window });
    return delta !== null;
  } catch (error) {
    console.error('TOTP verification error:', error);
    return false;
  }
}

/**
 * Generate a QR code-compatible otpauth:// URL
 * @param secret - Base32-encoded secret
 * @param issuer - Issuer name (default: from TOTP_DEFAULT_ISSUER constant)
 * @param label - Account label (wallet name)
 * @returns otpauth:// URL for QR code generation
 */
export function generateTotpUrl(secret: string, issuer: string = TOTP_DEFAULT_ISSUER, label: string = 'Wallet'): string {
  const totp = createTotp(secret, issuer, label);
  return totp.toString();
}

/**
 * Generate backup codes for 2FA recovery
 * @param count - Number of backup codes to generate (default: 8)
 * @returns Array of backup codes
 */
export function generateBackupCodes(count: number = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric code
    const code = cryptoRandomString({ length: 8, type: 'alphanumeric' }).toUpperCase();
    // Format as XXXX-XXXX for readability
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

/**
 * Encrypt security data with spending password
 * @param data - Data to encrypt (PIN hash, TOTP secret, backup codes)
 * @param password - Spending password
 * @returns Encrypted data
 */
export function encryptSecurityData(data: string | string[], password: string): string | string[] {
  if (Array.isArray(data)) {
    return data.map(item => encrypt(item, password));
  }
  return encrypt(data, password);
}

/**
 * Decrypt security data with spending password
 * @param encryptedData - Encrypted data
 * @param password - Spending password
 * @returns Decrypted data
 */
export function decryptSecurityData(encryptedData: string | string[], password: string): string | string[] {
  if (Array.isArray(encryptedData)) {
    return encryptedData.map(item => decrypt(item, password));
  }
  return decrypt(encryptedData, password);
}

/**
 * Validate PIN format (4-6 digits)
 * @param pin - PIN to validate
 * @returns True if valid PIN format
 */
export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

/**
 * Validate pattern (array of 4-16 unique numbers between 0-15 for 4x4 grid)
 * @param pattern - Pattern to validate
 * @returns True if valid pattern
 */
export function isValidPattern(pattern: number[]): boolean {
  if (pattern.length < 4 || pattern.length > 16) return false;
  if (pattern.some(num => num < 0 || num > 15)) return false;
  const uniqueNumbers = new Set(pattern);
  return uniqueNumbers.size === pattern.length;
}

/**
 * Validate TOTP code format (6 digits)
 * @param code - Code to validate
 * @returns True if valid TOTP code format
 */
export function isValidTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/**
 * Check if WebAuthn is supported in the current browser
 * @returns True if WebAuthn is supported
 */
export function isWebAuthnSupported(): boolean {
  return !!window.PublicKeyCredential;
}

/**
 * Register a new WebAuthn credential for biometric authentication
 * @param walletId - Wallet ID to use as credential ID
 * @param walletName - Wallet name for display
 * @returns Credential ID (base64-encoded)
 */
export async function registerWebAuthnCredential(walletId: string, walletName: string): Promise<string> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  try {
    // Generate a random challenge
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    // Create credential options
    const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
      challenge,
      rp: {
        name: WEBAUTHN_RELYING_PARTY_NAME,
        id: window.location.hostname
      },
      user: {
        id: new TextEncoder().encode(walletId),
        name: walletName,
        displayName: walletName
      },
      pubKeyCredParams: [
        {
          type: 'public-key',
          alg: -7 // ES256 (ECDSA with SHA-256)
        },
        {
          type: 'public-key',
          alg: -257 // RS256 (RSASSA-PKCS1-v1_5 with SHA-256)
        }
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // Platform authenticator (built-in biometrics)
        userVerification: 'required',
        requireResidentKey: false
      },
      timeout: 60000,
      attestation: 'none'
    };

    // Create the credential
    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions
    }) as PublicKeyCredential;

    if (!credential) {
      throw new Error('Failed to create credential');
    }

    // Return the credential ID as base64
    const credentialId = arrayBufferToBase64(credential.rawId);
    return credentialId;
  } catch (error) {
    console.error('WebAuthn registration error:', error);

    // User cancelled the biometric prompt
    if ((error as Error).name === 'NotAllowedError') {
      throw new Error('Biometric registration was cancelled');
    }

    // Other errors
    throw new Error(`Biometric registration failed: ${(error as Error).message}`);
  }
}

/**
 * Authenticate using a WebAuthn credential
 * @param credentialId - Base64-encoded credential ID
 * @returns True if authentication successful
 */
export async function authenticateWebAuthn(credentialId: string): Promise<boolean> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  try {
    // Generate a random challenge
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    // Create credential request options
    const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
      challenge,
      allowCredentials: [
        {
          id: base64ToArrayBuffer(credentialId),
          type: 'public-key',
          transports: ['internal']
        }
      ],
      timeout: 60000,
      userVerification: 'required',
      rpId: window.location.hostname
    };

    // Get the credential (authenticate)
    const assertion = await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions
    }) as PublicKeyCredential;

    if (!assertion) {
      throw new Error('Authentication failed');
    }

    // If we got this far, authentication was successful
    return true;
  } catch (error) {
    console.error('WebAuthn authentication error:', error);

    // User cancelled or authentication failed
    if ((error as Error).name === 'NotAllowedError') {
      return false;
    }

    throw new Error(`Biometric authentication failed: ${(error as Error).message}`);
  }
}

/**
 * Convert ArrayBuffer to base64 string
 * @param buffer - ArrayBuffer to convert
 * @returns Base64-encoded string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer
 * @param base64 - Base64-encoded string
 * @returns ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Get or generate the device-specific biometric master key
 * This is a device-wide master key that is used to derive per-wallet keys
 * @returns 32-byte master key as hex string
 */
async function getDeviceBiometricMasterKey(): Promise<string> {
  const STORAGE_KEY = 'biometric_device_master_key';

  // Try to retrieve existing master key
  const result = await chrome.storage.local.get(STORAGE_KEY);

  if (result[STORAGE_KEY]) {
    return result[STORAGE_KEY];
  }

  // Generate new master key (32 bytes = 256 bits)
  const masterKeyBytes = new Uint8Array(32);
  crypto.getRandomValues(masterKeyBytes);
  const masterKey = Buffer.from(masterKeyBytes).toString('hex');

  // Store for future use
  await chrome.storage.local.set({ [STORAGE_KEY]: masterKey });

  console.log('🔐 Generated new device biometric master key');
  return masterKey;
}

/**
 * Derive a wallet-specific biometric key from the device master key
 * This ensures that if one wallet's key is compromised, others remain secure
 * @param walletId - Wallet ID to derive key for
 * @returns 32-byte wallet-specific key as Buffer
 */
async function deriveWalletBiometricKey(walletId: string): Promise<Buffer> {
  const deviceMasterKey = await getDeviceBiometricMasterKey();
  const deviceMasterKeyBytes = Buffer.from(deviceMasterKey, 'hex');

  // Derive wallet-specific key using PBKDF2-HMAC-SHA512
  // Input: deviceMasterKey + walletId
  // This binds the key to both the device and the specific wallet
  const walletKey = pbkdf2(
    sha512,
    deviceMasterKeyBytes,
    Buffer.from(`wallet:${walletId}`, 'utf8'), // Use walletId as salt with prefix
    {
      c: 100000, // 100,000 iterations (matches PIN hashing security level)
      dkLen: 32 // 256-bit key
    }
  );

  return Buffer.from(walletKey);
}

/**
 * Store unlock credential encrypted for biometric autofill
 * Uses PBKDF2 + ChaCha20-Poly1305 for secure encryption with device-specific master key
 * @param credential - PIN (string) or pattern (number[]) or password (string)
 * @param credentialType - Type of credential ('pin', 'pattern', 'password')
 * @param walletId - Wallet ID for key derivation (binds credential to wallet)
 * @returns Encrypted credential as hex string (format: salt + nonce + tag + ciphertext)
 */
export async function encryptCredentialForBiometric(
  credential: string | number[],
  credentialType: 'pin' | 'pattern' | 'password',
  walletId: string
): Promise<string> {
  // Convert credential to string for encryption
  const credentialString = Array.isArray(credential) ? JSON.stringify(credential) : credential;
  const credentialBytes = Buffer.from(credentialString, 'utf8');

  // Get wallet-specific key derived from device master key
  const walletKey = await deriveWalletBiometricKey(walletId);

  // Generate random salt (32 bytes) and nonce (12 bytes for ChaCha20)
  const salt = new Uint8Array(32);
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(nonce);

  // Derive encryption key using PBKDF2-HMAC-SHA512
  // Input: walletKey + credentialType (binds to device + wallet + credential type)
  const keyMaterial = Buffer.concat([
    walletKey,
    Buffer.from(credentialType, 'utf8')
  ]);

  const derivedKey = pbkdf2(sha512, keyMaterial, salt, {
    c: 100000, // 100,000 iterations (matches PIN hashing security level)
    dkLen: 32 // ChaCha20 key length
  });

  // Encrypt using ChaCha20-Poly1305 AEAD
  const cipher = chacha20poly1305(derivedKey, nonce);
  const encrypted = cipher.encrypt(credentialBytes);

  // ChaCha20-Poly1305 returns: ciphertext + tag (tag is last 16 bytes)
  const encryptedBytes = Buffer.from(encrypted);
  const ciphertext = encryptedBytes.subarray(0, encryptedBytes.length - 16);
  const tag = encryptedBytes.subarray(encryptedBytes.length - 16);

  // Format: salt(32B) + nonce(12B) + tag(16B) + ciphertext
  const result = Buffer.concat([salt, nonce, tag, ciphertext]);
  return result.toString('hex');
}

/**
 * Decrypt unlock credential for biometric autofill
 * Uses PBKDF2 + ChaCha20-Poly1305 for secure decryption with device-specific master key
 * @param encryptedCredential - Encrypted credential as hex string
 * @param credentialType - Type of credential ('pin', 'pattern', 'password')
 * @param walletId - Wallet ID for key derivation (must match encryption)
 * @returns Decrypted credential (string for PIN/password, number[] for pattern)
 */
export async function decryptCredentialForBiometric(
  encryptedCredential: string,
  credentialType: 'pin' | 'pattern' | 'password',
  walletId: string
): Promise<string | number[]> {
  try {
    const encryptedBytes = Buffer.from(encryptedCredential, 'hex');

    // Extract components: salt(32B) + nonce(12B) + tag(16B) + ciphertext
    const salt = encryptedBytes.subarray(0, 32);
    const nonce = encryptedBytes.subarray(32, 44);
    const tag = encryptedBytes.subarray(44, 60);
    const ciphertext = encryptedBytes.subarray(60);

    // Get wallet-specific key derived from device master key
    const walletKey = await deriveWalletBiometricKey(walletId);

    // Derive decryption key using same inputs as encryption
    const keyMaterial = Buffer.concat([
      walletKey,
      Buffer.from(credentialType, 'utf8')
    ]);

    const derivedKey = pbkdf2(sha512, keyMaterial, salt, {
      c: 100000, // 100,000 iterations (must match encryption)
      dkLen: 32
    });

    // ChaCha20-Poly1305 expects: ciphertext + tag (tag at the end)
    const combined = Buffer.concat([ciphertext, tag]);

    // Decrypt using ChaCha20-Poly1305
    const cipher = chacha20poly1305(derivedKey, nonce);
    const decrypted = cipher.decrypt(combined);

    const decryptedString = Buffer.from(decrypted).toString('utf8');

    // Parse pattern back to number array if needed
    if (credentialType === 'pattern') {
      return JSON.parse(decryptedString) as number[];
    }

    return decryptedString;
  } catch (error) {
    console.error('Biometric credential decryption failed:', error);
    throw new Error('Failed to decrypt biometric credential');
  }
}

/**
 * Encrypt spending password for biometric autofill
 * Uses PBKDF2 + ChaCha20-Poly1305 with device-specific master key and WebAuthn credential ID
 * @param password - Spending password to encrypt
 * @param credentialId - WebAuthn credential ID (base64) for binding to biometric credential
 * @param walletId - Wallet ID for key derivation (binds password to wallet)
 * @returns Encrypted password as hex string (format: salt + nonce + tag + ciphertext)
 */
export async function encryptSpendingPasswordForBiometric(
  password: string,
  credentialId: string,
  walletId: string
): Promise<string> {
  const passwordBytes = Buffer.from(password, 'utf8');

  // Get wallet-specific key derived from device master key
  const walletKey = await deriveWalletBiometricKey(walletId);

  // Generate random salt (32 bytes) and nonce (12 bytes for ChaCha20)
  const salt = new Uint8Array(32);
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(nonce);

  // Derive encryption key using PBKDF2-HMAC-SHA512
  // Input: walletKey + credentialId (binds to device + wallet + biometric credential)
  const keyMaterial = Buffer.concat([
    walletKey,
    Buffer.from(credentialId, 'utf8')
  ]);

  const derivedKey = pbkdf2(sha512, keyMaterial, salt, {
    c: 100000, // 100,000 iterations (matches PIN hashing security level)
    dkLen: 32 // ChaCha20 key length
  });

  // Encrypt using ChaCha20-Poly1305 AEAD
  const cipher = chacha20poly1305(derivedKey, nonce);
  const encrypted = cipher.encrypt(passwordBytes);

  // ChaCha20-Poly1305 returns: ciphertext + tag (tag is last 16 bytes)
  const encryptedBytes = Buffer.from(encrypted);
  const ciphertext = encryptedBytes.subarray(0, encryptedBytes.length - 16);
  const tag = encryptedBytes.subarray(encryptedBytes.length - 16);

  // Format: salt(32B) + nonce(12B) + tag(16B) + ciphertext
  const result = Buffer.concat([salt, nonce, tag, ciphertext]);
  return result.toString('hex');
}

/**
 * Decrypt spending password for biometric autofill
 * Uses PBKDF2 + ChaCha20-Poly1305 with device-specific master key and WebAuthn credential ID
 * @param encryptedPassword - Encrypted password as hex string
 * @param credentialId - WebAuthn credential ID (base64) for binding to biometric credential
 * @param walletId - Wallet ID for key derivation (must match encryption)
 * @returns Decrypted spending password
 */
export async function decryptSpendingPasswordForBiometric(
  encryptedPassword: string,
  credentialId: string,
  walletId: string
): Promise<string> {
  try {
    const encryptedBytes = Buffer.from(encryptedPassword, 'hex');

    // Extract components: salt(32B) + nonce(12B) + tag(16B) + ciphertext
    const salt = encryptedBytes.subarray(0, 32);
    const nonce = encryptedBytes.subarray(32, 44);
    const tag = encryptedBytes.subarray(44, 60);
    const ciphertext = encryptedBytes.subarray(60);

    // Get wallet-specific key derived from device master key
    const walletKey = await deriveWalletBiometricKey(walletId);

    // Derive decryption key using same inputs as encryption
    const keyMaterial = Buffer.concat([
      walletKey,
      Buffer.from(credentialId, 'utf8')
    ]);

    const derivedKey = pbkdf2(sha512, keyMaterial, salt, {
      c: 100000, // 100,000 iterations (must match encryption)
      dkLen: 32
    });

    // ChaCha20-Poly1305 expects: ciphertext + tag (tag at the end)
    const combined = Buffer.concat([ciphertext, tag]);

    // Decrypt using ChaCha20-Poly1305
    const cipher = chacha20poly1305(derivedKey, nonce);
    const decrypted = cipher.decrypt(combined);

    return Buffer.from(decrypted).toString('utf8');
  } catch (error) {
    console.error('Biometric spending password decryption failed:', error);
    throw new Error('Failed to decrypt biometric spending password');
  }
}