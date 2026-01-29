import * as OTPAuth from 'otpauth';
import { decrypt, encrypt } from '@/shared/utils/crypto';
import cryptoRandomString from 'crypto-random-string';
import { Buffer } from 'buffer';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha512 } from '@noble/hashes/sha2';
import { debugLog } from '@/utils/debug';

// Constants
export const APP_NAME = 'Gero Dashboard';
export const WEBAUTHN_RELYING_PARTY_NAME = APP_NAME;
export const TOTP_DEFAULT_ISSUER = APP_NAME;

// Cryptographic constants
/** Number of PBKDF2 iterations for key derivation (OWASP 2023 recommendation for PBKDF2-HMAC-SHA512) */
export const PBKDF2_ITERATIONS = 310000;
/** Salt size in bytes (256-bit) */
export const SALT_SIZE = 32;
/** Nonce size in bytes for ChaCha20 (96-bit) */
export const NONCE_SIZE = 12;
/** Authentication tag size in bytes for ChaCha20-Poly1305 (128-bit) */
export const TAG_SIZE = 16;
/** Derived key length in bytes for ChaCha20 (256-bit) */
export const KEY_SIZE = 32;
/** TOTP secret size in bytes (160-bit, standard) */
export const TOTP_SECRET_SIZE = 20;
/** TOTP code digit length */
export const TOTP_DIGITS = 6;
/** TOTP time period in seconds */
export const TOTP_PERIOD = 30;
/** Number of backup codes to generate */
export const BACKUP_CODES_COUNT = 8;
/** Length of each backup code */
export const BACKUP_CODE_LENGTH = 8;

export type UnlockMethod = 'password' | 'pin' | 'pattern' | null;

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
  // Generate random salt
  const salt = new Uint8Array(SALT_SIZE);
  crypto.getRandomValues(salt);

  // Derive key using PBKDF2-HMAC-SHA512
  // High iterations for strong protection against brute force
  // Even with only 10,000-1,000,000 PIN combinations, the time cost makes attacks impractical
  const hash = pbkdf2(sha512, Buffer.from(pin, 'utf8'), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: KEY_SIZE
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
      c: PBKDF2_ITERATIONS,
      dkLen: KEY_SIZE
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
  const secret = new OTPAuth.Secret({ size: TOTP_SECRET_SIZE });
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
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
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
export function generateBackupCodes(count: number = BACKUP_CODES_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // Generate alphanumeric code
    const code = cryptoRandomString({ length: BACKUP_CODE_LENGTH, type: 'alphanumeric' }).toUpperCase();
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
 * Register a new WebAuthn credential for passkey authentication with PRF support
 * @param walletId - Wallet ID to use as credential ID
 * @param walletName - Wallet name for display
 * @returns Object with credential ID and PRF enabled status
 */
export async function registerWebAuthnCredential(
  walletId: string,
  walletName: string
): Promise<{ credentialId: string; prfEnabled: boolean }> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  try {
    // Generate a random challenge
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    // Create credential options with PRF extension
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
        authenticatorAttachment: 'platform', // Platform authenticator (Chrome passkey)
        userVerification: 'required',
        requireResidentKey: false
      },
      timeout: 60000,
      attestation: 'none',
      // Enable PRF extension for secure password encryption
      extensions: {
        prf: {} // Request PRF support during registration
      }
    };

    // Create the credential
    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions
    }) as PublicKeyCredential;

    if (!credential) {
      throw new Error('Failed to create credential');
    }

    // Check if PRF was enabled by the authenticator
    const extensionResults = credential.getClientExtensionResults();
    const prfResults = extensionResults?.prf;
    const prfEnabled = prfResults?.enabled === true;

    debugLog('[WebAuthn] Registration extension results:', {
      hasExtensions: !!extensionResults,
      hasPrf: !!prfResults,
      prfEnabled: prfResults?.enabled,
      fullPrfResults: prfResults,
      allExtensions: extensionResults
    });

    debugLog('[WebAuthn] Credential registered with PRF:', prfEnabled ? '✅ Enabled' : '❌ Not supported');

    // Return credential ID and PRF status
    return {
      credentialId: arrayBufferToBase64(credential.rawId),
      prfEnabled
    };
  } catch (error) {
    console.error('WebAuthn registration error:', error);

    // User cancelled the passkey prompt
    if ((error as Error).name === 'NotAllowedError') {
      throw new Error('PassKey registration was cancelled');
    }

    // Other errors
    throw new Error(`PassKey registration failed: ${(error as Error).message}`);
  }
}

/**
 * Authenticate using a WebAuthn credential
 * @param credentialId - Base64-encoded credential ID
 * @returns True if authentication successful
 */
export async function authenticateWebAuthn(credentialId: string, timeoutMs: number = 60000): Promise<boolean> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  // Create AbortController for timeout management
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    debugLog('[WebAuthn] Starting authentication...');
    debugLog('[WebAuthn] Credential ID:', credentialId);

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
      timeout: timeoutMs,
      userVerification: 'required',
      rpId: window.location.hostname
    };

    // Get the credential (authenticate) with AbortSignal
    const assertion = await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions,
      signal: abortController.signal
    }) as PublicKeyCredential;

    if (!assertion) {
      throw new Error('Authentication failed');
    }

    debugLog('[WebAuthn] ✅ Authentication successful');
    return true;
  } catch (error) {
    // User cancelled or authentication failed
    if ((error as Error).name === 'NotAllowedError' || (error as Error).name === 'AbortError') {
      debugLog('[WebAuthn] User cancelled or timeout reached');
      return false;
    }

    console.error('[WebAuthn] Authentication error:', error);
    throw new Error(`PassKey authentication failed: ${(error as Error).message}`);
  } finally {
    // Clear timeout to prevent memory leaks
    clearTimeout(timeoutId);
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
 * LEGACY ENCRYPTION FUNCTIONS REMOVED
 *
 * The following functions have been removed in favor of WebAuthn PRF extension:
 * - getDevicePassKeyMasterKey() - No longer needed (PRF derives keys from authenticator)
 * - deriveWalletPassKeyKey() - Replaced by PRF-based key derivation
 * - encryptSpendingPasswordForPassKey() - Replaced by encryptSpendingPasswordWithPrf()
 * - decryptSpendingPasswordForPassKey() - Replaced by decryptSpendingPasswordWithPrf()
 *
 * New PRF-based functions are located in: src/shared/utils/webauthn-prf.ts
 *
 * Migration: Users with existing passkeys must delete and re-register to use PRF encryption.
 */

/**
 * Remove legacy passkey master key from localStorage
 *
 * This function cleans up the insecure device master key that was previously
 * stored in localStorage. Should be called during app initialization to ensure
 * the legacy key is removed after migration to PRF.
 */
export async function removeLegacyPassKeyMasterKey(): Promise<void> {
  const LEGACY_KEY = 'passkey_device_master_key';

  try {
    // Check if legacy key exists
    const result = await chrome.storage.local.get(LEGACY_KEY);

    if (result[LEGACY_KEY]) {
      // Remove from localStorage
      await chrome.storage.local.remove(LEGACY_KEY);
      debugLog('🗑️ Removed legacy passkey master key from localStorage');
    }
  } catch (error) {
    console.error('Error removing legacy passkey master key:', error);
  }
}
