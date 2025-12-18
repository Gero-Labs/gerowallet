import { describe, it, expect } from 'vitest';
import {
  hashPin,
  verifyPin,
  hashPattern,
  verifyPattern,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateBackupCodes,
  isValidPin,
  isValidPattern,
  isValidTotpCode,
} from '../src/shared/utils/security';

describe('security utilities', () => {
  describe('PIN hashing and verification', () => {
    it('should hash PIN with random salt (different hashes for same PIN)', async () => {
      const pin = '123456';

      const hash1 = await hashPin(pin);
      const hash2 = await hashPin(pin);

      // Hashes should be different due to random salt
      expect(hash1).not.toBe(hash2);

      // Both should contain ':' separator
      expect(hash1).toContain(':');
      expect(hash2).toContain(':');

      // Both parts should be hex strings
      const [salt1, hash1Part] = hash1.split(':');
      const [salt2, hash2Part] = hash2.split(':');
      expect(salt1).toMatch(/^[0-9a-f]+$/);
      expect(hash1Part).toMatch(/^[0-9a-f]+$/);
      expect(salt2).toMatch(/^[0-9a-f]+$/);
      expect(hash2Part).toMatch(/^[0-9a-f]+$/);
    });

    it('should verify correct PIN', async () => {
      const pin = '654321';
      const hashedPin = await hashPin(pin);

      const isValid = await verifyPin(pin, hashedPin);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect PIN', async () => {
      const correctPin = '123456';
      const wrongPin = '654321';
      const hashedPin = await hashPin(correctPin);

      const isValid = await verifyPin(wrongPin, hashedPin);
      expect(isValid).toBe(false);
    });

    it('should handle various PIN lengths (4-6 digits)', async () => {
      const pins = ['1234', '12345', '123456'];

      for (const pin of pins) {
        const hashedPin = await hashPin(pin);
        const isValid = await verifyPin(pin, hashedPin);
        expect(isValid).toBe(true);
      }
    });

    it('should reject invalid hashed PIN format', async () => {
      const pin = '123456';
      const invalidHash = 'not-a-valid-hash';

      const isValid = await verifyPin(pin, invalidHash);
      expect(isValid).toBe(false);
    });
  });

  describe('Pattern hashing and verification', () => {
    it('should hash pattern with random salt', async () => {
      const pattern = [0, 1, 2, 5, 8];

      const hash1 = await hashPattern(pattern);
      const hash2 = await hashPattern(pattern);

      // Hashes should be different due to random salt
      expect(hash1).not.toBe(hash2);
      expect(hash1).toContain(':');
      expect(hash2).toContain(':');
    });

    it('should verify correct pattern', async () => {
      const pattern = [0, 4, 8, 12];
      const hashedPattern = await hashPattern(pattern);

      const isValid = await verifyPattern(pattern, hashedPattern);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect pattern', async () => {
      const correctPattern = [0, 1, 2];
      const wrongPattern = [0, 1, 3];
      const hashedPattern = await hashPattern(correctPattern);

      const isValid = await verifyPattern(wrongPattern, hashedPattern);
      expect(isValid).toBe(false);
    });

    it('should reject pattern with different order', async () => {
      const pattern1 = [0, 1, 2];
      const pattern2 = [2, 1, 0]; // Same dots, different order
      const hashedPattern = await hashPattern(pattern1);

      const isValid = await verifyPattern(pattern2, hashedPattern);
      expect(isValid).toBe(false);
    });
  });

  describe('TOTP secret generation', () => {
    it('should generate valid base32 secret', () => {
      const secret = generateTotpSecret();

      // Should be a non-empty string
      expect(secret).toBeTruthy();
      expect(typeof secret).toBe('string');

      // Should be base32 (only A-Z and 2-7)
      expect(secret).toMatch(/^[A-Z2-7]+$/);

      // Should be reasonable length (standard is 160 bits = 32 base32 chars)
      expect(secret.length).toBeGreaterThanOrEqual(20);
    });

    it('should generate different secrets each time', () => {
      const secret1 = generateTotpSecret();
      const secret2 = generateTotpSecret();
      const secret3 = generateTotpSecret();

      expect(secret1).not.toBe(secret2);
      expect(secret2).not.toBe(secret3);
      expect(secret1).not.toBe(secret3);
    });
  });

  describe('TOTP code generation and verification', () => {
    it('should generate valid 6-digit TOTP code', () => {
      const secret = generateTotpSecret();
      const code = generateTotpCode(secret);

      expect(code).toMatch(/^\d{6}$/);
    });

    it('should verify correct TOTP code', () => {
      const secret = generateTotpSecret();
      const code = generateTotpCode(secret);

      const isValid = verifyTotpCode(code, secret);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect TOTP code', () => {
      const secret = generateTotpSecret();
      const wrongCode = '000000';

      const isValid = verifyTotpCode(wrongCode, secret);
      // This might occasionally pass if the code happens to be 000000,
      // but that's extremely unlikely
      expect(isValid).toBe(false);
    });

    it('should reject invalid TOTP code format', () => {
      const secret = generateTotpSecret();

      expect(verifyTotpCode('12345', secret)).toBe(false); // Too short
      expect(verifyTotpCode('1234567', secret)).toBe(false); // Too long
      expect(verifyTotpCode('12345a', secret)).toBe(false); // Contains letter
      expect(verifyTotpCode('', secret)).toBe(false); // Empty
    });
  });

  describe('Backup codes generation', () => {
    it('should generate correct number of backup codes', () => {
      const codes = generateBackupCodes(8);
      expect(codes).toHaveLength(8);
    });

    it('should generate codes in correct format (XXXX-XXXX)', () => {
      const codes = generateBackupCodes(5);

      codes.forEach(code => {
        // Should match XXXX-XXXX format (4 chars, dash, 4 chars)
        expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        expect(code).toHaveLength(9); // 4 + 1 + 4
      });
    });

    it('should generate unique backup codes', () => {
      const codes = generateBackupCodes(10);

      // All codes should be unique
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(10);
    });

    it('should support custom count', () => {
      expect(generateBackupCodes(5)).toHaveLength(5);
      expect(generateBackupCodes(10)).toHaveLength(10);
      expect(generateBackupCodes(12)).toHaveLength(12);
    });
  });

  describe('Validation functions', () => {
    describe('isValidPin', () => {
      it('should validate correct PIN formats', () => {
        expect(isValidPin('1234')).toBe(true); // 4 digits
        expect(isValidPin('12345')).toBe(true); // 5 digits
        expect(isValidPin('123456')).toBe(true); // 6 digits
      });

      it('should reject invalid PIN formats', () => {
        expect(isValidPin('123')).toBe(false); // Too short
        expect(isValidPin('1234567')).toBe(false); // Too long
        expect(isValidPin('12a4')).toBe(false); // Contains letter
        expect(isValidPin('12 4')).toBe(false); // Contains space
        expect(isValidPin('')).toBe(false); // Empty
      });
    });

    describe('isValidPattern', () => {
      it('should validate correct pattern formats', () => {
        expect(isValidPattern([0, 1, 2, 3])).toBe(true); // Min 4 dots
        expect(isValidPattern([0, 1, 2, 3, 4, 5, 6, 7])).toBe(true); // 8 dots
        expect(isValidPattern([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])).toBe(true); // Max 16 dots
      });

      it('should reject invalid pattern formats', () => {
        expect(isValidPattern([0, 1, 2])).toBe(false); // Too short (< 4)
        expect(isValidPattern([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])).toBe(false); // Too long (> 16)
        expect(isValidPattern([0, 1, 2, 16])).toBe(false); // Number out of range (> 15)
        expect(isValidPattern([0, 1, 2, -1])).toBe(false); // Negative number
        expect(isValidPattern([0, 1, 2, 2])).toBe(false); // Duplicate number
        expect(isValidPattern([])).toBe(false); // Empty
      });
    });

    describe('isValidTotpCode', () => {
      it('should validate correct TOTP code format', () => {
        expect(isValidTotpCode('123456')).toBe(true);
        expect(isValidTotpCode('000000')).toBe(true);
        expect(isValidTotpCode('999999')).toBe(true);
      });

      it('should reject invalid TOTP code formats', () => {
        expect(isValidTotpCode('12345')).toBe(false); // Too short
        expect(isValidTotpCode('1234567')).toBe(false); // Too long
        expect(isValidTotpCode('12345a')).toBe(false); // Contains letter
        expect(isValidTotpCode('123 456')).toBe(false); // Contains space
        expect(isValidTotpCode('')).toBe(false); // Empty
      });
    });
  });

  describe('PBKDF2 iterations (security hardening)', () => {
    it('should use high iteration count for PIN hashing (100,000)', async () => {
      const pin = '123456';

      // Time the hashing operation
      const start = performance.now();
      await hashPin(pin);
      const duration = performance.now() - start;

      // With 100,000 iterations, this should take at least a few milliseconds
      // This is a weak test but ensures PBKDF2 is doing work
      expect(duration).toBeGreaterThan(1);
    });

    it('should consistently verify PINs despite high iteration count', async () => {
      const pin = '987654';
      const hashedPin = await hashPin(pin);

      // Verify multiple times to ensure consistency
      expect(await verifyPin(pin, hashedPin)).toBe(true);
      expect(await verifyPin(pin, hashedPin)).toBe(true);
      expect(await verifyPin(pin, hashedPin)).toBe(true);
    });
  });
});