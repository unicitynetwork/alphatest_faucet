// Alpha Test Token metadata from unicity-ids.testnet.json
export const TOKEN_CONFIG = {
  id: 'cde78ded16ef65818a51f43138031c4284e519300ab0cb60c30a8f9078080e5f',
  name: 'alpha_test',
  symbol: 'ALPHT',
  decimals: 8,
  description: 'ALPHA testnet coin on Unicity',
  network: 'unicity:testnet',
  assetKind: 'Fungible',
  iconUrl: 'https://raw.githubusercontent.com/unicitynetwork/unicity-ids/refs/heads/main/alpha_coin.png'
};

// Alpha blockchain address configuration
export const ADDRESS_CONFIG = {
  // Human-readable prefix for Bech32 addresses
  hrp: 'alpha',
  // Witness version for P2WPKH
  witnessVersion: 0
};

// Satoshis per coin (10^8)
export const SATOSHIS_PER_COIN = 100_000_000n;

// Message signing prefix (Bitcoin-style)
export const MESSAGE_PREFIX = 'Alpha Signed Message:\n';
