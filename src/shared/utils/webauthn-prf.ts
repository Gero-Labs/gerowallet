import { Buffer } from 'buffer';
import { debugLog, debugWarn } from '@/utils/debug';
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/shared/utils/security';

/**
 * TypeScript interfaces for WebAuthn PRF extension results
 */
interface PrfValues {
  first?: BufferSource;
  second?: BufferSource;
}

export interface PrfExtensionResults {
  enabled?: boolean;
  results?: PrfValues;
}

/**
 * WebAuthn PRF (Pseudo-Random Function) Extension Utilities
 *
 * This module provides secure passkey-based password encryption using the WebAuthn PRF extension.
 * PRF allows deriving cryptographic secrets directly from authenticator hardware (TPM, Secure Enclave),
 * eliminating the need to store a master key in localStorage.
 *
 * Security Properties:
 * - No stored master key (PRF output derived on-demand from authenticator)
 * - Hardware-bound (PRF secret lives in authenticator, cannot be extracted)
 * - Credential-bound (each passkey has unique PRF secret)
 * - Non-extractable keys (WebCrypto CryptoKey objects with extractable=false)
 *
 * Browser Support (2026):
 * ✅ Chrome/Edge (Windows, macOS, Linux, Android)
 * ✅ Firefox (Linux with authenticator-rs)
 * ⚠️ Firefox (Windows, macOS) - Partial support
 * ❌ Safari (macOS, iOS) - Not supported yet
 *
 * References:
 * - https://github.com/w3c/webauthn/wiki/Explainer:-PRF-extension
 * - https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/
 */

/**
 * Check if WebAuthn PRF extension is supported by the browser
 *
 * Uses PublicKeyCredential.getClientCapabilities() API (Chrome 128+)
 * Falls back to assuming unsupported for older browsers
 *
 * @returns Promise<boolean> - true if PRF extension is supported
 */
export async function isPrfSupported(): Promise<boolean> {
  // Check if WebAuthn is available
  if (!window.PublicKeyCredential) {
    debugWarn('[PRF] WebAuthn not supported in this browser');
    return false;
  }

  // Check if getClientCapabilities is available (Chrome 128+, Firefox 134+)
  if (typeof PublicKeyCredential.getClientCapabilities === 'function') {
    try {
      const caps = await PublicKeyCredential.getClientCapabilities();
      // Note: Property name is 'extension:prf', not 'prf'
      const supported = caps['extension:prf'] === true;

      if (supported) {
        debugLog('[PRF] ✅ PRF extension supported by browser');
      } else {
        debugWarn('[PRF] ❌ PRF extension not supported by browser');
      }

      return supported;
    } catch (error) {
      console.error('[PRF] Error checking capabilities:', error);
      return false;
    }
  }

  // Fallback for older browsers without getClientCapabilities
  debugWarn('[PRF] getClientCapabilities not available, assuming PRF unsupported');
  return false;
}

/**
 * Check if a specific WebAuthn credential has PRF enabled
 *
 * Attempts a dummy authentication with PRF extension to verify support.
 * This is necessary because not all authenticators support PRF (e.g., Windows Hello pre-2024).
 *
 * @param credentialId - Base64-encoded credential ID
 * @returns Promise<boolean> - true if credential supports PRF
 */
export async function isCredentialPrfEnabled(credentialId: string): Promise<boolean> {
  try {
    debugLog('[PRF] Checking if credential has PRF enabled:', credentialId.substring(0, 16) + '...');

    // Generate random challenge
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    // Attempt authentication with PRF extension
    // Note: Don't restrict transports or rpId - let browser use same context as registration
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          id: base64ToArrayBuffer(credentialId),
          type: 'public-key'
          // Omit transports - let browser decide
        }],
        timeout: 60000,
        userVerification: 'required',
        // Omit rpId - defaults to current domain (same as registration)
        extensions: {
          prf: {
            eval: {
              first: new TextEncoder().encode('test-prf-support')
            }
          }
        }
      }
    }) as PublicKeyCredential;

    debugLog('[PRF] Authentication succeeded, checking extension results...');

    // Check PRF extension results with type safety
    const extensionResults = assertion.getClientExtensionResults();
    const prfResults = extensionResults?.prf as PrfExtensionResults | undefined;

    // Debug logging to understand what we're getting back
    debugLog('[PRF] Extension results:', {
      hasExtensions: !!extensionResults,
      hasPrf: !!prfResults,
      prfEnabled: prfResults?.enabled,
      hasResults: !!prfResults?.results,
      hasFirst: !!prfResults?.results?.first,
      fullPrfResults: prfResults
    });

    // During authentication, the 'enabled' field may be undefined
    // The presence of results.first proves PRF is working
    const prfEnabled = !!prfResults?.results?.first;

    if (prfEnabled) {
      debugLog('[PRF] ✅ Credential has PRF enabled');
    } else {
      debugWarn('[PRF] ❌ Credential does not have PRF enabled');
      debugWarn('[PRF] Debug: enabled =', prfResults?.enabled, ', has results.first =', !!prfResults?.results?.first);
    }

    return prfEnabled;
  } catch (error) {
    // User cancelled or credential doesn't exist
    if ((error as Error).name === 'NotAllowedError' || (error as Error).name === 'AbortError') {
      debugLog('[PRF] User cancelled PRF check');
      return false;
    }

    console.error('[PRF] Credential PRF check failed:', error);
    return false;
  }
}

/**
 * Evaluate PRF for wallet-specific salt
 *
 * Performs WebAuthn authentication with PRF extension to derive a 32-byte secret
 * bound to the credential and wallet ID. Requires user verification (biometric/PIN).
 *
 * @param credentialId - Base64-encoded credential ID
 * @param walletId - Wallet ID to derive key for
 * @returns Promise<ArrayBuffer> - 32-byte PRF output
 * @throws Error if PRF evaluation fails or user cancels
 */
export async function evaluatePrfForWallet(
  credentialId: string,
  walletId: string
): Promise<ArrayBuffer> {
  debugLog('[PRF] Evaluating PRF for wallet:', walletId);

  // Generate random challenge
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  // PRF salt format: "gero-wallet-passkey-v1:{walletId}"
  // Version identifier allows future key rotation if needed
  const salt = new TextEncoder().encode(`gero-wallet-passkey-v1:${walletId}`);

  try {
    // Authenticate with PRF extension
    // Note: Don't restrict transports or rpId - let browser use same context as registration
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          id: base64ToArrayBuffer(credentialId),
          type: 'public-key'
          // Omit transports - let browser decide
        }],
        timeout: 60000,
        userVerification: 'required',
        // Omit rpId - defaults to current domain (same as registration)
        extensions: {
          prf: {
            eval: {
              first: salt // Wallet-specific salt
            }
          }
        }
      }
    }) as PublicKeyCredential;

    // Extract PRF results with type safety
    const extensionResults = assertion.getClientExtensionResults();
    const prfResults = extensionResults?.prf as PrfExtensionResults | undefined;

    if (!prfResults?.results?.first) {
      throw new Error('PRF evaluation failed - no results returned from authenticator');
    }

    debugLog('[PRF] ✅ PRF evaluation successful (32 bytes)');
    // Convert BufferSource to ArrayBuffer
    const result = prfResults.results.first;
    if (result instanceof ArrayBuffer) {
      return result;
    }
    // If it's an ArrayBufferView, get the underlying buffer
    const buffer = (result as ArrayBufferView).buffer;
    // Ensure it's an ArrayBuffer, not SharedArrayBuffer
    if (buffer instanceof SharedArrayBuffer) {
      // Copy SharedArrayBuffer to regular ArrayBuffer
      const arrayBuffer = new ArrayBuffer(buffer.byteLength);
      new Uint8Array(arrayBuffer).set(new Uint8Array(buffer));
      return arrayBuffer;
    }
    return buffer;
  } catch (error) {
    // User cancelled
    if ((error as Error).name === 'NotAllowedError' || (error as Error).name === 'AbortError') {
      debugLog('[PRF] User cancelled PRF evaluation');
      throw new Error('PassKey authentication was cancelled');
    }

    // Other errors
    console.error('[PRF] PRF evaluation failed:', error);
    throw new Error(`PassKey PRF evaluation failed: ${(error as Error).message}`);
  }
}

/**
 * Register a new WebAuthn credential with PRF extension AND evaluate PRF in one prompt
 *
 * This function combines credential registration and PRF evaluation into a single
 * PassKey prompt, improving UX by avoiding the double-prompt issue.
 *
 * @param walletId - Wallet ID to use for PRF salt generation
 * @param walletName - Wallet name for display
 * @returns Object with credential ID, PRF enabled status, and PRF output
 * @throws Error if registration fails or user cancels
 */
export async function registerWebAuthnCredentialWithPrf(
  walletId: string,
  walletName: string
): Promise<{ credentialId: string; prfEnabled: boolean; prfOutput: ArrayBuffer | null }> {
  debugLog('[PRF] Registering credential with PRF evaluation for wallet:', walletId);

  // Check WebAuthn support
  if (!window.PublicKeyCredential) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  try {
    // Generate random challenge
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    // PRF salt format: "gero-wallet-passkey-v1:{walletId}"
    const salt = new TextEncoder().encode(`gero-wallet-passkey-v1:${walletId}`);

    // Create credential options with PRF extension AND evaluation
    const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
      challenge,
      rp: {
        name: 'Gero Dashboard',
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
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        requireResidentKey: false
      },
      timeout: 60000,
      attestation: 'none',
      // Enable PRF extension AND evaluate during registration (single prompt!)
      extensions: {
        prf: {
          eval: {
            first: salt // Evaluate PRF with wallet-specific salt during registration
          }
        }
      }
    };

    // Create the credential (single PassKey prompt)
    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions
    }) as PublicKeyCredential;

    if (!credential) {
      throw new Error('Failed to create credential');
    }

    // Check if PRF was enabled and evaluated with type safety
    const extensionResults = credential.getClientExtensionResults();
    const prfResults = extensionResults?.prf as PrfExtensionResults | undefined;
    const prfEnabled = prfResults?.enabled === true;

    debugLog('[PRF] Registration extension results:', {
      hasExtensions: !!extensionResults,
      hasPrf: !!prfResults,
      prfEnabled: prfResults?.enabled,
      hasResults: !!prfResults?.results,
      hasFirst: !!prfResults?.results?.first
    });

    // Extract PRF output if available
    let prfOutput: ArrayBuffer | null = null;
    if (prfEnabled && prfResults?.results?.first) {
      const result = prfResults.results.first;
      if (result instanceof ArrayBuffer) {
        prfOutput = result;
      } else {
        // If it's an ArrayBufferView, get the underlying buffer
        const buffer = (result as ArrayBufferView).buffer;
        if (buffer instanceof SharedArrayBuffer) {
          // Copy SharedArrayBuffer to regular ArrayBuffer
          const arrayBuffer = new ArrayBuffer(buffer.byteLength);
          new Uint8Array(arrayBuffer).set(new Uint8Array(buffer));
          prfOutput = arrayBuffer;
        } else {
          prfOutput = buffer;
        }
      }
      debugLog('[PRF] ✅ PRF evaluation successful during registration (32 bytes)');
    } else {
      debugWarn('[PRF] ⚠️ PRF enabled but no evaluation results returned');
    }

    // Convert credential ID to base64
    const credentialId = arrayBufferToBase64(credential.rawId);

    return {
      credentialId,
      prfEnabled,
      prfOutput
    };
  } catch (error) {
    console.error('[PRF] Registration error:', error);

    // User cancelled the passkey prompt
    if ((error as Error).name === 'NotAllowedError') {
      throw new Error('PassKey registration was cancelled');
    }

    // Other errors
    throw new Error(`PassKey registration failed: ${(error as Error).message}`);
  }
}

/**
 * Derive non-extractable AES-GCM key from PRF output using HKDF
 *
 * Uses HKDF (HMAC-based Key Derivation Function) to derive a wallet-specific
 * encryption key from the PRF output. The key is non-extractable, preventing
 * JavaScript from reading the raw key material.
 *
 * @param prfOutput - 32-byte PRF output from evaluatePrfForWallet()
 * @param walletId - Wallet ID (used in info parameter for domain separation)
 * @returns Promise<CryptoKey> - Non-extractable AES-GCM-256 key
 */
async function deriveEncryptionKeyFromPrf(
  prfOutput: ArrayBuffer,
  walletId: string
): Promise<CryptoKey> {
  // Import PRF output as HKDF base key (non-extractable)
  const baseKey = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    'HKDF',
    false, // ❌ Non-extractable!
    ['deriveKey']
  );

  // Derive wallet-specific AES-GCM key using HKDF
  // Info parameter includes version identifier for future key rotation
  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new Uint8Array(), // Empty salt (PRF output already provides high entropy)
      hash: 'SHA-512',
      info: new TextEncoder().encode(`gero-wallet-password-encryption-v1:${walletId}`)
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // ❌ Non-extractable!
    ['encrypt', 'decrypt']
  );

  debugLog('[PRF] ✅ Derived non-extractable AES-GCM key');
  return encryptionKey;
}

/**
 * Encrypt spending password using PRF-derived key
 *
 * Flow:
 * 1. Evaluate PRF with wallet-specific salt (requires user authentication)
 * 2. Derive non-extractable AES-GCM key from PRF output
 * 3. Encrypt password with AES-GCM (credential ID as additional authenticated data)
 *
 * Format: iv (12 bytes) + ciphertext (variable)
 *
 * @param password - Spending password to encrypt
 * @param credentialId - Base64-encoded credential ID (bound to ciphertext via AAD)
 * @param walletId - Wallet ID for key derivation
 * @returns Promise<string> - Hex-encoded encrypted password
 * @throws Error if PRF evaluation fails or user cancels
 */
export async function encryptSpendingPasswordWithPrf(
  password: string,
  credentialId: string,
  walletId: string
): Promise<string> {
  debugLog('[PRF] Encrypting spending password for wallet:', walletId);

  // Step 1: Evaluate PRF (requires user authentication)
  const prfOutput = await evaluatePrfForWallet(credentialId, walletId);

  // Step 2: Derive non-extractable encryption key
  const encryptionKey = await deriveEncryptionKeyFromPrf(prfOutput, walletId);

  // Step 3: Generate random IV for AES-GCM
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Step 4: Encrypt password with AES-GCM
  // Additional authenticated data (AAD) binds ciphertext to credential ID
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(credentialId)
    },
    encryptionKey,
    new TextEncoder().encode(password)
  );

  // Format: iv (12B) + ciphertext
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv);
  result.set(new Uint8Array(encrypted), iv.length);

  debugLog('[PRF] ✅ Password encrypted successfully');
  return Buffer.from(result).toString('hex');
}

/**
 * Decrypt spending password using PRF-derived key
 *
 * Flow:
 * 1. Parse encrypted password (extract IV and ciphertext)
 * 2. Evaluate PRF with wallet-specific salt (requires user authentication)
 * 3. Derive non-extractable AES-GCM key from PRF output
 * 4. Decrypt ciphertext with AES-GCM (verify credential ID via AAD)
 *
 * @param encryptedPassword - Hex-encoded encrypted password
 * @param credentialId - Base64-encoded credential ID (must match encryption)
 * @param walletId - Wallet ID for key derivation (must match encryption)
 * @returns Promise<string> - Decrypted spending password
 * @throws Error if PRF evaluation fails, user cancels, or decryption fails
 */
export async function decryptSpendingPasswordWithPrf(
  encryptedPassword: string,
  credentialId: string,
  walletId: string
): Promise<string> {
  debugLog('[PRF] Decrypting spending password for wallet:', walletId);

  // Step 1: Parse encrypted data
  const encryptedBytes = Buffer.from(encryptedPassword, 'hex');

  // Extract IV and ciphertext
  const iv = encryptedBytes.subarray(0, 12);
  const ciphertext = encryptedBytes.subarray(12);

  // Step 2: Evaluate PRF (requires user authentication)
  const prfOutput = await evaluatePrfForWallet(credentialId, walletId);

  // Step 3: Derive non-extractable encryption key (same derivation as encryption)
  const encryptionKey = await deriveEncryptionKeyFromPrf(prfOutput, walletId);

  try {
    // Step 4: Decrypt password with AES-GCM
    // AAD verification ensures ciphertext was encrypted with same credential ID
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: new TextEncoder().encode(credentialId)
      },
      encryptionKey,
      ciphertext
    );

    debugLog('[PRF] ✅ Password decrypted successfully');
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('[PRF] Decryption failed:', error);
    throw new Error('Failed to decrypt passkey password - credential may have been re-registered');
  }
}

/**
 * Encrypt private key bytes using PRF-derived key
 *
 * Similar to password encryption but designed for larger binary data (96 bytes for BIP32 keys).
 * Uses same HKDF derivation but with different info parameter for domain separation.
 *
 * @param privateKeyBytes - Private key bytes (typically 96 bytes: 64-byte key + 32-byte chain code)
 * @param credentialId - Base64-encoded credential ID
 * @param walletId - Wallet ID for key derivation
 * @param providedPrfOutput - Optional pre-evaluated PRF output (avoids re-authentication)
 * @returns Promise<string> - Hex-encoded encrypted private key
 * @throws Error if PRF evaluation fails or user cancels
 */
export async function encryptPrivateKeyWithPrf(
  privateKeyBytes: Uint8Array,
  credentialId: string,
  walletId: string,
  providedPrfOutput?: ArrayBuffer
): Promise<string> {
  debugLog('[PRF] Encrypting private key for wallet:', walletId);

  // Step 1: Evaluate PRF (requires user authentication) - OR use provided PRF output
  const prfOutput = providedPrfOutput || await evaluatePrfForWallet(credentialId, walletId);

  // Step 2: Derive non-extractable encryption key (different info for domain separation)
  const baseKey = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    'HKDF',
    false, // Non-extractable
    ['deriveKey']
  );

  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new Uint8Array(),
      hash: 'SHA-512',
      info: new TextEncoder().encode(`gero-wallet-privatekey-encryption-v1:${walletId}`)
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // Non-extractable
    ['encrypt', 'decrypt']
  );

  // Step 3: Generate random IV for AES-GCM
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Step 4: Encrypt private key with AES-GCM
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(credentialId)
    },
    encryptionKey,
    privateKeyBytes as Uint8Array<ArrayBuffer>
  );

  // Format: iv (12B) + ciphertext
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv);
  result.set(new Uint8Array(encrypted), iv.length);

  debugLog('[PRF] ✅ Private key encrypted successfully');
  return Buffer.from(result).toString('hex');
}

/**
 * Decrypt private key bytes using PRF-derived key
 *
 * @param encryptedPrivateKey - Hex-encoded encrypted private key
 * @param credentialId - Base64-encoded credential ID (must match encryption)
 * @param walletId - Wallet ID for key derivation (must match encryption)
 * @returns Promise<Uint8Array> - Decrypted private key bytes
 * @throws Error if PRF evaluation fails, user cancels, or decryption fails
 */
export async function decryptPrivateKeyWithPrf(
  encryptedPrivateKey: string,
  credentialId: string,
  walletId: string
): Promise<Uint8Array> {
  debugLog('[PRF] Decrypting private key for wallet:', walletId);

  // Step 1: Parse encrypted data
  const encryptedBytes = Buffer.from(encryptedPrivateKey, 'hex');

  // Extract IV and ciphertext
  const iv = encryptedBytes.subarray(0, 12);
  const ciphertext = encryptedBytes.subarray(12);

  // Step 2: Evaluate PRF (requires user authentication)
  const prfOutput = await evaluatePrfForWallet(credentialId, walletId);

  // Step 3: Derive non-extractable encryption key (same derivation as encryption)
  const baseKey = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    'HKDF',
    false,
    ['deriveKey']
  );

  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new Uint8Array(),
      hash: 'SHA-512',
      info: new TextEncoder().encode(`gero-wallet-privatekey-encryption-v1:${walletId}`)
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  try {
    // Step 4: Decrypt private key with AES-GCM
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: new TextEncoder().encode(credentialId)
      },
      encryptionKey,
      ciphertext
    );

    debugLog('[PRF] ✅ Private key decrypted successfully');
    return new Uint8Array(decrypted);
  } catch (error) {
    console.error('[PRF] Private key decryption failed:', error);
    throw new Error('Failed to decrypt private key - credential may have been re-registered');
  }
}

/**
 * Encrypt mnemonic phrase using PRF-derived key
 *
 * @param mnemonic - BIP39 mnemonic phrase (24 words)
 * @param credentialId - Base64-encoded credential ID
 * @param walletId - Wallet ID for key derivation
 * @param providedPrfOutput - Optional pre-evaluated PRF output (avoids re-authentication)
 * @returns Promise<string> - Hex-encoded encrypted mnemonic
 * @throws Error if PRF evaluation fails or user cancels
 */
export async function encryptMnemonicWithPrf(
  mnemonic: string,
  credentialId: string,
  walletId: string,
  providedPrfOutput?: ArrayBuffer
): Promise<string> {
  debugLog('[PRF] Encrypting mnemonic for wallet:', walletId);

  // Step 1: Evaluate PRF (requires user authentication) - OR use provided PRF output
  const prfOutput = providedPrfOutput || await evaluatePrfForWallet(credentialId, walletId);

  // Step 2: Derive non-extractable encryption key (different info for domain separation)
  const baseKey = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    'HKDF',
    false,
    ['deriveKey']
  );

  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new Uint8Array(),
      hash: 'SHA-512',
      info: new TextEncoder().encode(`gero-wallet-mnemonic-encryption-v1:${walletId}`)
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  // Step 3: Generate random IV for AES-GCM
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Step 4: Encrypt mnemonic with AES-GCM
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(credentialId)
    },
    encryptionKey,
    new TextEncoder().encode(mnemonic)
  );

  // Format: iv (12B) + ciphertext
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv);
  result.set(new Uint8Array(encrypted), iv.length);

  debugLog('[PRF] ✅ Mnemonic encrypted successfully');
  return Buffer.from(result).toString('hex');
}

/**
 * Decrypt mnemonic phrase using PRF-derived key
 *
 * @param encryptedMnemonic - Hex-encoded encrypted mnemonic
 * @param credentialId - Base64-encoded credential ID (must match encryption)
 * @param walletId - Wallet ID for key derivation (must match encryption)
 * @returns Promise<string> - Decrypted BIP39 mnemonic phrase
 * @throws Error if PRF evaluation fails, user cancels, or decryption fails
 */
export async function decryptMnemonicWithPrf(
  encryptedMnemonic: string,
  credentialId: string,
  walletId: string
): Promise<string> {
  debugLog('[PRF] Decrypting mnemonic for wallet:', walletId);

  // Step 1: Parse encrypted data
  const encryptedBytes = Buffer.from(encryptedMnemonic, 'hex');

  // Extract IV and ciphertext
  const iv = encryptedBytes.subarray(0, 12);
  const ciphertext = encryptedBytes.subarray(12);

  // Step 2: Evaluate PRF (requires user authentication)
  const prfOutput = await evaluatePrfForWallet(credentialId, walletId);

  // Step 3: Derive non-extractable encryption key (same derivation as encryption)
  const baseKey = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    'HKDF',
    false,
    ['deriveKey']
  );

  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new Uint8Array(),
      hash: 'SHA-512',
      info: new TextEncoder().encode(`gero-wallet-mnemonic-encryption-v1:${walletId}`)
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  try {
    // Step 4: Decrypt mnemonic with AES-GCM
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: new TextEncoder().encode(credentialId)
      },
      encryptionKey,
      ciphertext
    );

    debugLog('[PRF] ✅ Mnemonic decrypted successfully');
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('[PRF] Mnemonic decryption failed:', error);
    throw new Error('Failed to decrypt mnemonic - credential may have been re-registered');
  }
}

/**
 * Hash spending password using PBKDF2-HMAC-SHA512
 *
 * Used for PRF wallets when "Password Unlock" method is enabled in LockSettings.
 * The hash is stored in the wallet's prfSpendingPassword field and verified
 * before allowing sensitive operations.
 *
 * Security Parameters:
 * - PBKDF2-HMAC-SHA512
 * - 310,000 iterations (OWASP 2023 recommendation)
 * - 32-byte random salt
 * - 32-byte derived key
 *
 * Format: salt (32B) + hash (32B) = 64 bytes total (128 hex chars)
 *
 * @param password - Spending password to hash
 * @returns string - Hex-encoded salt + hash (128 hex characters)
 */
export async function hashSpendingPassword(password: string): Promise<string> {
  debugLog('[PRF] Hashing spending password');

  // Import PBKDF2 from @noble/hashes
  const { pbkdf2 } = await import('@noble/hashes/pbkdf2');
  const { sha512 } = await import('@noble/hashes/sha2');

  // Generate random 32-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(32));

  // Convert password to bytes
  const passwordBytes = new TextEncoder().encode(password);

  // Derive key using PBKDF2-HMAC-SHA512
  // 310,000 iterations (OWASP 2023 recommendation for PBKDF2-HMAC-SHA512)
  const hash = pbkdf2(sha512, passwordBytes, salt, {
    c: 310000,  // iterations
    dkLen: 32   // derived key length
  });

  // Combine salt + hash
  const combined = new Uint8Array(salt.length + hash.length);
  combined.set(salt);
  combined.set(hash, salt.length);

  debugLog('[PRF] ✅ Spending password hashed successfully');
  return Buffer.from(combined).toString('hex');
}

/**
 * Verify spending password against stored hash
 *
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param password - Password to verify
 * @param hashedPassword - Hex-encoded salt + hash from hashSpendingPassword()
 * @returns boolean - true if password matches, false otherwise
 */
export async function verifySpendingPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  debugLog('[PRF] Verifying spending password');

  try {
    // Import PBKDF2 from @noble/hashes
    const { pbkdf2 } = await import('@noble/hashes/pbkdf2');
    const { sha512 } = await import('@noble/hashes/sha2');

    // Parse stored hash
    const combined = Buffer.from(hashedPassword, 'hex');
    const salt = combined.subarray(0, 32);
    const storedHash = combined.subarray(32);

    // Convert password to bytes
    const passwordBytes = new TextEncoder().encode(password);

    // Derive key using same parameters
    const computedHash = pbkdf2(sha512, passwordBytes, salt, {
      c: 310000,
      dkLen: 32
    });

    // Constant-time comparison to prevent timing attacks
    let isMatch = storedHash.length === computedHash.length;
    for (let i = 0; i < storedHash.length; i++) {
      isMatch = isMatch && (storedHash[i] === computedHash[i]);
    }

    debugLog('[PRF] ✅ Spending password verification:', isMatch ? 'MATCH' : 'NO MATCH');
    return isMatch;
  } catch (error) {
    console.error('[PRF] Spending password verification failed:', error);
    return false;
  }
}
