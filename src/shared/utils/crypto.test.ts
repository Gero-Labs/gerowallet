import { describe, it, expect } from 'vitest';
import { encryptWithPassword, decryptWithPassword } from './crypto';
import { Buffer } from 'buffer';

describe('crypto utilities', () => {
  describe('encryptWithPassword and decryptWithPassword', () => {
    it('should encrypt and decrypt data successfully with correct password', () => {
      const password = 'testPassword123';
      const testData = 'a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5'; // 96 hex chars (48 bytes)

      // Encrypt the data
      const encrypted = encryptWithPassword(password, testData);

      // Verify encrypted data is a string and different from original
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe(testData);
      expect(encrypted.length).toBeGreaterThan(0);

      // Decrypt the data
      const decrypted = decryptWithPassword(password, encrypted);

      // Verify decrypted data matches original
      expect(decrypted).toBeInstanceOf(Buffer);
      expect(decrypted.toString('hex')).toBe(testData);
    });

    it('should throw error when decrypting with wrong password', () => {
      const correctPassword = 'correctPassword123';
      const wrongPassword = 'wrongPassword456';
      const testData = 'a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5';

      // Encrypt with correct password
      const encrypted = encryptWithPassword(correctPassword, testData);

      // Attempt to decrypt with wrong password should throw error
      expect(() => {
        decryptWithPassword(wrongPassword, encrypted);
      }).toThrow('Wrong Passphrase');
    });

    it('should handle different password strings', () => {
      const passwords = [
        'simple',
        'Complex123!@#',
        'very-long-password-with-special-characters-123456789!@#$%^&*()',
        '密碼', // Unicode password (Chinese characters)
        'pass with spaces',
      ];

      const testData = 'a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5';

      passwords.forEach(password => {
        const encrypted = encryptWithPassword(password, testData);
        const decrypted = decryptWithPassword(password, encrypted);

        expect(decrypted.toString('hex')).toBe(testData);
      });
    });

    it('should handle different data lengths', () => {
      const password = 'testPassword';
      const testCases = [
        '00', // 1 byte
        'a0b1c2d3', // 4 bytes
        'a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3', // 16 bytes
        'a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5', // 24 bytes
        'a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5', // 48 bytes
        'a0b1c2d3e4f5'.repeat(20), // 120 bytes
      ];

      testCases.forEach(testData => {
        const encrypted = encryptWithPassword(password, testData);
        const decrypted = decryptWithPassword(password, encrypted);

        expect(decrypted.toString('hex')).toBe(testData);
      });
    });

    it('should produce different ciphertext for same data due to random salt and nonce', () => {
      const password = 'testPassword';
      const testData = 'a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5';

      // Encrypt the same data multiple times
      const encrypted1 = encryptWithPassword(password, testData);
      const encrypted2 = encryptWithPassword(password, testData);
      const encrypted3 = encryptWithPassword(password, testData);

      // Ciphertexts should be different due to random salt and nonce
      expect(encrypted1).not.toBe(encrypted2);
      expect(encrypted2).not.toBe(encrypted3);
      expect(encrypted1).not.toBe(encrypted3);

      // But all should decrypt to the same original data
      expect(decryptWithPassword(password, encrypted1).toString('hex')).toBe(testData);
      expect(decryptWithPassword(password, encrypted2).toString('hex')).toBe(testData);
      expect(decryptWithPassword(password, encrypted3).toString('hex')).toBe(testData);
    });

    it('should reject empty password (CSL security requirement)', () => {
      const password = '';
      const testData = 'a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5';

      // Empty password should throw an error (CSL security requirement)
      expect(() => {
        encryptWithPassword(password, testData);
      }).toThrow();
    });

    it('should throw error for invalid encrypted data format', () => {
      const password = 'testPassword';
      const invalidEncryptedData = 'this-is-not-valid-encrypted-data';

      expect(() => {
        decryptWithPassword(password, invalidEncryptedData);
      }).toThrow('Wrong Passphrase');
    });

    it('should throw error for corrupted encrypted data', () => {
      const password = 'testPassword';
      const testData = 'a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5';

      const encrypted = encryptWithPassword(password, testData);

      // Corrupt the encrypted data by modifying characters
      const corrupted = encrypted.substring(0, encrypted.length - 10) + 'XXXXXXXXXX';

      expect(() => {
        decryptWithPassword(password, corrupted);
      }).toThrow('Wrong Passphrase');
    });
  });
});