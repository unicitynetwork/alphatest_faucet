import { request } from 'undici';
import { FaucetError } from '../utils/errors.js';
import config from '../config/index.js';

/**
 * Service for proxying requests to upstream faucet
 */
export class FaucetProxyService {
  /**
   * @param {string} faucetEndpoint - Base URL of upstream faucet
   */
  constructor(faucetEndpoint = config.faucetEndpoint) {
    // Ensure endpoint doesn't have trailing slash
    this.faucetEndpoint = faucetEndpoint.replace(/\/+$/, '');
  }

  /**
   * Submit a mint request to the upstream faucet
   * @param {string} unicityId - L3 destination Unicity ID
   * @param {number} amountInCoins - Amount in coin units (not satoshis)
   * @returns {Promise<{success: boolean, txId?: string, data?: object}>}
   */
  async mintToken(unicityId, amountInCoins) {
    const url = `${this.faucetEndpoint}/api/v1/faucet/request`;

    try {
      const response = await request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          unicityId: unicityId,
          coin: 'alpha_test',
          amount: amountInCoins
        }),
        throwOnError: false
      });

      const body = await response.body.json();

      if (response.statusCode !== 200) {
        const errorMsg = body.error || body.message || 'Unknown upstream error';
        throw new FaucetError(`Upstream faucet error: ${errorMsg}`);
      }

      return {
        success: true,
        txId: body.data?.requestId || body.txId || 'unknown',
        data: body
      };
    } catch (err) {
      if (err instanceof FaucetError) {
        throw err;
      }
      throw new FaucetError(`Failed to contact upstream faucet: ${err.message}`);
    }
  }

  /**
   * Check upstream faucet health
   * @returns {Promise<boolean>}
   */
  async checkHealth() {
    try {
      const response = await request(`${this.faucetEndpoint}/health`, {
        method: 'GET',
        throwOnError: false
      });

      return response.statusCode === 200;
    } catch {
      return false;
    }
  }

  /**
   * Get list of supported coins from upstream faucet
   * @returns {Promise<Array>}
   */
  async getCoins() {
    try {
      const response = await request(`${this.faucetEndpoint}/api/v1/faucet/coins`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        throwOnError: false
      });

      if (response.statusCode !== 200) {
        throw new FaucetError('Failed to fetch coins from upstream');
      }

      const body = await response.body.json();
      return body.coins || [];
    } catch (err) {
      if (err instanceof FaucetError) {
        throw err;
      }
      throw new FaucetError(`Failed to fetch coins: ${err.message}`);
    }
  }
}

export default FaucetProxyService;
