#!/usr/bin/env node

import { program } from 'commander';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { request } from 'undici';
import Database from 'better-sqlite3';

/**
 * Alpha Blockchain UTXO Snapshot CLI
 *
 * Scans the UTXO set at a specific block height and creates a database
 * of address balances for the faucet proxy.
 */

program
  .name('snapshot')
  .description('Create balance snapshot from Alpha blockchain UTXO set')
  .requiredOption('--rpc <url>', 'Alpha full node RPC URL (e.g., http://localhost:8332)')
  .requiredOption('--block <number>', 'Block height for snapshot', parseInt)
  .option('--rpc-user <user>', 'RPC username', '')
  .option('--rpc-pass <pass>', 'RPC password', '')
  .option('--output <path>', 'Database output path', './data/faucet.db')
  .option('--fulcrum <url>', 'Fulcrum endpoint to store in metadata', 'wss://fulcrum.unicity.network:50004')
  .option('--faucet <url>', 'Upstream faucet URL to store in metadata', 'https://faucet.unicity.network/')
  .option('--batch-size <number>', 'Batch size for database inserts', parseInt, 1000)
  .parse();

const opts = program.opts();

/**
 * Make RPC call to Alpha node
 */
async function rpcCall(method, params = []) {
  const auth = opts.rpcUser && opts.rpcPass
    ? Buffer.from(`${opts.rpcUser}:${opts.rpcPass}`).toString('base64')
    : null;

  const headers = {
    'Content-Type': 'application/json'
  };

  if (auth) {
    headers['Authorization'] = `Basic ${auth}`;
  }

  const response = await request(opts.rpc, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    })
  });

  const body = await response.body.json();

  if (body.error) {
    throw new Error(`RPC error: ${body.error.message || JSON.stringify(body.error)}`);
  }

  return body.result;
}

/**
 * Get block hash at height
 */
async function getBlockHash(height) {
  return await rpcCall('getblockhash', [height]);
}

/**
 * Scan UTXO set using scantxoutset
 * This is the most efficient method if the node supports it
 */
async function scanUtxoSet() {
  console.log('Scanning UTXO set...');

  // First, check current block height
  const blockchainInfo = await rpcCall('getblockchaininfo');
  console.log(`Current chain height: ${blockchainInfo.blocks}`);

  if (opts.block > blockchainInfo.blocks) {
    throw new Error(`Block ${opts.block} not yet reached. Current height: ${blockchainInfo.blocks}`);
  }

  // Get block hash at snapshot height
  const blockHash = await getBlockHash(opts.block);
  console.log(`Snapshot block hash: ${blockHash}`);

  // Try scantxoutset first (most efficient)
  try {
    console.log('Attempting scantxoutset scan...');

    // Scan all P2WPKH outputs (alpha1 addresses)
    const scanResult = await rpcCall('scantxoutset', ['start', ['combo(*)']]);

    if (!scanResult) {
      throw new Error('scantxoutset returned null');
    }

    console.log(`Found ${scanResult.unspents?.length || 0} UTXOs`);

    // Aggregate by address
    const balances = new Map();

    for (const utxo of scanResult.unspents || []) {
      // Only include UTXOs that existed at or before our snapshot block
      if (utxo.height > opts.block) {
        continue;
      }

      const address = utxo.scriptPubKey?.address || utxo.address;
      if (!address) continue;

      // Only include alpha1 addresses (P2WPKH)
      if (!address.startsWith('alpha1')) {
        continue;
      }

      const amount = Math.round(utxo.amount * 1e8); // Convert to satoshis
      const current = balances.get(address) || 0n;
      balances.set(address, current + BigInt(amount));
    }

    return { balances, blockHash };
  } catch (err) {
    console.warn(`scantxoutset failed: ${err.message}`);
    console.log('Falling back to block-by-block scan...');
    return await scanBlockByBlock();
  }
}

/**
 * Fallback: Scan blocks one by one
 * This is slower but works on all nodes
 */
async function scanBlockByBlock() {
  const balances = new Map();
  const spent = new Set();

  console.log(`Scanning blocks 0 to ${opts.block}...`);

  for (let height = 0; height <= opts.block; height++) {
    if (height % 1000 === 0) {
      console.log(`Processing block ${height}/${opts.block}...`);
    }

    const blockHash = await getBlockHash(height);
    const block = await rpcCall('getblock', [blockHash, 2]); // verbosity=2 for full tx details

    for (const tx of block.tx) {
      // Process inputs (mark as spent)
      for (const vin of tx.vin) {
        if (vin.txid) {
          const key = `${vin.txid}:${vin.vout}`;
          spent.add(key);
        }
      }

      // Process outputs
      for (let vout = 0; vout < tx.vout.length; vout++) {
        const output = tx.vout[vout];
        const key = `${tx.txid}:${vout}`;

        // Skip if already spent
        if (spent.has(key)) {
          continue;
        }

        const address = output.scriptPubKey?.address ||
                       output.scriptPubKey?.addresses?.[0];

        if (!address || !address.startsWith('alpha1')) {
          continue;
        }

        const amount = Math.round(output.value * 1e8);
        const current = balances.get(address) || 0n;
        balances.set(address, current + BigInt(amount));
      }
    }
  }

  const blockHash = await getBlockHash(opts.block);
  return { balances, blockHash };
}

/**
 * Create database and populate with balances
 */
function createDatabase(balances, blockHash) {
  const dbPath = opts.output;

  // Check if database already exists
  if (existsSync(dbPath)) {
    console.error(`Error: Database ${dbPath} already exists.`);
    console.error('Use a different output path or delete the existing file.');
    process.exit(1);
  }

  // Ensure directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  console.log(`Creating database at ${dbPath}...`);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE balances (
      l1_address TEXT PRIMARY KEY,
      initial_amount INTEGER NOT NULL,
      spent INTEGER NOT NULL DEFAULT 0,
      unicity_id TEXT,
      mint_tx_id TEXT,
      minted_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE snapshot_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      block_height INTEGER NOT NULL,
      fulcrum_endpoint TEXT,
      faucet_endpoint TEXT,
      address_count INTEGER DEFAULT 0,
      total_amount INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE mint_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      l1_address TEXT NOT NULL,
      unicity_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      signature TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      faucet_response TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT
    );

    CREATE INDEX idx_balances_spent ON balances(spent);
    CREATE INDEX idx_mint_requests_address ON mint_requests(l1_address);
    CREATE INDEX idx_mint_requests_status ON mint_requests(status);
  `);

  // Insert balances in batches
  const insertStmt = db.prepare(
    'INSERT INTO balances (l1_address, initial_amount) VALUES (?, ?)'
  );

  const insertBatch = db.transaction((batch) => {
    for (const [address, amount] of batch) {
      insertStmt.run(address, amount.toString());
    }
  });

  console.log(`Inserting ${balances.size} addresses...`);

  let batch = [];
  let totalAmount = 0n;

  for (const [address, amount] of balances) {
    batch.push([address, amount]);
    totalAmount += amount;

    if (batch.length >= opts.batchSize) {
      insertBatch(batch);
      batch = [];
    }
  }

  if (batch.length > 0) {
    insertBatch(batch);
  }

  // Insert metadata
  db.prepare(`
    INSERT INTO snapshot_meta
    (id, block_height, fulcrum_endpoint, faucet_endpoint, address_count, total_amount)
    VALUES (1, ?, ?, ?, ?, ?)
  `).run(
    opts.block,
    opts.fulcrum,
    opts.faucet,
    balances.size,
    totalAmount.toString()
  );

  db.close();

  console.log('');
  console.log('=== Snapshot Complete ===');
  console.log(`Block height: ${opts.block}`);
  console.log(`Block hash: ${blockHash}`);
  console.log(`Total addresses: ${balances.size}`);
  console.log(`Total amount: ${Number(totalAmount) / 1e8} ALPHA`);
  console.log(`Database: ${dbPath}`);
}

/**
 * Main execution
 */
async function main() {
  console.log('Alpha Blockchain UTXO Snapshot Tool');
  console.log('===================================');
  console.log(`RPC endpoint: ${opts.rpc}`);
  console.log(`Target block: ${opts.block}`);
  console.log(`Output: ${opts.output}`);
  console.log('');

  try {
    // Test RPC connection
    console.log('Testing RPC connection...');
    const info = await rpcCall('getblockchaininfo');
    console.log(`Connected to ${info.chain} network`);
    console.log('');

    // Scan UTXO set
    const { balances, blockHash } = await scanUtxoSet();

    if (balances.size === 0) {
      console.warn('Warning: No addresses found with balance');
    }

    // Create database
    createDatabase(balances, blockHash);

    process.exit(0);
  } catch (err) {
    console.error('');
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
