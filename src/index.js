import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import config from './config/index.js';
import { initDatabase, databaseExists } from './db/index.js';
import { BalanceRepository } from './db/BalanceRepository.js';
import { AddressService } from './services/AddressService.js';
import { SignatureService } from './services/SignatureService.js';
import { FaucetProxyService } from './services/FaucetProxyService.js';
import { BalanceService } from './services/BalanceService.js';
import { registerRoutes } from './api/routes.js';
import { AppError } from './utils/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Build and configure Fastify application
 */
export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.isDev ? {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname'
        }
      } : undefined
    }
  });

  // Register CORS
  await fastify.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
    methods: ['GET', 'POST', 'OPTIONS']
  });

  // Serve static files from public directory
  const publicPath = join(__dirname, '..', 'public');
  await fastify.register(fastifyStatic, {
    root: publicPath,
    prefix: '/'
  });

  // Check if database exists
  if (!databaseExists(config.dbPath)) {
    fastify.log.warn(`Database not found at ${config.dbPath}. Run snapshot CLI first.`);
  }

  // Initialize database
  const db = initDatabase(config.dbPath);

  // Initialize services
  const balanceRepo = new BalanceRepository(db);
  const addressService = new AddressService();
  const signatureService = new SignatureService(addressService);
  const faucetProxy = new FaucetProxyService(config.faucetEndpoint);
  const balanceService = new BalanceService(balanceRepo, signatureService, faucetProxy);

  // Register routes
  await registerRoutes(fastify, {
    balanceService,
    addressService
  });

  // Global error handler
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    // Handle validation errors from Fastify
    if (error.validation) {
      return reply.code(400).send({
        success: false,
        error: 'Validation error',
        details: error.validation
      });
    }

    // Handle our custom errors
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: error.message
      });
    }

    // Handle unexpected errors
    return reply.code(500).send({
      success: false,
      error: config.isDev ? error.message : 'Internal server error'
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    await fastify.close();
    balanceRepo.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return fastify;
}

/**
 * Start the server
 */
async function start() {
  try {
    const app = await buildApp();

    await app.listen({
      port: config.port,
      host: '0.0.0.0'
    });

    app.log.info(`Faucet proxy listening on http://0.0.0.0:${config.port}`);
    app.log.info(`Environment: ${config.nodeEnv}`);
    app.log.info(`Database: ${config.dbPath}`);
    app.log.info(`Upstream faucet: ${config.faucetEndpoint}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Run if executed directly
start();

export { buildApp };
