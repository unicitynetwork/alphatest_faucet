# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

L1-to-L3 ALPHA Test Faucet Proxy - enables holders of L1 ALPHA coins to mint equivalent L3 ALPHA_TEST tokens by proving ownership via cryptographic signatures.

## Tech Stack

- **Runtime**: Node.js 20+ (ES modules)
- **Framework**: Fastify 4.x
- **Database**: SQLite via better-sqlite3
- **Crypto**: elliptic.js (secp256k1), bech32
- **HTTP Client**: undici
- **Testing**: Vitest

## Commands

```bash
# Install dependencies
npm install

# Run development server (with auto-reload)
npm run dev

# Run production server
npm start

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run a single test file
npx vitest run tests/unit/signatureService.test.js

# Run tests matching a pattern
npx vitest run -t "should verify valid signature"

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Lint and auto-fix
npm run lint:fix
```

### Snapshot & Deployment

```bash
# Create snapshot from Alpha blockchain
node cli/snapshot.js --rpc <rpc-url> --block <block-number>

# Docker deployment (first time or full rebuild)
./scripts/run-container.sh --snapshot <block> --no-ssl --port 8088

# Reset and rescan balances
./scripts/run-container.sh --reset --no-ssl --port 8088 --snapshot <block>

# Database backup/restore
./scripts/backup-db.sh [output-file]
./scripts/restore-db.sh <backup-file>

# Hot-reload HTML changes (no container rebuild needed)
docker cp public/index.html alphatest-faucet:/app/public/index.html
```

## Environment Variables

Copy `.env.example` to `.env`. Key variables:
- `PORT` - Server port (default: 3000)
- `DB_PATH` - SQLite database path (default: ./data/faucet.db)
- `FULCRUM_ENDPOINT` - Electrum WebSocket endpoint
- `FAUCET_ENDPOINT` - Upstream L3 faucet URL
- `ALPHA_RPC_URL/USER/PASS` - Alpha node RPC for snapshot creation

## Architecture

```
src/
├── index.js                 # Fastify server entry point
├── config/
│   ├── index.js             # Configuration loader (env vars)
│   └── constants.js         # Token metadata (ALPHT)
├── api/
│   └── routes.js            # REST endpoints (/balance, /request)
├── services/
│   ├── AddressService.js    # Bech32 alpha1 address handling
│   ├── SignatureService.js  # secp256k1 ECDSA verification
│   ├── BalanceService.js    # Business logic orchestrator
│   └── FaucetProxyService.js # Upstream faucet relay
├── db/
│   ├── index.js             # SQLite initialization
│   └── BalanceRepository.js # Data access layer
└── utils/
    └── errors.js            # Custom error classes

cli/
└── snapshot.js              # UTXO scanning CLI

scripts/
├── run-container.sh         # Docker deployment orchestrator
├── backup-db.sh             # Database backup
├── restore-db.sh            # Database restore
├── entrypoint.sh            # Container entrypoint
└── init-ssl.sh              # Let's Encrypt setup
```

## API Endpoints

- `GET /api/v1/faucet/balance/:l1_addr` - Check mintable balance
- `POST /api/v1/faucet/request` - Submit mint request with signature
- `GET /api/v1/faucet/stats` - Faucet statistics
- `GET /health` - Health check

## Key Concepts

### Signature Verification
Message format: `${l1_address}:${unicityId}:${amount}`
Uses Bitcoin-style message hashing with "Alpha Signed Message:\n" prefix.
65-byte signature with recovery parameter for public key recovery.

### Address Format
- Bech32 with `alpha1` prefix (P2WPKH, witness version 0)
- Derived from: `Bech32("alpha", RIPEMD160(SHA256(compressed_pubkey)))`

### Database
SQLite with tables: `balances` (address snapshots), `snapshot_meta`, `mint_requests` (audit log).
Uses transactions for race condition prevention.

## Token Metadata

```javascript
{
  id: 'cde78ded16ef65818a51f43138031c4284e519300ab0cb60c30a8f9078080e5f',
  name: 'alpha_test',
  symbol: 'ALPHT',
  decimals: 8
}
```
