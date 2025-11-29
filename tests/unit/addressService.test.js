import { describe, it, expect } from 'vitest';
import { AddressService } from '../../src/services/AddressService.js';
import { generateKeyPair } from '../fixtures/addressGenerator.js';

describe('AddressService', () => {
  const addressService = new AddressService();

  describe('validateAddress', () => {
    it('should validate a correct alpha1 address', () => {
      const { address } = generateKeyPair();
      const result = addressService.validateAddress(address);

      expect(result.valid).toBe(true);
      expect(result.normalized).toBe(address.toLowerCase());
    });

    it('should reject addresses with wrong prefix', () => {
      const result = addressService.validateAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('alpha1');
    });

    it('should reject invalid characters', () => {
      const result = addressService.validateAddress('alpha1invalid!@#$');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid characters');
    });

    it('should reject non-string input', () => {
      const result = addressService.validateAddress(12345);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('string');
    });

    it('should handle uppercase addresses', () => {
      const { address } = generateKeyPair();
      const upperAddress = address.toUpperCase();
      const result = addressService.validateAddress(upperAddress);

      expect(result.valid).toBe(true);
      expect(result.normalized).toBe(address.toLowerCase());
    });
  });

  describe('publicKeyToAddress', () => {
    it('should derive correct address from public key', () => {
      const { publicKey, address } = generateKeyPair();
      const derived = addressService.publicKeyToAddress(publicKey);

      expect(derived).toBe(address);
    });

    it('should reject invalid public key length', () => {
      expect(() => {
        addressService.publicKeyToAddress('deadbeef');
      }).toThrow('33 bytes');
    });
  });

  describe('computeScriptHash', () => {
    it('should compute script hash for address', () => {
      const { address } = generateKeyPair();
      const scriptHash = addressService.computeScriptHash(address);

      expect(scriptHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce consistent results', () => {
      const { address } = generateKeyPair();
      const hash1 = addressService.computeScriptHash(address);
      const hash2 = addressService.computeScriptHash(address);

      expect(hash1).toBe(hash2);
    });
  });

  describe('verifyPublicKeyMatchesAddress', () => {
    it('should return true for matching key and address', () => {
      const { publicKey, address } = generateKeyPair();
      const result = addressService.verifyPublicKeyMatchesAddress(publicKey, address);

      expect(result).toBe(true);
    });

    it('should return false for mismatched key and address', () => {
      const keyPair1 = generateKeyPair();
      const keyPair2 = generateKeyPair();

      const result = addressService.verifyPublicKeyMatchesAddress(
        keyPair1.publicKey,
        keyPair2.address
      );

      expect(result).toBe(false);
    });
  });
});
