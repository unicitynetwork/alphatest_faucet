import { TOKEN_CONFIG, SATOSHIS_PER_COIN } from '../config/constants.js';
import {
  NotFoundError,
  AlreadyMintedError,
  ValidationError
} from '../utils/errors.js';

/**
 * Business logic service for balance operations
 */
export class BalanceService {
  /**
   * @param {import('../db/BalanceRepository.js').BalanceRepository} balanceRepo
   * @param {import('./SignatureService.js').SignatureService} signatureService
   * @param {import('./FaucetProxyService.js').FaucetProxyService} faucetProxy
   */
  constructor(balanceRepo, signatureService, faucetProxy) {
    this.balanceRepo = balanceRepo;
    this.signatureService = signatureService;
    this.faucetProxy = faucetProxy;
  }

  /**
   * Get balance information for an L1 address
   * @param {string} l1Address - L1 Alpha address
   * @returns {Object} Balance info with token metadata
   */
  getBalance(l1Address) {
    const record = this.balanceRepo.findByAddress(l1Address);

    if (!record) {
      // Address not in snapshot - return zero balance
      return {
        success: true,
        ...TOKEN_CONFIG,
        l1_addr: l1Address,
        unicityId: null,
        amount: 0,
        amountInSmallUnits: 0,
        initialAmount: 0,
        initialAmountInSmallUnits: 0,
        spent: false,
        inSnapshot: false
      };
    }

    const initialAmount = BigInt(record.initial_amount);
    const spent = record.spent === 1;
    const currentAmount = spent ? 0n : initialAmount;

    return {
      success: true,
      ...TOKEN_CONFIG,
      l1_addr: record.l1_address,
      unicityId: record.unicity_id,
      amount: Number(currentAmount) / Number(SATOSHIS_PER_COIN),
      amountInSmallUnits: Number(currentAmount),
      initialAmount: Number(initialAmount) / Number(SATOSHIS_PER_COIN),
      initialAmountInSmallUnits: Number(initialAmount),
      spent,
      inSnapshot: true,
      mintedAt: record.minted_at
    };
  }

  /**
   * Process a mint request
   * @param {string} l1Address - Source L1 address
   * @param {string} unicityId - Destination L3 Unicity ID
   * @param {number|bigint} amount - Amount in satoshis
   * @param {string} signature - 65-byte signature in hex
   * @returns {Promise<Object>} Mint result
   */
  async processMintRequest(l1Address, unicityId, amount, signature) {
    // Validate unicityId format
    if (!unicityId || typeof unicityId !== 'string' || unicityId.length < 1) {
      throw new ValidationError('Invalid unicityId');
    }

    // Validate amount
    const amountBigInt = BigInt(amount);
    if (amountBigInt <= 0n) {
      throw new ValidationError('Amount must be positive');
    }

    // Log the request
    const requestId = this.balanceRepo.logMintRequest(
      l1Address,
      unicityId,
      amountBigInt,
      signature
    );

    try {
      // 1. Check if address exists and has balance
      const record = this.balanceRepo.findByAddress(l1Address);

      if (!record) {
        throw new NotFoundError('Address not found in snapshot');
      }

      // 2. Check if already minted
      if (record.spent === 1) {
        throw new AlreadyMintedError(
          `Address ${l1Address} has already been minted to ${record.unicity_id}`
        );
      }

      // 3. Validate amount equals full balance (no partial mints)
      const initialAmount = BigInt(record.initial_amount);
      if (amountBigInt !== initialAmount) {
        throw new ValidationError(
          `Amount mismatch: must mint full balance. Requested ${amountBigInt}, available ${initialAmount}`
        );
      }

      // 4. Verify signature
      this.signatureService.verifySignature(l1Address, unicityId, amount, signature);

      // 5. Atomically mark as spent (prevents race conditions)
      // Use a placeholder txId until we get the real one from upstream
      const atomicResult = this.balanceRepo.atomicMarkAsSpent(
        l1Address,
        unicityId,
        'pending'
      );

      if (!atomicResult.success) {
        if (atomicResult.error === 'already_minted') {
          throw new AlreadyMintedError('Address was minted by another request');
        }
        throw new ValidationError(`Failed to process: ${atomicResult.error}`);
      }

      // 6. Proxy to upstream faucet
      const amountInCoins = Number(amountBigInt) / Number(SATOSHIS_PER_COIN);
      const mintResult = await this.faucetProxy.mintToken(unicityId, amountInCoins);

      // 7. Update with actual txId
      this.balanceRepo.markAsSpent(l1Address, unicityId, mintResult.txId);

      // 8. Update request log
      this.balanceRepo.updateMintRequest(
        requestId,
        'success',
        null,
        JSON.stringify(mintResult.data)
      );

      return {
        success: true,
        l1_addr: l1Address,
        unicityId: unicityId,
        amount: amountInCoins,
        amountInSmallUnits: Number(amountBigInt),
        txId: mintResult.txId,
        message: 'Token minted successfully'
      };
    } catch (err) {
      // Update request log with error
      this.balanceRepo.updateMintRequest(
        requestId,
        'failed',
        err.message,
        null
      );
      throw err;
    }
  }

  /**
   * Get snapshot statistics
   * @returns {Object}
   */
  getStats() {
    const meta = this.balanceRepo.getSnapshotMeta();
    const totalCount = this.balanceRepo.countTotal();
    const unspentCount = this.balanceRepo.countUnspent();

    return {
      snapshotBlock: meta?.block_height || null,
      totalAddresses: totalCount,
      availableAddresses: unspentCount,
      mintedAddresses: totalCount - unspentCount,
      createdAt: meta?.created_at || null
    };
  }
}

export default BalanceService;
