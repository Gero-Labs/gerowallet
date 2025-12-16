import * as OTPAuth from 'otpauth';
import { encrypt, decrypt } from '@/shared/utils/crypto';
import cryptoRandomString from 'crypto-random-string';

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
 * Hash a PIN code using SHA-256
 * @param pin - PIN code (4-6 digits)
 * @returns Hashed PIN
 */
export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify a PIN code against a hash
 * @param pin - PIN code to verify
 * @param hashedPin - Previously hashed PIN
 * @returns True if PIN matches
 */
export async function verifyPin(pin: string, hashedPin: string): Promise<boolean> {
  const newHash = await hashPin(pin);
  return newHash === hashedPin;
}

/**
 * Hash a pattern (array of numbers representing dot positions)
 * @param pattern - Pattern as array of numbers (e.g., [0, 1, 2, 5, 8])
 * @returns Hashed pattern
 */
export async function hashPattern(pattern: number[]): Promise<string> {
  const patternString = pattern.join('-');
  return await hashPin(patternString);
}

/**
 * Verify a pattern against a hash
 * @param pattern - Pattern to verify
 * @param hashedPattern - Previously hashed pattern
 * @returns True if pattern matches
 */
export async function verifyPattern(pattern: number[], hashedPattern: string): Promise<boolean> {
  const newHash = await hashPattern(pattern);
  return newHash === hashedPattern;
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
 * @param issuer - Issuer name (default: 'Gero Wallet')
 * @param label - Account label (wallet name)
 * @returns OTPAuth.TOTP instance
 */
export function createTotp(secret: string, issuer: string = 'Gero Wallet', label: string = 'Wallet'): OTPAuth.TOTP {
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
 * @param issuer - Issuer name (default: 'Gero Wallet')
 * @param label - Account label (wallet name)
 * @returns otpauth:// URL for QR code generation
 */
export function generateTotpUrl(secret: string, issuer: string = 'Gero Wallet', label: string = 'Wallet'): string {
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
        name: 'Gero Wallet',
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
 * Store unlock credential encrypted for biometric autofill
 * @param credential - PIN (string) or pattern (number[]) or password (string)
 * @param credentialType - Type of credential ('pin', 'pattern', 'password')
 * @returns Encrypted credential as base64 string
 */
export async function encryptCredentialForBiometric(credential: string | number[], credentialType: 'pin' | 'pattern' | 'password'): Promise<string> {
  // Convert credential to string for encryption
  const credentialString = Array.isArray(credential) ? JSON.stringify(credential) : credential;

  // Use the encrypt function from crypto.ts (AES-256)
  const encryptedCredential = encrypt(credentialString, `biometric-${credentialType}`);

  return encryptedCredential;
}

/**
 * Decrypt unlock credential for biometric autofill
 * @param encryptedCredential - Encrypted credential as base64 string
 * @param credentialType - Type of credential ('pin', 'pattern', 'password')
 * @returns Decrypted credential (string for PIN/password, number[] for pattern)
 */
export function decryptCredentialForBiometric(encryptedCredential: string, credentialType: 'pin' | 'pattern' | 'password'): string | number[] {
  // Decrypt the credential
  const decryptedString = decrypt(encryptedCredential, `biometric-${credentialType}`);

  // Parse pattern back to number array if needed
  if (credentialType === 'pattern') {
    return JSON.parse(decryptedString) as number[];
  }

  return decryptedString;
}

/**
 * Encrypt spending password for biometric autofill
 * Uses device-specific key derived from WebAuthn credential ID
 * @param password - Spending password to encrypt
 * @param credentialId - WebAuthn credential ID (base64)
 * @returns Encrypted password as base64 string
 */
export function encryptSpendingPasswordForBiometric(password: string, credentialId: string): string {
  // Use credential ID as part of the encryption key for device binding
  // This provides defense in depth - encrypted data is tied to the WebAuthn credential
  const encryptionKey = `biometric-spending-${credentialId}`;

  // Encrypt password using AES-256 from crypto.ts
  const encryptedPassword = encrypt(password, encryptionKey);

  return encryptedPassword;
}

/**
 * Decrypt spending password for biometric autofill
 * @param encryptedPassword - Encrypted password as base64 string
 * @param credentialId - WebAuthn credential ID (base64)
 * @returns Decrypted spending password
 */
export function decryptSpendingPasswordForBiometric(encryptedPassword: string, credentialId: string): string {
  // Use same key derivation as encryption
  const encryptionKey = `biometric-spending-${credentialId}`;

  // Decrypt password
  const decryptedPassword = decrypt(encryptedPassword, encryptionKey);

  return decryptedPassword;
}