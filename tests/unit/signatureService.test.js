import { describe, it, expect } from 'vitest';
import { SignatureService } from '../../src/services/SignatureService.js';
import { AddressService } from '../../src/services/AddressService.js';
import { generateKeyPair, signMintRequest } from '../fixtures/addressGenerator.js';

describe('SignatureService', () => {
  const addressService = new AddressService();
  const signatureService = new SignatureService(addressService);

  describe('createMessage', () => {
    it('should create canonical message format', () => {
      const message = signatureService.createMessage(
        'alpha1test123',
        'unicity-id-456',
        1000000
      );

      expect(message).toBe('alpha1test123:unicity-id-456:1000000');
    });
  });

  describe('createMessageHash', () => {
    it('should create consistent hash', () => {
      const hash1 = signatureService.createMessageHash('test message');
      const hash2 = signatureService.createMessageHash('test message');

      expect(hash1.toString('hex')).toBe(hash2.toString('hex'));
    });

    it('should return 32-byte hash', () => {
      const hash = signatureService.createMessageHash('test');

      expect(hash.length).toBe(32);
    });
  });

  describe('parseSignature', () => {
    it('should parse valid 65-byte signature', () => {
      const { privateKey, address } = generateKeyPair();
      const signature = signMintRequest(privateKey, address, 'test-id', 1000000);

      const parsed = signatureService.parseSignature(signature);

      expect(parsed.r).toHaveLength(64);
      expect(parsed.s).toHaveLength(64);
      expect(parsed.recoveryParam).toBeGreaterThanOrEqual(0);
      expect(parsed.recoveryParam).toBeLessThanOrEqual(3);
    });

    it('should handle 0x prefix', () => {
      const { privateKey, address } = generateKeyPair();
      const signature = '0x' + signMintRequest(privateKey, address, 'test-id', 1000000);

      expect(() => signatureService.parseSignature(signature)).not.toThrow();
    });

    it('should reject invalid hex', () => {
      expect(() => signatureService.parseSignature('not-hex!')).toThrow('valid hex');
    });

    it('should reject wrong length', () => {
      expect(() => signatureService.parseSignature('deadbeef')).toThrow('65 bytes');
    });
  });

  describe('verifySignature', () => {
    it('should verify valid signature', () => {
      const { privateKey, address } = generateKeyPair();
      const unicityId = 'test-unicity-id-123';
      const amount = 50000000;

      const signature = signMintRequest(privateKey, address, unicityId, amount);
      const result = signatureService.verifySignature(address, unicityId, amount, signature);

      expect(result.valid).toBe(true);
      expect(result.derivedAddress).toBe(address);
    });

    it('should reject signature from wrong key', () => {
      const keyPair1 = generateKeyPair();
      const keyPair2 = generateKeyPair();
      const unicityId = 'test-id';
      const amount = 1000000;

      // Sign with keyPair1 but claim it's from keyPair2's address
      const signature = signMintRequest(
        keyPair1.privateKey,
        keyPair1.address,  // Message includes correct address
        unicityId,
        amount
      );

      // But try to verify against keyPair2's address
      expect(() => {
        signatureService.verifySignature(keyPair2.address, unicityId, amount, signature);
      }).toThrow('mismatch');
    });

    it('should reject signature with wrong amount', () => {
      const { privateKey, address } = generateKeyPair();
      const unicityId = 'test-id';

      const signature = signMintRequest(privateKey, address, unicityId, 1000000);

      // Try to verify with different amount
      expect(() => {
        signatureService.verifySignature(address, unicityId, 2000000, signature);
      }).toThrow();
    });

    it('should reject signature with wrong unicityId', () => {
      const { privateKey, address } = generateKeyPair();
      const amount = 1000000;

      const signature = signMintRequest(privateKey, address, 'original-id', amount);

      expect(() => {
        signatureService.verifySignature(address, 'different-id', amount, signature);
      }).toThrow();
    });
  });

  describe('createSignature', () => {
    it('should create verifiable signature', () => {
      const { privateKey, address } = generateKeyPair();
      const unicityId = 'test-id';
      const amount = 1000000;

      const signature = signatureService.createSignature(
        privateKey,
        address,
        unicityId,
        amount
      );

      expect(signature).toHaveLength(130);

      // Verify it
      const result = signatureService.verifySignature(address, unicityId, amount, signature);
      expect(result.valid).toBe(true);
    });
  });
});
