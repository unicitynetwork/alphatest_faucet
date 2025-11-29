import { DatabaseError } from '../utils/errors.js';

/**
 * Repository for balance-related database operations
 */
export class BalanceRepository {
  /**
   * @param {import('better-sqlite3').Database} db - SQLite database instance
   */
  constructor(db) {
    this.db = db;
    this._prepareStatements();
  }

  /**
   * Prepare reusable SQL statements for performance
   */
  _prepareStatements() {
    this.stmts = {
      findByAddress: this.db.prepare(
        'SELECT * FROM balances WHERE l1_address = ? COLLATE NOCASE'
      ),
      insertBalance: this.db.prepare(`
        INSERT INTO balances (l1_address, initial_amount, spent, created_at)
        VALUES (?, ?, 0, datetime('now'))
      `),
      markAsSpent: this.db.prepare(`
        UPDATE balances
        SET spent = 1,
            unicity_id = ?,
            mint_tx_id = ?,
            minted_at = datetime('now')
        WHERE l1_address = ? COLLATE NOCASE AND spent = 0
      `),
      countUnspent: this.db.prepare(
        'SELECT COUNT(*) as count FROM balances WHERE spent = 0'
      ),
      countTotal: this.db.prepare(
        'SELECT COUNT(*) as count FROM balances'
      ),
      getSnapshotMeta: this.db.prepare(
        'SELECT * FROM snapshot_meta WHERE id = 1'
      ),
      setSnapshotMeta: this.db.prepare(`
        INSERT OR REPLACE INTO snapshot_meta
        (id, block_height, fulcrum_endpoint, faucet_endpoint, address_count, total_amount, created_at)
        VALUES (1, ?, ?, ?, ?, ?, datetime('now'))
      `),
      insertMintRequest: this.db.prepare(`
        INSERT INTO mint_requests
        (l1_address, unicity_id, amount, signature, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', datetime('now'))
      `),
      updateMintRequest: this.db.prepare(`
        UPDATE mint_requests
        SET status = ?, error_message = ?, faucet_response = ?, processed_at = datetime('now')
        WHERE id = ?
      `)
    };
  }

  /**
   * Find balance record by L1 address
   * @param {string} l1Address - L1 Alpha address
   * @returns {Object|null} Balance record or null
   */
  findByAddress(l1Address) {
    try {
      return this.stmts.findByAddress.get(l1Address) || null;
    } catch (err) {
      throw new DatabaseError(`Failed to find address: ${err.message}`);
    }
  }

  /**
   * Insert a new balance record
   * @param {string} l1Address - L1 Alpha address
   * @param {bigint|number} amount - Balance in satoshis
   */
  insertBalance(l1Address, amount) {
    try {
      this.stmts.insertBalance.run(l1Address, BigInt(amount).toString());
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new DatabaseError(`Address ${l1Address} already exists in snapshot`);
      }
      throw new DatabaseError(`Failed to insert balance: ${err.message}`);
    }
  }

  /**
   * Insert multiple balances in a transaction
   * @param {Array<{address: string, amount: bigint}>} balances
   */
  insertBalancesBatch(balances) {
    const insertMany = this.db.transaction((items) => {
      for (const { address, amount } of items) {
        this.stmts.insertBalance.run(address, BigInt(amount).toString());
      }
    });

    try {
      insertMany(balances);
    } catch (err) {
      throw new DatabaseError(`Batch insert failed: ${err.message}`);
    }
  }

  /**
   * Mark an address as spent (minted)
   * Uses atomic update to prevent race conditions
   * @param {string} l1Address - L1 Alpha address
   * @param {string} unicityId - L3 destination
   * @param {string} mintTxId - Upstream faucet transaction ID
   * @returns {boolean} True if update succeeded
   */
  markAsSpent(l1Address, unicityId, mintTxId) {
    try {
      const result = this.stmts.markAsSpent.run(unicityId, mintTxId, l1Address);
      return result.changes === 1;
    } catch (err) {
      throw new DatabaseError(`Failed to mark as spent: ${err.message}`);
    }
  }

  /**
   * Atomically mark as spent with double-check
   * Uses transaction for race condition safety
   * @param {string} l1Address
   * @param {string} unicityId
   * @param {string} mintTxId
   * @returns {{success: boolean, record: Object|null}}
   */
  atomicMarkAsSpent(l1Address, unicityId, mintTxId) {
    const txn = this.db.transaction(() => {
      // Check current state
      const record = this.stmts.findByAddress.get(l1Address);

      if (!record) {
        return { success: false, error: 'not_found', record: null };
      }

      if (record.spent === 1) {
        return { success: false, error: 'already_minted', record };
      }

      // Mark as spent
      const result = this.stmts.markAsSpent.run(unicityId, mintTxId, l1Address);

      if (result.changes !== 1) {
        return { success: false, error: 'race_condition', record };
      }

      return { success: true, record };
    });

    try {
      return txn.immediate();
    } catch (err) {
      throw new DatabaseError(`Atomic update failed: ${err.message}`);
    }
  }

  /**
   * Get count of unspent addresses
   * @returns {number}
   */
  countUnspent() {
    return this.stmts.countUnspent.get().count;
  }

  /**
   * Get total address count
   * @returns {number}
   */
  countTotal() {
    return this.stmts.countTotal.get().count;
  }

  /**
   * Get snapshot metadata
   * @returns {Object|null}
   */
  getSnapshotMeta() {
    return this.stmts.getSnapshotMeta.get() || null;
  }

  /**
   * Set snapshot metadata
   * @param {number} blockHeight
   * @param {string} fulcrumEndpoint
   * @param {string} faucetEndpoint
   * @param {number} addressCount
   * @param {bigint} totalAmount
   */
  setSnapshotMeta(blockHeight, fulcrumEndpoint, faucetEndpoint, addressCount, totalAmount) {
    try {
      this.stmts.setSnapshotMeta.run(
        blockHeight,
        fulcrumEndpoint,
        faucetEndpoint,
        addressCount,
        BigInt(totalAmount).toString()
      );
    } catch (err) {
      throw new DatabaseError(`Failed to set snapshot meta: ${err.message}`);
    }
  }

  /**
   * Log a mint request
   * @param {string} l1Address
   * @param {string} unicityId
   * @param {bigint} amount
   * @param {string} signature
   * @returns {number} Request ID
   */
  logMintRequest(l1Address, unicityId, amount, signature) {
    try {
      const result = this.stmts.insertMintRequest.run(
        l1Address,
        unicityId,
        BigInt(amount).toString(),
        signature
      );
      return result.lastInsertRowid;
    } catch (err) {
      throw new DatabaseError(`Failed to log mint request: ${err.message}`);
    }
  }

  /**
   * Update mint request status
   * @param {number} requestId
   * @param {string} status - 'success' | 'failed'
   * @param {string|null} errorMessage
   * @param {string|null} faucetResponse
   */
  updateMintRequest(requestId, status, errorMessage = null, faucetResponse = null) {
    try {
      this.stmts.updateMintRequest.run(status, errorMessage, faucetResponse, requestId);
    } catch (err) {
      throw new DatabaseError(`Failed to update mint request: ${err.message}`);
    }
  }

  /**
   * Close database connection
   */
  close() {
    this.db.close();
  }
}

export default BalanceRepository;
