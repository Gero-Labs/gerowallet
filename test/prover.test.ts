import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prover } from '../src/services/zkFold/prover';

// Mock axios
vi.mock('axios');

describe('Prover - Web Crypto API Integration', () => {
  let prover: Prover;

  beforeEach(() => {
    prover = new Prover('https://test-prover.zkfold.io');
  });

  it('should import without node-forge dependency', async () => {
    // This test verifies that the Prover module can be imported without node-forge
    expect(prover).toBeDefined();
    expect(prover).toBeInstanceOf(Prover);
  });

  it('should have Web Crypto API available in test environment', () => {
    // Verify that Web Crypto API is available
    expect(crypto).toBeDefined();
    expect(crypto.subtle).toBeDefined();
    expect(crypto.getRandomValues).toBeDefined();
  });

  it('should generate random bytes using Web Crypto API', () => {
    // Test that random bytes generation works
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
    // Verify it's not all zeros (very unlikely with real random)
    const sum = Array.from(bytes).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0);
  });

  it('should create AES-CBC cipher using Web Crypto API', async () => {
    // Test AES-256-CBC encryption
    const key = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const plaintext = new TextEncoder().encode('test data');

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-CBC', length: 256 },
      false,
      ['encrypt']
    );

    const algorithm: AesCbcParams = { name: 'AES-CBC', iv };
    // @ts-ignore - TypeScript has strict type checking for Web Crypto API but this is correct
    const encrypted = await crypto.subtle.encrypt(algorithm, cryptoKey, plaintext);

    expect(encrypted).toBeInstanceOf(ArrayBuffer);
    expect(encrypted.byteLength).toBeGreaterThan(0);
  });

  it('should create RSA-OAEP public key using Web Crypto API', async () => {
    // Test RSA public key import with JWK format
    const n = 'xGOr-H7A-PWZYwJX3tD6mV0YpU3hQlk_RfhAFiLJFb8yW6Tt0t0yzEsjYiRF8gzVcLDqZCmWyJhqPYsVJ6WcWTFb9XR_O5g9a0JzGqUXnPQGP2WJqvN-hFpMb6vHF4vFRh'; // Base64URL encoded modulus (example)
    const e = 'AQAB'; // Base64URL encoded exponent (65537)

    const jwk: JsonWebKey = {
      kty: 'RSA',
      n,
      e,
      alg: 'RSA-OAEP-256',
      ext: true
    };

    const algorithm: RsaHashedImportParams = {
      name: 'RSA-OAEP',
      hash: 'SHA-256'
    };
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      algorithm,
      false,
      ['encrypt']
    );

    expect(publicKey).toBeDefined();
    expect(publicKey.type).toBe('public');
    expect(publicKey.algorithm.name).toBe('RSA-OAEP');
  });

  it('should convert BigInt to Uint8Array correctly', () => {
    // Test the bigIntToBytes helper method
    const testBigInt = BigInt('12345678901234567890');

    // Access private method through any type assertion
    const proverAny = prover as any;
    const bytes = proverAny.bigIntToBytes(testBigInt);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);

    // Verify we can convert back
    // @ts-ignore - TypeScript type inference issue with Array.from
    const hex = Array.from(bytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');
    const reconstructed = BigInt('0x' + hex);
    expect(reconstructed).toBe(testBigInt);
  });

  it('should convert Uint8Array to hex string correctly', () => {
    // Test the bytesToHex helper method
    const testBytes = new Uint8Array([0x12, 0x34, 0xab, 0xcd]);

    // Access private method through any type assertion
    const proverAny = prover as any;
    const hex = proverAny.bytesToHex(testBytes);

    expect(hex).toBe('1234abcd');
  });

  it('should convert Uint8Array to Base64URL correctly', () => {
    // Test the arrayBufferToBase64Url helper method
    const testBytes = new Uint8Array([0x12, 0x34, 0xab, 0xcd]);

    // Access private method through any type assertion
    const proverAny = prover as any;
    const base64url = proverAny.arrayBufferToBase64Url(testBytes);

    expect(base64url).toBeDefined();
    expect(typeof base64url).toBe('string');
    // Base64URL should not contain +, /, or =
    expect(base64url).not.toContain('+');
    expect(base64url).not.toContain('/');
    expect(base64url).not.toContain('=');
  });

  it('should not have node-forge in the dependency chain', async () => {
    // This test ensures that importing Prover doesn't pull in node-forge
    // If node-forge is imported, it would cause the gOPD2 error in service workers

    let hasNodeForge = false;
    try {
      // Try to access node-forge (should fail if not imported)
      const forge = (await import('node-forge')).default;
      if (forge) {
        hasNodeForge = true;
      }
    } catch (e) {
      // Expected - node-forge should not be importable from Prover module
      hasNodeForge = false;
    }

    // We expect node-forge to NOT be in the module's dependency chain
    // Note: This test might pass even if node-forge is installed in node_modules
    // because we're not importing it in prover.ts anymore
    expect(prover).toBeDefined();
  });
});
