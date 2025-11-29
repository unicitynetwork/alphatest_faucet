import { bech32 } from 'bech32';
import { createHash } from 'crypto';
import { ADDRESS_CONFIG } from '../config/constants.js';
import { ValidationError } from '../utils/errors.js';

/**
 * Service for handling Alpha L1 addresses (Bech32 format)
 */
export class AddressService {
  constructor(hrp = ADDRESS_CONFIG.hrp) {
    this.hrp = hrp;
    this.witnessVersion = ADDRESS_CONFIG.witnessVersion;
  }

  /**
   * Validate an Alpha address format
   * @param {string} address - L1 Alpha address
   * @returns {{valid: boolean, error?: string, normalized?: string}}
   */
  validateAddress(address) {
    if (typeof address !== 'string') {
      return { valid: false, error: 'Address must be a string' };
    }

    // Normalize to lowercase
    const normalized = address.toLowerCase();

    // Check prefix
    if (!normalized.startsWith(this.hrp + '1')) {
      return { valid: false, error: `Address must start with ${this.hrp}1` };
    }

    // Check length (prefix + separator + data + checksum)
    if (normalized.length < 14 || normalized.length > 74) {
      return { valid: false, error: 'Invalid address length' };
    }

    // Validate characters
    const validChars = /^[a-z]+1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;
    if (!validChars.test(normalized)) {
      return { valid: false, error: 'Address contains invalid characters' };
    }

    // Decode and verify checksum
    try {
      const decoded = bech32.decode(normalized);

      if (decoded.prefix !== this.hrp) {
        return { valid: false, error: 'Invalid HRP' };
      }

      // Convert 5-bit words to bytes
      const data = bech32.fromWords(decoded.words.slice(1));

      // Check witness version
      if (decoded.words[0] !== this.witnessVersion) {
        return { valid: false, error: 'Invalid witness version' };
      }

      // P2WPKH expects 20-byte pubkey hash
      if (data.length !== 20) {
        return { valid: false, error: 'Invalid witness program length' };
      }

      return { valid: true, normalized };
    } catch (err) {
      return { valid: false, error: `Bech32 decode failed: ${err.message}` };
    }
  }

  /**
   * Decode a Bech32 address to get the pubkey hash
   * @param {string} address - L1 Alpha address
   * @returns {{witnessVersion: number, pubKeyHash: Buffer}}
   */
  decodeAddress(address) {
    const validation = this.validateAddress(address);
    if (!validation.valid) {
      throw new ValidationError(validation.error);
    }

    const decoded = bech32.decode(validation.normalized);
    const witnessVersion = decoded.words[0];
    const pubKeyHash = Buffer.from(bech32.fromWords(decoded.words.slice(1)));

    return { witnessVersion, pubKeyHash };
  }

  /**
   * Encode a public key hash to Alpha address
   * @param {Buffer} pubKeyHash - 20-byte RIPEMD160(SHA256(pubkey))
   * @returns {string} Bech32 address
   */
  encodeAddress(pubKeyHash) {
    if (pubKeyHash.length !== 20) {
      throw new ValidationError('Public key hash must be 20 bytes');
    }

    const words = bech32.toWords(pubKeyHash);
    // Prepend witness version
    words.unshift(this.witnessVersion);

    return bech32.encode(this.hrp, words);
  }

  /**
   * Derive address from compressed public key
   * @param {Buffer|string} publicKey - 33-byte compressed public key
   * @returns {string} Bech32 address
   */
  publicKeyToAddress(publicKey) {
    const pubKeyBuffer = typeof publicKey === 'string'
      ? Buffer.from(publicKey, 'hex')
      : publicKey;

    if (pubKeyBuffer.length !== 33) {
      throw new ValidationError('Public key must be 33 bytes (compressed)');
    }

    // HASH160 = RIPEMD160(SHA256(pubkey))
    const sha256Hash = createHash('sha256').update(pubKeyBuffer).digest();
    const pubKeyHash = createHash('ripemd160').update(sha256Hash).digest();

    return this.encodeAddress(pubKeyHash);
  }

  /**
   * Compute script hash for Electrum/Fulcrum queries
   * P2WPKH script: OP_0 <20-byte-pubkey-hash>
   * @param {string} address - L1 Alpha address
   * @returns {string} Hex script hash (reversed)
   */
  computeScriptHash(address) {
    const { pubKeyHash } = this.decodeAddress(address);

    // P2WPKH script: 0x00 0x14 <20-byte-hash>
    const script = Buffer.concat([
      Buffer.from([0x00, 0x14]),
      pubKeyHash
    ]);

    // SHA256 hash
    const hash = createHash('sha256').update(script).digest();

    // Reverse for Electrum protocol (little-endian)
    return Buffer.from(hash).reverse().toString('hex');
  }

  /**
   * Verify that a public key corresponds to an address
   * @param {Buffer|string} publicKey - Compressed public key
   * @param {string} address - L1 Alpha address
   * @returns {boolean}
   */
  verifyPublicKeyMatchesAddress(publicKey, address) {
    try {
      const derivedAddress = this.publicKeyToAddress(publicKey);
      return derivedAddress.toLowerCase() === address.toLowerCase();
    } catch {
      return false;
    }
  }
}

export default AddressService;
