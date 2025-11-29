# Frontend Integration Guide

## API Endpoints

Base URL: `https://your-faucet-domain.com` or `http://localhost:3000`

### Check Balance

**GET** `/api/v1/faucet/balance/:l1_addr`

Check if an L1 address has balance available for minting.

```javascript
const response = await fetch(`/api/v1/faucet/balance/${address}`);
const data = await response.json();

// Response:
{
  "success": true,
  "id": "cde78ded16ef65818a51f43138031c4284e519300ab0cb60c30a8f9078080e5f",
  "name": "alpha_test",
  "symbol": "ALPHT",
  "decimals": 8,
  "description": "ALPHA testnet coin on Unicity",
  "l1_addr": "alpha1q...",
  "unicityId": null,           // Set after minting
  "amount": 1.5,               // In ALPHT
  "amountInSmallUnits": 150000000,  // In satoshis
  "initialAmount": 1.5,
  "initialAmountInSmallUnits": 150000000,
  "spent": false,              // true if already minted
  "inSnapshot": true           // true if address is in snapshot
}
```

### Submit Mint Request

**POST** `/api/v1/faucet/request`

Submit a signed mint request.

```javascript
const response = await fetch('/api/v1/faucet/request', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    l1_addr: 'alpha1q...',
    unicityId: 'destination-unicity-id-hex',
    amount: 150000000,  // Must equal full balance (satoshis)
    signature: '1f...'  // 65-byte signature in hex
  })
});

// Success response:
{
  "success": true,
  "l1_addr": "alpha1q...",
  "unicityId": "destination-unicity-id-hex",
  "amount": 1.5,
  "amountInSmallUnits": 150000000,
  "txId": "upstream-tx-id",
  "message": "Token minted successfully"
}

// Error response:
{
  "success": false,
  "error": "Error description"
}
```

### Get Statistics

**GET** `/api/v1/faucet/stats`

```javascript
const response = await fetch('/api/v1/faucet/stats');
const data = await response.json();

// Response:
{
  "success": true,
  "snapshotBlock": 123456,
  "totalAddresses": 10000,
  "availableAddresses": 8500,
  "mintedAddresses": 1500,
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

## Signature Generation

### Message Format

The message to sign is a colon-separated string:

```
{l1_address}:{unicityId}:{amount}
```

Example:
```
alpha1qw508d6qejxtdg4y5r3zarvary0c5xw7kxyzabc:0x1234567890abcdef:150000000
```

### Hashing (Bitcoin Message Style)

```javascript
import { createHash } from 'crypto';

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

  // Double SHA256
  const hash1 = createHash('sha256').update(fullMessage).digest();
  const hash2 = createHash('sha256').update(hash1).digest();

  return hash2;
}
```

### Signing with elliptic.js

```javascript
import elliptic from 'elliptic';

const ec = new elliptic.ec('secp256k1');

function signMintRequest(privateKeyHex, l1Address, unicityId, amount) {
  // Create message
  const message = `${l1Address}:${unicityId}:${amount}`;
  const messageHash = createMessageHash(message);

  // Sign
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

  // Format: v (1 byte) + r (32 bytes) + s (32 bytes) = 65 bytes
  // v = 31 + recoveryParam for compressed keys
  const v = (31 + recoveryParam).toString(16).padStart(2, '0');
  const r = signature.r.toString('hex').padStart(64, '0');
  const s = signature.s.toString('hex').padStart(64, '0');

  return v + r + s;
}
```

### Complete Frontend Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>Mint ALPHA Test Tokens</title>
  <script src="https://cdn.jsdelivr.net/npm/elliptic@6.5.4/dist/elliptic.min.js"></script>
</head>
<body>
  <h1>Mint ALPHA Test Tokens</h1>

  <div>
    <label>Private Key (hex):</label>
    <input type="password" id="privateKey" />
  </div>

  <div>
    <label>Destination Unicity ID:</label>
    <input type="text" id="unicityId" />
  </div>

  <button onclick="mint()">Mint Tokens</button>

  <div id="result"></div>

  <script>
    const ec = new elliptic.ec('secp256k1');

    async function mint() {
      const privateKey = document.getElementById('privateKey').value;
      const unicityId = document.getElementById('unicityId').value;

      // Derive address from private key
      const keyPair = ec.keyFromPrivate(privateKey, 'hex');
      const publicKey = keyPair.getPublic(true, 'hex');
      const address = await deriveAddress(publicKey);

      // Get balance
      const balanceRes = await fetch(`/api/v1/faucet/balance/${address}`);
      const balance = await balanceRes.json();

      if (!balance.success || balance.spent) {
        document.getElementById('result').textContent = 'No balance or already minted';
        return;
      }

      const amount = balance.amountInSmallUnits;

      // Sign
      const signature = signMintRequest(privateKey, address, unicityId, amount);

      // Submit
      const mintRes = await fetch('/api/v1/faucet/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          l1_addr: address,
          unicityId: unicityId,
          amount: amount,
          signature: signature
        })
      });

      const result = await mintRes.json();
      document.getElementById('result').textContent = JSON.stringify(result, null, 2);
    }

    // See full implementation for deriveAddress and signMintRequest
  </script>
</body>
</html>
```

## Error Codes

| HTTP Status | Error | Description |
|-------------|-------|-------------|
| 400 | Invalid L1 address | Address format validation failed |
| 400 | Validation error | Missing or invalid request parameters |
| 400 | Signature verification failed | Signature doesn't match address |
| 400 | Amount mismatch | Must mint full balance |
| 404 | Address not found | Address not in snapshot |
| 409 | Already minted | Address has already been minted |
| 502 | Upstream faucet error | Error from faucet.unicity.network |

## Security Considerations

1. **Never expose private keys** - Signing should happen client-side
2. **Validate all inputs** - Check address format before API calls
3. **Handle errors gracefully** - Show user-friendly messages
4. **Use HTTPS** - Encrypt all API communication
5. **Rate limiting** - Implement client-side throttling

## Token Information

| Property | Value |
|----------|-------|
| Token ID | `cde78ded16ef65818a51f43138031c4284e519300ab0cb60c30a8f9078080e5f` |
| Name | alpha_test |
| Symbol | ALPHT |
| Decimals | 8 |
| Network | unicity:testnet |

## Address Format

- **Prefix**: `alpha1`
- **Encoding**: Bech32 (P2WPKH, witness version 0)
- **Example**: `alpha1qw508d6qejxtdg4y5r3zarvary0c5xw7kxyzabc`
