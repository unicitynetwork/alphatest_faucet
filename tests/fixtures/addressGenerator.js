import { randomBytes, createHash } from 'crypto';
import elliptic from 'elliptic';
import { bech32 } from 'bech32';

const ec = new elliptic.ec('secp256k1');

/**
 * Generate a random L1 Alpha keypair for testing
 * @returns {{privateKey: string, publicKey: string, address: string}}
 */
export function generateKeyPair() {
  // Generate random private key
  let privateKey;
  let keyPair;

  do {
    privateKey = randomBytes(32);
    try {
      keyPair = ec.keyFromPrivate(privateKey);
      // Verify it's a valid key
      keyPair.getPublic();
    } catch {
      keyPair = null;
    }
  } while (!keyPair);

  // Get compressed public key
  const publicKey = keyPair.getPublic(true, 'hex');

  // Derive address
  const address = publicKeyToAddress(publicKey);

  return {
    privateKey: privateKey.toString('hex'),
    publicKey,
    address
  };
}

/**
 * Convert compressed public key to Alpha address
 * @param {string} publicKeyHex - 33-byte compressed public key in hex
 * @returns {string} Bech32 address with alpha1 prefix
 */
export function publicKeyToAddress(publicKeyHex) {
  const pubKeyBuffer = Buffer.from(publicKeyHex, 'hex');

  // HASH160 = RIPEMD160(SHA256(pubkey))
  const sha256Hash = createHash('sha256').update(pubKeyBuffer).digest();
  const pubKeyHash = createHash('ripemd160').update(sha256Hash).digest();

  // Convert to 5-bit words
  const words = bech32.toWords(pubKeyHash);

  // Prepend witness version 0
  words.unshift(0);

  // Encode with alpha prefix
  return bech32.encode('alpha', words);
}

/**
 * Generate multiple test balances
 * @param {number} count - Number of addresses to generate
 * @param {Object} options - Generation options
 * @returns {Array<{address: string, balance: bigint, keyPair: Object}>}
 */
export function generateTestBalances(count, options = {}) {
  const {
    minBalance = 1_000_000n,        // 0.01 ALPHA
    maxBalance = 100_000_000_000n   // 1000 ALPHA
  } = options;

  const balances = [];
  const range = maxBalance - minBalance;

  for (let i = 0; i < count; i++) {
    const keyPair = generateKeyPair();

    // Generate random balance in range
    const randomValue = BigInt('0x' + randomBytes(8).toString('hex'));
    const balance = minBalance + (randomValue % range);

    balances.push({
      address: keyPair.address,
      balance,
      keyPair
    });
  }

  return balances;
}

/**
 * Create a signature for a mint request
 * @param {string} privateKeyHex - Private key in hex
 * @param {string} l1Address - L1 Alpha address
 * @param {string} unicityId - Destination Unicity ID
 * @param {string|number|bigint} amount - Amount in satoshis
 * @returns {string} 65-byte signature in hex
 */
export function signMintRequest(privateKeyHex, l1Address, unicityId, amount) {
  const message = `${l1Address}:${unicityId}:${amount}`;
  const messageHash = createMessageHash(message);

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

/**
 * Create Bitcoin-style message hash
 */
function createMessageHash(message) {
  const prefix = 'Alpha Signed Message:\n';
  const prefixBytes = Buffer.from(prefix, 'utf8');
  const messageBytes = Buffer.from(message, 'utf8');

  const fullMessage = Buffer.concat([
    Buffer.from([prefixBytes.length]),
    prefixBytes,
    Buffer.from([messageBytes.length]),
    messageBytes
  ]);

  const hash1 = createHash('sha256').update(fullMessage).digest();
  const hash2 = createHash('sha256').update(hash1).digest();

  return hash2;
}

export default {
  generateKeyPair,
  publicKeyToAddress,
  generateTestBalances,
  signMintRequest
};
