import { createHash } from 'crypto';
import elliptic from 'elliptic';
import { MESSAGE_PREFIX } from '../config/constants.js';
import { SignatureError, ValidationError } from '../utils/errors.js';
import AddressService from './AddressService.js';

const ec = new elliptic.ec('secp256k1');

/**
 * Service for ECDSA signature verification
 */
export class SignatureService {
  /**
   * @param {AddressService} addressService
   */
  constructor(addressService = new AddressService()) {
    this.addressService = addressService;
  }

  /**
   * Create the canonical message for signing
   * @param {string} l1Address - Source L1 address
   * @param {string} unicityId - Destination Unicity ID
   * @param {string|number|bigint} amount - Amount in satoshis
   * @returns {string}
   */
  createMessage(l1Address, unicityId, amount) {
    return `${l1Address}:${unicityId}:${amount}`;
  }

  /**
   * Create Bitcoin-style message hash (double SHA256 with prefix)
   * @param {string} message - Message to hash
   * @returns {Buffer} 32-byte hash
   */
  createMessageHash(message) {
    const prefixBytes = Buffer.from(MESSAGE_PREFIX, 'utf8');
    const messageBytes = Buffer.from(message, 'utf8');

    // Varint length encoding
    const prefixLenBuf = this._encodeVarInt(prefixBytes.length);
    const messageLenBuf = this._encodeVarInt(messageBytes.length);

    const fullMessage = Buffer.concat([
      prefixLenBuf,
      prefixBytes,
      messageLenBuf,
      messageBytes
    ]);

    // Double SHA256
    const hash1 = createHash('sha256').update(fullMessage).digest();
    const hash2 = createHash('sha256').update(hash1).digest();

    return hash2;
  }

  /**
   * Encode integer as Bitcoin varint
   * @param {number} n
   * @returns {Buffer}
   */
  _encodeVarInt(n) {
    if (n < 253) {
      return Buffer.from([n]);
    } else if (n < 0x10000) {
      const buf = Buffer.alloc(3);
      buf[0] = 253;
      buf.writeUInt16LE(n, 1);
      return buf;
    } else if (n < 0x100000000) {
      const buf = Buffer.alloc(5);
      buf[0] = 254;
      buf.writeUInt32LE(n, 1);
      return buf;
    }
    throw new Error('VarInt too large');
  }

  /**
   * Parse signature from hex string
   * Expected format: 65 bytes = 1 byte recovery header + 32 bytes r + 32 bytes s
   * @param {string} signatureHex
   * @returns {{v: number, r: string, s: string, recoveryParam: number}}
   */
  parseSignature(signatureHex) {
    // Remove 0x prefix if present
    const cleanSig = signatureHex.startsWith('0x')
      ? signatureHex.slice(2)
      : signatureHex;

    // Validate format
    if (!/^[0-9a-fA-F]+$/.test(cleanSig)) {
      throw new ValidationError('Signature must be valid hex');
    }

    if (cleanSig.length !== 130) {
      throw new ValidationError('Signature must be 65 bytes (130 hex characters)');
    }

    const v = parseInt(cleanSig.slice(0, 2), 16);
    const r = cleanSig.slice(2, 66);
    const s = cleanSig.slice(66, 130);

    // Calculate recovery parameter
    // For P2WPKH (SegWit) with compressed keys:
    // v = 27 + recoveryParam + 4 (compressed) + 12 (segwit) = 43 + recoveryParam
    // Or standard: v = 27 + recoveryParam + 4 (compressed) = 31 + recoveryParam
    let recoveryParam;

    if (v >= 39 && v <= 42) {
      // SegWit compressed (39-42)
      recoveryParam = v - 39;
    } else if (v >= 31 && v <= 34) {
      // Standard compressed (31-34)
      recoveryParam = v - 31;
    } else if (v >= 27 && v <= 30) {
      // Uncompressed (27-30) - we require compressed
      throw new ValidationError('Uncompressed signatures not supported');
    } else {
      throw new ValidationError(`Invalid recovery parameter v=${v}`);
    }

    // Validate r and s ranges
    const curveOrder = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    const rBN = BigInt('0x' + r);
    const sBN = BigInt('0x' + s);

    if (rBN === 0n || rBN >= curveOrder) {
      throw new ValidationError('Signature r value out of range');
    }

    if (sBN === 0n || sBN >= curveOrder) {
      throw new ValidationError('Signature s value out of range');
    }

    // Check low-S (BIP-62)
    const halfOrder = curveOrder / 2n;
    if (sBN > halfOrder) {
      throw new ValidationError('Signature s value not normalized (BIP-62)');
    }

    return { v, r, s, recoveryParam };
  }

  /**
   * Verify a mint request signature
   * @param {string} l1Address - Claimed source L1 address
   * @param {string} unicityId - Destination Unicity ID
   * @param {string|number|bigint} amount - Amount in satoshis
   * @param {string} signatureHex - 65-byte signature in hex
   * @returns {{valid: boolean, recoveredPublicKey?: string, derivedAddress?: string}}
   */
  verifySignature(l1Address, unicityId, amount, signatureHex) {
    // Validate address format
    const addrValidation = this.addressService.validateAddress(l1Address);
    if (!addrValidation.valid) {
      throw new ValidationError(`Invalid L1 address: ${addrValidation.error}`);
    }

    // Parse signature
    const { r, s, recoveryParam } = this.parseSignature(signatureHex);

    // Create message hash
    const message = this.createMessage(l1Address, unicityId, amount);
    const messageHash = this.createMessageHash(message);

    // Recover public key from signature
    let recoveredPoint;
    try {
      recoveredPoint = ec.recoverPubKey(
        messageHash,
        { r, s },
        recoveryParam
      );
    } catch (err) {
      throw new SignatureError(`Public key recovery failed: ${err.message}`);
    }

    // Get compressed public key
    const recoveredPubKeyHex = recoveredPoint.encodeCompressed('hex');
    const recoveredPubKeyBuffer = Buffer.from(recoveredPubKeyHex, 'hex');

    // Derive Alpha address from recovered public key
    const derivedAddress = this.addressService.publicKeyToAddress(recoveredPubKeyBuffer);

    // Verify address matches
    if (derivedAddress.toLowerCase() !== addrValidation.normalized) {
      throw new SignatureError(
        `Address mismatch: derived ${derivedAddress}, claimed ${l1Address}`
      );
    }

    // Defense in depth: verify signature mathematically
    const keyPair = ec.keyFromPublic(recoveredPoint);
    const isValid = keyPair.verify(messageHash, { r, s });

    if (!isValid) {
      throw new SignatureError('Mathematical signature verification failed');
    }

    return {
      valid: true,
      recoveredPublicKey: recoveredPubKeyHex,
      derivedAddress
    };
  }

  /**
   * Create a signature for testing purposes
   * @param {string} privateKeyHex - Private key in hex
   * @param {string} l1Address
   * @param {string} unicityId
   * @param {string|number|bigint} amount
   * @returns {string} Signature hex
   */
  createSignature(privateKeyHex, l1Address, unicityId, amount) {
    const message = this.createMessage(l1Address, unicityId, amount);
    const messageHash = this.createMessageHash(message);

    const keyPair = ec.keyFromPrivate(privateKeyHex, 'hex');
    const signature = keyPair.sign(messageHash, { canonical: true });

    // Get recovery parameter
    const publicKey = keyPair.getPublic();
    let recoveryParam = -1;

    for (let i = 0; i < 4; i++) {
      try {
        const recovered = ec.recoverPubKey(messageHash, signature, i);
        if (recovered.eq(publicKey)) {
          recoveryParam = i;
          break;
        }
      } catch {
        continue;
      }
    }

    if (recoveryParam === -1) {
      throw new Error('Could not determine recovery parameter');
    }

    // Use compressed header (31-34 range)
    const v = (31 + recoveryParam).toString(16).padStart(2, '0');
    const r = signature.r.toString('hex').padStart(64, '0');
    const s = signature.s.toString('hex').padStart(64, '0');

    return v + r + s;
  }
}

export default SignatureService;
