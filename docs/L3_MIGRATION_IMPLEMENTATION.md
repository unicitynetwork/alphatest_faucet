# L3 Migration Feature Implementation Guide

This document provides instructions for implementing the L1-to-L3 ALPHA token migration UI, including checking mintable status and generating signed mint requests.

## Overview

The L3 Migration feature allows users to bridge/clone their L1 ALPHA coins to L3 ALPHT tokens on the Unicity Network. Users prove ownership of L1 coins by signing a message with their private key, and the faucet proxy mints equivalent L3 tokens to their specified Unicity ID.

## Reference Implementation

See the existing implementation in `public/index.html`:
- **HTML Structure**: Lines 1117-1206 (L3 Migration Tab Content)
- **JavaScript Functions**: Lines 14493-14991 (L3 Migration Functions)

## API Endpoints

The faucet proxy exposes the following REST API endpoints:

### 1. Check Balance / Mintable Status

```
GET /api/v1/faucet/balance/:l1_addr
```

**Response:**
```json
{
  "success": true,
  "id": "cde78ded16ef65818a51f43138031c4284e519300ab0cb60c30a8f9078080e5f",
  "name": "alpha_test",
  "symbol": "ALPHT",
  "decimals": 8,
  "l1_addr": "alpha1qw508d6qejxtdg4y5r3zarvary0c5xw7k5ah7p",
  "unicityId": null,
  "amount": 10.5,
  "amountInSmallUnits": 1050000000,
  "initialAmount": 10.5,
  "initialAmountInSmallUnits": 1050000000,
  "spent": false,
  "inSnapshot": true,
  "mintedAt": null
}
```

**Status Interpretation:**
| `inSnapshot` | `spent` | `amount > 0` | Status |
|--------------|---------|--------------|--------|
| `true` | `false` | `true` | **Available** - Can be minted |
| `true` | `true` | - | **Already Minted** - Cannot mint again |
| `false` | - | - | **Not in Snapshot** - Address not eligible |

### 2. Submit Mint Request

```
POST /api/v1/faucet/request
Content-Type: application/json
```

**Request Body:**
```json
{
  "l1_addr": "alpha1qw508d6qejxtdg4y5r3zarvary0c5xw7k5ah7p",
  "unicityId": "0x1234567890abcdef...",
  "amount": 1050000000,
  "signature": "1f4a5b6c7d8e9f..."
}
```

**Parameters:**
- `l1_addr`: Source L1 Alpha address (bech32 format with `alpha1` prefix)
- `unicityId`: Destination L3 Unicity ID (hex string)
- `amount`: Amount in satoshis (1 ALPHA = 100,000,000 satoshis). Must equal full balance.
- `signature`: 65-byte recoverable ECDSA signature in hex (130 characters)

**Success Response:**
```json
{
  "success": true,
  "l1_addr": "alpha1qw508d6qejxtdg4y5r3zarvary0c5xw7k5ah7p",
  "unicityId": "0x1234567890abcdef...",
  "amount": 10.5,
  "amountInSmallUnits": 1050000000,
  "txId": "abc123...",
  "message": "Token minted successfully"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Address has already been minted"
}
```

### 3. Health Check

```
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-01T08:00:00.000Z"
}
```

### 4. Statistics

```
GET /api/v1/faucet/stats
```

**Response:**
```json
{
  "success": true,
  "snapshotBlock": 391057,
  "totalAddresses": 1000,
  "availableAddresses": 750,
  "mintedAddresses": 250,
  "createdAt": "2025-11-30T12:00:00.000Z"
}
```

## Signature Generation

### Message Format

The signed message follows this canonical format:
```
{l1_address}:{unicityId}:{amount}
```

Example:
```
alpha1qw508d6qejxtdg4y5r3zarvary0c5xw7k5ah7p:0x1234abcd:1050000000
```

### Message Hashing (Bitcoin-style)

The message is hashed using Bitcoin's signed message format:

```javascript
const MESSAGE_PREFIX = 'Alpha Signed Message:\n';

function createMessageHash(message) {
    // Encode prefix and message lengths as varints
    function varintBuf(n) {
        if (n < 253) return new Uint8Array([n]);
        if (n < 0x10000) {
            const buf = new Uint8Array(3);
            buf[0] = 253;
            buf[1] = n & 0xff;
            buf[2] = (n >> 8) & 0xff;
            return buf;
        }
        throw new Error('Message too long');
    }

    const prefixBytes = new TextEncoder().encode(MESSAGE_PREFIX);
    const messageBytes = new TextEncoder().encode(message);

    const prefixLen = varintBuf(prefixBytes.length);
    const messageLen = varintBuf(messageBytes.length);

    // Concatenate: prefixLen + prefix + messageLen + message
    const fullMessage = new Uint8Array(
        prefixLen.length + prefixBytes.length +
        messageLen.length + messageBytes.length
    );

    let offset = 0;
    fullMessage.set(prefixLen, offset); offset += prefixLen.length;
    fullMessage.set(prefixBytes, offset); offset += prefixBytes.length;
    fullMessage.set(messageLen, offset); offset += messageLen.length;
    fullMessage.set(messageBytes, offset);

    // Double SHA256
    const hash1 = sha256(fullMessage);
    const hash2 = sha256(hash1);

    return hash2;
}
```

### Signature Format

The signature must be a 65-byte recoverable ECDSA signature:

```
[v: 1 byte][r: 32 bytes][s: 32 bytes] = 65 bytes (130 hex chars)
```

**Recovery Parameter (v):**
- `31-34`: Standard compressed key signature (v = 31 + recoveryParam)
- `39-42`: SegWit compressed key signature (v = 39 + recoveryParam)

**Requirements:**
- Use compressed public keys
- Signature must be normalized (low-S per BIP-62)
- The `canonical: true` option in elliptic.js ensures this

### Signing Implementation

```javascript
function signMessage(privateKeyHex, message) {
    const ec = new elliptic.ec('secp256k1');
    const keyPair = ec.keyFromPrivate(privateKeyHex, 'hex');

    const messageHash = createMessageHash(message);

    // Sign with canonical (low-S) signature
    const signature = keyPair.sign(messageHash, { canonical: true });

    // Find recovery parameter
    const pubKey = keyPair.getPublic();
    let recoveryParam = -1;

    for (let i = 0; i < 4; i++) {
        try {
            const recovered = ec.recoverPubKey(messageHash, signature, i);
            if (recovered.eq(pubKey)) {
                recoveryParam = i;
                break;
            }
        } catch (e) {
            continue;
        }
    }

    if (recoveryParam === -1) {
        throw new Error('Could not find recovery parameter');
    }

    // Format: v (1 byte) + r (32 bytes) + s (32 bytes)
    const v = 31 + recoveryParam; // Compressed key indicator
    const r = signature.r.toString('hex').padStart(64, '0');
    const s = signature.s.toString('hex').padStart(64, '0');

    return v.toString(16).padStart(2, '0') + r + s;
}
```

## UI Implementation Guide

### 1. Mintable Status View

Display a list/table showing all user addresses with their mintable status:

```html
<table>
    <thead>
        <tr>
            <th>Address</th>
            <th>Mintable Amount</th>
            <th>Status</th>
        </tr>
    </thead>
    <tbody id="balance-list">
        <!-- Populated dynamically -->
    </tbody>
</table>
```

**Status Display Logic:**

```javascript
async function checkBalance(address) {
    const response = await fetch(`${proxyUrl}/api/v1/faucet/balance/${address}`);
    const data = await response.json();

    let status, statusClass;

    if (data.spent) {
        status = 'Already Minted';
        statusClass = 'status-minted';
    } else if (data.inSnapshot && data.amount > 0) {
        status = 'Available';
        statusClass = 'status-available';
    } else {
        status = 'Not in Snapshot';
        statusClass = 'status-unavailable';
    }

    return { ...data, status, statusClass };
}
```

### 2. Mint Request Form

The mint form should include:

```html
<form id="mint-form">
    <!-- Source Address Selector -->
    <label>Source L1 Address</label>
    <select id="source-address">
        <!-- Populated with addresses that have status "Available" -->
    </select>

    <!-- Amount (readonly, auto-filled from balance) -->
    <label>Amount</label>
    <input type="text" id="mint-amount" readonly>

    <!-- Destination Unicity ID -->
    <label>Destination Unicity ID</label>
    <input type="text" id="unicity-id" placeholder="Enter your L3 Unicity ID (hex)">

    <!-- Submit Button -->
    <button type="submit">Sign & Mint Tokens</button>

    <!-- Result Display -->
    <div id="mint-result"></div>
</form>
```

### 3. Complete Mint Flow

```javascript
async function mintTokens() {
    // 1. Get form values
    const sourceAddress = document.getElementById('source-address').value;
    const unicityId = document.getElementById('unicity-id').value.trim();
    const amountSatoshis = parseInt(selectedOption.dataset.satoshis);

    // 2. Validate inputs
    if (!unicityId) {
        showError('Please enter a Unicity ID');
        return;
    }

    // 3. Derive private key for the selected address
    const privateKey = derivePrivateKey(sourceAddress);

    // 4. Create and sign the message
    const message = `${sourceAddress}:${unicityId}:${amountSatoshis}`;
    const signature = signMessage(privateKey, message);

    // 5. Submit to proxy
    const response = await fetch(`${proxyUrl}/api/v1/faucet/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            l1_addr: sourceAddress,
            unicityId: unicityId,
            amount: amountSatoshis,
            signature: signature
        })
    });

    const result = await response.json();

    // 6. Display result
    if (result.success) {
        showSuccess(`Minted ${result.amount} ALPHT. TxID: ${result.txId}`);
        // Refresh balances
        await checkAllBalances();
    } else {
        showError(result.error);
    }
}
```

## Key Derivation

For HD wallets, derive child private keys using BIP32:

```javascript
function deriveKeyBIP32(parentKey, parentChainCode, index, hardened = false) {
    const secp256k1_n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

    let data;
    if (hardened) {
        // Hardened: 0x00 || parentKey || index (with 0x80000000 added)
        data = concat([0x00, parentKey, index + 0x80000000]);
    } else {
        // Non-hardened: compressedPubKey || index
        const pubKey = getCompressedPublicKey(parentKey);
        data = concat([pubKey, index]);
    }

    // HMAC-SHA512
    const I = hmacSHA512(parentChainCode, data);
    const IL = I.slice(0, 32);  // Child key material
    const IR = I.slice(32);     // Child chain code

    // Child key = (IL + parentKey) mod n
    const childKey = (BigInt('0x' + IL) + BigInt('0x' + parentKey)) % secp256k1_n;

    return {
        key: childKey.toString(16).padStart(64, '0'),
        chainCode: IR
    };
}
```

## Error Handling

Handle these common error scenarios:

| Error | Cause | User Message |
|-------|-------|--------------|
| `Address not found in snapshot` | Address wasn't in the L1 snapshot | "This address is not eligible for migration" |
| `Address has already been minted` | Tokens already claimed | "This address has already been migrated" |
| `Amount mismatch` | Requested amount != full balance | "You must migrate the full balance" |
| `Address mismatch` | Signature from wrong key | "Signature verification failed" |
| `Invalid signature` | Malformed signature | "Invalid signature format" |

## Security Considerations

1. **Never expose private keys** - All signing must happen client-side
2. **Validate all inputs** - Check address format, amounts, signature format before submission
3. **Use HTTPS** - All API calls should be over HTTPS
4. **One-time minting** - Each L1 address can only mint once (enforced server-side)
5. **Full balance only** - Partial mints are not allowed (enforced server-side)

## Testing

Use the test fixtures in `tests/fixtures/addressGenerator.js` to generate test keypairs:

```javascript
import { generateKeyPair, signMintRequest } from './tests/fixtures/addressGenerator.js';

// Generate a test keypair
const { privateKey, publicKey, address } = generateKeyPair();

// Sign a mint request
const signature = signMintRequest(privateKey, address, unicityId, amount);
```

## Dependencies

**Browser/Frontend:**
- `elliptic.js` - ECDSA signing (secp256k1)
- `CryptoJS` or Web Crypto API - SHA256, HMAC-SHA512

**Backend (Node.js):**
- `elliptic` - ECDSA verification
- `bech32` - Address encoding/decoding
- `better-sqlite3` - Database

## Configuration

Default faucet proxy URL:
```javascript
const L3_DEFAULT_PROXY = 'https://alpha-migri.dyndns.org';
```

Message signing prefix (must match server):
```javascript
const MESSAGE_PREFIX = 'Alpha Signed Message:\n';
```

Token configuration:
```javascript
const TOKEN_CONFIG = {
    id: 'cde78ded16ef65818a51f43138031c4284e519300ab0cb60c30a8f9078080e5f',
    symbol: 'ALPHT',
    decimals: 8
};
```
