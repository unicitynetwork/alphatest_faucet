import 'dotenv/config';

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  isDev: process.env.NODE_ENV === 'development',

  // Database
  dbPath: process.env.DB_PATH || './data/faucet.db',

  // Endpoints
  fulcrumEndpoint: process.env.FULCRUM_ENDPOINT || 'wss://fulcrum.unicity.network:50004',
  faucetEndpoint: process.env.FAUCET_ENDPOINT || 'https://faucet.unicity.network/',

  // Alpha RPC (for snapshot)
  alphaRpc: {
    url: process.env.ALPHA_RPC_URL || 'http://localhost:8332',
    user: process.env.ALPHA_RPC_USER || '',
    pass: process.env.ALPHA_RPC_PASS || ''
  },

  // CORS
  corsOrigin: process.env.CORS_ORIGIN || '*'
};

export default config;
