import { ValidationError, AppError } from '../utils/errors.js';

/**
 * Register API routes on Fastify instance
 * @param {import('fastify').FastifyInstance} fastify
 * @param {Object} services - Injected services
 */
export async function registerRoutes(fastify, services) {
  const { balanceService, addressService } = services;

  // JSON Schema definitions for validation
  const balanceParamsSchema = {
    type: 'object',
    properties: {
      l1_addr: { type: 'string', minLength: 1 }
    },
    required: ['l1_addr']
  };

  const requestBodySchema = {
    type: 'object',
    properties: {
      l1_addr: { type: 'string', minLength: 1 },
      unicityId: { type: 'string', minLength: 1 },
      amount: { type: 'integer', minimum: 1 },
      signature: { type: 'string', pattern: '^(0x)?[0-9a-fA-F]{130}$' }
    },
    required: ['l1_addr', 'unicityId', 'amount', 'signature']
  };

  /**
   * GET /api/v1/faucet/balance/:l1_addr
   * Get balance information for an L1 address
   */
  fastify.get('/api/v1/faucet/balance/:l1_addr', {
    schema: {
      params: balanceParamsSchema
    }
  }, async (request, reply) => {
    const { l1_addr } = request.params;

    // Validate address format
    const validation = addressService.validateAddress(l1_addr);
    if (!validation.valid) {
      return reply.code(400).send({
        success: false,
        error: `Invalid L1 address: ${validation.error}`
      });
    }

    const result = balanceService.getBalance(validation.normalized);
    return result;
  });

  /**
   * POST /api/v1/faucet/request
   * Process a mint request
   */
  fastify.post('/api/v1/faucet/request', {
    schema: {
      body: requestBodySchema
    }
  }, async (request, reply) => {
    const { l1_addr, unicityId, amount, signature } = request.body;

    // Validate address format
    const validation = addressService.validateAddress(l1_addr);
    if (!validation.valid) {
      return reply.code(400).send({
        success: false,
        error: `Invalid L1 address: ${validation.error}`
      });
    }

    try {
      const result = await balanceService.processMintRequest(
        validation.normalized,
        unicityId,
        amount,
        signature
      );
      return result;
    } catch (err) {
      // Map errors to appropriate HTTP status codes
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({
          success: false,
          error: err.message
        });
      }
      throw err;
    }
  });

  /**
   * GET /api/v1/faucet/stats
   * Get snapshot statistics
   */
  fastify.get('/api/v1/faucet/stats', async () => {
    return {
      success: true,
      ...balanceService.getStats()
    };
  });

  /**
   * GET /health
   * Health check endpoint
   */
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });
}

export default { registerRoutes };
