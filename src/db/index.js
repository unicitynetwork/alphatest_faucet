import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

/**
 * Initialize SQLite database with schema
 * @param {string} dbPath - Path to database file
 * @returns {Database} - SQLite database instance
 */
export function initDatabase(dbPath) {
  // Ensure directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    -- Balance snapshot table
    CREATE TABLE IF NOT EXISTS balances (
      l1_address TEXT PRIMARY KEY,
      initial_amount INTEGER NOT NULL,
      spent INTEGER NOT NULL DEFAULT 0,
      unicity_id TEXT,
      mint_tx_id TEXT,
      minted_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Snapshot metadata (single row)
    CREATE TABLE IF NOT EXISTS snapshot_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      block_height INTEGER NOT NULL,
      fulcrum_endpoint TEXT,
      faucet_endpoint TEXT,
      address_count INTEGER DEFAULT 0,
      total_amount INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Mint request audit log
    CREATE TABLE IF NOT EXISTS mint_requests (
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

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_balances_spent ON balances(spent);
    CREATE INDEX IF NOT EXISTS idx_mint_requests_address ON mint_requests(l1_address);
    CREATE INDEX IF NOT EXISTS idx_mint_requests_status ON mint_requests(status);
  `);

  return db;
}

/**
 * Check if database file exists
 * @param {string} dbPath - Path to database file
 * @returns {boolean}
 */
export function databaseExists(dbPath) {
  return existsSync(dbPath);
}

export default { initDatabase, databaseExists };
